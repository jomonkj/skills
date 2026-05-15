/**
 * Phase / lifecycle vocabulary — the single source the dispatch handlers
 * agree on (ADR 0005 / 0007).
 *
 * Labels-are-state (ADR 0003): a slice's lifecycle is a `phase:*` label, not
 * a side file. `phase:implementing` doubles as the **dispatch lease**: its
 * most-recent apply time (read from the issue timeline) drives the 2-hour
 * stale-lock reclaim so a crashed dispatch can never wedge a slice forever
 * (ADR 0007, "fixed v1 defaults").
 *
 * Keeping the names + the terminal/active classification here means
 * dispatch-init, dispatch-done, and sweep cannot drift apart on what counts
 * as "in flight" vs "finished".
 */

export const PHASE_QUEUED = "phase:queued";
export const PHASE_IMPLEMENTING = "phase:implementing";
export const PHASE_AWAITING_HUMAN_MERGE = "phase:awaiting-human-merge";
export const PHASE_HITL = "phase:hitl";
export const PHASE_FAILED = "phase:failed";
export const PHASE_DONE = "phase:done";

/** Every phase label yard owns. */
export const ALL_PHASES = [
  PHASE_QUEUED,
  PHASE_IMPLEMENTING,
  PHASE_AWAITING_HUMAN_MERGE,
  PHASE_HITL,
  PHASE_FAILED,
  PHASE_DONE,
] as const;

export type Phase = (typeof ALL_PHASES)[number];

/**
 * Terminal phases: a slice that carries one of these is finished (one way or
 * another) and must NOT be re-dispatched. `dispatch-init` refuses; `sweep`
 * may GC a merged/closed orphan but KEEPS `phase:failed`/`phase:hitl` for
 * inspection (ADR 0007: "self-healing is mechanical … keeps failed").
 */
export const TERMINAL_PHASES = new Set<string>([
  PHASE_AWAITING_HUMAN_MERGE,
  PHASE_HITL,
  PHASE_FAILED,
  PHASE_DONE,
]);

/** Phases where a slice is parked needing a human / inspection — sweep keeps. */
export const KEEP_FOR_INSPECTION = new Set<string>([
  PHASE_HITL,
  PHASE_FAILED,
]);

/** Stale-lock timeout for `phase:implementing`: 2 hours (ADR 0007, pinned). */
export const STALE_LOCK_MS = 2 * 60 * 60 * 1000;

/** The single `phase:*` label currently on an issue, or null if none. */
export function currentPhase(labels: string[]): Phase | null {
  for (const p of ALL_PHASES) {
    if (labels.includes(p)) return p;
  }
  return null;
}
