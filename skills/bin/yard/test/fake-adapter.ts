/**
 * In-memory fake of the gh/git/fs Adapter for zero-network, zero-token tests
 * (ADR 0003). Records every mutation so tests can assert idempotency.
 *
 * The filesystem is a flat `Map<absPath, content>`; a "directory" exists when
 * any file path is nested under it. `cloneRepo` is simulated by a callback the
 * test supplies (it seeds files under the clone dir), so `init` is fully
 * testable without git or the network.
 *
 * `writeFile` updates `this.files` in place — tests read back via `files.get()`.
 * `runGit` records every call to `gitCalls[]` — tests can assert the exact git
 * operations without shelling out.
 */
import type {
  Adapter,
  ExecResult,
  GhIssue,
  GhLabel,
  IssueState,
} from "../src/adapter.ts";

/** A seeded issue for scope/deps tests. */
export interface SeedIssue {
  number: number;
  title: string;
  /** "OPEN" | "CLOSED" */
  state: string;
  labels: string[];
  body: string;
}

export class FakeAdapter implements Adapter {
  labels: Map<string, GhLabel>;
  createCalls: { repo: string; label: GhLabel }[] = [];
  editCalls: { repo: string; label: GhLabel }[] = [];
  issueCalls: { repo: string; issue: { title: string; body: string; labels: string[] } }[] = [];
  private _nextIssueNumber = 1;

  /** Seeded issues per repo (`owner/name` -> issues). */
  issues = new Map<string, SeedIssue[]>();
  /** Repos whose gh calls should throw (partial-failure isolation tests). */
  failingRepos = new Set<string>();
  listCalls: { repo: string; opts: { labels?: string[]; state?: IssueState } }[] =
    [];
  getCalls: { repo: string; number: number }[] = [];

  /** Flat in-memory FS: absolute path -> file contents. */
  files = new Map<string, string>();
  cloneCalls: { url: string; dir: string }[] = [];
  /** Test hook: called on cloneRepo to seed files under `dir`. */
  onClone?: (url: string, dir: string, fa: FakeAdapter) => void;
  home = "/home/test";

  /** Records all `runGit` calls in order. */
  gitCalls: { dir: string; args: string[] }[] = [];
  /** Records all `runGitCapture` calls in order. */
  gitCaptureCalls: { dir: string; args: string[] }[] = [];

  /**
   * Per-clone-dir simulated git state, used by `runGitCapture` so tests can
   * drive ensure-idempotency and doctor-drift without a real repo:
   *   `origin remote URL`  -> remote.origin.url
   *   `current branch`     -> branch --show-current
   * A dir absent here means "not a git repo" (capture returns code 128).
   */
  gitState = new Map<string, { remote: string; branch: string }>();

  /** Test helper: declare an existing clone's remote URL + current branch. */
  setGitState(dir: string, remote: string, branch: string): void {
    this.gitState.set(dir, { remote, branch });
  }

  constructor(initial: GhLabel[] = []) {
    this.labels = new Map(initial.map((l) => [l.name, { ...l }]));
  }

  // --- in-memory fs helpers for tests ---
  setFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  async listLabels(_repo: string): Promise<GhLabel[]> {
    return [...this.labels.values()].map((l) => ({ ...l }));
  }

  async createLabel(
    repo: string,
    label: { name: string; color: string; description: string },
  ): Promise<void> {
    this.createCalls.push({ repo, label: { ...label } });
    this.labels.set(label.name, { ...label });
  }

  async editLabel(
    repo: string,
    label: { name: string; color: string; description: string },
  ): Promise<void> {
    this.editCalls.push({ repo, label: { ...label } });
    this.labels.set(label.name, { ...label });
  }

  async createIssue(
    repo: string,
    issue: { title: string; body: string; labels: string[] },
  ): Promise<GhIssue> {
    this.issueCalls.push({ repo, issue: { ...issue } });
    const number = this._nextIssueNumber++;
    return { number, url: `https://github.com/${repo}/issues/${number}` };
  }

  /** Test helper: seed one repo's issues. */
  seedIssues(repo: string, issues: SeedIssue[]): void {
    this.issues.set(repo, issues);
  }

  async listIssues(
    repo: string,
    opts: { labels?: string[]; state?: IssueState },
  ): Promise<GhIssue[]> {
    this.listCalls.push({ repo, opts });
    if (this.failingRepos.has(repo)) {
      throw new Error(`gh issue list failed for ${repo}: simulated failure`);
    }
    const all = this.issues.get(repo) ?? [];
    const state = opts.state ?? "open";
    const wantLabels = opts.labels ?? [];
    const filtered = all.filter((i) => {
      if (state === "open" && i.state !== "OPEN") return false;
      if (state === "closed" && i.state !== "CLOSED") return false;
      // AND semantics, matching gh `--label`.
      for (const l of wantLabels) {
        if (!i.labels.includes(l)) return false;
      }
      return true;
    });
    return filtered.map((i) => ({
      number: i.number,
      url: `https://github.com/${repo}/issues/${i.number}`,
      title: i.title,
      state: i.state,
      labels: [...i.labels],
      body: i.body,
    }));
  }

  async getIssue(repo: string, number: number): Promise<GhIssue> {
    this.getCalls.push({ repo, number });
    if (this.failingRepos.has(repo)) {
      throw new Error(
        `gh issue view ${number} failed for ${repo}: simulated failure`,
      );
    }
    const all = this.issues.get(repo) ?? [];
    const found = all.find((i) => i.number === number);
    if (!found) {
      throw new Error(`gh issue view ${number} failed for ${repo}: not found`);
    }
    return {
      number: found.number,
      url: `https://github.com/${repo}/issues/${found.number}`,
      title: found.title,
      state: found.state,
      labels: [...found.labels],
      body: found.body,
    };
  }

  async cloneRepo(url: string, dir: string): Promise<void> {
    this.cloneCalls.push({ url, dir });
    this.onClone?.(url, dir, this);
  }

  async readFile(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) {
      throw new Error(`ENOENT: no such file ${path}`);
    }
    return v;
  }

  async pathExists(path: string): Promise<boolean> {
    if (this.files.has(path)) return true;
    const prefix = path.endsWith("/") ? path : path + "/";
    for (const k of this.files.keys()) {
      if (k.startsWith(prefix)) return true;
    }
    return false;
  }

  async listFiles(dir: string): Promise<string[]> {
    const prefix = dir.endsWith("/") ? dir : dir + "/";
    const names = new Set<string>();
    for (const k of this.files.keys()) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      const seg = rest.split("/")[0];
      if (seg) names.add(seg);
    }
    return [...names].sort();
  }

  homeDir(): string {
    return this.home;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async runGit(dir: string, args: string[]): Promise<void> {
    this.gitCalls.push({ dir, args: [...args] });
    // Simulate `git checkout <branch>` / `git -c ... clone` side-effects so
    // a fresh ensure leaves the clone on the right branch for re-ensure.
    if (args[0] === "checkout" && args[1]) {
      const st = this.gitState.get(dir) ?? { remote: "", branch: "" };
      this.gitState.set(dir, { ...st, branch: args[1]! });
    }
  }

  async runGitCapture(dir: string, args: string[]): Promise<ExecResult> {
    this.gitCaptureCalls.push({ dir, args: [...args] });
    const st = this.gitState.get(dir);
    if (!st) {
      return { code: 128, stdout: "", stderr: "not a git repository" };
    }
    if (args[0] === "remote" && args[1] === "get-url") {
      return { code: 0, stdout: st.remote + "\n", stderr: "" };
    }
    if (
      (args[0] === "branch" && args[1] === "--show-current") ||
      (args[0] === "rev-parse" && args.includes("--abbrev-ref"))
    ) {
      return { code: 0, stdout: st.branch + "\n", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  }
}
