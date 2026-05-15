/**
 * Cross-repo `## Blocked by` parser (ADR 0003).
 *
 * Pure, no I/O. Scans an issue body for a `## Blocked by` section and returns
 * every blocker reference it lists. Two reference forms are supported per the
 * ADR 0003 contract:
 *
 *   - `owner/repo#N`  -> that repo, that number
 *   - `#N`            -> the issue's *own* repo (the `defaultRepo` arg)
 *
 * The section ends at the next `##`/`#`-level heading or end of body. List
 * items are `-`/`*` bullets; anything that isn't a recognisable reference is
 * skipped (a `Blocked by` section may contain prose). Duplicates are removed,
 * preserving first-seen order — the caller sorts for determinism.
 */

export interface BlockerRef {
  /** `owner/name` GitHub slug. */
  repo: string;
  /** Issue number. */
  number: number;
}

/** `## Blocked by` (case-insensitive, tolerant of trailing spaces). */
const SECTION_HEADER = /^#{1,6}\s+blocked\s+by\s*$/i;
/** Any markdown heading — marks the end of the section. */
const ANY_HEADER = /^#{1,6}\s+\S/;
/** A list bullet: `-`, `*`, or `+`, optionally indented. */
const BULLET = /^\s*[-*+]\s+(.*\S)\s*$/;
/** `owner/repo#N` (owner/repo each a github-legal segment). */
const QUALIFIED = /\b([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)#(\d+)\b/;
/** Bare `#N` — only when no qualified ref matched on the line. */
const BARE = /(?:^|\s)#(\d+)\b/;

/**
 * Parse the `## Blocked by` section of an issue body.
 *
 * @param body         The raw issue body markdown.
 * @param defaultRepo  `owner/name` for bare `#N` references (the issue's repo).
 */
export function parseBlockedBy(
  body: string,
  defaultRepo: string,
): BlockerRef[] {
  const lines = body.split(/\r?\n/);
  const out: BlockerRef[] = [];
  const seen = new Set<string>();
  let inSection = false;

  for (const line of lines) {
    if (!inSection) {
      if (SECTION_HEADER.test(line)) inSection = true;
      continue;
    }
    // A new heading (that is NOT another "Blocked by") closes the section.
    if (ANY_HEADER.test(line)) {
      if (SECTION_HEADER.test(line)) continue;
      break;
    }
    const bullet = line.match(BULLET);
    const text = bullet ? bullet[1]! : line;

    const q = text.match(QUALIFIED);
    if (q) {
      push(out, seen, q[1]!, parseInt(q[2]!, 10));
      continue;
    }
    const b = text.match(BARE);
    if (b) {
      push(out, seen, defaultRepo, parseInt(b[1]!, 10));
    }
    // Non-reference prose inside the section is ignored.
  }
  return out;
}

function push(
  out: BlockerRef[],
  seen: Set<string>,
  repo: string,
  number: number,
): void {
  const key = `${repo}#${number}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ repo, number });
}
