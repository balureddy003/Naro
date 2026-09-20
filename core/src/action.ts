import { newId } from './ids.ts';

export type ActionState =
  | 'requested'   // reasoner proposed it
  | 'authorized'  // policy allowed it
  | 'denied'      // policy refused it
  | 'running'     // executor is performing it
  | 'completed'   // produced an observation
  | 'failed';     // execution threw

/**
 * An Action is a single attempt to change or inspect the world.
 *
 * Actions are intentionally environment-agnostic: `target` is a URI
 * (`tool://calculator`, `env://local/greeting`) and `capability` names
 * what is being exercised — the core never knows what a filesystem,
 * a browser, or a robot arm is.
 */
export interface Action {
  readonly id: string;
  /** Who initiated it — an agent id, or 'human' / 'system'. */
  readonly actor: string;
  /** What capability this action exercises, e.g. 'tool.invoke', 'env.write'. */
  readonly capability: string;
  /** Where it lands — resolved by the executor that owns the scheme. */
  readonly target: string;
  readonly input: unknown;
  /** Permissions the action requests; the policy engine evaluates them. */
  readonly permissions: readonly string[];
  /** The task this action serves, when it was dispatched for one. */
  readonly taskId?: string;
  /**
   * The provider's tool-call identifier, when this action came from a
   * model tool call. Protocols (OpenAI/Anthropic) require results to
   * reference the original call id — losing it breaks the transcript.
   */
  readonly toolCallId?: string;
  /**
   * Deduplication key for retry/resume safety. The runtime derives a
   * stable key per action so idempotent executors can recognize a
   * repeated write after a crash instead of applying it twice.
   */
  readonly idempotencyKey?: string;
  state: ActionState;
  result?: unknown;
  /** Free-form note of what changed, for audit ("wrote 3 files"). */
  sideEffects?: string;
  readonly createdAt: number;
}

export interface ActionInput {
  capability: string;
  target: string;
  input?: unknown;
  permissions?: readonly string[];
  taskId?: string;
  toolCallId?: string;
  idempotencyKey?: string;
}

export function createAction(actor: string, input: ActionInput): Action {
  return {
    id: newId('act'),
    actor,
    capability: input.capability,
    target: input.target,
    input: input.input,
    permissions: input.permissions ?? [],
    ...(input.taskId !== undefined && { taskId: input.taskId }),
    ...(input.toolCallId !== undefined && { toolCallId: input.toolCallId }),
    ...(input.idempotencyKey !== undefined && { idempotencyKey: input.idempotencyKey }),
    state: 'requested',
    createdAt: Date.now(),
  };
}
