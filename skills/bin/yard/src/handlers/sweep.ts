/**
 * `sweep` handler — pure core (ADR 0003/0006/0007).
 *
 * Garbage-collects ONLY orphaned issue worktrees: a `yd-<code>-issue-N`
 * worktree whose issue is closed/merged AND not parked for inspection. The
 * conservative invariants (ADR 0007: "self-healing is mechanical"):
 *
 *  - Only `yd-<code>-issue-N` worktrees are ever considered; the main clone
 *    and any non-yard worktree are untouched (sweep never deletes a
 *    non-orphan).
 *  - An issue still OPEN  => active, KEEP.
 *  - An issue in `phase:failed` / `phase:hitl` => KEEP for inspection, even
 *    if closed (a human still needs the tree to do the post-mortem).
 *  - PROTECTED-BRANCH GUARD before ANY branch delete: the worktree may be
 *    removed, but a branch matching the built-in default regex plus
 *    per-project extensions is NEVER deleted; the refusal is reported.
 *  - `dryRun` reports the exact plan and touches nothing.
 */
import type { Adapter } from "../adapter.ts";
import { OUTPUT_VERSION, type SweepInput } from "../schema.ts";
import { makeProtectedMatcher } from "../protected.ts";
import { KEEP_FOR_INSPECTION, currentPhase } from "../phases.ts";

export type SweepDecision = "removed" | "kept" | "branch-protected";

export interface SweepItem {
  worktree: string;
  branch: string;
  issue: number;
  decision: SweepDecision;
  reason: string;
}

export interface SweepResult {
  version: number;
  command: "sweep";
  repo: string;
  dryRun: boolean;
  items: SweepItem[];
  summary: { removed: number; kept: number; protectedBranches: number };
}

/** `…/yd-<code>-issue-N` -> N, or null when the path is not a yard worktree. */
function issueOfWorktree(path: string, code: string): number | null {
  const base = path.split("/").filter(Boolean).pop() ?? "";
  const m = base.match(new RegExp(`^yd-${escapeRe(code)}-issue-(\\d+)$`));
  return m ? parseInt(m[1]!, 10) : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function sweep(
  input: SweepInput,
  adapter: Adapter,
): Promise<SweepResult> {
  const { repo, repoDir, code, protectedPatterns, dryRun } = input;
  const isProtected = makeProtectedMatcher(protectedPatterns);

  const worktrees = await adapter.listWorktrees(repoDir);
  const items: SweepItem[] = [];

  for (const w of worktrees) {
    const issue = issueOfWorktree(w.path, code);
    if (issue === null) continue; // not a yard issue worktree — never touched

    let gh;
    try {
      gh = await adapter.getIssue(repo, issue);
    } catch {
      // Cannot resolve the issue — conservatively KEEP (never delete on doubt).
      items.push({
        worktree: w.path,
        branch: w.branch,
        issue,
        decision: "kept",
        reason: "issue state unresolved (gh error) — kept conservatively",
      });
      continue;
    }

    const open = (gh.state ?? "OPEN") === "OPEN";
    if (open) {
      items.push({
        worktree: w.path,
        branch: w.branch,
        issue,
        decision: "kept",
        reason: "issue is OPEN — active, not an orphan",
      });
      continue;
    }

    const phase = currentPhase(gh.labels ?? []);
    if (phase !== null && KEEP_FOR_INSPECTION.has(phase)) {
      items.push({
        worktree: w.path,
        branch: w.branch,
        issue,
        decision: "kept",
        reason: `closed but '${phase}' — kept for inspection (ADR 0007)`,
      });
      continue;
    }

    // Genuine orphan: closed/merged, not parked. Remove the worktree…
    if (!dryRun) await adapter.removeWorktree(repoDir, w.path);

    // …then the branch, UNLESS the protected guard refuses.
    if (w.branch && isProtected(w.branch)) {
      items.push({
        worktree: w.path,
        branch: w.branch,
        issue,
        decision: "branch-protected",
        reason: `worktree ${dryRun ? "would be removed" : "removed"}; branch '${w.branch}' is protected — NOT deleted (ADR 0006)`,
      });
      continue;
    }
    if (!dryRun && w.branch) await adapter.deleteBranch(repoDir, w.branch);
    items.push({
      worktree: w.path,
      branch: w.branch,
      issue,
      decision: "removed",
      reason: dryRun
        ? "orphan (closed, not parked) — would remove worktree + branch"
        : "orphan (closed, not parked) — worktree + branch removed",
    });
  }

  items.sort((a, b) => a.issue - b.issue || a.worktree.localeCompare(b.worktree));

  return {
    version: OUTPUT_VERSION,
    command: "sweep",
    repo,
    dryRun,
    items,
    summary: {
      removed: items.filter((i) => i.decision === "removed").length,
      kept: items.filter((i) => i.decision === "kept").length,
      protectedBranches: items.filter((i) => i.decision === "branch-protected")
        .length,
    },
  };
}
