# @naro/profile-devops

A DevOps agent's world: a **runbook registry, not a shell**.

The coding profile gives agents arbitrary shell — wrong for production ops.
Operators declare named tasks as argv templates; agents invoke by name with
regex-validated params. Undeclared commands cannot exist.

## Capabilities

| Capability | Does | Side effect |
|---|---|---|
| `runbook.list` | Task inventory | read |
| `runbook.run` | Spawn declared argv (no shell → no injection) | write |
| `probe.http` | GET allowlisted URL → `{status, ok, latencyMs}` | read |

```ts
const env = new DevOpsEnvironment({
  tasks: [{ name: 'deploy', description: 'ship svc', argv: ['deploy.sh', '{svc}', '{env}'],
           params: { svc: '^[a-z-]+$', env: '^(staging|prod)$' }, sideEffects: 'destructive' }],
  probeAllowlist: ['status.example.com'],
});
```

Params substitute into argv *tokens*, spawned without a shell — `; rm -rf /`
in a param is a failed regex, not an incident.
