# Unclear Ownership & Operating Discipline

## The gap

No named owner for the agent, its policy, its data, or its failures. When something goes wrong there is no runbook and no accountable person.

## What “closed” looks like

- Named owner for agent, policy, and data.
- Journal and evidence records are the accountability artifacts.
- Runbooks exist for denial, verification failure, and rollback.

## How Naro addresses it

- Hash-chained journal records every policy verdict, action, observation, and verifier result.
- Approver identity can be journaled.
- `naro verify` and evidence records give operators a concrete artifact.

## What remains organization-owned

- Assigning the actual humans.
- Writing the runbooks.
- Integrating journal export into existing ticketing or compliance systems.

## Checklist

- [ ] Named owner for the agent and its policy.
- [ ] Runbook covers denial, verification failure, and emergency stop.
- [ ] Journal retention and access are defined.
