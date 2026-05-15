---
name: review
description: Two-axis review of the changes since a fixed point — Standards (does the code follow this repo's documented standards?) and Spec (does the code match what the originating issue/PRD asked for?). Runs both axes as parallel sub-agents and reports them side by side, never merged. Used two ways — invoked automatically by `/ship` at the unit-of-delivered-intent boundary (and on blast-radius slices), and human-triggered to deep-review a branch/PR on demand. This is the dedicated review gate of ADR 0004 — fresh eyes, what self-review structurally cannot be.
---

# Review

Two-axis review of the diff between `HEAD` and a fixed point:

- **Standards** — does the code conform to this repo's documented standards?
- **Spec** — does the code faithfully implement the originating issue / PRD / spec?

Both axes run as **parallel sub-agents** so they don't pollute each other's context; this skill aggregates them. This is the dedicated review of [ADR 0004](../../../docs/adr/0004-layered-review-replaces-per-slice-reviewer.md) — the real gate, distinct from (and never replaced by) the implementer's cheap self-review.

## Invocation

- **By `/ship`** — automatically at the unit-of-delivered-intent boundary (feature→release-line PR per PRD; a parentless issue) and early on any blast-radius slice (dep fan-out ≥ 2). The fixed point is the PRD/issue branch-point; the spec source is the PRD/issue body.
- **Human-triggered** — `/review <fixed-point>` to deep-review a branch/PR on demand (not part of the AFK `/goal` loop).

## Issue tracker

GitHub via `gh`. Repo = `git remote get-url origin` of the cwd (or the `--repo` the caller passes). If the repo has multiple remotes, the caller passes the intended `--repo <owner>/<name>` explicitly — never review/comment against an upstream you only meant to read. Deterministic gh/git plumbing goes through the `yard` CLI where a command exists.

## Process

### 1. Pin the fixed point

Whatever the caller supplied — a SHA, branch, tag, `main`, `HEAD~5`, the PRD/issue branch-point. Don't be opinionated; pass it through. If none and human-triggered, ask: "Review against what — a branch, a commit, or the default branch?" Don't proceed without it.

Capture once: `git diff <fixed-point>...HEAD` (three-dot, against the merge-base) and `git log <fixed-point>..HEAD --oneline`.

### 2. Identify the spec source

In order: (1) issue/PRD refs in commit messages (`#123`, `Closes #45`) — fetch via `gh issue view <n> --repo <owner>/<name>`; (2) a path the caller passed; (3) a PRD/spec under `docs/`, `specs/`, or the issue body; (4) else ask, or — if there is genuinely none — the **Spec** sub-agent reports "no spec available" and skips.

### 3. Identify the standards sources

Anything documenting how code should be written here: `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CONTEXT.md`/`CONTEXT-MAP.md`/per-context `CONTEXT.md`, `docs/adr/` (ADRs are standards), and machine-enforced configs (`.editorconfig`, eslint/biome/prettier/tsconfig — note but don't re-check what tooling enforces). Collect the list.

### 4. Spawn both sub-agents in parallel

One message, two `Agent` calls, `general-purpose`.

**Standards sub-agent:** the diff command + commit list; the standards-source files. Brief: "Read the standards docs, then the diff. Report — per file/hunk — every place the diff violates a documented standard. Cite the standard (file + rule). Distinguish hard violations from judgement calls. Skip anything tooling enforces. Under 400 words."

**Spec sub-agent:** the diff command + commit list; the spec path/contents. Brief: "Read the spec, then the diff. Report: (a) requirements missing or partial; (b) behaviour not asked for (scope creep); (c) requirements that look implemented but wrong. Quote the spec line per finding. Under 400 words." If no spec, skip and note it.

### 5. Aggregate

Present under `## Standards` and `## Spec`, verbatim or lightly cleaned. Do **not** merge or rerank — the axes are deliberately separate. End with: total findings per axis, the worst single issue, and a **severity verdict** per [ADR 0004](../../../docs/adr/0004-layered-review-replaces-per-slice-reviewer.md): hard finding (spec requirement missing/wrong, violated load-bearing standard/ADR, correctness/security) → keep the unit open, escalate to a human; soft finding → file a follow-up via `yard issue-create` (`Yard, ready-for-agent`), let the loop self-heal. When invoked by `/ship`, this verdict drives the FSM; when human-triggered, it's advisory.

## Why two axes

Code can pass one and fail the other: follows every standard but implements the wrong thing (Standards pass, Spec fail); does exactly what was asked but breaks conventions (Spec pass, Standards fail). Reporting them apart stops one masking the other.
