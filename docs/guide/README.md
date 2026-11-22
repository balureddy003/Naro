# AI System Engineering Guide

This guide teaches how to design and build production AI systems from the ground up. Naro is the reference implementation that makes the hard parts (authorization, verification, evidence, audit) structural rather than optional.

It serves two purposes:

1. **Engineering guide** — best patterns, architectures, and design decisions for agentic systems.
2. **Industry gap response** — concrete mechanisms that address the operational, governance, and verification failures that cause most agentic projects to stall or be canceled.

## How to use this guide

| Goal | Start here |
|------|------------|
| Learn patterns and trade-offs | [Foundations](00-foundations/) → [Patterns](01-patterns/) → [Architecture Decisions](02-architecture-decisions/) |
| Close a specific production gap | [Production Gaps](03-production-gaps/) |
| See complete reference architectures | [Reference Architectures](04-reference-architectures/) |
| Practice | [Exercises](exercises/) |
| Compliance mapping | [EU AI Act Article 12](compliance/eu-ai-act-article-12.md) |

The existing [learning course](../learn/) remains available and is linked from relevant guide pages. Expert-level detail lives in [Architecture](../architecture.md) and the [ADRs](../adr/).

## Core invariants this guide assumes

- The runtime owns control. The model proposes; it does not authorize or execute.
- Intent (`Action`) and evidence (`Observation`) stay separate.
- Verification is a state, not a hook. Completion is a claim until evidence is accepted.
- The journal is the source of truth for audit, resume, and evaluation.
- Domain safety lives below the model (jails, allowlists, contracts), not only in prompts.

These are enforced in Naro. The guide explains why they matter and how to apply the same thinking even outside this codebase.

## Current status — world-class foundation complete

- Foundations + diagrams (loop, evidence, autonomy)
- Patterns: verification, tools/MCP, context/memory/RAG, observability, cost control, multi-agent coordination
- Architecture Decisions: 6 frameworks
- Production Gaps: complete with checklists
- Reference Architectures: 4 (including high-stakes)
- EU AI Act Article 12 mapping
- Exercises: 3 levels with solution sketches

The guide is now a comprehensive, production-oriented AI system engineering reference. Further work is refinement, additional examples, and community feedback.
