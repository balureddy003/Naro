# @naro/templates

Pre-built, pre-verified outcome bundles — PRD-002's answer to "a small
business can't assemble a kernel." Each template packages the composition
`docs/use-cases.md` asks every Naro application to define:

> goal shape + tool set + policy + verifier + budget + tier config

The template supplies all of that *except the models* — the caller owns
the reasoner tiers, so the same template runs on a laptop or a fleet.

## Usage

```ts
import { AgentRunner } from '@naro/runtime';
import { transactionCategorizer } from '@naro/templates';
import { ollamaCheapTier } from '@naro/adapter-openai';

const cheap = ollamaCheapTier({ model: 'qwen2.5:3b', capabilities: verified.capabilities });

const runner = new AgentRunner(transactionCategorizer.build(
  {
    transaction: { description: 'UBER *TRIP 8832', amount: 24.50 },
    categories: ['Meals & Entertainment', 'Office Supplies', 'Travel'],
    history: [{ description: 'UBER *TRIP 1021', category: 'Travel' }],
  },
  { cheap: cheap.model, strong: frontierModel /* optional escalation */ },
));
const result = await runner.run();   // → { status: 'completed', result: 'Travel' }
```

Every run produces the kernel's evidence record (`buildEvidence`) — the
trust mechanism, not a nice-to-have.

## What a template guarantees

- **The verifier is the template.** A completion claim only completes if
  the verifier passes — a category outside the allowed set fails and
  triggers replanning/escalation, not a wrong-but-confident finish.
- **Least privilege by construction.** Template tools are read-only and
  gated on a template-scoped grant (`finance.categorize`); the composed
  policy denies every other target — a hallucinated `tool://` call can
  never execute.
- **Cost is declared before running.** `template.outcome` states the
  expected spend and success threshold; `build()` enforces the budget via
  `AgentDeps.budgets` (the run fails fast past the cap).
- **Escalation is built in.** Pass `strong` and verification failures
  (including low self-reported confidence below the floor) push the run
  up a tier via `EscalatingReasoner`.

## Templates

| id | version | outcome | verifier |
|---|---|---|---|
| `transaction-categorizer` | 0.1.0 | bank/card transaction → chart of accounts | category ∈ allowed set + confidence floor |

Templates version independently — improving one never forces re-testing
the others (PRD-002 req 4).
