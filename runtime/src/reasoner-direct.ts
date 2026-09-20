import type { Decision, Reasoner, ReasoningContext } from '@naro/core';

/**
 * The simplest possible reasoner: a function that maps context → decision.
 *
 * `Direct` is honest about what it is — there is no hidden strategy, no
 * prompt template. It's the baseline every other strategy is compared
 * against, and the reasoner tests and examples use to exercise the loop.
 */
export class DirectReasoner implements Reasoner {
  readonly strategy = 'direct';

  private readonly fn: (ctx: ReasoningContext) => Decision | Promise<Decision>;

  constructor(fn: (ctx: ReasoningContext) => Decision | Promise<Decision>) {
    this.fn = fn;
  }

  decide(ctx: ReasoningContext): Promise<Decision> | Decision {
    return this.fn(ctx);
  }
}
