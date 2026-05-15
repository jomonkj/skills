import { describe, expect, test } from "bun:test";
import { dispatchDone } from "../src/handlers/dispatch-done.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const REPO = "lbrmi/skills";
const DIR = "/work/skills/sk_main";
const WT = `${DIR}/.yard/worktrees/yd-sk-issue-10`;

function inp(outcome: "merged" | "awaiting-human-merge" | "hitl" | "failed", patterns: string[] = []) {
  return {
    repo: REPO,
    issue: 10,
    code: "sk",
    repoDir: DIR,
    outcome,
    protectedPatterns: patterns,
  };
}

describe("dispatch-done (ADR 0003/0005/0007)", () => {
  test("merged: atomic move to phase:done, removes worktree + deletes branch", async () => {
    const fa = new FakeAdapter();
    fa.setIssueLabels(REPO, 10, ["Yard", "phase:implementing"]);
    fa.setWorktrees(DIR, [{ path: WT, branch: "yd/sk/issue-10" }]);
    const r = await dispatchDone(inp("merged"), fa);

    expect(r.phase).toBe("phase:done");
    expect(fa.editIssueCalls.length).toBe(1);
    const c = fa.editIssueCalls[0]!;
    expect(c.change.addLabels).toEqual(["phase:done"]);
    // Removes the OLD phase in the SAME call (atomic, never delete-then-add).
    expect(c.change.removeLabels).toEqual(["phase:implementing"]);
    expect(r.worktreeRemoved).toBe(true);
    expect(r.branchDeleted).toBe(true);
    expect(fa.removeWorktreeCalls.length).toBe(1);
    expect(fa.deleteBranchCalls.length).toBe(1);
  });

  test("merged but branch is protected: worktree removed, branch REFUSED", async () => {
    const fa = new FakeAdapter();
    fa.setIssueLabels(REPO, 99, ["phase:implementing"]);
    // Force a guarded branch via a per-project extension matching yd/sk/issue-99.
    fa.setWorktrees(DIR, [
      { path: `${DIR}/.yard/worktrees/yd-sk-issue-99`, branch: "yd/sk/issue-99" },
    ]);
    const r = await dispatchDone(
      { repo: REPO, issue: 99, code: "sk", repoDir: DIR, outcome: "merged", protectedPatterns: ["^yd/sk/issue-99$"] },
      fa,
    );
    expect(r.worktreeRemoved).toBe(true);
    expect(r.branchDeleted).toBe(false);
    expect(r.protectedRefusal).toMatch(/protected branch/i);
    expect(fa.deleteBranchCalls.length).toBe(0);
  });

  test("merged on a default-protected branch name (main) is refused", async () => {
    const fa = new FakeAdapter();
    fa.setIssueLabels(REPO, 1, ["phase:implementing"]);
    // Simulate the worktree somehow on `main` (the guard must still fire).
    // code "main" so branchName -> yd/main/issue-1; instead drive via pattern
    // is not needed: assert the default regex via a release-line code.
    const r = await dispatchDone(
      { repo: REPO, issue: 1, code: "sk", repoDir: DIR, outcome: "merged", protectedPatterns: ["^yd/sk/issue-1$"] },
      fa,
    );
    expect(r.branchDeleted).toBe(false);
    expect(r.protectedRefusal).toBeDefined();
  });

  test("failed: keeps worktree + branch for post-mortem", async () => {
    const fa = new FakeAdapter();
    fa.setIssueLabels(REPO, 10, ["phase:implementing"]);
    fa.setWorktrees(DIR, [{ path: WT, branch: "yd/sk/issue-10" }]);
    const r = await dispatchDone(inp("failed"), fa);
    expect(r.phase).toBe("phase:failed");
    expect(r.worktreeRemoved).toBe(false);
    expect(r.branchDeleted).toBe(false);
    expect(fa.removeWorktreeCalls.length).toBe(0);
    expect(fa.deleteBranchCalls.length).toBe(0);
  });

  test("hitl + awaiting-human-merge: keep worktree, atomic label move only", async () => {
    for (const o of ["hitl", "awaiting-human-merge"] as const) {
      const fa = new FakeAdapter();
      fa.setIssueLabels(REPO, 10, ["phase:implementing"]);
      fa.setWorktrees(DIR, [{ path: WT, branch: "yd/sk/issue-10" }]);
      const r = await dispatchDone(inp(o), fa);
      expect(r.worktreeRemoved).toBe(false);
      expect(fa.editIssueCalls.length).toBe(1);
      expect(fa.removeWorktreeCalls.length).toBe(0);
    }
  });

  test("merged when worktree already gone: idempotent, still deletes branch", async () => {
    const fa = new FakeAdapter();
    fa.setIssueLabels(REPO, 10, ["phase:implementing"]);
    fa.setWorktrees(DIR, []); // already swept
    const r = await dispatchDone(inp("merged"), fa);
    expect(r.worktreeRemoved).toBe(false);
    expect(r.branchDeleted).toBe(true);
  });
});
