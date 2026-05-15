import { describe, expect, test } from "bun:test";
import { ensure } from "../src/handlers/ensure.ts";
import { FakeAdapter, type SeedIssue } from "./fake-adapter.ts";

const HOME = "/home/test";
const PROFILE_FILE = `${HOME}/.yard/profile.me.yml`;
const REG_FILE = `${HOME}/.yard/config/projects/demo.yml`;
// Cross-project registry, exercised by a `project:`-qualified need.
const OTHER_FILE = `${HOME}/.yard/config/projects/otherproj.yml`;

const PROFILE = `root: /work\n`;

/** demo project: `app` (in scope) needs `lib`@main (same project). */
const REG = `repos:
  app:
    code: ap
    url: git@github.com:lbrmi/app.git
    lines: { main: {} }
    needs:
      - { repo: lib, line: main }
  lib:
    code: lb
    url: git@github.com:lbrmi/lib.git
    lines: { main: {} }
`;

function base(): FakeAdapter {
  const fa = new FakeAdapter();
  fa.setFile(PROFILE_FILE, PROFILE);
  fa.setFile(REG_FILE, REG);
  return fa;
}

const issue: SeedIssue = {
  number: 1,
  title: "do a thing",
  state: "OPEN",
  labels: ["Yard"],
  body: "",
};

const baseInput = {
  expr: "label:Yard",
  project: "demo",
  profile: "me",
  state: "open" as const,
  force: false,
};

describe("ensure — materialise", () => {
  test("clones only what the scope needs (in-scope repo + transitive need)", async () => {
    const fa = base();
    fa.seedIssues("lbrmi/app", [issue]);

    const r = await ensure(baseInput, fa);

    // app (in scope, reason=scope) + lib (transitive need, reason=need).
    expect(r.planned.map((p) => `${p.repoKey}@${p.line}:${p.reason}`)).toEqual([
      "app@main:scope",
      "lib@main:need",
    ]);
    // Clone dirs are `<root>/<project>/<repoDir>/<code>_<line>`.
    expect(r.planned.map((p) => p.dir)).toEqual([
      "/work/demo/app/ap_main",
      "/work/demo/lib/lb_main",
    ]);
    expect(r.outcomes.every((o) => o.status === "cloned")).toBe(true);
    expect(fa.cloneCalls.map((c) => c.dir).sort()).toEqual([
      "/work/demo/app/ap_main",
      "/work/demo/lib/lb_main",
    ]);
    // Each clone is checked out on its line.
    expect(
      fa.gitCalls.filter((g) => g.args[0] === "checkout").map((g) => g.args[1]),
    ).toEqual(["main", "main"]);
  });

  test("idempotent: present+correct clones are not re-cloned", async () => {
    const fa = base();
    fa.seedIssues("lbrmi/app", [issue]);
    // Pre-seed both clones at the correct remote+branch.
    fa.setFile("/work/demo/app/ap_main/.git/HEAD", "ref: x");
    fa.setGitState(
      "/work/demo/app/ap_main",
      "git@github.com:lbrmi/app.git",
      "main",
    );
    fa.setFile("/work/demo/lib/lb_main/.git/HEAD", "ref: x");
    fa.setGitState(
      "/work/demo/lib/lb_main",
      "git@github.com:lbrmi/lib.git",
      "main",
    );

    const r = await ensure(baseInput, fa);

    expect(r.outcomes.map((o) => o.status)).toEqual(["present", "present"]);
    expect(fa.cloneCalls).toHaveLength(0);
    expect(r.drift).toHaveLength(0);
  });

  test("drift (wrong branch) reported, not silently re-cloned without --force", async () => {
    const fa = base();
    fa.seedIssues("lbrmi/app", [issue]);
    fa.setFile("/work/demo/app/ap_main/.git/HEAD", "ref: x");
    fa.setGitState(
      "/work/demo/app/ap_main",
      "git@github.com:lbrmi/app.git",
      "feature-x", // wrong branch
    );
    fa.setFile("/work/demo/lib/lb_main/.git/HEAD", "ref: x");
    fa.setGitState(
      "/work/demo/lib/lb_main",
      "git@github.com:lbrmi/lib.git",
      "main",
    );

    const r = await ensure(baseInput, fa);

    const app = r.outcomes.find((o) => o.repoKey === "app")!;
    expect(app.status).toBe("drift-branch");
    expect(r.drift.map((d) => d.repoKey)).toEqual(["app"]);
    expect(fa.cloneCalls).toHaveLength(0); // never silently re-cloned
  });

  test("--force re-materialises a drifted clone", async () => {
    const fa = base();
    fa.seedIssues("lbrmi/app", [issue]);
    fa.setFile("/work/demo/app/ap_main/.git/HEAD", "ref: x");
    fa.setGitState(
      "/work/demo/app/ap_main",
      "git@github.com:wrong/app.git", // wrong remote
      "main",
    );
    fa.setFile("/work/demo/lib/lb_main/.git/HEAD", "ref: x");
    fa.setGitState(
      "/work/demo/lib/lb_main",
      "git@github.com:lbrmi/lib.git",
      "main",
    );

    const r = await ensure({ ...baseInput, force: true }, fa);

    const app = r.outcomes.find((o) => o.repoKey === "app")!;
    expect(app.status).toBe("recloned");
    expect(r.drift).toHaveLength(0);
  });
});

describe("ensure — dependency B+C fail-loud", () => {
  test("impossible need (unknown repo) fails loud, named", async () => {
    const reg = `repos:
  app:
    code: ap
    url: git@github.com:lbrmi/app.git
    lines: { main: {} }
    needs:
      - { repo: ghost, line: main }
`;
    const fa = base();
    fa.setFile(REG_FILE, reg);
    fa.seedIssues("lbrmi/app", [issue]);

    await expect(ensure(baseInput, fa)).rejects.toThrow(
      /impossible dependency: repo "ghost"/,
    );
  });

  test("conflicting need (same repo, two lines) fails loud, named", async () => {
    // app needs lib@main; another in-scope repo `app2` needs lib@legacy.
    const reg = `repos:
  app:
    code: ap
    url: git@github.com:lbrmi/app.git
    lines: { main: {} }
    needs:
      - { repo: lib, line: main }
  app2:
    code: a2
    url: git@github.com:lbrmi/app2.git
    lines: { main: {} }
    needs:
      - { repo: lib, line: legacy }
  lib:
    code: lb
    url: git@github.com:lbrmi/lib.git
    lines: { main: {}, legacy: {} }
`;
    const fa = base();
    fa.setFile(REG_FILE, reg);
    fa.seedIssues("lbrmi/app", [issue]);
    fa.seedIssues("lbrmi/app2", [{ ...issue, number: 2 }]);

    await expect(ensure(baseInput, fa)).rejects.toThrow(
      /conflicting dependency: demo\/lib .* line "main" .* line "legacy"/,
    );
    expect(fa.cloneCalls).toHaveLength(0); // failed BEFORE any clone
  });

  test("cross-project need: present registry materialised, absent fails loud", async () => {
    const reg = `repos:
  app:
    code: ap
    url: git@github.com:lbrmi/app.git
    lines: { main: {} }
    needs:
      - { repo: shared, line: main, project: otherproj }
`;
    const other = `repos:
  shared:
    code: sh
    url: git@github.com:lbrmi/shared.git
    lines: { main: {} }
`;
    const fa = base();
    fa.setFile(REG_FILE, reg);
    fa.seedIssues("lbrmi/app", [issue]);

    // Absent cross-project file => impossible.
    await expect(ensure(baseInput, fa)).rejects.toThrow(
      /impossible dependency: registry for project "otherproj" not found/,
    );

    // Present cross-project file => materialised into its own project dir.
    fa.setFile(OTHER_FILE, other);
    const r = await ensure(baseInput, fa);
    const shared = r.planned.find((p) => p.repoKey === "shared")!;
    expect(shared.project).toBe("otherproj");
    expect(shared.dir).toBe("/work/otherproj/shared/sh_main");
  });
});

describe("ensure — guards (zero-AI path stays pure git/fs)", () => {
  test("missing profile fails loud", async () => {
    const fa = new FakeAdapter();
    fa.setFile(REG_FILE, REG);
    fa.seedIssues("lbrmi/app", [issue]);
    await expect(ensure(baseInput, fa)).rejects.toThrow(/profile not found/);
  });

  test("scope hitting no registry repo is a loud no-op", async () => {
    const fa = base();
    // Issue only in a repo the registry does not track.
    fa.seedIssues("lbrmi/app", []);
    await expect(ensure(baseInput, fa)).rejects.toThrow(
      /none in a registry-tracked repo/,
    );
  });
});
