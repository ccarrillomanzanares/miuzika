/**
 * GPU providers: which ones exist, what each needs, and the settings in force.
 *
 * Why (Carlos, 4-Nov, docs/PLAN-PROVEEDORES-GPU.md): the GPU is a provider list of its own in
 * "Models", next to the LLM providers but separate. Until 4-Nov Lambda lived only in .env
 * (`MIUZIKA_LAMBDA=on` and `LAMBDA_*`); now it is set in `.miuzika/proveedores.json` under `gpu`,
 * and .env stays as the fallback, so nothing changes for a setup that only has .env.
 *
 * Pure: no files, no network. The server reads the file and the .env and calls this.
 */

export interface CampoGpu {
  /** Key in the settings. */
  clave: string;
  /** The .env variable that fills it when the settings do not. */
  variableEnv: string;
  es: string;
  en: string;
  /** Never returned to the browser (only "there is one" and its last digits). */
  secreto?: boolean;
  porDefecto?: string;
}

export interface ProveedorGpuInfo {
  id: string;
  nombre: string;
  ayudaEs: string;
  ayudaEn: string;
  campos: CampoGpu[];
}

export const PROVEEDORES_GPU: readonly ProveedorGpuInfo[] = [
  {
    id: "lambda",
    nombre: "Lambda Cloud",
    ayudaEs:
      "GPU por horas (A10 de 24 GB por defecto). La app enciende una instancia con este nombre, sube el motor, ejecuta y la deja encendida: se apaga con «⏻ Off».",
    ayudaEn:
      "GPU by the hour (24 GB A10 by default). The app starts an instance with this name, uploads the engine, runs and leaves it on: shut it down with \"⏻ Off\".",
    campos: [
      { clave: "apiKey", variableEnv: "LAMBDA_API_KEY", es: "Clave de la API", en: "API key", secreto: true },
      { clave: "sshKey", variableEnv: "LAMBDA_SSH_KEY", es: "Clave SSH privada (ruta en este equipo)", en: "Private SSH key (path on this machine)" },
      { clave: "sshKeyName", variableEnv: "LAMBDA_SSH_KEY_NAME", es: "Nombre de esa clave en Lambda", en: "That key's name in Lambda", porDefecto: "aios-agent-rag" },
      { clave: "usuario", variableEnv: "LAMBDA_SSH_USER", es: "Usuario SSH", en: "SSH user", porDefecto: "ubuntu" },
      { clave: "region", variableEnv: "LAMBDA_REGION", es: "Región", en: "Region", porDefecto: "us-east-1" },
      { clave: "tipo", variableEnv: "LAMBDA_INSTANCE_TYPE", es: "Tipo de máquina", en: "Instance type", porDefecto: "gpu_1x_a10" },
      { clave: "nombre", variableEnv: "LAMBDA_NOMBRE", es: "Nombre de la instancia (sólo se apagan las que lo llevan)", en: "Instance name (only those carrying it are shut down)", porDefecto: "miuzika-gpu" },
      { clave: "precioHora", variableEnv: "LAMBDA_PRECIO_HORA", es: "Precio por hora si Lambda no lo da ($)", en: "Price per hour if Lambda does not give it ($)", porDefecto: "1.29" },
    ],
  },
];

/** What `.miuzika/proveedores.json` keeps under `gpu`. */
export interface ConfigGpu {
  /** The provider in use; "" = GPU off. Absent = decided by .env (MIUZIKA_LAMBDA=on). */
  activo?: string;
  proveedores: Record<string, Record<string, string>>;
}

export function proveedorGpuPorId(id: string): ProveedorGpuInfo | undefined {
  return PROVEEDORES_GPU.find((p) => p.id === id);
}

/** Which provider is on: the settings if they say, else .env's MIUZIKA_LAMBDA=on; "" = off. */
export function gpuActiva(config: ConfigGpu | undefined, env: Record<string, string | undefined>): string {
  if (config?.activo !== undefined) return proveedorGpuPorId(config.activo) ? config.activo : "";
  return (env.MIUZIKA_LAMBDA ?? "").trim().toLowerCase() === "on" ? "lambda" : "";
}

export type OrigenValor = "ajustes" | "env" | "defecto" | "falta";

/**
 * The value of each field (settings first, .env second, default last), as the .env-style
 * record the provider's own config reader takes (`configDesdeEnv` for Lambda), plus where
 * each value came from, for the panel.
 */
export function ajustesEfectivos(
  id: string,
  config: ConfigGpu | undefined,
  env: Record<string, string | undefined>,
): { variables: Record<string, string>; origen: Record<string, OrigenValor> } {
  const p = proveedorGpuPorId(id);
  const variables: Record<string, string> = {};
  const origen: Record<string, OrigenValor> = {};
  if (!p) return { variables, origen };
  const propios = config?.proveedores[id] ?? {};
  for (const campo of p.campos) {
    const deAjustes = (propios[campo.clave] ?? "").trim();
    const delEnv = (env[campo.variableEnv] ?? "").trim();
    if (deAjustes !== "") {
      variables[campo.variableEnv] = deAjustes;
      origen[campo.clave] = "ajustes";
    } else if (delEnv !== "") {
      variables[campo.variableEnv] = delEnv;
      origen[campo.clave] = "env";
    } else if (campo.porDefecto !== undefined) {
      origen[campo.clave] = "defecto";
    } else {
      origen[campo.clave] = "falta";
    }
  }
  return { variables, origen };
}

/** Keeps only known fields, trimmed; an empty value removes the field (falls back to .env). */
export function limpiarAjustesGpu(id: string, entrada: Record<string, unknown>, previos: Record<string, string> = {}): Record<string, string> {
  const p = proveedorGpuPorId(id);
  if (!p) return {};
  const salida: Record<string, string> = { ...previos };
  for (const campo of p.campos) {
    if (!(campo.clave in entrada)) continue;
    const valor = String(entrada[campo.clave] ?? "").trim();
    // A secret left empty in the form means "unchanged", not "delete": the browser never has it.
    if (campo.secreto && valor === "") continue;
    if (valor === "") delete salida[campo.clave];
    else salida[campo.clave] = valor;
  }
  return salida;
}
