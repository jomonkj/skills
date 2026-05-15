/**
 * In-memory fake of the gh/git Adapter for zero-network, zero-token tests
 * (ADR 0003). Records every mutation so tests can assert idempotency.
 */
import type { Adapter, GhLabel } from "../src/adapter.ts";

export class FakeAdapter implements Adapter {
  labels: Map<string, GhLabel>;
  createCalls: { repo: string; label: GhLabel }[] = [];
  editCalls: { repo: string; label: GhLabel }[] = [];

  constructor(initial: GhLabel[] = []) {
    this.labels = new Map(initial.map((l) => [l.name, { ...l }]));
  }

  async listLabels(_repo: string): Promise<GhLabel[]> {
    return [...this.labels.values()].map((l) => ({ ...l }));
  }

  async createLabel(
    repo: string,
    label: { name: string; color: string; description: string },
  ): Promise<void> {
    this.createCalls.push({ repo, label: { ...label } });
    this.labels.set(label.name, { ...label });
  }

  async editLabel(
    repo: string,
    label: { name: string; color: string; description: string },
  ): Promise<void> {
    this.editCalls.push({ repo, label: { ...label } });
    this.labels.set(label.name, { ...label });
  }
}
