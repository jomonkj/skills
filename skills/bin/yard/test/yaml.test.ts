import { describe, expect, test } from "bun:test";
import { canonicalize, emitYaml } from "../src/yaml.ts";

describe("deterministic YAML emitter", () => {
  test("sorts object keys recursively, regardless of insertion order", () => {
    const a = emitYaml({ b: 1, a: { z: 2, y: 3 }, c: [3, 1, 2] });
    const b = emitYaml({ c: [3, 1, 2], a: { y: 3, z: 2 }, b: 1 });
    expect(a).toBe(b);
  });

  test("array order is preserved (order is data in arrays)", () => {
    expect(emitYaml(["b", "a", "c"] as never)).toBe("- b\n- a\n- c\n");
  });

  test("output is byte-stable across repeated calls", () => {
    const v = { repos: { yo: { code: "yo" }, lbr: { code: "lbr" } } };
    expect(emitYaml(v)).toBe(emitYaml(v));
  });

  test("always ends with exactly one trailing newline", () => {
    const out = emitYaml({ x: 1 });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  test("canonicalize leaves scalars and arrays, sorts maps", () => {
    expect(canonicalize(42)).toBe(42);
    expect(canonicalize([3, 1])).toEqual([3, 1]);
    expect(JSON.stringify(canonicalize({ b: 1, a: 2 }))).toBe(
      JSON.stringify({ a: 2, b: 1 }),
    );
  });
});
