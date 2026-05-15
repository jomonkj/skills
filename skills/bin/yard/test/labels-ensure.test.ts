import { describe, expect, test } from "bun:test";
import { labelsEnsure } from "../src/handlers/labels-ensure.ts";
import { canonicalLabels } from "../src/labels.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const REPO = "lbrmi/skills";

describe("labels-ensure handler", () => {
  test("creates all missing labels on an empty repo", async () => {
    const fa = new FakeAdapter([]);
    const res = await labelsEnsure(
      { repo: REPO, set: "yard", dryRun: false },
      fa,
    );
    const want = canonicalLabels("yard");
    expect(res.summary.created).toBe(want.length);
    expect(res.summary.updated).toBe(0);
    expect(res.summary.unchanged).toBe(0);
    expect(fa.createCalls.length).toBe(want.length);
    expect(res.version).toBe(1);
  });

  test("is idempotent: second run is a no-op (zero create, zero edit)", async () => {
    const fa = new FakeAdapter([]);
    await labelsEnsure({ repo: REPO, set: "all", dryRun: false }, fa);
    fa.createCalls = [];
    fa.editCalls = [];

    const res2 = await labelsEnsure(
      { repo: REPO, set: "all", dryRun: false },
      fa,
    );
    expect(fa.createCalls.length).toBe(0);
    expect(fa.editCalls.length).toBe(0);
    expect(res2.summary.created).toBe(0);
    expect(res2.summary.updated).toBe(0);
    expect(res2.summary.unchanged).toBe(canonicalLabels("all").length);
  });

  test("repairs drifted color and description", async () => {
    const yardSet = canonicalLabels("yard");
    const first = yardSet[0]!;
    const fa = new FakeAdapter([
      { name: first.name, color: "000000", description: "wrong" },
    ]);
    const res = await labelsEnsure(
      { repo: REPO, set: "yard", dryRun: false },
      fa,
    );
    const changed = res.changes.find((c) => c.name === first.name)!;
    expect(changed.action).toBe("update");
    expect(changed.drift).toEqual(["color", "description"]);
    expect(fa.editCalls.length).toBe(1);
  });

  test("color compare is case- and #-insensitive", async () => {
    const lbl = canonicalLabels("triage")[0]!;
    const fa = new FakeAdapter([
      {
        name: lbl.name,
        color: "#" + lbl.color.toLowerCase(),
        description: lbl.description,
      },
    ]);
    const res = await labelsEnsure(
      { repo: REPO, set: "triage", dryRun: false },
      fa,
    );
    const c = res.changes.find((x) => x.name === lbl.name)!;
    expect(c.action).toBe("unchanged");
    expect(fa.editCalls.length).toBe(0);
  });

  test("--dry-run reports changes without mutating", async () => {
    const fa = new FakeAdapter([]);
    const res = await labelsEnsure(
      { repo: REPO, set: "triage", dryRun: true },
      fa,
    );
    expect(res.dryRun).toBe(true);
    expect(res.summary.created).toBe(canonicalLabels("triage").length);
    expect(fa.createCalls.length).toBe(0); // nothing actually created
  });

  test("output ordering is deterministic (name-sorted)", async () => {
    const fa = new FakeAdapter([]);
    const res = await labelsEnsure({ repo: REPO, set: "all", dryRun: true }, fa);
    const names = res.changes.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  test("'all' set dedupes and merges triage + yard", async () => {
    const all = canonicalLabels("all");
    const names = all.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length); // no dupes
    expect(names).toContain("Yard");
    expect(names).toContain("needs-triage");
  });
});
