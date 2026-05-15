/**
 * Deterministic YAML emitter.
 *
 * ADR 0003 / ADR 0006 require yard to be the *only* writer of config/registry
 * YAML and to produce byte-stable output: same input -> same bytes, regardless
 * of insertion order, so diffs and merges stay clean.
 *
 * Strategy: recursively rebuild the value with object keys sorted
 * lexicographically (arrays keep their order — order is data there), then hand
 * the canonical structure to the `yaml` library with fixed formatting options.
 */
import { stringify } from "yaml";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

/** Recursively sort object keys; arrays and scalars pass through unchanged. */
export function canonicalize(value: Json): Json {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize(value[key] as Json);
    }
    return out;
  }
  return value;
}

/**
 * Emit deterministic YAML for an arbitrary JSON-shaped value.
 *
 * Stable across runs and across input key order. The trailing newline is
 * guaranteed so the output is a well-formed text file / appendable stream.
 */
export function emitYaml(value: Json): string {
  const text = stringify(canonicalize(value), {
    // Fixed formatting → identical bytes for identical (canonicalized) input.
    indent: 2,
    lineWidth: 0, // never auto-wrap; wrapping is input-dependent and unstable
    sortMapEntries: true, // belt-and-suspenders with canonicalize()
    nullStr: "null",
  });
  return text.endsWith("\n") ? text : text + "\n";
}
