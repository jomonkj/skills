---
name: onboard
description: One-command new-developer onboarding into the ship workflow, run once after `git`+`claude`+plugin are installed and the repo is cloned. Verifies system tools exist (fails loud with the exact fix command — never installs them), builds the `yard` CLI, creates a machine-local profile, runs `yard init` against the registry, and verifies with `yard scope` + `/ship --plan`. Detects the first-ever case (no `yard-config` repo yet) and walks the one-time create. macOS. See ONBOARDING.md for the manual bootstrap that precedes this.
disable-model-invocation: true
---

# Onboard

Everything past the bootstrap line (ADR 0010): the human installed `git`+`claude`+`bun`+`gh`, cloned the repo, installed the plugin. This skill does the rest, once.

**Hard rule (ADR 0010): never install system tools.** Check they exist; on absence print the exact command and stop. An agent must not pipe-curl the Homebrew installer or `brew install` on the user's behalf.

## 1. Verify system tools (fail loud, do NOT install)

```bash
command -v git bun gh claude
```

| Missing | Print this, then STOP |
|---|---|
| `git` / `gh` | `brew install git gh` |
| `bun` | `brew install oven-sh/bun/bun` |
| `claude` | `brew install --cask claude-code` |
| Homebrew itself | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` |

Also `gh auth status` — if not authed, print `gh auth login` and stop.

> `gh` footgun: from this clone the upstream remote is `mattpocock/skills`, so `gh` defaults there. Every `gh`/`yard` call uses `--repo lbrmi/skills`. Never write to `mattpocock/skills`.

## 2. Build the `yard` CLI

`yard` is at `skills/bin/yard` inside this repo (zero-AI plumbing every skill calls).

```bash
cd "$(git rev-parse --show-toplevel)/skills/bin/yard"
bun install
bun link
yard --help        # sanity
bun test           # optional: 202 green
```

## 3. Create the machine-local profile

Per-user, **not synced** (one Mac may serve several people — ADR 0006). Ask the user for their profile name (default `$(whoami)`) and gh login, then write `~/.yard/profile.<name>.yml` with `name`, `pathRoots: [ ~/projects ]`, `checkedOut: []`, `gh: <login>`. Skip if it already exists (idempotent).

## 4. Join the registry (or first-ever create)

```bash
yard registry-read --file <known yard-config path> 2>/dev/null   # probe
```

- **Registry exists** → `yard init --from <yard-config-url> --profile <name>`, then `yard doctor --project <p> --profile <name>` to reconcile intent vs disk.
- **First ever** (no `yard-config` repo): walk the one-time create — `gh repo create <owner>/yard-config --private --clone`, add `projects/`, commit/push, then register the first project with `yard project add` / `yard repo add` (the only writers of the registry — never hand-edit YAML), `yard project sync`, then `yard init` as above.

Ask the user for the `yard-config` URL if not discoverable; do not guess it.

## 5. Verify + report

```bash
yard scope all --project <a-project>      # resolves, no error
```

Then tell the operator to run `/ship <scope> --plan` in a project repo; success = a GO line + a `/goal` command. Report what was built/created vs skipped.

## What this does NOT do

- Does not install system tools (carve-out, ADR 0010) — checks only.
- Does not hand-edit the registry — only `yard` mutators.
- Does not move/rename anything — the clone-move + GitHub rename are the deferred post-proof bundle (ADR 0008); irrelevant to a fresh onboarding.
- Cannot onboard itself — the human bootstrap (ONBOARDING.md §1–2) must already be done.

## Rules

Idempotent — every step skips what already exists. Fail loud with the exact fix command; never auto-fix a missing precondition. macOS only.
