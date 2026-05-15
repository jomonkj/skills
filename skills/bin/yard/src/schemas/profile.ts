/**
 * Machine-local profile schema (ADR 0006).
 *
 * `~/.yard/profile.<name>.yml` — per *user* on a (possibly shared) machine,
 * never synced. It is a thin overlay on the shared registry: this user's path
 * roots and the subset of projects they have checked out locally.
 *
 * `.strict()` is again a security control: ADR 0006 forbids syncing secrets,
 * and although the profile is machine-local, the schema still rejects unknown
 * keys so a stray `token:` is a loud parse error, never silently honoured.
 * The `gh` identity is referenced by *name only* (gh keeps the actual auth);
 * no token field exists in the schema, so none can be stored.
 */
import { z } from "zod";

export const profileSchema = z
  .object({
    /** Absolute path under which this user's projects live, e.g.
     *  `/Users/alice/projects`. The registry says *what*; the profile says
     *  *where on this machine for this user*. */
    root: z.string().min(1),
    /** Project dir basenames this user has (or wants) checked out locally.
     *  Absent/empty => all projects in the registry. */
    projects: z.array(z.string().min(1)).optional(),
    /** `gh` account name to operate as. Name only — gh holds the token. */
    ghIdentity: z.string().min(1).optional(),
  })
  .strict();

export type Profile = z.infer<typeof profileSchema>;
