/**
 * `scope` handler — pure core (ADR 0003).
 *
 * Resolves a scope expression to a deterministic, sorted list of issues
 * across the registry's repos. Expr forms (exactly one):
 *
 *   - `prd:`          -> issues labelled `PRD`
 *   - `label:<name>`  -> issues with label <name>
 *   - `issue:<ref>`   -> a single issue; <ref> is `owner/repo#N` or `#N`
 *   - `all`           -> every issue across registry repos
 *
 * Partial-failure isolation (ADR 0003 contract): one repo's `gh` failure is
 * captured in `errors[]` and does NOT abort the others. Output is fully
 * sorted (issues by repo then number) so the JSON is byte-stable across
 * runs regardless of repo iteration / gh return order.
 */
import type { Adapter, IssueState } from "../adapter.ts";
import { OUTPUT_VERSION, type ScopeInput } from "../schema.ts";
import { registryRead } from "./registry-read.ts";
import { repoSlugFromUrl } from "../repo-url.ts";

/** Canonical PRD label (matches the `PRD` label in labels.ts / Yard set). */
const PRD_LABEL = "PRD";

export interface ScopeIssue {
  repo: string;
  number: number;
  title: string;
  state: string;
  labels: string[];
  url: string;
  body: string;
}

export interface ScopeRepoError {
  repo: string;
  message: string;
}

export interface ScopeResult {
  version: number;
  command: "scope";
  expr: string;
  /** Issues, sorted by (repo, number) ascending. Stable across runs. */
  issues: ScopeIssue[];
  /** Per-repo failures (partial-failure isolation). Sorted by repo. */
  errors: ScopeRepoError[];
}

type Parsed =
  | { kind: "prd" }
  | { kind: "label"; name: string }
  | { kind: "issue"; repo: string | null; number: number }
  | { kind: "all" };

/** Parse the expr string. Throws a clear usage error on a malformed expr. */
export function parseScopeExpr(expr: string): Parsed {
  const e = expr.trim();
  if (e === "all") return { kind: "all" };
  if (e === "prd:") return { kind: "prd" };
  if (e.startsWith("label:")) {
    const name = e.slice("label:".length).trim();
    if (!name) throw new Error("label: expr needs a label name (label:<name>)");
    return { kind: "label", name };
  }
  if (e.startsWith("issue:")) {
    const ref = e.slice("issue:".length).trim();
    // owner/repo#N
    const q = ref.match(/^([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)#(\d+)$/);
    if (q) return { kind: "issue", repo: q[1]!, number: parseInt(q[2]!, 10) };
    // bare #N (or N)
    const b = ref.match(/^#?(\d+)$/);
    if (b) return { kind: "issue", repo: null, number: parseInt(b[1]!, 10) };
    throw new Error(
      `issue: expr must be owner/repo#N or #N, got ${JSON.stringify(ref)}`,
    );
  }
  throw new Error(
    `unknown scope expr ${JSON.stringify(expr)} — ` +
      `expected one of: prd: | label:<name> | issue:<ref> | all`,
  );
}

function toScopeIssue(repo: string, i: {
  number: number;
  url: string;
  title?: string;
  state?: string;
  labels?: string[];
  body?: string;
}): ScopeIssue {
  return {
    repo,
    number: i.number,
    title: i.title ?? "",
    state: i.state ?? "",
    labels: [...(i.labels ?? [])].sort(),
    url: i.url,
    body: i.body ?? "",
  };
}

function sortIssues(a: ScopeIssue, b: ScopeIssue): number {
  return a.repo === b.repo ? a.number - b.number : a.repo < b.repo ? -1 : 1;
}

/**
 * Resolve the registry's repos to GitHub `owner/name` slugs, sorted and
 * de-duplicated. Reused by the deps handler.
 */
export async function registryRepoSlugs(
  input: { file?: string; project?: string },
  adapter: Adapter,
): Promise<string[]> {
  const reg = await registryRead(
    { file: input.file, project: input.project },
    adapter,
  );
  const slugs = new Set<string>();
  for (const key of Object.keys(reg.registry.repos)) {
    slugs.add(repoSlugFromUrl(reg.registry.repos[key]!.url));
  }
  return [...slugs].sort();
}

export async function scope(
  input: ScopeInput,
  adapter: Adapter,
): Promise<ScopeResult> {
  const parsed = parseScopeExpr(input.expr);
  const issues: ScopeIssue[] = [];
  const errors: ScopeRepoError[] = [];

  if (parsed.kind === "issue") {
    // Single-issue resolution: explicit repo, else --repo default.
    const repo = parsed.repo ?? input.repo;
    if (!repo) {
      throw new Error(
        "bare issue:#N needs a default repo — pass --repo owner/name " +
          "or use issue:owner/repo#N",
      );
    }
    try {
      const got = await adapter.getIssue(repo, parsed.number);
      issues.push(toScopeIssue(repo, got));
    } catch (err) {
      errors.push({
        repo,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return finish(input.expr, issues, errors);
  }

  // prd / label / all -> list across every registry repo, isolating failures.
  const slugs = await registryRepoSlugs(
    { file: input.file, project: input.project },
    adapter,
  );
  const labels =
    parsed.kind === "prd"
      ? [PRD_LABEL]
      : parsed.kind === "label"
        ? [parsed.name]
        : undefined;
  const state = input.state as IssueState;

  for (const repo of slugs) {
    try {
      const list = await adapter.listIssues(repo, { labels, state });
      for (const i of list) issues.push(toScopeIssue(repo, i));
    } catch (err) {
      errors.push({
        repo,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return finish(input.expr, issues, errors);
}

function finish(
  expr: string,
  issues: ScopeIssue[],
  errors: ScopeRepoError[],
): ScopeResult {
  issues.sort(sortIssues);
  errors.sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0));
  return {
    version: OUTPUT_VERSION,
    command: "scope",
    expr,
    issues,
    errors,
  };
}
