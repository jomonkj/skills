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

// ── Registry mutator inputs (ADR 0006) ─────────────────────────────────────
//
// All registry writes go through these validated inputs. The registry YAML is
// NEVER hand-edited — only `yard` commands write it (ADR 0006, "operational
// rules"). Deterministic output (stable key order, canonical YAML) ensures
// clean diffs and merges.

/** `yard project add --project <name>` */
export const projectAddInput = z.object({
  /** Project dir basename, e.g. `yolo-hq`. */
  project: z.string().min(1, "--project <name> is required"),
  /** Path to the project's YAML file (optional; defaults to the standard path). */
  file: z.string().min(1).optional(),
});
export type ProjectAddInput = z.infer<typeof projectAddInput>;

/** `yard repo add --project <name> --key <dotted-key> --code <code> --url <url> --line <name> [--protected] [--env <tag>]` */
export const repoAddInput = z.object({
  project: z.string().min(1, "--project <name> is required"),
  file: z.string().min(1).optional(),
  /** Dotted dir key, e.g. `apps.libromi`. */
  key: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/,
      "repo key must be a dotted dir path (e.g. apps.libromi)",
    ),
  code: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "code must be a lowercase identifier"),
  url: z.string().min(1, "--url is required"),
  /** Initial release line name, e.g. `main`. */
  line: z.string().min(1, "--line <name> is required"),
  protected: z.boolean().default(false),
  env: z.string().min(1).optional(),
});
export type RepoAddInput = z.infer<typeof repoAddInput>;

/** `yard line add --project <name> --repo <key> --line <name> [--protected] [--env <tag>]` */
export const lineAddInput = z.object({
  project: z.string().min(1, "--project <name> is required"),
  file: z.string().min(1).optional(),
  /** Dotted repo key. */
  repo: z.string().min(1, "--repo <key> is required"),
  line: z.string().min(1, "--line <name> is required"),
  protected: z.boolean().default(false),
  env: z.string().min(1).optional(),
});
export type LineAddInput = z.infer<typeof lineAddInput>;

/** `yard line rm --project <name> --repo <key> --line <name>` */
export const lineRmInput = z.object({
  project: z.string().min(1, "--project <name> is required"),
  file: z.string().min(1).optional(),
  repo: z.string().min(1, "--repo <key> is required"),
  line: z.string().min(1, "--line <name> is required"),
});
export type LineRmInput = z.infer<typeof lineRmInput>;

/** `yard env set --project <name> --repo <key> --line <name> --env <tag>` */
export const envSetInput = z.object({
  project: z.string().min(1, "--project <name> is required"),
  file: z.string().min(1).optional(),
  repo: z.string().min(1, "--repo <key> is required"),
  line: z.string().min(1, "--line <name> is required"),
  env: z.string().min(1, "--env <tag> is required"),
});
export type EnvSetInput = z.infer<typeof envSetInput>;

/** `yard dep add --project <name> --repo <key> --dep-repo <repo> --dep-line <line> [--dep-project <project>]` */
export const depAddInput = z.object({
  project: z.string().min(1, "--project <name> is required"),
  file: z.string().min(1).optional(),
  /** Repo key that depends on another. */
  repo: z.string().min(1, "--repo <key> is required"),
  depRepo: z.string().min(1, "--dep-repo <repo> is required"),
  depLine: z.string().min(1, "--dep-line <line> is required"),
  depProject: z.string().min(1).optional(),
});
export type DepAddInput = z.infer<typeof depAddInput>;

/** `yard dep rm --project <name> --repo <key> --dep-repo <repo> [--dep-project <project>]` */
export const depRmInput = z.object({
  project: z.string().min(1, "--project <name> is required"),
  file: z.string().min(1).optional(),
  repo: z.string().min(1, "--repo <key> is required"),
  depRepo: z.string().min(1, "--dep-repo <repo> is required"),
  depProject: z.string().min(1).optional(),
});
export type DepRmInput = z.infer<typeof depRmInput>;

/** `yard project sync [--project <name>] [--message <msg>]` */
export const projectSyncInput = z.object({
  /** Project dir basename. When omitted syncs all changes in the config repo. */
  project: z.string().min(1).optional(),
  /** Commit message. Defaults to "yard: project sync". */
  message: z.string().min(1).default("yard: project sync"),
  file: z.string().min(1).optional(),
});
export type ProjectSyncInput = z.infer<typeof projectSyncInput>;

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

/** Issue-state filter shared by `scope` and `deps`. */
export const issueStateEnum = z.enum(["open", "closed", "all"]);

/**
 * `yard scope <expr>` — resolve a scope expression to a deterministic,
 * sorted list of issues across the registry's repos.
 *
 * Expr grammar (exactly one form):
 *   - `prd:`            issues labelled `PRD`
 *   - `label:<name>`    issues with label <name>
 *   - `issue:<ref>`     a single issue; <ref> is `owner/repo#N` or `#N`
 *                       (bare `#N` needs --repo as the default repo)
 *   - `all`             every issue across registry repos
 */
export const scopeInput = z.object({
  /** The scope expression (see grammar above). */
  expr: z.string().min(1, "scope expression is required"),
  /** Registry file to read repos from (passed through to registry-read). */
  file: z.string().min(1).optional(),
  /** Project name to derive the registry file (passed to registry-read). */
  project: z.string().min(1).optional(),
  /** Default repo (`owner/name`) for a bare `issue:#N` expr. */
  repo: z.string().min(1).optional(),
  /** Issue state filter. Default "open". */
  state: issueStateEnum.default("open"),
});
export type ScopeInput = z.infer<typeof scopeInput>;

/**
 * `yard deps --scope <expr>` — resolve a scope, parse each issue's
 * `## Blocked by` section, resolve each blocker's state in its own repo,
 * and return topo-ordered batches. Cycles fail loud, named.
 */
export const depsInput = z.object({
  /** Scope expression whose issues form the dependency graph. */
  expr: z.string().min(1, "scope expression is required"),
  file: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  state: issueStateEnum.default("open"),
});
export type DepsInput = z.infer<typeof depsInput>;

/**
 * `yard ensure <scope>` — deterministic, AI-free clone+checkout of exactly
 * the repos/lines a scope needs from the registry, into `{code}_{line}` dirs
 * (ADR 0006). Idempotent: present+correct clones are left untouched.
 *
 * Scope reading (ADR 0006 is silent on per-issue lines; issues carry no line
 * tag): a scope resolves to issues, each in a repo; ensure materialises EVERY
 * registry-declared line of each in-scope repo, plus the transitive `needs`
 * of those lines. This is what `doctor` reconciles against, so the two agree
 * by construction. Cited in handlers/ensure.ts.
 */
export const ensureInput = z.object({
  /** Scope expression (same grammar as `scope`/`deps`). */
  expr: z.string().min(1, "scope expression is required"),
  /** Registry file (passed through to registry-read). */
  file: z.string().min(1).optional(),
  /** Project name to derive the registry file + clone destination. */
  project: z.string().min(1, "--project <name> is required"),
  /** Profile name -> `~/.yard/profile.<name>.yml`; gives the path root. */
  profile: z.string().min(1, "--profile <name> is required"),
  /** Default repo (`owner/name`) for a bare `issue:#N` expr. */
  repo: z.string().min(1).optional(),
  /** Issue state filter for scope resolution. Default "open". */
  state: issueStateEnum.default("open"),
  /**
   * Re-clone a present-but-drifted line dir (wrong remote/branch) instead of
   * only reporting it. Off by default: ensure never destroys a divergent
   * working tree silently (ADR 0006: "never silently diverges").
   */
  force: z.boolean().default(false),
});
export type EnsureInput = z.infer<typeof ensureInput>;

/**
 * `yard doctor` — reconcile registry (intent) vs filesystem (reality) for a
 * project, report drift, never silently diverge (ADR 0006). Report-only by
 * default; `--fix` re-clones missing/drifted line dirs.
 */
export const doctorInput = z.object({
  /** Registry file (passed through to registry-read). */
  file: z.string().min(1).optional(),
  /** Project name to derive the registry file + clone destination. */
  project: z.string().min(1, "--project <name> is required"),
  /** Profile name -> `~/.yard/profile.<name>.yml`; gives the path root. */
  profile: z.string().min(1, "--profile <name> is required"),
  /** When true, re-clone missing/drifted line dirs. Off = report only. */
  fix: z.boolean().default(false),
});
export type DoctorInput = z.infer<typeof doctorInput>;
