/**
 * MCP transport (ADR 0003, Slice 8 — issue #11).
 *
 * One handler core, two thin transports. Every tool registered here calls the
 * SAME handler the CLI dispatches to — no logic duplication. Zod schemas from
 * schema.ts are the single source for both the CLI arg-parsing and the MCP
 * tool input-schema (passed as the Zod object so the SDK validates args before
 * invoking the callback — bad args rejected at the boundary, before any handler
 * runs). Structured results returned via both `content` (text/JSON) and
 * `structuredContent`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Adapter } from "./adapter.ts";
import { GhAdapter } from "./adapter.ts";
import { labelsEnsure } from "./handlers/labels-ensure.ts";
import { registryRead } from "./handlers/registry-read.ts";
import { init } from "./handlers/init.ts";
import { issueCreate } from "./handlers/issue-create.ts";
import {
  projectAdd,
  repoAdd,
  lineAdd,
  lineRm,
  envSet,
  depAdd,
  depRm,
  projectSync,
} from "./handlers/registry-mutate.ts";
import { scope } from "./handlers/scope.ts";
import { deps, CycleError } from "./handlers/deps.ts";
import { ensure } from "./handlers/ensure.ts";
import { doctor } from "./handlers/doctor.ts";
import { dispatchInit } from "./handlers/dispatch-init.ts";
import { dispatchDone } from "./handlers/dispatch-done.ts";
import { ciWait } from "./handlers/ci-wait.ts";
import { sweep } from "./handlers/sweep.ts";
import {
  labelsEnsureInput,
  registryReadInput,
  initInput,
  issueCreateInput,
  projectAddInput,
  repoAddInput,
  lineAddInput,
  lineRmInput,
  envSetInput,
  depAddInput,
  depRmInput,
  projectSyncInput,
  scopeInput,
  depsInput,
  ensureInput,
  doctorInput,
  dispatchInitInput,
  dispatchDoneInput,
  ciWaitInput,
  sweepInput,
} from "./schema.ts";

/** Wrap a structured result in the MCP tool response shape. */
function ok(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result as Record<string, unknown>,
  };
}

/** Build the McpServer with all yard tools registered. Accepts an Adapter so tests can inject FakeAdapter. */
export function buildMcpServer(adapter: Adapter = new GhAdapter()): McpServer {
  const server = new McpServer({
    name: "yard",
    version: "0.1.0",
  });

  // ── Shared plumbing ──────────────────────────────────────────────────────
  server.registerTool(
    "labels-ensure",
    {
      description:
        "Ensure canonical label sets exist in a GitHub repo (ADR 0003).",
      inputSchema: labelsEnsureInput,
    },
    async (args) => ok(await labelsEnsure(args as Parameters<typeof labelsEnsure>[0], adapter)),
  );

  server.registerTool(
    "registry-read",
    {
      description: "Read and validate a project registry YAML file (ADR 0006).",
      inputSchema: registryReadInput,
    },
    async (args) => ok(await registryRead(args as Parameters<typeof registryRead>[0], adapter)),
  );

  server.registerTool(
    "init",
    {
      description: "Clone the yard-config registry and write a profile (ADR 0006).",
      inputSchema: initInput,
    },
    async (args) => ok(await init(args as Parameters<typeof init>[0], adapter)),
  );

  server.registerTool(
    "issue-create",
    {
      description: "Create a GitHub issue with labels ensured first (ADR 0003).",
      inputSchema: issueCreateInput,
    },
    async (args) => ok(await issueCreate(args as Parameters<typeof issueCreate>[0], adapter)),
  );

  server.registerTool(
    "scope",
    {
      description:
        "Resolve a scope expression to a sorted list of issues across registry repos (ADR 0003).",
      inputSchema: scopeInput,
    },
    async (args) => ok(await scope(args as Parameters<typeof scope>[0], adapter)),
  );

  server.registerTool(
    "deps",
    {
      description:
        "Resolve a scope, parse Blocked-by sections, and return topo-ordered batches (ADR 0003).",
      inputSchema: depsInput,
    },
    async (args) => {
      try {
        return ok(await deps(args as Parameters<typeof deps>[0], adapter));
      } catch (err) {
        // CycleError and all other errors propagate — SDK turns them into isError:true.
        throw err;
      }
    },
  );

  server.registerTool(
    "ensure",
    {
      description:
        "Deterministically clone/checkout repos the scope needs (ADR 0006).",
      inputSchema: ensureInput,
    },
    async (args) => ok(await ensure(args as Parameters<typeof ensure>[0], adapter)),
  );

  server.registerTool(
    "doctor",
    {
      description:
        "Reconcile registry intent vs filesystem reality; report or fix drift (ADR 0006).",
      inputSchema: doctorInput,
    },
    async (args) => ok(await doctor(args as Parameters<typeof doctor>[0], adapter)),
  );

  // ── Ship-only ────────────────────────────────────────────────────────────
  server.registerTool(
    "dispatch-init",
    {
      description:
        "Atomically claim a slice and materialise its worktree (ADR 0003/0005/0007).",
      inputSchema: dispatchInitInput,
    },
    async (args) => ok(await dispatchInit(args as Parameters<typeof dispatchInit>[0], adapter)),
  );

  server.registerTool(
    "dispatch-done",
    {
      description:
        "Record a slice's terminal outcome with one atomic label move (ADR 0003/0005/0007).",
      inputSchema: dispatchDoneInput,
    },
    async (args) => ok(await dispatchDone(args as Parameters<typeof dispatchDone>[0], adapter)),
  );

  server.registerTool(
    "ci-wait",
    {
      description:
        "Bounded poll of a PR's checks; HARD wall-clock cap (ADR 0007).",
      inputSchema: ciWaitInput,
    },
    async (args) => ok(await ciWait(args as Parameters<typeof ciWait>[0], adapter)),
  );

  server.registerTool(
    "sweep",
    {
      description:
        "GC orphaned issue worktrees/branches; never touches protected branches (ADR 0006/0007).",
      inputSchema: sweepInput,
    },
    async (args) => ok(await sweep(args as Parameters<typeof sweep>[0], adapter)),
  );

  // ── Registry mutators ────────────────────────────────────────────────────
  server.registerTool(
    "project-add",
    {
      description: "Add a project entry to the registry YAML (ADR 0006).",
      inputSchema: projectAddInput,
    },
    async (args) => ok(await projectAdd(args as Parameters<typeof projectAdd>[0], adapter)),
  );

  server.registerTool(
    "project-sync",
    {
      description: "Commit and push registry changes (ADR 0006).",
      inputSchema: projectSyncInput,
    },
    async (args) => ok(await projectSync(args as Parameters<typeof projectSync>[0], adapter)),
  );

  server.registerTool(
    "repo-add",
    {
      description: "Add a repo entry to a project in the registry (ADR 0006).",
      inputSchema: repoAddInput,
    },
    async (args) => ok(await repoAdd(args as Parameters<typeof repoAdd>[0], adapter)),
  );

  server.registerTool(
    "line-add",
    {
      description: "Add a release line to a repo in the registry (ADR 0006).",
      inputSchema: lineAddInput,
    },
    async (args) => ok(await lineAdd(args as Parameters<typeof lineAdd>[0], adapter)),
  );

  server.registerTool(
    "line-rm",
    {
      description: "Remove a release line from a repo in the registry (ADR 0006).",
      inputSchema: lineRmInput,
    },
    async (args) => ok(await lineRm(args as Parameters<typeof lineRm>[0], adapter)),
  );

  server.registerTool(
    "env-set",
    {
      description: "Set an env tag on a release line in the registry (ADR 0006).",
      inputSchema: envSetInput,
    },
    async (args) => ok(await envSet(args as Parameters<typeof envSet>[0], adapter)),
  );

  server.registerTool(
    "dep-add",
    {
      description: "Add a dependency between repo lines in the registry (ADR 0006).",
      inputSchema: depAddInput,
    },
    async (args) => ok(await depAdd(args as Parameters<typeof depAdd>[0], adapter)),
  );

  server.registerTool(
    "dep-rm",
    {
      description: "Remove a dependency between repo lines in the registry (ADR 0006).",
      inputSchema: depRmInput,
    },
    async (args) => ok(await depRm(args as Parameters<typeof depRm>[0], adapter)),
  );

  return server;
}

/** Start `yard mcp` — connect the server to stdio and run until closed. */
export async function startMcpServer(adapter: Adapter = new GhAdapter()): Promise<void> {
  // Import stdio transport lazily so pure-library consumers don't pull in
  // Node.js process.stdin/stdout side-effects at module load time.
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const server = buildMcpServer(adapter);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
