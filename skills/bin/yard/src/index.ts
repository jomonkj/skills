/**
 * Handler-core barrel. The MCP transport (future slice) imports from here;
 * it shares the exact same handlers as the CLI (ADR 0003).
 */
export { labelsEnsure } from "./handlers/labels-ensure.ts";
export type {
  LabelsEnsureResult,
  LabelChange,
} from "./handlers/labels-ensure.ts";
export { labelsEnsureInput, OUTPUT_VERSION } from "./schema.ts";
export type { LabelsEnsureInput } from "./schema.ts";
export { canonicalLabels } from "./labels.ts";
export type { CanonicalLabel, LabelSet } from "./labels.ts";
export { emitYaml, canonicalize } from "./yaml.ts";
export type { Json } from "./yaml.ts";
export { GhAdapter } from "./adapter.ts";
export type { Adapter, GhLabel } from "./adapter.ts";
