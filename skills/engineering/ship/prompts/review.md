# DEDICATED REVIEW — issue #{{TASK_ID}} in {{PROJECT_SLUG}}

This is the **real gate** — fresh eyes, what self-review structurally cannot be (ADR 0004). It fires per the [Review trigger](../SKILL.md#review-trigger): at the unit-of-delivered-intent boundary (PRD's feature→line PR, or a bare issue), and early on any blast-radius slice (dep fan-out ≥ 2). Run it via the `review` skill's two-axis method.

You are reviewing the commits on `{{SOURCE_BRANCH}}` against `{{TARGET_BRANCH}}`:

```
git log {{TARGET_BRANCH}}..HEAD --stat
git diff {{TARGET_BRANCH}}..HEAD
```

Read `CLAUDE.md`, `CONTEXT.md`, ADRs under `docs/adr/` touching the diff, and `gh issue view {{TASK_ID}} --repo {{PROJECT_SLUG}}` (and its `## Parent` PRD if this is the PRD-boundary review — then review the *combined* diff vs the PRD intent, not just one slice).

## Two axes — report them separately, do not merge or rerank

- **Standards** — does the diff conform to this repo's documented standards (`CLAUDE.md`, `CONTEXT.md`, ADRs)? Cite the standard (file + rule) per finding. Skip anything tooling already enforces (lint/format/types).
- **Spec** — does the diff faithfully implement the issue/PRD? (a) requirements missing or partial; (b) behaviour not asked for (scope creep); (c) requirements that look implemented but wrong. Quote the spec/AC line per finding.

A change can pass one axis and fail the other — reporting them apart stops one masking the other.

## Severity split (ADR 0004 / carried from ADR 0027)

- **Hard finding** — a spec requirement missing or wrong, a violated load-bearing standard/ADR, a correctness/security defect. → keep the unit open, escalate to a human; do NOT merge.
- **Soft finding** — polish, minor scope creep, non-load-bearing nit. → file a follow-up issue via `yard issue-create` (labels `Yard, ready-for-agent`), let the loop self-heal; do not block.

If you fix something small and safe yourself, commit it as a separate `review:` commit. Design-defining or judgement-needed → comment on the issue with location + recommended fix; do not commit a guess.

## After review

Run the project's tests once (commands from `CLAUDE.md`). Green + satisfied:

```
gh issue comment {{TASK_ID}} --repo {{PROJECT_SLUG}} --body "Reviewed (Standards+Spec). <one-line verdict>"
```

Output `<promise>COMPLETE</promise>`. Tests red after your edits, or a hard finding stands → comment what's broken, exit WITHOUT COMPLETE (the FSM/severity-split handles it).

## Rules

- One pass. No iteration loop.
- Do not touch style/naming/bikeshed or add tests for already-covered behaviour.
- Do not change dependency sections. Do not refactor unrelated code. Do not close the issue.
- Deterministic gh/git ops → `yard`, not raw, where a command exists.
