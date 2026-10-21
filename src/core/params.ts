/** Parámetros de dispositivo: acepta n?meros y booleanos (pingPong: true). */

import { z } from "zod";

export const ParamValueSchema = z.union([z.number(), z.boolean()]);

export type ParamValue = z.infer<typeof ParamValueSchema>;

/** true/false → 1/0; el resto pasa tal cual. */
export function numericParam(value: ParamValue): number {
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
}
