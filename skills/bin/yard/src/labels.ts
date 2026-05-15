/**
 * Canonical GitHub label set — THE single source of truth.
 *
 * ADR 0003: label colours/descriptions used to drift across `setup-yard`,
 * `to-issues`, and `triage`. yard now owns them; those skills shell out to
 * `yard labels-ensure` instead of hardcoding `gh label create`.
 *
 * Provenance:
 *  - `yard` set: colours + descriptions copied verbatim from
 *    skills/engineering/setup-yard/SKILL.md (the 9-label fleet set).
 *  - `triage` set: names from skills/engineering/triage/SKILL.md and
 *    skills/engineering/to-issues/SKILL.md. Those skills name the triage
 *    labels but never specified colours/descriptions — so yard *establishes*
 *    them here as the new canonical definition (it is now the single source).
 */

export interface CanonicalLabel {
  name: string;
  /** 6-hex, no leading `#`. */
  color: string;
  description: string;
}

export type LabelSet = "triage" | "yard" | "all";

/** Fleet labels — verbatim from setup-yard/SKILL.md §4 plus PRD marker. */
const YARD_LABELS: CanonicalLabel[] = [
  {
    name: "PRD",
    color: "5319E7",
    description: "Parent PRD issue",
  },
  {
    name: "Yard",
    color: "1D76DB",
    description: "Issues processed by the yard fleet",
  },
  {
    name: "difficulty:easy",
    color: "C2E0C6",
    description: "Small change, low risk",
  },
  {
    name: "difficulty:medium",
    color: "FBCA04",
    description: "Moderate change",
  },
  {
    name: "difficulty:hard",
    color: "D93F0B",
    description: "Large or risky change",
  },
  {
    name: "need-agent-review",
    color: "5319E7",
    description: "Opt into second-pass reviewer",
  },
  {
    name: "priority:highest",
    color: "B60205",
    description: "Top of queue",
  },
  {
    name: "priority:high",
    color: "D93F0B",
    description: "High priority",
  },
  {
    name: "priority:low",
    color: "C5DEF5",
    description: "Low priority",
  },
  {
    name: "priority:lowest",
    color: "CCCCCC",
    description: "Bottom of queue",
  },
  // ── Phase / lifecycle labels (ADR 0005 / 0007) ──────────────────────────
  // Labels-are-state (ADR 0003): a slice's lifecycle phase IS a label, never
  // a side file. `phase:implementing` doubles as the dispatch lease — its
  // most-recent apply time drives the 2h stale-lock reclaim (ADR 0007).
  // Names referenced verbatim by ship-prd/SKILL.md and ADR 0007; yard is the
  // single source for their colours/descriptions.
  {
    name: "phase:queued",
    color: "FEF2C0",
    description: "Slice is ready and waiting for dispatch",
  },
  {
    name: "phase:implementing",
    color: "1D76DB",
    description:
      "Slice is dispatched and in flight — this label is the dispatch lease (2h stale-reclaim, ADR 0007)",
  },
  {
    name: "phase:awaiting-human-merge",
    color: "0E8A16",
    description: "Feature PR open, green — a human performs the merge (ADR 0005)",
  },
  {
    name: "phase:hitl",
    color: "B60205",
    description: "Escalation exhausted — human intervention required (ADR 0007)",
  },
  {
    name: "phase:failed",
    color: "D93F0B",
    description: "Slice failed terminally within its tier budget (ADR 0007)",
  },
  {
    name: "phase:done",
    color: "0E8A16",
    description: "Slice merged and complete",
  },
];

/**
 * Triage state-machine labels — names from triage/SKILL.md.
 * Colours/descriptions first defined here (yard is now canonical).
 */
const TRIAGE_LABELS: CanonicalLabel[] = [
  {
    name: "needs-triage",
    color: "FBCA04",
    description: "Maintainer needs to evaluate",
  },
  {
    name: "needs-info",
    color: "D4C5F9",
    description: "Waiting on reporter for more information",
  },
  {
    name: "ready-for-agent",
    color: "0E8A16",
    description: "Fully specified, ready for an AFK agent",
  },
  {
    name: "ready-for-human",
    color: "1D76DB",
    description: "Needs human implementation",
  },
  {
    name: "wontfix",
    color: "CCCCCC",
    description: "Will not be actioned",
  },
];

/**
 * Resolve a set name to its canonical labels, deduplicated by name and
 * returned in a deterministic (name-sorted) order.
 */
export function canonicalLabels(set: LabelSet): CanonicalLabel[] {
  const pick: CanonicalLabel[] =
    set === "triage"
      ? TRIAGE_LABELS
      : set === "yard"
        ? YARD_LABELS
        : [...TRIAGE_LABELS, ...YARD_LABELS];

  const byName = new Map<string, CanonicalLabel>();
  for (const label of pick) {
    if (!byName.has(label.name)) byName.set(label.name, label);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
