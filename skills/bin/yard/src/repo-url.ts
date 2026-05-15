/**
 * Git URL -> GitHub `owner/name` parser (ADR 0006: registry repos carry a
 * git `url`; scope/deps must turn that into the `owner/name` slug `gh` wants).
 *
 * Pure, no I/O. Handles the two URL shapes the registry uses:
 *   - `git@github.com:owner/name(.git)?`
 *   - `https://github.com/owner/name(.git)?`  (also `http://`, `ssh://git@`)
 * Anything else is a loud error — yard never guesses.
 */

const SCP_LIKE = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/;
const HTTP_LIKE =
  /^(?:https?|ssh):\/\/(?:git@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/;

/**
 * Parse a GitHub git URL to its `owner/name` slug.
 * Throws a clear, actionable error on any non-github / unparseable URL.
 */
export function repoSlugFromUrl(url: string): string {
  const trimmed = url.trim();
  const m = trimmed.match(SCP_LIKE) ?? trimmed.match(HTTP_LIKE);
  if (!m) {
    throw new Error(
      `cannot derive owner/name from git URL ${JSON.stringify(url)} — ` +
        `expected github.com SSH (git@github.com:owner/name.git) or ` +
        `HTTPS (https://github.com/owner/name.git)`,
    );
  }
  return `${m[1]}/${m[2]}`;
}
