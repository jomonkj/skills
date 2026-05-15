/**
 * `ci-wait` handler — pure core (ADR 0003/0007).
 *
 * Bounded poll of a PR's checks for the SHORT change-gate. The hard contract
 * (ADR 0007: "a hung wait stalls the whole unattended run"):
 *
 *  - A HARD wall-clock timeout (`timeoutSec`) bounds the whole call. Once the
 *    deadline passes the function returns `timed-out` — it NEVER loops past
 *    the deadline, so a `/goal` turn can never hang here.
 *  - No checks configured on the PR  => `clean` immediately (a repo without
 *    CI is not "pending forever").
 *  - A transient `gh` error (network blip) does NOT abort the wait: it is
 *    counted, logged in the result, and the poll continues until the
 *    deadline. Only the deadline or a definitive pass/fail ends the wait.
 *  - The last sleep is clamped so we never sleep *past* the deadline.
 *
 * Time + sleep come through the adapter (`now()`, `sleep()`) so the bound is
 * unit-testable with zero real waiting.
 */
import type { Adapter, CheckStatus } from "../adapter.ts";
import { OUTPUT_VERSION, type CiWaitInput } from "../schema.ts";

export type CiWaitStatus = "clean" | "passing" | "failing" | "timed-out";

export interface CiWaitResult {
  version: number;
  command: "ci-wait";
  repo: string;
  pr: number;
  status: CiWaitStatus;
  /** Number of poll iterations performed. */
  polls: number;
  /** Transient gh errors absorbed during the wait (network blips). */
  transientErrors: number;
  /** Wall-clock ms the wait actually consumed. */
  elapsedMs: number;
}

export async function ciWait(
  input: CiWaitInput,
  adapter: Adapter,
): Promise<CiWaitResult> {
  const { repo, pr, intervalSec, timeoutSec } = input;
  const start = adapter.now();
  const deadline = start + timeoutSec * 1000;
  const intervalMs = intervalSec * 1000;

  let polls = 0;
  let transientErrors = 0;
  let status: CiWaitStatus = "timed-out";

  // Loop guard is the deadline ONLY — there is no other exit that can spin.
  while (adapter.now() < deadline) {
    polls++;
    let checks: CheckStatus;
    try {
      checks = await adapter.prChecks(repo, pr);
    } catch {
      // Transient gh/network failure: do not abort the bounded wait.
      transientErrors++;
      checks = "pending";
    }

    if (checks === "none") {
      status = "clean";
      break;
    }
    if (checks === "passing") {
      status = "passing";
      break;
    }
    if (checks === "failing") {
      status = "failing";
      break;
    }
    // pending -> sleep, but never past the deadline.
    const remaining = deadline - adapter.now();
    if (remaining <= 0) break; // deadline hit; status stays timed-out
    await adapter.sleep(Math.min(intervalMs, remaining));
  }

  return {
    version: OUTPUT_VERSION,
    command: "ci-wait",
    repo,
    pr,
    status,
    polls,
    transientErrors,
    elapsedMs: adapter.now() - start,
  };
}
