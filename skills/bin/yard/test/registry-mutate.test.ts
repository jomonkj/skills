/**
 * Registry mutator tests (ADR 0006).
 *
 * All tests use FakeAdapter: zero git, zero network, zero tokens.
 * Each mutator is tested for:
 *   - happy path (file is written with canonical YAML)
 *   - idempotency (second call with same args is a no-op; file unchanged)
 *   - conflict detection where applicable
 *   - absent-thing removal is a no-op
 */
import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import { FakeAdapter } from "./fake-adapter.ts";
import {
  projectAdd,
  repoAdd,
  lineAdd,
  lineRm,
  envSet,
  depAdd,
  depRm,
  projectSync,
  defaultRegistryFile,
} from "../src/handlers/registry-mutate.ts";

const HOME = "/home/test";
const PROJECT = "yolo-hq";
const FILE = defaultRegistryFile(HOME, PROJECT);

// ── helpers ──────────────────────────────────────────────────────────────────

function freshAdapter(): FakeAdapter {
  const fa = new FakeAdapter();
  fa.home = HOME;
  return fa;
}

/** Seed a minimal valid registry into the fake adapter. */
function seedRegistry(fa: FakeAdapter, content: string): void {
  fa.setFile(FILE, content);
}

const REGISTRY_ONE_REPO = `repos:
  yolo:
    code: yo
    url: git@github.com:lbrmi/yolo.git
    lines:
      main:
        protected: true
        env: prod
`;

// ── `yard project add` ───────────────────────────────────────────────────────

describe("yard project add", () => {
  test("creates a new empty registry file", async () => {
    const fa = freshAdapter();
    const r = await projectAdd({ project: PROJECT }, fa);
    expect(r.command).toBe("project-add");
    expect(r.changed).toBe(true);
    expect(fa.files.has(FILE)).toBe(true);
    const parsed = parseYaml(fa.files.get(FILE)!);
    expect(parsed).toEqual({ repos: {} });
  });

  test("idempotent: existing file is not rewritten", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, REGISTRY_ONE_REPO);
    const before = fa.files.get(FILE);
    const r = await projectAdd({ project: PROJECT }, fa);
    expect(r.changed).toBe(false);
    // File content is byte-identical (not rewritten).
    expect(fa.files.get(FILE)).toBe(before);
  });

  test("explicit --file path is honoured", async () => {
    const fa = freshAdapter();
    const file = "/custom/project.yml";
    const r = await projectAdd({ project: PROJECT, file }, fa);
    expect(r.file).toBe(file);
    expect(r.changed).toBe(true);
    expect(fa.files.has(file)).toBe(true);
  });
});

// ── `yard repo add` ──────────────────────────────────────────────────────────

describe("yard repo add", () => {
  test("adds a repo to an existing registry", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, "repos: {}\n");

    const r = await repoAdd(
      {
        project: PROJECT,
        key: "apps.libromi",
        code: "lbr",
        url: "git@github.com:lbrmi/libromi.git",
        line: "main",
        protected: true,
        env: "prod",
      },
      fa,
    );

    expect(r.command).toBe("repo-add");
    expect(r.changed).toBe(true);
    const reg = parseYaml(fa.files.get(FILE)!);
    expect(reg.repos["apps.libromi"].code).toBe("lbr");
    expect(reg.repos["apps.libromi"].lines.main.protected).toBe(true);
    expect(reg.repos["apps.libromi"].lines.main.env).toBe("prod");
  });

  test("idempotent: same repo + same values is a no-op", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, "repos: {}\n");
    const input = {
      project: PROJECT,
      key: "yolo",
      code: "yo",
      url: "git@github.com:lbrmi/yolo.git",
      line: "main",
      protected: false,
    };
    await repoAdd(input, fa);
    const after1 = fa.files.get(FILE)!;
    const r2 = await repoAdd(input, fa);
    expect(r2.changed).toBe(false);
    expect(fa.files.get(FILE)).toBe(after1); // byte-identical, not rewritten
  });

  test("conflict: same key + different code throws", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, REGISTRY_ONE_REPO);
    await expect(
      repoAdd(
        {
          project: PROJECT,
          key: "yolo",
          code: "DIFFERENT",
          url: "git@github.com:lbrmi/yolo.git",
          line: "main",
          protected: true,
        },
        fa,
      ),
    ).rejects.toThrow(/already exists.*different values/);
  });

  test("missing registry file -> actionable error", async () => {
    const fa = freshAdapter();
    await expect(
      repoAdd({
        project: PROJECT,
        key: "yolo",
        code: "yo",
        url: "u",
        line: "main",
        protected: false,
      }, fa),
    ).rejects.toThrow(/registry file not found/);
  });
});

// ── `yard line add` ──────────────────────────────────────────────────────────

describe("yard line add", () => {
  test("adds a new release line to an existing repo", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, REGISTRY_ONE_REPO);

    const r = await lineAdd(
      { project: PROJECT, repo: "yolo", line: "0.x", protected: true, env: "stage" },
      fa,
    );

    expect(r.command).toBe("line-add");
    expect(r.changed).toBe(true);
    const reg = parseYaml(fa.files.get(FILE)!);
    expect(reg.repos.yolo.lines["0.x"].protected).toBe(true);
    expect(reg.repos.yolo.lines["0.x"].env).toBe("stage");
  });

  test("idempotent: same line + same flags is a no-op", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, REGISTRY_ONE_REPO);
    const input = { project: PROJECT, repo: "yolo", line: "0.x", protected: false };
    await lineAdd(input, fa);
    const before = fa.files.get(FILE)!;
    const r2 = await lineAdd(input, fa);
    expect(r2.changed).toBe(false);
    expect(fa.files.get(FILE)).toBe(before);
  });

  test("conflict: same line + different flags throws", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, REGISTRY_ONE_REPO);
    await expect(
      lineAdd({ project: PROJECT, repo: "yolo", line: "main", protected: false }, fa),
    ).rejects.toThrow(/already exists.*different values/);
  });

  test("unknown repo -> clear error", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, REGISTRY_ONE_REPO);
    await expect(
      lineAdd({ project: PROJECT, repo: "ghost", line: "main", protected: false }, fa),
    ).rejects.toThrow(/repo "ghost" not found/);
  });
});

// ── `yard line rm` ───────────────────────────────────────────────────────────

describe("yard line rm", () => {
  test("removes an existing line", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, REGISTRY_ONE_REPO);
    await lineAdd({ project: PROJECT, repo: "yolo", line: "0.x", protected: false }, fa);

    const r = await lineRm({ project: PROJECT, repo: "yolo", line: "0.x" }, fa);

    expect(r.command).toBe("line-rm");
    expect(r.changed).toBe(true);
    const reg = parseYaml(fa.files.get(FILE)!);
    expect(reg.repos.yolo.lines["0.x"]).toBeUndefined();
  });

  test("idempotent: removing an absent line is a no-op", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, REGISTRY_ONE_REPO);
    const r = await lineRm({ project: PROJECT, repo: "yolo", line: "ghost-line" }, fa);
    expect(r.changed).toBe(false);
  });

  test("refuses to remove a line that another repo depends on (referential integrity)", async () => {
    const fa = freshAdapter();
    // Build a registry where apps.libromi needs yolo@main.
    seedRegistry(fa, "repos: {}\n");
    await repoAdd({ project: PROJECT, key: "yolo", code: "yo", url: "u", line: "main", protected: true }, fa);
    await repoAdd({ project: PROJECT, key: "apps.libromi", code: "lbr", url: "u2", line: "main", protected: false }, fa);
    await depAdd({ project: PROJECT, repo: "apps.libromi", depRepo: "yolo", depLine: "main" }, fa);

    await expect(
      lineRm({ project: PROJECT, repo: "yolo", line: "main" }, fa),
    ).rejects.toThrow(/apps\.libromi.*dep rm/);
  });
});

// ── `yard env set` ───────────────────────────────────────────────────────────

describe("yard env set", () => {
  test("sets the env tag on a line", async () => {
    const fa = freshAdapter();
    // Seed a registry where main has no env.
    seedRegistry(fa, `repos:\n  yolo:\n    code: yo\n    url: u\n    lines:\n      main:\n        protected: false\n`);

    const r = await envSet({ project: PROJECT, repo: "yolo", line: "main", env: "prod" }, fa);

    expect(r.command).toBe("env-set");
    expect(r.changed).toBe(true);
    const reg = parseYaml(fa.files.get(FILE)!);
    expect(reg.repos.yolo.lines.main.env).toBe("prod");
  });

  test("idempotent: same env is a no-op", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, REGISTRY_ONE_REPO);
    const r = await envSet({ project: PROJECT, repo: "yolo", line: "main", env: "prod" }, fa);
    expect(r.changed).toBe(false);
  });

  test("updates env (env is a mutable annotation — allowed)", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, REGISTRY_ONE_REPO);
    const r = await envSet({ project: PROJECT, repo: "yolo", line: "main", env: "stage" }, fa);
    expect(r.changed).toBe(true);
    const reg = parseYaml(fa.files.get(FILE)!);
    expect(reg.repos.yolo.lines.main.env).toBe("stage");
  });

  test("unknown line -> error", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, REGISTRY_ONE_REPO);
    await expect(
      envSet({ project: PROJECT, repo: "yolo", line: "ghost", env: "prod" }, fa),
    ).rejects.toThrow(/line "ghost" not found/);
  });
});

// ── `yard dep add` ───────────────────────────────────────────────────────────

describe("yard dep add", () => {
  test("adds a source dep to a repo", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, "repos: {}\n");
    await repoAdd({ project: PROJECT, key: "yolo", code: "yo", url: "u", line: "0.x", protected: true }, fa);
    await repoAdd({ project: PROJECT, key: "apps.libromi", code: "lbr", url: "u2", line: "main", protected: false }, fa);

    const r = await depAdd({
      project: PROJECT,
      repo: "apps.libromi",
      depRepo: "yolo",
      depLine: "0.x",
    }, fa);

    expect(r.command).toBe("dep-add");
    expect(r.changed).toBe(true);
    const reg = parseYaml(fa.files.get(FILE)!);
    expect(reg.repos["apps.libromi"].needs).toEqual([{ repo: "yolo", line: "0.x" }]);
  });

  test("idempotent: same dep twice is a no-op", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, "repos: {}\n");
    await repoAdd({ project: PROJECT, key: "yolo", code: "yo", url: "u", line: "0.x", protected: false }, fa);
    await repoAdd({ project: PROJECT, key: "apps.libromi", code: "lbr", url: "u2", line: "main", protected: false }, fa);
    const input = { project: PROJECT, repo: "apps.libromi", depRepo: "yolo", depLine: "0.x" };
    await depAdd(input, fa);
    const before = fa.files.get(FILE)!;
    const r2 = await depAdd(input, fa);
    expect(r2.changed).toBe(false);
    expect(fa.files.get(FILE)).toBe(before);
  });

  test("cross-project dep (with --dep-project)", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, "repos: {}\n");
    await repoAdd({ project: PROJECT, key: "apps.libromi", code: "lbr", url: "u", line: "main", protected: false }, fa);

    await depAdd({
      project: PROJECT,
      repo: "apps.libromi",
      depRepo: "yolo",
      depLine: "0.x",
      depProject: "yolo-hq",
    }, fa);

    const reg = parseYaml(fa.files.get(FILE)!);
    expect(reg.repos["apps.libromi"].needs[0]).toEqual({
      repo: "yolo",
      line: "0.x",
      project: "yolo-hq",
    });
  });
});

// ── `yard dep rm` ────────────────────────────────────────────────────────────

describe("yard dep rm", () => {
  test("removes an existing dep", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, "repos: {}\n");
    await repoAdd({ project: PROJECT, key: "yolo", code: "yo", url: "u", line: "0.x", protected: false }, fa);
    await repoAdd({ project: PROJECT, key: "apps.libromi", code: "lbr", url: "u2", line: "main", protected: false }, fa);
    await depAdd({ project: PROJECT, repo: "apps.libromi", depRepo: "yolo", depLine: "0.x" }, fa);

    const r = await depRm({ project: PROJECT, repo: "apps.libromi", depRepo: "yolo" }, fa);

    expect(r.command).toBe("dep-rm");
    expect(r.changed).toBe(true);
    const reg = parseYaml(fa.files.get(FILE)!);
    // needs array gone when empty.
    expect(reg.repos["apps.libromi"].needs).toBeUndefined();
  });

  test("idempotent: removing absent dep is a no-op", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, REGISTRY_ONE_REPO);
    const r = await depRm({ project: PROJECT, repo: "yolo", depRepo: "ghost" }, fa);
    expect(r.changed).toBe(false);
  });
});

// ── `yard project sync` ──────────────────────────────────────────────────────

describe("yard project sync", () => {
  const CONFIG_DIR = `${HOME}/.yard/config`;

  test("commits and pushes when there are changes", async () => {
    const fa = freshAdapter();
    // Seed configDir so pathExists passes.
    fa.setFile(`${CONFIG_DIR}/projects/yolo-hq.yml`, REGISTRY_ONE_REPO);

    const r = await projectSync({ message: "yard: project sync" }, fa);

    expect(r.command).toBe("project-sync");
    expect(r.committed).toBe(true);
    expect(r.configDir).toBe(CONFIG_DIR);
    // Should see: git add -A, git commit, git push.
    expect(fa.gitCalls).toEqual([
      { dir: CONFIG_DIR, args: ["add", "-A"] },
      { dir: CONFIG_DIR, args: ["commit", "-m", "yard: project sync"] },
      { dir: CONFIG_DIR, args: ["push"] },
    ]);
  });

  test("idempotent: clean tree -> no commit, no push", async () => {
    // Make runGit throw "nothing to commit" on the commit call.
    const fa = freshAdapter();
    fa.setFile(`${CONFIG_DIR}/projects/yolo-hq.yml`, REGISTRY_ONE_REPO);

    // Override runGit to simulate a clean tree.
    const origRunGit = fa.runGit.bind(fa);
    fa.runGit = async (dir: string, args: string[]) => {
      fa.gitCalls.push({ dir, args: [...args] });
      if (args[0] === "commit") {
        throw new Error("nothing to commit, working tree clean");
      }
    };

    const r = await projectSync({ message: "yard: project sync" }, fa);
    expect(r.committed).toBe(false);
    // push should NOT have been called.
    expect(fa.gitCalls.some(c => c.args[0] === "push")).toBe(false);
  });

  test("missing configDir -> actionable error", async () => {
    const fa = freshAdapter();
    await expect(
      projectSync({ message: "yard: project sync" }, fa),
    ).rejects.toThrow(/yard-config repo not found.*yard init/);
  });

  test("custom commit message is used", async () => {
    const fa = freshAdapter();
    fa.setFile(`${CONFIG_DIR}/x.yml`, "repos: {}\n");
    await projectSync({ message: "yard: added yolo-hq" }, fa);
    const commitCall = fa.gitCalls.find(c => c.args[0] === "commit");
    expect(commitCall?.args).toContain("yard: added yolo-hq");
  });
});

// ── deterministic YAML output ────────────────────────────────────────────────

describe("deterministic YAML output (ADR 0006: stable key order)", () => {
  test("emitYaml produces identical bytes regardless of insertion order", async () => {
    const fa1 = freshAdapter();
    seedRegistry(fa1, "repos: {}\n");
    await repoAdd({ project: PROJECT, key: "b.repo", code: "bb", url: "u-b", line: "main", protected: false }, fa1);
    await repoAdd({ project: PROJECT, key: "a.repo", code: "aa", url: "u-a", line: "main", protected: false }, fa1);
    const out1 = fa1.files.get(FILE)!;

    const fa2 = freshAdapter();
    seedRegistry(fa2, "repos: {}\n");
    // Insert in reverse order.
    await repoAdd({ project: PROJECT, key: "a.repo", code: "aa", url: "u-a", line: "main", protected: false }, fa2);
    await repoAdd({ project: PROJECT, key: "b.repo", code: "bb", url: "u-b", line: "main", protected: false }, fa2);
    const out2 = fa2.files.get(FILE)!;

    expect(out1).toBe(out2);
  });

  test("canonical snapshot: known input produces known YAML bytes", async () => {
    const fa = freshAdapter();
    seedRegistry(fa, "repos: {}\n");
    await repoAdd({
      project: PROJECT,
      key: "yolo",
      code: "yo",
      url: "git@github.com:lbrmi/yolo.git",
      line: "0.x",
      protected: true,
      env: "prod",
    }, fa);

    const expected = `repos:
  yolo:
    code: yo
    lines:
      0.x:
        env: prod
        protected: true
    url: git@github.com:lbrmi/yolo.git
`;
    expect(fa.files.get(FILE)).toBe(expected);
  });
});
