# @naro/policy

Policy-as-data authorization and governance — the answer to "who may do what, under what conditions."

## What it provides

- **`Policy` / `PolicyEngine`** — declarative rules evaluated in order
- **`Rule`** — `{ id, match, outcome }` where `match` can select on tool name pattern, required permission, side-effect class, action capability, or resource
- **`RateLimiter`** — counts actions within a rolling window so `limit` outcomes can enforce quotas
- **`compose()`** — combines engines so org-wide and per-agent policies coexist

## The five outcomes

| Outcome | Runtime effect |
|---|---|
| `allow` | proceed |
| `deny` | observation records the refusal |
| `require-approval` | pause until a `HumanBridge` grants |
| `limit` | proceed, but a `RateLimiter` records consumption; exceeding → `deny` |
| `audit` | proceed **and** mark the observation `audited: true` for the audit trail |

`PatternAuthorizer` (`@naro/tools`) is a `Policy` adapter — grant patterns become `allow`/`require-approval` rules, so existing callers upgrade transparently.

## Invariants

- Rules are **data** — serializable, reviewable, diffable. An OPA adapter implements the same `Policy` interface.
- Denial is never silent: it flows back through the observation as a visible error.
- Side-effect classes (`read` < `write` < `destructive`) are comparable — a rule matching `write` doesn't accidentally match `read`-only tools unless written to.

## Example

```ts
const policy = new PolicyEngine([
  { id: 'pii-audit',    match: { resource: 'data://*pii*' },  outcome: 'audit' },
  { id: 'shell-gate',   match: { sideEffects: 'destructive' }, outcome: 'require-approval' },
  { id: 'net-deny',     match: { capability: 'network.*' },   outcome: 'deny' },
  { id: 'default',      match: {},                            outcome: 'allow' },
]);
executor.setPolicy(policy);
```
