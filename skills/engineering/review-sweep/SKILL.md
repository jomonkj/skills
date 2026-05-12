---
name: review-sweep
description: Run yard's review-sweep CLI to triage GitHub items labelled `ready-for-review`. Each item gets one Claude API call returning a structured verdict (`ok` / `file-issue` / `file-prd` / `escalate`); code maps the verdict to gh actions. Stateless — depends only on GitHub labels. Use when an operator wants a cheap AFK review pass over recently-closed issues and "all-children-merged" PRDs. Implementation lives in yard, not in this skills repo.
disable-model-invocation: true
---

# review-sweep

Process items carrying the `ready-for-review` GitHub label using one `claude.messages.create` call per item with `tool_use`-forced structured output. ADR 0027 in the yard repo holds the full design.

## Why this skill

Running a sandcastle agent over every "done" item costs $5-15/each. Most of that is the tool-use exploration loop — the actual verdict is one structured decision. review-sweep gathers context deterministically (gh + git), then asks Claude for one JSON verdict via tool-use. Cost drops 10-50x.

## Inputs

- Required env: `ANTHROPIC_API_KEY` (the SDK reads it automatically).
- Required env: `GH_TOKEN` or `gh auth status` good.
- `YARD_HOME` env pointing at your yard clone.

## Usage

```bash
cd "$YARD_HOME"
./agent review-sweep --repo <owner>/<repo> [--repo <owner>/<repo>] [--max 10] [--budget 10]
```

| Flag | Default | Meaning |
|---|---|---|
| `--repo <owner>/<repo>` | (required) | Repo(s) to sweep. Repeat for multiple. |
| `--max N` | 10 | Stop after processing N eligible items. |
| `--budget USD` | 10 | Halt when cumulative API spend reaches this cap. |

## Eligibility

An item is processed when it carries `ready-for-review` AND:

- (PRD, state=open) — code-driven check via the `PRD` label.
- (issue, state=closed).

`ready-for-review` on an OPEN non-PRD issue is a misuse: the skill posts one comment explaining the rule, strips the label, and moves on (no AI call).

## Verdicts (AI emits exactly one via `emit_verdict` tool)

| Verb | PRD action | Issue action |
|---|---|---|
| `ok` | Close PRD + add `Yard:auto-closed` | Post "looks good" comment |
| `file-issue` | Create N follow-up issues (`Yard, auto-followup, ready-for-agent`) + comment with markdown checkboxes + `Yard:swept-action-taken` | Same |
| `file-prd` | Create one follow-up PRD (`PRD, auto-followup`) + `Yard:swept-action-taken` | Same |
| `escalate` | Post escalation comment with markdown checkbox per gap + `Yard:swept-escalated` | Same |

The `ready-for-review` label is removed in every case.

## Hard escalate rules (post-AI, deterministic)

The verdict is forced to `escalate` when:

- any child of the PRD is in `failed` / `errored` / `interrupted`,
- the AI returned more than 3 gaps, or
- the PRD has zero children.

## Where the code lives

- CLI entry: `<yard>/src/review-sweep.ts`
- Submodules: `<yard>/src/review-sweep/{order,gather,decide,act}.ts`
- Tests (all mock `claude.messages.create` — zero token cost): `<yard>/tests/review-sweep*.test.ts`
- ADR: `<yard>/docs/adr/0027-review-sweep-skill.md`
