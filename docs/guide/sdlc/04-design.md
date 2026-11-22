# 4. Design

## Goal

Specify the contracts, policy rules, verification strategy, and evidence shape so implementation is unambiguous.

## Activities

- Define tool schemas and risk classification
- Write policy rules (deny / require_approval / allow-with-limits)
- Choose verifiers (schema, predicate, human, composite)
- Define the evidence record and journal retention
- Specify data contracts and provenance rules

## Key artifact

**Design spec** containing:

- Tool / environment contracts
- Policy rules
- Verification strategy
- Evidence and audit requirements
- Error and replanning behavior

## Exit gate

Contracts and gates are reviewable by someone who did not write them.

## Naro / guide link

- [Verification strategies](../01-patterns/verification-strategies.md)
- [Tool design and MCP](../01-patterns/tool-design-and-mcp.md)
- [Output contracts](../03-production-gaps/output-contracts.md)
- [Data and integration](../03-production-gaps/data-and-integration.md)
