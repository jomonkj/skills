---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.

## Priority hint for grill outputs

Fresh grill outputs that the operator intends to act on immediately (current focus, unblocked slices) default to `priority:high` when published as issues. Background polish, planning artifacts, or future-only nice-to-haves default to medium (omit label) or `priority:low`.
