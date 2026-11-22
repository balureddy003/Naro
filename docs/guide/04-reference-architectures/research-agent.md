# Research Agent with Provenance

A research agent that fetches external content and produces cited answers while preventing that content from driving unauthorized side effects.

## Capabilities

- Research profile (allowlisted fetch)
- Citation requirement (evidence must be fetched)
- Optional web search or document tools

## Controls

- Destination allowlist that revalidates redirects
- Provenance-aware policy (`denyExternalTriggered` or equivalent)
- Verifier that checks citations point to fetched observations

## Evidence

- Every fetch is an observation with trust level `external`
- Final answer is accepted only if citations resolve to those observations
- Full journal available for audit

## Production boundary

Suitable for internal knowledge and research assistants. For public-facing or high-stakes use, add human review on the final output and stricter destination controls.

See: `examples/research-agent`.
