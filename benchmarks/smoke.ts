import { createGoal, allowAllPolicy } from '@naro/core';
import { DirectReasoner } from '@naro/runtime';
import { InMemoryEnvironment } from '@naro/environment';
import type { EvalCase } from '@naro/evaluation';

/** CI smoke benchmark — deterministic, no model, no network. */
const env = new InMemoryEnvironment('e');

export const cases: EvalCase[] = [
  {
    id: 'completes',
    goal: createGoal({ description: 'finish' }),
    deps: {
      reasoner: new DirectReasoner(() => ({ kind: 'complete', result: 'ok' })),
      executor: env,
      policy: allowAllPolicy,
    },
    check: (r) => r.result === 'ok',
  },
  {
    id: 'acts-then-completes',
    goal: createGoal({ description: 'write then finish' }),
    deps: {
      reasoner: new DirectReasoner((ctx) =>
        ctx.observations.length
          ? { kind: 'complete', result: 'done' }
          : { kind: 'act', action: { capability: 'env.set', target: 'env://e/k', input: { value: 1 } } }),
      executor: env,
      policy: allowAllPolicy,
    },
    check: (r) => r.result === 'done',
  },
];
