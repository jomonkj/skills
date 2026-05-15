import { describe, expect, test } from "bun:test";
import { ciWait } from "../src/handlers/ci-wait.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const REPO = "lbrmi/skills";

describe("ci-wait (ADR 0003/0007) — bounded, never hangs", () => {
  test("no checks configured => clean immediately", async () => {
    const fa = new FakeAdapter();
    // No setChecks -> prChecks returns "none".
    const r = await ciWait({ repo: REPO, pr: 5, intervalSec: 30, timeoutSec: 900 }, fa);
    expect(r.status).toBe("clean");
    expect(r.polls).toBe(1);
    expect(fa.sleepCalls.length).toBe(0);
  });

  test("passing ends the wait", async () => {
    const fa = new FakeAdapter();
    fa.setChecks(REPO, 5, "passing");
    const r = await ciWait({ repo: REPO, pr: 5, intervalSec: 30, timeoutSec: 900 }, fa);
    expect(r.status).toBe("passing");
  });

  test("failing ends the wait", async () => {
    const fa = new FakeAdapter();
    fa.setChecks(REPO, 5, "failing");
    const r = await ciWait({ repo: REPO, pr: 5, intervalSec: 30, timeoutSec: 900 }, fa);
    expect(r.status).toBe("failing");
  });

  test("pending then passing: polls, sleeps, then succeeds", async () => {
    const fa = new FakeAdapter();
    fa.setChecks(REPO, 5, ["pending", "pending", "passing"]);
    const r = await ciWait({ repo: REPO, pr: 5, intervalSec: 30, timeoutSec: 900 }, fa);
    expect(r.status).toBe("passing");
    expect(r.polls).toBe(3);
    expect(fa.sleepCalls).toEqual([30_000, 30_000]);
  });

  test("HARD timeout: a perpetually-pending PR returns timed-out, never hangs", async () => {
    const fa = new FakeAdapter();
    fa.setChecks(REPO, 5, "pending");
    const r = await ciWait({ repo: REPO, pr: 5, intervalSec: 30, timeoutSec: 120 }, fa);
    expect(r.status).toBe("timed-out");
    // 120s budget, 30s interval => bounded number of polls, then stop.
    expect(r.polls).toBeLessThanOrEqual(5);
    expect(r.elapsedMs).toBeGreaterThanOrEqual(120_000);
  });

  test("last sleep is clamped so we never sleep past the deadline", async () => {
    const fa = new FakeAdapter();
    fa.setChecks(REPO, 5, "pending");
    await ciWait({ repo: REPO, pr: 5, intervalSec: 100, timeoutSec: 250 }, fa);
    // Total slept must not exceed the 250s budget.
    const totalSlept = fa.sleepCalls.reduce((a, b) => a + b, 0);
    expect(totalSlept).toBeLessThanOrEqual(250_000);
  });

  test("transient gh errors are absorbed, wait continues to a real verdict", async () => {
    const fa = new FakeAdapter();
    fa.prChecksFailUntil.set(`${REPO}#5`, 2); // first 2 calls throw
    fa.setChecks(REPO, 5, ["pending", "pending", "passing"]);
    const r = await ciWait({ repo: REPO, pr: 5, intervalSec: 10, timeoutSec: 900 }, fa);
    expect(r.status).toBe("passing");
    expect(r.transientErrors).toBe(2);
  });
});
