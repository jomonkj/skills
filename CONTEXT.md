# Matt Pocock Skills

A collection of agent skills (slash commands and behaviors) loaded by Claude Code. Skills are organized into buckets and consumed by per-repo configuration emitted by `/setup-matt-pocock-skills`.

## Language

**Issue tracker**:
The tool that hosts a repo's issues — GitHub Issues, Linear, a local `.scratch/` markdown convention, or similar. Skills like `to-issues`, `to-prd`, `triage`, and `qa` read from and write to it.
_Avoid_: backlog manager, backlog backend, issue host

**Issue**:
A single tracked unit of work inside an **Issue tracker** — a bug, task, PRD, or slice produced by `to-issues`.
_Avoid_: ticket (use only when quoting external systems that call them tickets)

**Triage role**:
A canonical state-machine label applied to an **Issue** during triage (e.g. `needs-triage`, `ready-for-afk`). Each role maps to a real label string in the **Issue tracker** via `docs/agents/triage-labels.md`.

## Ship workflow language

**Ship**:
The workflow that drives designed work (a **PRD**, or loose **Issues**) to merged, without a separate orchestrator process. Invoked as `/ship`.
_Avoid_: orchestrate, run the fleet, sandcastle

**yard**:
The deterministic command tool the skills shell out to for all issue-tracker, branch, and label plumbing. Carries no AI judgment. Distinct from the archived *yard orchestrator* it replaces.
_Avoid_: yardctl, the daemon, the orchestrator (for the tool)

**PRD**:
A parent **Issue** describing a multi-issue initiative. Children link to it. A complete **unit of delivered intent**.
_Avoid_: epic, parent issue

**Slice**:
A child **Issue** of a **PRD** — a fragment of a larger initiative. Not a unit of delivered intent on its own; its intent rolls up to its **PRD**.
_Avoid_: subtask, ticket

**Unit of delivered intent**:
A piece of work a human asked for that stands alone once done — a **PRD**, or an **Issue** with no parent. A **Slice** is not one.
_Avoid_: feature (overloaded), deliverable

**Change gate**:
The review every code change passes before its branch merges — judges the diff for correctness and repo standards.
_Avoid_: PR check, lint pass

**Intent gate**:
The review a completed **unit of delivered intent** passes before it is accepted — judges the assembled whole against what was asked.
_Avoid_: final review, sign-off

**Self-review**:
The implementer's own check of its work against the rules and acceptance criteria before declaring done. A cheap pre-pass, structurally limited by author bias — never an independent review.
_Avoid_: QA, the review (unqualified)

**Dedicated review**:
An independent fresh-agent review along two axes — Standards and Spec. The real review gate; what **Self-review** is explicitly not.
_Avoid_: second pass, reviewer bot

**Release line**:
A long-lived versioned branch of a repo (e.g. `1.0.x`, `2.3.x`). Many exist at once; each maps to an environment.
_Avoid_: main, trunk, release branch

**Feature branch**:
A branch collecting the slices of one **PRD**, named off its target **Release line**. Merged into that line by a human.
_Avoid_: integration branch, topic branch

**Issue branch**:
A **Slice**'s working branch, `yd/<code>/issue-N`. Merged into its **Feature branch** by the agent, no human.
_Avoid_: work branch, dev branch

**Merge-forward**:
Carrying a fix from the **Release line** it landed on up to newer lines (prod → stage → dev) so newer releases don't lose it. Asymmetric — features never flow backward.
_Avoid_: back-port, sync, cascade (ambiguous)

**Protected branch**:
A branch matching the guard regex that `yard` refuses to delete or force-push (release lines, `main`, `master`).
_Avoid_: locked branch, safe branch

**Registry**:
The branch- and machine-independent declarative desired state: per project, its repos (dotted dir key, per-repo `code`, url, **Release lines**, source `needs`). One synced private `yard-config` repo, one YAML file per project. Written only by `yard`.
_Avoid_: manifest, config, fleet state

**Source dependency** (`needs`):
Another repo whose *source* a repo needs present locally, at a given line/version. Build-tool-resolved deps (`go install`, composer) are not source dependencies and are absent from `needs`.
_Avoid_: dependency (unqualified), package, import

**Materialise** (`yard ensure`):
The deterministic, AI-free act of cloning + checking out exactly the repos/lines a scope needs, from the **Registry**. The agent never clones; it calls `yard ensure`.
_Avoid_: provision, bootstrap (that is the whole-machine `yard init`), sync

**Pre-flight plan**:
`/ship <scope> --plan` — the execute path stopped before dispatch. Resolves scope/deps/readiness, asks genuine choices grill-style, lists hard gaps as blockers, ends GO/NO-GO with the exact `/goal` command.
_Avoid_: dry run (use only as a parenthetical), planner

**Orchestrator rescue**:
One bounded fix attempt the `/ship` session makes before HITL, using cross-slice context a single-slice agent lacks. Fires only when a failure smells cross-slice.
_Avoid_: retry, fallback

**Run summary**:
The deterministic, terminal-state-complete report a `/ship` batch returns — every unit resolved, conflicts, review outcomes, follow-ups, and true cost. Also the text `/goal`'s evaluator judges.
_Avoid_: report, log, status

**Retro**:
The post-run pass that files *workflow*-health follow-ups (repeat failures, conflict hotspots). Reports only; never self-modifies the workflow.
_Avoid_: self-healing (that is the mechanical retry/sweep/reconcile, a different thing)

**Profile**:
A per-user local overlay on a possibly-shared machine — that user's path root, locally-checked-out projects, and `gh` identity. Exists because one machine may serve several employees. Not synced. The **Registry** is identical for everyone; the Profile is the local per-user layer over it. A user's home and office machines share one Registry — same workspace, not different profiles.
_Avoid_: environment, machine config, per-repo config

## Relationships

- An **Issue tracker** holds many **Issues**
- An **Issue** carries one **Triage role** at a time
- A **PRD** has many **Slices**; a **Slice** has exactly one parent **PRD**
- A **unit of delivered intent** is a **PRD** or a parentless **Issue**, never a **Slice**
- Every code change passes the **Change gate**; every **unit of delivered intent** also passes the **Intent gate**
- **Self-review** precedes **Dedicated review**; it never substitutes for it

## Flagged ambiguities

- "backlog" was previously used to mean both the *tool* hosting issues and the *body of work* inside it — resolved: the tool is the **Issue tracker**; "backlog" is no longer used as a domain term.
- "backlog backend" / "backlog manager" — resolved: collapsed into **Issue tracker**.
