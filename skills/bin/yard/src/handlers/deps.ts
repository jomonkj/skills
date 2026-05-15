/**
 * `deps` handler — pure core (ADR 0003).
 *
 * 1. Resolve the scope expr to a set of issues (reuses `scope`).
 * 2. For each issue, parse its `## Blocked by` section (both `owner/repo#N`
 *    and bare `#N`; bare resolves against the issue's own repo).
 * 3. Resolve each blocker's state in *its own repo* (cross-repo): a blocker
 *    that is CLOSED is satisfied and drops out of the ordering graph.
 * 4. Topologically sort the remaining graph into dependency *batches*
 *    (everything in batch k can run in parallel once batch k-1 is done).
 * 5. A cycle fails loud, naming the exact path.
 *
 * Determinism: nodes are keyed `owner/name#N`; every list is sorted, so the
 * batches (and the JSON) are byte-stable across runs.
 */
import type { Adapter } from "../adapter.ts";
import { OUTPUT_VERSION, type DepsInput } from "../schema.ts";
import { scope, type ScopeIssue, type ScopeRepoError } from "./scope.ts";
import { parseBlockedBy } from "../blocked-by.ts";

/** Stable node id: `owner/name#N`. */
function nid(repo: string, number: number): string {
  return `${repo}#${number}`;
}

export interface DepsNode {
  id: string;
  repo: string;
  number: number;
  title: string;
  state: string;
}

export interface DepsResult {
  version: number;
  command: "deps";
  expr: string;
  /**
   * Topo-ordered batches of in-scope node ids. Batch 0 has no unmet
   * blockers; batch k unlocks once 0..k-1 are done. Ids sorted within
   * a batch; batches in order.
   */
  batches: string[][];
  /** Every in-scope node, sorted by id. */
  nodes: DepsNode[];
  /**
   * Resolved blocking edges kept in the ordering (blocker still OPEN and
   * in scope). `from` is blocked by `to`. Sorted.
   */
  edges: { from: string; to: string }[];
  /**
   * Blockers that are already CLOSED (satisfied) or out of scope but
   * resolvable — reported for transparency, not part of the ordering.
   * Sorted by (from, to).
   */
  satisfied: { from: string; to: string; state: string }[];
  /** Per-repo failures from scope + blocker resolution. Sorted by repo. */
  errors: ScopeRepoError[];
}

export class CycleError extends Error {
  constructor(public readonly path: string[]) {
    super(`cycle detected: ${path.join(" -> ")}`);
    this.name = "CycleError";
  }
}

export async function deps(
  input: DepsInput,
  adapter: Adapter,
): Promise<DepsResult> {
  // 1. Resolve scope (carries its own partial-failure errors forward).
  const sc = await scope(
    {
      expr: input.expr,
      file: input.file,
      project: input.project,
      repo: input.repo,
      state: input.state,
    },
    adapter,
  );
  const errors: ScopeRepoError[] = [...sc.errors];

  const inScope = new Map<string, ScopeIssue>();
  for (const i of sc.issues) inScope.set(nid(i.repo, i.number), i);

  const edges: { from: string; to: string }[] = [];
  const satisfied: { from: string; to: string; state: string }[] = [];
  // Cache cross-repo blocker lookups so we never double-fetch.
  const stateCache = new Map<string, string | null>();

  for (const issue of sc.issues) {
    const fromId = nid(issue.repo, issue.number);
    const blockers = parseBlockedBy(issue.body, issue.repo);
    for (const b of blockers) {
      const toId = nid(b.repo, b.number);
      // Resolve the blocker's state in ITS OWN repo (cross-repo).
      let state = stateCache.get(toId);
      if (state === undefined) {
        const inScopeBlocker = inScope.get(toId);
        if (inScopeBlocker) {
          state = inScopeBlocker.state;
        } else {
          try {
            const got = await adapter.getIssue(b.repo, b.number);
            state = got.state ?? "";
          } catch (err) {
            errors.push({
              repo: b.repo,
              message:
                `resolving blocker ${toId} of ${fromId}: ` +
                (err instanceof Error ? err.message : String(err)),
            });
            state = null; // unresolvable -> treat as not-blocking, reported
          }
        }
        stateCache.set(toId, state);
      }
      if (state === null) continue; // unresolvable, already in errors
      if (state === "CLOSED") {
        satisfied.push({ from: fromId, to: toId, state });
        continue;
      }
      // Blocker still open. It only constrains ordering if it is in scope;
      // an out-of-scope open blocker is reported as satisfied=false-ish but
      // can't be a graph node, so surface it as an edge to a known node only.
      if (inScope.has(toId)) {
        edges.push({ from: fromId, to: toId });
      } else {
        // Open, out-of-scope blocker: not orderable here, but it DOES block.
        satisfied.push({ from: fromId, to: toId, state });
      }
    }
  }

  const batches = topoBatches(inScope, edges);

  const nodes: DepsNode[] = [...inScope.values()]
    .map((i) => ({
      id: nid(i.repo, i.number),
      repo: i.repo,
      number: i.number,
      title: i.title,
      state: i.state,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  edges.sort(byFromTo);
  satisfied.sort(byFromTo);
  errors.sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0));

  return {
    version: OUTPUT_VERSION,
    command: "deps",
    expr: input.expr,
    batches,
    nodes,
    edges,
    satisfied,
    errors,
  };
}

function byFromTo(
  a: { from: string; to: string },
  b: { from: string; to: string },
): number {
  if (a.from !== b.from) return a.from < b.from ? -1 : 1;
  if (a.to !== b.to) return a.to < b.to ? -1 : 1;
  return 0;
}

/**
 * Kahn-style layered topo sort. `edges[].from` is blocked by `edges[].to`,
 * so an edge means `to` must precede `from`. Detects cycles and names the
 * exact path (DFS over the residual graph when Kahn stalls).
 */
function topoBatches(
  nodes: Map<string, ScopeIssue>,
  edges: { from: string; to: string }[],
): string[][] {
  const ids = [...nodes.keys()].sort();
  // blockers[x] = set of nodes x is blocked by (must come before x).
  const blockers = new Map<string, Set<string>>();
  // dependents[x] = set of nodes blocked by x.
  const dependents = new Map<string, Set<string>>();
  for (const id of ids) {
    blockers.set(id, new Set());
    dependents.set(id, new Set());
  }
  for (const e of edges) {
    // Both endpoints are guaranteed in-scope (caller filters), but guard.
    if (!blockers.has(e.from) || !blockers.has(e.to)) continue;
    blockers.get(e.from)!.add(e.to);
    dependents.get(e.to)!.add(e.from);
  }

  const remaining = new Set(ids);
  const batches: string[][] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((id) => {
        for (const b of blockers.get(id)!) {
          if (remaining.has(b)) return false;
        }
        return true;
      })
      .sort();
    if (ready.length === 0) {
      throw new CycleError(findCycle(remaining, blockers));
    }
    batches.push(ready);
    for (const id of ready) remaining.delete(id);
  }
  return batches;
}

/** Find one concrete cycle among the still-remaining nodes for the message. */
function findCycle(
  remaining: Set<string>,
  blockers: Map<string, Set<string>>,
): string[] {
  const start = [...remaining].sort()[0]!;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const seen = new Set<string>();

  function dfs(node: string): string[] | null {
    if (onStack.has(node)) {
      const idx = stack.indexOf(node);
      return [...stack.slice(idx), node];
    }
    if (seen.has(node)) return null;
    seen.add(node);
    onStack.add(node);
    stack.push(node);
    for (const next of [...blockers.get(node)!].sort()) {
      if (!remaining.has(next)) continue;
      const found = dfs(next);
      if (found) return found;
    }
    stack.pop();
    onStack.delete(node);
    return null;
  }

  return dfs(start) ?? [start, start];
}
