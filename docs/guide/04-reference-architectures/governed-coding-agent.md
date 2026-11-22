# Governed Coding Agent

A coding agent that can read and write a workspace while remaining auditable and controllable.

## Capabilities

- Coding profile (jailed filesystem + shell)
- Tool set limited to the workspace
- Optional human approval for destructive commands

## Controls

- Path jail via realpath
- Policy requires approval for destructive shell or file operations
- Provenance rules if the agent consumes external content
- Verification of final diff or test results

## Evidence

- Full journal of every file and shell action
- Evidence record joining policy → action → observation → verifier
- Optional journal sealing

## Production boundary

Suitable for internal developer tooling and controlled CI agents. For untrusted code or multi-tenant use, add an external OS/container sandbox in front of the hands.

See: `examples/coding-agent` and `examples/governed-agent`.
