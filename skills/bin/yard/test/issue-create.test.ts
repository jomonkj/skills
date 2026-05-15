import { describe, expect, test } from "bun:test";
import { issueCreate } from "../src/handlers/issue-create.ts";
import { canonicalLabels } from "../src/labels.ts";
import { FakeAdapter } from "./fake-adapter.ts";

const REPO = "lbrmi/skills";

describe("issue-create handler", () => {
  test("creates an issue with labels", async () => {
    const fa = new FakeAdapter();
    const res = await issueCreate(
      {
        repo: REPO,
        title: "My issue",
        body: "Some body",
        labels: ["Yard", "difficulty:medium"],
        ensureSet: "none",
        dryRun: false,
      },
      fa,
    );
    expect(res.command).toBe("issue-create");
    expect(res.version).toBe(1);
    expect(res.number).toBe(1);
    expect(res.url).toBe(`https://github.com/${REPO}/issues/1`);
    expect(res.dryRun).toBe(false);
    expect(fa.issueCalls.length).toBe(1);
    expect(fa.issueCalls[0]!.issue.title).toBe("My issue");
    expect(fa.issueCalls[0]!.issue.labels).toEqual(["Yard", "difficulty:medium"]);
  });

  test("prepends ## Parent section when --parent is given", async () => {
    const fa = new FakeAdapter();
    const res = await issueCreate(
      {
        repo: REPO,
        title: "Child issue",
        body: "## What to build\n\nStuff.",
        labels: [],
        parent: 3,
        ensureSet: "none",
        dryRun: false,
      },
      fa,
    );
    const body = fa.issueCalls[0]!.issue.body;
    expect(body).toMatch(/^## Parent\n#3\n\n/);
    expect(body).toContain("## What to build");
    expect(res.parent).toBe(3);
  });

  test("parent with empty body produces just the Parent section", async () => {
    const fa = new FakeAdapter();
    await issueCreate(
      {
        repo: REPO,
        title: "Child only",
        body: "",
        labels: [],
        parent: 5,
        ensureSet: "none",
        dryRun: false,
      },
      fa,
    );
    expect(fa.issueCalls[0]!.issue.body).toBe("## Parent\n#5");
  });

  test("no parent — body is unchanged", async () => {
    const fa = new FakeAdapter();
    await issueCreate(
      {
        repo: REPO,
        title: "No parent",
        body: "Hello",
        labels: [],
        ensureSet: "none",
        dryRun: false,
      },
      fa,
    );
    expect(fa.issueCalls[0]!.issue.body).toBe("Hello");
  });

  test("--dry-run skips issue creation, returns null number/url", async () => {
    const fa = new FakeAdapter();
    const res = await issueCreate(
      {
        repo: REPO,
        title: "Dry run issue",
        body: "body",
        labels: ["Yard"],
        ensureSet: "none",
        dryRun: true,
      },
      fa,
    );
    expect(res.dryRun).toBe(true);
    expect(res.number).toBeNull();
    expect(res.url).toBeNull();
    expect(fa.issueCalls.length).toBe(0);
  });

  test("ensureSet=all runs labels-ensure before creating issue", async () => {
    const fa = new FakeAdapter([]); // empty — labels need creating
    const res = await issueCreate(
      {
        repo: REPO,
        title: "With ensure",
        body: "body",
        labels: ["Yard"],
        ensureSet: "all",
        dryRun: false,
      },
      fa,
    );
    // labels-ensure should have run
    const allLabels = canonicalLabels("all");
    expect(fa.createCalls.length).toBe(allLabels.length);
    // issue still created
    expect(fa.issueCalls.length).toBe(1);
    expect(res.number).toBe(1);
  });

  test("ensureSet=all with dry-run runs labels-ensure dry-run only", async () => {
    const fa = new FakeAdapter([]);
    const res = await issueCreate(
      {
        repo: REPO,
        title: "Dry ensure",
        body: "",
        labels: [],
        ensureSet: "all",
        dryRun: true,
      },
      fa,
    );
    // dry-run labels-ensure: no mutations
    expect(fa.createCalls.length).toBe(0);
    expect(fa.issueCalls.length).toBe(0);
    expect(res.number).toBeNull();
  });
});
