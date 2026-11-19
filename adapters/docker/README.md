# @naro/adapter-docker

OS-level isolation for `ActionExecutor` — the container adapter
`@naro/tools`'s `SandboxedExecutor` names directly: untrusted code that
"must not reach the filesystem/network at all needs the container adapter."
A worker thread (`SandboxedExecutor`) shares the host process's syscall
surface; a container does not.

## Usage

```ts
import { DockerSandboxExecutor } from '@naro/adapter-docker';

const executor = new DockerSandboxExecutor({
  image: 'naro-sandbox:latest',   // must already be built/pulled — see below
  network: 'none',                // default — opt into 'bridge'/'host' explicitly
  memory: '256m',
  cpus: '0.5',
  timeoutMs: 30_000,
});

const runner = new AgentRunner({ /* ... */ executor, /* ... */ });
```

Every `docker run` carries `--rm -i --network=none --read-only
--cap-drop=ALL --security-opt=no-new-privileges:true` plus `--memory`,
`--cpus`, and `--pids-limit` by default. `extraArgs` appends after those —
volume mounts, `--user`, environment variables — the deployment's explicit
choice; nothing here narrows the container back open on its own.

## The image contract

The image runs **one action and exits**. It reads one line of
`JSON.stringify({action, ctx})` from stdin and writes one line of
`JSON.stringify({ok: true, observation} | {ok: false, error})` to stdout —
the exact message shape `@naro/tools`'s `sandbox-worker.ts` already uses
for `SandboxedExecutor`'s worker thread. An image built on `node:22-alpine`
can reuse that file almost verbatim as its entrypoint:

```ts
// entrypoint.ts inside the image
import type { Action, ExecContext } from '@naro/core';

const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
const { action, ctx } = JSON.parse(Buffer.concat(chunks).toString()) as { action: Action; ctx: ExecContext };

try {
  const observation = await myExecutor.execute(action, ctx);
  process.stdout.write(JSON.stringify({ ok: true, observation }));
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
}
```

Any other language works too — the contract is two JSON shapes over
stdin/stdout, not a Node API. Startup noise before the contract line
(image warmup logs, etc.) is tolerated: `DockerSandboxExecutor` reads the
**last** non-empty line of stdout, matching one message per run.

`ExecContext.signal` and `ExecContext.secrets` never cross the process
boundary — an `AbortSignal` and a live `resolve()` callback aren't
serializable, and secrets specifically must never leave the host process
as values (the same rule every executor follows: actions carry secret
*references*, resolved just-in-time). The image sees the ref strings your
action already carries, not resolved credentials; if it needs to resolve
one, wire a secrets provider inside the image itself.

## What this is — and isn't

- **This is a real, kernel-enforced isolation boundary** — Linux
  namespaces and cgroups via the Docker daemon, not a shared V8 heap.
  `--network=none`, `--read-only`, `--cap-drop=ALL`, and resource limits
  are real constraints the container cannot lift from inside.
- **This is not a hardware-VM boundary.** Container escape vulnerabilities
  in the kernel or container runtime are rare but real. For genuinely
  hostile, adversarial code, a stronger boundary (gVisor, Kata Containers,
  Firecracker microVMs) is still the answer —
  [`docs/production-readiness.md`](../../docs/production-readiness.md) §3
  names these explicitly. This adapter is a real step up from a worker
  thread, not a claim of equivalence to a microVM.
- **The Docker daemon and the image are deployment responsibilities.**
  This adapter never builds, pulls, or updates an image, and it assumes
  `docker` (or a compatible CLI — `dockerBin: 'podman'` works the same
  way) is already reachable. An unreachable daemon fails the observation
  (`docker spawn failed: …`), not the host process.

## Failure behavior

- a timeout, a non-zero exit, a missing `docker` binary, or stdout that
  doesn't match the contract all become a failed `Observation` with a
  specific `error` — never a thrown exception or a hang;
- cancellation (`ExecContext.signal`) has no channel into a running
  container from here — a caller that needs mid-run cancellation should
  keep `timeoutMs` tight rather than rely on abort;
- `spawn` is injectable — tests run offline against canned process output,
  the same pattern as this repo's injectable `fetch` in the HTTP adapters.
