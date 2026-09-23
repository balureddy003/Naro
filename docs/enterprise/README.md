# Naro for Regulated and Infrastructure Buyers — Trust and Identity

*Explanation.* What this directory is, and how it differs from
[docs/product/](../product/README.md).

## Relationship to the kernel and to docs/product/

[docs/product/](../product/README.md) is explicit about its buyer: "a
small business that cannot self-host... cannot afford a surprise token
bill." This directory is for the *other* buyer
[docs/positioning.md](../positioning.md) names — "regulated workloads,
infrastructure operators, and anyone putting an agent in front of a
database, a cluster, or a machine." Nothing here redefines the kernel
either; where a document needs new kernel surface, it says so explicitly
and points to an [ADR](../adr/README.md).

The two directories will diverge in what they ask for: an SMB buyer wants
cost predictability and zero-configuration templates; this buyer wants
proof — that an action was authorized under a specific identity, that a
tool's contract didn't change silently underneath an approval, that a log
is tamper-evident and survives an auditor's retention question. Naro's
existing differentiators (verification as a runtime state, the hash-chain,
governance beneath a foreign harness) already aim at this buyer; the
documents here extend that aim to gaps found by reading the code, not by
assumption.

## Documents

| Doc | Depends on | Status |
|---|---|---|
| [PRD-001 — MCP Trust and Delegated Identity](prd-001-mcp-trust-and-delegated-identity.md) | [ADR 0015](../adr/0015-mcp-server-calls-route-through-the-harness-gate.md), [ADR 0016](../adr/0016-tool-definitions-are-provenance-pinned.md), [ADR 0017](../adr/0017-delegated-principal-is-a-policy-input.md) | proposed |

See also: [EU AI Act Article 12 mapping](../compliance/eu-ai-act-article-12.md)
and [ADR 0018](../adr/0018-attested-retention-pruning.md) — compliance
documents for this same buyer, filed under `docs/compliance/` rather than
here because they map to a specific regulation rather than proposing new
product work.
