/**
 * Herramientas que el LLM puede invocar. Cada una pasa por el mismo pipeline
 * de validación que la UI: si el modelo se equivoca, recibe el error y corrige.
 */

import type { Project } from "../core/types.ts";
import { projectDigest, trackIds } from "../core/digest.ts";
import { applyOps, opsJsonSchema, parseOps } from "../core/ops.ts";
import { validateProject } from "../core/project.ts";
import type { ToolDefinition } from "./client.ts";

export interface ToolOutcome {
  ok: boolean;
  content: string;
}

export interface ToolLogEntry {
  name: string;
  ok: boolean;
  content: string;
}

const MAX_UNDO = 50;

export class ToolSession {
  private current: Project;
  private readonly history: Project[] = [];
  readonly log: ToolLogEntry[] = [];

  constructor(project: Project) {
    this.current = structuredClone(project) as Project;
  }

  get project(): Project {
    return this.current;
  }

  get undoDepth(): number {
    return this.history.length;
  }

  tools(): ToolDefinition[] {
    return [
      {
        type: "function",
        function: {
          name: "get_project_digest",
          description:
            "Devuelve el estado actual del proyecto: tempo, tonalidad, pistas con sus ids, clips, notas y cadena de efectos. Úsalo antes de modificar nada.",
          parameters: {
            type: "object",
            properties: {
              trackId: {
                type: "string",
                description: "Si se indica, incluye las primeras notas del primer clip de esa pista.",
              },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "apply_ops",
          description:
            "Aplica operaciones al proyecto de forma transaccional. Si una falla, no se aplica ninguna y recibes el error para corregirlo.",
          parameters: opsJsonSchema(),
        },
      },
      {
        type: "function",
        function: {
          name: "check_project",
          description: "Valida el proyecto y devuelve errores y avisos (notas fuera de rango, clips solapados, etc.).",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
      {
        type: "function",
        function: {
          name: "undo",
          description: "Deshace el último apply_ops. Úsalo si te has equivocado.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
    ];
  }

  exec(name: string, rawArguments: unknown): ToolOutcome {
    const args = this.parseArguments(rawArguments);
    if (!args.ok) return this.record(name, args);
    const value = args.value as Record<string, unknown>;

    switch (name) {
      case "get_project_digest": {
        const trackId = typeof value.trackId === "string" ? value.trackId : undefined;
        return this.record(name, {
          ok: true,
          content: projectDigest(this.current, trackId ? { includeNotesFor: trackId } : {}),
        });
      }

      case "apply_ops": {
        const raw = value.ops ?? value;
        let ops;
        try {
          ops = parseOps(raw);
        } catch (error) {
          return this.record(name, {
            ok: false,
            content: `${error instanceof Error ? error.message : String(error)}. Corrige el JSON y reinténtalo.`,
          });
        }
        try {
          const result = applyOps(this.current, ops);
          this.history.push(this.current);
          if (this.history.length > MAX_UNDO) this.history.shift();
          this.current = result.project;
          const warnings =
            result.warnings.length > 0
              ? `\nAvisos: ${result.warnings.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`
              : "";
          return this.record(name, {
            ok: true,
            content: `OK (${ops.length} ops)\n${result.results.join("\n")}${warnings}\n\n${projectDigest(
              this.current,
              { maxChars: 3500 },
            )}`,
          });
        } catch (error) {
          return this.record(name, {
            ok: false,
            content: `${error instanceof Error ? error.message : String(error)}\nPistas disponibles: ${trackIds(
              this.current,
            )}`,
          });
        }
      }

      case "check_project": {
        const issues = validateProject(this.current);
        const errors = issues.filter((issue) => issue.severity === "error");
        const body =
          issues.length === 0
            ? "Sin problemas."
            : issues.map((issue) => `[${issue.severity}] ${issue.path}: ${issue.message}`).join("\n");
        return this.record(name, { ok: errors.length === 0, content: body });
      }

      case "undo": {
        const previous = this.history.pop();
        if (!previous) return this.record(name, { ok: false, content: "No hay nada que deshacer." });
        this.current = previous;
        return this.record(name, { ok: true, content: "Deshecho.\n\n" + projectDigest(this.current, { maxChars: 2500 }) });
      }

      default:
        return this.record(name, {
          ok: false,
          content: `Herramienta desconocida: ${name}. Disponibles: get_project_digest, apply_ops, check_project, undo.`,
        });
    }
  }

  private parseArguments(raw: unknown): { ok: true; value: unknown } | { ok: false; content: string } {
    if (raw === undefined || raw === null || raw === "") return { ok: true, value: {} };
    if (typeof raw === "string") {
      try {
        return { ok: true, value: JSON.parse(raw) };
      } catch {
        return { ok: false, content: "Los argumentos no son JSON válido. Devuelve solo el objeto JSON." };
      }
    }
    return { ok: true, value: raw };
  }

  private record(name: string, outcome: ToolOutcome): ToolOutcome {
    this.log.push({ name, ok: outcome.ok, content: outcome.content });
    return outcome;
  }
}
