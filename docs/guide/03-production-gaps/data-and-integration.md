# Dirty Data & Legacy Integration

## The gap

Agents are pointed at unclean, incomplete, or poorly contracted enterprise data and legacy systems. Failures are blamed on the model when the root cause is data quality or missing contracts.

## What “closed” looks like

- Environment contracts declare what the agent may see and do.
- Provenance is tracked so untrusted content cannot drive side effects.
- Data quality gates exist before the agent loop.

## How Naro addresses it

- Domain profiles and environment ports.
- `Observation.trust` and provenance-aware policy (`denyExternalTriggered`).
- Path jails, destination allowlists, read-only SQL, declared runbooks.

## What remains application-owned

- Cleaning and contracting the actual data sources.
- Building or configuring the environment adapters for legacy systems.
- Defining data-quality checks that run before a run starts.

## Checklist

- [ ] Every external system the agent touches has an explicit environment contract.
- [ ] Provenance / external-content rules are enabled.
- [ ] Data quality gates exist for critical inputs.
