# 6. Test

## Goal

Prove that the agent produces correct outcomes and that regressions will be caught.

## Activities

- Write named cases that encode business outcomes
- Run them through the real runtime
- Store baselines
- Add the suite to CI
- Verify evidence records and journal integrity

## Key artifact

Baseline suite + green `naro bench --baseline` (or equivalent) in CI.

## Exit gate

Critical paths are covered and the pipeline fails on outcome regression.

## Naro / guide link

- [Test and regression gates](../03-production-gaps/test-and-regression-gates.md)
- [Evaluation](../../learn/10-evaluation.md)
- `naro bench --baseline`
