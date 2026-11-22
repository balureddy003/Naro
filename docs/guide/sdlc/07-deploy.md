# 7. Deploy

## Goal

Run the agent in production with ownership, auditability, monitoring, and a rollback path.

## Activities

- Assign owners (agent, policy, data)
- Configure journal export, retention, and access
- Set budgets and alerts
- Write runbooks (denial, verification failure, emergency stop)
- Enable sealing / key custody if required
- Complete the production-readiness checklist

## Key artifact

Runbook + retained, verifiable journals + named owners.

## Exit gate

Production readiness checklist is complete and the first production runs produce verifiable evidence.

## Naro / guide link

- [Production readiness](../../production-readiness.md)
- [Ownership and ops](../03-production-gaps/ownership-and-ops.md)
- [High-stakes architecture](../04-reference-architectures/high-stakes-regulated.md)
- [EU AI Act mapping](../compliance/eu-ai-act-article-12.md)
