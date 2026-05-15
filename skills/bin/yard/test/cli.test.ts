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

  test("issue-create end-to-end: argv -> handler -> versioned JSON stdout", async () => {
    const fa = new FakeAdapter([]);
    const r = await capture(() =>
      main(
        [
          "issue-create",
          "--repo",
          "lbrmi/skills",
          "--title",
          "Test issue",
          "--label",
          "Yard",
          "--label",
          "difficulty:medium",
          "--ensure-set",
          "none",
        ],
        fa,
      ),
    );
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.version).toBe(1);
    expect(parsed.command).toBe("issue-create");
    expect(parsed.number).toBe(1);
    expect(parsed.title).toBe("Test issue");
    expect(parsed.labels).toEqual(["Yard", "difficulty:medium"]);
    expect(r.stderr).toContain("issue-create: #1");
  });

  test("issue-create with --parent prepends ## Parent section", async () => {
    const fa = new FakeAdapter([]);
    const r = await capture(() =>
      main(
        [
          "issue-create",
          "--repo",
          "lbrmi/skills",
          "--title",
          "Child",
          "--body",
          "## What to build\n\nStuff.",
          "--parent",
          "3",
          "--ensure-set",
          "none",
        ],
        fa,
      ),
    );
    expect(r.code).toBe(0);
    const body = fa.issueCalls[0]!.issue.body;
    expect(body).toMatch(/^## Parent\n#3\n\n/);
  });

  test("issue-create --dry-run -> exit 0, no issue created", async () => {
    const fa = new FakeAdapter([]);
    const r = await capture(() =>
      main(
        [
          "issue-create",
          "--repo",
          "lbrmi/skills",
          "--title",
          "Dry",
          "--dry-run",
          "--ensure-set",
          "none",
        ],
        fa,
      ),
    );
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.number).toBeNull();
    expect(fa.issueCalls.length).toBe(0);
    expect(r.stderr).toContain("dry-run");
  });

  test("issue-create missing --title -> exit 2", async () => {
    const fa = new FakeAdapter([]);
    const r = await capture(() =>
      main(["issue-create", "--repo", "lbrmi/skills"], fa),
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("usage error");
  });

  // ── Registry mutator CLI transport tests ──────────────────────────────────

  test("project add: argv -> handler -> versioned JSON stdout", async () => {
    const fa = new FakeAdapter([]);
    fa.home = "/home/test";
    const r = await capture(() =>
      main(["project", "add", "--project", "yolo-hq"], fa),
    );
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.command).toBe("project-add");
    expect(parsed.changed).toBe(true);
    expect(r.stderr).toContain("created");
  });

  test("repo add: argv -> handler -> versioned JSON stdout", async () => {
    const fa = new FakeAdapter([]);
    fa.home = "/home/test";
    // Pre-create the project file.
    fa.files.set("/home/test/.yard/config/projects/yolo-hq.yml", "repos: {}\n");
    const r = await capture(() =>
      main([
        "repo", "add",
        "--project", "yolo-hq",
        "--key", "apps.libromi",
        "--code", "lbr",
        "--url", "git@github.com:lbrmi/libromi.git",
        "--line", "main",
        "--protected",
        "--env", "prod",
      ], fa),
    );
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.command).toBe("repo-add");
    expect(parsed.changed).toBe(true);
  });

  test("line add + line rm round-trip via CLI", async () => {
    const fa = new FakeAdapter([]);
    fa.home = "/home/test";
    fa.files.set("/home/test/.yard/config/projects/yolo-hq.yml",
      `repos:\n  yolo:\n    code: yo\n    url: u\n    lines:\n      main:\n        protected: true\n`,
    );
    const addR = await capture(() =>
      main(["line", "add", "--project", "yolo-hq", "--repo", "yolo", "--line", "0.x"], fa),
    );
    expect(addR.code).toBe(0);
    expect(JSON.parse(addR.stdout).changed).toBe(true);

    const rmR = await capture(() =>
      main(["line", "rm", "--project", "yolo-hq", "--repo", "yolo", "--line", "0.x"], fa),
    );
    expect(rmR.code).toBe(0);
    expect(JSON.parse(rmR.stdout).changed).toBe(true);
  });

  test("env set via CLI", async () => {
    const fa = new FakeAdapter([]);
    fa.home = "/home/test";
    fa.files.set("/home/test/.yard/config/projects/yolo-hq.yml",
      `repos:\n  yolo:\n    code: yo\n    url: u\n    lines:\n      main:\n        protected: false\n`,
    );
    const r = await capture(() =>
      main(["env", "set", "--project", "yolo-hq", "--repo", "yolo", "--line", "main", "--env", "prod"], fa),
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).changed).toBe(true);
  });

  test("dep add + dep rm round-trip via CLI", async () => {
    const fa = new FakeAdapter([]);
    fa.home = "/home/test";
    fa.files.set("/home/test/.yard/config/projects/yolo-hq.yml",
      `repos:\n  yolo:\n    code: yo\n    url: u\n    lines:\n      main:\n        protected: false\n  apps.libromi:\n    code: lbr\n    url: u2\n    lines:\n      main:\n        protected: false\n`,
    );
    const addR = await capture(() =>
      main(["dep", "add", "--project", "yolo-hq", "--repo", "apps.libromi", "--dep-repo", "yolo", "--dep-line", "main"], fa),
    );
    expect(addR.code).toBe(0);
    expect(JSON.parse(addR.stdout).changed).toBe(true);

    const rmR = await capture(() =>
      main(["dep", "rm", "--project", "yolo-hq", "--repo", "apps.libromi", "--dep-repo", "yolo"], fa),
    );
    expect(rmR.code).toBe(0);
    expect(JSON.parse(rmR.stdout).changed).toBe(true);
  });

  test("project sync commits via CLI", async () => {
    const fa = new FakeAdapter([]);
    fa.home = "/home/test";
    fa.files.set("/home/test/.yard/config/x.yml", "repos: {}\n");
    const r = await capture(() =>
      main(["project", "sync", "--message", "yard: test sync"], fa),
    );
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.committed).toBe(true);
    expect(r.stderr).toContain("committed");
  });

  test("unknown registry subcommand -> exit 2", async () => {
    const fa = new FakeAdapter([]);
    const r = await capture(() => main(["project", "frobnicate"], fa));
    expect(r.code).toBe(2);
  });

  test("dispatch-init via CLI: argv -> handler -> versioned JSON", async () => {
    const fa = new FakeAdapter([]);
    fa.setIssueLabels("lbrmi/skills", 10, ["phase:queued"]);
    const r = await capture(() =>
      main(
        [
          "dispatch-init",
          "--repo", "lbrmi/skills",
          "--issue", "10",
          "--code", "sk",
          "--repo-dir", "/work/sk_main",
        ],
        fa,
      ),
    );
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.command).toBe("dispatch-init");
    expect(parsed.branch).toBe("yd/sk/issue-10");
    expect(parsed.action).toBe("dispatched");
  });

  test("dispatch-done merged via CLI tears down", async () => {
    const fa = new FakeAdapter([]);
    fa.setIssueLabels("lbrmi/skills", 10, ["phase:implementing"]);
    fa.setWorktrees("/work/sk_main", [
      { path: "/work/sk_main/.yard/worktrees/yd-sk-issue-10", branch: "yd/sk/issue-10" },
    ]);
    const r = await capture(() =>
      main(
        [
          "dispatch-done",
          "--repo", "lbrmi/skills",
          "--issue", "10",
          "--code", "sk",
          "--repo-dir", "/work/sk_main",
          "--outcome", "merged",
        ],
        fa,
      ),
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).branchDeleted).toBe(true);
  });

  test("ci-wait clean via CLI -> exit 0", async () => {
    const fa = new FakeAdapter([]);
    const r = await capture(() =>
      main(["ci-wait", "--repo", "lbrmi/skills", "--pr", "5"], fa),
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).status).toBe("clean");
  });

  test("ci-wait failing via CLI -> exit 1", async () => {
    const fa = new FakeAdapter([]);
    fa.setChecks("lbrmi/skills", 5, "failing");
    const r = await capture(() =>
      main(["ci-wait", "--repo", "lbrmi/skills", "--pr", "5", "--timeout", "60"], fa),
    );
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).status).toBe("failing");
  });

  test("sweep --dry-run via CLI touches nothing", async () => {
    const fa = new FakeAdapter([]);
    fa.setWorktrees("/work/sk_main", [
      { path: "/work/sk_main/.yard/worktrees/yd-sk-issue-10", branch: "yd/sk/issue-10" },
    ]);
    fa.seedIssues("lbrmi/skills", [
      { number: 10, title: "x", state: "CLOSED", labels: ["phase:done"], body: "" },
    ]);
    const r = await capture(() =>
      main(
        ["sweep", "--repo", "lbrmi/skills", "--repo-dir", "/work/sk_main", "--code", "sk", "--dry-run"],
        fa,
      ),
    );
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.summary.removed).toBe(1);
    expect(fa.removeWorktreeCalls.length).toBe(0);
  });

  const REG_FILE = "/home/test/.yard/config/projects/demo.yml";
  const REG = `repos:
  skills:
    code: sk
    url: git@github.com:lbrmi/skills.git
    lines: { main: { protected: true } }
`;

  test("scope <expr> end-to-end: positional expr -> sorted JSON", async () => {
    const fa = new FakeAdapter([]);
    fa.setFile(REG_FILE, REG);
    fa.seedIssues("lbrmi/skills", [
      { number: 2, title: "b", state: "OPEN", labels: ["Yard"], body: "" },
      { number: 1, title: "a", state: "OPEN", labels: ["Yard"], body: "" },
    ]);
    const r = await capture(() =>
      main(["scope", "all", "--file", REG_FILE], fa),
    );
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.command).toBe("scope");
    expect(parsed.issues.map((x: { number: number }) => x.number)).toEqual([
      1, 2,
    ]);
    expect(r.stderr).toContain("scope:");
  });

  test("scope missing expr -> exit 2", async () => {
    const fa = new FakeAdapter([]);
    const r = await capture(() => main(["scope", "--file", REG_FILE], fa));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("usage error");
  });

  test("deps <expr> end-to-end: batches in JSON", async () => {
    const fa = new FakeAdapter([]);
    fa.setFile(REG_FILE, REG);
    fa.seedIssues("lbrmi/skills", [
      { number: 1, title: "a", state: "OPEN", labels: ["Yard"], body: "" },
      {
        number: 2,
        title: "b",
        state: "OPEN",
        labels: ["Yard"],
        body: "## Blocked by\n- #1",
      },
    ]);
    const r = await capture(() =>
      main(["deps", "all", "--file", REG_FILE], fa),
    );
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.command).toBe("deps");
    expect(parsed.batches).toEqual([["lbrmi/skills#1"], ["lbrmi/skills#2"]]);
  });

  test("deps cycle -> exit 1 with named cycle on stderr", async () => {
    const fa = new FakeAdapter([]);
    fa.setFile(REG_FILE, REG);
    fa.seedIssues("lbrmi/skills", [
      {
        number: 1,
        title: "a",
        state: "OPEN",
        labels: ["Yard"],
        body: "## Blocked by\n- #2",
      },
      {
        number: 2,
        title: "b",
        state: "OPEN",
        labels: ["Yard"],
        body: "## Blocked by\n- #1",
      },
    ]);
    const r = await capture(() =>
      main(["deps", "all", "--file", REG_FILE], fa),
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("cycle detected:");
  });

  test("ensure end-to-end: argv -> handler -> versioned JSON, clones", async () => {
    const fa = new FakeAdapter([]);
    fa.setFile("/home/test/.yard/profile.me.yml", "root: /work\n");
    fa.setFile(
      "/home/test/.yard/config/projects/demo.yml",
      `repos:
  app:
    code: ap
    url: git@github.com:lbrmi/app.git
    lines: { main: {} }
`,
    );
    fa.seedIssues("lbrmi/app", [
      { number: 1, title: "x", state: "OPEN", labels: ["Yard"], body: "" },
    ]);
    const r = await capture(() =>
      main(
        [
          "ensure",
          "label:Yard",
          "--project",
          "demo",
          "--profile",
          "me",
          "--file",
          "/home/test/.yard/config/projects/demo.yml",
        ],
        fa,
      ),
    );
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.command).toBe("ensure");
    expect(parsed.version).toBe(1);
    expect(parsed.outcomes[0].status).toBe("cloned");
    expect(r.stderr).toContain("ensure:");
  });

  test("ensure missing required flags is a usage error (exit 2)", async () => {
    const fa = new FakeAdapter([]);
    const r = await capture(() => main(["ensure", "label:Yard"], fa));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("usage error");
  });

  test("doctor end-to-end: reports missing line dir", async () => {
    const fa = new FakeAdapter([]);
    fa.setFile("/home/test/.yard/profile.me.yml", "root: /work\n");
    fa.setFile(
      "/home/test/.yard/config/projects/demo.yml",
      `repos:
  app:
    code: ap
    url: git@github.com:lbrmi/app.git
    lines: { main: {} }
`,
    );
    const r = await capture(() =>
      main(
        [
          "doctor",
          "--project",
          "demo",
          "--profile",
          "me",
          "--file",
          "/home/test/.yard/config/projects/demo.yml",
        ],
        fa,
      ),
    );
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.command).toBe("doctor");
    expect(parsed.drift[0].kind).toBe("missing");
    expect(r.stderr).toContain("doctor:");
  });
});
