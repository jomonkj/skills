/**
 * MCP transport tests (ADR 0003, Slice 8 — issue #11).
 *
 * Tests: tool-list completeness, a representative handler round-trip via the
 * in-process transport, and bad-arg rejection at the schema boundary.
 *
 * We use InMemoryTransport + Client from the MCP SDK so we drive a real
 * JSON-RPC exchange without spawning a subprocess or touching stdio.
 */
import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "../src/mcp.ts";
import { FakeAdapter } from "./fake-adapter.ts";

/** The 20 tool names that must be registered (one per CLI dispatch path). */
const EXPECTED_TOOLS = [
  // shared plumbing
  "labels-ensure",
  "registry-read",
  "init",
  "issue-create",
  "scope",
  "deps",
  "ensure",
  "doctor",
  // ship-only
  "dispatch-init",
  "dispatch-done",
  "ci-wait",
  "sweep",
  // registry mutators
  "project-add",
  "project-sync",
  "repo-add",
  "line-add",
  "line-rm",
  "env-set",
  "dep-add",
  "dep-rm",
].sort();

/** Wire an MCP server to an in-process client and return the connected client. */
async function buildClient(adapter: FakeAdapter): Promise<Client> {
  const server = buildMcpServer(adapter);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(clientTransport);
  return client;
}

describe("MCP transport", () => {
  test("tool-list: all 20 tools registered with expected names", async () => {
    const fa = new FakeAdapter([]);
    const client = await buildClient(fa);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOLS);
    await client.close();
  });

  test("labels-ensure round-trip: same handler, versioned result", async () => {
    const fa = new FakeAdapter([]);
    const client = await buildClient(fa);

    const r = await client.callTool({
      name: "labels-ensure",
      arguments: { repo: "lbrmi/skills", set: "yard", dryRun: false },
    });

    // No error
    expect(r.isError).toBeFalsy();
    // content[0] is text/JSON
    const content = r.content as { type: string; text: string }[];
    expect(content).toHaveLength(1);
    const item = content[0] as { type: string; text: string };
    expect(item.type).toBe("text");
    const parsed = JSON.parse(item.text);
    // Same versioned shape the CLI emits
    expect(parsed.version).toBe(1);
    expect(parsed.command).toBe("labels-ensure");
    expect(typeof parsed.summary.created).toBe("number");
    // Handler was called — FakeAdapter recorded create calls
    expect(fa.createCalls.length).toBeGreaterThan(0);

    await client.close();
  });

  test("bad-arg rejection: missing required field rejected before handler runs", async () => {
    const fa = new FakeAdapter([]);
    const client = await buildClient(fa);

    // labels-ensure requires `repo`; omit it → schema rejects
    const r = await client.callTool({
      name: "labels-ensure",
      arguments: { set: "yard" }, // missing repo
    });

    expect(r.isError).toBe(true);
    // Handler was never called — adapter saw zero mutations
    expect(fa.createCalls).toHaveLength(0);
    expect(fa.editCalls).toHaveLength(0);

    await client.close();
  });

  test("issue-create round-trip: structured result from same handler", async () => {
    const fa = new FakeAdapter([]);
    const client = await buildClient(fa);

    const r = await client.callTool({
      name: "issue-create",
      arguments: {
        repo: "lbrmi/skills",
        title: "test issue",
        dryRun: true,
      },
    });

    expect(r.isError).toBeFalsy();
    const content2 = r.content as { type: string; text: string }[];
    const item2 = content2[0] as { type: string; text: string };
    const parsed = JSON.parse(item2.text);
    expect(parsed.version).toBe(1);
    expect(parsed.dryRun).toBe(true);
    // dry-run: no real gh issue-create call
    expect(fa.issueCalls).toHaveLength(0);

    await client.close();
  });

  test("buildMcpServer smoke: returns McpServer without error", () => {
    const fa = new FakeAdapter([]);
    const server = buildMcpServer(fa);
    // McpServer has a .server property (the underlying low-level Server)
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });
});
