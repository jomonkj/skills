/**
 * In-memory fake of the gh/git/fs Adapter for zero-network, zero-token tests
 * (ADR 0003). Records every mutation so tests can assert idempotency.
 *
 * The filesystem is a flat `Map<absPath, content>`; a "directory" exists when
 * any file path is nested under it. `cloneRepo` is simulated by a callback the
 * test supplies (it seeds files under the clone dir), so `init` is fully
 * testable without git or the network.
 */
import type { Adapter, GhIssue, GhLabel } from "../src/adapter.ts";

export class FakeAdapter implements Adapter {
  labels: Map<string, GhLabel>;
  createCalls: { repo: string; label: GhLabel }[] = [];
  editCalls: { repo: string; label: GhLabel }[] = [];
  issueCalls: { repo: string; issue: { title: string; body: string; labels: string[] } }[] = [];
  private _nextIssueNumber = 1;

  /** Flat in-memory FS: absolute path -> file contents. */
  files = new Map<string, string>();
  cloneCalls: { url: string; dir: string }[] = [];
  /** Test hook: called on cloneRepo to seed files under `dir`. */
  onClone?: (url: string, dir: string, fa: FakeAdapter) => void;
  home = "/home/test";

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
}
