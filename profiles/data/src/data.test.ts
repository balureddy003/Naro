import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAction } from '@naro/core';
import { ToolExecutor, ToolRegistry } from '@naro/tools';
import { DataEnvironment } from './data-env.ts';
import { NodeSqliteDriver } from './driver.ts';
import { dataTools } from './tools.ts';

const ctx = { agentId: 'a1', goalId: 'g1' };
const act = (cap: string, input?: unknown) =>
  createAction('a1', { capability: cap, target: 'env://db/x', ...(input !== undefined && { input }) });

async function seeded() {
  const driver = new NodeSqliteDriver();
  await driver.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)');
  await driver.exec("INSERT INTO users (name, age) VALUES (?, ?)", ['ada', 36]);
  await driver.exec("INSERT INTO users (name, age) VALUES (?, ?)", ['grace', 85]);
  return new DataEnvironment({ driver }, 'db');
}

test('sql.query returns parameterized reads', async () => {
  const env = await seeded();
  const obs = await env.execute(act('sql.query', { sql: 'SELECT name FROM users WHERE age > ?', params: [40] }), ctx);
  assert.equal(obs.success, true);
  assert.deepEqual((obs.output as { rows: { name: string }[] }).rows, [{ name: 'grace' }]);
  await (env as never as { driver: { close(): Promise<void> } });
});

test('read/write split is enforced by capability', async () => {
  const env = await seeded();
  const writeAsRead = await env.execute(act('sql.query', { sql: 'DELETE FROM users' }), ctx);
  assert.equal(writeAsRead.success, false);
  assert.match(writeAsRead.error ?? '', /sql\.exec/);
  const readAsWrite = await env.execute(act('sql.exec', { sql: 'SELECT 1' }), ctx);
  assert.equal(readAsWrite.success, false);
});

test('sql.exec performs parameterized writes', async () => {
  const env = await seeded();
  const w = await env.execute(act('sql.exec', { sql: 'INSERT INTO users (name, age) VALUES (?, ?)', params: ['hopper', 60] }), ctx);
  assert.equal((w.output as { changes: number }).changes, 1);
  const r = await env.execute(act('sql.query', { sql: 'SELECT COUNT(*) AS n FROM users' }), ctx);
  assert.equal((r.output as { rows: { n: number }[] }).rows[0]!.n, 3);
});

test('sql.schema inventories tables', async () => {
  const env = await seeded();
  const s = await env.execute(act('sql.schema'), ctx);
  const schema = s.output as { table: string; columns: string[] }[];
  assert.equal(schema[0]!.table, 'users');
  assert.deepEqual(schema[0]!.columns, ['id', 'name', 'age']);
});

test('row cap truncates honestly', async () => {
  const driver = new NodeSqliteDriver();
  await driver.exec('CREATE TABLE t (x INTEGER)');
  for (let i = 0; i < 10; i++) await driver.exec('INSERT INTO t VALUES (?)', [i]);
  const env = new DataEnvironment({ driver, maxRows: 3 }, 'db');
  const obs = await env.execute(act('sql.query', { sql: 'SELECT * FROM t' }), ctx);
  const out = obs.output as { rows: unknown[]; truncated?: boolean; totalRows?: number };
  assert.equal(out.rows.length, 3);
  assert.equal(out.truncated, true);
  assert.equal(out.totalRows, 10);
});

test('dataTools run through the standard pipeline', async () => {
  const env = await seeded();
  const reg = new ToolRegistry();
  for (const t of dataTools(env)) reg.register(t);
  const obs = await new ToolExecutor(reg).execute(
    createAction('a1', { capability: 'tool.invoke', target: 'tool://sql_query', input: { sql: 'SELECT name FROM users WHERE id = ?', params: [1] } }),
    ctx,
  );
  assert.equal(obs.success, true);
  assert.equal((obs.output as { rows: { name: string }[] }).rows[0]!.name, 'ada');
  assert.equal(reg.get('sql_exec')?.sideEffects, 'write');
});
