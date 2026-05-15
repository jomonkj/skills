---
name: setup-yard
description: One-time onboarding of a GitHub repo into the yard fleet orchestrator. Writes `.yard/config.yml` with a unique project code, ensures yard labels via `yard labels-ensure`, then verifies with `./agent doctor` and `./agent plan`. Idempotent — skips anything already present. Fails loud with a fix command if any precondition is wrong. Run once per new repo.
disable-model-invocation: true
---

# Setup Yard

Onboard a repo into the yard fleet so its `Yard`-labelled issues get picked up. Stops only when doctor + plan are green.

## Inputs

- Target repo: `$PWD` by default. Override with a path arg (e.g. `/setup-yard /path/to/repo`).
- Yard clone: required env var `YARD_HOME` pointing at the yard repo (e.g. `~/projects/yolo-hq/yard`).

## What gets created

1. `.yard/config.yml` with `code:` (2-4 char lowercase identifier, derived from the repo dir name; yard fills variant, host_branch, image, test_commands from defaults).
2. Canonical yard labels in the target repo (via `yard labels-ensure --set yard`):
   `Yard`, `difficulty:easy/medium/hard`, `need-agent-review`, `priority:highest/high/low/lowest`.
   Colours and descriptions are owned by yard — see `skills/bin/yard/src/labels.ts`.

## Process

### 1. Preflight (fail loud, print fix)

Run from the target repo dir. If any check fails, print the failure + the exact command the user should run, then stop. Do NOT auto-fix.

```bash
git rev-parse --is-inside-work-tree                 # must be a git repo
git remote get-url origin                           # must be a github.com URL
gh auth status                                      # gh must be authed
test -n "$YARD_HOME" && test -d "$YARD_HOME"        # yard clone reachable
test -f "$YARD_HOME/run.ts"                         # looks like a yard clone
```

Fix hints to print on failure:

| Check fails | Fix |
|---|---|
| not a git repo | `git init && git remote add origin git@github.com:<owner>/<repo>.git` |
| no GitHub origin | `git remote set-url origin git@github.com:<owner>/<repo>.git` |
| gh not authed | `gh auth login` |
| `$YARD_HOME` unset | `export YARD_HOME=~/projects/yolo-hq/yard` (add to shell rc) |
| `$YARD_HOME` invalid | `git clone https://github.com/lbrmi/yard $YARD_HOME && cd $YARD_HOME && bun install && bun link` |

### 2. Pick the project code

Derive the code from the repo's directory name using yard's rule (`<YARD_HOME>/src/project-code.ts`):

- Single word → first 2 chars.
- Hyphen/underscore-separated → first char of each part, max 3 chars.
- Must match `/^[a-z0-9]{2,4}$/`.

Check fleet for collisions:

```bash
find "$(dirname "$YARD_HOME")" -maxdepth 3 -path '*/.yard/config.yml' -not -path '*/node_modules/*' \
  -exec sh -c 'echo "$1: $(grep -E "^code:" "$1" | sed "s/code: *//")"' _ {} \;
```

If the derived code is already used by another project in the fleet, ask the user for a 2-4 char override. Otherwise use the derived code without asking.

### 3. Write `.yard/config.yml`

Skip if the file already exists (idempotent). Otherwise:

```yaml
code: <derived-or-chosen>
```

That's the whole file. Yard fills `variant`, `host_branch`, `image`, `test_commands` at load time. The user can add overrides later.

### 4. Ensure labels

Run `yard labels-ensure` to create or repair the canonical yard label set in the target repo (idempotent — safe to re-run):

```bash
yard labels-ensure --repo <owner/name> --set yard
```

yard owns the canonical label definitions (colours, descriptions). Do not hardcode `gh label create` calls here; yard is the single source of truth (ADR 0003).

### 5. Verify with doctor + plan

Both must succeed. If either fails, print the output and stop.

```bash
cd "$YARD_HOME" && bun run agent doctor              # all rows must be ✓
cd "$YARD_HOME" && bun run agent plan                # must exit 0, project must appear in scan
```

### 6. Done

Print:

- Project code used
- Which labels were created vs already present
- Whether `.yard/config.yml` was written vs skipped
- One-line next step:

```
File the first issue:
  yard issue-create --repo <owner>/<repo> \
    --title "..." --label Yard --label difficulty:easy
Then run yard:
  cd $YARD_HOME && ./agent
```
