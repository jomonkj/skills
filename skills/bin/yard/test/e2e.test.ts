/**
 * E2E integration tests — shared-state flows across handler boundaries.
 * (ADR 0003: "gh/git fully behind the mocked adapter so the suite costs zero
 * tokens and no network")
 *
 * Unlike the per-handler unit tests (which reset the adapter for each case),
 * these thread ONE FakeAdapter through a complete multi-handler sequence so we
 * catch wiring drift between handlers: state written by handler N must be
 * visible to handler N+1 through the same adapter.
 *
 * Flow A: scope → deps → dispatch-init → dispatch-done
 *   Models a typical /ship run: resolve which issues to work on, check their
 *   dependency order, claim one for implementation, then close it.
 *
 * Flow B: registry init → ensure → doctor
 *   Models bootstrapping a machine: init clones the config repo, ensure
 *   materialises the clones, doctor confirms zero drift (and then detects
 *   real drift when the state is mutated).
 *
 * Zero-network guarantee: no GhAdapter is constructed anywhere in this file.
 * Only FakeAdapter. grep -n "GhAdapter\|new Adapter" test/e2e.test.ts => 0.
 */
import { describe, expect, test } from "bun:test";
import { scope } from "../src/handlers/scope.ts";
import { deps } from "../src/handlers/deps.ts";
import { dispatchInit } from "../src/handlers/dispatch-init.ts";
import { dispatchDone } from "../src/handlers/dispatch-done.ts";
import { init, configDirFor, profileFileFor } from "../src/handlers/init.ts";
import { ensure } from "../src/handlers/ensure.ts";
import { doctor } from "../src/handlers/doctor.ts";
import { FakeAdapter, type SeedIssue } from "./fake-adapter.ts";

// ── shared fixtures ──────────────────────────────────────────────────────────

const REPO = "lbrmi/skills";
const CODE = "sk";
const REPO_DIR = "/work/skills/sk_main";

const REG = `repos:
  skills:
    code: sk
    url: https://github.com/lbrmi/skills.git
    lines: { main: { protected: true } }
  yolo:
    code: yo
    url: git@github.com:lbrmi/yolo.git
    lines: { main: { protected: true } }
`;

const REG_FILE = "/home/test/.yard/config/projects/demo.yml";

function mkIssue(
  number: number,
  body = "",
  state = "OPEN",
  labels: string[] = ["Yard"],
): SeedIssue {
  return { number, title: `issue ${number}`, state, labels, body };
}

// ── Flow A: scope → deps → dispatch-init → dispatch-done ────────────────────

describe("E2E Flow A: scope → deps → dispatch-init → dispatch-done", () => {
  /**
   * Three issues with a linear dependency chain:
   *   #1 (no deps) → #2 (blocked by #1) → #3 (blocked by #2)
   *
   * Flow:
   *   1. scope returns all three open issues
   *   2. deps produces three batches: [[#1], [#2], [#3]]
   *   3. dispatch-init claims #1 (batch 0, no blockers) → label + worktree
   *   4. dispatch-done(merged) for #1 → label moved to done, worktree cleaned
   *
   * One FakeAdapter is shared across all four steps. State mutations from each
   * handler are visible to the next.
   */
  test("linear chain: scope→deps batches reflect blockers, dispatch claims and closes batch-0 issue", async () => {
    const fa = new FakeAdapter();
    fa.setFile(REG_FILE, REG);

    // Seed issues: #1 free, #2 blocked by #1, #3 blocked by #2
    fa.seedIssues(REPO, [
      mkIssue(1),
      mkIssue(2, "## Blocked by\n- #1"),
      mkIssue(3, "## Blocked by\n- #2"),
    ]);
    fa.seedIssues("lbrmi/yolo", []);

    // Step 1: scope resolves all three open issues
    const sc = await scope({ expr: "all", file: REG_FILE, state: "open" }, fa);
    expect(sc.issues.map((i) => `${i.repo}#${i.number}`)).toEqual([
      "lbrmi/skills#1",
      "lbrmi/skills#2",
      "lbrmi/skills#3",
    ]);
    expect(sc.errors).toEqual([]);

    // Step 2: deps shows linear batches matching the Blocked-by chain
    const dp = await deps({ expr: "all", file: REG_FILE, state: "open" }, fa);
    expect(dp.batches).toEqual([
      ["lbrmi/skills#1"],
      ["lbrmi/skills#2"],
      ["lbrmi/skills#3"],
    ]);
    expect(dp.edges).toEqual([
      { from: "lbrmi/skills#2", to: "lbrmi/skills#1" },
      { from: "lbrmi/skills#3", to: "lbrmi/skills#2" },
    ]);

    // Step 3: dispatch-init claims issue #1 (batch 0 — no blockers)
    // Seed its label state on the SAME adapter
    fa.setIssueLabels(REPO, 1, ["Yard", "phase:queued"]);

    const di = await dispatchInit(
      { repo: REPO, issue: 1, code: CODE, repoDir: REPO_DIR, base: "main" },
      fa,
    );

    expect(di.action).toBe("dispatched");
    expect(di.branch).toBe("yd/sk/issue-1");

    // Exactly one atomic label move: queued → implementing
    expect(fa.editIssueCalls.length).toBe(1);
    const labelMove = fa.editIssueCalls[0]!;
    expect(labelMove.change.addLabels).toEqual(["phase:implementing"]);
    expect(labelMove.change.removeLabels).toEqual(["phase:queued"]);

    // Worktree was created
    expect(fa.addWorktreeCalls.length).toBe(1);
    const wtPath = di.worktree;

    // The adapter's worktree list was updated by dispatch-init
    const wts = await fa.listWorktrees(REPO_DIR);
    expect(wts.some((w) => w.path === wtPath && w.branch === "yd/sk/issue-1")).toBe(true);

    // Step 4: dispatch-done records merged outcome
    // (reset editIssueCalls counter to isolate step 4's call)
    const editCallsBefore = fa.editIssueCalls.length;

    const dd = await dispatchDone(
      {
        repo: REPO,
        issue: 1,
        code: CODE,
        repoDir: REPO_DIR,
        outcome: "merged",
        protectedPatterns: [],
      },
      fa,
    );

    expect(dd.phase).toBe("phase:done");

    // One NEW atomic label move: implementing → done (same adapter, counter grew by 1)
    expect(fa.editIssueCalls.length).toBe(editCallsBefore + 1);
    const doneMove = fa.editIssueCalls[fa.editIssueCalls.length - 1]!;
    expect(doneMove.change.addLabels).toEqual(["phase:done"]);
    expect(doneMove.change.removeLabels).toEqual(["phase:implementing"]);

    // Worktree removed + branch deleted
    expect(dd.worktreeRemoved).toBe(true);
    expect(dd.branchDeleted).toBe(true);
    expect(fa.removeWorktreeCalls.length).toBe(1);
    expect(fa.deleteBranchCalls).toEqual([{ repoDir: REPO_DIR, branch: "yd/sk/issue-1" }]);

    // Worktree is gone from the adapter after dispatch-done
    const wtsAfter = await fa.listWorktrees(REPO_DIR);
    expect(wtsAfter.some((w) => w.path === wtPath)).toBe(false);
  });

  /**
   * Cross-repo blocked-by: issue in skills blocked by issue in yolo.
   * scope → deps must resolve the cross-repo edge correctly; the closed yolo
   * issue appears in satisfied[], not edges[].
   */
  test("cross-repo blocked-by: closed blocker appears in satisfied, not edges", async () => {
    const fa = new FakeAdapter();
    fa.setFile(REG_FILE, REG);

    fa.seedIssues(REPO, [
      mkIssue(5),
      mkIssue(6, "## Blocked by\n- lbrmi/yolo#10"),
    ]);
    fa.seedIssues("lbrmi/yolo", [mkIssue(10, "", "CLOSED")]);

    // scope (open only) → skills#5 and skills#6, yolo#10 excluded (closed)
    const sc = await scope({ expr: "all", file: REG_FILE, state: "open" }, fa);
    expect(sc.issues.map((i) => i.number).sort()).toEqual([5, 6]);

    // deps: yolo#10 is CLOSED → satisfied, not an ordering edge
    const dp = await deps({ expr: "all", file: REG_FILE, state: "open" }, fa);
    expect(dp.edges).toEqual([]);
    expect(dp.satisfied).toEqual([
      { from: "lbrmi/skills#6", to: "lbrmi/yolo#10", state: "CLOSED" },
    ]);
    // Both skills issues are in batch 0 (no open in-scope blockers)
    expect(dp.batches).toEqual([["lbrmi/skills#5", "lbrmi/skills#6"]]);

    // dispatch-init for #6 (no open blockers) should succeed
    fa.setIssueLabels(REPO, 6, ["Yard", "phase:queued"]);
    const di = await dispatchInit(
      { repo: REPO, issue: 6, code: CODE, repoDir: REPO_DIR, base: "main" },
      fa,
    );
    expect(di.action).toBe("dispatched");
    expect(di.branch).toBe("yd/sk/issue-6");
  });

  /**
   * dispatch-done(failed) keeps worktree + branch (post-mortem). The
   * shared adapter state shows the worktree is still present after the call.
   */
  test("dispatch-done(failed) keeps worktree and branch intact", async () => {
    const fa = new FakeAdapter();
    fa.setFile(REG_FILE, REG);
    fa.seedIssues(REPO, [mkIssue(20)]);
    fa.seedIssues("lbrmi/yolo", []);

    // Establish dispatched state
    fa.setIssueLabels(REPO, 20, ["Yard", "phase:queued"]);
    const di = await dispatchInit(
      { repo: REPO, issue: 20, code: CODE, repoDir: REPO_DIR, base: "main" },
      fa,
    );
    expect(di.action).toBe("dispatched");
    const wtPath = di.worktree;

    // dispatch-done with failed outcome
    const dd = await dispatchDone(
      {
        repo: REPO,
        issue: 20,
        code: CODE,
        repoDir: REPO_DIR,
        outcome: "failed",
        protectedPatterns: [],
      },
      fa,
    );

    expect(dd.phase).toBe("phase:failed");
    expect(dd.worktreeRemoved).toBe(false);
    expect(dd.branchDeleted).toBe(false);

    // Worktree still in adapter
    const wtsAfter = await fa.listWorktrees(REPO_DIR);
    expect(wtsAfter.some((w) => w.path === wtPath)).toBe(true);
  });
});

// ── Flow B: registry init → ensure → doctor ─────────────────────────────────

const HOME = "/home/test";
const PROFILE_FILE = profileFileFor(HOME, "alice");
const CONFIG_DIR = configDirFor(HOME);

const PROFILE_YAML = `root: /work
projects:
  - myproject
ghIdentity: alice
`;

/** Registry with two repos, app needs lib (transitive dependency). */
const APP_REG = `repos:
  app:
    code: ap
    url: git@github.com:lbrmi/app.git
    lines: { main: {} }
    needs:
      - { repo: lib, line: main }
  lib:
    code: lb
    url: git@github.com:lbrmi/lib.git
    lines: { main: {} }
`;

describe("E2E Flow B: init → ensure → doctor", () => {
  /**
   * init clones the config repo (via onClone seeding the registry file),
   * ensure materialises the in-scope repos + their needs,
   * doctor then confirms zero drift on the same adapter.
   */
  test("init clones registry, ensure materialises repos+needs, doctor reports zero drift", async () => {
    const fa = new FakeAdapter();
    fa.home = HOME;

    // Set up a machine-local profile (not synced)
    fa.setFile(PROFILE_FILE, PROFILE_YAML);

    // init will clone the yard-config repo; onClone seeds the registry YAML
    fa.onClone = (_url, dir, f) => {
      f.setFile(`${dir}/projects/myproject.yml`, APP_REG);
    };

    // Step 1: init
    const initResult = await init(
      { from: "git@github.com:lbrmi/yard-config.git", profile: "alice" },
      fa,
    );

    expect(initResult.command).toBe("init");
    expect(initResult.cloned).toBe(true);
    expect(initResult.projects).toEqual(["myproject"]);
    expect(fa.cloneCalls.length).toBe(1);
    expect(fa.cloneCalls[0]!.url).toBe("git@github.com:lbrmi/yard-config.git");

    // The registry file is now in the adapter's virtual FS
    const regFile = `${CONFIG_DIR}/projects/myproject.yml`;
    expect(await fa.pathExists(regFile)).toBe(true);

    // Step 2: ensure materialises app + lib (transitive need)
    // Seed issues so scope finds something in-scope
    fa.seedIssues("lbrmi/app", [
      { number: 1, title: "do a thing", state: "OPEN", labels: ["Yard"], body: "" },
    ]);

    const ensureResult = await ensure(
      {
        expr: "label:Yard",
        project: "myproject",
        profile: "alice",
        state: "open",
        force: false,
      },
      fa,
    );

    expect(ensureResult.outcomes.every((o) => o.status === "cloned")).toBe(true);
    const dirs = ensureResult.planned.map((p) => p.dir).sort();
    expect(dirs).toEqual(["/work/myproject/app/ap_main", "/work/myproject/lib/lb_main"]);

    // ensure left git state records (checkout calls) on the adapter
    expect(
      fa.gitCalls.filter((g) => g.args[0] === "checkout").map((g) => g.args[1]),
    ).toEqual(["main", "main"]);

    // Step 3: doctor should report zero drift on the just-ensured adapter state
    // (ensure called cloneRepo which triggered onClone, but cloneRepo on FakeAdapter
    //  does NOT set gitState — we need to seed it so doctor sees "present + correct")
    for (const p of ensureResult.planned) {
      fa.setFile(`${p.dir}/.git/HEAD`, "ref: refs/heads/main");
      fa.setGitState(p.dir, p.url, p.line);
    }

    const doctorResult = await doctor(
      { project: "myproject", profile: "alice", fix: false },
      fa,
    );

    expect(doctorResult.drift).toHaveLength(0);
    expect(doctorResult.ok).toBe(2); // app@main + lib@main
  });

  /**
   * After ensure, mutate the gitState on one clone to simulate branch drift.
   * doctor must detect it (without --fix it only reports, never re-clones).
   */
  test("doctor detects drift after ensure; no silent re-clone without --fix", async () => {
    const fa = new FakeAdapter();
    fa.home = HOME;
    fa.setFile(PROFILE_FILE, PROFILE_YAML);

    // Seed config directly (skip init, registry is already "present")
    fa.setFile(`${CONFIG_DIR}/projects/myproject.yml`, APP_REG);

    // Seed both clones as present and correct
    for (const [dir, remote, branch] of [
      ["/work/myproject/app/ap_main", "git@github.com:lbrmi/app.git", "main"],
      ["/work/myproject/lib/lb_main", "git@github.com:lbrmi/lib.git", "main"],
    ] as [string, string, string][]) {
      fa.setFile(`${dir}/.git/HEAD`, "ref: refs/heads/main");
      fa.setGitState(dir, remote, branch);
    }

    // Confirm clean first
    const clean = await doctor(
      { project: "myproject", profile: "alice", fix: false },
      fa,
    );
    expect(clean.drift).toHaveLength(0);

    // Now simulate branch drift on app (someone checked out a feature branch)
    fa.setGitState("/work/myproject/app/ap_main", "git@github.com:lbrmi/app.git", "feature-x");

    const drifted = await doctor(
      { project: "myproject", profile: "alice", fix: false },
      fa,
    );
    expect(drifted.drift).toHaveLength(1);
    expect(drifted.drift[0]!.kind).toBe("drift-branch");
    expect(drifted.drift[0]!.line).toBe("main");
    expect(drifted.drift[0]!.fixed).toBe(false); // report-only, no re-clone
    expect(fa.cloneCalls).toHaveLength(0);
  });

  /**
   * init idempotency: if the config dir already exists (a second machine run),
   * init must NOT re-clone. The registry state written by the first run is
   * still visible.
   */
  test("init is idempotent: re-run does not re-clone existing config dir", async () => {
    const fa = new FakeAdapter();
    fa.home = HOME;
    fa.setFile(PROFILE_FILE, PROFILE_YAML);

    // Pre-seed the config dir as if init already ran
    fa.setFile(`${CONFIG_DIR}/projects/myproject.yml`, APP_REG);

    const r1 = await init(
      { from: "git@github.com:lbrmi/yard-config.git", profile: "alice" },
      fa,
    );
    expect(r1.cloned).toBe(false);
    expect(fa.cloneCalls).toHaveLength(0);
    expect(r1.projects).toEqual(["myproject"]);

    // A second call still returns false (truly idempotent)
    const r2 = await init(
      { from: "git@github.com:lbrmi/yard-config.git", profile: "alice" },
      fa,
    );
    expect(r2.cloned).toBe(false);
    expect(fa.cloneCalls).toHaveLength(0);
  });
});
