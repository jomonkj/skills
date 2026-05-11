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
- `difficulty:easy` — trivial change (typo, single-line tweak, simple config)
- `difficulty:medium` — standard slice (default; 1–3 hours of work, single layer or two)
- `difficulty:hard` — design-heavy or cross-layer (multi-domain reasoning, new abstractions)
- `need-agent-review` — force a separate Opus reviewer pass after implementation (use sparingly; reserve for security-sensitive or architecture-defining slices)

If sandcastle labels are missing in the target repo, create them first:

```bash
gh label create Sandcastle --color 1D76DB --description "Issues processed by the sandcastle fleet orchestrator"
gh label create difficulty:easy --color C2E0C6
gh label create difficulty:medium --color FBCA04
gh label create difficulty:hard --color D93F0B
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

### Priority labels (optional)

Apply ONLY when overriding the default `medium`. There is no `priority:medium` label — absence IS medium.

5-level scale per ADR 0020 amendment (2026-05-11):

| Label | Color | When |
|---|---|---|
| `priority:highest` | dark red `B60205` | Production down, security CVE, deadline today, ship-blocker with named consequence |
| `priority:high` | red `D93F0B` | Active focus this sprint, dep that queued work waits on |
| (none) | — | Default — most slices |
| `priority:low` | green `0E8A16` | Polish, refactor with no caller, future-only nice-to-have |
| `priority:lowest` | dark green `006B0E` | "Maybe never" — would only do if trivial, background drain |

Setup once per repo:

```bash
gh label create priority:highest --color B60205 --description "Production down, security CVE, deadline today"
gh label create priority:high    --color D93F0B
gh label create priority:low     --color 0E8A16
gh label create priority:lowest  --color 006B0E --description "Maybe never — background drain only"
```

**Heuristic:**
- `highest` interrupts your day. If you can wait until tomorrow → not highest.
- `high` = next up this sprint. If you wouldn't tell a teammate "drop what you're doing" → not high.
- `lowest` = you'd happily abandon it. If it's worth scheduling at all → not lowest.
- `low` = future polish you'll get to eventually. Otherwise omit (medium).

**Anti-pattern guard:** if the fleet has more than **5 issues at `priority:highest`** at once, warn the operator before adding another: "highest means emergency; this many implies a real fire or label drift."

Add `need-agent-review` to a slice when **any** of these apply:

- Touches authentication, authorization, secrets, or payment paths
- Introduces a new domain abstraction
- Changes public API surface
- Changes a database schema
- The slice description explicitly says "review carefully"

When in doubt, leave `need-agent-review` off and rely on the slice's tests.

### Branch + worktree naming (informational)

Sandcastle now uses `sc/<code>/issue-N` branches (e.g. `sc/yo/issue-42`) and `sc-<code>-issue-N` worktree dirs. The skill itself doesn't care, but operators reading PRs / browsing IDE will see this format. See ADR 0019 in yolo-hq/sandcastle.

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

For each approved slice, publish a new issue to the issue tracker. Use the issue body template below. AFK slices destined for the sandcastle fleet must include the `Sandcastle` label plus exactly one `difficulty:*` label and optionally `need-agent-review`.

Publish issues in dependency order (blockers first) so you can reference real issue identifiers in the "Blocked by" field.

Example for an AFK sandcastle-destined slice:

```bash
gh issue create \
  --title "Slice N — <title>" \
  --label "Sandcastle" \
  --label "difficulty:medium" \
  --label "priority:high" \  # optional, only when overriding medium
  --body "$(cat <<'EOF'
... issue body ...
EOF
)"
```

Add `--label need-agent-review` if the slice meets the review criteria from step 4.

### Dep consistency rule (priority)

The rule generalises to 5 levels: `blocker.priority_rank ≤ dependent.priority_rank` (lower rank = higher urgency). Rank order: `highest=0, high=1, medium=2, low=3, lowest=4`.

Before applying `priority:highest` or `priority:high` to issue X, verify every issue listed in X's `## Blocked by` is at the same level or higher. If any blocker is weaker:

```
FAIL LOUD. Tell the operator:
"Cannot set #X as priority:high. Blocker #Y is priority:medium.
Fix one of:
  (a) raise #Y to priority:high (or higher)
  (b) lower #X to match #Y"
```

Same rule symmetrically: refuse `priority:low` or `priority:lowest` on X if any issue blocked-by X is at a stronger level. Skill never auto-modifies linked issues — only fails loud.

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
