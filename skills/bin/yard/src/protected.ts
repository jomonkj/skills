/**
 * Protected-branch guard (ADR 0006).
 *
 * The guard lives in the registry, not the branch-tracked in-repo config:
 * "which line is protected" must be identical across every release line.
 *
 * Two independent signals make a line protected:
 *   1. The built-in conservative default regex (verbatim from ADR 0006).
 *   2. A per-project `protected` extension regex list (registry-level).
 * Either match => protected. `yard sweep`, `dispatch-done`, and any branch
 * delete MUST consult this and refuse a protected match (ADR 0006). This module
 * is the single source of that decision so the rule cannot drift.
 */

/**
 * Conservative built-in default. ADR 0006, verbatim:
 * `^(main|master|\d+\.\d+\.x|release/.*)$`
 *
 * Matches `main`, `master`, semver-ish lines like `2.3.x`, and `release/*`.
 */
export const DEFAULT_PROTECTED_REGEX = "^(main|master|\\d+\\.\\d+\\.x|release/.*)$";

/**
 * Build a protected-branch matcher from the built-in default plus any
 * per-project extension patterns (each a JS regex *source* string).
 *
 * Throws a clear error if an extension pattern is not a valid regex — a bad
 * registry edit must fail loudly, never silently weaken the guard.
 */
export function makeProtectedMatcher(
  extraPatterns: string[] = [],
): (branch: string) => boolean {
  const compiled: RegExp[] = [new RegExp(DEFAULT_PROTECTED_REGEX)];
  for (const pat of extraPatterns) {
    try {
      compiled.push(new RegExp(pat));
    } catch (err) {
      throw new Error(
        `invalid protected-branch pattern ${JSON.stringify(pat)}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
  return (branch: string) => compiled.some((re) => re.test(branch));
}

/**
 * Convenience: is `branch` protected under the default + given extensions?
 */
export function isProtected(
  branch: string,
  extraPatterns: string[] = [],
): boolean {
  return makeProtectedMatcher(extraPatterns)(branch);
}
