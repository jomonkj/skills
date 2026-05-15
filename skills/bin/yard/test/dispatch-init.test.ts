import { describe, expect, test } from "bun:test";
import {
  dispatchInit,
  branchName,
  worktreePath,
} from "../src/handlers/dispatch-init.ts";
import { STALE_LOCK_MS } from "../src/phases.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const REPO = "lbrmi/skills";
const DIR = "/work/skills/sk_main";

function base(fa: FakeAdapter) {
  return { repo: REPO, issue: 10, code: "sk", repoDir: DIR, base: "main" };
}

describe("dispatch-init (ADR 0003/0005/0007)", () => {
  test("naming: branch + worktree path follow ADR 0005", () => {
    expect(branchName("sk", 10)).toBe("yd/sk/issue-10");
    expect(worktreePath("/work/repo/", "sk", 10)).toBe(
      "/work/repo/.yard/worktrees/yd-sk-issue-10",
    );
  });

  test("fresh dispatch: atomic single-call move queued->implementing + worktree", async () => {
    const fa = new FakeAdapter();
    fa.setIssueLabels(REPO, 10, ["Yard", "phase:queued"]);
    const r = await dispatchInit(base(fa), fa);

    expect(r.action).toBe("dispatched");
    expect(r.branch).toBe("yd/sk/issue-10");
    expect(r.worktree).toBe(`${DIR}/.yard/worktrees/yd-sk-issue-10`);
    expect(r.target).toBe("main");
    // EXACTLY one editIssue call, carrying BOTH add and remove (atomic).
    expect(fa.editIssueCalls.length).toBe(1);
    const c = fa.editIssueCalls[0]!;
    expect(c.change.addLabels).toEqual(["phase:implementing"]);
    expect(c.change.removeLabels).toEqual(["phase:queued"]);
    expect(fa.addWorktreeCalls.length).toBe(1);
  });

  test("idempotent reuse: worktree present+matching => no-op (no label call, no new worktree)", async () => {
    const fa = new FakeAdapter();
    fa.setIssueLabels(REPO, 10, ["phase:implementing"]);
    fa.setWorktrees(DIR, [
      { path: `${DIR}/.yard/worktrees/yd-sk-issue-10`, branch: "yd/sk/issue-10" },
    ]);
    const r = await dispatchInit(base(fa), fa);
    expect(r.action).toBe("reused");
    expect(fa.editIssueCalls.length).toBe(0);
    expect(fa.addWorktreeCalls.length).toBe(0);
    expect(r.worktree).toBe(`${DIR}/.yard/worktrees/yd-sk-issue-10`);
  });

  test("lock prevents /goal re-entry double-dispatch (fresh lease, no worktree => refuse)", async () => {
    const fa = new FakeAdapter();
    fa.setNow(1_000_000_000_000);
    fa.setIssueLabels(REPO, 10, ["phase:implementing"]);
    // Lease applied 30 min ago — well within the 2h window.
    fa.setLabeledAt(REPO, 10, "phase:implementing", fa.now() - 30 * 60_000);
    await expect(dispatchInit(base(fa), fa)).rejects.toThrow(
      /lease held by another runner/i,
    );
    expect(fa.addWorktreeCalls.length).toBe(0);
    expect(fa.editIssueCalls.length).toBe(0);
  });

  test(">2h stale lease is reclaimable: recreates worktree, keeps label", async () => {
    const fa = new FakeAdapter();
    fa.setNow(1_000_000_000_000);
    fa.setIssueLabels(REPO, 10, ["phase:implementing"]);
    fa.setLabeledAt(
      REPO,
      10,
      "phase:implementing",
      fa.now() - (STALE_LOCK_MS + 60_000),
    );
    const r = await dispatchInit(base(fa), fa);
    expect(r.action).toBe("reclaimed");
    // Label is NOT re-moved (it is still the lease), only worktree rebuilt.
    expect(fa.editIssueCalls.length).toBe(0);
    expect(fa.addWorktreeCalls.length).toBe(1);
  });

  test("missing lease timestamp is treated as infinitely stale (reclaim, never wedge)", async () => {
    const fa = new FakeAdapter();
    fa.setIssueLabels(REPO, 10, ["phase:implementing"]);
    // No setLabeledAt -> issueLabeledAt returns null.
    const r = await dispatchInit(base(fa), fa);
    expect(r.action).toBe("reclaimed");
  });

  test("terminal phase refuses re-dispatch", async () => {
    for (const p of ["phase:done", "phase:hitl", "phase:failed", "phase:awaiting-human-merge"]) {
      const fa = new FakeAdapter();
      fa.setIssueLabels(REPO, 10, [p]);
      await expect(dispatchInit(base(fa), fa)).rejects.toThrow(
        /terminal phase/i,
      );
    }
  });

  test("closed issue refuses dispatch", async () => {
    const fa = new FakeAdapter();
    fa.seedIssues(REPO, [
      { number: 10, title: "x", state: "CLOSED", labels: ["phase:queued"], body: "" },
    ]);
    await expect(dispatchInit(base(fa), fa)).rejects.toThrow(/not OPEN/i);
  });

  test("no phase label at all: still atomically moves to implementing", async () => {
    const fa = new FakeAdapter();
    fa.setIssueLabels(REPO, 10, ["Yard"]);
    const r = await dispatchInit(base(fa), fa);
    expect(r.action).toBe("dispatched");
    expect(fa.editIssueCalls.length).toBe(1);
    expect(fa.editIssueCalls[0]!.change.addLabels).toEqual(["phase:implementing"]);
    expect(fa.editIssueCalls[0]!.change.removeLabels).toEqual([]);
  });
});
