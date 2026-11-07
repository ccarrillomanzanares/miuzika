/**
 * What the app needs from a rented GPU, whoever rents it.
 *
 * Why (Carlos, 4-Nov, docs/PLAN-PROVEEDORES-GPU.md): Lambda is the first GPU provider of
 * several and must sit behind one interface, distinct from the LLM providers. The routes
 * (server/api/gpu.ts) talk only to this; Lambda's details stay in server/lambda.ts. Vast.ai
 * and RunPod were read the same day to keep the shape general: the machine may come from an
 * offer instead of a fixed type, SSH may use another port, and "stop" may differ from "destroy".
 * Those are not modelled until a second provider is written.
 */

import type { Instancia, PeticionLambda } from "../lambda.ts";

export type InstanciaGpu = Instancia;

/** What /api/gpu/estado returns and the header counter reads. */
export interface EstadoGpu {
  configurado: boolean;
  instancias: InstanciaGpu[];
  ssh: { ok: boolean; detalle: string };
  precioHora: number;
  tipo: string;
  fase: "apagada" | "arrancando" | "activa" | "apagandose";
  activo: boolean;
  desde: string | null;
  arranque: string | null;
  gastado: number;
  moneda: string;
  proveedor: string;
}

/** A script run on the GPU: the same contract as /api/run/python. */
export type PeticionGpu = PeticionLambda;

export interface ResultadoGpu {
  ok: boolean;
  id: string;
  ip: string;
  codigo: number | null;
  salida: string;
  errores: string;
  ms: number;
  traidos: string[];
  nota: string;
  /** Non-empty when the run finished but its outputs did not reach the project folder (5-Nov). */
  traidaFallo: string;
}

/** One thing checked without starting anything or spending. */
export interface Comprobacion {
  que: string;
  ok: boolean;
  detalle: string;
}

export interface ProveedorGpu {
  /** "lambda", later "vast", "runpod"… */
  id: string;
  /** For people: "Lambda Cloud". */
  nombre: string;
  region: string;
  /** Name our instances carry: only those can be shut down from the app (the account is shared). */
  etiqueta: string;
  estado(): Promise<EstadoGpu>;
  /** What can be known before the first Run, so a wrong setting does not wait for a boot to show. */
  comprobar(): Promise<Comprobacion[]>;
  /** Powers one on, or reuses ours if it is alive. */
  encender(aviso: (texto: string) => void, senal?: AbortSignal): Promise<{ id: string; ip: string; reutilizada: boolean }>;
  /** Ours that are on or starting. */
  apagables(): Promise<InstanciaGpu[]>;
  /** Shuts one down and waits for the provider to confirm. */
  apagar(id: string): Promise<{ apagada: boolean; segundos: number }>;
  /** Boot (or reuse), upload, run, bring the new files back. Rejects with `Cancelado` if `senal` aborts. */
  ejecutar(p: PeticionGpu): Promise<ResultadoGpu>;
}

export { Cancelado } from "../lambda.ts";
