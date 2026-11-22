# Production Gaps

Most agentic AI projects fail between demo and production for operational, governance, and verification reasons rather than model capability. Industry analyses (including Gartner predictions that a large fraction of agentic projects will be canceled) consistently highlight the same gaps.

This section maps those gaps to concrete mechanisms in Naro and lists what remains application- or organization-owned.

## Gap index

| Gap | Page | Naro mechanisms |
|-----|------|-----------------|
| Capability–Deployment Verification Gap | [verification-gap.md](verification-gap.md) | Verification state, evidence record, hash-chained journal, `naro verify` |
| Governance, risk controls, and autonomy levels | [governance-and-autonomy.md](governance-and-autonomy.md) | Required policy gate, human approval, provenance, autonomy as policy |
| No test / regression gate | (planned) | `naro bench --baseline`, contract tests |
| Loose / unstructured output | (planned) | Schema, predicate, and composite verifiers |
| Dirty data and legacy integration | (planned) | Environment contracts, provenance, domain profiles |
| Unclear ownership and operating discipline | (planned) | Journal as accountability artifact |
| Unclear business value and cost | (planned) | Budgets, evaluation metrics |

## How to read these pages

Each page follows the same structure:

1. The gap (why projects fail)
2. What “closed” looks like
3. How Naro addresses it today
4. What is still application- or organization-owned
5. Checklist

Start with the two pages that match Naro’s strongest differentiators: verification and governance/autonomy.
