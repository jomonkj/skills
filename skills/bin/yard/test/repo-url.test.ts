import { describe, expect, test } from "bun:test";
import { repoSlugFromUrl } from "../src/repo-url.ts";

describe("repoSlugFromUrl", () => {
  test("SSH scp-like URL with .git", () => {
    expect(repoSlugFromUrl("git@github.com:lbrmi/libromi.git")).toBe(
      "lbrmi/libromi",
    );
  });

  test("SSH scp-like URL without .git", () => {
    expect(repoSlugFromUrl("git@github.com:lbrmi/skills")).toBe("lbrmi/skills");
  });

  test("HTTPS URL with .git", () => {
    expect(repoSlugFromUrl("https://github.com/lbrmi/yolo.git")).toBe(
      "lbrmi/yolo",
    );
  });

  test("HTTPS URL without .git, trailing slash", () => {
    expect(repoSlugFromUrl("https://github.com/lbrmi/yolo/")).toBe(
      "lbrmi/yolo",
    );
  });

  test("ssh:// URL form", () => {
    expect(repoSlugFromUrl("ssh://git@github.com/lbrmi/plugin-webhooks.git")).toBe(
      "lbrmi/plugin-webhooks",
    );
  });

  test("surrounding whitespace is tolerated", () => {
    expect(repoSlugFromUrl("  git@github.com:a/b.git \n")).toBe("a/b");
  });

  test("non-github URL throws a clear error", () => {
    expect(() => repoSlugFromUrl("git@gitlab.com:a/b.git")).toThrow(
      /cannot derive owner\/name/,
    );
  });

  test("garbage throws", () => {
    expect(() => repoSlugFromUrl("not a url")).toThrow();
  });
});
