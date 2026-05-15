/**
 * `dispatch-init` handler — pure core (ADR 0003/0005/0007).
 *
 * Claims a queued slice and materialises its worktree, with three hard safety
 * invariants:
 *
 *  1. **Atomic label move.** The `phase:queued -> phase:implementing`
 *     transition is ONE `gh issue edit --add-label … --remove-label …`
 *     invocation (a single UpdateIssue mutation). Never delete-then-add — a
 *     crash between two calls would leave a slice with no phase, invisible to
 *     `/goal`.
 *  2. **Lease prevents double-dispatch.** `phase:implementing` IS the lease.
 *     `/goal` re-entry that races two dispatches: the second sees the label
 *     already present and refuses, UNLESS the lease is stale (>2h, ADR 0007),
 *     in which case it is reclaimable so a crashed dispatch can't wedge the
 *     slice forever.
 *  3. **Idempotent reuse.** Re-running for a slice whose worktree already
 *     exists at the expected path on the expected branch is a no-op that just
 *     returns the same worktree/branch/target.
 *
 * Idempotency / safety state table (current `phase:*` label):
 *
 *  | phase            | worktree present+matching | fresh lease (<2h) | action                          |
 *  |------------------|---------------------------|-------------------|---------------------------------|
 *  | (none)/queued    | —                         | —                 | atomic move, create worktree    |
 *  | implementing     | yes                       | —                 | no-op reuse (idempotent)        |
 *  | implementing     | no                        | yes               | REFUSE (held by another runner) |
 *  | implementing     | no                        | no (stale >2h)    | reclaim: recreate worktree      |
 *  | done/hitl/failed/awaiting | —                | —                 | REFUSE (terminal)               |
 */
import type { Adapter } from "../adapter.ts";
import { OUTPUT_VERSION, type DispatchInitInput } from "../schema.ts";
import {
  PHASE_IMPLEMENTING,
  PHASE_QUEUED,
  STALE_LOCK_MS,
  TERMINAL_PHASES,
  currentPhase,
} from "../phases.ts";

export type DispatchInitAction = "dispatched" | "reused" | "reclaimed";

export interface DispatchInitResult {
  version: number;
  command: "dispatch-init";
  repo: string;
  issue: number;
  /** `yd/<code>/issue-N` (ADR 0005 naming). */
  branch: string;
  /** Absolute worktree path `<repoDir>/.yard/worktrees/yd-<code>-issue-N`. */
  worktree: string;
  /** Base ref the worktree was branched from. */
  target: string;
  action: DispatchInitAction;
}

export function branchName(code: string, issue: number): string {
  return `yd/${code}/issue-${issue}`;
}

export function worktreePath(
  repoDir: string,
  code: string,
  issue: number,
): string {
  // ADR 0005: issue worktrees nest at `.yard/worktrees/yd-<code>-issue-N`.
  const base = repoDir.replace(/\/+$/, "");
  return `${base}/.yard/worktrees/yd-${code}-issue-${issue}`;
}

export async function dispatchInit(
  input: DispatchInitInput,
  adapter: Adapter,
): Promise<DispatchInitResult> {
  const { repo, issue, code, repoDir, base } = input;
  const branch = branchName(code, issue);
  const wt = worktreePath(repoDir, code, issue);

  const gh = await adapter.getIssue(repo, issue);
  if (gh.state && gh.state !== "OPEN") {
    throw new Error(
      `dispatch-init refused: issue ${repo}#${issue} is ${gh.state}, not OPEN`,
    );
  }
  const labels = gh.labels ?? [];
  const phase = currentPhase(labels);

  // Worktree presence: same path AND on the expected branch.
  const worktrees = await adapter.listWorktrees(repoDir);
  const wtEntry = worktrees.find((w) => w.path === wt);
  const wtMatches = wtEntry !== undefined && wtEntry.branch === branch;

  // ── Terminal phases: never re-dispatch ────────────────────────────────
  if (phase !== null && TERMINAL_PHASES.has(phase)) {
    throw new Error(
      `dispatch-init refused: issue ${repo}#${issue} is in terminal phase ` +
        `'${phase}' — not re-dispatchable (ADR 0007)`,
    );
  }

  // ── Already implementing: idempotent reuse OR lease arbitration ────────
  if (phase === PHASE_IMPLEMENTING) {
    if (wtMatches) {
      // We (or a prior identical call) already own this — pure no-op.
      return result(repo, issue, branch, wt, base, "reused");
    }
    // Worktree absent but the lease is held. Is the lease stale?
    const leasedAt = await adapter.issueLabeledAt(
      repo,
      issue,
      PHASE_IMPLEMENTING,
    );
    const ageMs =
      leasedAt === null ? Number.POSITIVE_INFINITY : adapter.now() - leasedAt;
    if (ageMs <= STALE_LOCK_MS) {
      throw new Error(
        `dispatch-init refused: issue ${repo}#${issue} lease held by another ` +
          `runner (phase:implementing applied ${Math.round(ageMs / 60000)}m ` +
          `ago, < 2h stale window) — refusing double-dispatch (ADR 0007)`,
      );
    }
    // Stale lease: reclaim. We deliberately do NOT refresh the lease
    // timestamp here. Re-applying `phase:implementing` would mean a
    // remove-then-add (it is already present) — a brief no-phase window that
    // breaks the single-call atomicity invariant, which is worse than the
    // edge it would close. The remaining edge (a reclaimed run that itself
    // runs >2h, so a third dispatcher also sees a stale timestamp) is closed
    // by the real mutex one layer down: `git worktree add -b <branch>` fails
    // loudly on a duplicate branch, so two concurrent reclaimers cannot both
    // materialise — the loser gets a hard error, never a silent double. The
    // timestamp is informational; the worktree branch is the lock of record.
    await ensureWorktree(adapter, repoDir, wt, branch, base, wtEntry?.path);
    return result(repo, issue, branch, wt, base, "reclaimed");
  }

  // ── Fresh dispatch (phase none or phase:queued) ───────────────────────
  // ONE atomic label move: add implementing, remove queued (if present).
  await adapter.editIssue(repo, issue, {
    addLabels: [PHASE_IMPLEMENTING],
    removeLabels: labels.includes(PHASE_QUEUED) ? [PHASE_QUEUED] : [],
  });
  await ensureWorktree(adapter, repoDir, wt, branch, base, wtEntry?.path);
  return result(repo, issue, branch, wt, base, "dispatched");
}

/** Create the worktree unless an identical one is already present. */
async function ensureWorktree(
  adapter: Adapter,
  repoDir: string,
  wt: string,
  branch: string,
  base: string,
  existingPath: string | undefined,
): Promise<void> {
  if (existingPath === wt) return; // already there (possibly wrong branch — left as is for the agent to rename/repair)
  await adapter.addWorktree(repoDir, wt, branch, base);
}

function result(
  repo: string,
  issue: number,
  branch: string,
  worktree: string,
  target: string,
  action: DispatchInitAction,
): DispatchInitResult {
  return {
    version: OUTPUT_VERSION,
    command: "dispatch-init",
    repo,
    issue,
    branch,
    worktree,
    target,
    action,
  };
}
