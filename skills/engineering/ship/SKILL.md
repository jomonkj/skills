---
name: ship
description: Execute a yard-ready PRD or scope end-to-end on top of the deterministic `yard` CLI — resolve scope → dispatch unblocked slices to parallel worktree subagents (implement → self-review → dedicated review → merge-check → PR → CI → squash-merge) → return a deterministic run summary. `--plan` mode does a read-only pre-flight (asks genuine choices, lists blockers, emits the /goal command) before AFK. Replaces ship-prd; uses the `yard` CLI for all gh/git plumbing, not yard/prompts. Use after a grill produced a Yard-labelled PRD (or for a label/issue scope), to drive it to merged under /goal.
---

# Ship

The human-facing verb of the ship workflow. `/ship` does **one batch**; `/goal` loops it until every in-scope unit is terminal. All gh/git/label plumbing is the deterministic, zero-AI `yard` CLI (`skills/bin/yard`, ADR 0003) — this skill is orchestration + judgement only.

This supersedes `ship-prd`. The difference: `ship-prd` read phase instructions from `yolo-hq/yard/prompts/*.md`; `/ship` carries its own prompts in `./prompts/` and calls the `yard` CLI for every deterministic step (scope resolution, dep graph, worktree/branch/label lifecycle, CI wait, sweep). No dependency on the `yard/` repo.

## Args

`/ship <scope> [--plan]`

- `<scope>` — `prd:<repo>#<n>` · `prd:#<n>` (cwd repo) · `label:<name>` · `issue:<repo>#<n>` · `issue:#<n>` · `all`. If absent, list open `PRD`-labelled issues and ask A/B/C which.
- `--plan` — read-only pre-flight. Resolve + report, do **not** dispatch. See [Pre-flight](#pre-flight-plan-mode).

## Mandatory pre-flight (always)

1. `cd` to the project git repo that owns the scope (worktree isolation needs a real `.git`; the workspace root is not one). Verify `.git`.
2. Resolve the project `code` (2–4 char) from the registry via `yard` (or `.yard/config.yml` `code:`); auto-derive if absent (single word → first 2 chars; hyphenated → first char of each, max 3; `/^[a-z0-9]{2,4}$/`).
3. `gh` repo footgun: if the repo has multiple remotes, every `yard`/`gh` call must target the intended repo explicitly (`--repo <owner>/<name>`). Never operate on an upstream you only meant to read.
4. Materialise dependencies the scope needs: `yard ensure <expr> --project <p> --profile <name>` (deterministic, no AI). A `--plan` run reports what *would* be materialised; execute mode runs it.

## Pre-flight (`--plan` mode)

`--plan` is the execute path stopped before dispatch. It MUST NOT mutate the filesystem.

1. `yard scope <expr>` + `yard deps <expr>` → the work set and topo-ordered batches. Cycles → fail loud, name the cycle, NO-GO.
2. Readiness check each unit: has AC, has a `difficulty:*`, blockers resolvable, `needs` satisfiable (cross-ref `yard ensure --dry-run`-style report).
3. **Genuine choices** (ship order ambiguity, missing difficulty, cross-repo strategy) → ask the operator A/B/C-style, one at a time, recommend one, wait. **Hard readiness gaps** (no AC, dependency cycle, unsatisfiable `needs`) → list as blockers; stay **NO-GO** until cleared (not a question).
4. End with an explicit **GO / NO-GO** line. On GO, emit the exact copy-pasteable `/goal` command, written to the goal docs' rules: one measurable end state, a stated check (`yard scope … --state open` empty / units terminal in the run summary), a turn/time bound clause, ≤4000 chars.

## Dispatch loop (execute mode)

Repeat until every in-scope unit is terminal (`merged` / `awaiting-human-merge` / `hitl` / `failed`):

1. `yard scope` + `yard deps` → unblocked, not-in-flight, not-terminal units.
2. Select up to **3** (parallelism cap, fixed v1 — ADR 0007). Also dedicate-review early any slice with dep fan-out ≥ 2 (blast-radius, ADR 0004) even if not at a main-branch boundary.
3. For each, one **`yard dispatch-init`** (worktree at `.yard/worktrees/yd-<code>-issue-N`, branch `yd/<code>/issue-N`, atomic `phase:queued`→`implementing`+lease). Then one Agent call per slice, `isolation: "worktree"`, model from [tier](#escalation), running **all phases in one conversation on one worktree** (ADR 0002 — the Agent tool has no `cwd`; split phases = split worktrees = broken). Issue N concurrent Agent calls in **one message**.
4. Each Agent runs: read repo rules → implement → mechanical+calibrated **self-review** → **dedicated review** (the `review` skill, fresh-eyes, Standards+Spec — fires per [Review trigger](#review-trigger)) → merge-check → push → open PR → `yard ci-wait` → squash-merge (or, at a main-branch boundary per ADR 0005, open PR and stop with `AWAITING_HUMAN_MERGE`). Phase prompts are in [`./prompts/`](./prompts).
5. Collect promises. `yard dispatch-done --outcome <terminal>` for each (atomic terminal label move; protected-branch guard before any delete; worktree teardown only on `merged`). Apply the [Escalation FSM](#escalation).
6. Loop. Zero advance in a full iteration → stop, report.
7. `yard sweep` orphaned worktrees (merged/closed only; protected guard enforced).

## Review trigger

The **dedicated review** (the promoted `review` skill — two axes, Standards + Spec) fires at the unit-of-delivered-intent boundary: the feature→release-line PR (once per PRD) and a parentless-issue→release-line PR (once per bare issue), **plus** early on any slice with dependency fan-out ≥ 2 (ADR 0004). A slice that is a fragment of a PRD gets the cheap **self-review** only (mechanical evidence-checklist + calibrated author-bias statement; no adversarial leg — ADR 0004); its intent rolls up to the PRD review. Severity split on findings: hard (spec requirement missing/wrong) → keep unit open + escalate to human; soft → file follow-up issues via `yard issue-create`, let the loop self-heal.

## Escalation

Tier ladder **sonnet → opus → HITL** (ADR 0007; haiku is not an implementation tier). Initial tier from `difficulty:*` (`easy|medium`→sonnet, `hard`→opus). A slice **fails** when, within its tier's iteration budget, it does not reach a verified `COMPLETE` (explicit `CANT_FIX`, budget exhausted, self-review never passes, change-gate red, unrecoverable crash, dedicated review returns unfixable hard findings). `fail` → escalate a tier; `CANT_FIX` → escalate immediately (don't burn budget), at top tier → HITL; `blocked` → waiting on a dep, not a failure. Before declaring HITL, make **one bounded orchestrator rescue attempt** *only* when the failure smells cross-slice (integration error, sibling interface change, a dep just merged) — the orchestrator sees the whole PRD/dep-graph a single-slice agent cannot. Raw "too hard" `CANT_FIX` with no cross-slice signal → straight HITL (a retry just burns tokens). HITL is never silent: `phase:hitl` label + reason comment + a run-summary line.

## Run summary (the contract)

Deterministic, terminal-state-complete. It is both the human report and the text `/goal`'s evaluator reads — so every in-scope unit MUST resolve to `merged | awaiting-human-merge | hitl | failed | blocked`, with: HITL items + reasons + links; conflicts (auto-resolved / semantic-with-rationale / HITL); forward-merge hop results; dedicated-review outcomes (pass / soft-followups-filed / hard-escalated); follow-up issues filed; and cost — tokens, $ estimate, wall time, dispatch count, escalations per tier. **Cost is summed from session/usage logs, never a last-message snapshot** (a prior yard metric bug undercounted ~128× by snapshotting — must not recur).

The **final** run summary (every unit terminal) leads with `✅ GOAL MET — every in-scope unit terminal`, then the contract body, then a short tail: **deferred-by-design** items + **next action**. This marker is for the `/goal` evaluator (unambiguous yes) and a human scanning the transcript (ADR 0007). Not a separate report — a one-line-plus extension of the contract.

## Long tests

Per-slice change gate runs only affected tests (fast, sync). Feature→release-line full suite is fired **async** (CI/background), PR sits behind a `tests-running` label, the loop moves on, a later turn reconciles → `AWAITING_HUMAN_MERGE` (green) or HITL (red). `yard ci-wait` is bounded; a multi-hour suite is fire-and-track via labels, never a blocking wait (a hung wait stalls the whole AFK run — ADR 0007).

## Close the PRD

All children merged → comment on the PRD with the per-slice PR table, then `yard`/`gh issue close <PRD> --reason completed` (always `--repo` explicit). Any HITL/failed → leave open, comment per-child state, operator decides.

## What this does NOT do

- Does not delete protected branches — `yard`'s protected-branch guard refuses (ADR 0006/0007); checked before any branch delete.
- Does not retry beyond the FSM budget; HITL is terminal for the loop.
- Does not author or merge feature→main itself when ADR 0005 says a human merges — it opens the PR, emits `AWAITING_HUMAN_MERGE`, stops; `/goal` treats that as loop-terminal.
- Does not modify the registry directly — only `yard` mutators write it.
- Does not read `yolo-hq/yard/prompts/` — prompts live in [`./prompts/`](./prompts).

## Notes

- Bootstrap: `/ship` cannot build `/ship`. The first build of anything is by hand or, transitionally, `ship-prd` (kept as fallback until `/ship` ships one real PRD green — then `ship-prd` is deleted, completing the big-bang one cycle later).
- For a single fast slice that should skip the merge gate, use `/tdd`.
- The post-run **retro** (ADR 0007) reports *workflow*-health follow-ups (repeat failures, conflict hotspots) via `yard issue-create`; it never self-modifies the workflow.
