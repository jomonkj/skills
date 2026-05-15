/**
 * Handler-core barrel. The MCP transport (future slice) imports from here;
 * it shares the exact same handlers as the CLI (ADR 0003).
 */
export { labelsEnsure } from "./handlers/labels-ensure.ts";
export type {
  LabelsEnsureResult,
  LabelChange,
} from "./handlers/labels-ensure.ts";
export {
  registryRead,
  defaultRegistryFile,
} from "./handlers/registry-read.ts";
export type { RegistryReadResult } from "./handlers/registry-read.ts";
export { init, configDirFor, profileFileFor } from "./handlers/init.ts";
export type { InitResult } from "./handlers/init.ts";
export { issueCreate } from "./handlers/issue-create.ts";
export type { IssueCreateResult } from "./handlers/issue-create.ts";
export {
  projectAdd,
  repoAdd,
  lineAdd,
  lineRm,
  envSet,
  depAdd,
  depRm,
  projectSync,
  defaultRegistryFile as registryMutateDefaultFile,
} from "./handlers/registry-mutate.ts";
export type {
  MutateResult,
  ProjectAddResult,
  RepoAddResult,
  LineAddResult,
  LineRmResult,
  EnvSetResult,
  DepAddResult,
  DepRmResult,
  ProjectSyncResult,
} from "./handlers/registry-mutate.ts";
export {
  scope,
  parseScopeExpr,
  registryRepoSlugs,
} from "./handlers/scope.ts";
export type {
  ScopeResult,
  ScopeIssue,
  ScopeRepoError,
} from "./handlers/scope.ts";
export { deps, CycleError } from "./handlers/deps.ts";
export type { DepsResult, DepsNode } from "./handlers/deps.ts";
export { ensure } from "./handlers/ensure.ts";
export type {
  EnsureResult,
  PlannedClone,
  CloneOutcome,
} from "./handlers/ensure.ts";
export { doctor } from "./handlers/doctor.ts";
export type {
  DoctorResult,
  DriftItem,
  DriftKind,
} from "./handlers/doctor.ts";
export {
  dispatchInit,
  branchName,
  worktreePath,
} from "./handlers/dispatch-init.ts";
export type {
  DispatchInitResult,
  DispatchInitAction,
} from "./handlers/dispatch-init.ts";
export { dispatchDone } from "./handlers/dispatch-done.ts";
export type { DispatchDoneResult } from "./handlers/dispatch-done.ts";
export { ciWait } from "./handlers/ci-wait.ts";
export type { CiWaitResult, CiWaitStatus } from "./handlers/ci-wait.ts";
export { sweep } from "./handlers/sweep.ts";
export type {
  SweepResult,
  SweepItem,
  SweepDecision,
} from "./handlers/sweep.ts";
export {
  PHASE_QUEUED,
  PHASE_IMPLEMENTING,
  PHASE_AWAITING_HUMAN_MERGE,
  PHASE_HITL,
  PHASE_FAILED,
  PHASE_DONE,
  ALL_PHASES,
  TERMINAL_PHASES,
  KEEP_FOR_INSPECTION,
  STALE_LOCK_MS,
  currentPhase,
} from "./phases.ts";
export type { Phase } from "./phases.ts";
export { parseBlockedBy } from "./blocked-by.ts";
export type { BlockerRef } from "./blocked-by.ts";
export { repoSlugFromUrl } from "./repo-url.ts";
export {
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
  dispatchOutcomeEnum,
  ciWaitInput,
  sweepInput,
  issueStateEnum,
  OUTPUT_VERSION,
} from "./schema.ts";
export type {
  LabelsEnsureInput,
  RegistryReadInput,
  InitInput,
  IssueCreateInput,
  ProjectAddInput,
  RepoAddInput,
  LineAddInput,
  LineRmInput,
  EnvSetInput,
  DepAddInput,
  DepRmInput,
  ProjectSyncInput,
  ScopeInput,
  DepsInput,
  EnsureInput,
  DoctorInput,
  DispatchInitInput,
  DispatchDoneInput,
  DispatchOutcome,
  CiWaitInput,
  SweepInput,
} from "./schema.ts";
export {
  registrySchema,
  repoSchema,
  lineSchema,
  needSchema,
  repoKeyToDir,
} from "./schemas/registry.ts";
export type {
  Registry,
  Repo,
  Line,
  Need,
} from "./schemas/registry.ts";
export { profileSchema } from "./schemas/profile.ts";
export type { Profile } from "./schemas/profile.ts";
export {
  DEFAULT_PROTECTED_REGEX,
  makeProtectedMatcher,
  isProtected,
} from "./protected.ts";
export { canonicalLabels } from "./labels.ts";
export type { CanonicalLabel, LabelSet } from "./labels.ts";
export { emitYaml, canonicalize } from "./yaml.ts";
export type { Json } from "./yaml.ts";
export { GhAdapter } from "./adapter.ts";
export type {
  Adapter,
  GhIssue,
  GhLabel,
  IssueState,
} from "./adapter.ts";
export { buildMcpServer, startMcpServer } from "./mcp.ts";
