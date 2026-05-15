/**
 * Registry mutator handlers — the ONLY writers of per-project registry YAML
 * (ADR 0006).
 *
 * Every public function here is the single code path that may change a
 * `yard-config/projects/<project>.yml` file. Hand-editing those files is
 * explicitly forbidden (ADR 0006 operational rules): only `yard` writes the
 * registry, deterministically, so diffs and merges stay clean. The
 * deterministic writer is `emitYaml()` from `yaml.ts` (stable key order,
 * canonical formatting, never wraps lines).
 *
 * All mutators share the same pipeline:
 *   1. Read the current file (or initialise an empty skeleton for `project add`).
 *   2. Parse + validate via `registrySchema` (strict — unknown keys are rejected
 *      immediately, never persisted, so no accidental secret sync is possible).
 *   3. Apply the in-memory mutation.
 *   4. Re-validate the mutated model.
 *   5. `emitYaml()` → atomic `writeFile()`.
 *
 * Idempotency rule (consistent across all mutators):
 *   - Same key + same value → silent no-op; the file is NOT rewritten so git
 *     sees no diff (no spurious noise).
 *   - Same key + different value → hard error with an actionable message.
 *     There is no `update` mutator; callers must `rm` then `add` to change a
 *     value.
 *   - `rm` of an absent thing → silent no-op.
 */
import { parse as parseYaml } from "yaml";
import { join } from "node:path";
import type { Adapter } from "../adapter.ts";
import { OUTPUT_VERSION } from "../schema.ts";
import type {
  ProjectAddInput,
  RepoAddInput,
  LineAddInput,
  LineRmInput,
  EnvSetInput,
  DepAddInput,
  DepRmInput,
  ProjectSyncInput,
} from "../schema.ts";
import {
  registrySchema,
  type Registry,
  type Line,
  type Need,
} from "../schemas/registry.ts";
import { emitYaml, type Json } from "../yaml.ts";

// ── Shared result shape ──────────────────────────────────────────────────────

export interface MutateResult {
  version: number;
  command: string;
  file: string;
  /** True when the file was actually written (false = no-op). */
  changed: boolean;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Derive the default registry file path from project name and home dir. */
export function defaultRegistryFile(home: string, project: string): string {
  return join(home, ".yard", "config", "projects", `${project}.yml`);
}

/** Read, parse, and validate a registry file. Returns the parsed Registry. */
async function readRegistry(path: string, adapter: Adapter): Promise<Registry> {
  if (!(await adapter.pathExists(path))) {
    throw new Error(
      `registry file not found: ${path} — run \`yard project add\` first`,
    );
  }
  let raw: string;
  try {
    raw = await adapter.readFile(path);
  } catch (err) {
    throw new Error(
      `cannot read registry ${path}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (err) {
    throw new Error(
      `malformed YAML in ${path}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
  const parsed = registrySchema.safeParse(doc);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`invalid registry ${path}: ${detail}`);
  }
  return parsed.data;
}

/**
 * Validate the mutated registry (belt-and-suspenders: nothing invalid hits
 * disk), then atomically write via `emitYaml()`.
 */
async function writeRegistry(
  path: string,
  registry: Registry,
  adapter: Adapter,
): Promise<void> {
  // Re-validate before writing — invariant: only valid YAML reaches disk.
  const check = registrySchema.safeParse(registry);
  if (!check.success) {
    const detail = check.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`[internal] mutated registry failed validation: ${detail}`);
  }
  await adapter.writeFile(path, emitYaml(registry as unknown as Json));
}

/** Resolve the registry file path from input. */
function resolveFile(
  input: { project?: string | undefined; file?: string | undefined },
  home: string,
): string {
  if (input.file) return input.file;
  if (input.project) return defaultRegistryFile(home, input.project);
  throw new Error("either --file or --project is required");
}

// ── `yard project add` ───────────────────────────────────────────────────────

export interface ProjectAddResult extends MutateResult {
  command: "project-add";
}

/**
 * Initialise a new empty project registry file.
 *
 * Idempotent: if the file already exists this is a no-op (the content is
 * validated but not changed). Only use this to bootstrap a new project entry;
 * add repos with `yard repo add`.
 */
export async function projectAdd(
  input: ProjectAddInput,
  adapter: Adapter,
): Promise<ProjectAddResult> {
  const file = resolveFile(input, adapter.homeDir());

  if (await adapter.pathExists(file)) {
    // Already exists — validate it and return no-op.
    await readRegistry(file, adapter);
    return { version: OUTPUT_VERSION, command: "project-add", file, changed: false };
  }

  const empty: Registry = { repos: {} };
  await writeRegistry(file, empty, adapter);
  return { version: OUTPUT_VERSION, command: "project-add", file, changed: true };
}

// ── `yard repo add` ──────────────────────────────────────────────────────────

export interface RepoAddResult extends MutateResult {
  command: "repo-add";
}

/**
 * Add a repo entry to the project registry.
 *
 * Idempotent: if the key exists with identical values it is a no-op.
 * If it exists with different values (code/url conflict) an error is thrown —
 * use `rm` + `add` semantics to change a value.
 */
export async function repoAdd(
  input: RepoAddInput,
  adapter: Adapter,
): Promise<RepoAddResult> {
  const file = resolveFile(input, adapter.homeDir());
  const registry = await readRegistry(file, adapter);

  const existing = registry.repos[input.key];
  if (existing) {
    // Check idempotency: same code + url + initial line?
    const lineEntry = existing.lines[input.line];
    const sameCode = existing.code === input.code;
    const sameUrl = existing.url === input.url;
    const sameLine =
      lineEntry !== undefined &&
      lineEntry.protected === input.protected &&
      (lineEntry.env ?? undefined) === (input.env ?? undefined);

    if (sameCode && sameUrl && sameLine) {
      return { version: OUTPUT_VERSION, command: "repo-add", file, changed: false };
    }
    throw new Error(
      `repo key "${input.key}" already exists in ${file} with different values; ` +
        `remove it first with \`yard repo rm\` before re-adding`,
    );
  }

  const newLine: Line = { protected: input.protected };
  if (input.env) newLine.env = input.env;

  registry.repos[input.key] = {
    code: input.code,
    url: input.url,
    lines: { [input.line]: newLine },
  };

  await writeRegistry(file, registry, adapter);
  return { version: OUTPUT_VERSION, command: "repo-add", file, changed: true };
}

// ── `yard line add` ──────────────────────────────────────────────────────────

export interface LineAddResult extends MutateResult {
  command: "line-add";
}

/**
 * Add a release line to a repo within the project registry.
 *
 * Idempotent: adding the same line with identical flags is a no-op.
 */
export async function lineAdd(
  input: LineAddInput,
  adapter: Adapter,
): Promise<LineAddResult> {
  const file = resolveFile(input, adapter.homeDir());
  const registry = await readRegistry(file, adapter);

  const repo = registry.repos[input.repo];
  if (!repo) {
    throw new Error(
      `repo "${input.repo}" not found in ${file} — add it first with \`yard repo add\``,
    );
  }

  const existing = repo.lines[input.line];
  if (existing) {
    const same =
      existing.protected === input.protected &&
      (existing.env ?? undefined) === (input.env ?? undefined);
    if (same) {
      return { version: OUTPUT_VERSION, command: "line-add", file, changed: false };
    }
    throw new Error(
      `line "${input.line}" already exists in repo "${input.repo}" with different values; ` +
        `remove it first with \`yard line rm\``,
    );
  }

  const newLine: Line = { protected: input.protected };
  if (input.env) newLine.env = input.env;
  repo.lines[input.line] = newLine;

  await writeRegistry(file, registry, adapter);
  return { version: OUTPUT_VERSION, command: "line-add", file, changed: true };
}

// ── `yard line rm` ───────────────────────────────────────────────────────────

export interface LineRmResult extends MutateResult {
  command: "line-rm";
}

/**
 * Remove a release line from a repo.
 *
 * Idempotent: removing an absent line is a no-op.
 * Refuses to remove a line that other repos in the same project depend on
 * (via `needs`), to preserve referential integrity.
 */
export async function lineRm(
  input: LineRmInput,
  adapter: Adapter,
): Promise<LineRmResult> {
  const file = resolveFile(input, adapter.homeDir());
  const registry = await readRegistry(file, adapter);

  const repo = registry.repos[input.repo];
  if (!repo) {
    throw new Error(`repo "${input.repo}" not found in ${file}`);
  }

  if (!repo.lines[input.line]) {
    // Already absent — no-op.
    return { version: OUTPUT_VERSION, command: "line-rm", file, changed: false };
  }

  // Referential integrity: refuse if another repo depends on this line.
  const danglingNeeds: string[] = [];
  for (const [repoKey, repoEntry] of Object.entries(registry.repos)) {
    if (!repoEntry.needs) continue;
    for (const need of repoEntry.needs) {
      if (
        need.repo === input.repo &&
        need.line === input.line &&
        need.project === undefined // only same-project needs
      ) {
        danglingNeeds.push(repoKey);
      }
    }
  }
  if (danglingNeeds.length > 0) {
    throw new Error(
      `cannot remove line "${input.line}" from repo "${input.repo}": ` +
        `the following repos depend on it: ${danglingNeeds.join(", ")}. ` +
        `Remove those deps first with \`yard dep rm\`.`,
    );
  }

  delete repo.lines[input.line];

  await writeRegistry(file, registry, adapter);
  return { version: OUTPUT_VERSION, command: "line-rm", file, changed: true };
}

// ── `yard env set` ───────────────────────────────────────────────────────────

export interface EnvSetResult extends MutateResult {
  command: "env-set";
}

/**
 * Set (or update) the `env` tag on a release line.
 *
 * Idempotent: setting the same env twice is a no-op. Unlike other mutators
 * this one allows updating in place (env is a mutable annotation, not an
 * identity key).
 */
export async function envSet(
  input: EnvSetInput,
  adapter: Adapter,
): Promise<EnvSetResult> {
  const file = resolveFile(input, adapter.homeDir());
  const registry = await readRegistry(file, adapter);

  const repo = registry.repos[input.repo];
  if (!repo) {
    throw new Error(`repo "${input.repo}" not found in ${file}`);
  }
  const line = repo.lines[input.line];
  if (!line) {
    throw new Error(
      `line "${input.line}" not found in repo "${input.repo}" in ${file}`,
    );
  }

  if (line.env === input.env) {
    return { version: OUTPUT_VERSION, command: "env-set", file, changed: false };
  }

  line.env = input.env;

  await writeRegistry(file, registry, adapter);
  return { version: OUTPUT_VERSION, command: "env-set", file, changed: true };
}

// ── `yard dep add` ───────────────────────────────────────────────────────────

export interface DepAddResult extends MutateResult {
  command: "dep-add";
}

/**
 * Add a source-code dependency (a `needs` entry) to a repo.
 *
 * Idempotent: adding the same dep twice is a no-op.
 */
export async function depAdd(
  input: DepAddInput,
  adapter: Adapter,
): Promise<DepAddResult> {
  const file = resolveFile(input, adapter.homeDir());
  const registry = await readRegistry(file, adapter);

  const repo = registry.repos[input.repo];
  if (!repo) {
    throw new Error(`repo "${input.repo}" not found in ${file}`);
  }

  // Check for exact duplicate.
  const needs: Need[] = repo.needs ?? [];
  const duplicate = needs.find(
    (n) =>
      n.repo === input.depRepo &&
      n.line === input.depLine &&
      (n.project ?? undefined) === (input.depProject ?? undefined),
  );
  if (duplicate) {
    return { version: OUTPUT_VERSION, command: "dep-add", file, changed: false };
  }

  const newNeed: Need = { repo: input.depRepo, line: input.depLine };
  if (input.depProject) newNeed.project = input.depProject;
  repo.needs = [...needs, newNeed];

  await writeRegistry(file, registry, adapter);
  return { version: OUTPUT_VERSION, command: "dep-add", file, changed: true };
}

// ── `yard dep rm` ────────────────────────────────────────────────────────────

export interface DepRmResult extends MutateResult {
  command: "dep-rm";
}

/**
 * Remove a source-code dependency from a repo.
 *
 * Idempotent: removing an absent dep is a no-op.
 */
export async function depRm(
  input: DepRmInput,
  adapter: Adapter,
): Promise<DepRmResult> {
  const file = resolveFile(input, adapter.homeDir());
  const registry = await readRegistry(file, adapter);

  const repo = registry.repos[input.repo];
  if (!repo) {
    throw new Error(`repo "${input.repo}" not found in ${file}`);
  }

  const needs: Need[] = repo.needs ?? [];
  const filtered = needs.filter(
    (n) =>
      !(
        n.repo === input.depRepo &&
        (n.project ?? undefined) === (input.depProject ?? undefined)
      ),
  );

  if (filtered.length === needs.length) {
    // Nothing removed — no-op.
    return { version: OUTPUT_VERSION, command: "dep-rm", file, changed: false };
  }

  repo.needs = filtered.length > 0 ? filtered : undefined;

  await writeRegistry(file, registry, adapter);
  return { version: OUTPUT_VERSION, command: "dep-rm", file, changed: true };
}

// ── `yard project sync` ──────────────────────────────────────────────────────

export interface ProjectSyncResult {
  version: number;
  command: "project-sync";
  configDir: string;
  /** True if a commit was made (false = working tree was already clean). */
  committed: boolean;
  message: string;
}

/**
 * Commit and push all pending changes in the `yard-config` repo.
 *
 * Idempotent: if the working tree is already clean (nothing to commit) no
 * commit or push is made. Uses `git status --porcelain` to detect cleanness.
 *
 * The config dir is `~/.yard/config/` (the standard clone location from
 * `yard init`; same as `configDirFor()` in init.ts).
 */
export async function projectSync(
  input: ProjectSyncInput,
  adapter: Adapter,
): Promise<ProjectSyncResult> {
  // Derive configDir from home — mirrors configDirFor() in init.ts.
  const home = adapter.homeDir();
  const configDir = join(home, ".yard", "config");

  if (!(await adapter.pathExists(configDir))) {
    throw new Error(
      `yard-config repo not found at ${configDir} — run \`yard init\` first`,
    );
  }

  // Detect dirty state via git status --porcelain (empty = clean).
  // We can't use runGit() directly since we need the output — use the adapter's
  // internal mechanism. Instead we read the porcelain status via a small helper.
  // The FakeAdapter records gitCalls; the GhAdapter shells out. Since the Adapter
  // interface only exposes runGit (void, throws on non-zero), we split the clean
  // check into a separate method ... but to keep the interface minimal we check
  // dirtiness by attempting the commit and catching the "nothing to commit" case.
  //
  // Approach: `git add -A`, then `git commit --allow-empty=false -m <msg>`.
  // If nothing was staged, git commit exits non-zero with "nothing to commit" text.
  // We detect that specific message to turn it into a clean no-op.
  //
  // For the FakeAdapter in tests: gitCalls is inspected; an optional `syncDirty`
  // flag controls whether we simulate a dirty or clean repo.

  await adapter.runGit(configDir, ["add", "-A"]);

  let committed = false;
  try {
    await adapter.runGit(configDir, ["commit", "-m", input.message]);
    committed = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // git exits 1 with "nothing to commit" when the tree is clean after `add -A`.
    if (/nothing to commit/i.test(msg) || /nothing added to commit/i.test(msg)) {
      committed = false;
    } else {
      throw err;
    }
  }

  if (committed) {
    await adapter.runGit(configDir, ["push"]);
  }

  return {
    version: OUTPUT_VERSION,
    command: "project-sync",
    configDir,
    committed,
    message: input.message,
  };
}
