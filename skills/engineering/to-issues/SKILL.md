---
name: to-issues
description: Break a plan, spec, or PRD into independently-grabbable issues on the project issue tracker using tracer-bullet vertical slices. Use when user wants to convert a plan into issues, create implementation tickets, or break down work into issues.
---

# To Issues

Break a plan into independently-grabbable issues using vertical slices (tracer bullets).

**Issue tracker:** GitHub via the `gh` CLI. Repo = `git remote get-url origin` of the current working directory. If no GitHub remote, ask the user how to publish before proceeding.

**Triage labels (canonical, hardcoded):** `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. If a label is missing in the target repo, run `gh label create <name>` first, then apply.

**Sandcastle labels (for AFK slices destined for the fleet orchestrator):**

- `Sandcastle` — opts the issue into the sandcastle fleet
- `difficulty/easy` — trivial change (typo, single-line tweak, simple config)
- `difficulty/medium` — standard slice (default; 1–3 hours of work, single layer or two)
- `difficulty/hard` — design-heavy or cross-layer (multi-domain reasoning, new abstractions)
- `need-agent-review` — force a separate Opus reviewer pass after implementation (use sparingly; reserve for security-sensitive or architecture-defining slices)

If sandcastle labels are missing in the target repo, create them first:

```bash
gh label create Sandcastle --color 1D76DB --description "Issues processed by the sandcastle fleet orchestrator"
gh label create difficulty/easy --color C2E0C6
gh label create difficulty/medium --color FBCA04
gh label create difficulty/hard --color D93F0B
gh label create need-agent-review --color 5319E7
```

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes an issue reference (issue number, URL, or path) as an argument, fetch it from the issue tracker and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Issue titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

### 3. Draft vertical slices

Break the plan into **tracer bullet** issues. Each issue is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

Slices may be 'HITL' or 'AFK'. HITL slices require human interaction, such as an architectural decision or a design review. AFK slices can be implemented and merged without human interaction. Prefer AFK over HITL where possible.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
</vertical-slice-rules>

### 4. Classify difficulty (AFK slices only)

For each AFK slice, classify difficulty using these heuristics:

| Difficulty | When |
|---|---|
| `easy` | Single-file edit, < 50 lines, no design judgment, deterministic outcome |
| `medium` | 1-2 hour task, 1-3 files, standard pattern reuse, **default for most slices** |
| `hard` | Design-defining, multi-file, cross-domain, new abstractions, security-sensitive, schema migrations |

Add `need-agent-review` to a slice when **any** of these apply:

- Touches authentication, authorization, secrets, or payment paths
- Introduces a new domain abstraction
- Changes public API surface
- Changes a database schema
- The slice description explicitly says "review carefully"

When in doubt, leave `need-agent-review` off and rely on the slice's tests.

### 5. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Difficulty**: easy / medium / hard (AFK only)
- **Review**: `need-agent-review` if applied
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories this addresses (if the source material has them)

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?

Iterate until the user approves the breakdown.

### 6. Publish the issues to the issue tracker

For each approved slice, publish a new issue to the issue tracker. Use the issue body template below. AFK slices destined for the sandcastle fleet must include the `Sandcastle` label plus exactly one `difficulty/*` label and optionally `need-agent-review`.

Publish issues in dependency order (blockers first) so you can reference real issue identifiers in the "Blocked by" field.

Example for an AFK sandcastle-destined slice:

```bash
gh issue create \
  --title "Slice N — <title>" \
  --label "Sandcastle" \
  --label "difficulty/medium" \
  --body "$(cat <<'EOF'
... issue body ...
EOF
)"
```

Add `--label need-agent-review` if the slice meets the review criteria from step 4.

<issue-template>
## Parent

A reference to the parent issue on the issue tracker (if the source was an existing issue, otherwise omit this section).

## What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.

Avoid specific file paths or code snippets — they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it here and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Blocked by

- A reference to the blocking ticket (if any)

Or "None - can start immediately" if no blockers.

</issue-template>

Do NOT close or modify any parent issue.
