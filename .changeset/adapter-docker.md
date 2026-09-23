---
"@naro/adapter-docker": minor
---

New package: `DockerSandboxExecutor`, an `ActionExecutor` with real
namespace/cgroup isolation via `docker run --network=none --read-only
--cap-drop=ALL --security-opt=no-new-privileges:true` plus memory/cpu/pids
limits — the container adapter `@naro/tools`'s `SandboxedExecutor` names
directly as what untrusted code needing OS-level isolation requires, since
a worker thread shares the host process's syscall surface.

The image contract mirrors `SandboxedExecutor`'s worker protocol exactly:
one line of `{action, ctx}` JSON in over stdin, one line of `{ok, observation}
| {ok: false, error}` JSON out over stdout — an image built on
`node:22-alpine` can reuse `tools/src/sandbox-worker.ts` almost verbatim.

Honestly documented as a real step up from a worker thread and explicitly
*not* equivalent to a hardware-VM boundary (gVisor/Kata/Firecracker remain
the stronger answer for genuinely hostile code) — see the README's "What
this is — and isn't" section and the updated
`docs/production-readiness.md` §3.
