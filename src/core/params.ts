/** Device parameters: accepts numbers and booleans (pingPong: true). */

import { z } from "zod";

export const ParamValueSchema = z.union([z.number(), z.boolean()]);

type ParamValue = z.infer<typeof ParamValueSchema>;

/** true/false → 1/0; everything else passes through unchanged. */
export function numericParam(value: ParamValue): number {
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
}
