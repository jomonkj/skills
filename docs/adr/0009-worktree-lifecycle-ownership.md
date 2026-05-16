# Worktree lifecycle ownership

`/goal` is a Claude Code session Stop hook: it re-prompts until a completion condition holds, then auto-clears. It owns no filesystem or git state — in particular it does **not** clean up worktrees. A new operator reasonably assumes "the goal finished, so the scratch is gone"; that assumption is wrong and was observed directly (a completed goal left five session-locked agent worktrees on disk). This ADR records who actually owns worktree teardown, because the answer is split three ways and surprising without context.

Three independent owners, by design:

1. **`yard dispatch-done --outcome merged`** — tears down *that slice's* worktree, and only on a `merged` outcome. `failed`/`hitl` worktrees are deliberately kept so a human can inspect them. The protected-branch guard is checked before any branch delete.
2. **`yard sweep`** — garbage-collects orphaned worktrees whose issue is `merged`/`closed`. It never removes a worktree on a protected branch (guard refuses) and never removes a `failed` one (kept for inspection).
3. **The Claude Code harness** — reclaims `isolation: "worktree"` agent worktrees when they are unchanged or when the session ends. A worktree locked by the live session (its agent still registered to the running process) cannot be force-removed mid-session and should not be — evicting the harness's own worktrees fights the live runtime. These persist until session exit, then a prune clears them.

The deliberate trade-off: `/ship` is *not* aggressive about deleting worktrees. Merged work is cleaned promptly; failed/HITL work is preserved for diagnosis; protected branches are never touched; and the harness — not the workflow — owns agent-worktree reclamation so the workflow never races the runtime. The cost is that a long unattended run accumulates scratch that is only fully reclaimed at session end (mitigated: `dispatch-done` + `sweep` clear the merged majority during the run). Making `/ship` or `/goal` force-sweep everything was rejected: it would delete failed worktrees a human needs, and fighting harness-locked worktrees destabilises the session.

Operational consequence for onboarding: completing a `/goal` does not sweep worktrees; expect harness-locked agent worktrees to linger until the session exits. This is normal, not a leak.
