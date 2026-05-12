# Engineering

Skills I use daily for code work.

- **[diagnose](./diagnose/SKILL.md)** — Disciplined diagnosis loop for hard bugs and performance regressions: reproduce → minimise → hypothesise → instrument → fix → regression-test.
- **[grill-with-docs](./grill-with-docs/SKILL.md)** — Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates `CONTEXT.md` and ADRs inline.
- **[triage](./triage/SKILL.md)** — Triage issues through a state machine of triage roles.
- **[improve-codebase-architecture](./improve-codebase-architecture/SKILL.md)** — Find deepening opportunities in a codebase, informed by the domain language in `CONTEXT.md` and the decisions in `docs/adr/`.
- **[setup-yolo-skills](./setup-yolo-skills/SKILL.md)** — Scaffold the per-repo config (issue tracker, triage label vocabulary, domain doc layout) that the other engineering skills consume.
- **[setup-yard](./setup-yard/SKILL.md)** — Onboard a repo into the yard fleet: write `.yard/config.yml` with a unique project code, create the 9 yard labels, verify with `agent doctor` + `agent plan`. Idempotent.
- **[ship-prd](./ship-prd/SKILL.md)** — Execute a yard-ready PRD (parent + child slices) by hand without the yard fleet: subagents follow yard's implement→review→merge prompts, model tier picked from `difficulty:*` labels, up to 3 slices in parallel via worktrees.
- **[review-sweep](./review-sweep/SKILL.md)** — Documentation for yard's `./agent review-sweep` CLI. Processes GitHub items labelled `ready-for-review` via one Claude API call per item with structured `tool_use` verdict (`ok`/`file-issue`/`file-prd`/`escalate`). 10-50× cheaper than a sandcastle agent review.
- **[tdd](./tdd/SKILL.md)** — Test-driven development with a red-green-refactor loop. Builds features or fixes bugs one vertical slice at a time.
- **[to-issues](./to-issues/SKILL.md)** — Break any plan, spec, or PRD into independently-grabbable GitHub issues using vertical slices.
- **[to-prd](./to-prd/SKILL.md)** — Turn the current conversation context into a PRD and submit it as a GitHub issue.
- **[zoom-out](./zoom-out/SKILL.md)** — Tell the agent to zoom out and give broader context or a higher-level perspective on an unfamiliar section of code.
- **[prototype](./prototype/SKILL.md)** — Build a throwaway prototype to flush out a design — either a runnable terminal app for state/business-logic questions, or several radically different UI variations toggleable from one route.
