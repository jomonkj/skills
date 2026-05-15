import { describe, expect, test } from "bun:test";
import { parseBlockedBy } from "../src/blocked-by.ts";

const DEFAULT = "lbrmi/skills";

describe("parseBlockedBy", () => {
  test("no section -> empty", () => {
    expect(parseBlockedBy("## What\n\nstuff", DEFAULT)).toEqual([]);
  });

  test("empty section -> empty", () => {
    expect(parseBlockedBy("## Blocked by\n\n## Next\n- #4", DEFAULT)).toEqual(
      [],
    );
  });

  test("bare #N -> defaultRepo", () => {
    expect(parseBlockedBy("## Blocked by\n- #4\n- #5", DEFAULT)).toEqual([
      { repo: DEFAULT, number: 4 },
      { repo: DEFAULT, number: 5 },
    ]);
  });

  test("qualified owner/repo#N", () => {
    expect(
      parseBlockedBy("## Blocked by\n- lbrmi/yolo#12", DEFAULT),
    ).toEqual([{ repo: "lbrmi/yolo", number: 12 }]);
  });

  test("mixed bare and qualified forms", () => {
    expect(
      parseBlockedBy(
        "## Blocked by\n- #4\n- lbrmi/yolo#12\n- #5",
        DEFAULT,
      ),
    ).toEqual([
      { repo: DEFAULT, number: 4 },
      { repo: "lbrmi/yolo", number: 12 },
      { repo: DEFAULT, number: 5 },
    ]);
  });

  test("case-insensitive header, trailing whitespace, indented bullets", () => {
    const body = "## blocked BY   \n  - #7\n  * lbrmi/yolo#8";
    expect(parseBlockedBy(body, DEFAULT)).toEqual([
      { repo: DEFAULT, number: 7 },
      { repo: "lbrmi/yolo", number: 8 },
    ]);
  });

  test("section ends at next heading", () => {
    const body = "## Blocked by\n- #4\n## Acceptance\n- #99 should NOT count";
    expect(parseBlockedBy(body, DEFAULT)).toEqual([
      { repo: DEFAULT, number: 4 },
    ]);
  });

  test("prose lines in the section are skipped", () => {
    const body = "## Blocked by\nThis depends on nothing yet.\n- #4";
    expect(parseBlockedBy(body, DEFAULT)).toEqual([
      { repo: DEFAULT, number: 4 },
    ]);
  });

  test("duplicates removed, first-seen order kept", () => {
    const body = "## Blocked by\n- #4\n- #4\n- lbrmi/yolo#1\n- lbrmi/yolo#1";
    expect(parseBlockedBy(body, DEFAULT)).toEqual([
      { repo: DEFAULT, number: 4 },
      { repo: "lbrmi/yolo", number: 1 },
    ]);
  });

  test("qualified ref takes priority over bare on same line", () => {
    expect(
      parseBlockedBy("## Blocked by\n- blocked on lbrmi/yolo#3 (was #99)", DEFAULT),
    ).toEqual([{ repo: "lbrmi/yolo", number: 3 }]);
  });

  test("a second Blocked by heading does not terminate parsing", () => {
    const body = "## Blocked by\n- #1\n## Blocked by\n- #2";
    expect(parseBlockedBy(body, DEFAULT)).toEqual([
      { repo: DEFAULT, number: 1 },
      { repo: DEFAULT, number: 2 },
    ]);
  });

  test("CRLF line endings", () => {
    expect(parseBlockedBy("## Blocked by\r\n- #4\r\n", DEFAULT)).toEqual([
      { repo: DEFAULT, number: 4 },
    ]);
  });
});
