/**
 * GPU providers: which ones exist, what each needs, and the settings in force. Copied from miuzika
 * (4-Nov) without its on/off switch: here a GPU only runs when a person presses Run.
 *
 * Why (Carlos, 6-Nov): nobody should have to edit a .env to use the app. Settings paints whatever a
 * provider declares here, so another one is another entry in this list. .env stays as a fallback.
 *
 * Pure: no files, no network. The server reads the file and the .env and calls this.
 */

export interface CampoGpu {
  /** Key in the settings. */
  clave: string;
  /** The .env variable that fills it when the settings do not. */
  variableEnv: string;
  etiqueta: string;
  /** Never returned to the browser (only "there is one" and its last digits). */
  secreto?: boolean;
  porDefecto?: string;
  ayuda?: string;
  /** Has a default that rarely needs changing: folded away in Settings. */
  avanzado?: boolean;
}

export interface ProveedorGpuInfo {
  id: string;
  nombre: string;
  ayuda: string;
  campos: CampoGpu[];
}

export const PROVEEDORES_GPU: readonly ProveedorGpuInfo[] = [
  {
    id: "lambda",
    nombre: "Lambda Cloud",
    ayuda: "GPU by the hour (24 GB A10 by default). A run starts an instance with this name and leaves it on until you press “⏻ Off”.",
    campos: [
      { clave: "apiKey", variableEnv: "LAMBDA_API_KEY", etiqueta: "API key", secreto: true, ayuda: "From Lambda's dashboard, API keys." },
      { clave: "sshKey", variableEnv: "LAMBDA_SSH_KEY", etiqueta: "SSH key file", ayuda: "Full path of the private key on this machine." },
      { clave: "sshKeyName", variableEnv: "LAMBDA_SSH_KEY_NAME", etiqueta: "SSH key name", porDefecto: "aios-agent-rag", ayuda: "That key's name in Lambda's dashboard." },
      { clave: "usuario", variableEnv: "LAMBDA_SSH_USER", etiqueta: "SSH user", porDefecto: "ubuntu", avanzado: true },
      { clave: "region", variableEnv: "LAMBDA_REGION", etiqueta: "Region", porDefecto: "us-east-1", avanzado: true },
      { clave: "tipo", variableEnv: "LAMBDA_INSTANCE_TYPE", etiqueta: "Instance type", porDefecto: "gpu_1x_a10", avanzado: true },
      { clave: "nombre", variableEnv: "LAMBDA_NOMBRE", etiqueta: "Instance name", porDefecto: "miuzika-gpu", avanzado: true, ayuda: "Off only shuts down instances with this name: the account may be shared." },
      { clave: "precioHora", variableEnv: "LAMBDA_PRECIO_HORA", etiqueta: "Price per hour ($)", porDefecto: "1.29", avanzado: true, ayuda: "Only used if Lambda does not give the rate." },
    ],
  },
];

/** What `.miuzika/proveedores.json` keeps under `gpu`. */
export interface ConfigGpu {
  proveedores: Record<string, Record<string, string>>;
}

export function proveedorGpuPorId(id: string): ProveedorGpuInfo | undefined {
  return PROVEEDORES_GPU.find((p) => p.id === id);
}

export type OrigenValor = "ajustes" | "env" | "defecto" | "falta";

/**
 * The value of each field (settings first, .env second, default last), as the .env-style record
 * the provider's own config reader takes (`configDesdeEnv` for Lambda), plus where each came from.
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

/**
 * Keeps only known fields, trimmed; an empty value removes the field (falls back to .env or the
 * default). The surrounding quotes go too: Windows' "Copy as path" adds them to the SSH key's path.
 */
export function limpiarAjustesGpu(id: string, entrada: Record<string, unknown>, previos: Record<string, string> = {}): Record<string, string> {
  const p = proveedorGpuPorId(id);
  if (!p) return {};
  const salida: Record<string, string> = { ...previos };
  for (const campo of p.campos) {
    if (!(campo.clave in entrada)) continue;
    const valor = String(entrada[campo.clave] ?? "").trim().replace(/^"(.*)"$/, "$1").trim();
    // A secret left empty in the form means "unchanged", not "delete": the browser never has it.
    if (campo.secreto && valor === "") continue;
    if (valor === "") delete salida[campo.clave];
    else salida[campo.clave] = valor;
  }
  return salida;
}

/** A secret, as the browser may see it: the last digits, and nothing at all from a short one. */
export function claveOculta(clave: string): string {
  if (clave === "") return "";
  return clave.length <= 8 ? "••••" : `…${clave.slice(-4)}`;
}

/** The reader names .env variables; a person reads the labels of the form. */
export function faltanLegibles(id: string, faltan: string[]): string[] {
  const campos = proveedorGpuPorId(id)?.campos ?? [];
  return faltan.map((texto) => campos.reduce((t, c) => t.replace(c.variableEnv, c.etiqueta), texto));
}
