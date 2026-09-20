import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Checkpoint, CheckpointStore } from './checkpoint.ts';

/**
 * Durable checkpoint store on node:sqlite — zero deps, transactional,
 * survives crashes. The honest middle tier between JSONL files (dev)
 * and Postgres (production): same CheckpointStore port, real durability.
 */
export class SqliteCheckpointStore implements CheckpointStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        state TEXT NOT NULL,
        at INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoints_agent ON checkpoints(agent_id, at);
    `);
  }

  save(checkpoint: Checkpoint): Promise<void> {
    this.db.prepare(
      'INSERT INTO checkpoints (id, agent_id, state, at, data) VALUES (?, ?, ?, ?, ?)',
    ).run(checkpoint.id, checkpoint.agentId, checkpoint.state, checkpoint.at, JSON.stringify(checkpoint.data));
    return Promise.resolve();
  }

  latest(agentId: string): Promise<Checkpoint | undefined> {
    const row = this.db.prepare(
      'SELECT id, agent_id, state, at, data FROM checkpoints WHERE agent_id = ? ORDER BY at DESC, rowid DESC LIMIT 1',
    ).get(agentId) as { id: string; agent_id: string; state: string; at: number; data: string } | undefined;
    return Promise.resolve(row && {
      id: row.id, agentId: row.agent_id, state: row.state as Checkpoint['state'],
      at: row.at, data: JSON.parse(row.data) as Checkpoint['data'],
    });
  }

  /** All checkpoints for an agent, oldest first — for audit/debugging. */
  history(agentId: string): Promise<readonly Checkpoint[]> {
    const rows = this.db.prepare(
      'SELECT id, agent_id, state, at, data FROM checkpoints WHERE agent_id = ? ORDER BY at, rowid',
    ).all(agentId) as { id: string; agent_id: string; state: string; at: number; data: string }[];
    return Promise.resolve(rows.map((row) => ({
      id: row.id, agentId: row.agent_id, state: row.state as Checkpoint['state'],
      at: row.at, data: JSON.parse(row.data) as Checkpoint['data'],
    })));
  }

  close(): void { this.db.close(); }
}
