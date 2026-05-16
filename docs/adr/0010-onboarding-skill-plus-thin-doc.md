# Onboarding: a skill plus a thin doc, with a system-installer carve-out

A new developer must go from a clean Mac to a verified `/ship --plan`. The question was whether onboarding is a manual document, a fully automated skill, or a split.

There is a hard bootstrap line: a skill cannot run before `claude` and the plugin exist. So the precondition — install `git` + `claude`, clone the repo, install the plugin — is the only irreducibly manual part. Everything after it (build the `yard` CLI, `gh auth`, create a profile, `yard init`, verify) is repeatable and agent-drivable.

Decision: a thin `ONBOARDING.md` plus an `/onboard` skill.

- `ONBOARDING.md` covers only the bootstrap line (install `git`+`claude`, clone, install plugin, run `/onboard`) and the gotchas a new dev will hit (the `gh` `--repo` footgun, `/goal` owns no cleanup, worktree lifecycle per ADR 0009, `ship-prd` is the transitional fallback, never hand-edit the registry, `yard` has zero AI).
- `/onboard` does the bulk: build `yard`, `gh auth`, profile, `yard init`, verify.

The carve-out, which is the surprising part: **the skill does not install system tools.** It *checks* for Homebrew / `gh` / `bun`, and on absence fails loud with the exact command for the human to run — it never pipe-curls the Homebrew installer or `brew install`s on the user's behalf. An agent silently running system installers is security-sensitive, fails opaquely, and is hard to reverse; a human running one printed command is none of those. So `ONBOARDING.md` keeps the system-tool install as an explicit human step, and the skill is gated behind "tools present, fail loud if not."

Rejected alternatives: doc-only (every dev runs ~8 steps by hand — unnecessary friction once the bulk is automatable); skill-does-everything-including-`brew` (the security/opacity/irreversibility problem above). The chosen split puts automation exactly where it is safe and leaves manual exactly what must be manual.

Consequence: `ONBOARDING.md` stays small and honest about the bootstrap line; the `/onboard` skill is the maintained automation for everything past "claude + plugin installed"; the system-tool boundary is a deliberate safety line, not an omission.
