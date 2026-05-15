import { describe, expect, test } from "bun:test";
import { init, configDirFor, profileFileFor } from "../src/handlers/init.ts";
import { profileSchema } from "../src/schemas/profile.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const PROFILE_YAML = `root: /home/test/projects
projects:
  - yolo-hq
ghIdentity: alice
`;

const REG_YAML = `repos:
  yolo:
    code: yo
    url: git@github.com:lbrmi/yolo.git
    lines: { main: { protected: true } }
`;

function seedClone(_url: string, dir: string, fa: FakeAdapter) {
  fa.setFile(`${dir}/projects/yolo-hq.yml`, REG_YAML);
}

describe("profile schema (ADR 0006: machine-local, no secrets)", () => {
  test("valid profile parses; no token field exists in the schema", () => {
    const p = profileSchema.parse({
      root: "/home/test/projects",
      projects: ["yolo-hq"],
      ghIdentity: "alice",
    });
    expect(p.root).toBe("/home/test/projects");
  });

  test("strict schema rejects a secret key in the profile", () => {
    const res = profileSchema.safeParse({
      root: "/x",
      token: "secret",
    });
    expect(res.success).toBe(false);
  });
});

describe("yard init --from <url> --profile <name> (ADR 0006)", () => {
  test("clones the registry repo and applies (reads+validates) the profile", async () => {
    const fa = new FakeAdapter();
    fa.onClone = seedClone;
    fa.setFile(profileFileFor("/home/test", "alice"), PROFILE_YAML);

    const r = await init({ from: "git@github.com:lbrmi/yard-config.git", profile: "alice" }, fa);

    expect(r.command).toBe("init");
    expect(r.cloned).toBe(true);
    expect(fa.cloneCalls).toEqual([
      { url: "git@github.com:lbrmi/yard-config.git", dir: configDirFor("/home/test") },
    ]);
    expect(r.profile.root).toBe("/home/test/projects");
    expect(r.profile.ghIdentity).toBe("alice");
    expect(r.projects).toEqual(["yolo-hq"]);
  });

  test("idempotent: existing config dir is NOT re-cloned (doctor reconciles, not init)", async () => {
    const fa = new FakeAdapter();
    const cfg = configDirFor("/home/test");
    fa.setFile(`${cfg}/projects/yolo-hq.yml`, REG_YAML);
    fa.setFile(profileFileFor("/home/test", "alice"), PROFILE_YAML);

    const r = await init({ from: "u", profile: "alice" }, fa);
    expect(r.cloned).toBe(false);
    expect(fa.cloneCalls.length).toBe(0);
  });

  test("missing profile -> loud actionable error (not auto-generated)", async () => {
    const fa = new FakeAdapter();
    fa.onClone = seedClone;
    await expect(
      init({ from: "u", profile: "bob" }, fa),
    ).rejects.toThrow(/profile not found.*profile\.bob\.yml/);
  });

  test("a synced secret in a registry file aborts init (no secrets synced)", async () => {
    const fa = new FakeAdapter();
    fa.onClone = (_u, dir, f) =>
      f.setFile(
        `${dir}/projects/evil.yml`,
        "repos:\n  yolo:\n    code: yo\n    url: u\n    lines: { main: {} }\n    token: ghp_x\n",
      );
    fa.setFile(profileFileFor("/home/test", "alice"), PROFILE_YAML);
    await expect(
      init({ from: "u", profile: "alice" }, fa),
    ).rejects.toThrow(/failed validation|no secrets are synced/);
  });

  test("malformed profile YAML -> clear error", async () => {
    const fa = new FakeAdapter();
    fa.onClone = seedClone;
    fa.setFile(profileFileFor("/home/test", "alice"), "root: [oops\n");
    await expect(
      init({ from: "u", profile: "alice" }, fa),
    ).rejects.toThrow(/malformed YAML in profile/);
  });
});
