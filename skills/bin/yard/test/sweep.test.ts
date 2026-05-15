import { describe, expect, test } from "bun:test";
import { sweep } from "../src/handlers/sweep.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const REPO = "lbrmi/skills";
const DIR = "/work/skills/sk_main";

function wt(n: number) {
  return { path: `${DIR}/.yard/worktrees/yd-sk-issue-${n}`, branch: `yd/sk/issue-${n}` };
}

describe("sweep (ADR 0003/0006/0007) — GC only true orphans", () => {
  test("removes a merged/closed orphan (worktree + branch)", async () => {
    const fa = new FakeAdapter();
    fa.setWorktrees(DIR, [wt(10)]);
    fa.seedIssues(REPO, [
      { number: 10, title: "x", state: "CLOSED", labels: ["phase:done"], body: "" },
    ]);
    const r = await sweep(
      { repo: REPO, repoDir: DIR, code: "sk", protectedPatterns: [], dryRun: false },
      fa,
    );
    expect(r.summary.removed).toBe(1);
    expect(fa.removeWorktreeCalls.length).toBe(1);
    expect(fa.deleteBranchCalls.length).toBe(1);
  });

  test("KEEPS an OPEN issue's worktree (not an orphan)", async () => {
    const fa = new FakeAdapter();
    fa.setWorktrees(DIR, [wt(10)]);
    fa.seedIssues(REPO, [
      { number: 10, title: "x", state: "OPEN", labels: ["phase:implementing"], body: "" },
    ]);
    const r = await sweep(
      { repo: REPO, repoDir: DIR, code: "sk", protectedPatterns: [], dryRun: false },
      fa,
    );
    expect(r.summary.kept).toBe(1);
    expect(fa.removeWorktreeCalls.length).toBe(0);
  });

  test("KEEPS phase:failed / phase:hitl closed issues for inspection", async () => {
    for (const p of ["phase:failed", "phase:hitl"]) {
      const fa = new FakeAdapter();
      fa.setWorktrees(DIR, [wt(7)]);
      fa.seedIssues(REPO, [
        { number: 7, title: "x", state: "CLOSED", labels: [p], body: "" },
      ]);
      const r = await sweep(
        { repo: REPO, repoDir: DIR, code: "sk", protectedPatterns: [], dryRun: false },
        fa,
      );
      expect(r.summary.kept).toBe(1);
      expect(r.items[0]!.reason).toMatch(/kept for inspection/i);
      expect(fa.removeWorktreeCalls.length).toBe(0);
    }
  });

  test("never touches a non-yard worktree (the main clone, other dirs)", async () => {
    const fa = new FakeAdapter();
    fa.setWorktrees(DIR, [
      { path: DIR, branch: "main" },
      { path: `${DIR}/.yard/worktrees/random-dir`, branch: "feature/x" },
    ]);
    const r = await sweep(
      { repo: REPO, repoDir: DIR, code: "sk", protectedPatterns: [], dryRun: false },
      fa,
    );
    expect(r.items.length).toBe(0);
    expect(fa.removeWorktreeCalls.length).toBe(0);
    expect(fa.deleteBranchCalls.length).toBe(0);
  });

  test("protected branch: worktree removed but branch NEVER deleted", async () => {
    const fa = new FakeAdapter();
    fa.setWorktrees(DIR, [
      { path: `${DIR}/.yard/worktrees/yd-sk-issue-3`, branch: "main" },
    ]);
    fa.seedIssues(REPO, [
      { number: 3, title: "x", state: "CLOSED", labels: ["phase:done"], body: "" },
    ]);
    const r = await sweep(
      { repo: REPO, repoDir: DIR, code: "sk", protectedPatterns: [], dryRun: false },
      fa,
    );
    expect(r.summary.protectedBranches).toBe(1);
    expect(fa.removeWorktreeCalls.length).toBe(1);
    expect(fa.deleteBranchCalls.length).toBe(0);
  });

  test("per-project protected extension is honoured", async () => {
    const fa = new FakeAdapter();
    fa.setWorktrees(DIR, [wt(8)]);
    fa.seedIssues(REPO, [
      { number: 8, title: "x", state: "CLOSED", labels: ["phase:done"], body: "" },
    ]);
    const r = await sweep(
      { repo: REPO, repoDir: DIR, code: "sk", protectedPatterns: ["^yd/sk/issue-8$"], dryRun: false },
      fa,
    );
    expect(r.summary.protectedBranches).toBe(1);
    expect(fa.deleteBranchCalls.length).toBe(0);
  });

  test("dry-run touches nothing but reports the plan", async () => {
    const fa = new FakeAdapter();
    fa.setWorktrees(DIR, [wt(10)]);
    fa.seedIssues(REPO, [
      { number: 10, title: "x", state: "CLOSED", labels: ["phase:done"], body: "" },
    ]);
    const r = await sweep(
      { repo: REPO, repoDir: DIR, code: "sk", protectedPatterns: [], dryRun: true },
      fa,
    );
    expect(r.summary.removed).toBe(1);
    expect(fa.removeWorktreeCalls.length).toBe(0);
    expect(fa.deleteBranchCalls.length).toBe(0);
    expect(r.items[0]!.reason).toMatch(/would remove/i);
  });

  test("unresolvable issue is kept conservatively (never delete on doubt)", async () => {
    const fa = new FakeAdapter();
    fa.setWorktrees(DIR, [wt(404)]);
    // No seeded issue 404 -> getIssue throws.
    const r = await sweep(
      { repo: REPO, repoDir: DIR, code: "sk", protectedPatterns: [], dryRun: false },
      fa,
    );
    expect(r.summary.kept).toBe(1);
    expect(fa.removeWorktreeCalls.length).toBe(0);
  });
});
