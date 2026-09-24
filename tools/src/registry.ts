import type { Tool } from './tool.ts';

/**
 * A source of tools — a local registry, an MCP server, a remote catalog.
 * The MCP adapter implements this interface; discovery stays async
 * because remote sources do I/O.
 */
export interface ToolSource {
  readonly id: string;
  discover(): Promise<readonly Tool[]> | readonly Tool[];
}

/**
 * A registry-level event — not a NaroEvent (the registry has no run/agent
 * context; it exists above any single run). Applications that want these
 * in a run's journal can forward them via `onEvent`.
 */
export interface RegistryEvent {
  readonly type: 'tool.definition.changed' | 'tool.collision.detected';
  readonly at: number;
  /** The contested tool name. */
  readonly tool: string;
  readonly data: Record<string, unknown>;
}

interface Slot {
  readonly tool: Tool;
  /** The ToolSource.id that provided this tool — undefined for hand-registered locals. */
  readonly sourceId?: string;
}

/**
 * The catalog of tools an agent may use.
 * Resolution is by name — names are stable identifiers, so
 * `tool://calculator` in an action survives replays and audits.
 *
 * ADR 0016: a source-provided tool whose `definitionHash` changes between
 * refreshes is a possible rug pull — the new definition is registered but
 * forced to `sideEffects: 'destructive'` (re-approval under baseline
 * policy) until `acknowledgeDefinition(name)` restores it.
 *
 * ADR 0020: two sources claiming the same name is a collision, never a
 * silent overwrite — the first-registered source stays active, the
 * shadow is held pending `resolve(name, sourceId)`, and the attempt is
 * recorded in `events`.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Slot>();
  private readonly sources: ToolSource[] = [];
  /** name → shadowed defs awaiting resolve() — keyed by tool name. */
  private readonly shadows = new Map<string, { tool: Tool; sourceId: string }[]>();
  /** `${sourceId}${name}` → original def awaiting acknowledgeDefinition(),
   *  with the hash pair that flagged it — what an admin reviews before acking. */
  private readonly changedDefs = new Map<string, { tool: Tool; sourceId: string; previous: string; current: string }>();
  /** `${sourceId}${name}` → last-seen definitionHash (ADR 0016). */
  private readonly seenHashes = new Map<string, string>();
  /** Registry-level events, in order — inspect or forward to a journal. */
  readonly events: RegistryEvent[] = [];
  private readonly onEvent?: (e: RegistryEvent) => void;

  constructor(opts: { onEvent?: (e: RegistryEvent) => void } = {}) {
    this.onEvent = opts.onEvent;
  }

  private emit(e: RegistryEvent): void {
    this.events.push(e);
    this.onEvent?.(e);
  }

  /**
   * Register a tool. `sourceId` is required for source-discovered tools —
   * `refresh()` passes `source.id` automatically. Calls without one are
   * hand-registered locals and keep the original unconditional behavior.
   */
  register(tool: Tool, sourceId?: string): this {
    const existing = this.tools.get(tool.name);

    // Local registration — no source, no ambiguity about who defined it.
    if (sourceId === undefined) {
      this.tools.set(tool.name, { tool });
      return this;
    }

    // ADR 0020: a different source claiming an occupied name shadows nothing
    // — first-registered stays active; the attempt is evidence.
    if (existing !== undefined && existing.sourceId !== sourceId) {
      const shadows = (this.shadows.get(tool.name) ?? []).filter((s) => s.sourceId !== sourceId);
      shadows.push({ tool, sourceId });
      this.shadows.set(tool.name, shadows);
      this.emit({
        type: 'tool.collision.detected', at: Date.now(), tool: tool.name,
        data: {
          heldBy: existing.sourceId ?? 'local',
          claimedBy: sourceId,
          ...(existing.tool.definitionHash !== undefined && { heldHash: existing.tool.definitionHash }),
          ...(tool.definitionHash !== undefined && { claimedHash: tool.definitionHash }),
        },
      });
      return this;
    }

    // ADR 0016: same source, changed definition — a rug pull, not a collision.
    const key = `${sourceId}::${tool.name}`;
    if (tool.definitionHash !== undefined) {
      const seen = this.seenHashes.get(key);
      this.seenHashes.set(key, tool.definitionHash);
      if (seen !== undefined && seen !== tool.definitionHash) {
        this.emit({
          type: 'tool.definition.changed', at: Date.now(), tool: tool.name,
          data: { source: sourceId, previous: seen, current: tool.definitionHash },
        });
        this.changedDefs.set(key, { tool, sourceId, previous: seen, current: tool.definitionHash });
        // Forced destructive until acknowledged: baseline policy re-approval
        // is the operator's signal that the contract they reviewed changed.
        this.tools.set(tool.name, {
          sourceId,
          tool: { ...tool, sideEffects: 'destructive', metadata: { ...tool.metadata, definitionChanged: true } },
        });
        return this;
      }
    }

    this.tools.set(tool.name, { tool, sourceId });
    return this;
  }

  /**
   * Operator acknowledgement of a definition change (ADR 0016): restores
   * the tool's declared sideEffects after the new definition is reviewed.
   * Returns false when nothing was pending.
   */
  acknowledgeDefinition(name: string, sourceId?: string): boolean {
    for (const [key, entry] of this.changedDefs) {
      if (entry.tool.name === name && (sourceId === undefined || entry.sourceId === sourceId)) {
        this.tools.set(name, { tool: entry.tool, sourceId: entry.sourceId });
        this.changedDefs.delete(key);
        return true;
      }
    }
    return false;
  }

  /**
   * Resolve a name collision in favor of a shadowed source (ADR 0020):
   * promotes that source's definition to active. Returns false when the
   * named source holds no shadow for `name`.
   */
  resolve(name: string, sourceId: string): boolean {
    const shadows = this.shadows.get(name);
    const idx = shadows?.findIndex((s) => s.sourceId === sourceId) ?? -1;
    if (shadows === undefined || idx < 0) return false;
    const [chosen] = shadows.splice(idx, 1);
    if (shadows.length === 0) this.shadows.delete(name);
    this.tools.set(name, { tool: chosen!.tool, sourceId });
    if (chosen!.tool.definitionHash !== undefined) {
      this.seenHashes.set(`${sourceId}::${name}`, chosen!.tool.definitionHash);
    }
    return true;
  }

  /** Definitions changed since their source's last review (ADR 0016) —
   *  pending acknowledgeDefinition(). The pair {previous, current} is the
   *  evidence an admin diff-reviews before acking. */
  changedDefinitions(): readonly { name: string; sourceId: string; previous: string; current: string }[] {
    return [...this.changedDefs.values()].map((e) => ({
      name: e.tool.name, sourceId: e.sourceId, previous: e.previous, current: e.current,
    }));
  }

  /** Names with unresolved shadowing claims — for operator inspection. */
  collisions(): readonly { name: string; heldBy?: string; claimedBy: string }[] {
    const out: { name: string; heldBy?: string; claimedBy: string }[] = [];
    for (const [name, shadows] of this.shadows) {
      for (const s of shadows) {
        out.push({ name, heldBy: this.tools.get(name)?.sourceId, claimedBy: s.sourceId });
      }
    }
    return out;
  }

  /** Track a source; call `refresh()` to (re)discover its tools. */
  addSource(source: ToolSource): this {
    this.sources.push(source);
    return this;
  }

  async refresh(): Promise<void> {
    for (const source of this.sources) {
      for (const tool of await source.discover()) this.register(tool, source.id);
    }
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)?.tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): readonly Tool[] {
    return [...this.tools.values()].map((s) => s.tool);
  }
}
