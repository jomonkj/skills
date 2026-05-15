/**
 * `issue-create` handler — pure core (ADR 0003).
 *
 * Sequence:
 *   1. Ensure labels (reuses labelsEnsure handler — no duplication).
 *   2. Prepend `## Parent\n#N` to body when --parent is supplied.
 *   3. Create the issue via the adapter.
 *
 * Idempotent at the label layer. The issue itself is NOT idempotent (each
 * call creates a new issue), which is the expected behaviour.
 */
import type { Adapter, GhIssue } from "../adapter.ts";
import { labelsEnsure } from "./labels-ensure.ts";
import { OUTPUT_VERSION, type IssueCreateInput } from "../schema.ts";

export interface IssueCreateResult {
  version: number;
  command: "issue-create";
  repo: string;
  /** null when --dry-run */
  number: number | null;
  /** null when --dry-run */
  url: string | null;
  title: string;
  labels: string[];
  parent: number | undefined;
  dryRun: boolean;
}

/**
 * Build the final issue body: optionally prepend a `## Parent` link then
 * append the caller's body.
 */
function buildBody(body: string, parent: number | undefined): string {
  if (parent === undefined) return body;
  const parentSection = `## Parent\n#${parent}`;
  return body ? `${parentSection}\n\n${body}` : parentSection;
}

export async function issueCreate(
  input: IssueCreateInput,
  adapter: Adapter,
): Promise<IssueCreateResult> {
  // Step 1: ensure labels (skip when ensureSet === "none").
  if (input.ensureSet !== "none") {
    await labelsEnsure(
      { repo: input.repo, set: input.ensureSet, dryRun: input.dryRun },
      adapter,
    );
  }

  // Step 2: build final body.
  const finalBody = buildBody(input.body, input.parent);

  // Step 3: create issue (or simulate for dry-run).
  let issue: GhIssue | null = null;
  if (!input.dryRun) {
    issue = await adapter.createIssue(input.repo, {
      title: input.title,
      body: finalBody,
      labels: input.labels,
    });
  }

  return {
    version: OUTPUT_VERSION,
    command: "issue-create",
    repo: input.repo,
    number: issue?.number ?? null,
    url: issue?.url ?? null,
    title: input.title,
    labels: input.labels,
    parent: input.parent,
    dryRun: input.dryRun,
  };
}
