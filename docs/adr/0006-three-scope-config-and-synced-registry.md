# Three-scope config and a synced project registry

A single `.yard/config.yml` at a repo root cannot carry all of `/ship`'s configuration, because the configuration has three different consistency needs that conflict if forced into one file. Notably, a repo file is branch-tracked, so anything in it differs per release line — fatal for data like "which line is protected", which must be identical across every line.

Configuration is split into three scopes, each living where its consistency need is met. **All three are YAML** — a deterministic YAML emitter (stable key order, canonical formatting, only ever written by `yard`) gives clean diffs and merges, so the earlier "JSON for determinism" argument does not hold, and YAML is far more readable and consistent with the in-repo file.

| Scope | Holds | Consistency need | Location | Synced? |
|---|---|---|---|---|
| Synced registry | per project: its repos, each repo's `code`, dotted dir key, url, release lines, and source `needs` | identical for every machine and user, branch-independent | a private `yard-config` git repo | yes (git) |
| Machine-local profile | per-user overlay on a possibly-shared machine: that user's path roots, locally-checked-out subset, `gh` identity, machine overrides | per-user-per-machine | `~/.yard/profile.<name>.yml` | no |
| In-repo config | build/test command, language/toolchain variant | rightly differs per release line | `.yard/config.yml` in the repo | n/a |

## Registry shape: one synced repo, one file per project

The registry is **not** one global file (rejected: a bad edit or a YAML typo breaks the whole fleet; onboarding one project touches a file every other project reads; no natural owner; access is all-or-nothing). It is one synced `yard-config` git repo with **one file per project**, the filename matching the project directory's basename:

```
yard-config/
└── projects/
    ├── yolo-hq.yml      ↔  ~/projects/yolo-hq
    └── wc.yml           ↔  ~/projects/wc
```

This keeps the single-repo sync and one-command bootstrap the operator wanted, while removing fleet-wide blast radius and cross-project coupling: a bad edit breaks one project, onboarding `wc` never touches `yolo-hq.yml`, and a per-project file is a per-project diff to review. The remaining caveat is conscious and accepted: anyone who can clone the repo sees every project's *layout* (no secrets, just structure) — fine for self-owned/small-team projects, revisit only if outside contractors must be walled off.

Example `yard-config/projects/yolo-hq.yml`:

```yaml
repos:
  yolo:
    code: yo
    url: git@github.com:lbrmi/yolo.git
    lines: { 0.x: { protected: true, env: prod } }
  apps.libromi:                       # dotted key → dir apps/libromi
    code: lbr
    url: git@github.com:lbrmi/libromi.git
    lines: { main: { protected: true, env: prod } }
  plugins.webhooks:                   # dotted key → dir plugins/webhooks
    code: wh
    url: git@github.com:lbrmi/plugin-webhooks.git
    lines: { main: { protected: true, env: prod } }
    needs:
      - { repo: yolo, line: "0.x" }
```

Locked shape decisions:

- **Repo key is a dotted path** from the project root; `yard` maps `.`→`/` (`apps.libromi` → `apps/libromi`, `yolo` → `yolo`). No `path:` field.
- **`code` is per-repo, not per-project** — it appears in `yd/<code>/issue-N`, so it is branch-independent identity and lives in the registry, never the branch-tracked in-repo file.
- **`lines` are per-repo** — microservice repos version independently.
- **A line's working clone dir is `{code}_{line}`** (e.g. `apps/libromi/lbr_2.3.x/`); issue worktrees still nest at `.yard/worktrees/yd-<code>-issue-N` inside a line clone.
- **`needs` is source-code dependencies only.** Each entry names another repo (same project, or `project:`-qualified) at a `line`/`version`. If a build tool resolves a dependency (`go install`, composer) it is simply *absent* from `needs` — so no `kind` field is needed; everything in `needs` is by definition a source dep. The "satisfy a service dependency via a remote stage/prod URL" case is explicitly **deferred** to a later decision; not modelled now.

## Registry is declarative desired state; the agent materialises on demand

The registry describes the *intended* layout. Nothing must be pre-cloned. A deterministic, **AI-free** `yard ensure <scope>` command reads the registry, computes exactly what a scope needs, and clones + checks out only the missing pieces. An AI agent never clones anything — it calls `yard ensure` and trusts the result. Uniform structure plus on-demand materialisation makes rebuilding any machine trivial.

Dependency handling is **B+C**: `/ship <scope> --plan` is read-only and only *reports* what is missing or would be cloned (NO-GO if a `needs` is impossible or version-conflicting); `yard ensure` (run by execute-mode `/ship`, or manually) actually materialises declared-but-absent source deps; only impossible/conflicting deps block. Plan never mutates the filesystem — that is what makes it a safe pre-AFK check.

## Profiles, sync, bootstrap

The **registry is the single shared workspace definition — identical everywhere**: a user's home and office machines pull the *same* registry; same workspace, not different profiles. **Profiles exist for a different reason: one physical machine may be used by several employees.** Each employee has their own profile (own path roots, own checked-out subset, own `gh` identity) over the one shared registry. Profile is *per user on a machine*, never per-machine, never per-repo.

The synced store is a **private git repo**, not a gist or cloud KV. One user with two machines will add/edit projects from both, so concurrent registry edits are inevitable; a git repo merges them with real history and standard conflict resolution, a gist does not, a KV adds infra and credentials with no free history. The same repo is the bootstrap source: `yard init --from <yard-config-url> --profile <name>` clones the registry, applies that user's profile, and materialises their clones.

Operational rules, part of the contract:

- The registry is **only ever written by `yard` commands**, deterministically, never hand-edited — same anti-drift discipline as labels-are-state (ADR 0003).
- Mutation commands: `yard project add`, `yard repo add`, `yard line add|rm`, `yard env set`, `yard dep add|rm`, `yard project sync` (commit+push), `yard ensure` (materialise), `yard doctor` (reconcile).
- **No secrets are ever synced.** Registry holds structure only; `gh` auth and tokens stay machine-local.
- `yard doctor` reconciles registry-vs-filesystem drift: registry is intent, filesystem is reality; on disagreement it reports and offers to re-clone, never silently diverges.
- The **protected-branch guard** lives in the registry: `yard` ships a conservative built-in default regex (`^(main|master|\d+\.\d+\.x|release/.*)$`), per-project-extendable. `yard sweep`, `dispatch-done`, and any branch delete must check it and refuse a protected match. Hard safety invariant, surfaced in the implement/merge prompts too.

This supersedes the implicit single-`.yard/config.yml` model assumed in ADR 0003; that file still exists but now carries only the per-line scope.

## Deferred (explicitly parked, not lost)

- Satisfying a **service** dependency by pointing at a remote stage/prod URL instead of cloning+running source (the `team-inbox → php-api/go-api` case). Decide later.
