---
name: setup-yard
description: One-time per-repo onboarding into the ship workflow. Registers the repo's project/code/lines via the `yard` CLI, ensures the canonical GitHub labels through `yard labels-ensure` (single source of truth — no hand-rolled colours), and scaffolds the engineering-skill docs (CONTEXT.md, docs/adr template). `--triage` does only the lightweight triage scaffold (labels + docs) for repos that just need the triage/to-issues/to-prd skills, not the full ship workflow. Idempotent — skips anything present. Fails loud with a fix command on any bad precondition. Merged form of the old setup-yard + setup-yolo-skills.
disable-model-invocation: true
---

# Setup Yard

Onboard a repo so its `Yard`-labelled issues get picked up by `/ship`, and so the engineering skills (triage, to-issues, to-prd, …) have what they need. Stops only when every check is green. Idempotent.

Merged successor of the old `setup-yard` + `setup-yolo-skills` (one skill, one `--triage` flag). **All label creation is delegated to `yard labels-ensure`** — this skill never runs `gh label create` itself, so colours/descriptions have exactly one source (ADR 0003/0006).

## Modes

- **Full** (default) — ship workflow: register the project in the registry, ensure the `yard` + `triage` label families, scaffold docs.
- **`--triage`** — lightweight: only the `triage` label family + docs scaffold. For repos that use `triage`/`to-issues`/`to-prd` but are not driven by `/ship`.

## Inputs

- Target repo: `$PWD` by default; override with a path arg.
- `yard` CLI on `PATH` (`skills/bin/yard`). Required — this skill is a thin wrapper over it.

## Process

### 1. Preflight (fail loud, print the fix, do NOT auto-fix)

```bash
git rev-parse --is-inside-work-tree            # must be a git repo
git remote get-url origin                      # must be a github.com URL
gh auth status                                 # gh authed
command -v yard                                # yard CLI on PATH
```

| Fails | Fix to print |
|---|---|
| not a git repo | `git init && git remote add origin git@github.com:<owner>/<repo>.git` |
| no GitHub origin | `git remote set-url origin git@github.com:<owner>/<repo>.git` |
| gh not authed | `gh auth login` |
| `yard` missing | build it: `cd skills/bin/yard && bun install && bun link` |

If the repo has multiple remotes, resolve the intended `<owner>/<repo>` explicitly and use it for every `yard`/`gh` call — never operate on an upstream you only meant to read.

### 2. Ensure labels (delegated — never hand-rolled)

```bash
# full mode
yard labels-ensure --repo <owner>/<repo> --set all
# --triage mode
yard labels-ensure --repo <owner>/<repo> --set triage
```

`yard labels-ensure` is idempotent and the single source of label names/colours/descriptions for both the `triage` family (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) and the `yard` family (`Yard`, `PRD`, `difficulty:*`, `priority:*`, `need-agent-review`, `phase:*`).

### 3. Register the project (full mode only)

Derive the project `code` (single word → first 2 chars; hyphen/underscore → first char of each, max 3; must match `/^[a-z0-9]{2,4}$/`). If it collides with another project in the registry, ask the user for a 2–4 char override. Then register via the `yard` registry mutators (the only writers of the registry — never hand-edit it):

```bash
yard project add --project <name>
yard repo add --project <name> --key <dotted-key> --code <code> --url <origin-url> --line <host-branch> --protected --env prod
```

(`--triage` mode skips this step — a triage-only repo is not in the ship registry.)

### 4. Scaffold docs (both modes, only if missing)

- `CONTEXT.md` (single-context default) — empty glossary stub. Multi-context: `CONTEXT-MAP.md` instead (only if the user says so).
- `docs/adr/0001-record-architecture-decisions.md` — the standard ADR-0001 template.

Skip any that already exist (idempotent).

### 5. Verify + report

Full mode: `yard scope all --project <name>` resolves without error and the project appears. `--triage` mode: `gh label list --repo <owner>/<repo>` shows the 5 triage labels. Report created vs skipped. No further config needed — the engineering skills (and `/ship`, in full mode) work in this repo from now on.

## Rules

- Never `gh label create` directly — always `yard labels-ensure`.
- Never hand-edit the registry — always `yard` mutators.
- Idempotent: every step skips what already exists.
- Fail loud with the exact fix command; do not auto-fix preconditions.
