# Engineering

Skills I use daily for code work.

- **[diagnose](./diagnose/SKILL.md)** — Disciplined diagnosis loop for hard bugs and performance regressions: reproduce → minimise → hypothesise → instrument → fix → regression-test.
- **[grill-with-docs](./grill-with-docs/SKILL.md)** — Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates `CONTEXT.md` and ADRs inline.
- **[triage](./triage/SKILL.md)** — Triage issues through a state machine of triage roles.
- **[improve-codebase-architecture](./improve-codebase-architecture/SKILL.md)** — Find deepening opportunities in a codebase, informed by the domain language in `CONTEXT.md` and the decisions in `docs/adr/`.
- **[onboard](./onboard/SKILL.md)** — One-command new-developer onboarding (macOS): verify system tools (fail loud, never install), build the `yard` CLI, create the machine-local profile, `yard init` against the registry, verify. Run once after the manual bootstrap in `ONBOARDING.md`.
- **[setup-yard](./setup-yard/SKILL.md)** — One-time per-repo onboarding into the ship workflow: register the project via the `yard` CLI, ensure canonical labels through `yard labels-ensure` (single source), scaffold `CONTEXT.md`/ADR docs. `--triage` does the lightweight triage-only scaffold. Merged form of the old setup-yard + setup-yolo-skills. Idempotent.
- **[ship](./ship/SKILL.md)** — Execute a Yard-ready PRD/scope end-to-end on the deterministic `yard` CLI: resolve scope → dispatch unblocked slices to parallel worktree subagents (implement → self-review → dedicated review → merge-check → PR → CI → squash-merge) → deterministic run summary. `--plan` does a read-only pre-flight that emits the `/goal` command. Escalation sonnet→opus→HITL. Supersedes ship-prd.
- **[ship-prd](./ship-prd/SKILL.md)** — Transitional fallback, superseded by [ship](./ship/SKILL.md). Yard-less PRD execution that reads phase prompts from `yolo-hq/yard/prompts/`. Kept until `/ship` proves on a real PRD, then removed (ADR 0008).
- **[review](./review/SKILL.md)** — Two-axis review of changes since a fixed point — Standards (repo docs/ADRs) and Spec (originating issue/PRD) — run as parallel sub-agents, reported separately. Invoked by `/ship` at the unit-of-delivered-intent boundary and human-triggered on demand. The dedicated review gate of ADR 0004.
- **[tdd](./tdd/SKILL.md)** — Test-driven development with a red-green-refactor loop. Builds features or fixes bugs one vertical slice at a time.
- **[to-issues](./to-issues/SKILL.md)** — Break any plan, spec, or PRD into independently-grabbable GitHub issues using vertical slices.
- **[to-prd](./to-prd/SKILL.md)** — Turn the current conversation context into a PRD and submit it as a GitHub issue.
- **[zoom-out](./zoom-out/SKILL.md)** — Tell the agent to zoom out and give broader context or a higher-level perspective on an unfamiliar section of code.
- **[prototype](./prototype/SKILL.md)** — Build a throwaway prototype to flesh out a design — either a runnable terminal app for state/business-logic questions, or several radically different UI variations toggleable from one route.
