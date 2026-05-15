# MERGE-CHECK + PUBLISH — issue #{{TASK_ID}} in {{PROJECT_SLUG}}

Final pre-merge pass, then publish. Implementer (and dedicated review, if it fired) have committed on `{{SOURCE_BRANCH}}`; their context is in this conversation — no need to re-explore.

## 1. Merge-readiness

```
git log {{TARGET_BRANCH}}..HEAD --stat
git diff {{TARGET_BRANCH}}..HEAD
```

Run the project's tests (from `CLAUDE.md`). Confirm every AC in `gh issue view {{TASK_ID}} --repo {{PROJECT_SLUG}}` holds.

- Tests red → fix (`fix:` commit).
- An AC provably broken → blocking comment, exit WITHOUT COMPLETE.
- Dependency sections differ from host → reject: blocking comment, exit (operator installs the dep, re-runs).
- Green + all AC met → continue.

## 2. Sync target first (conflict policy, ADR 0005)

Before opening the PR, sync the target so conflicts surface here (full context), never as a dead PR. issue→feature: rebase onto latest feature. feature→main: merge main in (never rewrite a shared branch). Conflicts: trivial/mechanical (lockfile, imports, generated, formatting) → resolve yourself. **Semantic** (overlapping logic) → gather the bounded context (conflicting hunks' history + the two colliding issues/PRDs + ADRs touching those files), resolve, **record the merge rationale in the PR body**, and treat the resolution as new code (it must still pass tests + dedicated review). Can't resolve safely → HITL.

## 3. Publish

```
git push -u origin {{SOURCE_BRANCH}}
PR_URL=$(gh pr create --repo {{PROJECT_SLUG}} --base {{HOST_BRANCH}} --head {{SOURCE_BRANCH}} --title "{{ISSUE_TITLE}}" --body "Closes #{{TASK_ID}}")
PR_NUM=${PR_URL##*/}
```

## 4. Boundary rule (ADR 0005)

- **Issue → feature branch** (agent-merged boundary): proceed to CI + merge below.
- **Feature → release-line / main** (human-merged boundary): open the PR, do NOT merge. Emit `PR: $PR_URL` then `<promise>AWAITING_HUMAN_MERGE</promise>` and stop. `/ship` treats this as loop-terminal; a human merges.

## 5. CI

`yard ci-wait --repo {{PROJECT_SLUG}} --pr $PR_NUM` (bounded; never a blocking multi-hour wait — long suites are async/label-tracked per ADR 0007).

- green / no checks configured → continue.
- red → emit `PR: $PR_URL`, `CI_FAILED: <check>`, last ~40 lines of the failing log, then `<promise>CI_FAILED</promise>`.
- timeout → `<promise>FAILED</promise>` with `CI_TIMEOUT`.

## 6. Merge (agent-merged boundary only)

```
gh pr merge $PR_NUM --repo {{PROJECT_SLUG}} --squash --delete-branch
gh pr view $PR_NUM --repo {{PROJECT_SLUG}} --json state,mergedAt
```

State must be `MERGED`, `mergedAt` non-null. (`yard dispatch-done` does the protected-branch-guarded label/worktree teardown — the parent skill calls it; do not delete protected branches here.)

## Final-message contract (parent greps these)

- Six phases green (agent boundary): `PR: <URL>` then `<promise>MERGED</promise>`.
- Human boundary: `PR: <URL>` then `<promise>AWAITING_HUMAN_MERGE</promise>`.
- CI failed: `PR: <URL>`, `CI_FAILED: <check>`, 40 lines, `<promise>CI_FAILED</promise>`.
- `<promise>CANT_FIX</promise>` (with `PHASE: <phase>`) / `<promise>FAILED</promise>` (40 lines) otherwise.

## Rules

One pass. Don't change dependency sections. Don't close the issue (`yard dispatch-done` / PRD-close does). Deterministic ops → `yard`.
