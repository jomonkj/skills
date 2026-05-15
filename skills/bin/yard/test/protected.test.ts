import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PROTECTED_REGEX,
  isProtected,
  makeProtectedMatcher,
} from "../src/protected.ts";

describe("protected-branch guard (ADR 0006)", () => {
  test("default regex is verbatim from ADR 0006", () => {
    expect(DEFAULT_PROTECTED_REGEX).toBe(
      "^(main|master|\\d+\\.\\d+\\.x|release/.*)$",
    );
  });

  test("built-in default protects main/master/semver-line/release/*", () => {
    expect(isProtected("main")).toBe(true);
    expect(isProtected("master")).toBe(true);
    expect(isProtected("2.3.x")).toBe(true);
    expect(isProtected("release/2026-05")).toBe(true);
  });

  test("a feature/issue branch is NOT protected by default", () => {
    expect(isProtected("yd/sk/issue-5")).toBe(false);
    expect(isProtected("feature/foo")).toBe(false);
    expect(isProtected("2.3")).toBe(false); // not the x-line shape
  });

  test("per-project extension regex composes with the default (either matches)", () => {
    const m = makeProtectedMatcher(["^staging$", "^prod/.*$"]);
    expect(m("main")).toBe(true); // still default
    expect(m("staging")).toBe(true); // extension
    expect(m("prod/eu")).toBe(true); // extension
    expect(m("feature/x")).toBe(false);
  });

  test("an invalid extension pattern fails loudly (never silently weakens guard)", () => {
    expect(() => makeProtectedMatcher(["("])).toThrow(
      /invalid protected-branch pattern/,
    );
  });
});
