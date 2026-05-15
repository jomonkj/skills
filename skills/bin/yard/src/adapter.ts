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
import { readFile, readdir, stat, writeFile, rename, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";

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

/** A GitHub issue. `createIssue` populates only `number`/`url`; the richer
 *  fields are filled by `listIssues`/`getIssue` (scope/deps need them). */
export interface GhIssue {
  number: number;
  url: string;
  /** Present for list/get; "" for the create return. */
  title?: string;
  /** "OPEN" | "CLOSED" (as `gh` returns `state`). Present for list/get. */
  state?: string;
  /** Label names. Present for list/get. */
  labels?: string[];
  /** Issue body markdown. Present for list/get (needed by the Blocked-by
   *  parser); may be "" when not requested. */
  body?: string;
}

/** Issue-state filter for `listIssues` (mirrors `gh issue list --state`). */
export type IssueState = "open" | "closed" | "all";

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
  /** Create an issue and return its number + URL. */
  createIssue(
    repo: string,
    issue: { title: string; body: string; labels: string[] },
  ): Promise<GhIssue>;
  /**
   * List issues in a repo (scope). `state` defaults to "open" at the gh
   * boundary if omitted. `labels` is an AND filter (gh `--label` semantics).
   * Returns issues with title/state/labels/body populated.
   */
  listIssues(
    repo: string,
    opts: { labels?: string[]; state?: IssueState },
  ): Promise<GhIssue[]>;
  /** Fetch one issue by number (deps: resolve a blocker's state in its own
   *  repo). title/state/labels/body populated. */
  getIssue(repo: string, number: number): Promise<GhIssue>;

  // --- git / filesystem boundary (ADR 0006: registry + init) ---

  /** `git clone <url> <dir>`. Throws with a clear message on failure. */
  cloneRepo(url: string, dir: string): Promise<void>;
  /** Read a UTF-8 file. Throws if absent (caller turns this into a clear error). */
  readFile(path: string): Promise<string>;
  /** True if a path (file or dir) exists. */
  pathExists(path: string): Promise<boolean>;
  /** Names (not full paths) of entries in a directory. Empty if absent. */
  listFiles(dir: string): Promise<string[]>;
  /** The current user's home dir — so `~/.yard/...` is mockable in tests. */
  homeDir(): string;

  /**
   * Atomically write `content` to `path` (tmp file + rename so no half-writes).
   * Creates parent directories as needed.
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * Run a git command in `dir` (e.g. `["add", "-A"]`).
   * Throws with a clear message if the command exits non-zero.
   */
  runGit(dir: string, args: string[]): Promise<void>;

  /**
   * Run a git command in `dir` and return its captured result WITHOUT
   * throwing on a non-zero exit. Needed by `ensure`/`doctor` to inspect an
   * existing clone (its remote URL, current branch) so they can decide
   * "present + correct" vs drift — a void/throwing `runGit` cannot answer
   * that question (ADR 0006: idempotent ensure, doctor reconciles drift).
   */
  runGitCapture(dir: string, args: string[]): Promise<ExecResult>;
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

  async createIssue(
    repo: string,
    issue: { title: string; body: string; labels: string[] },
  ): Promise<GhIssue> {
    const args = [
      "gh",
      "issue",
      "create",
      "--repo",
      repo,
      "--title",
      issue.title,
      "--body",
      issue.body,
    ];
    for (const label of issue.labels) {
      args.push("--label", label);
    }
    const r = await run(args);
    if (r.code !== 0) {
      throw new Error(`gh issue create failed for ${repo}: ${r.stderr.trim()}`);
    }
    // gh issue create outputs the issue URL on stdout.
    const url = r.stdout.trim();
    const match = url.match(/\/issues\/(\d+)$/);
    if (!match) {
      throw new Error(`unexpected gh issue create output: ${url}`);
    }
    return { number: parseInt(match[1]!, 10), url };
  }

  async listIssues(
    repo: string,
    opts: { labels?: string[]; state?: IssueState },
  ): Promise<GhIssue[]> {
    const args = [
      "gh",
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      opts.state ?? "open",
      // Hard cap — `gh issue list` paginates; 1000 is plenty for a slice
      // graph and keeps the call bounded/deterministic.
      "--limit",
      "1000",
      "--json",
      "number,title,state,labels,body,url",
    ];
    for (const label of opts.labels ?? []) {
      args.push("--label", label);
    }
    const r = await run(args);
    if (r.code !== 0) {
      throw new Error(`gh issue list failed for ${repo}: ${r.stderr.trim()}`);
    }
    const raw = JSON.parse(r.stdout || "[]") as Array<{
      number: number;
      title: string;
      state: string;
      labels: Array<{ name: string }>;
      body: string;
      url: string;
    }>;
    return raw.map((i) => ({
      number: i.number,
      url: i.url,
      title: i.title,
      state: i.state,
      labels: i.labels.map((l) => l.name),
      body: i.body ?? "",
    }));
  }

  async getIssue(repo: string, number: number): Promise<GhIssue> {
    const r = await run([
      "gh",
      "issue",
      "view",
      String(number),
      "--repo",
      repo,
      "--json",
      "number,title,state,labels,body,url",
    ]);
    if (r.code !== 0) {
      throw new Error(
        `gh issue view ${number} failed for ${repo}: ${r.stderr.trim()}`,
      );
    }
    const i = JSON.parse(r.stdout) as {
      number: number;
      title: string;
      state: string;
      labels: Array<{ name: string }>;
      body: string;
      url: string;
    };
    return {
      number: i.number,
      url: i.url,
      title: i.title,
      state: i.state,
      labels: i.labels.map((l) => l.name),
      body: i.body ?? "",
    };
  }

  async cloneRepo(url: string, dir: string): Promise<void> {
    const r = await run(["git", "clone", url, dir]);
    if (r.code !== 0) {
      throw new Error(
        `git clone ${url} -> ${dir} failed: ${r.stderr.trim() || r.stdout.trim()}`,
      );
    }
  }

  async readFile(path: string): Promise<string> {
    return readFile(path, "utf8");
  }

  async pathExists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async listFiles(dir: string): Promise<string[]> {
    try {
      return (await readdir(dir)).sort();
    } catch {
      return [];
    }
  }

  homeDir(): string {
    return homedir();
  }

  async writeFile(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    // Atomic: write to a tmp file then rename so readers never see a partial.
    const tmp = path + ".yard-tmp-" + process.pid;
    try {
      await writeFile(tmp, content, "utf8");
      await rename(tmp, path);
    } catch (err) {
      // Best-effort cleanup.
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(tmp);
      } catch {}
      throw err;
    }
  }

  async runGit(dir: string, args: string[]): Promise<void> {
    const r = await run(["git", "-C", dir, ...args]);
    if (r.code !== 0) {
      throw new Error(
        `git -C ${dir} ${args.join(" ")} failed: ${r.stderr.trim() || r.stdout.trim()}`,
      );
    }
  }

  async runGitCapture(dir: string, args: string[]): Promise<ExecResult> {
    return run(["git", "-C", dir, ...args]);
  }
}
