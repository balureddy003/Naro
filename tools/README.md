# @naro/tools

Schema-contracted capabilities behind the runtime policy gate.

## Public surface

| Export | Role |
|---|---|
| `Tool` | metadata, schemas, permissions, side effects, and `execute()` |
| `ToolRegistry` | local catalog plus refreshable `ToolSource` values |
| `ToolSource` | asynchronous discovery port used by MCP and other catalogs |
| `JsonSchema`, `validate()` | built-in schema subset |
| `ToolExecutor` | resolve, validate input, execute, validate output, observe |
| `createToolPolicy()` | baseline policy derived from registered metadata |
| `SecretProvider` | resolves secret references at execution time |
| `EnvSecretProvider`, `FileSecretProvider`, `MapSecretProvider`, `chainSecrets()` | included secret sources and composition |
| `SandboxedExecutor` | worker-thread execution with heap and wall-clock limits |

## Tool lifecycle

```text
model proposes call
  → runtime creates Action
  → PolicyEngine authorizes
  → ToolExecutor resolves tool
  → validate input
  → execute with ExecContext
  → validate output
  → Observation
```

Unknown `tool://` names are denied by `createToolPolicy()` by default. Non-tool
targets return `otherwise`—`allow` by default—because another policy engine is
expected to own those schemes. Compose policies so every target is covered.

`createToolPolicy(registry, options)` options:

| Option | Default | Effect |
|---|---|---|
| `approvalFor` | `['destructive']` | side effects that require human approval |
| `unknownTool` | `'deny'` | verdict for `tool://` names not in the registry |
| `otherwise` | `'allow'` | verdict for non-tool targets (abstain — another engine owns them) |
| `denyExternalTriggered` | `[]` | side effects denied when `ctx.provenance.lowest === 'external'` |

Every branch returns a `PolicyVerdict` with a `reason` (`missing grants:
…`, `… side effect triggered by external evidence (…)`, `no registered
tool '…'`) — the reason lands on `action.denied` and the denial
observation, so the audit record distinguishes *why* a call was refused.

`Tool.trust` declares the trust of the tool's output — set `'external'` when
the output is authored outside the system (web pages, emails, untrusted
files). `ToolExecutor` stamps it on the observation; wrappers over
environments must declare it themselves — the environment's own tag does
not flow through.

## Writing a tool

```ts
const deploy: Tool = {
  name: 'deploy',
  description: 'Deploy one service to one environment',
  inputSchema: deployInputSchema,
  outputSchema: deployOutputSchema,
  permissions: ['deploy.write'],
  sideEffects: 'destructive',
  execute: async (input, ctx) => {
    const token = await ctx.secrets?.resolve('env:DEPLOY_TOKEN');
    return deployService(input, { token, signal: ctx.signal });
  },
};
```

Honor `ctx.signal`, keep permission and side-effect metadata honest, and never
return resolved secret values.

## Secret references

Actions and prompts should contain references such as `env:API_KEY` or
`vault:path#key`, not values. The runtime passes the configured resolver through
`ExecContext`; the executor resolves at the last responsible moment.

`EnvSecretProvider` reads `env:` references. `FileSecretProvider` reads
`file:/abs/path` references — for mounted secret volumes (k8s, injected
credential files); reads are cached per path with a 60-second TTL
(configurable) so rotations are picked up without a filesystem hit per
action. `MapSecretProvider` is useful for tests and small controlled
deployments. `chainSecrets()` returns the first resolved value. A Vault or
cloud-secret adapter can implement the same port.

## Worker-thread sandbox

```ts
const executor = new SandboxedExecutor({
  module: new URL('./executor-module.ts', import.meta.url).href,
  limits: { maxOldGenerationSizeMb: 64, stackSizeMb: 2 },
  timeoutMs: 10_000,
});
```

The module must export `createExecutor(): ActionExecutor`. Each action runs in a
fresh worker. Timeout or abort terminates the worker, and observations cross the
boundary through structured clone.

This protects the host from crashes, runaway heaps, and stuck workers. It is
not an OS security sandbox: workers share the process filesystem and network
authority. Use a container or stronger isolation for hostile code.
