/**
 * Zod schemas — the single source for CLI arg parsing, (future) MCP tool
 * schemas, and docs (ADR 0003). One schema per subcommand.
 */
import { z } from "zod";

/** Output envelope version. Bump on any breaking shape change. */
export const OUTPUT_VERSION = 1;

export const labelsEnsureInput = z.object({
  /** `owner/name`. Defaults to the current repo when omitted at the CLI. */
  repo: z.string().min(1, "repo is required (owner/name)"),
  set: z.enum(["triage", "yard", "all"]),
  /** When true, report what would change without calling `gh`. */
  dryRun: z.boolean().default(false),
});

export type LabelsEnsureInput = z.infer<typeof labelsEnsureInput>;
