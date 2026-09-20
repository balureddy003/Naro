# @naro/cli

`naro` — the developer-facing entrypoint.

```bash
npx naro run <agent.ts>       # run an agent module (Node 26 native TS)
npx naro bench <bench.ts>     # run a module exporting EvalCase[]
npx naro replay <audit.jsonl> # reprint + summarize a recorded event stream
npx naro states               # print the lifecycle transition table
```

## Why these four

- **`run`** — zero-friction execution; the agent file is just a program.
- **`bench`** — benchmarks are modules exporting `EvalCase[]`; exit code is CI-friendly (1 on any failure).
- **`replay`** — the JSONL audit stream is a first-class artifact; replaying it produces the same metrics a live run would (`computeMetrics` is pure).
- **`states`** — the transition table as documentation you can diff.

## Design

`main(argv, io)` is pure and testable — the bin shim is 5 lines. `bench` dynamically imports the module, so benchmarks compose real runners, reasoners, and environments with zero framework magic.
