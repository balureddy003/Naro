# No Test / Regression Gate

## The gap

Agents are shipped without automated checks that the real runtime still produces correct outcomes after code or model changes. Regressions are discovered in production.

## What “closed” looks like

- Named cases run through the real agent loop (not mocks).
- Baselines are stored and CI fails when outcomes regress or cases disappear.
- Contract tests protect replaceable ports.

## How Naro addresses it

- `BenchmarkRunner` executes cases on the real `AgentRunner`.
- `naro bench --baseline` exits non-zero on regression.
- Contract tests exist for every replaceable port.

## What remains application-owned

- Writing the actual cases that encode your business outcomes.
- Wiring the command into your CI.
- Maintaining baselines as requirements evolve.

## Checklist

- [ ] At least one baseline suite covers critical paths.
- [ ] CI runs `naro bench --baseline` (or equivalent) on every change that touches the agent.
- [ ] Contract tests pass for any custom adapters.
