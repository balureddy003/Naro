# @naro/profile-coding

The reference domain profile: a workspace on disk as the agent's world.

## What it proves

Coding-agent concepts — files, directories, shell — live in a **profile**, not the kernel. `WorkspaceEnvironment` implements the same `Environment` contract as `InMemoryEnvironment`; the kernel never learned what a file is.

## Capabilities

| Capability | Action | Notes |
|---|---|---|
| `fs.read` | read `env://ws/<path>` | content truncated at `maxReadBytes` |
| `fs.write` | write `input.content` | creates parent dirs |
| `fs.list` | list a directory | entries with trailing `/` for dirs |
| `fs.delete` | remove a file | — |
| `shell.exec` | run `input.command` in the workspace | exit code + bounded stdout/stderr |

## Security

- **Path jail**: every target is resolved and prefix-checked against `root` — `../` escapes throw.
- **`shell.exec` is the dangerous one**: it should be `require_approval` or `deny` in production policy. Capability names exist precisely so policy can gate them.
- `state()` exposes the file tree (bounded at 200 entries) — the agent's observable world.

## Usage

```ts
const env = new WorkspaceEnvironment({ root: '/path/to/project' });
const runner = new AgentRunner({
  spec, reasoner,
  executor: new CompositeExecutor({ 'env://': env, 'tool://': toolExec }),
  policy: codingPolicy,   // e.g. shell.exec → require_approval
});
```
