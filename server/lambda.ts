/**
 * Ejecutar Python en una GPU de Lambda Cloud, igual que en la CPU local.
 *
 * El navegador no habla con la nube: la clave (`LAMBDA_API_KEY`) vive en `.env` y
 * solo la usa el servidor de desarrollo. El flujo es el mismo que en local —
 * mismo script, mismos argumentos, misma salida— pero el proceso corre en la
 * instancia:
 *
 *   1. se enciende (o se reutiliza) la instancia `LAMBDA_NOMBRE`
 *   2. se sube el motor y los scripts del proyecto
 *   3. se ejecuta con `python3 -u <script>` dentro de la carpeta del proyecto
 *   4. se traen de vuelta los ficheros nuevos (marca de tiempo)
 *
 * La instancia NO se apaga sola: apagarla cuesta un clic y encenderla otra vez
 * cuesta tres minutos, así que decide la persona, no el proceso.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface ConfigLambda {
  apiKey: string;
  sshKey: string;
  sshKeyName: string;
  usuario: string;
  region: string;
  tipo: string;
  nombre: string;
  precioHora: number;
}

export interface Instancia {
  id: string;
  status: string;
  ip: string | null;
  nombre: string;
  tipo: string;
  /** Cuando empezo a facturar (ISO). Base del contador de gasto. */
  desde: string | null;
  /** Ultimo cambio de estado (ISO): sirve para contar el arranque. */
  cambio: string | null;
  /** Tarifa real del tipo de instancia, en dinero/hora. */
  precioHora: number;
  /** Horas desde que arranco y dinero acumulado a precio de tarifa. */
  horas: number;
  gastado: number;
}

const BASE = "https://cloud.lambda.ai/api/v1";
/** Carpeta de la instancia donde se replica workspace/. */
const REMOTO = "miuzika";
/** Por encima de esto no se sube un fichero del proyecto (stems, masters...). */
const MAX_SUBIDA = 50 * 1024 * 1024;

export function configDesdeEnv(env: Record<string, string>): {
  cfg: ConfigLambda | null;
  faltan: string[];
} {
  const faltan: string[] = [];
  const apiKey = (env.LAMBDA_API_KEY ?? "").trim();
  const sshKey = (env.LAMBDA_SSH_KEY ?? "").trim();
  if (!apiKey) faltan.push("LAMBDA_API_KEY");
  if (!sshKey) {
    faltan.push("LAMBDA_SSH_KEY");
  } else if (!existsSync(sshKey)) {
    faltan.push(`LAMBDA_SSH_KEY (no existe: ${sshKey})`);
  }
  if (faltan.length > 0) return { cfg: null, faltan };
  return {
    cfg: {
      apiKey,
      sshKey,
      sshKeyName: (env.LAMBDA_SSH_KEY_NAME ?? "aios-agent-rag").trim(),
      usuario: (env.LAMBDA_SSH_USER ?? "ubuntu").trim() || "ubuntu",
      region: (env.LAMBDA_REGION ?? "us-east-1").trim(),
      tipo: (env.LAMBDA_INSTANCE_TYPE ?? "gpu_1x_a10").trim(),
      nombre: (env.LAMBDA_NOMBRE ?? "miuzika-gpu").trim(),
      precioHora: Number(env.LAMBDA_PRECIO_HORA ?? 1.29) || 1.29,
    },
    faltan: [],
  };
}

// ------------------------------------------------------------------ API REST

async function api(
  cfg: ConfigLambda,
  ruta: string,
  cuerpo?: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/${ruta}`, {
    method: cuerpo === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      // Cloudflare responde 1010 (y parece un 401) a clientes sin User-Agent.
      "User-Agent": "miuzika/1.0 (curl/8.0)",
      ...(cuerpo === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(40000),
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`Lambda ${ruta}: HTTP ${res.status} ${texto.slice(0, 200)}`);
  return texto === "" ? {} : (JSON.parse(texto) as Record<string, unknown>);
}

/** Tarifas por tipo de instancia, tal como las publica Lambda (cacheadas 10 min). */
const preciosTipo = new Map<string, number>();
let preciosCuando = 0;

async function preciosDeTipos(cfg: ConfigLambda): Promise<Map<string, number>> {
  if (preciosTipo.size > 0 && Date.now() - preciosCuando < 10 * 60_000) return preciosTipo;
  try {
    const datos = (await api(cfg, "instance-types")) as { data?: unknown };
    preciosTipo.clear();
    // Lambda devuelve un objeto indexado por nombre (no una lista): cada valor
    // trae el tipo dentro de `instance_type`. Se aceptan las dos formas.
    const bruto = datos.data;
    const lista: Record<string, unknown>[] = Array.isArray(bruto)
      ? (bruto as Record<string, unknown>[])
      : Object.values((bruto ?? {}) as Record<string, unknown>).map((valor) => {
          const dentro = (valor as { instance_type?: unknown }).instance_type;
          return (dentro ?? valor) as Record<string, unknown>;
        });
    for (const tipo of lista) {
      const nombre = String(tipo.name ?? "");
      const specs = (tipo.specs ?? {}) as { price_cents_per_hour?: number };
      const centimos = tipo.price_cents_per_hour ?? specs.price_cents_per_hour;
      if (nombre !== "" && typeof centimos === "number" && centimos > 0) {
        preciosTipo.set(nombre, centimos / 100);
      }
    }
    preciosCuando = Date.now();
  } catch {
    /* sin tarifas publicadas: se usa el precio del .env como estimacion */
  }
  return preciosTipo;
}

export async function instancias(cfg: ConfigLambda): Promise<Instancia[]> {
  const [datos, tarifas] = await Promise.all([
    api(cfg, "instances") as Promise<{ data?: Record<string, unknown>[] }>,
    preciosDeTipos(cfg).catch(() => new Map<string, number>()),
  ]);
  return (datos.data ?? []).map((i) => {
    const tipo = (i.instance_type ?? {}) as { name?: string; price_cents_per_hour?: number };
    // first_healthy es cuando la maquina empezo a estar viva; a partir de ahi se
    // factura. Si aun no arranco, se cuenta desde ahora (0 horas).
    const desde = typeof i.first_healthy === "string" ? i.first_healthy : null;
    const horas = desde ? Math.max(0, (Date.now() - Date.parse(desde)) / 3_600_000) : 0;
    // Precio REAL: el que da la API para ese tipo; si no lo trae, la tabla de
    // tarifas publicadas; y solo si no hay nada, el del .env (estimacion).
    const nombreTipo = String(tipo.name ?? "");
    const centimos = typeof tipo.price_cents_per_hour === "number" ? tipo.price_cents_per_hour : null;
    const precio = centimos !== null ? centimos / 100 : (tarifas.get(nombreTipo) ?? cfg.precioHora);
    return {
      id: String(i.id ?? ""),
      status: String(i.status ?? ""),
      ip: typeof i.ip === "string" ? i.ip : null,
      nombre: String(i.name ?? ""),
      tipo: nombreTipo,
      desde,
      cambio: typeof i.last_state_change === "string" ? i.last_state_change : null,
      precioHora: Math.round(precio * 1000) / 1000,
      horas: Math.round(horas * 1000) / 1000,
      gastado: Math.round(horas * precio * 100) / 100,
    };
  });
}

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Enciende la instancia o reutiliza la que ya este viva con ese nombre. */
export async function encender(
  cfg: ConfigLambda,
  aviso: (texto: string) => void,
): Promise<{ id: string; ip: string; reutilizada: boolean; minutos: number }> {
  const t0 = Date.now();
  const vivas = (await instancias(cfg)).filter(
    (i) => i.nombre === cfg.nombre && i.status !== "terminated",
  );
  const lista = vivas.find((i) => i.status === "active" && i.ip);
  if (lista?.ip) {
    aviso(`reutilizo la instancia ${lista.id.slice(0, 12)} (${lista.ip})`);
    return { id: lista.id, ip: lista.ip, reutilizada: true, minutos: 0 };
  }

  let id = vivas[0]?.id ?? "";
  if (id === "") {
    aviso(`lanzando ${cfg.tipo} en ${cfg.region}`);
    const resp = (await api(cfg, "instance-operations/launch", {
      region_name: cfg.region,
      instance_type_name: cfg.tipo,
      ssh_key_names: [cfg.sshKeyName],
      file_system_names: [],
      name: cfg.nombre,
      quantity: 1,
    })) as { data?: { instance_ids?: string[] } };
    id = resp.data?.instance_ids?.[0] ?? "";
    if (id === "") throw new Error("Lambda no devolvio ninguna instancia");
  }

  for (let intento = 0; intento < 90; intento++) {
    await esperar(6000);
    const mia = (await instancias(cfg)).find((i) => i.id === id);
    if (mia?.status === "active" && mia.ip) {
      aviso(`activa en ${Math.round((Date.now() - t0) / 1000)} s: ${mia.ip}`);
      return {
        id,
        ip: mia.ip,
        reutilizada: false,
        minutos: Math.round((Date.now() - t0) / 6000) / 10,
      };
    }
    if (mia === undefined) throw new Error(`la instancia ${id} desaparecio mientras arrancaba`);
    if (intento % 5 === 4) aviso(`esperando... ${mia.status} (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  throw new Error("la instancia no llego a 'active' en 9 minutos");
}

/** Apaga (termina) la instancia y confirma que desaparece de la cuenta. */
export async function apagar(
  cfg: ConfigLambda,
  id: string,
): Promise<{ apagada: boolean; segundos: number }> {
  const t0 = Date.now();
  await api(cfg, "instance-operations/terminate", { instance_ids: [id] });
  for (let intento = 0; intento < 40; intento++) {
    await esperar(5000);
    const queda = (await instancias(cfg)).some((i) => i.id === id);
    if (!queda) return { apagada: true, segundos: Math.round((Date.now() - t0) / 1000) };
  }
  return { apagada: false, segundos: Math.round((Date.now() - t0) / 1000) };
}

// ------------------------------------------------------------------ ssh / scp

function correrComando(
  comando: string,
  args: string[],
  segundos: number,
): Promise<{ codigo: number | null; salida: string; errores: string }> {
  return new Promise((listo) => {
    const hijo = spawn(comando, args, { windowsHide: true });
    let salida = "";
    let errores = "";
    let cerrado = false;
    const terminar = (codigo: number | null): void => {
      if (cerrado) return;
      cerrado = true;
      if (temporizador) clearTimeout(temporizador);
      listo({ codigo, salida, errores });
    };
    const temporizador = setTimeout(() => {
      if (hijo.pid) {
        if (process.platform === "win32") spawn("taskkill", ["/PID", String(hijo.pid), "/T", "/F"]);
        else hijo.kill("SIGKILL");
      }
      errores += `\n[miuzika] ${comando} cortado a los ${segundos} s\n`;
      setTimeout(() => terminar(null), 2000);
    }, segundos * 1000);
    hijo.stdout.on("data", (t: Buffer) => {
      salida += t.toString("utf8");
    });
    hijo.stderr.on("data", (t: Buffer) => {
      errores += t.toString("utf8");
    });
    hijo.on("exit", (codigo) => setTimeout(() => terminar(codigo), 120));
    hijo.on("close", (codigo) => terminar(codigo));
    hijo.on("error", (error) => {
      errores += `${error.message}\n`;
      terminar(null);
    });
  });
}

const opcionesSsh = (cfg: ConfigLambda): string[] => [
  "-i",
  cfg.sshKey,
  "-o",
  "StrictHostKeyChecking=accept-new",
  "-o",
  "ConnectTimeout=15",
  "-o",
  "ServerAliveInterval=15",
  "-o",
  "LogLevel=ERROR",
];

export function ssh(
  cfg: ConfigLambda,
  ip: string,
  comando: string,
  segundos = 300,
): Promise<{ codigo: number | null; salida: string; errores: string }> {
  return correrComando("ssh", [...opcionesSsh(cfg), `${cfg.usuario}@${ip}`, comando], segundos);
}

function scp(
  cfg: ConfigLambda,
  ip: string,
  locales: string[],
  destinoRemoto: string,
  segundos = 900,
): Promise<{ codigo: number | null; salida: string; errores: string }> {
  return correrComando(
    "scp",
    ["-q", "-r", "-i", cfg.sshKey, "-o", "StrictHostKeyChecking=accept-new", "-o", "LogLevel=ERROR",
      ...locales, `${cfg.usuario}@${ip}:${destinoRemoto}`],
    segundos,
  );
}

/** ¿Hay ssh y scp en el PATH del servidor? (en Windows vienen con git-bash) */
export async function comprobarSsh(): Promise<{ ok: boolean; detalle: string }> {
  const r = await correrComando("ssh", ["-V"], 15);
  const texto = (r.errores + r.salida).trim();
  return { ok: /OpenSSH/i.test(texto), detalle: texto.split("\n")[0] ?? "" };
}

// ------------------------------------------------------------------ sincronizar

const comillas = (texto: string): string => `'${texto.replace(/'/g, `'\\''`)}'`;

/** Ficheros del proyecto que tiene sentido subir (scripts y datos pequenos). */
function ficherosDelProyecto(carpetaProyecto: string): string[] {
  const salida: string[] = [];
  const recorrer = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const completo = join(dir, entrada.name);
      if (entrada.isDirectory()) {
        if (entrada.name === "salida" || entrada.name === "__pycache__") continue;
        recorrer(completo);
      } else if (statSync(completo).size <= MAX_SUBIDA) {
        salida.push(completo);
      }
    }
  };
  recorrer(carpetaProyecto);
  return salida;
}

const pyDe = (carpeta: string): string[] => {
  if (!existsSync(carpeta)) return [];
  return readdirSync(carpeta)
    .filter((n) => n.endsWith(".py"))
    .map((n) => join(carpeta, n));
};

/** Replica motor + proyecto en la instancia. */
export async function sincronizar(
  cfg: ConfigLambda,
  ip: string,
  carpetaTrabajo: string,
  slug: string,
): Promise<{ codigo: number | null; errores: string; ficheros: number }> {
  const dirs = [
    `${REMOTO}/codigo`,
    `${REMOTO}/gpu`,
    `${REMOTO}/herramientas`,
    `${REMOTO}/plantillas`,
    `${REMOTO}/proyectos/${slug}/salida`,
  ];
  const mk = await ssh(cfg, ip, `mkdir -p ${dirs.map((d) => `~/${d}`).join(" ")}`, 60);
  if (mk.codigo !== 0) return { codigo: mk.codigo, errores: mk.errores, ficheros: 0 };

  let total = 0;
  const motor = pyDe(join(carpetaTrabajo, "codigo"));
  if (motor.length > 0) {
    const r = await scp(cfg, ip, motor, `${REMOTO}/codigo/`);
    if (r.codigo !== 0) return { codigo: r.codigo, errores: `motor: ${r.errores}`, ficheros: 0 };
    total += motor.length;
  }
  const gpu = pyDe(join(carpetaTrabajo, "gpu"));
  if (gpu.length > 0) {
    const r = await scp(cfg, ip, gpu, `${REMOTO}/gpu/`);
    if (r.codigo !== 0) return { codigo: r.codigo, errores: `gpu: ${r.errores}`, ficheros: 0 };
    total += gpu.length;
  }
  const herramientas = pyDe(join(carpetaTrabajo, "herramientas"));
  if (herramientas.length > 0) {
    const r = await scp(cfg, ip, herramientas, `${REMOTO}/herramientas/`);
    if (r.codigo !== 0) return { codigo: r.codigo, errores: `herramientas: ${r.errores}`, ficheros: 0 };
    total += herramientas.length;
  }
  const proyecto = ficherosDelProyecto(join(carpetaTrabajo, "proyectos", slug));
  if (proyecto.length > 0) {
    const r = await scp(cfg, ip, proyecto, `${REMOTO}/proyectos/${slug}/`);
    if (r.codigo !== 0) return { codigo: r.codigo, errores: `proyecto: ${r.errores}`, ficheros: 0 };
    total += proyecto.length;
  }
  return { codigo: 0, errores: "", ficheros: total };
}

/** Trae de vuelta lo que el script haya escrito (mas nuevo que la marca). */
async function traerNuevos(
  cfg: ConfigLambda,
  ip: string,
  carpetaTrabajo: string,
  slug: string,
): Promise<{ traidos: string[]; errores: string }> {
  const rutaRemota = `~/${REMOTO}/proyectos/${slug}`;
  const lista = await ssh(
    cfg,
    ip,
    `find ${rutaRemota} -type f -newer ~/${REMOTO}/.marca -printf '%P\\n' 2>/dev/null | head -200`,
    120,
  );
  const relativos = lista.salida
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.includes("__pycache__") && !l.endsWith(".pyc"));
  if (relativos.length === 0) return { traidos: [], errores: "" };

  // Un scp por grupo de ficheros del mismo directorio destino.
  const porDestino = new Map<string, string[]>();
  for (const rel of relativos) {
    const destinoLocal = resolve(join(carpetaTrabajo, "proyectos", slug, rel));
    const dentro = destinoLocal.startsWith(resolve(carpetaTrabajo));
    if (!dentro) continue;
    mkdirSync(dirname(destinoLocal), { recursive: true });
    const clave = dirname(destinoLocal);
    const listaDestino = porDestino.get(clave) ?? [];
    listaDestino.push(`${cfg.usuario}@${ip}:${rutaRemota}/${rel}`);
    porDestino.set(clave, listaDestino);
  }
  const traidos: string[] = [];
  let errores = "";
  for (const [destino, fuentes] of porDestino) {
    const r = await correrComando(
      "scp",
      ["-q", "-i", cfg.sshKey, "-o", "StrictHostKeyChecking=accept-new", "-o", "LogLevel=ERROR",
        ...fuentes, destino],
      600,
    );
    if (r.codigo === 0) traidos.push(...fuentes.map((f) => f.split("/").pop() ?? ""));
    else errores += r.errores;
  }
  return { traidos: traidos.filter((n) => n !== ""), errores };
}

// ------------------------------------------------------------------ ejecutar

export interface PeticionLambda {
  scriptRel: string;
  argumentos: string[];
  segundos: number;
  carpetaTrabajo: string;
  slug: string;
  aviso: (texto: string) => void;
}

export async function ejecutarEnLambda(
  cfg: ConfigLambda,
  p: PeticionLambda,
): Promise<{
  ok: boolean;
  id: string;
  ip: string;
  codigo: number | null;
  salida: string;
  errores: string;
  ms: number;
  traidos: string[];
  nota: string;
}> {
  const t0 = Date.now();
  const arranque = await encender(cfg, p.aviso);
  const sinc = await sincronizar(cfg, arranque.ip, p.carpetaTrabajo, p.slug);
  if (sinc.codigo !== 0) {
    return {
      ok: false, id: arranque.id, ip: arranque.ip, codigo: sinc.codigo, salida: "",
      errores: `no se pudo sincronizar: ${sinc.errores}`, ms: Date.now() - t0, traidos: [],
      nota: "sincronizacion",
    };
  }
  p.aviso(`${sinc.ficheros} fichero(s) subidos; ejecutando ${p.scriptRel}`);

  await ssh(cfg, arranque.ip, `touch ~/${REMOTO}/.marca`, 30);
  // El cwd remoto es la carpeta del proyecto: lo que vive dentro se pasa relativo
  // a ella; lo compartido (codigo/, herramientas/) se pasa relativo hacia arriba
  // ("../../codigo/..."), o se prefijaria dos veces ("proyectos/<slug>/codigo/...").
  const prefijo = `proyectos/${p.slug}/`;
  // Lo compartido se pasa RELATIVO al cwd del proyecto (../.. = ~/miuzika), no
  // como "$HOME/...": la ruta va entrecomillada, la shell no expande $HOME y
  // python la resolvia contra el cwd ("proyectos/<slug>/$HOME/miuzika/..."),
  // que es exactamente el error que dejaba el render sin ejecutar.
  const script = p.scriptRel.startsWith(prefijo)
    ? p.scriptRel.slice(prefijo.length)
    : `../../${p.scriptRel}`;
  const args = p.argumentos.map(comillas).join(" ");
  const comando =
    `cd ~/${REMOTO}/proyectos/${p.slug} && ` +
    `PYTHONPATH=~/${REMOTO}/codigo PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8 ` +
    `timeout -k 5 ${p.segundos} python3 -u ${comillas(script)} ${args}`;

  const r = await ssh(cfg, arranque.ip, comando, p.segundos + 60);
  const traida = await traerNuevos(cfg, arranque.ip, p.carpetaTrabajo, p.slug);
  p.aviso(`terminado; ${traida.traidos.length} fichero(s) traidos de vuelta`);

  return {
    ok: r.codigo === 0,
    id: arranque.id,
    ip: arranque.ip,
    codigo: r.codigo,
    salida: r.salida,
    errores: r.errores + traida.errores,
    ms: Date.now() - t0,
    traidos: traida.traidos,
    nota: arranque.reutilizada ? "instancia reutilizada" : "instancia nueva",
  };
}

/** Estado para la barra/el panel: configurado, viva, coste y ssh disponible. */
/**
 * Estado agregado. La forma es DELIBERADAMENTE generica: cualquier proveedor
 * (Lambda, RunPod, Paperspace...) puede rellenarla y el contador de la app
 * funciona igual, porque solo necesita precio/hora y desde cuando cuenta.
 */
export async function estado(cfg: ConfigLambda): Promise<{
  configurado: boolean;
  instancias: Instancia[];
  ssh: { ok: boolean; detalle: string };
  /** Tarifa que se aplica AHORA: la de la instancia viva o la del tipo configurado. */
  precioHora: number;
  tipo: string;
  /** apagada | arrancando | activa | apagandose */
  fase: "apagada" | "arrancando" | "activa" | "apagandose";
  activo: boolean;
  desde: string | null;
  /** Inicio del arranque en curso (para el reloj de "arrancando"). */
  arranque: string | null;
  gastado: number;
  moneda: string;
  proveedor: string;
}> {
  const [lista, sshOk] = await Promise.all([
    instancias(cfg).catch(() => [] as Instancia[]),
    comprobarSsh(),
  ]);
  const vivas = lista.filter((i) => i.status !== "terminated");
  // Solo cuentan las que estan ACTIVAS: una instancia colgada en "terminating"
  // durante dias conserva su first_healthy y sumaba miles de dolares al contador.
  const activas = vivas.filter((i) => i.status === "active");
  const arrancando = vivas.filter(
    (i) => i.status === "booting" || i.status === "loading" || i.status === "unhealthy",
  );
  const apagandose = vivas.filter(
    // Sólo cuenta la que se está apagando AHORA: una instancia zombi en
    // "terminating" desde hace meses (caso abierto con soporte) no puede dejar la
    // cabecera diciendo "apagándose" para siempre.
    (i) =>
      i.status === "terminating" &&
      (i.desde === null || Date.now() - Date.parse(i.desde) < 30 * 60_000),
  );
  const fase = activas.length > 0
    ? "activa"
    : arrancando.length > 0
      ? "arrancando"
      : apagandose.length > 0
        ? "apagandose"
        : "apagada";
  const contando = activas
    .filter((i) => i.desde !== null)
    .sort((a, b) => Date.parse(a.desde ?? "") - Date.parse(b.desde ?? ""));
  const principal = contando[0] ?? null;
  // La tarifa que se muestra es la de la instancia que hay delante, no la del
  // .env: un A10 no cuesta lo mismo que un A100 y el .env es solo el respaldo.
  const tarifas = await preciosDeTipos(cfg).catch(() => new Map<string, number>());
  const precioHora = (activas[0] ?? arrancando[0])?.precioHora ?? tarifas.get(cfg.tipo) ?? cfg.precioHora;
  return {
    configurado: true,
    instancias: vivas,
    ssh: sshOk,
    precioHora: Math.round(precioHora * 1000) / 1000,
    tipo: (activas[0] ?? arrancando[0])?.tipo || cfg.tipo,
    fase,
    activo: activas.length > 0,
    desde: principal?.desde ?? null,
    arranque: arrancando[0]?.cambio ?? arrancando[0]?.desde ?? null,
    gastado: Math.round(activas.reduce((total, i) => total + i.gastado, 0) * 100) / 100,
    moneda: "USD",
    proveedor: "lambda",
  };
}
