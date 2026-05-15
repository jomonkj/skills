#!/usr/bin/env bun
/**
 * CLI transport (ADR 0003).
 *
 * argv -> Zod-validated input -> pure handler -> versioned object -> stdout.
 * Diagnostics go to stderr; stdout is *only* the machine-readable result so
 * callers can pipe it. Exit codes are meaningful:
 *
 *   0  success
 *   1  handler / runtime error (e.g. gh failed)
 *   2  usage error (bad/missing args, unknown command)
 *
 * The CLI is a thin shell over the handler core — no business logic here.
 */
import { GhAdapter, type Adapter } from "./adapter.ts";
import { labelsEnsure } from "./handlers/labels-ensure.ts";
import { registryRead } from "./handlers/registry-read.ts";
import { init } from "./handlers/init.ts";
import { issueCreate } from "./handlers/issue-create.ts";
import {
  projectAdd,
  repoAdd,
  lineAdd,
  lineRm,
  envSet,
  depAdd,
  depRm,
  projectSync,
} from "./handlers/registry-mutate.ts";
import { scope } from "./handlers/scope.ts";
import { deps, CycleError } from "./handlers/deps.ts";
import { ensure } from "./handlers/ensure.ts";
import { doctor } from "./handlers/doctor.ts";
import { dispatchInit } from "./handlers/dispatch-init.ts";
import { dispatchDone } from "./handlers/dispatch-done.ts";
import { ciWait } from "./handlers/ci-wait.ts";
import { sweep } from "./handlers/sweep.ts";
import {
  labelsEnsureInput,
  registryReadInput,
  initInput,
  issueCreateInput,
  projectAddInput,
  repoAddInput,
  lineAddInput,
  lineRmInput,
  envSetInput,
  depAddInput,
  depRmInput,
  projectSyncInput,
  scopeInput,
  depsInput,
  ensureInput,
  doctorInput,
  dispatchInitInput,
  dispatchDoneInput,
  ciWaitInput,
  sweepInput,
} from "./schema.ts";
import { emitYaml, type Json } from "./yaml.ts";

const EXIT_OK = 0;
const EXIT_ERR = 1;
const EXIT_USAGE = 2;

function log(msg: string): void {
  process.stderr.write(msg + "\n");
}

/** Minimal flag parser: `--key value`, `--flag` (boolean), and repeated `--key v1 --key v2`. */
function parseFlags(argv: string[]): Record<string, string | boolean | string[]> {
  const out: Record<string, string | boolean | string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (!tok.startsWith("--")) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      const prev = out[key];
      if (Array.isArray(prev)) {
        prev.push(next);
      } else if (typeof prev === "string") {
        out[key] = [prev, next];
      } else {
        out[key] = next;
      }
      i++;
    }
  }
  return out;
}

/**
 * The leading positional argument (e.g. the `scope`/`deps` expr), which must
 * precede any `--flags`. Returns undefined when the first token is a flag or
 * absent — never a flag *value* (so `scope --file X` is a usage error, not
 * `expr=X`).
 */
function leadingPositional(rest: string[]): string | undefined {
  const first = rest[0];
  if (first === undefined || first.startsWith("--")) return undefined;
  return first;
}

function emit(value: Json, format: "json" | "yaml"): void {
  if (format === "yaml") {
    process.stdout.write(emitYaml(value));
  } else {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  }
}

const USAGE = `yard — deterministic git/gh/label plumbing (ADR 0003)

Usage:
  yard labels-ensure  --repo <owner/name> --set triage|yard|all [--dry-run] [--format json|yaml]
  yard registry-read  (--file <path> | --project <name>) [--format json|yaml]
  yard init           --from <yard-config-url> --profile <name> [--format json|yaml]
  yard issue-create   --repo <owner/name> --title <title> [--body <text>] [--label <name>]...
                      [--parent <N>] [--ensure-set triage|yard|all|none] [--dry-run] [--format json|yaml]
  yard scope <expr>   [--file <path> | --project <name>] [--repo <owner/name>]
                      [--state open|closed|all] [--format json|yaml]
  yard deps  <expr>   [--file <path> | --project <name>] [--repo <owner/name>]
                      [--state open|closed|all] [--format json|yaml]
  yard ensure <expr>  --project <name> --profile <name> [--file <path>]
                      [--repo <owner/name>] [--state open|closed|all] [--force]
                      [--format json|yaml]
  yard doctor         --project <name> --profile <name> [--file <path>] [--fix]
                      [--format json|yaml]

Ship-only (ADR 0003/0005/0007) — used by /ship:
  yard dispatch-init  --repo <owner/name> --issue <N> --code <code>
                      --repo-dir <path> [--base <ref>] [--format json|yaml]
  yard dispatch-done  --repo <owner/name> --issue <N> --code <code>
                      --repo-dir <path> --outcome merged|awaiting-human-merge|hitl|failed
                      [--protected-pattern <regex>]... [--format json|yaml]
  yard ci-wait        --repo <owner/name> --pr <N>
                      [--interval <sec>] [--timeout <sec>] [--format json|yaml]
  yard sweep          --repo <owner/name> --repo-dir <path> --code <code>
                      [--protected-pattern <regex>]... [--dry-run] [--format json|yaml]

  <expr> is one of:  prd:  |  label:<name>  |  issue:owner/repo#N  |  issue:#N  |  all

Registry mutators — the ONLY writers of the yard-config registry (ADR 0006).
Never hand-edit registry YAML; use these commands instead:
  yard project add    --project <name> [--file <path>] [--format json|yaml]
  yard repo add       --project <name> --key <dotted-key> --code <code> --url <url>
                      --line <name> [--protected] [--env <tag>] [--format json|yaml]
  yard line add       --project <name> --repo <key> --line <name> [--protected] [--env <tag>]
                      [--format json|yaml]
  yard line rm        --project <name> --repo <key> --line <name> [--format json|yaml]
  yard env set        --project <name> --repo <key> --line <name> --env <tag> [--format json|yaml]
  yard dep add        --project <name> --repo <key> --dep-repo <repo> --dep-line <line>
                      [--dep-project <project>] [--format json|yaml]
  yard dep rm         --project <name> --repo <key> --dep-repo <repo>
                      [--dep-project <project>] [--format json|yaml]
  yard project sync   [--project <name>] [--message <msg>] [--format json|yaml]

Global:
  --format json|yaml   output format (default: json)
  --help               show this help

All output is versioned. stdout = result, stderr = logs.`;

export async function main(
  argv: string[],
  adapter: Adapter = new GhAdapter(),
): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "help") {
    log(USAGE);
    return command ? EXIT_OK : EXIT_USAGE;
  }

  const flags = parseFlags(rest);
  const format = flags.format === "yaml" ? "yaml" : "json";

  switch (command) {
    case "labels-ensure": {
      const parsed = labelsEnsureInput.safeParse({
        repo: typeof flags.repo === "string" ? flags.repo : undefined,
        set: flags.set,
        dryRun: flags["dry-run"] === true,
      });
      if (!parsed.success) {
        log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
        log("");
        log(USAGE);
        return EXIT_USAGE;
      }
      try {
        const result = await labelsEnsure(parsed.data, adapter);
        emit(result as unknown as Json, format);
        log(
          `labels-ensure: ${result.summary.created} created, ` +
            `${result.summary.updated} updated, ` +
            `${result.summary.unchanged} unchanged` +
            (result.dryRun ? " (dry-run)" : ""),
        );
        return EXIT_OK;
      } catch (err) {
        log("error: " + (err instanceof Error ? err.message : String(err)));
        return EXIT_ERR;
      }
    }
    case "registry-read": {
      const parsed = registryReadInput.safeParse({
        file: typeof flags.file === "string" ? flags.file : undefined,
        project: typeof flags.project === "string" ? flags.project : undefined,
      });
      if (!parsed.success) {
        log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
        log("");
        log(USAGE);
        return EXIT_USAGE;
      }
      try {
        const result = await registryRead(parsed.data, adapter);
        emit(result as unknown as Json, format);
        const n = Object.keys(result.registry.repos).length;
        log(`registry-read: ${result.file} ok (${n} repo(s))`);
        return EXIT_OK;
      } catch (err) {
        log("error: " + (err instanceof Error ? err.message : String(err)));
        return EXIT_ERR;
      }
    }
    case "init": {
      const parsed = initInput.safeParse({
        from: typeof flags.from === "string" ? flags.from : undefined,
        profile: typeof flags.profile === "string" ? flags.profile : undefined,
      });
      if (!parsed.success) {
        log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
        log("");
        log(USAGE);
        return EXIT_USAGE;
      }
      try {
        const result = await init(parsed.data, adapter);
        emit(result as unknown as Json, format);
        log(
          `init: registry ${result.cloned ? "cloned" : "present"} at ` +
            `${result.configDir}, profile ${result.profileFile}, ` +
            `${result.projects.length} project(s)`,
        );
        return EXIT_OK;
      } catch (err) {
        log("error: " + (err instanceof Error ? err.message : String(err)));
        return EXIT_ERR;
      }
    }
    case "issue-create": {
      // Collect multi-value --label flags.
      const rawLabels = flags.label;
      const labels: string[] = Array.isArray(rawLabels)
        ? rawLabels
        : typeof rawLabels === "string"
          ? [rawLabels]
          : [];
      const rawParent = flags.parent;
      const parentNum =
        typeof rawParent === "string" ? parseInt(rawParent, 10) : undefined;

      const parsed = issueCreateInput.safeParse({
        repo: typeof flags.repo === "string" ? flags.repo : undefined,
        title: typeof flags.title === "string" ? flags.title : undefined,
        body: typeof flags.body === "string" ? flags.body : "",
        labels,
        parent:
          parentNum !== undefined && !isNaN(parentNum) ? parentNum : undefined,
        ensureSet:
          typeof flags["ensure-set"] === "string"
            ? flags["ensure-set"]
            : "all",
        dryRun: flags["dry-run"] === true,
      });
      if (!parsed.success) {
        log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
        log("");
        log(USAGE);
        return EXIT_USAGE;
      }
      try {
        const result = await issueCreate(parsed.data, adapter);
        emit(result as unknown as Json, format);
        if (result.dryRun) {
          log(`issue-create: dry-run — would create "${result.title}"`);
        } else {
          log(`issue-create: #${result.number} ${result.url}`);
        }
        return EXIT_OK;
      } catch (err) {
        log("error: " + (err instanceof Error ? err.message : String(err)));
        return EXIT_ERR;
      }
    }
    // ── Registry mutators (ADR 0006) ────────────────────────────────────────
    // The registry YAML is never hand-edited. Only these subcommands write it.

    case "project": {
      const sub = rest[0];
      const subFlags = parseFlags(rest.slice(1));
      const subFormat = subFlags.format === "yaml" ? "yaml" : "json";

      if (sub === "add") {
        const parsed = projectAddInput.safeParse({
          project: typeof subFlags.project === "string" ? subFlags.project : undefined,
          file: typeof subFlags.file === "string" ? subFlags.file : undefined,
        });
        if (!parsed.success) {
          log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
          log(""); log(USAGE); return EXIT_USAGE;
        }
        try {
          const result = await projectAdd(parsed.data, adapter);
          emit(result as unknown as Json, subFormat);
          log(`project-add: ${result.file} ${result.changed ? "created" : "already present (no-op)"}`);
          return EXIT_OK;
        } catch (err) { log("error: " + (err instanceof Error ? err.message : String(err))); return EXIT_ERR; }
      }

      if (sub === "sync") {
        const parsed = projectSyncInput.safeParse({
          project: typeof subFlags.project === "string" ? subFlags.project : undefined,
          message: typeof subFlags.message === "string" ? subFlags.message : "yard: project sync",
          file: typeof subFlags.file === "string" ? subFlags.file : undefined,
        });
        if (!parsed.success) {
          log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
          log(""); log(USAGE); return EXIT_USAGE;
        }
        try {
          const result = await projectSync(parsed.data, adapter);
          emit(result as unknown as Json, subFormat);
          log(`project-sync: ${result.committed ? `committed + pushed (${result.message})` : "nothing to commit (no-op)"}`);
          return EXIT_OK;
        } catch (err) { log("error: " + (err instanceof Error ? err.message : String(err))); return EXIT_ERR; }
      }

      log(`unknown subcommand: project ${sub ?? ""}`);
      log(""); log(USAGE); return EXIT_USAGE;
    }

    case "repo": {
      const sub = rest[0];
      const subFlags = parseFlags(rest.slice(1));
      const subFormat = subFlags.format === "yaml" ? "yaml" : "json";

      if (sub === "add") {
        const parsed = repoAddInput.safeParse({
          project: typeof subFlags.project === "string" ? subFlags.project : undefined,
          file: typeof subFlags.file === "string" ? subFlags.file : undefined,
          key: typeof subFlags.key === "string" ? subFlags.key : undefined,
          code: typeof subFlags.code === "string" ? subFlags.code : undefined,
          url: typeof subFlags.url === "string" ? subFlags.url : undefined,
          line: typeof subFlags.line === "string" ? subFlags.line : undefined,
          protected: subFlags.protected === true,
          env: typeof subFlags.env === "string" ? subFlags.env : undefined,
        });
        if (!parsed.success) {
          log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
          log(""); log(USAGE); return EXIT_USAGE;
        }
        try {
          const result = await repoAdd(parsed.data, adapter);
          emit(result as unknown as Json, subFormat);
          log(`repo-add: ${parsed.data.key} ${result.changed ? "added" : "already present (no-op)"}`);
          return EXIT_OK;
        } catch (err) { log("error: " + (err instanceof Error ? err.message : String(err))); return EXIT_ERR; }
      }

      log(`unknown subcommand: repo ${sub ?? ""}`);
      log(""); log(USAGE); return EXIT_USAGE;
    }

    case "line": {
      const sub = rest[0];
      const subFlags = parseFlags(rest.slice(1));
      const subFormat = subFlags.format === "yaml" ? "yaml" : "json";

      if (sub === "add") {
        const parsed = lineAddInput.safeParse({
          project: typeof subFlags.project === "string" ? subFlags.project : undefined,
          file: typeof subFlags.file === "string" ? subFlags.file : undefined,
          repo: typeof subFlags.repo === "string" ? subFlags.repo : undefined,
          line: typeof subFlags.line === "string" ? subFlags.line : undefined,
          protected: subFlags.protected === true,
          env: typeof subFlags.env === "string" ? subFlags.env : undefined,
        });
        if (!parsed.success) {
          log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
          log(""); log(USAGE); return EXIT_USAGE;
        }
        try {
          const result = await lineAdd(parsed.data, adapter);
          emit(result as unknown as Json, subFormat);
          log(`line-add: ${parsed.data.line} in ${parsed.data.repo} ${result.changed ? "added" : "already present (no-op)"}`);
          return EXIT_OK;
        } catch (err) { log("error: " + (err instanceof Error ? err.message : String(err))); return EXIT_ERR; }
      }

      if (sub === "rm") {
        const parsed = lineRmInput.safeParse({
          project: typeof subFlags.project === "string" ? subFlags.project : undefined,
          file: typeof subFlags.file === "string" ? subFlags.file : undefined,
          repo: typeof subFlags.repo === "string" ? subFlags.repo : undefined,
          line: typeof subFlags.line === "string" ? subFlags.line : undefined,
        });
        if (!parsed.success) {
          log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
          log(""); log(USAGE); return EXIT_USAGE;
        }
        try {
          const result = await lineRm(parsed.data, adapter);
          emit(result as unknown as Json, subFormat);
          log(`line-rm: ${parsed.data.line} from ${parsed.data.repo} ${result.changed ? "removed" : "absent (no-op)"}`);
          return EXIT_OK;
        } catch (err) { log("error: " + (err instanceof Error ? err.message : String(err))); return EXIT_ERR; }
      }

      log(`unknown subcommand: line ${sub ?? ""}`);
      log(""); log(USAGE); return EXIT_USAGE;
    }

    case "env": {
      const sub = rest[0];
      const subFlags = parseFlags(rest.slice(1));
      const subFormat = subFlags.format === "yaml" ? "yaml" : "json";

      if (sub === "set") {
        const parsed = envSetInput.safeParse({
          project: typeof subFlags.project === "string" ? subFlags.project : undefined,
          file: typeof subFlags.file === "string" ? subFlags.file : undefined,
          repo: typeof subFlags.repo === "string" ? subFlags.repo : undefined,
          line: typeof subFlags.line === "string" ? subFlags.line : undefined,
          env: typeof subFlags.env === "string" ? subFlags.env : undefined,
        });
        if (!parsed.success) {
          log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
          log(""); log(USAGE); return EXIT_USAGE;
        }
        try {
          const result = await envSet(parsed.data, adapter);
          emit(result as unknown as Json, subFormat);
          log(`env-set: ${parsed.data.line} in ${parsed.data.repo} env="${parsed.data.env}" ${result.changed ? "updated" : "already set (no-op)"}`);
          return EXIT_OK;
        } catch (err) { log("error: " + (err instanceof Error ? err.message : String(err))); return EXIT_ERR; }
      }

      log(`unknown subcommand: env ${sub ?? ""}`);
      log(""); log(USAGE); return EXIT_USAGE;
    }

    case "dep": {
      const sub = rest[0];
      const subFlags = parseFlags(rest.slice(1));
      const subFormat = subFlags.format === "yaml" ? "yaml" : "json";

      if (sub === "add") {
        const parsed = depAddInput.safeParse({
          project: typeof subFlags.project === "string" ? subFlags.project : undefined,
          file: typeof subFlags.file === "string" ? subFlags.file : undefined,
          repo: typeof subFlags.repo === "string" ? subFlags.repo : undefined,
          depRepo: typeof subFlags["dep-repo"] === "string" ? subFlags["dep-repo"] : undefined,
          depLine: typeof subFlags["dep-line"] === "string" ? subFlags["dep-line"] : undefined,
          depProject: typeof subFlags["dep-project"] === "string" ? subFlags["dep-project"] : undefined,
        });
        if (!parsed.success) {
          log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
          log(""); log(USAGE); return EXIT_USAGE;
        }
        try {
          const result = await depAdd(parsed.data, adapter);
          emit(result as unknown as Json, subFormat);
          log(`dep-add: ${parsed.data.depRepo}@${parsed.data.depLine} in ${parsed.data.repo} ${result.changed ? "added" : "already present (no-op)"}`);
          return EXIT_OK;
        } catch (err) { log("error: " + (err instanceof Error ? err.message : String(err))); return EXIT_ERR; }
      }

      if (sub === "rm") {
        const parsed = depRmInput.safeParse({
          project: typeof subFlags.project === "string" ? subFlags.project : undefined,
          file: typeof subFlags.file === "string" ? subFlags.file : undefined,
          repo: typeof subFlags.repo === "string" ? subFlags.repo : undefined,
          depRepo: typeof subFlags["dep-repo"] === "string" ? subFlags["dep-repo"] : undefined,
          depProject: typeof subFlags["dep-project"] === "string" ? subFlags["dep-project"] : undefined,
        });
        if (!parsed.success) {
          log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
          log(""); log(USAGE); return EXIT_USAGE;
        }
        try {
          const result = await depRm(parsed.data, adapter);
          emit(result as unknown as Json, subFormat);
          log(`dep-rm: ${parsed.data.depRepo} from ${parsed.data.repo} ${result.changed ? "removed" : "absent (no-op)"}`);
          return EXIT_OK;
        } catch (err) { log("error: " + (err instanceof Error ? err.message : String(err))); return EXIT_ERR; }
      }

      log(`unknown subcommand: dep ${sub ?? ""}`);
      log(""); log(USAGE); return EXIT_USAGE;
    }

    case "scope": {
      const exprArg = leadingPositional(rest);
      const stateFlag =
        typeof flags.state === "string" ? flags.state : "open";
      const parsed = scopeInput.safeParse({
        expr: exprArg,
        file: typeof flags.file === "string" ? flags.file : undefined,
        project: typeof flags.project === "string" ? flags.project : undefined,
        repo: typeof flags.repo === "string" ? flags.repo : undefined,
        state: stateFlag,
      });
      if (!parsed.success) {
        log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
        log("");
        log(USAGE);
        return EXIT_USAGE;
      }
      try {
        const result = await scope(parsed.data, adapter);
        emit(result as unknown as Json, format);
        log(
          `scope: ${result.issues.length} issue(s), ` +
            `${result.errors.length} repo error(s)`,
        );
        return EXIT_OK;
      } catch (err) {
        log("error: " + (err instanceof Error ? err.message : String(err)));
        return EXIT_ERR;
      }
    }
    case "deps": {
      const exprArg = leadingPositional(rest);
      const stateFlag =
        typeof flags.state === "string" ? flags.state : "open";
      const parsed = depsInput.safeParse({
        expr: exprArg,
        file: typeof flags.file === "string" ? flags.file : undefined,
        project: typeof flags.project === "string" ? flags.project : undefined,
        repo: typeof flags.repo === "string" ? flags.repo : undefined,
        state: stateFlag,
      });
      if (!parsed.success) {
        log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
        log("");
        log(USAGE);
        return EXIT_USAGE;
      }
      try {
        const result = await deps(parsed.data, adapter);
        emit(result as unknown as Json, format);
        log(
          `deps: ${result.nodes.length} node(s), ` +
            `${result.batches.length} batch(es), ` +
            `${result.errors.length} repo error(s)`,
        );
        return EXIT_OK;
      } catch (err) {
        if (err instanceof CycleError) {
          log("error: " + err.message);
          return EXIT_ERR;
        }
        log("error: " + (err instanceof Error ? err.message : String(err)));
        return EXIT_ERR;
      }
    }
    case "ensure": {
      const exprArg = leadingPositional(rest);
      const stateFlag =
        typeof flags.state === "string" ? flags.state : "open";
      const parsed = ensureInput.safeParse({
        expr: exprArg,
        file: typeof flags.file === "string" ? flags.file : undefined,
        project: typeof flags.project === "string" ? flags.project : undefined,
        profile: typeof flags.profile === "string" ? flags.profile : undefined,
        repo: typeof flags.repo === "string" ? flags.repo : undefined,
        state: stateFlag,
        force: flags.force === true,
      });
      if (!parsed.success) {
        log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
        log("");
        log(USAGE);
        return EXIT_USAGE;
      }
      try {
        const result = await ensure(parsed.data, adapter);
        emit(result as unknown as Json, format);
        const cloned = result.outcomes.filter((o) => o.status === "cloned").length;
        const present = result.outcomes.filter((o) => o.status === "present").length;
        const recloned = result.outcomes.filter((o) => o.status === "recloned").length;
        log(
          `ensure: ${result.planned.length} planned, ${cloned} cloned, ` +
            `${present} present, ${recloned} re-cloned, ` +
            `${result.drift.length} drifted (unfixed)`,
        );
        // Unrepaired drift is a non-fatal warning, not a hard error: the
        // operator must consciously re-run with --force (ADR 0006: never
        // silently diverge, but also never destroy a tree without consent).
        return EXIT_OK;
      } catch (err) {
        log("error: " + (err instanceof Error ? err.message : String(err)));
        return EXIT_ERR;
      }
    }
    case "doctor": {
      const parsed = doctorInput.safeParse({
        file: typeof flags.file === "string" ? flags.file : undefined,
        project: typeof flags.project === "string" ? flags.project : undefined,
        profile: typeof flags.profile === "string" ? flags.profile : undefined,
        fix: flags.fix === true,
      });
      if (!parsed.success) {
        log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
        log("");
        log(USAGE);
        return EXIT_USAGE;
      }
      try {
        const result = await doctor(parsed.data, adapter);
        emit(result as unknown as Json, format);
        const unfixed = result.drift.filter((d) => !d.fixed).length;
        log(
          `doctor: ${result.ok} ok, ${result.drift.length} drift item(s)` +
            (result.fixed ? ` (${result.drift.length - unfixed} fixed)` : "") +
            (unfixed > 0 ? ` — ${unfixed} need attention` : ""),
        );
        return EXIT_OK;
      } catch (err) {
        log("error: " + (err instanceof Error ? err.message : String(err)));
        return EXIT_ERR;
      }
    }
    case "dispatch-init": {
      const issueNum =
        typeof flags.issue === "string" ? parseInt(flags.issue, 10) : NaN;
      const parsed = dispatchInitInput.safeParse({
        repo: typeof flags.repo === "string" ? flags.repo : undefined,
        issue: Number.isNaN(issueNum) ? undefined : issueNum,
        code: typeof flags.code === "string" ? flags.code : undefined,
        repoDir: typeof flags["repo-dir"] === "string" ? flags["repo-dir"] : undefined,
        base: typeof flags.base === "string" ? flags.base : "main",
      });
      if (!parsed.success) {
        log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
        log(""); log(USAGE); return EXIT_USAGE;
      }
      try {
        const result = await dispatchInit(parsed.data, adapter);
        emit(result as unknown as Json, format);
        log(
          `dispatch-init: ${result.action} ${result.repo}#${result.issue} ` +
            `-> ${result.branch} @ ${result.worktree} (target ${result.target})`,
        );
        return EXIT_OK;
      } catch (err) {
        log("error: " + (err instanceof Error ? err.message : String(err)));
        return EXIT_ERR;
      }
    }
    case "dispatch-done": {
      const issueNum =
        typeof flags.issue === "string" ? parseInt(flags.issue, 10) : NaN;
      const rawPat = flags["protected-pattern"];
      const protectedPatterns: string[] = Array.isArray(rawPat)
        ? rawPat
        : typeof rawPat === "string"
          ? [rawPat]
          : [];
      const parsed = dispatchDoneInput.safeParse({
        repo: typeof flags.repo === "string" ? flags.repo : undefined,
        issue: Number.isNaN(issueNum) ? undefined : issueNum,
        code: typeof flags.code === "string" ? flags.code : undefined,
        repoDir: typeof flags["repo-dir"] === "string" ? flags["repo-dir"] : undefined,
        outcome: typeof flags.outcome === "string" ? flags.outcome : undefined,
        protectedPatterns,
      });
      if (!parsed.success) {
        log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
        log(""); log(USAGE); return EXIT_USAGE;
      }
      try {
        const result = await dispatchDone(parsed.data, adapter);
        emit(result as unknown as Json, format);
        log(
          `dispatch-done: ${result.repo}#${result.issue} -> ${result.phase}` +
            (result.worktreeRemoved ? ", worktree removed" : "") +
            (result.branchDeleted ? ", branch deleted" : "") +
            (result.protectedRefusal ? ` — ${result.protectedRefusal}` : ""),
        );
        return EXIT_OK;
      } catch (err) {
        log("error: " + (err instanceof Error ? err.message : String(err)));
        return EXIT_ERR;
      }
    }
    case "ci-wait": {
      const prNum =
        typeof flags.pr === "string" ? parseInt(flags.pr, 10) : NaN;
      const intervalSec =
        typeof flags.interval === "string" ? parseInt(flags.interval, 10) : 30;
      const timeoutSec =
        typeof flags.timeout === "string" ? parseInt(flags.timeout, 10) : 900;
      const parsed = ciWaitInput.safeParse({
        repo: typeof flags.repo === "string" ? flags.repo : undefined,
        pr: Number.isNaN(prNum) ? undefined : prNum,
        intervalSec: Number.isNaN(intervalSec) ? 30 : intervalSec,
        timeoutSec: Number.isNaN(timeoutSec) ? 900 : timeoutSec,
      });
      if (!parsed.success) {
        log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
        log(""); log(USAGE); return EXIT_USAGE;
      }
      try {
        const result = await ciWait(parsed.data, adapter);
        emit(result as unknown as Json, format);
        log(
          `ci-wait: ${result.status} after ${result.polls} poll(s), ` +
            `${result.transientErrors} transient error(s), ` +
            `${Math.round(result.elapsedMs / 1000)}s`,
        );
        // A failing or timed-out gate is a non-zero exit so the shell caller
        // can branch without parsing JSON.
        return result.status === "failing" || result.status === "timed-out"
          ? EXIT_ERR
          : EXIT_OK;
      } catch (err) {
        log("error: " + (err instanceof Error ? err.message : String(err)));
        return EXIT_ERR;
      }
    }
    case "sweep": {
      const rawPat = flags["protected-pattern"];
      const protectedPatterns: string[] = Array.isArray(rawPat)
        ? rawPat
        : typeof rawPat === "string"
          ? [rawPat]
          : [];
      const parsed = sweepInput.safeParse({
        repo: typeof flags.repo === "string" ? flags.repo : undefined,
        repoDir: typeof flags["repo-dir"] === "string" ? flags["repo-dir"] : undefined,
        code: typeof flags.code === "string" ? flags.code : undefined,
        protectedPatterns,
        dryRun: flags["dry-run"] === true,
      });
      if (!parsed.success) {
        log("usage error: " + parsed.error.issues.map((i) => i.message).join("; "));
        log(""); log(USAGE); return EXIT_USAGE;
      }
      try {
        const result = await sweep(parsed.data, adapter);
        emit(result as unknown as Json, format);
        log(
          `sweep: ${result.summary.removed} removed, ` +
            `${result.summary.kept} kept, ` +
            `${result.summary.protectedBranches} protected-branch refusal(s)` +
            (result.dryRun ? " (dry-run)" : ""),
        );
        return EXIT_OK;
      } catch (err) {
        log("error: " + (err instanceof Error ? err.message : String(err)));
        return EXIT_ERR;
      }
    }
    default:
      log(`unknown command: ${command}`);
      log("");
      log(USAGE);
      return EXIT_USAGE;
  }
}

// Run only when invoked directly (not when imported by tests).
if (import.meta.main) {
  main(Bun.argv.slice(2)).then((code) => process.exit(code));
}
