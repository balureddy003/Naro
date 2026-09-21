import type { Decision, Reasoner, ReasoningContext } from '@naro/core';
import { chat, type Model, type ToolSpec } from '@naro/model';
import { buildMessages } from './transcript.ts';

/**
 * Tree-of-thoughts, honestly scoped.
 *
 * Without a simulatable world model you cannot roll out future states —
 * so this reasoner does the part that IS honest: expand K candidate next
 * steps, score each, act on the best. One-ply lookahead, not simulated
 * search. Where a domain provides a `simulate(action) → outcome` port,
 * real multi-ply search can replace the scorer without touching the
 * runtime.
 *
 * Multi-ply: with `depth` and a `simulator` (the domain's world model),
 * candidate values back up over lookahead — a modest move that unlocks
 * a strong continuation wins. Cost is K^depth model calls, so keep
 * depth at 2-3; without a simulator it stays honest one-ply ranking.
 *
 * Cost note: this is the expensive pattern. K candidates × scoring =
 * more model calls per step — justified only when the task rewards
 * deliberation over speed.
 */

export interface Candidate {
  /** 'act' proposes a tool call; 'complete' proposes a final answer. */
  readonly kind: 'act' | 'complete';
  readonly tool?: string;
  readonly input?: unknown;
  readonly result?: unknown;
  readonly rationale?: string;
}

export type CandidateScorer = (candidate: Candidate, ctx: ReasoningContext) => Promise<number> | number;

/**
 * A world model: predicts an action's outcome WITHOUT executing it.
 * Domains with exact simulators (grid robots, game rules, dry-run
 * pipelines) get true multi-ply search; domains without one get the
 * honest one-ply fallback. The simulator's prediction is marked
 * untrusted — it shapes WHICH action to take, never IS the evidence.
 */
export type Simulator = (
  candidate: Candidate,
  ctx: ReasoningContext,
) => Promise<{ output: unknown }> | { output: unknown };

export interface TreeSearchOptions {
  readonly tools?: readonly ToolSpec[];
  readonly instructions?: string;
  /** Candidates per decision. Default 3. */
  readonly branchingFactor?: number;
  /** Scores candidates; default asks the model to score 0-1. */
  readonly scorer?: CandidateScorer;
  /**
   * Lookahead plies. Default 1 (expand + score only). >1 requires a
   * `simulator`; each level multiplies model calls by branchingFactor,
   * so keep depth small (2-3).
   */
  readonly depth?: number;
  readonly simulator?: Simulator;
}

export class TreeSearchReasoner implements Reasoner {
  readonly strategy = 'tree-search';
  private readonly model: Model;
  private readonly opts: Required<Pick<TreeSearchOptions, 'branchingFactor' | 'depth'>> & TreeSearchOptions;

  constructor(model: Model, opts: TreeSearchOptions = {}) {
    this.model = model;
    this.opts = { branchingFactor: 3, depth: 1, ...opts };
    if (this.opts.depth > 1 && !this.opts.simulator) {
      throw new Error('TreeSearchReasoner: depth>1 requires a simulator — a domain world model that predicts action outcomes');
    }
  }

  async decide(ctx: ReasoningContext): Promise<Decision> {
    const best = await this.expand(ctx, this.opts.depth);
    if (!best) {
      return { kind: 'fail', reason: 'tree-search: model produced no parseable candidates' };
    }
    if (best.candidate.kind === 'complete') return { kind: 'complete', result: best.candidate.result };
    return {
      kind: 'act',
      action: {
        capability: 'tool.invoke',
        target: `tool://${best.candidate.tool}`,
        input: best.candidate.input,
      },
    };
  }

  /**
   * Expand K candidates and return the best by backed-up value:
   * a candidate's value is max(own score, best continuation value) —
   * a modest first move that unlocks a strong follow-up wins.
   */
  private async expand(ctx: ReasoningContext, depth: number): Promise<{ candidate: Candidate; value: number } | undefined> {
    const k = this.opts.branchingFactor;
    const toolNames = this.opts.tools?.map((t) => t.name) ?? [];
    const res = await chat(this.model, {
      messages: [
        ...buildMessages(ctx, { ...(this.opts.instructions !== undefined && { instructions: this.opts.instructions }) }),
        {
          role: 'user',
          content: [
            `Propose exactly ${k} DISTINCT candidate next steps as a JSON array.`,
            `Each element: {"kind":"act","tool":"<name>","input":{...},"rationale":"..."}`,
            `            or {"kind":"complete","result":...,"rationale":"..."}`,
            `Available tools: ${toolNames.join(', ') || 'none'}.`,
            `Reply with ONLY the JSON array.`,
          ].join('\n'),
        },
      ],
      temperature: 0.7, // diversity is the point of expansion
      responseFormat: 'json',
    });

    const candidates = this.parseCandidates(res.message.content);
    if (candidates.length === 0) return undefined;

    const scorer = this.opts.scorer ?? ((c: Candidate, c2: ReasoningContext) => this.modelScore(c, c2));
    const sim = this.opts.simulator;
    const scored = await Promise.all(candidates.map(async (c) => {
      let value = await scorer(c, ctx);
      if (depth > 1 && sim && c.kind === 'act') {
        const predicted = await sim(c, ctx);
        const childCtx: ReasoningContext = {
          ...ctx,
          observations: [...ctx.observations, {
            id: 'sim', at: Date.now(), actionId: 'sim',
            source: 'sim://world-model', kind: 'tool-result',
            success: true, output: predicted.output, trust: 'tool',
          }],
        };
        const child = await this.expand(childCtx, depth - 1);
        if (child) value = Math.max(value, child.value);
      }
      return { candidate: c, value };
    }));
    scored.sort((a, b) => b.value - a.value);
    return scored[0];
  }

  private parseCandidates(content: unknown): Candidate[] {
    try {
      const text = String(content).replace(/^```(?:json)?|```$/gm, '').trim();
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((c): c is Candidate =>
        typeof c === 'object' && c !== null && ((c as Candidate).kind === 'act' || (c as Candidate).kind === 'complete'));
    } catch {
      return [];
    }
  }

  private async modelScore(c: Candidate, ctx: ReasoningContext): Promise<number> {
    const res = await chat(this.model, {
      messages: [
        ...buildMessages(ctx),
        { role: 'user', content: `Score this candidate next step 0.0-1.0 for reaching the goal. Reply with only the number.\n${JSON.stringify(c)}` },
      ],
      temperature: 0,
    });
    const n = Number.parseFloat(String(res.message.content).trim());
    return Number.isNaN(n) ? 0 : Math.min(1, Math.max(0, n));
  }
}
