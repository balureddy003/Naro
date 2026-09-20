# @naro/verification

Concrete `Verifier` implementations — "the model said it's done" becomes "here is the evidence."

## Verifiers

| Verifier | Evidence | Use for |
|---|---|---|
| `SchemaVerifier` | output validates against JSON Schema | structured results, API contracts |
| `PredicateVerifier` | a domain function returns ok/reason | state checks, numeric bounds, anything expressible in code |
| `CommandVerifier` | shell command exits 0 | "run the tests", linters, health checks |
| `HumanVerifier` | a person accepts the claim | irreversible or subjective outcomes |
| `LlmJudgeVerifier` | a model scores against a rubric | open-ended quality; calibrate, never sole-gate safety |
| `allOf` / `anyOf` | composition | layered evidence requirements |

## Design

Each verifier is deliberately small — real checks are compositions. `allOf(schema, tests, human)` says: the result must be well-formed *and* verified by tests *and* approved by a person.

`LlmJudgeVerifier` exists because some outcomes have no schema — but treat it as a noisy signal: it's another model, with the same failure modes you're verifying against.

## Invariants

- A verifier that can't see the evidence returns `ok: false` — absence of evidence is failure, not ambiguity.
- `reason` is mandatory on failure — "verification failed" with no why is a debugging dead end.
- CommandVerifier timeouts default to 30s; verification that hangs forever is worse than none.
