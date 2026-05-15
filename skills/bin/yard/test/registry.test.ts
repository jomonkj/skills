import { describe, expect, test } from "bun:test";
import { registrySchema, repoKeyToDir } from "../src/schemas/registry.ts";
import { registryRead } from "../src/handlers/registry-read.ts";
import { FakeAdapter } from "./fake-adapter.ts";

/** The ADR 0006 example registry, as YAML. */
const GOOD_YAML = `repos:
  yolo:
    code: yo
    url: git@github.com:lbrmi/yolo.git
    lines: { 0.x: { protected: true, env: prod } }
  apps.libromi:
    code: lbr
    url: git@github.com:lbrmi/libromi.git
    lines: { main: { protected: true, env: prod } }
  plugins.webhooks:
    code: wh
    url: git@github.com:lbrmi/plugin-webhooks.git
    lines: { main: { protected: true, env: prod } }
    needs:
      - { repo: yolo, line: "0.x" }
protected:
  - "^sandbox/.*$"
`;

describe("registry schema + dotted-key mapping (ADR 0006)", () => {
  test("dotted repo key apps.libromi maps to dir apps/libromi", () => {
    expect(repoKeyToDir("apps.libromi")).toBe("apps/libromi");
    expect(repoKeyToDir("plugins.webhooks")).toBe("plugins/webhooks");
    expect(repoKeyToDir("yolo")).toBe("yolo"); // no dot -> unchanged
  });

  test("the ADR 0006 example registry parses; code/lines/needs are per-repo", () => {
    const r = registrySchema.parse({
      repos: {
        yolo: {
          code: "yo",
          url: "git@github.com:lbrmi/yolo.git",
          lines: { "0.x": { protected: true, env: "prod" } },
        },
        "apps.libromi": {
          code: "lbr",
          url: "git@github.com:lbrmi/libromi.git",
          lines: { main: { protected: true, env: "prod" } },
        },
        "plugins.webhooks": {
          code: "wh",
          url: "git@github.com:lbrmi/plugin-webhooks.git",
          lines: { main: { protected: true, env: "prod" } },
          needs: [{ repo: "yolo", line: "0.x" }],
        },
      },
    });
    expect(r.repos["yolo"]!.code).toBe("yo");
    expect(r.repos["plugins.webhooks"]!.needs![0]).toEqual({
      repo: "yolo",
      line: "0.x",
    });
    expect(r.repos["apps.libromi"]!.lines["main"]!.protected).toBe(true);
  });

  test("strict schema REJECTS a synced secret (no secrets synced — ADR 0006)", () => {
    const res = registrySchema.safeParse({
      repos: {
        yolo: {
          code: "yo",
          url: "git@github.com:lbrmi/yolo.git",
          lines: { main: {} },
          token: "ghp_supersecret", // unknown key
        },
      },
    });
    expect(res.success).toBe(false);
  });

  test("invalid dotted key shape is rejected with a clear message", () => {
    const res = registrySchema.safeParse({
      repos: { "apps/libromi": { code: "x", url: "u", lines: { main: {} } } },
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => /dotted dir path/.test(i.message))).toBe(
        true,
      );
    }
  });
});

describe("registry-read handler", () => {
  test("reads + validates a good file and derives repoDirs from dotted keys", async () => {
    const fa = new FakeAdapter();
    fa.setFile("/home/test/.yard/config/projects/yolo-hq.yml", GOOD_YAML);
    const r = await registryRead({ project: "yolo-hq" }, fa);
    expect(r.command).toBe("registry-read");
    expect(r.version).toBe(1);
    expect(r.repoDirs["apps.libromi"]).toBe("apps/libromi");
    expect(r.repoDirs["plugins.webhooks"]).toBe("plugins/webhooks");
    expect(r.registry.repos["yolo"]!.code).toBe("yo");
    expect(r.registry.protected).toEqual(["^sandbox/.*$"]);
  });

  test("explicit --file path is honoured", async () => {
    const fa = new FakeAdapter();
    fa.setFile("/custom/wc.yml", GOOD_YAML);
    const r = await registryRead({ file: "/custom/wc.yml" }, fa);
    expect(r.file).toBe("/custom/wc.yml");
  });

  test("missing file -> clear actionable error", async () => {
    const fa = new FakeAdapter();
    await expect(registryRead({ project: "ghost" }, fa)).rejects.toThrow(
      /registry file not found/,
    );
  });

  test("malformed YAML -> clear error naming the file", async () => {
    const fa = new FakeAdapter();
    fa.setFile(
      "/home/test/.yard/config/projects/bad.yml",
      "repos: [unclosed\n",
    );
    await expect(registryRead({ project: "bad" }, fa)).rejects.toThrow(
      /malformed YAML in .*bad\.yml/,
    );
  });

  test("schema-invalid file -> error lists the offending path", async () => {
    const fa = new FakeAdapter();
    fa.setFile(
      "/home/test/.yard/config/projects/x.yml",
      "repos:\n  yolo:\n    url: u\n    lines: { main: {} }\n", // missing code
    );
    await expect(registryRead({ project: "x" }, fa)).rejects.toThrow(
      /invalid registry .*code/,
    );
  });
});
