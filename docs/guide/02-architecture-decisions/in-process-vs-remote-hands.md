# In-process vs Remote Hands

## Options

| Style | Isolation | Operational cost | When to use |
|-------|-----------|------------------|-------------|
| In-process | Lowest | Lowest | Trusted code, single host, low risk |
| Worker-thread sandbox | Medium | Low | Untrusted but not hostile code |
| Remote / HTTP hands | High | Higher | Hostile code, multi-host, strong isolation |
| Container / OS sandbox | Highest | Highest | Multi-tenant or fully untrusted workloads |

## Recommendation

- Default to in-process or worker-thread for internal trusted agents.
- Move hands to a remote process or container as soon as the agent can execute untrusted or user-supplied code.
- Never rely on worker-thread isolation alone for hostile workloads.

## Naro realization

- Environment port allows any implementation.
- `SandboxedExecutor` provides worker-thread isolation (not an OS sandbox).
- `serveEnvironment` / `HttpEnvironment` support remote hands.
- Explicit guidance in production readiness: run hostile code behind an external executor.

See also: production readiness and architecture deployment sections.
