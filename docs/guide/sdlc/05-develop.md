# 5. Develop

## Goal

Implement the agent against the design contracts, with the core gates present from the first commit.

## Activities

- Scaffold the runner, policy, verifier, and journal
- Implement tools / environment adapters
- Wire provenance and budgets
- Keep the loop and gates intact (no shortcuts)

## Key artifact

Working agent that can be run locally, plus unit and contract tests.

## Exit gate

Core loop executes, policy cannot be bypassed, and at least one verifier is active.

## Naro / guide link

Start from the examples (`minimal-agent`, `governed-agent`, domain profiles) and the [Exercises](../exercises/).
