# Cost Control

## Principles

1. Every run has a budget (tokens, cost, or both).
2. Budgets are enforced by the runtime, not only by the model prompt.
3. Cost is attributable to a run, an agent, or a user.
4. Cheaper models or cached results are used when quality allows.

## Tactics

| Tactic | Effect | Naro support |
|--------|--------|--------------|
| Hard token / cost budget | Stops runaway spend | Runner budgets |
| Model routing / failover | Uses cheaper model when possible | Provider failover composition |
| Prompt caching | Reduces repeated context cost | Cache breakpoints (provider-dependent) |
| Early verification failure | Avoids wasted continuation | Verification state forces replan or stop |
| Evaluation baselines | Detects quality regressions that would force expensive retries | `naro bench --baseline` |

## Recommendation

Set a budget on every production agent. Review cost versus measured outcome weekly. Prefer routing and caching over simply raising the budget.

## Anti-patterns

- No budget (cost discovered on the invoice).
- Budget only in the system prompt.
- No link between cost and business outcome.

See also: [Cost and value gap](../03-production-gaps/cost-and-value.md).
