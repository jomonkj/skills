/**
 * `labels-ensure` handler — pure core (ADR 0003).
 *
 * Takes validated input + an injected Adapter. No process spawning, no I/O
 * except through the adapter. Fully unit-testable with a fake adapter.
 *
 * Idempotent: list existing labels, diff against the canonical set, create
 * missing ones, repair drifted colour/description. Re-running on a fully
 * populated, in-sync repo is a no-op (zero create, zero edit, exit 0).
 */
import type { Adapter } from "../adapter.ts";
import { canonicalLabels } from "../labels.ts";
import { OUTPUT_VERSION, type LabelsEnsureInput } from "../schema.ts";

export interface LabelChange {
  name: string;
  action: "create" | "update" | "unchanged";
  /** Present for `update`: which fields drifted. */
  drift?: ("color" | "description")[];
}

export interface LabelsEnsureResult {
  version: number;
  command: "labels-ensure";
  repo: string;
  set: string;
  dryRun: boolean;
  changes: LabelChange[];
  summary: { created: number; updated: number; unchanged: number };
}

function normColor(c: string): string {
  return c.replace(/^#/, "").toLowerCase();
}

export async function labelsEnsure(
  input: LabelsEnsureInput,
  adapter: Adapter,
): Promise<LabelsEnsureResult> {
  const wanted = canonicalLabels(input.set);
  const existing = await adapter.listLabels(input.repo);
  const byName = new Map(existing.map((l) => [l.name, l]));

  const changes: LabelChange[] = [];

  for (const label of wanted) {
    const cur = byName.get(label.name);
    if (!cur) {
      if (!input.dryRun) await adapter.createLabel(input.repo, label);
      changes.push({ name: label.name, action: "create" });
      continue;
    }
    const drift: ("color" | "description")[] = [];
    if (normColor(cur.color) !== normColor(label.color)) drift.push("color");
    if ((cur.description ?? "") !== label.description) drift.push("description");

    if (drift.length > 0) {
      if (!input.dryRun) await adapter.editLabel(input.repo, label);
      changes.push({ name: label.name, action: "update", drift });
    } else {
      changes.push({ name: label.name, action: "unchanged" });
    }
  }

  // Deterministic output ordering.
  changes.sort((a, b) => a.name.localeCompare(b.name));

  const summary = {
    created: changes.filter((c) => c.action === "create").length,
    updated: changes.filter((c) => c.action === "update").length,
    unchanged: changes.filter((c) => c.action === "unchanged").length,
  };

  return {
    version: OUTPUT_VERSION,
    command: "labels-ensure",
    repo: input.repo,
    set: input.set,
    dryRun: input.dryRun,
    changes,
    summary,
  };
}
