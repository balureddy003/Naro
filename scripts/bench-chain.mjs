#!/usr/bin/env node
/**
 * Journal throughput bench — the numbers behind "tamper-evident at scale".
 *   node scripts/bench-chain.mjs [events]
 *
 * Measures EventBus.emit (hash + chain per event) and verifyChain (rehash +
 * relink every event). No assertions — this prints measurements for docs.
 */
import { EventBus } from '../runtime/dist/index.js';
import { verifyChain } from '../core/dist/index.js';

const N = Number(process.argv[2] ?? 100_000);
const bus = new EventBus({ agentId: 'bench', goalId: 'bench' });

let t = performance.now();
for (let i = 0; i < N; i++) {
  bus.emit('reasoning.completed', { iteration: i, decisionKind: 'act' });
}
const emitMs = performance.now() - t;
const events = bus.history();

t = performance.now();
const verdict = verifyChain(events);
const verifyMs = performance.now() - t;

const fmt = (ms) => `${(N / (ms / 1000)).toLocaleString('en-US', { maximumFractionDigits: 0 })} events/s`;
console.log(`${N.toLocaleString()} events`);
console.log(`  emit (canonicalize + sha256 + chain): ${emitMs.toFixed(0)}ms → ${fmt(emitMs)}`);
console.log(`  verifyChain (rehash + relink):        ${verifyMs.toFixed(0)}ms → ${fmt(verifyMs)}`);
console.log(`  chain ok: ${verdict.ok}  head: ${verdict.head?.slice(0, 16)}…`);
