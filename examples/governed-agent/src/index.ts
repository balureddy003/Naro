/**
 * Governed agent — the moat, end to end, in one file.
 *
 *   node examples/governed-agent/src/index.ts
 *
 * What this shows that minimal-agent doesn't:
 *   - a real policy gate (createToolPolicy — unknown tools deny, missing
 *     grants deny, destructive side effects would require approval)
 *   - a real verifier (CommandVerifier — "run the tests" as evidence)
 *   - a durable hash-chained journal (SqliteEventStore + JSONL export)
 *   - wake(): a second runner resumes the paused session from the journal
 *     alone — no checkpoint, no shared memory
 *   - a sealed journal head (Ed25519 — `naro verify --pubkey` proves the
 *     journal ends where the key-holder left it, across the wake boundary)
 *   - repo context (git state + AGENTS.md) via RepoContextSource
 *
 * The model is a MockModel so it runs offline; swap in
 * `new AnthropicModel(...)` and nothing else changes.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAgentSpec, createGoal, generateSealKeypair, verifyChain,
} from '@naro/core';
import { MockModel } from '@naro/model';
import { ReActReasoner } from '@naro/reasoning';
import { AgentRunner, CompositeExecutor } from '@naro/runtime';
import { ToolExecutor, ToolRegistry, createToolPolicy } from '@naro/tools';
import { CommandVerifier } from '@naro/verification';
import { JsonlExporter, SqliteEventStore, buildEvidence, formatEvidence } from '@naro/observability';
import { codingTools, WorkspaceEnvironment, RepoContextSource } from '@naro/profile-coding';

const dir = await mkdtemp(join(tmpdir(), 'naro-governed-'));
const journalFile = join(dir, 'journal.jsonl');
const dbFile = join(dir, 'naro.db');
const { privateKeyPem, publicKeyPem } = generateSealKeypair();
await writeFile(join(dir, 'seal.pub'), publicKeyPem);

try {
  // The world: a workspace with an answer file and its own agent rules.
  await writeFile(join(dir, 'answer.txt'), '42\n');
  await writeFile(join(dir, 'AGENTS.md'), 'Read files before answering. Never run destructive commands.');
  const env = new WorkspaceEnvironment({ root: dir }, 'ws');

  // The hands: coding tools + workspace, behind one executor.
  const tools = codingTools(env);
  const registry = new ToolRegistry();
  for (const t of tools) registry.register(t);

  // The durable session: every event lands hash-chained in SQLite and JSONL.
  const sqlite = new SqliteEventStore(dbFile);
  const jsonl = new JsonlExporter(journalFile);
  const wireJournal = (runner: AgentRunner) => runner.on('*', (e) => {
    void sqlite.export([e]);
    void jsonl.export([e]);
  });

  const goal = createGoal({
    description: 'read answer.txt and report its contents',
    successCriteria: ['the reported content matches the file'],
  });
  const spec = createAgentSpec({ name: 'governed', goal });
  const executor = () => new CompositeExecutor({ 'env://': env, 'tool://': new ToolExecutor(registry) });
  const policy = () => createToolPolicy(registry);

  // Phase 1: the first runner reads the file, then PAUSES mid-run —
  // as if the process died here.
  const model = new MockModel({
    responses: [
      { message: { role: 'assistant', content: '', toolCalls: [
        { id: 't1', name: 'read_file', arguments: { path: 'answer.txt' } },
      ] }, finishReason: 'tool-calls' },
      { message: { role: 'assistant', content: 'The file contains 42.' }, finishReason: 'stop' },
    ],
  });
  const runner1 = new AgentRunner({
    spec,
    reasoner: new ReActReasoner(model, {
      tools: tools.map((t) => ({ name: t.name, description: t.description, parameters: { ...t.inputSchema } as Record<string, unknown> })),
    }),
    executor: executor(),
    policy: policy(),                          // the gate — required
    grants: ['fs.read', 'shell.exec'],
    context: new RepoContextSource({ root: dir }),
  });
  wireJournal(runner1);
  runner1.on('action.completed', () => runner1.pause()); // simulate the crash
  const r1 = await runner1.run();
  console.log(`phase 1: status=${r1.status} after ${r1.events.length} events\n`);

  // Phase 2: a DIFFERENT runner (another process, another host) wakes the
  // session from the journal — no checkpoint involved — and finishes it.
  const woken = new AgentRunner({
    spec,                                     // same agent identity
    reasoner: new ReActReasoner(model, {
      tools: tools.map((t) => ({ name: t.name, description: t.description, parameters: { ...t.inputSchema } as Record<string, unknown> })),
    }),
    executor: executor(),
    policy: policy(),
    grants: ['fs.read', 'shell.exec'],
    context: new RepoContextSource({ root: dir }),
    verifier: new CommandVerifier('grep -q 42 answer.txt', { cwd: dir }),
    sealKey: privateKeyPem,                   // seal the journal at run end
  });
  wireJournal(woken);
  const r2 = await woken.wake(await sqlite.history({ runId: r1.events[0]!.runId }));
  console.log(`phase 2: woken run status=${r2.status} result=${JSON.stringify(r2.result)}\n`);

  // The proof: one journal, two segments, one unbroken signed chain.
  // flush() — exports are queued; the seal event lands on the last write.
  await sqlite.flush();
  await jsonl.flush();
  const journal = await sqlite.history({ runId: r1.events[0]!.runId });
  console.log(formatEvidence(buildEvidence(journal)));
  const verdict = verifyChain(journal);
  console.log(`\nseal: ${verdict.sealed?.ok === true ? 'VALID — verify with:' : 'none'}`);
  console.log(`  naro verify ${journalFile} --pubkey ${join(dir, 'seal.pub')}`);

  sqlite.close();
} finally {
  await rm(dir, { recursive: true, force: true });
}
