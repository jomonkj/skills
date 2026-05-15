/**
 * `registry-read` handler — pure core (ADR 0003 / ADR 0006).
 *
 * Reads one project's registry YAML from the cloned `yard-config` repo,
 * parses + validates it against the strict Zod schema, and returns the
 * normalised model plus the derived dir for every dotted repo key. Malformed
 * files (bad YAML, unknown keys, wrong types) produce a single clear,
 * actionable error string — never a silent partial.
 */
import { parse as parseYaml } from "yaml";
import type { Adapter } from "../adapter.ts";
import { OUTPUT_VERSION, type RegistryReadInput } from "../schema.ts";
import {
  registrySchema,
  repoKeyToDir,
  type Registry,
} from "../schemas/registry.ts";
import { join } from "node:path";

export interface RegistryReadResult {
  version: number;
  command: "registry-read";
  file: string;
  registry: Registry;
  /** Dotted repo key -> resolved directory (ADR 0006: `.` -> `/`). */
  repoDirs: Record<string, string>;
}

/** Default location of a project's registry file inside the cloned repo. */
export function defaultRegistryFile(home: string, project: string): string {
  return join(home, ".yard", "config", "projects", `${project}.yml`);
}

export async function registryRead(
  input: RegistryReadInput,
  adapter: Adapter,
): Promise<RegistryReadResult> {
  let file = input.file;
  if (!file) {
    if (!input.project) {
      throw new Error(
        "registry-read needs either --file or --project (to derive the path)",
      );
    }
    file = defaultRegistryFile(adapter.homeDir(), input.project);
  }

  if (!(await adapter.pathExists(file))) {
    throw new Error(
      `registry file not found: ${file} — run \`yard init\` or check the project name`,
    );
  }

  let raw: string;
  try {
    raw = await adapter.readFile(file);
  } catch (err) {
    throw new Error(
      `cannot read registry file ${file}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }

  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (err) {
    throw new Error(
      `malformed YAML in ${file}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }

  const parsed = registrySchema.safeParse(doc);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`invalid registry ${file}: ${detail}`);
  }

  const registry = parsed.data;
  const repoDirs: Record<string, string> = {};
  for (const key of Object.keys(registry.repos)) {
    repoDirs[key] = repoKeyToDir(key);
  }

  return {
    version: OUTPUT_VERSION,
    command: "registry-read",
    file,
    registry,
    repoDirs,
  };
}
