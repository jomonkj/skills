/**
 * `doctor` handler — pure core, ZERO AI (ADR 0003 / ADR 0006).
 *
 * `yard doctor` reconciles the registry (intent) against the filesystem
 * (reality) for one project: the registry says which repos/lines should
 * exist and where; the filesystem says what is actually on disk. On any
 * disagreement it REPORTS, and never silently diverges (ADR 0006). It is
 * report-only by default; `--fix` re-clones the missing/drifted dirs.
 *
 * Drift kinds reported:
 *   - missing      registry declares a line dir that is absent on disk
 *   - drift-remote a line dir exists but its `origin` URL is wrong / absent
 *   - drift-branch a line dir exists but is on the wrong line/branch
 *   - extra        a `{code}_{line}` dir on disk the registry does not declare
 *
 * Nothing here calls an LLM — only the git/fs adapter and the registry
 * reader. The reconcile target is exactly what `ensure` materialises (every
 * registry-declared line of every registry repo for the project), so the two
 * agree by construction.
 */
import { join } from "node:path";
import type { Adapter } from "../adapter.ts";
import { OUTPUT_VERSION, type DoctorInput } from "../schema.ts";
import { profileSchema } from "../schemas/profile.ts";
import { repoKeyToDir } from "../schemas/registry.ts";
import { registryRead } from "./registry-read.ts";
import { profileFileFor } from "./init.ts";
import { parse as parseYaml } from "yaml";

export type DriftKind =
  | "missing"
  | "drift-remote"
  | "drift-branch"
  | "extra";

export interface DriftItem {
  kind: DriftKind;
  /** Dotted registry key (empty for an `extra` dir with no registry match). */
  repoKey: string;
  /** Release line (best-effort parsed from the dir name for `extra`). */
  line: string;
  /** Absolute dir the drift concerns. */
  dir: string;
  /** Human-readable explanation, always actionable. */
  detail: string;
  /** True when `--fix` re-cloned/repaired this item. */
  fixed: boolean;
}

export interface DoctorResult {
  version: number;
  command: "doctor";
  project: string;
  root: string;
  /** Drift items, sorted (kind, repoKey, line) — byte-stable across runs. */
  drift: DriftItem[];
  /** Count of registry-declared line dirs that were present + correct. */
  ok: number;
  /** Whether `--fix` was applied. */
  fixed: boolean;
}

export async function doctor(
  input: DoctorInput,
  adapter: Adapter,
): Promise<DoctorResult> {
  const home = adapter.homeDir();

  // Profile -> path root (machine-local; ADR 0006).
  const profileFile = profileFileFor(home, input.profile);
  if (!(await adapter.pathExists(profileFile))) {
    throw new Error(
      `profile not found: ${profileFile} — create it (machine-local, not synced) before \`yard doctor\``,
    );
  }
  const parsedProfile = profileSchema.safeParse(
    parseYaml(await adapter.readFile(profileFile)),
  );
  if (!parsedProfile.success) {
    const detail = parsedProfile.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`invalid profile ${profileFile}: ${detail}`);
  }
  const root = parsedProfile.data.root;

  const reg = await registryRead(
    { file: input.file, project: input.project },
    adapter,
  );
  const registry = reg.registry;

  const drift: DriftItem[] = [];
  let ok = 0;

  // 1. registry -> filesystem: every declared line dir should exist & match.
  //    Track which dirs the registry "owns" so we can flag extras after.
  const declaredDirNames = new Map<string, Set<string>>(); // repoDir -> {dirName}
  for (const repoKey of Object.keys(registry.repos)) {
    const repo = registry.repos[repoKey]!;
    const repoDir = repoKeyToDir(repoKey);
    const dirSet = declaredDirNames.get(repoDir) ?? new Set<string>();
    declaredDirNames.set(repoDir, dirSet);
    for (const line of Object.keys(repo.lines)) {
      const dirName = `${repo.code}_${line}`;
      dirSet.add(dirName);
      const dir = join(root, input.project, repoDir, dirName);

      if (!(await adapter.pathExists(dir))) {
        const item: DriftItem = {
          kind: "missing",
          repoKey,
          line,
          dir,
          detail: `registry declares ${repoKey}@${line} but ${dir} is absent`,
          fixed: false,
        };
        if (input.fix) {
          await adapter.cloneRepo(repo.url, dir);
          await adapter.runGit(dir, ["checkout", line]);
          item.fixed = true;
        }
        drift.push(item);
        continue;
      }

      const remote = await adapter.runGitCapture(dir, [
        "remote",
        "get-url",
        "origin",
      ]);
      if (remote.code !== 0 || remote.stdout.trim() !== repo.url.trim()) {
        const item: DriftItem = {
          kind: "drift-remote",
          repoKey,
          line,
          dir,
          detail:
            remote.code !== 0
              ? `${dir} exists but is not a git repo / has no origin (registry: ${repo.url})`
              : `${dir} origin is ${JSON.stringify(
                  remote.stdout.trim(),
                )}, registry expects ${JSON.stringify(repo.url)}`,
          fixed: false,
        };
        if (input.fix) {
          await adapter.runGit(dir, ["remote", "set-url", "origin", repo.url]);
          await adapter.runGit(dir, ["fetch", "origin"]);
          await adapter.runGit(dir, ["checkout", line]);
          item.fixed = true;
        }
        drift.push(item);
        continue;
      }

      const branch = await adapter.runGitCapture(dir, [
        "branch",
        "--show-current",
      ]);
      if (branch.code !== 0 || branch.stdout.trim() !== line) {
        const item: DriftItem = {
          kind: "drift-branch",
          repoKey,
          line,
          dir,
          detail: `${dir} is on ${JSON.stringify(
            branch.stdout.trim(),
          )}, registry expects line ${JSON.stringify(line)}`,
          fixed: false,
        };
        if (input.fix) {
          await adapter.runGit(dir, ["fetch", "origin"]);
          await adapter.runGit(dir, ["checkout", line]);
          item.fixed = true;
        }
        drift.push(item);
        continue;
      }

      ok++;
    }
  }

  // 2. filesystem -> registry: any `{code}_{line}` dir not declared = extra.
  //    Walk only repo dirs the registry knows; an unknown extra repo dir is
  //    out of scope (registry is per-repo intent, not "own the whole tree").
  for (const [repoDir, dirSet] of declaredDirNames) {
    const parent = join(root, input.project, repoDir);
    const entries = await adapter.listFiles(parent);
    for (const name of entries) {
      if (dirSet.has(name)) continue;
      // Only flag things shaped like a line clone dir (`<code>_<line>`),
      // so unrelated files/dirs do not produce noise.
      const us = name.indexOf("_");
      if (us <= 0 || us === name.length - 1) continue;
      drift.push({
        kind: "extra",
        repoKey: "",
        line: name.slice(us + 1),
        dir: join(parent, name),
        detail:
          `${join(parent, name)} exists on disk but the registry declares ` +
          `no such line for ${repoDir} — re-run after a registry edit, or ` +
          `remove it manually (doctor never deletes)`,
        fixed: false,
      });
    }
  }

  const rank: Record<DriftKind, number> = {
    missing: 0,
    "drift-remote": 1,
    "drift-branch": 2,
    extra: 3,
  };
  drift.sort((a, b) =>
    a.kind !== b.kind
      ? rank[a.kind] - rank[b.kind]
      : a.repoKey !== b.repoKey
        ? a.repoKey < b.repoKey
          ? -1
          : 1
        : a.line < b.line
          ? -1
          : a.line > b.line
            ? 1
            : 0,
  );

  return {
    version: OUTPUT_VERSION,
    command: "doctor",
    project: input.project,
    root,
    drift,
    ok,
    fixed: input.fix,
  };
}
