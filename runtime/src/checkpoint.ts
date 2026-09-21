import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newId, type Action, type AgentState, type ContextItem, type Observation, type Task } from '@naro/core';

/**
 * A Checkpoint is enough state to resume an agent run after a crash.
 *
 * Checkpoints are taken at *reasoning boundaries* only — never mid-action —
 * so a restored run can never resume with a half-executed side effect.
 */
export interface Checkpoint {
  readonly id: string;
  readonly agentId: string;
  readonly at: number;
  /** The state the run was in when checkpointed (always resumable). */
  readonly state: AgentState;
  readonly data: {
    readonly iteration: number;
    readonly tasks: readonly Task[];
    readonly actions: readonly Action[];
    readonly observations: readonly Observation[];
    readonly context: readonly ContextItem[];
    /** Reasoner-internal state from `StatefulReasoner.captureState()`, if any. */
    readonly reasonerState?: unknown;
    /** Run identifier — event ordering and runId continue across resumes. */
    readonly runId?: string;
    /** Last event sequence number — the resumed run's journal continues it. */
    readonly seq?: number;
    /** Journal chain head at checkpoint time — the resumed run links its next event to it. */
    readonly head?: string;
  };
}

/** Persistence port for checkpoints. Swap in SQLite/Postgres via adapters. */
export interface CheckpointStore {
  save(checkpoint: Checkpoint): Promise<void>;
  /** Most recent checkpoint for an agent, if any. */
  latest(agentId: string): Promise<Checkpoint | undefined>;
}

/** Default store — process-local, lost on exit. Fine for dev and tests. */
export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly byAgent = new Map<string, Checkpoint[]>();

  save(checkpoint: Checkpoint): Promise<void> {
    const list = this.byAgent.get(checkpoint.agentId) ?? [];
    list.push(checkpoint);
    this.byAgent.set(checkpoint.agentId, list);
    return Promise.resolve();
  }

  latest(agentId: string): Promise<Checkpoint | undefined> {
    const list = this.byAgent.get(agentId);
    return Promise.resolve(list?.at(-1));
  }
}

/** File-backed store: one JSON lines file per agent under `dir`. */
export class FileCheckpointStore implements CheckpointStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private fileFor(agentId: string): string {
    return join(this.dir, `${agentId}.checkpoints.jsonl`);
  }

  async save(checkpoint: Checkpoint): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.fileFor(checkpoint.agentId), JSON.stringify(checkpoint) + '\n', { flag: 'a' });
  }

  async latest(agentId: string): Promise<Checkpoint | undefined> {
    try {
      const text = await readFile(this.fileFor(agentId), 'utf8');
      const lines = text.trim().split('\n').filter(Boolean);
      if (lines.length === 0) return undefined;
      return JSON.parse(lines.at(-1)!) as Checkpoint;
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function createCheckpoint(
  agentId: string,
  state: AgentState,
  data: Checkpoint['data'],
  id: string = newId('ckpt'),
): Checkpoint {
  return { id, agentId, at: Date.now(), state, data };
}
