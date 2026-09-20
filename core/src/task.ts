import { newId } from './ids.ts';

export type TaskStatus =
  | 'created'    // defined, not yet eligible (deps may be unmet)
  | 'ready'      // all dependencies completed
  | 'running'    // being executed
  | 'blocked'    // waiting on something external
  | 'completed'  // finished successfully
  | 'failed'     // exhausted retries or unrecoverable
  | 'cancelled'; // abandoned

/**
 * A Task is executable work derived from a Goal.
 *
 * Tasks form a graph through `dependsOn` (ordering) and `parentId`
 * (decomposition). A task with no dependencies is ready as soon as it
 * is created. Multi-agent delegation is just a task whose `owner` is
 * another agent — no special machinery required.
 */
export interface Task {
  readonly id: string;
  readonly goalId: string;
  readonly description: string;
  status: TaskStatus;
  /** Ids of tasks that must complete before this one can run. */
  readonly dependsOn: readonly string[];
  /** Set when this task was created by decomposing a parent task. */
  readonly parentId?: string;
  /** Which agent (or human) owns execution. */
  readonly owner?: string;
  maxRetries: number;
  retryCount: number;
  /** Epoch ms after which the task is considered failed. */
  deadline?: number;
  result?: unknown;
  error?: string;
  metadata: Record<string, unknown>;
}

export interface TaskInput {
  goalId: string;
  description: string;
  dependsOn?: readonly string[];
  parentId?: string;
  owner?: string;
  maxRetries?: number;
  deadline?: number;
  metadata?: Record<string, unknown>;
}

export function createTask(input: TaskInput): Task {
  const task: Task = {
    id: newId('task'),
    goalId: input.goalId,
    description: input.description,
    status: 'created',
    dependsOn: input.dependsOn ?? [],
    maxRetries: input.maxRetries ?? 0,
    retryCount: 0,
    metadata: input.metadata ?? {},
  };
  return {
    ...task,
    ...(input.parentId !== undefined && { parentId: input.parentId }),
    ...(input.owner !== undefined && { owner: input.owner }),
    ...(input.deadline !== undefined && { deadline: input.deadline }),
  };
}

/**
 * A task is ready when every dependency has completed.
 * Note the direction: readiness is derived, never stored — status is
 * recomputed from the graph so it can't drift out of sync.
 */
export function isTaskReady(task: Task, all: ReadonlyMap<string, Task>): boolean {
  if (task.status !== 'created' && task.status !== 'ready') return false;
  return task.dependsOn.every((dep) => all.get(dep)?.status === 'completed');
}
