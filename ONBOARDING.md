# Onboarding — the ship workflow (macOS)

Brand-new Mac → a verified `/ship --plan`. Most of this is one skill. You do the small bootstrap; `/onboard` does the rest. Background: `docs/adr/0002`–`0010`.

---

## 1. System tools (human — you must do this part)

A skill can't run before `claude` exists, and an agent must **not** pipe-curl system installers (ADR 0010). So install these yourself:

```bash
# Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install git gh
brew install oven-sh/bun/bun
brew install --cask claude-code        # or: npm i -g @anthropic-ai/claude-code
```

## 2. Clone + install the plugin (human)

```bash
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/lbrmi/skills.git yard   # repo still named skills; clone into ./yard
cd yard
gh auth login                          # GitHub.com, your account
```

Then in Claude Code, install the plugin (this repo is a Claude Code plugin — marketplace + plugin both named `yolo-skills`):

```
/plugin marketplace add lbrmi/skills
/plugin install yolo-skills@yolo-skills
```

> Dir `yard`, repo `lbrmi/skills` — that mismatch is expected: the GitHub rename is deferred (ADR 0008). A fresh clone uses the destination path now; only the *existing* operator's clone move + the rename happen later, bundled.

## 3. Run the skill (agent does the rest)

In Claude Code, from `~/projects/yard`:

```
/onboard
```

`/onboard` will: check the system tools exist (fail loud with the fix command if not — it never installs them), build the `yard` CLI (`bun install` + link), create your machine-local profile, run `yard init --from <yard-config-url> --profile <you>`, and verify with `yard scope` + `/ship --plan`. First person ever (no `yard-config` repo yet)? `/onboard` detects it and walks the one-time create.

Done when `/ship <scope> --plan` prints a **GO** line + a `/goal` command.

---

## Gotchas every new dev must know

- **`/goal` is a Claude Code session Stop hook.** Re-prompts until a condition holds, then auto-clears. It cleans up **nothing**.
- **Worktree cleanup is 3-way** (ADR 0009): `yard dispatch-done` clears a slice only on `merged`; `yard sweep` GCs merged/closed orphans (never protected, keeps failed for inspection); the harness reclaims agent worktrees at session end (session-locked ones linger until exit). Completing a `/goal` does **not** sweep them — normal, not a leak.
- **`gh` footgun:** from this dir the upstream remote is `mattpocock/skills`, so `gh` defaults there. Always `--repo lbrmi/skills`. Never write to `mattpocock/skills`.
- **`ship-prd` still exists** — transitional fallback; use `/ship`. It (and the `yolo-hq/yard` repo, and this clone's path/repo name) change together in one post-proof cycle once `/ship` ships a real PRD green (ADR 0008).
- **Never hand-edit the registry** — only `yard` mutator commands write it.
- **`yard` has zero AI** — pure git/gh/fs; all judgement lives in the skills that call it.
