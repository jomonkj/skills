/**
 * `dispatch-done` handler — pure core (ADR 0003/0005/0007).
 *
 * Records a slice's terminal outcome and tears down its worktree when (and
 * only when) the work is finished:
 *
 *  - `merged`                -> phase:done,  remove worktree + delete branch
 *  - `awaiting-human-merge`  -> phase:awaiting-human-merge, KEEP worktree
 *                               (the human still needs the branch/PR)
 *  - `hitl`                  -> phase:hitl,  KEEP worktree (operator inspects)
 *  - `failed`                -> phase:failed, KEEP worktree (post-mortem)
 *
 * Two hard safety invariants:
 *  1. **Atomic label move.** The phase transition is ONE `gh issue edit`
 *     (add new phase, remove every other phase label currently present) — a
 *     single UpdateIssue mutation, never delete-then-add.
 *  2. **Protected-branch guard before ANY branch delete.** Even for `merged`,
 *     the branch is matched against the built-in default regex
 *     (`^(main|master|\d+\.\d+\.x|release/.*)$`) PLUS per-project extensions
 *     from the registry. A guarded match REFUSES the delete loudly — the
 *     worktree is still removed, but the branch is preserved and the refusal
 *     surfaced (ADR 0006/0007: "must check it and refuse a protected match").
 */
import type { Adapter } from "../adapter.ts";
import { OUTPUT_VERSION, type DispatchDoneInput } from "../schema.ts";
import { makeProtectedMatcher } from "../protected.ts";
import {
  ALL_PHASES,
  PHASE_AWAITING_HUMAN_MERGE,
  PHASE_DONE,
  PHASE_FAILED,
  PHASE_HITL,
} from "../phases.ts";
import { branchName, worktreePath } from "./dispatch-init.ts";

const OUTCOME_PHASE = {
  merged: PHASE_DONE,
  "awaiting-human-merge": PHASE_AWAITING_HUMAN_MERGE,
  hitl: PHASE_HITL,
  failed: PHASE_FAILED,
} as const;

export interface DispatchDoneResult {
  version: number;
  command: "dispatch-done";
  repo: string;
  issue: number;
  outcome: DispatchDoneInput["outcome"];
  phase: string;
  branch: string;
  worktree: string;
  /** Worktree removed (only on `merged`). */
  worktreeRemoved: boolean;
  /** Branch deleted (only on `merged` AND not protected). */
  branchDeleted: boolean;
  /** Set when a branch delete was refused by the protected guard. */
  protectedRefusal?: string;
}

export async function dispatchDone(
  input: DispatchDoneInput,
  adapter: Adapter,
): Promise<DispatchDoneResult> {
  const { repo, issue, code, repoDir, outcome, protectedPatterns } = input;
  const branch = branchName(code, issue);
  const wt = worktreePath(repoDir, code, issue);
  const targetPhase = OUTCOME_PHASE[outcome];

  // Atomic label move: add the terminal phase, remove every OTHER phase
  // label that is currently on the issue. One gh call.
  const gh = await adapter.getIssue(repo, issue);
  const labels = gh.labels ?? [];
  const removeLabels = ALL_PHASES.filter(
    (p) => p !== targetPhase && labels.includes(p),
  );
  await adapter.editIssue(repo, issue, {
    addLabels: labels.includes(targetPhase) ? [] : [targetPhase],
    removeLabels,
  });

  let worktreeRemoved = false;
  let branchDeleted = false;
  let protectedRefusal: string | undefined;

  // Teardown ONLY for a merged slice. failed/hitl/awaiting keep the worktree
  // (post-mortem / the human still needs the branch) — ADR 0007.
  if (outcome === "merged") {
    const worktrees = await adapter.listWorktrees(repoDir);
    if (worktrees.some((w) => w.path === wt)) {
      await adapter.removeWorktree(repoDir, wt);
      worktreeRemoved = true;
    }
    // PROTECTED-BRANCH GUARD — checked before ANY branch delete.
    const isProtected = makeProtectedMatcher(protectedPatterns);
    if (isProtected(branch)) {
      protectedRefusal =
        `refused to delete protected branch '${branch}' ` +
        `(matches protected-branch guard, ADR 0006/0007) — branch preserved`;
    } else {
      await adapter.deleteBranch(repoDir, branch);
      branchDeleted = true;
    }
  }

  return {
    version: OUTPUT_VERSION,
    command: "dispatch-done",
    repo,
    issue,
    outcome,
    phase: targetPhase,
    branch,
    worktree: wt,
    worktreeRemoved,
    branchDeleted,
    ...(protectedRefusal ? { protectedRefusal } : {}),
  };
}
