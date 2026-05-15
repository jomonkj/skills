import { describe, expect, test } from "bun:test";
import { deps, CycleError } from "../src/handlers/deps.ts";
import { FakeAdapter, type SeedIssue } from "./fake-adapter.ts";

const REG = `repos:
  skills:
    code: sk
    url: git@github.com:lbrmi/skills.git
    lines: { main: { protected: true } }
  yolo:
    code: yo
    url: git@github.com:lbrmi/yolo.git
    lines: { main: { protected: true } }
`;
const REG_FILE = "/home/test/.yard/config/projects/demo.yml";

function fa(): FakeAdapter {
  const a = new FakeAdapter();
  a.setFile(REG_FILE, REG);
  return a;
}
const i = (
  number: number,
  body = "",
  state = "OPEN",
  labels: string[] = ["Yard"],
): SeedIssue => ({ number, title: `t${number}`, state, labels, body });

describe("deps — topo-ordered batches", () => {
  test("linear chain: #1 <- #2 <- #3 produces three ordered batches", async () => {
    const a = fa();
    a.seedIssues("lbrmi/skills", [
      i(1),
      i(2, "## Blocked by\n- #1"),
      i(3, "## Blocked by\n- #2"),
    ]);
    a.seedIssues("lbrmi/yolo", []);
    const r = await deps({ expr: "all", file: REG_FILE, state: "open" }, a);
    expect(r.batches).toEqual([
      ["lbrmi/skills#1"],
      ["lbrmi/skills#2"],
      ["lbrmi/skills#3"],
    ]);
  });

  test("independent issues land in one batch, sorted", async () => {
    const a = fa();
    a.seedIssues("lbrmi/skills", [i(3), i(1), i(2)]);
    a.seedIssues("lbrmi/yolo", []);
    const r = await deps({ expr: "all", file: REG_FILE, state: "open" }, a);
    expect(r.batches).toEqual([
      ["lbrmi/skills#1", "lbrmi/skills#2", "lbrmi/skills#3"],
    ]);
  });

  test("diamond: 4 blocked by 2 and 3, both blocked by 1", async () => {
    const a = fa();
    a.seedIssues("lbrmi/skills", [
      i(1),
      i(2, "## Blocked by\n- #1"),
      i(3, "## Blocked by\n- #1"),
      i(4, "## Blocked by\n- #2\n- #3"),
    ]);
    a.seedIssues("lbrmi/yolo", []);
    const r = await deps({ expr: "all", file: REG_FILE, state: "open" }, a);
    expect(r.batches).toEqual([
      ["lbrmi/skills#1"],
      ["lbrmi/skills#2", "lbrmi/skills#3"],
      ["lbrmi/skills#4"],
    ]);
  });
});

describe("deps — cross-repo Blocked by, both forms", () => {
  test("bare #N resolves in own repo; owner/repo#N resolves cross-repo", async () => {
    const a = fa();
    a.seedIssues("lbrmi/skills", [
      i(1),
      i(2, "## Blocked by\n- #1\n- lbrmi/yolo#9"),
    ]);
    a.seedIssues("lbrmi/yolo", [i(9, "", "OPEN")]);
    const r = await deps({ expr: "all", file: REG_FILE, state: "open" }, a);
    // yolo#9 is open + in scope -> it's a node + an edge.
    expect(r.nodes.map((n) => n.id).sort()).toEqual([
      "lbrmi/skills#1",
      "lbrmi/skills#2",
      "lbrmi/yolo#9",
    ]);
    expect(r.edges).toContainEqual({
      from: "lbrmi/skills#2",
      to: "lbrmi/yolo#9",
    });
    expect(r.edges).toContainEqual({
      from: "lbrmi/skills#2",
      to: "lbrmi/skills#1",
    });
  });

  test("CLOSED blocker is satisfied and dropped from ordering", async () => {
    const a = fa();
    a.seedIssues("lbrmi/skills", [i(2, "## Blocked by\n- lbrmi/yolo#9")]);
    a.seedIssues("lbrmi/yolo", [i(9, "", "CLOSED")]);
    const r = await deps({ expr: "all", file: REG_FILE, state: "open" }, a);
    expect(r.edges).toEqual([]);
    expect(r.satisfied).toContainEqual({
      from: "lbrmi/skills#2",
      to: "lbrmi/yolo#9",
      state: "CLOSED",
    });
    expect(r.batches).toEqual([["lbrmi/skills#2"]]);
  });

  test("blocker state resolved in ITS OWN repo (cross-repo getIssue)", async () => {
    const a = fa();
    a.seedIssues("lbrmi/skills", [i(2, "## Blocked by\n- lbrmi/yolo#9")]);
    a.seedIssues("lbrmi/yolo", [i(9, "", "CLOSED")]);
    await deps({ expr: "all", file: REG_FILE, state: "open" }, a);
    // yolo#9 is out of scope (scope state=open, it's CLOSED) -> fetched via getIssue on its repo
    expect(a.getCalls).toContainEqual({ repo: "lbrmi/yolo", number: 9 });
  });

  test("unresolvable blocker repo is isolated into errors[]", async () => {
    const a = fa();
    a.seedIssues("lbrmi/skills", [i(2, "## Blocked by\n- lbrmi/yolo#9")]);
    a.failingRepos.add("lbrmi/yolo");
    const r = await deps({ expr: "all", file: REG_FILE, state: "open" }, a);
    expect(r.errors.some((e) => e.repo === "lbrmi/yolo")).toBe(true);
    // still orderable for the rest
    expect(r.batches).toEqual([["lbrmi/skills#2"]]);
  });
});

describe("deps — cycle detection fails loud, named", () => {
  test("2-node cycle names the path", async () => {
    const a = fa();
    a.seedIssues("lbrmi/skills", [
      i(1, "## Blocked by\n- #2"),
      i(2, "## Blocked by\n- #1"),
    ]);
    a.seedIssues("lbrmi/yolo", []);
    let err: unknown;
    try {
      await deps({ expr: "all", file: REG_FILE, state: "open" }, a);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CycleError);
    expect((err as CycleError).message).toMatch(/cycle detected:/);
    expect((err as CycleError).path[0]).toBe(
      (err as CycleError).path[(err as CycleError).path.length - 1],
    );
  });

  test("3-node cross-repo cycle is detected and named", async () => {
    const a = fa();
    a.seedIssues("lbrmi/skills", [
      i(1, "## Blocked by\n- lbrmi/yolo#2"),
      i(3, "## Blocked by\n- #1"),
    ]);
    a.seedIssues("lbrmi/yolo", [i(2, "## Blocked by\n- lbrmi/skills#3")]);
    await expect(
      deps({ expr: "all", file: REG_FILE, state: "open" }, a),
    ).rejects.toThrow(/cycle detected:/);
  });
});

describe("deps — deterministic across runs", () => {
  test("shuffled gh order -> byte-identical JSON", async () => {
    const mk = (order: SeedIssue[]) => {
      const a = fa();
      a.seedIssues("lbrmi/skills", order);
      a.seedIssues("lbrmi/yolo", []);
      return a;
    };
    const set = [
      i(1),
      i(2, "## Blocked by\n- #1"),
      i(3, "## Blocked by\n- #1"),
      i(4, "## Blocked by\n- #2\n- #3"),
    ];
    const r1 = await deps(
      { expr: "all", file: REG_FILE, state: "open" },
      mk([set[3]!, set[0]!, set[2]!, set[1]!]),
    );
    const r2 = await deps(
      { expr: "all", file: REG_FILE, state: "open" },
      mk([set[1]!, set[2]!, set[0]!, set[3]!]),
    );
    expect(JSON.stringify(r1, null, 2)).toBe(JSON.stringify(r2, null, 2));
  });
});
