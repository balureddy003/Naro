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

export interface TreeSearchOptions {
  readonly tools?: readonly ToolSpec[];
  readonly instructions?: string;
  /** Candidates per decision. Default 3. */
  readonly branchingFactor?: number;
  /** Scores candidates; default asks the model to score 0-1. */
  readonly scorer?: CandidateScorer;
}

export class TreeSearchReasoner implements Reasoner {
  readonly strategy = 'tree-search';
  private readonly model: Model;
  private readonly opts: Required<Pick<TreeSearchOptions, 'branchingFactor'>> & TreeSearchOptions;

  constructor(model: Model, opts: TreeSearchOptions = {}) {
    this.model = model;
    this.opts = { branchingFactor: 3, ...opts };
  }

  async decide(ctx: ReasoningContext): Promise<Decision> {
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
    if (candidates.length === 0) {
      return { kind: 'fail', reason: 'tree-search: model produced no parseable candidates' };
    }

    const scorer = this.opts.scorer ?? ((c: Candidate, c2: ReasoningContext) => this.modelScore(c, c2));
    const scored = await Promise.all(candidates.map(async (c) => ({ c, s: await scorer(c, ctx) })));
    scored.sort((a, b) => b.s - a.s);
    const best = scored[0]!.c;

    if (best.kind === 'complete') return { kind: 'complete', result: best.result };
    return {
      kind: 'act',
      action: {
        capability: 'tool.invoke',
        target: `tool://${best.tool}`,
        input: best.input,
      },
    };
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
