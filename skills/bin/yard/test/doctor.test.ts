import { describe, expect, test } from "bun:test";
import { doctor } from "../src/handlers/doctor.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const HOME = "/home/test";
const PROFILE_FILE = `${HOME}/.yard/profile.me.yml`;
const REG_FILE = `${HOME}/.yard/config/projects/demo.yml`;

const PROFILE = `root: /work\n`;
const REG = `repos:
  app:
    code: ap
    url: git@github.com:lbrmi/app.git
    lines: { main: {}, "2.x": {} }
`;

function base(): FakeAdapter {
  const fa = new FakeAdapter();
  fa.setFile(PROFILE_FILE, PROFILE);
  fa.setFile(REG_FILE, REG);
  return fa;
}

const input = { project: "demo", profile: "me", fix: false };

describe("doctor — reconcile registry vs filesystem", () => {
  test("all present + correct => no drift", async () => {
    const fa = base();
    for (const line of ["main", "2.x"]) {
      const dir = `/work/demo/app/ap_${line}`;
      fa.setFile(`${dir}/.git/HEAD`, "ref: x");
      fa.setGitState(dir, "git@github.com:lbrmi/app.git", line);
    }
    const r = await doctor(input, fa);
    expect(r.drift).toHaveLength(0);
    expect(r.ok).toBe(2);
  });

  test("missing dir reported", async () => {
    const fa = base();
    // Only main present; 2.x absent.
    fa.setFile("/work/demo/app/ap_main/.git/HEAD", "ref: x");
    fa.setGitState("/work/demo/app/ap_main", "git@github.com:lbrmi/app.git", "main");

    const r = await doctor(input, fa);
    expect(r.drift).toHaveLength(1);
    expect(r.drift[0]!.kind).toBe("missing");
    expect(r.drift[0]!.line).toBe("2.x");
    expect(r.drift[0]!.fixed).toBe(false); // report-only by default
    expect(fa.cloneCalls).toHaveLength(0); // no silent divergence/repair
  });

  test("wrong remote and wrong branch reported distinctly", async () => {
    const fa = base();
    fa.setFile("/work/demo/app/ap_main/.git/HEAD", "ref: x");
    fa.setGitState("/work/demo/app/ap_main", "git@github.com:bad/app.git", "main");
    fa.setFile("/work/demo/app/ap_2.x/.git/HEAD", "ref: x");
    fa.setGitState("/work/demo/app/ap_2.x", "git@github.com:lbrmi/app.git", "main");

    const r = await doctor(input, fa);
    const kinds = r.drift.map((d) => `${d.kind}:${d.line}`).sort();
    expect(kinds).toEqual(["drift-branch:2.x", "drift-remote:main"]);
  });

  test("extra line-shaped dir reported, never deleted", async () => {
    const fa = base();
    for (const line of ["main", "2.x"]) {
      const dir = `/work/demo/app/ap_${line}`;
      fa.setFile(`${dir}/.git/HEAD`, "ref: x");
      fa.setGitState(dir, "git@github.com:lbrmi/app.git", line);
    }
    // An undeclared `{code}_{line}` dir on disk.
    fa.setFile("/work/demo/app/ap_oldfeature/.git/HEAD", "ref: x");

    const r = await doctor(input, fa);
    const extra = r.drift.find((d) => d.kind === "extra");
    expect(extra).toBeDefined();
    expect(extra!.line).toBe("oldfeature");
    expect(extra!.detail).toMatch(/doctor never deletes/);
  });

  test("--fix re-clones missing + repairs drift", async () => {
    const fa = base();
    // main missing; 2.x on wrong branch.
    fa.setFile("/work/demo/app/ap_2.x/.git/HEAD", "ref: x");
    fa.setGitState("/work/demo/app/ap_2.x", "git@github.com:lbrmi/app.git", "wrong");

    const r = await doctor({ ...input, fix: true }, fa);
    expect(r.fixed).toBe(true);
    expect(r.drift.every((d) => d.fixed)).toBe(true);
    // Missing main was cloned.
    expect(fa.cloneCalls.map((c) => c.dir)).toContain("/work/demo/app/ap_main");
    // 2.x checked out back onto its line.
    expect(
      fa.gitCalls.some(
        (g) =>
          g.dir === "/work/demo/app/ap_2.x" &&
          g.args[0] === "checkout" &&
          g.args[1] === "2.x",
      ),
    ).toBe(true);
  });

  test("missing profile fails loud", async () => {
    const fa = new FakeAdapter();
    fa.setFile(REG_FILE, REG);
    await expect(doctor(input, fa)).rejects.toThrow(/profile not found/);
  });
});
