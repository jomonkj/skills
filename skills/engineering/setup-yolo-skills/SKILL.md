---
name: setup-yolo-skills
description: One-time scaffold for a repo so the engineering skills (triage, to-issues, to-prd, diagnose, tdd, improve-codebase-architecture) have what they need. Creates the 5 canonical triage labels in the GitHub repo, an empty CONTEXT.md, and a docs/adr/ template if any are missing. Idempotent — skips anything already present. Run once per new repo.
disable-model-invocation: true
---

# Setup Yolo Skills

Scaffold the prerequisites for the engineering skills. Rules are hardcoded in those skills — this command only creates the files and labels they expect.

## What gets created

1. **Triage labels** — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` in the current repo's GitHub Issues
2. **`CONTEXT.md`** — empty domain glossary at repo root (single-context default)
3. **`docs/adr/0001-record-architecture-decisions.md`** — ADR template

Multi-context repos: skip `CONTEXT.md` step and create `CONTEXT-MAP.md` instead. The user must say so — default is single-context.

## Process

### 1. Check current state

Run in the current working directory:

```bash
git remote get-url origin                                # must be a GitHub URL
gh label list --json name -q '.[].name'                  # existing labels
ls CONTEXT.md CONTEXT-MAP.md docs/adr/ 2>/dev/null       # existing docs
```

### 2. Confirm with user

Show what's missing and what will be created. Ask:

- Single-context or multi-context? (default single)
- Proceed?

### 3. Create missing labels

For each canonical label not in `gh label list`:

```bash
gh label create needs-triage      --description "Maintainer needs to evaluate" --color FBCA04
gh label create needs-info        --description "Waiting on reporter" --color D4C5F9
gh label create ready-for-agent   --description "Fully specified, AFK-ready" --color 0E8A16
gh label create ready-for-human   --description "Needs human implementation" --color 1D76DB
gh label create wontfix           --description "Will not be actioned" --color CCCCCC
```

### 4. Create missing files

If single-context and no `CONTEXT.md`:

```markdown
# CONTEXT

Domain glossary for this project.

## Terms

<!-- Add domain terms here as they crystallise. Format: Term — definition. -->
```

If multi-context and no `CONTEXT-MAP.md`:

```markdown
# CONTEXT MAP

Multi-context repo. Each context has its own CONTEXT.md and docs/adr/.

## Contexts

- `<path/to/context-a>/CONTEXT.md` — <one-line summary>
- `<path/to/context-b>/CONTEXT.md` — <one-line summary>
```

If no `docs/adr/0001-record-architecture-decisions.md`:

```markdown
# 1. Record architecture decisions

Date: <today>

## Status

Accepted

## Context

We need to record the architectural decisions made on this project.

## Decision

Use ADRs (Architecture Decision Records) to capture significant choices. One file per decision in `docs/adr/`, numbered sequentially.

## Consequences

Future contributors and agents can understand why the codebase looks the way it does.
```

### 5. Done

Report what was created and what was skipped. No further config needed — the engineering skills will work in this repo from now on.
