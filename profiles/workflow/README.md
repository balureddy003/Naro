# @naro/profile-workflow

A workflow agent's world: **deterministic DAG execution** through a nested
`ActionExecutor`.

Agents are for steps that need judgment; workflows are for steps that must
be reliable. Each step is still a capability-checked action — the DAG just
decides the order.

## Capabilities

| Capability | Does |
|---|---|
| `workflow.validate` | Static checks: dup ids, unknown deps, cycles (read) |
| `workflow.run` | Topological execution, per-step retries, `$stepId.field` refs (write) |

```ts
const env = new WorkflowEnvironment({ executor: codingEnv });
// steps: [{id:'build', capability:'shell.exec', ...},
//         {id:'test', capability:'shell.exec', dependsOn:['build'], retries:2}]
```

Fail-fast semantics: a failed step halts the run with `{completed, failed}`,
and `"$stepId"` references substitute prior outputs into later inputs.
