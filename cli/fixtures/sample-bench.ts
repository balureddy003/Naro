import { createGoal, allowAllPolicy } from '@naro/core';
import { DirectReasoner } from '@naro/runtime';
import { InMemoryEnvironment } from '@naro/environment';
import type { EvalCase } from '@naro/evaluation';

const env = new InMemoryEnvironment('e');

export const cases: EvalCase[] = [{
  id: 'trivial',
  goal: createGoal({ description: 'finish' }),
  deps: {
    reasoner: new DirectReasoner(() => ({ kind: 'complete', result: 'ok' })),
    executor: env,
    policy: allowAllPolicy,
  },
  check: (r) => r.result === 'ok',
}];
