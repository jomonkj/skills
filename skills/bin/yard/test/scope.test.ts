import { describe, expect, test } from "bun:test";
import { scope, parseScopeExpr } from "../src/handlers/scope.ts";
import { FakeAdapter, type SeedIssue } from "./fake-adapter.ts";

/** ADR 0006 example registry: two repos, derivable owner/name. */
const REG = `repos:
  yolo:
    code: yo
    url: git@github.com:lbrmi/yolo.git
    lines: { main: { protected: true } }
  apps.skills:
    code: sk
    url: https://github.com/lbrmi/skills.git
    lines: { main: { protected: true } }
`;
const REG_FILE = "/home/test/.yard/config/projects/demo.yml";

function withRegistry(): FakeAdapter {
  const fa = new FakeAdapter();
  fa.setFile(REG_FILE, REG);
  return fa;
}

const i = (
  number: number,
  state: string,
  labels: string[],
  body = "",
): SeedIssue => ({ number, title: `issue ${number}`, state, labels, body });

describe("parseScopeExpr", () => {
  test("all / prd: / label: / issue forms", () => {
    expect(parseScopeExpr("all")).toEqual({ kind: "all" });
    expect(parseScopeExpr("prd:")).toEqual({ kind: "prd" });
    expect(parseScopeExpr("label:Yard")).toEqual({
      kind: "label",
      name: "Yard",
    });
    expect(parseScopeExpr("issue:lbrmi/yolo#7")).toEqual({
      kind: "issue",
      repo: "lbrmi/yolo",
      number: 7,
    });
    expect(parseScopeExpr("issue:#7")).toEqual({
      kind: "issue",
      repo: null,
      number: 7,
    });
  });
  test("unknown expr throws", () => {
    expect(() => parseScopeExpr("nope")).toThrow(/unknown scope expr/);
  });
  test("empty label name throws", () => {
    expect(() => parseScopeExpr("label:")).toThrow(/needs a label name/);
  });
});

describe("scope handler — four expr forms across registry repos", () => {
  test("all: every open issue across all repos, sorted by (repo, number)", async () => {
    const fa = withRegistry();
    fa.seedIssues("lbrmi/skills", [i(2, "OPEN", []), i(1, "OPEN", [])]);
    fa.seedIssues("lbrmi/yolo", [i(5, "OPEN", []), i(3, "CLOSED", [])]);
    const r = await scope({ expr: "all", file: REG_FILE, state: "open" }, fa);
    expect(r.issues.map((x) => `${x.repo}#${x.number}`)).toEqual([
      "lbrmi/skills#1",
      "lbrmi/skills#2",
      "lbrmi/yolo#5",
    ]);
    expect(r.errors).toEqual([]);
  });

  test("prd: filters to the PRD label", async () => {
    const fa = withRegistry();
    fa.seedIssues("lbrmi/skills", [
      i(1, "OPEN", ["PRD"]),
      i(2, "OPEN", ["Yard"]),
    ]);
    fa.seedIssues("lbrmi/yolo", [i(9, "OPEN", ["PRD"])]);
    const r = await scope({ expr: "prd:", file: REG_FILE, state: "open" }, fa);
    expect(r.issues.map((x) => `${x.repo}#${x.number}`)).toEqual([
      "lbrmi/skills#1",
      "lbrmi/yolo#9",
    ]);
  });

  test("label:<name> filters to that label", async () => {
    const fa = withRegistry();
    fa.seedIssues("lbrmi/skills", [
      i(1, "OPEN", ["Yard"]),
      i(2, "OPEN", ["PRD"]),
    ]);
    fa.seedIssues("lbrmi/yolo", []);
    const r = await scope(
      { expr: "label:Yard", file: REG_FILE, state: "open" },
      fa,
    );
    expect(r.issues.map((x) => x.number)).toEqual([1]);
  });

  test("issue:owner/repo#N resolves a single issue", async () => {
    const fa = withRegistry();
    fa.seedIssues("lbrmi/yolo", [i(7, "OPEN", ["Yard"], "body")]);
    const r = await scope(
      { expr: "issue:lbrmi/yolo#7", file: REG_FILE, state: "open" },
      fa,
    );
    expect(r.issues.length).toBe(1);
    expect(r.issues[0]!.repo).toBe("lbrmi/yolo");
    expect(r.issues[0]!.number).toBe(7);
    expect(fa.getCalls).toEqual([{ repo: "lbrmi/yolo", number: 7 }]);
  });

  test("issue:#N uses --repo default", async () => {
    const fa = withRegistry();
    fa.seedIssues("lbrmi/skills", [i(6, "OPEN", [])]);
    const r = await scope(
      { expr: "issue:#6", file: REG_FILE, repo: "lbrmi/skills", state: "open" },
      fa,
    );
    expect(r.issues[0]!.repo).toBe("lbrmi/skills");
    expect(r.issues[0]!.number).toBe(6);
  });

  test("issue:#N without --repo fails loud", async () => {
    const fa = withRegistry();
    await expect(
      scope({ expr: "issue:#6", file: REG_FILE, state: "open" }, fa),
    ).rejects.toThrow(/needs a default repo/);
  });

  test("state:all includes closed issues", async () => {
    const fa = withRegistry();
    fa.seedIssues("lbrmi/skills", [i(1, "OPEN", []), i(2, "CLOSED", [])]);
    fa.seedIssues("lbrmi/yolo", []);
    const r = await scope({ expr: "all", file: REG_FILE, state: "all" }, fa);
    expect(r.issues.map((x) => x.number)).toEqual([1, 2]);
  });
});

describe("scope — partial-failure isolation (ADR 0003)", () => {
  test("one repo failing does not abort the others; error captured", async () => {
    const fa = withRegistry();
    fa.seedIssues("lbrmi/skills", [i(1, "OPEN", [])]);
    fa.failingRepos.add("lbrmi/yolo");
    const r = await scope({ expr: "all", file: REG_FILE, state: "open" }, fa);
    expect(r.issues.map((x) => `${x.repo}#${x.number}`)).toEqual([
      "lbrmi/skills#1",
    ]);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]!.repo).toBe("lbrmi/yolo");
    expect(r.errors[0]!.message).toMatch(/simulated failure/);
  });

  test("single-issue resolution failure is isolated to errors[]", async () => {
    const fa = withRegistry();
    fa.failingRepos.add("lbrmi/yolo");
    const r = await scope(
      { expr: "issue:lbrmi/yolo#7", file: REG_FILE, state: "open" },
      fa,
    );
    expect(r.issues).toEqual([]);
    expect(r.errors[0]!.repo).toBe("lbrmi/yolo");
  });
});

describe("scope — deterministic JSON across runs", () => {
  test("shuffled gh return order -> byte-identical JSON", async () => {
    const mk = (order: SeedIssue[]) => {
      const fa = withRegistry();
      fa.seedIssues("lbrmi/skills", order);
      fa.seedIssues("lbrmi/yolo", [i(4, "OPEN", ["Yard"])]);
      return fa;
    };
    const a = await scope(
      { expr: "all", file: REG_FILE, state: "open" },
      mk([i(3, "OPEN", ["b", "a"]), i(1, "OPEN", []), i(2, "OPEN", [])]),
    );
    const b = await scope(
      { expr: "all", file: REG_FILE, state: "open" },
      mk([i(2, "OPEN", []), i(3, "OPEN", ["a", "b"]), i(1, "OPEN", [])]),
    );
    expect(JSON.stringify(a, null, 2)).toBe(JSON.stringify(b, null, 2));
    // labels within an issue are sorted too
    expect(a.issues.find((x) => x.number === 3)!.labels).toEqual(["a", "b"]);
  });
});
