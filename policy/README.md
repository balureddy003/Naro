# @naro/policy

Composable policy rules for deciding who may perform an action and under which
conditions.

## Public API

`RulePolicyEngine` evaluates `PolicyRule` values in order. The first matching
rule wins. If no rule matches, the configured default decision is returned.

```ts
const policy = new RulePolicyEngine([
  requireGrants(),
  denyCapability('network.*'),
  requireApproval('tool://delete-*'),
  limitCalls('tool://search', 100, 60_000),
  auditCalls('data://*'),
], { default: 'deny' });
```

The included builders cover common cases:

- `denyCapability(pattern)` denies matching capabilities or targets;
- `requireApproval(pattern)` sends matching actions to a human bridge;
- `limitCalls(pattern, maxCalls, windowMs?)` enforces a call limit through the configured `LimitStore`;
- `auditCalls(pattern)` allows and records matching actions;
- `requireGrants()` denies actions whose requested permissions exceed the
  agent's grants.

## Policy outcomes

| Outcome | Runtime behavior |
|---|---|
| `allow` | execution continues |
| `deny` | the refusal becomes an observation |
| `require_approval` | execution waits for the configured human bridge |
| `limit` | the rule engine converts the outcome to allow or deny using its counter |
| `audit` | execution continues and the rule engine records an audit entry |

`auditLog()` exposes entries recorded by `audit` and `limit` rules.

## Boundaries to understand

Rules contain predicate functions, so they are code—not serializable policy
data. `InMemoryLimitStore` scopes quotas to one process.
`SqliteLimitStore` uses transactions to share counters across processes on one
host. Redis or Postgres can implement `LimitStore` for multi-host quotas.
OPA/Rego remains the adapter for centrally managed policy decisions.

The engine defaults to `allow` for convenience. Production configurations
should normally set `{ default: 'deny' }` and add explicit allow rules.
