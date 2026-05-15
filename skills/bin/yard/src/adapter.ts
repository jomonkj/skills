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

/** Aggregate CI status of a PR's checks (mirrors `gh pr checks`). */
export type CheckStatus = "pending" | "passing" | "failing" | "none";

/** A pull request as seen by `findPr` / `prState`. */
export interface GhPr {
  number: number;
  url: string;
  /** "OPEN" | "CLOSED" | "MERGED" */
  state: string;
  /** Head ref (branch). */
  headRefName: string;
}

/** A `git worktree list --porcelain` entry. */
export interface WorktreeEntry {
  /** Absolute worktree path. */
  path: string;
  /** Checked-out branch (refs/heads/… stripped to short name), or "" if detached. */
  branch: string;
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

  /**
   * Atomically add and/or remove labels on an issue in ONE `gh issue edit`
   * invocation. This is THE atomic label-move primitive (ADR 0003: "atomic
   * single-call label moves"): `gh issue edit N --add-label A --remove-label B`
   * is a single `UpdateIssue` GraphQL mutation, so a phase transition is never
   * observable as delete-then-add. Callers MUST NOT emulate a move with two
   * calls. No-op (no gh call) when both lists are empty.
   */
  editIssue(
    repo: string,
    number: number,
    change: { addLabels?: string[]; removeLabels?: string[] },
  ): Promise<void>;

  /**
   * When the given label was most recently applied to the issue, as epoch
   * milliseconds — read from the issue timeline's `labeled` events. Returns
   * `null` if the label is not currently/recently recorded. Used to compute
   * lease staleness (the `phase:implementing` label IS the lease; its apply
   * time drives the >2h reclaim, ADR 0007).
   */
  issueLabeledAt(
    repo: string,
    number: number,
    label: string,
  ): Promise<number | null>;

  /**
   * Find the PR whose head ref is `headBranch` in `repo`, or `null` if none.
   * (`gh pr list --head <branch> --json ...`.)
   */
  findPr(repo: string, headBranch: string): Promise<GhPr | null>;

  /** State of a single PR (OPEN/CLOSED/MERGED + head ref). */
  prState(repo: string, number: number): Promise<GhPr>;

  /**
   * Aggregate CI status of a PR's required checks (`gh pr checks`). "none"
   * means the repo has no checks configured for this PR (treated as CLEAN by
   * `ci-wait`, ADR 0007). "pending" means at least one check still running.
   */
  prChecks(repo: string, number: number): Promise<CheckStatus>;

  // --- worktree / branch boundary (ADR 0005: dispatch + sweep) ---

  /** `git -C <repoDir> worktree add <path> -b <branch> <base>` (or reuse). */
  addWorktree(
    repoDir: string,
    path: string,
    branch: string,
    base: string,
  ): Promise<void>;

  /** `git -C <repoDir> worktree remove --force <path>`. */
  removeWorktree(repoDir: string, path: string): Promise<void>;

  /** Parsed `git -C <repoDir> worktree list --porcelain`. */
  listWorktrees(repoDir: string): Promise<WorktreeEntry[]>;

  /**
   * `git -C <repoDir> branch -D <branch>` — local branch delete. The
   * protected-branch guard is enforced by the *handler* before this is ever
   * called; the adapter is the dumb effect.
   */
  deleteBranch(repoDir: string, branch: string): Promise<void>;

  /** Current wall-clock epoch ms. Injectable so lease/poll logic is testable. */
  now(): number;

  /** Sleep `ms`. Injectable so `ci-wait`'s bounded poll never hangs a test. */
  sleep(ms: number): Promise<void>;

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

  async editIssue(
    repo: string,
    number: number,
    change: { addLabels?: string[]; removeLabels?: string[] },
  ): Promise<void> {
    const add = change.addLabels ?? [];
    const remove = change.removeLabels ?? [];
    if (add.length === 0 && remove.length === 0) return;
    const args = ["gh", "issue", "edit", String(number), "--repo", repo];
    // ONE invocation = one UpdateIssue mutation = atomic (ADR 0003). Never
    // split into a remove call then an add call.
    for (const l of add) args.push("--add-label", l);
    for (const l of remove) args.push("--remove-label", l);
    const r = await run(args);
    if (r.code !== 0) {
      throw new Error(
        `gh issue edit ${number} failed for ${repo}: ${r.stderr.trim()}`,
      );
    }
  }

  async issueLabeledAt(
    repo: string,
    number: number,
    label: string,
  ): Promise<number | null> {
    // The timeline carries `labeled`/`unlabeled` events with timestamps.
    // gh's REST timeline pagination is bounded; 100 is ample for one issue's
    // phase churn and keeps the call deterministic.
    const r = await run([
      "gh",
      "api",
      "-H",
      "Accept: application/vnd.github+json",
      `repos/${repo}/issues/${number}/timeline?per_page=100`,
      "--paginate",
    ]);
    if (r.code !== 0) {
      throw new Error(
        `gh api timeline ${number} failed for ${repo}: ${r.stderr.trim()}`,
      );
    }
    let events: Array<{
      event?: string;
      label?: { name?: string };
      created_at?: string;
    }> = [];
    try {
      // `--paginate` may concatenate JSON arrays; tolerate both shapes.
      const txt = r.stdout.trim();
      const parts = txt.startsWith("[")
        ? (JSON.parse(`[${txt.replace(/\]\s*\[/g, "],[")}]`) as unknown[]).flat()
        : JSON.parse(txt);
      events = parts as typeof events;
    } catch {
      events = [];
    }
    let latest: number | null = null;
    for (const e of events) {
      if (e.event === "labeled" && e.label?.name === label && e.created_at) {
        const t = Date.parse(e.created_at);
        if (!Number.isNaN(t) && (latest === null || t > latest)) latest = t;
      }
    }
    return latest;
  }

  async findPr(repo: string, headBranch: string): Promise<GhPr | null> {
    const r = await run([
      "gh",
      "pr",
      "list",
      "--repo",
      repo,
      "--head",
      headBranch,
      "--state",
      "all",
      "--json",
      "number,url,state,headRefName",
      "--limit",
      "10",
    ]);
    if (r.code !== 0) {
      throw new Error(`gh pr list failed for ${repo}: ${r.stderr.trim()}`);
    }
    const arr = JSON.parse(r.stdout || "[]") as GhPr[];
    return arr[0] ?? null;
  }

  async prState(repo: string, number: number): Promise<GhPr> {
    const r = await run([
      "gh",
      "pr",
      "view",
      String(number),
      "--repo",
      repo,
      "--json",
      "number,url,state,headRefName",
    ]);
    if (r.code !== 0) {
      throw new Error(
        `gh pr view ${number} failed for ${repo}: ${r.stderr.trim()}`,
      );
    }
    return JSON.parse(r.stdout) as GhPr;
  }

  async prChecks(repo: string, number: number): Promise<CheckStatus> {
    const r = await run([
      "gh",
      "pr",
      "checks",
      String(number),
      "--repo",
      repo,
      "--json",
      "state,bucket",
    ]);
    // gh pr checks exits 8 when there are no checks at all.
    if (r.code === 8 || /no checks reported/i.test(r.stderr)) return "none";
    let rows: Array<{ state?: string; bucket?: string }> = [];
    try {
      rows = JSON.parse(r.stdout || "[]");
    } catch {
      rows = [];
    }
    if (rows.length === 0) return "none";
    let anyPending = false;
    let anyFail = false;
    for (const row of rows) {
      const b = (row.bucket ?? row.state ?? "").toLowerCase();
      if (b === "fail" || b === "failure" || b === "cancel" || b === "timed_out")
        anyFail = true;
      else if (b === "pending" || b === "" ) anyPending = true;
    }
    if (anyFail) return "failing";
    if (anyPending) return "pending";
    return "passing";
  }

  async addWorktree(
    repoDir: string,
    path: string,
    branch: string,
    base: string,
  ): Promise<void> {
    const r = await run([
      "git",
      "-C",
      repoDir,
      "worktree",
      "add",
      path,
      "-b",
      branch,
      base,
    ]);
    if (r.code !== 0) {
      throw new Error(
        `git worktree add ${path} (${branch}) failed: ${r.stderr.trim() || r.stdout.trim()}`,
      );
    }
  }

  async removeWorktree(repoDir: string, path: string): Promise<void> {
    const r = await run([
      "git",
      "-C",
      repoDir,
      "worktree",
      "remove",
      "--force",
      path,
    ]);
    if (r.code !== 0) {
      throw new Error(
        `git worktree remove ${path} failed: ${r.stderr.trim() || r.stdout.trim()}`,
      );
    }
  }

  async listWorktrees(repoDir: string): Promise<WorktreeEntry[]> {
    const r = await run([
      "git",
      "-C",
      repoDir,
      "worktree",
      "list",
      "--porcelain",
    ]);
    if (r.code !== 0) return [];
    const out: WorktreeEntry[] = [];
    let cur: Partial<WorktreeEntry> = {};
    for (const line of r.stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (cur.path !== undefined)
          out.push({ path: cur.path, branch: cur.branch ?? "" });
        cur = { path: line.slice("worktree ".length).trim(), branch: "" };
      } else if (line.startsWith("branch ")) {
        cur.branch = line
          .slice("branch ".length)
          .trim()
          .replace(/^refs\/heads\//, "");
      } else if (line === "" && cur.path !== undefined) {
        out.push({ path: cur.path, branch: cur.branch ?? "" });
        cur = {};
      }
    }
    if (cur.path !== undefined)
      out.push({ path: cur.path, branch: cur.branch ?? "" });
    return out;
  }

  async deleteBranch(repoDir: string, branch: string): Promise<void> {
    const r = await run(["git", "-C", repoDir, "branch", "-D", branch]);
    if (r.code !== 0) {
      throw new Error(
        `git branch -D ${branch} failed: ${r.stderr.trim() || r.stdout.trim()}`,
      );
    }
  }

  now(): number {
    return Date.now();
  }

  sleep(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms));
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
