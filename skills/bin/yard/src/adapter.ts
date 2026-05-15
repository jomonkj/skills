/**
 * The gh/git adapter boundary.
 *
 * ADR 0003: every external effect (`gh`, `git`, network) goes through this
 * interface. Handlers receive an `Adapter` and NEVER spawn a process directly,
 * so the whole handler core is unit-testable with a fake adapter at zero
 * network / zero token cost.
 *
 * Hard rule: nothing in this file (or anywhere in yard) calls an LLM. Only
 * `git`, `gh`, filesystem, JSON/YAML.
 */

export interface ExecResult {
  /** Process exit code. 0 = success. */
  code: number;
  stdout: string;
  stderr: string;
}

/** A GitHub label as returned by `gh label list --json`. */
export interface GhLabel {
  name: string;
  /** 6-hex, no leading `#`, as `gh` returns it. */
  color: string;
  description: string;
}

export interface Adapter {
  /** List labels in a repo. `repo` is `owner/name`. */
  listLabels(repo: string): Promise<GhLabel[]>;
  /** Create a label. Rejects only on unexpected failure. */
  createLabel(
    repo: string,
    label: { name: string; color: string; description: string },
  ): Promise<void>;
  /** Edit an existing label's color/description (idempotent drift repair). */
  editLabel(
    repo: string,
    label: { name: string; color: string; description: string },
  ): Promise<void>;
}

/** Run a subprocess and capture its result. The only place yard shells out. */
export async function run(
  cmd: string[],
  opts: { input?: string } = {},
): Promise<ExecResult> {
  const proc = Bun.spawn(cmd, {
    stdin: opts.input ? new TextEncoder().encode(opts.input) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/** Production adapter: real `gh` calls. */
export class GhAdapter implements Adapter {
  async listLabels(repo: string): Promise<GhLabel[]> {
    const r = await run([
      "gh",
      "label",
      "list",
      "--repo",
      repo,
      "--limit",
      "200",
      "--json",
      "name,color,description",
    ]);
    if (r.code !== 0) {
      throw new Error(`gh label list failed for ${repo}: ${r.stderr.trim()}`);
    }
    const parsed = JSON.parse(r.stdout || "[]") as GhLabel[];
    return parsed;
  }

  async createLabel(
    repo: string,
    label: { name: string; color: string; description: string },
  ): Promise<void> {
    const r = await run([
      "gh",
      "label",
      "create",
      label.name,
      "--repo",
      repo,
      "--color",
      label.color,
      "--description",
      label.description,
    ]);
    if (r.code !== 0) {
      // "already exists" can race with a concurrent run — treat as benign.
      if (/already exists/i.test(r.stderr)) return;
      throw new Error(
        `gh label create ${label.name} failed for ${repo}: ${r.stderr.trim()}`,
      );
    }
  }

  async editLabel(
    repo: string,
    label: { name: string; color: string; description: string },
  ): Promise<void> {
    const r = await run([
      "gh",
      "label",
      "edit",
      label.name,
      "--repo",
      repo,
      "--color",
      label.color,
      "--description",
      label.description,
    ]);
    if (r.code !== 0) {
      throw new Error(
        `gh label edit ${label.name} failed for ${repo}: ${r.stderr.trim()}`,
      );
    }
  }
}
