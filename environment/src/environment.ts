import type { ActionExecutor, Observation } from '@naro/core';

/**
 * A snapshot of what the world looks like right now — from the agent's
 * point of view. Environments decide what is observable; `resources` is
 * deliberately `unknown`-typed because Naro core cannot know whether a
 * resource is a file, a browser tab, or a robot joint.
 */
export interface EnvironmentState {
  readonly at: number;
  readonly resources: Readonly<Record<string, unknown>>;
}

/**
 * The Environment is the world the agent operates in.
 *
 * This is the abstraction that generalizes the coding-agent "workspace":
 * a CodingEnvironment's resources are files and processes, a
 * BrowserEnvironment's are tabs and the DOM, a RoboticsEnvironment's are
 * actuators and sensors — all behind the same contract.
 *
 * Environments implement `ActionExecutor` because from the runtime's
 * perspective, acting on the world IS executing an action. Side effects
 * may only happen here (or inside tools) — never in reasoners.
 */
export interface Environment extends ActionExecutor {
  readonly id: string;
  /** Declared abilities, e.g. 'kv.read', 'kv.write'. Callers must check. */
  readonly capabilities: readonly string[];
  /** Current observable state. */
  state(): Promise<EnvironmentState> | EnvironmentState;
}

/** Helper for environments: a failed observation instead of a throw. */
export function unsupported(capability: string, envId: string): Omit<Observation, 'id' | 'at' | 'actionId'> {
  return {
    source: `env://${envId}`,
    kind: 'env-change',
    success: false,
    trust: 'tool',
    error: `environment '${envId}' does not support capability '${capability}'`,
  };
}
