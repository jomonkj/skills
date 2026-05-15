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

/** `yard registry-read` — read + validate one project's registry file. */
export const registryReadInput = z.object({
  /** Path to the project's YAML file in the cloned `yard-config` repo.
   *  Defaults to `<homeDir>/.yard/config/projects/<project>.yml`. */
  file: z.string().min(1).optional(),
  /** Project dir basename. Used to derive the default `file` path. */
  project: z.string().min(1).optional(),
});
export type RegistryReadInput = z.infer<typeof registryReadInput>;

/** `yard init --from <url> --profile <name>`. */
export const initInput = z.object({
  /** Git URL of the private `yard-config` registry repo. */
  from: z.string().min(1, "--from <yard-config-url> is required"),
  /** Profile name -> `~/.yard/profile.<name>.yml`. */
  profile: z.string().min(1, "--profile <name> is required"),
});
export type InitInput = z.infer<typeof initInput>;

export const issueCreateInput = z.object({
  /** `owner/name`. */
  repo: z.string().min(1, "repo is required (owner/name)"),
  /** Issue title. */
  title: z.string().min(1, "title is required"),
  /** Issue body markdown. */
  body: z.string().default(""),
  /** Labels to apply. Labels are ensured (via labels-ensure) before creation. */
  labels: z.array(z.string()).default([]),
  /**
   * Parent issue number. When provided, a `## Parent\n#N` section is
   * prepended to the body (per the issue template in to-issues/SKILL.md).
   */
  parent: z.number().int().positive().optional(),
  /**
   * Which canonical label set to ensure before creating the issue.
   * Defaults to "all". Pass "none" to skip label-ensure (useful when you
   * know labels are already present).
   */
  ensureSet: z.enum(["triage", "yard", "all", "none"]).default("all"),
  /** When true, report what would happen without calling `gh`. */
  dryRun: z.boolean().default(false),
});

export type IssueCreateInput = z.infer<typeof issueCreateInput>;
