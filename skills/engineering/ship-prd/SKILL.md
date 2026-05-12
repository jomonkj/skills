---
name: ship-prd
description: Execute a yard-ready PRD (parent issue + child slices) end-to-end without the yard fleet orchestrator — implement → review → merge-check → PR open → wait for CI → squash-merge to default branch → delete branch. Spawns subagents that follow yard's own prompts, picks model tier from difficulty labels, runs up to 3 slices in parallel via worktrees, escalates failures through yard's tier FSM (haiku → sonnet → opus → HITL). Use after a grilling session that produced a PRD with Yard-labeled child slices.
---

# Ship PRD

Manual replacement for the yard fleet orchestrator. Takes one PRD (parent issue + its child slices), executes every slice end-to-end (PR opened → CI green → squash-merged to default branch → source branch deleted), in dependency order. Closes the PRD with a summary comment once every child has merged.

This skill is **orchestration glue only**. The phase-specific instructions (what the implementer/reviewer/merger actually do) are read at runtime from `yolo-hq/yard/prompts/*.md` so the skill stays current as yard's workflow evolves.

## Args

`/ship-prd <prd-ref>` — PRD as `<repo>#<num>` (e.g. `yolo-hq/yolo#612`), a full URL, or just `#<num>` if `cwd` is the project repo. If missing, ask the operator A/B/C-style which PRD to ship (list open issues with `PRD` label).

## Inputs the skill reads at runtime

| Path | What for |
|---|---|
| `<workspace>/yard/prompts/implement-prompt.md` | Implementer phase instructions |
| `<workspace>/yard/prompts/review-prompt.md` | Reviewer phase instructions (when Reviewer fires — see [Reviewer trigger](#reviewer-trigger)) |
| `<workspace>/yard/prompts/merge-prompt.md` | Merger phase instructions (always) |
| `<workspace>/yard/CONTEXT.md` | Glossary + scheduling rules |
| Project repo's `CLAUDE.md` | Project-specific conventions |
| Project repo's `.yard/config.yml` | `code:` field — 2–4 char project code used in branch names ([ADR 0019](../../../../yard/docs/adr/0019-branch-and-worktree-naming.md)). Auto-derive if missing. |
| PRD body via `gh issue view <prd>` | High-level decisions, ship order |
| Child issue bodies via `gh issue view <child>` | AC, `## Blocked by`, `## Parent` |

If `<workspace>/yard/prompts/` is missing, **fail loud**: tell operator either the yard repo path differs from `~/projects/yolo-hq/yard` or yard's prompt layout has changed — and stop. Do not invent prompts.

## Workspace assumption

Default workspace root is `~/projects/yolo-hq`. The skill expects the yard repo to be a sibling of the project being shipped. If the PRD's repo is not in this workspace, ask the operator for the workspace root before continuing.

## Working directory (mandatory pre-flight)

`isolation: "worktree"` on the Agent tool creates a temp worktree from the parent's git repo. **The yolo-hq workspace is NOT a git repo** (see workspace `CLAUDE.md`), so all Agent calls must be made from inside the project repo that owns the PRD.

Before the dispatch loop:

1. Resolve PRD repo → local path. Default mapping: `<owner>/<name>` → `<workspace>/<name>` (e.g. `yolo-hq/yolo` → `~/projects/yolo-hq/yolo`). If the dir doesn't exist or has no `.git`, ask the operator for the correct path.
2. `cd` to that path. Verify `.git` exists with `test -d .git || test -f .git`.
3. Resolve the project code from `<project>/.yard/config.yml`'s `code:` field. If absent, auto-derive per [Naming convention](#naming-convention).
4. Compute target branch once: `git symbolic-ref refs/remotes/origin/HEAD --short` (strip the `origin/` prefix for the `--base` arg of `gh pr create`).
5. All subsequent Agent calls happen from this cwd.

**Cross-repo PRDs**: default assumption is **all children share the PRD's repo**. Only deviate when an explicit child issue URL points at a different repo. If children DO touch multiple repos (rare), batch slices by repo and process the batches sequentially — within one batch, the cap-3 parallelism rule applies, and the skill `cd`s between batches. Resolve the project code per batch.

## Process

### 1. Resolve PRD and children

```bash
gh issue view <prd-num> --repo <repo> --json title,body,labels,number
gh issue list --repo <repo> --search "Parent #<prd-num> in:body" --label Yard --state open --json number,title,labels,body --limit 100
```

Children may also be referenced in PRD body's ship order — cross-check both.

For each child, parse `## Blocked by` section for blocker issue numbers. Resolve blocker state (closed → unblocked; open → still blocking). Result: `{ issue: N, blockers: [M, ...], difficulty: easy|medium|hard, needAgentReview: bool, tier: easy|medium|hard }`.

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
| `{{PROJECT_SLUG}}` | Repo (e.g. `yolo-hq/yolo`) |
| `{{SOURCE_BRANCH}}` | `yd/<code>/issue-N` per [Naming convention](#naming-convention) — the subagent creates this branch on top of the worktree's auto-branch before its first commit |
| `{{TARGET_BRANCH}}` | `origin/<host_branch>` of the project repo (use the value of `host_branch:` from `.yard/config.yml` if set, else `git symbolic-ref refs/remotes/origin/HEAD --short`) |

### 4. Dispatch loop (autopilot)

Repeat until every child is in a terminal state (`merged`, `hitl`, or `failed`):

1. Find **unblocked, not-yet-dispatched, not-merged** children (all `## Blocked by` references closed AND not currently in-flight at any tier).
2. Select up to **3** for this round (parallelism cap).
3. For each, run [Per-issue dispatch](#per-issue-dispatch) below. Use **a single message with N parallel Agent tool calls** so they run concurrently. Each Agent gets `isolation: "worktree"` so files don't collide.
4. Collect results. Apply the [Escalation FSM](#escalation-fsm) to each result; update local state (`{ N: "merged" | "hitl" | "failed" | "blocked" | { retry-at-tier: medium } }`).
5. Loop.

If no children advance in a full iteration (zero merges, all in-flight returned non-mergeable terminals) → stop, report.

### 5. Per-issue dispatch

**One Agent call per slice runs all six phases in sequence inside the same conversation, on the same worktree.** This is mandatory: Claude Code's Agent tool has no `cwd` parameter and `isolation: "worktree"` creates a fresh worktree per call — so we cannot hand a worktree off between separate Agent calls.

For each scheduled child issue, make one Agent call:

- `subagent_type: "general-purpose"`
- `isolation: "worktree"` (Agent creates one worktree for the slice; it lives for the whole implementer→reviewer→merger→publish→ci-wait→merge run)
- `model`: from [Model selection](#model-selection)
- `description`: e.g. `"Ship slice #142"`
- `prompt`: **concatenated phase prompts**, in this order:

```
You are shipping issue {{TASK_ID}} in {{PROJECT_SLUG}} end-to-end (Implementer → Reviewer → Merger → Publish → Wait-CI → Merge) inside a single conversation on the same git worktree.

FIRST STEP — load credentials so `gh` works:
  set -a; source <workspace>/yard/.env; set +a
Verify: `gh auth status` and `gh repo view {{PROJECT_SLUG}}`. If gh fails → abort with `<promise>FAILED</promise>` + the auth error.

SECOND STEP — RENAME THE WORKTREE BRANCH to yard's convention:
  CURRENT=$(git branch --show-current)
  git branch -m "$CURRENT" "{{SOURCE_BRANCH}}"
Everywhere the phase prompts mention `{{SOURCE_BRANCH}}`, that resolves to `yd/<code>/issue-N`. The host (target) branch is `{{TARGET_BRANCH}}`.

<phase-1-implementer>
{contents of yard/prompts/implement-prompt.md with placeholders substituted}
</phase-1-implementer>

After the Implementer phase produces `<promise>COMPLETE</promise>`, switch roles and run Phase 2 in this same conversation, on this same git worktree:

<phase-2-reviewer>
{contents of yard/prompts/review-prompt.md, substituted — INCLUDE THIS BLOCK ONLY IF Reviewer should fire per [Reviewer trigger]}
</phase-2-reviewer>

After the Reviewer phase completes, switch roles and run Phase 3 in this same conversation, on this same git worktree:

<phase-3-merger>
{contents of yard/prompts/merge-prompt.md, substituted}
</phase-3-merger>

NOTE: yard's merge-prompt.md only VERIFIES merge-readiness. It does NOT push, open a PR, or merge — yard's deterministic merger does those steps separately. Since this skill replaces yard's deterministic merger entirely, you must do Phases 4–6 yourself:

<phase-4-publish>
After Phase 3 emits `<promise>COMPLETE</promise>`:
  1. Push the worktree's branch to origin:
       git push -u origin {{SOURCE_BRANCH}}
  2. Open the PR (capture URL from output):
       PR_URL=$(gh pr create \
         --repo {{PROJECT_SLUG}} \
         --base <host_branch> \
         --head {{SOURCE_BRANCH}} \
         --title "{{ISSUE_TITLE}}" \
         --body "Closes #{{TASK_ID}}")
       echo "$PR_URL"
       PR_NUM=$(echo "$PR_URL" | awk -F/ '{print $NF}')
</phase-4-publish>

<phase-5-wait-ci>
After Phase 4 has a PR_NUM:
  1. Poll `gh pr checks $PR_NUM --repo {{PROJECT_SLUG}}` every 30s.
  2. Timeout: 15 minutes wall-clock. On timeout → emit `<promise>FAILED</promise>` with `CI_TIMEOUT` and the latest checks output.
  3. Required checks state:
     - All `pending` → keep polling.
     - All `pass` (clean) → continue to Phase 6.
     - Any `fail` → emit `<promise>CI_FAILED</promise>` with the failing check name(s) and the last ~40 lines from `gh run view <run-id> --log-failed` (use the run-id of the first failed check). The parent skill applies the [Escalation FSM](#escalation-fsm) to decide what to do next.
</phase-5-wait-ci>

<phase-6-merge>
After Phase 5 emits CI clean:
  gh pr merge $PR_NUM --repo {{PROJECT_SLUG}} --squash --delete-branch
Verify:
  gh pr view $PR_NUM --repo {{PROJECT_SLUG}} --json state,mergedAt
State must be `MERGED` with a non-null `mergedAt`.
</phase-6-merge>

If any phase emits `<promise>CANT_FIX</promise>`, stop and return that signal. If the Implementer never reaches COMPLETE, stop after the Implementer phase. Do not invent extra phases.

Reviewer may identify issues during Phase 2; since all phases run in this same conversation, fix them yourself (as the same agent) before moving to Phase 3.

Final-message contract (the parent skill greps these from your return):
  - On success of all six phases: end with `PR: <URL>` on one line, then `<promise>MERGED</promise>` on the next.
  - On Reviewer-completed-but-CI-failed: end with `PR: <URL>`, then `CI_FAILED: <check-name>` and the last 40 lines of failing logs, then `<promise>CI_FAILED</promise>`.
  - On CANT_FIX: end with `PHASE: <phase-name>`, then `<promise>CANT_FIX</promise>`.
  - On any other terminal state: end with the last 40 lines of failure output, then `<promise>FAILED</promise>`.
```

**Parsing the Agent's return**: the skill regex-matches the subagent's final message for:

```
<promise>(MERGED|CI_FAILED|CANT_FIX|FAILED)</promise>
```

| Signal | Action |
|---|---|
| `MERGED` | Confirm PR is merged via `gh pr view <N> --json state`. Mark issue `merged`. |
| `CI_FAILED` | Apply [Escalation FSM](#escalation-fsm) → retry-at-same-tier OR escalate-to-next-tier OR HITL. Re-dispatch a fresh Agent call (new worktree). On retry, prepend the captured failing-checks logs to the implementer prompt so the new agent knows what CI flagged. |
| `CANT_FIX` | Apply [Escalation FSM](#escalation-fsm) → escalate-to-next-tier OR HITL (no same-tier retry — CANT_FIX is the model declaring it's stuck). |
| `FAILED` | Apply [Escalation FSM](#escalation-fsm) → retry-at-same-tier OR escalate-to-next-tier OR HITL. Treat like CI_FAILED for retry policy. |
| Signal absent | Treat as `FAILED`. |

### 6. Final report

After the dispatch loop terminates, print a single table:

```
| Issue | Tier reached | PR | State | Notes |
```

Where State ∈ `merged | hitl | failed`. And a one-line summary: `Shipped X/Y slices merged to <host_branch>. Z in HITL. W failed.` Plus a follow-up line if the PRD was auto-closed: `Closed PRD #<num>.`

### 7. Close the PRD

After all children terminate:
- **All children merged** → comment on the PRD listing every merged child's PR URL, then `gh issue close <PRD> --reason completed`.
- **Some children in HITL or failed** → leave the PRD open. Comment with the per-child state. Operator decides.

## Escalation FSM

Mirrors yard's `src/escalation.ts` (ADR 0028). Each slice has a current tier (initial = `difficulty:*` label value, default `medium`).

| Current tier | Signal received | Action |
|---|---|---|
| easy/medium/hard | `MERGED` | Slice complete. No action. |
| easy | `CI_FAILED` or `FAILED` (first time at this tier) | **Retry once at `easy`** with failing-CI logs prepended. |
| easy | `CI_FAILED`/`FAILED` (second time) or `CANT_FIX` | **Escalate to `medium`.** Re-dispatch on a new worktree. The PR from the previous attempt stays open (commits on origin may be useful context for the next tier — the next agent reads them via `git log`). |
| medium | `CI_FAILED`/`FAILED` (first) | Retry once at `medium`. |
| medium | `CI_FAILED`/`FAILED` (second) or `CANT_FIX` | Escalate to `hard`. |
| hard | `CI_FAILED`/`FAILED` (first) | Retry once at `hard`. |
| hard | `CI_FAILED`/`FAILED` (second) or `CANT_FIX` | **Terminal: HITL.** Label issue `phase:hitl`, comment with last failure summary, leave PR open, mark slice `hitl`. |

Bounded cost: at most 6 dispatches per slice (1 + 1 retry at each of 3 tiers). Same as yard's FSM.

When retrying or escalating, the new Agent's prompt prepends:

```
PREVIOUS ATTEMPT at tier <prev-tier> failed with <signal>.
Failing checks: <list>
Last 40 lines of CI logs:
<captured-logs>

Read the previous attempt's commits on this branch (`git log <target>..HEAD --stat`) before writing new code — your job is to fix what CI flagged, not redo from scratch.
```

## Naming convention

Per [ADR 0019](../../../../yard/docs/adr/0019-branch-and-worktree-naming.md):

- **Branch:** `yd/<code>/issue-N` (e.g. `yd/yo/issue-614`)
- **Worktree dir:** `yd-<code>-issue-N` (e.g. `yd-yo-issue-614`)
- **Path:** `<project>/.yard/worktrees/yd-<code>-issue-N/`
- **Force-push glob:** `yd/*`

`<code>` resolution:
1. **Explicit** in `<project>/.yard/config.yml` `code:` field.
2. **Auto-derive** if absent (lowercase, alphanumeric only):
   - Single word → first 2 chars (`yolo` → `yo`, `view` → `vi`).
   - Multi-word (split on `-` or `_`) → first char of each, max 3 (`yd-smoke` → `ys`, `plugin-webhooks` → `pw`).
3. **Validate**: length 2–4, matches `/^[a-z0-9]+$/`.

Claude Code's `isolation: "worktree"` mode picks its own initial branch name (`worktree-agent-<hash>` or whatever). The Agent's **first git action** after sourcing credentials must be `git branch -m <current-name> yd/<code>/issue-N` so every commit and the eventual PR head ref carry yard's convention. This is non-negotiable — operators rely on the `yd/*` prefix to filter yard-opened PRs and to keep force-push safety.

## Model selection

Read `difficulty:*` label on each child:

| Label | Implementer | Reviewer | Merger |
|---|---|---|---|
| `difficulty:easy` | haiku | haiku | haiku |
| `difficulty:medium` (or absent) | sonnet | sonnet | sonnet |
| `difficulty:hard` | opus | opus | opus |

Same model across all three phases matches yard's "session-resume cache" rule. If yard's `fleet.config.ts` overrides this mapping, prefer its values (read `<workspace>/yard/fleet.config.ts` for `models.byTier`).

In Claude Code, pass `model: "haiku" | "sonnet" | "opus"` to the Agent tool call. On escalation, the new dispatch picks the model for the new tier.

## Reviewer trigger

Yard is mid-migration on Reviewer policy (PRD #186 retires the `need-agent-review` opt-in label and makes Reviewer always-on). Skill applies the **current** rule by inverting the result of a single grep:

```bash
if grep -rq review_required <workspace>/yard/src/ <workspace>/yard/run.ts 2>/dev/null; then
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

## Worktree management

`isolation: "worktree"` on each Agent call gives that slice its own worktree for the duration of the call. **All six phases (implementer → reviewer → merger → publish → wait-CI → merge) run inside the SAME Agent call**, so they share that one worktree automatically. The skill never invokes `git worktree add` directly.

The Agent renames the auto-created branch to `yd/<code>/issue-N` (see [Naming convention](#naming-convention)) before any commit. Push and PR use the renamed branch. After `gh pr merge --delete-branch` succeeds in Phase 6, the remote ref is gone; the local worktree branch sticks around until the worktree is reclaimed (next Claude Code session restart, or manual `git worktree remove`).

Sequential chains (slice B blocks on slice A) → A's Agent finishes (its worktree closes), then B's Agent starts with a fresh worktree branched off the host. A's merged commits are visible to B because A landed on the host branch in Phase 6. No PR-not-issue blocking needed in the merged path; if A ends in HITL, mark B blocked-by-A's-issue and skip until the operator resolves A.

## Failure modes

- **Cycle in `## Blocked by`** → fail loud, list cycle members, stop. Do not auto-break.
- **Yard prompts missing** → fail loud (see [Inputs](#inputs-the-skill-reads-at-runtime)).
- **Project code missing AND auto-derive collides** with another project in the workspace → fail loud, list both projects, ask the operator to set `code:` explicitly in `.yard/config.yml`.
- **PRD has no Yard-labeled children** → ask operator: is this PRD ready to ship, or should we run `/to-issues` first?
- **Project's baseline (typecheck/test) red on host branch** → yard's implement-prompt.md already handles this (the subagent will post a "pre-existing failures" comment and abort the slice); skill records it as failed for that slice and applies the FSM normally.
- **CI fails persistently across all tier retries** → slice ends in HITL. PR stays open. Operator triages.
- **`gh pr merge` fails on conflict** (host advanced while CI was polling) → treat as `FAILED` and apply FSM. The retry agent picks up a fresh worktree off the new host HEAD.
- **Operator interrupt** → standard Claude Code interrupt; in-flight worktree subagents finish their current step, results aren't lost (commits and pushed branches are on origin).

## What this skill explicitly does NOT do

- Does not retry beyond the FSM's bounded budget (1 retry per tier × 3 tiers = max 6 dispatches per slice). HITL is terminal.
- Does not handle merge-conflicts on cross-PRD races beyond the FSM retry path. If two PRDs touch overlapping files and serialize through `gh pr merge --squash`, the second one rebases-implicitly via squash; if that fails, FSM kicks in.
- Does not modify yard's prompts.
- Does not invent new labels — uses only `phase:hitl`, `phase:queued`, etc. that yard already defined.
- Does not handle multi-PRD invocations — run `/ship-prd <prd-ref>` once per PRD if you have several to ship.

## Notes

- This skill is the full yard-replacement: implement → review → merge → CI-wait → merge-to-default-branch → close-PRD. For speed-first one-off slices that should *not* hit the merge gate, use `/tdd` instead.
- For batch grilling output that hasn't been broken into issues yet, run `/to-issues` first, then `/ship-prd`.
- If yard's workflow changes substantively (e.g. a new phase added, or merger logic moves out of the prompts into code), update the [Process](#process) section here — but the prompts themselves stay in `yard/prompts/`.
- The FSM cost ceiling assumes one retry per tier. If you find slices commonly need 2+ retries at the same tier, that's a signal the issue body's AC is under-specified — fix the AC, don't raise the retry cap.
