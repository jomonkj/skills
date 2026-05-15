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
  labelsEnsureInput,
  registryReadInput,
  initInput,
  issueCreateInput,
  OUTPUT_VERSION,
} from "./schema.ts";
export type {
  LabelsEnsureInput,
  RegistryReadInput,
  InitInput,
  IssueCreateInput,
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
export type { Adapter, GhIssue, GhLabel } from "./adapter.ts";
