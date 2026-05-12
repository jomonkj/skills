---
name: ship-prd
description: Execute a yard-ready PRD (parent issue + child slices) by hand without the yard fleet orchestrator. Spawns subagents that follow yard's own prompts (implement → review → merge), picks model tier from difficulty labels, runs up to 3 slices in parallel via worktrees. Use after a grilling session that produced a PRD with Yard-labeled child slices.
---

# Ship PRD

Manual replacement for the yard fleet orchestrator. Takes one PRD (parent issue + its child slices), executes every slice to PR-open, in dependency order.

This skill is **orchestration glue only**. The phase-specific instructions (what the implementer/reviewer/merger actually do) are read at runtime from `yolo-hq/yard/prompts/*.md` so the skill stays current as yard's workflow evolves.

## Args

`/ship-prd <prd-ref>` — PRD as `<repo>#<num>` (e.g. `lbrmi/yard#186`), a full URL, or just `#<num>` if `cwd` is the project repo. If missing, ask the operator A/B/C-style which PRD to ship (list open issues with `PRD` label).

## Inputs the skill reads at runtime

| Path | What for |
|---|---|
| `<workspace>/yard/prompts/implement-prompt.md` | Implementer phase instructions |
| `<workspace>/yard/prompts/review-prompt.md` | Reviewer phase instructions (when Reviewer fires — see [Reviewer trigger](#reviewer-trigger)) |
| `<workspace>/yard/prompts/merge-prompt.md` | Merger phase instructions (always) |
| `<workspace>/yard/CONTEXT.md` | Glossary + scheduling rules |
| Project repo's `CLAUDE.md` | Project-specific conventions |
| PRD body via `gh issue view <prd>` | High-level decisions, ship order |
| Child issue bodies via `gh issue view <child>` | AC, `## Blocked by`, `## Parent` |

If `<workspace>/yard/prompts/` is missing, **fail loud**: tell operator either the yard repo path differs from `~/projects/yolo-hq/yard` or yard's prompt layout has changed — and stop. Do not invent prompts.

## Workspace assumption

Default workspace root is `~/projects/yolo-hq`. The skill expects the yard repo to be a sibling of the project being shipped. If the PRD's repo is not in this workspace, ask the operator for the workspace root before continuing.

## Working directory (mandatory pre-flight)

`isolation: "worktree"` on the Agent tool creates a temp worktree from the parent's git repo. **The yolo-hq workspace is NOT a git repo** (see workspace `CLAUDE.md`), so all Agent calls must be made from inside the project repo that owns the PRD.

Before the dispatch loop:

1. Resolve PRD repo → local path. Default mapping: `<owner>/<name>` → `<workspace>/<name>` (e.g. `lbrmi/yard` → `~/projects/yolo-hq/yard`). If the dir doesn't exist or has no `.git`, ask the operator for the correct path.
2. `cd` to that path. Verify `.git` exists with `test -d .git || test -f .git`.
3. All subsequent Agent calls happen from this cwd.

**Cross-repo PRDs**: default assumption is **all children share the PRD's repo**. Only deviate when an explicit child issue URL points at a different repo. If children DO touch multiple repos (rare), batch slices by repo and process the batches sequentially — within one batch, the cap-3 parallelism rule applies, and the skill `cd`s between batches.

## Process

### 1. Resolve PRD and children

```bash
gh issue view <prd-num> --repo <repo> --json title,body,labels,number
gh issue list --repo <repo> --search "Parent #<prd-num> in:body" --label Yard --state open --json number,title,labels,body --limit 100
```

Children may also be referenced in PRD body's ship order — cross-check both.

For each child, parse `## Blocked by` section for blocker issue numbers. Result: `{ issue: N, blockers: [M, ...], difficulty: easy|medium|hard, needAgentReview: bool }`.

### 2. Build dependency graph

Topological sort. Detect cycles → fail loud, name the cycle, stop.

### 3. Read yard's phase prompts

```bash
cat <workspace>/yard/prompts/implement-prompt.md
cat <workspace>/yard/prompts/review-prompt.md
cat <workspace>/yard/prompts/merge-prompt.md
```

Keep them in memory. Substitute these placeholders per dispatch:

| Placeholder | Value |
|---|---|
| `{{TASK_ID}}` | Child issue number |
| `{{ISSUE_TITLE}}` | Child issue title |
| `{{PROJECT_SLUG}}` | Repo (e.g. `lbrmi/yard`) |
| `{{SOURCE_BRANCH}}` | The literal string `(the branch the worktree gave you — run \`git branch --show-current\` to check)` — see [Branch name caveat](#branch-name-caveat) |
| `{{TARGET_BRANCH}}` | `origin/HEAD` of the project repo (compute once with `git symbolic-ref refs/remotes/origin/HEAD --short`) |

### 4. Dispatch loop (autopilot)

Repeat until every child is either `merged` or `failed`:

1. Find **unblocked, not-yet-dispatched, not-merged** children (all `## Blocked by` references closed).
2. Select up to **3** for this round (parallelism cap).
3. For each, run [Per-issue dispatch](#per-issue-dispatch) below. Use **a single message with N parallel Agent tool calls** so they run concurrently. Each Agent gets `isolation: "worktree"` so files don't collide.
4. Collect results. Update local state (`{ N: "merged" | "failed" | "blocked" }`).
5. Loop.

If no children advance in a full iteration (zero merges, all in-flight returned failed) → stop, report.

### 5. Per-issue dispatch

**One Agent call per slice runs all three phases in sequence inside the same conversation, on the same worktree.** This is mandatory: Claude Code's Agent tool has no `cwd` parameter and `isolation: "worktree"` creates a fresh worktree per call — so we cannot hand a worktree off between separate Agent calls.

For each scheduled child issue, make one Agent call:

- `subagent_type: "general-purpose"`
- `isolation: "worktree"` (Agent creates one worktree for the slice; it lives for the whole implementer→reviewer→merger run)
- `model`: from [Model selection](#model-selection)
- `description`: e.g. `"Ship slice #142"`
- `prompt`: **concatenated phase prompts**, in this order:

```
<phase-1-implementer>
{contents of yard/prompts/implement-prompt.md with placeholders substituted}
</phase-1-implementer>

After the Implementer phase produces `<promise>COMPLETE</promise>`, switch
roles and run Phase 2 in this same conversation, on this same git worktree:

<phase-2-reviewer>
{contents of yard/prompts/review-prompt.md, substituted — INCLUDE THIS BLOCK ONLY IF Reviewer should fire per [Reviewer trigger]}
</phase-2-reviewer>

After the Reviewer phase completes, switch roles and run Phase 3 in this
same conversation, on this same git worktree:

<phase-3-merger>
{contents of yard/prompts/merge-prompt.md, substituted}
</phase-3-merger>

NOTE: yard's merge-prompt.md only VERIFIES merge-readiness. It does NOT
push or open a PR — yard's deterministic merger does that step
separately. Since this skill replaces yard's deterministic merger, you
must do Phase 4 yourself:

<phase-4-publish>
After Phase 3 emits `<promise>COMPLETE</promise>`:
  1. Push the worktree's branch to origin:
       BRANCH=$(git branch --show-current)
       git push -u origin "$BRANCH"
  2. Open the PR:
       gh pr create \
         --repo {{PROJECT_SLUG}} \
         --base {{TARGET_BRANCH}} \
         --head "$BRANCH" \
         --title "{{ISSUE_TITLE}}" \
         --body "Closes #{{TASK_ID}}"
     Capture the PR URL from the gh output.
  3. Do NOT auto-merge the PR. Operator merges manually.
</phase-4-publish>

If any phase emits `<promise>CANT_FIX</promise>`, stop and return that
signal. If the Implementer never reaches COMPLETE, stop after the
Implementer phase. Do not invent extra phases.

Reviewer may identify issues during Phase 2; since all phases run in
this same conversation, fix them yourself (as the same agent) before
moving to Phase 3.

Final-message contract (the parent skill greps these from your return):
  - On success of all four phases: end with `<promise>COMPLETE</promise>`
    and the PR URL on the line above it (`PR: https://github.com/...`).
  - On CANT_FIX: end with `<promise>CANT_FIX</promise>` and one line
    naming the phase that emitted it (e.g. `PHASE: implementer`).
  - On any other terminal state: end with `<promise>FAILED</promise>` and
    the last 40 lines of the failure output.
```

**Parsing the Agent's return**: the skill regex-matches the subagent's final message for:

```
<promise>(COMPLETE|CANT_FIX|FAILED)</promise>
```

| Signal | Action |
|---|---|
| `COMPLETE` | Confirm PR via `gh pr list --head <SOURCE_BRANCH> --repo <repo>`. Mark issue `merged`. |
| `CANT_FIX` | Escalate tier (easy→medium→hard) and re-dispatch as a fresh Agent call (new worktree, but the issue branch on origin still has earlier commits if the implementer pushed). At `hard` already → mark `hitl`, `gh issue edit --add-label phase:hitl`, comment, stop slice. |
| `FAILED` | Comment on issue with the captured 40 lines. Mark slice `failed`. **No retry** — a fresh Agent call gets a fresh worktree and the prior commits are gone (unless they were pushed to origin), so a retry would start from HEAD and re-do the work. Operator decides whether to re-run the whole skill or fix the slice manually. |
| Signal absent | Treat as `FAILED`. |

**Do not auto-merge PRs.** Operator merges manually after reading them.

### 6. Final report

After the dispatch loop terminates, print a single table:

```
| Issue | Phase reached | PR | Notes |
```

And a one-line summary: `Shipped X/Y slices to PR. Z failed. W in HITL.`

## Model selection

Read `difficulty:*` label on each child:

| Label | Implementer | Reviewer | Merger |
|---|---|---|---|
| `difficulty:easy` | haiku | haiku | haiku |
| `difficulty:medium` (or absent) | sonnet | sonnet | sonnet |
| `difficulty:hard` | opus | opus | opus |

Same model across all three phases matches yard's "session-resume cache" rule. If yard's `fleet.config.ts` overrides this mapping, prefer its values (read `<workspace>/yard/fleet.config.ts` for `models.byTier`).

In Claude Code, pass `model: "haiku" | "sonnet" | "opus"` to the Agent tool call.

## Reviewer trigger

Yard is mid-migration on Reviewer policy (PRD #186 retires the `need-agent-review` opt-in label and makes Reviewer always-on). Skill applies the **current** rule by inverting the result of a single grep:

```bash
if grep -q review_required <workspace>/yard/src/run.ts 2>/dev/null; then
  # Field still present → old behaviour: Reviewer is opt-in via need-agent-review label
  REVIEWER_MODE=opt-in
else
  # Field deleted → PRD #186 PR 3 has shipped → Reviewer is always-on
  REVIEWER_MODE=always
fi
```

**Note the inversion:** "field present" → opt-in, "field absent" → always-on. This is intentional — the field's presence IS the signal that the old gate logic still runs. Do not second-guess; check once at run start and stick with the result.

In `opt-in` mode, include the Phase 2 reviewer block in the Agent prompt **only** for children with `need-agent-review` label.
In `always` mode, include it for every child.

## Branch name caveat

`isolation: "worktree"` picks its own branch name when it creates the worktree. The yard implement-prompt's "You are on branch `{{SOURCE_BRANCH}}`" sentence would be a lie if templated naively. Skill resolution:

- Don't pretend yard's `yd/<code>/issue-N` convention is the branch.
- Tell the subagent (in the substituted prompt) to use whatever branch the worktree gave it: `git branch --show-current`. PR creation via `gh pr create` works against any branch name.
- If the operator later wants yard's branch convention applied retroactively (so future yard runs pick up unmerged work), they can `git branch -m` the PR's branch after merging — out of scope for this skill.

## Worktree management

`isolation: "worktree"` on each Agent call gives that slice its own worktree for the duration of the call. **All three phases (implementer → reviewer → merger) run inside the SAME Agent call**, so they share that one worktree automatically. The skill never invokes `git worktree add` directly.

Sequential chains (slice B blocks on slice A) → A's Agent finishes (its worktree closes), then B's Agent starts with a fresh worktree branched off the host. A's commits are visible to B only after the operator merges A's PR; if B depends on A's unmerged work, mark B as blocked-by-PR-not-issue and skip until the operator merges.

## Failure modes

- **Cycle in `## Blocked by`** → fail loud, list cycle members, stop. Do not auto-break.
- **Yard prompts missing** → fail loud (see [Inputs](#inputs-the-skill-reads-at-runtime)).
- **PRD has no Yard-labeled children** → ask operator: is this PRD ready to ship, or should we run `/to-issues` first?
- **Project's baseline (typecheck/test) red on host branch** → yard's implement-prompt.md already handles this (the subagent will post a "pre-existing failures" comment and abort the slice); skill records it as failed for that slice and continues with others.
- **Operator interrupt** → standard Claude Code interrupt; in-flight worktree subagents finish their current step, results aren't lost (commits are on disk).

## What this skill explicitly does NOT do

- Does not merge PRs (operator does it manually after reviewing the PR).
- Does not close the PRD (operator does it; once closed, yard's `need-agent-review` PRD label may trigger review-sweep separately).
- Does not modify yard's prompts.
- Does not invent new labels — uses only `phase:hitl`, `phase:queued`, etc. that yard already defined.
- Does not handle Reviewer/Merger fail loop-back beyond ONE retry (yard's full FSM is more elaborate; this skill is a manual one-shot, not a daemon).

## Notes

- This skill assumes the operator wants quality-first ship (full implement → review → merge gate). For speed-first one-off slices, use `/tdd` instead — it skips the review/merge gates.
- For batch grilling output that hasn't been broken into issues yet, run `/to-issues` first, then `/ship-prd`.
- If yard's workflow changes substantively (e.g. a new phase added, or merger logic moves out of the prompts into code), update the [Process](#process) section here — but the prompts themselves stay in `yard/prompts/`.
