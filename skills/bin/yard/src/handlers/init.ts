/**
 * `init` handler — pure core (ADR 0003 / ADR 0006).
 *
 * `yard init --from <yard-config-url> --profile <name>` bootstraps a machine:
 *
 *   1. Clone the private `yard-config` registry repo to `~/.yard/config/`.
 *      (ADR 0006 does not pin a path; this is the single chosen location and
 *      every other yard command derives registry paths from it. Idempotent:
 *      if the dir already exists we do not re-clone — `yard doctor` owns
 *      reconciliation, not `init`.)
 *   2. Read + validate the machine-local profile at
 *      `~/.yard/profile.<name>.yml`. The profile is *not* synced and *not*
 *      auto-generated here: a missing profile is a loud, actionable error,
 *      because silently inventing one would hide a real config mistake.
 *   3. Confirm no secrets crossed the sync boundary: the registry schema is
 *      `.strict()`, so any unknown key (e.g. a stray `token:`) already fails
 *      validation — we surface that as the bootstrap failure.
 *
 * Materialising clones for the profile's projects is `yard ensure`'s job
 * (ADR 0006), deliberately out of scope here.
 */
import { parse as parseYaml } from "yaml";
import type { Adapter } from "../adapter.ts";
import { OUTPUT_VERSION, type InitInput } from "../schema.ts";
import { profileSchema, type Profile } from "../schemas/profile.ts";
import { registrySchema } from "../schemas/registry.ts";
import { join } from "node:path";

export interface InitResult {
  version: number;
  command: "init";
  /** Dir the registry repo was cloned to. */
  configDir: string;
  /** Whether a clone actually happened (false = already present). */
  cloned: boolean;
  /** Path of the profile that was read. */
  profileFile: string;
  profile: Profile;
  /** Project files found in the cloned registry (basenames, no `.yml`). */
  projects: string[];
}

/** The single chosen registry clone location (ADR 0006 leaves it open). */
export function configDirFor(home: string): string {
  return join(home, ".yard", "config");
}

export function profileFileFor(home: string, name: string): string {
  return join(home, ".yard", `profile.${name}.yml`);
}

export async function init(
  input: InitInput,
  adapter: Adapter,
): Promise<InitResult> {
  const home = adapter.homeDir();
  const configDir = configDirFor(home);

  // 1. Clone the registry (idempotent — doctor reconciles, not init).
  let cloned = false;
  if (await adapter.pathExists(configDir)) {
    cloned = false;
  } else {
    await adapter.cloneRepo(input.from, configDir);
    cloned = true;
  }

  // 2. Read + validate the machine-local profile. Missing => loud error.
  const profileFile = profileFileFor(home, input.profile);
  if (!(await adapter.pathExists(profileFile))) {
    throw new Error(
      `profile not found: ${profileFile} — create it (machine-local, not synced) before \`yard init\``,
    );
  }
  let profileRaw: string;
  try {
    profileRaw = await adapter.readFile(profileFile);
  } catch (err) {
    throw new Error(
      `cannot read profile ${profileFile}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
  let profileDoc: unknown;
  try {
    profileDoc = parseYaml(profileRaw);
  } catch (err) {
    throw new Error(
      `malformed YAML in profile ${profileFile}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
  const parsedProfile = profileSchema.safeParse(profileDoc);
  if (!parsedProfile.success) {
    const detail = parsedProfile.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(
      `invalid profile ${profileFile}: ${detail}` +
        " (note: unknown keys such as tokens/secrets are rejected by design)",
    );
  }

  // 3. Enumerate + sanity-validate the synced project registry files. Any
  //    unknown key (a synced secret) fails .strict() parse here and aborts.
  const projectsDir = join(configDir, "projects");
  const entries = await adapter.listFiles(projectsDir);
  const projects: string[] = [];
  for (const name of entries) {
    if (!name.endsWith(".yml")) continue;
    const path = join(projectsDir, name);
    const text = await adapter.readFile(path);
    let parsed: unknown;
    try {
      parsed = parseYaml(text);
    } catch (err) {
      throw new Error(
        `malformed YAML in synced registry ${path}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
    const r = registrySchema.safeParse(parsed);
    if (!r.success) {
      const detail = r.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new Error(
        `synced registry ${path} failed validation: ${detail}` +
          " (strict schema rejects unknown/secret keys — no secrets are synced)",
      );
    }
    projects.push(name.replace(/\.yml$/, ""));
  }
  projects.sort();

  return {
    version: OUTPUT_VERSION,
    command: "init",
    configDir,
    cloned,
    profileFile,
    profile: parsedProfile.data,
    projects,
  };
}
