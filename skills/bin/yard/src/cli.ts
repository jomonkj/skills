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
import { labelsEnsureInput, registryReadInput, initInput, issueCreateInput } from "./schema.ts";
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

function emit(value: Json, format: "json" | "yaml"): void {
  if (format === "yaml") {
    process.stdout.write(emitYaml(value));
  } else {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  }
}

const USAGE = `yard — deterministic git/gh/label plumbing (ADR 0003)

Usage:
  yard labels-ensure --repo <owner/name> --set triage|yard|all [--dry-run] [--format json|yaml]
  yard registry-read (--file <path> | --project <name>) [--format json|yaml]
  yard init --from <yard-config-url> --profile <name> [--format json|yaml]
  yard issue-create  --repo <owner/name> --title <title> [--body <text>] [--label <name>]...
                     [--parent <N>] [--ensure-set triage|yard|all|none] [--dry-run] [--format json|yaml]

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
