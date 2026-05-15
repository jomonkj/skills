/**
 * Synced per-project registry schema (ADR 0006).
 *
 * One YAML file per project in the private `yard-config` repo, filename =
 * project dir basename. Repo keys are dotted dir paths (`apps.libromi` ->
 * `apps/libromi`). `code`, `lines`, `needs` are per-repo.
 *
 * `.strict()` everywhere is a *security control*, not pedantry: ADR 0006 says
 * "no secrets are ever synced". A sloppy/malicious edit that adds `token:` (or
 * any unknown key) must be rejected at parse time, not silently carried.
 */
import { z } from "zod";

/** A single release line of a repo. */
export const lineSchema = z
  .object({
    /** Protected lines refuse branch delete / sweep (composed with the
     *  built-in protected-branch regex in protected.ts). */
    protected: z.boolean().default(false),
    /** Deployment env tag for the line, e.g. `prod`, `stage`. Optional. */
    env: z.string().min(1).optional(),
  })
  .strict();

/** A source-code dependency on another repo (ADR 0006: `needs` is
 *  source-deps only; build-tool-resolved deps are simply absent). */
export const needSchema = z
  .object({
    /** Repo key in this project, or in another when `project:`-qualified. */
    repo: z.string().min(1),
    /** Release line / version the dependency is taken at. */
    line: z.string().min(1),
    /** Optional cross-project qualifier (project dir basename). */
    project: z.string().min(1).optional(),
  })
  .strict();

/** One repo within a project. The map key is a dotted dir path. */
export const repoSchema = z
  .object({
    /** Per-repo short code; appears in `yd/<code>/issue-N`. Lowercase
     *  identifier, branch-independent identity (ADR 0006). */
    code: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/, "code must be a lowercase identifier"),
    /** Git URL used by `yard ensure` to clone on demand. */
    url: z.string().min(1),
    /** Release lines, keyed by line name (`main`, `0.x`, ...). */
    lines: z.record(z.string().min(1), lineSchema),
    /** Source-code dependencies, if any. */
    needs: z.array(needSchema).optional(),
  })
  .strict();

/** The whole per-project registry file. */
export const registrySchema = z
  .object({
    /** Repo key is a dotted path from project root; `.` -> `/`. */
    repos: z.record(
      z
        .string()
        .regex(
          /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/,
          "repo key must be a dotted dir path (e.g. apps.libromi)",
        ),
      repoSchema,
    ),
    /** Per-project extension to the protected-branch guard. Each entry is a
     *  JS regex source string; composed with the built-in default. */
    protected: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type Line = z.infer<typeof lineSchema>;
export type Need = z.infer<typeof needSchema>;
export type Repo = z.infer<typeof repoSchema>;
export type Registry = z.infer<typeof registrySchema>;

/** Map a dotted repo key to its directory: `apps.libromi` -> `apps/libromi`. */
export function repoKeyToDir(key: string): string {
  return key.replace(/\./g, "/");
}
