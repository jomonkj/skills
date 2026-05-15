import { describe, expect, test } from "bun:test";
import { main } from "../src/cli.ts";
import { FakeAdapter } from "./fake-adapter.ts";

/** Capture stdout/stderr around an async fn. */
async function capture(fn: () => Promise<number>) {
  const out: string[] = [];
  const err: string[] = [];
  const ow = process.stdout.write.bind(process.stdout);
  const ew = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string) => (out.push(String(s)), true)) as typeof process.stdout.write;
  process.stderr.write = ((s: string) => (err.push(String(s)), true)) as typeof process.stderr.write;
  try {
    const code = await fn();
    return { code, stdout: out.join(""), stderr: err.join("") };
  } finally {
    process.stdout.write = ow;
    process.stderr.write = ew;
  }
}

describe("CLI transport", () => {
  test("labels-ensure end-to-end: argv -> handler -> versioned JSON stdout", async () => {
    const fa = new FakeAdapter([]);
    const r = await capture(() =>
      main(["labels-ensure", "--repo", "lbrmi/skills", "--set", "yard"], fa),
    );
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.version).toBe(1);
    expect(parsed.command).toBe("labels-ensure");
    expect(parsed.summary.created).toBeGreaterThan(0);
    expect(r.stderr).toContain("labels-ensure:"); // log went to stderr
  });

  test("--format yaml emits deterministic YAML to stdout", async () => {
    const fa = new FakeAdapter([]);
    const r = await capture(() =>
      main(
        [
          "labels-ensure",
          "--repo",
          "lbrmi/skills",
          "--set",
          "triage",
          "--dry-run",
          "--format",
          "yaml",
        ],
        fa,
      ),
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("version: 1");
    expect(r.stdout).toContain("command: labels-ensure");
  });

  test("missing required arg -> exit 2 (usage error)", async () => {
    const fa = new FakeAdapter([]);
    const r = await capture(() => main(["labels-ensure"], fa));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("usage error");
  });

  test("unknown command -> exit 2", async () => {
    const fa = new FakeAdapter([]);
    const r = await capture(() => main(["frobnicate"], fa));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown command");
  });

  test("no args -> usage on stderr, exit 2", async () => {
    const fa = new FakeAdapter([]);
    const r = await capture(() => main([], fa));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Usage:");
  });

  test("handler error -> exit 1", async () => {
    const broken = new FakeAdapter([]);
    broken.listLabels = async () => {
      throw new Error("gh exploded");
    };
    const r = await capture(() =>
      main(["labels-ensure", "--repo", "x/y", "--set", "yard"], broken),
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("error: gh exploded");
  });
});
