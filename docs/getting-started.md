# Build Your First Safe Agent

In this tutorial you will build a complete offline agent that asks a calculator
tool for `40 + 2`, verifies the evidence, and completes with `42`.

You will see the entire control path:

```text
Goal → Reasoner → Policy → Tool → Observation → Verifier → Complete
```

No API key or network connection is required.

## Prerequisites

- Node.js 24 or newer;
- a checkout of this repository;
- dependencies installed with `npm install`;
- `npm run build` completed successfully.

Run all commands from the repository root.

## 1. Create the tutorial file

Create `first-agent.ts` in the repository root:

```ts
import {
  createAgentSpec,
  createGoal,
  type Verifier,
} from '@naro/core';
import {
  AgentRunner,
  CompositeExecutor,
  DirectReasoner,
} from '@naro/runtime';
import {
  createToolPolicy,
  ToolExecutor,
  ToolRegistry,
  type Tool,
} from '@naro/tools';
```

The imports already reveal the architecture:

- `core` defines the vocabulary;
- `runtime` owns execution;
- `tools` owns tool contracts and the baseline tool policy.

## 2. Define the goal

```ts
const goal = createGoal({
  description: 'Calculate 40 + 2.',
  successCriteria: ['the final result equals 42'],
});
```

A goal says what success means. It does not grant permissions or tell the
runtime which tool to execute.

## 3. Define a schema-contracted tool

```ts
const calculator: Tool = {
  name: 'calculator',
  description: 'Add two numbers',
  inputSchema: {
    type: 'object',
    properties: {
      a: { type: 'number' },
      b: { type: 'number' },
    },
    required: ['a', 'b'],
    additionalProperties: false,
  },
  outputSchema: { type: 'number' },
  permissions: [],
  sideEffects: 'none',
  execute: async (input) => {
    const { a, b } = input as { a: number; b: number };
    return a + b;
  },
};

const registry = new ToolRegistry().register(calculator);
```

The input is validated before execution. The output is validated before it
becomes evidence. `sideEffects: 'none'` tells policy this tool does not change
the external world.

## 4. Add a deterministic reasoner

```ts
const reasoner = new DirectReasoner((ctx) => {
  const result = ctx.observations.find((item) => item.kind === 'tool-result');

  if (!result) {
    return {
      kind: 'act',
      action: {
        capability: 'tool.invoke',
        target: 'tool://calculator',
        input: { a: 40, b: 2 },
      },
    };
  }

  return { kind: 'complete', result: result.output };
});
```

The reasoner proposes a decision. It does not call the tool directly. That
separation is what gives the runtime a place to validate, authorize, observe,
and recover.

## 5. Verify evidence

```ts
const verifier: Verifier = {
  id: 'answer-is-42',
  verify: ({ observation, result }) => {
    const value = result ?? observation?.output;
    return Promise.resolve(
      value === 42
        ? { ok: true, evidence: value }
        : { ok: false, reason: `expected 42, got ${JSON.stringify(value)}` },
    );
  },
};
```

The reasoner may claim completion. The verifier decides whether the claim is
supported.

## 6. Compose the runtime

```ts
const executor = new CompositeExecutor({
  'tool://': new ToolExecutor(registry),
});

const runner = new AgentRunner({
  spec: createAgentSpec({ name: 'first-agent', goal }),
  reasoner,
  executor,
  policy: createToolPolicy(registry),
  verifier,
  maxIterations: 8,
  actionTimeoutMs: 5_000,
});
```

Policy is required. `createToolPolicy(registry)`:

- denies unknown `tool://` names;
- checks required grants;
- requires approval for destructive tools;
- allows this registered, permission-free, side-effect-free calculator.

## 7. Watch the run

```ts
const running = runner.run();

for await (const event of runner.events()) {
  console.log(`${String(event.seq).padStart(2)} ${event.type}`);
}

const result = await running;
console.log(`status=${result.status} result=${JSON.stringify(result.result)}`);
```

Run it:

```bash
node first-agent.ts
```

The exact event count may grow as the runtime gains instrumentation, but the
important ordering remains:

```text
reasoning.completed
  → action.requested
  → permission.requested
  → action.permitted
  → action.started
  → action.completed
  → observation.created
  → verification.completed
  → agent.completed

status=completed result=42
```

## 8. Make it fail on purpose

Change the action input to omit `b`:

```ts
input: { a: 40 }
```

Run the file again. Schema validation prevents execution and returns a failed
observation. The reasoner will keep trying until `maxIterations` stops it.

You have now seen three production-relevant behaviors:

1. invalid input does not partially execute;
2. failure becomes evidence the reasoner can inspect;
3. the loop has a hard bound.

Restore `b: 2` before continuing.

## What you built

- a goal with explicit success criteria;
- a schema-contracted capability;
- a reasoner that only proposes decisions;
- a required policy gate;
- a routed executor;
- evidence-based verification;
- a live, ordered event stream;
- iteration and action-time limits.

## Next steps

- Run the larger [minimal agent](../examples/minimal-agent/README.md) to add
  context, environment actions, and checkpoints.
- Run the [ReAct agent](../examples/react-agent/README.md) to let a model choose
  the tool.
- Read [Agent loops and state machines](learn/08-agent-loops.md) to understand
  the states you observed.
- Read the [`@naro/runtime` reference](../runtime/README.md) for checkpoints,
  leases, batches, and recovery.
- Review [Production readiness](production-readiness.md) before connecting an
  agent to a real system.
