# @naro/adapter-opa

OPA (Open Policy Agent) adapter — evaluate every action against Rego policy over HTTP. Policy authors write data; Naro stays engine-agnostic.

## Usage

```ts
const policy = new OpaPolicyEngine({
  url: process.env.OPA_URL ?? 'http://localhost:8181',
  decisionPath: 'naro/action/decision',   // Rego doc returning one of the five decisions
  onError: 'deny',                        // default — fail closed
});
```

Each `evaluate()` POSTs to `/v1/data/<decisionPath>`:

```json
{ "input": {
    "action": { "capability": "fs.write", "target": "env://ws/x", ... },
    "agent":  { "id": "a1", "grants": ["fs.read"] },
    "goal":   { "id": "g1", "description": "..." } } }
```

Your Rego returns `"allow" | "deny" | "require_approval" | "limit" | "audit"`.

The Rego document may return a bare decision string or an object:

```rego
decision := {"decision": "deny", "reason": "violates data-residency"} if { ... }
```

`reason` is optional and lands on the denial event and observation —
the *why* is evidence.

## Invariants

- **Fail-closed by default**: unreachable OPA, HTTP errors, or non-decision results → `deny`. `onError: 'allow'` exists but is a deliberate choice.
- 5s default timeout — a hung policy engine must not hang the agent.
- `fetchImpl` injectable — tests assert the exact input document offline.
