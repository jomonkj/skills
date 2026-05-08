---
name: to-prd
description: Turn the current conversation context into a PRD and publish it to the project issue tracker. Use when user wants to create a PRD from the current context.
---

This skill takes the current conversation context and codebase understanding and produces a PRD. Do NOT interview the user — just synthesize what you already know.

**Issue tracker:** GitHub via the `gh` CLI. Repo = `git remote get-url origin` of the current working directory. If no GitHub remote, ask the user how to publish before proceeding.

**Triage labels (canonical, hardcoded):** `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. If a label is missing in the target repo, run `gh label create <name>` first, then apply.

**Sandcastle labels (apply to PRDs whose slices will run under the fleet):**

- `PRD` — marks this issue as a parent PRD
- `Sandcastle` — opt the PRD itself into fleet visibility (so collector can detect it for cross-PRD deps)
- `need-agent-review` — when applied to a PRD, sandcastle fires an Opus batch review across all merged children when the operator closes the PRD

Apply `need-agent-review` to a PRD when **any** of these apply:

- Multi-domain feature (auth + payments, schema + UI, etc.)
- Public API or schema-defining
- Security-sensitive
- More than ~10 slices (hard for a single agent to keep mental model)

If sandcastle labels are missing, create them first:

```bash
gh label create PRD --color 5319E7 --description "Parent PRD issue"
gh label create Sandcastle --color 1D76DB --description "Issues processed by the sandcastle fleet orchestrator"
gh label create need-agent-review --color 5319E7
```

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the PRD, and respect any ADRs in the area you're touching.

2. Sketch out the major modules you will need to build or modify to complete the implementation. Actively look for opportunities to extract deep modules that can be tested in isolation.

A deep module (as opposed to a shallow module) is one which encapsulates a lot of functionality in a simple, testable interface which rarely changes.

Check with the user that these modules match their expectations. Check with the user which modules they want tests written for.

3. Write the PRD using the template below, then publish it to the project issue tracker. Apply the `ready-for-agent` triage label - no need for additional triage.

   For PRDs destined for the sandcastle fleet, also apply:

   - `PRD` (parent marker)
   - `Sandcastle` (fleet visibility)
   - `need-agent-review` (only if the criteria above match — multi-domain, public API, security-sensitive, or > ~10 slices)

   Example:

   ```bash
   gh issue create \
     --title "PRD: <feature name>" \
     --label "PRD" \
     --label "Sandcastle" \
     --label "need-agent-review" \
     --body "$(cat <<'EOF'
   ... PRD body ...
   EOF
   )"
   ```

<prd-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this PRD.

## Further Notes

Any further notes about the feature.

</prd-template>
