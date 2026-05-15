import { describe, expect, test } from "bun:test";
import {
  ALL_PHASES,
  KEEP_FOR_INSPECTION,
  STALE_LOCK_MS,
  TERMINAL_PHASES,
  currentPhase,
} from "../src/phases.ts";
import { canonicalLabels } from "../src/labels.ts";

describe("phase vocabulary (ADR 0005/0007)", () => {
  test("stale-lock timeout is the ADR 0007 pinned 2 hours", () => {
    expect(STALE_LOCK_MS).toBe(2 * 60 * 60 * 1000);
  });

  test("every phase is a canonical label yard owns (single source)", () => {
    const names = new Set(canonicalLabels("all").map((l) => l.name));
    for (const p of ALL_PHASES) {
      expect(names.has(p)).toBe(true);
    }
  });

  test("terminal set = the four finished phases; queued/implementing are active", () => {
    expect(TERMINAL_PHASES.has("phase:queued")).toBe(false);
    expect(TERMINAL_PHASES.has("phase:implementing")).toBe(false);
    expect(TERMINAL_PHASES.has("phase:done")).toBe(true);
    expect(TERMINAL_PHASES.has("phase:hitl")).toBe(true);
    expect(TERMINAL_PHASES.has("phase:failed")).toBe(true);
    expect(TERMINAL_PHASES.has("phase:awaiting-human-merge")).toBe(true);
  });

  test("sweep keeps only failed + hitl for inspection", () => {
    expect([...KEEP_FOR_INSPECTION].sort()).toEqual([
      "phase:failed",
      "phase:hitl",
    ]);
  });

  test("currentPhase finds the single phase label, else null", () => {
    expect(currentPhase(["Yard", "phase:implementing"])).toBe(
      "phase:implementing",
    );
    expect(currentPhase(["Yard", "difficulty:hard"])).toBe(null);
  });
});
