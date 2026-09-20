import { createObservation, type Action, type ExecContext, type Observation } from '@naro/core';
import type { Environment, EnvironmentState } from '@naro/environment';
import type { RobotCommand, RobotDriver } from './driver.ts';

/**
 * A robotics agent's world: sensors in, actuators out, estop always live.
 *
 * Capabilities:
 *   robot.sense — read pose/battery/blocked (read)
 *   robot.act   — move/turn the physical body (destructive — gate it)
 *   robot.estop — latch all motion off (agent-callable convenience)
 *   robot.reset — re-arm after estop (write — itself gateable)
 *
 * The GUARANTEED stop channel is `emergencyStop()`: a direct method an
 * operator/safety monitor calls out-of-band, outside the agent's policy
 * path entirely. The robot.estop capability is a convenience — a safety
 * stop must never depend on policy verdicts, grants, or approvals.
 * The latch lives in the ENVIRONMENT, not the driver: even a buggy
 * driver can't move after a stop until a gated reset re-arms.
 */

export class RoboticsEnvironment implements Environment {
  readonly id: string;
  readonly capabilities = ['robot.sense', 'robot.act', 'robot.estop', 'robot.reset'];
  private readonly driver: RobotDriver;
  private stopped = false;

  constructor(driver: RobotDriver, id = 'robot') {
    this.driver = driver;
    this.id = id;
  }

  /**
   * Out-of-band emergency stop — callable by operator code, safety
   * monitors, or a hardware callback WITHOUT going through the action
   * pipeline. This is the stop that policy can never deny.
   */
  async emergencyStop(): Promise<void> {
    await this.driver.estop();
    this.stopped = true;
  }

  /** Out-of-band re-arm — the counterpart an operator calls directly. */
  async resetSafety(): Promise<void> {
    this.stopped = false;
  }

  async state(): Promise<EnvironmentState> {
    const s = await this.driver.sense();
    return { at: Date.now(), resources: { pose: s.pose, battery: s.battery, estopped: this.stopped } };
  }

  async execute(action: Action, _ctx: ExecContext): Promise<Observation> {
    const input = (action.input ?? {}) as Partial<RobotCommand>;
    switch (action.capability) {
      case 'robot.sense':
        return this.obs(action, true, await this.driver.sense());
      case 'robot.estop':
        await this.emergencyStop();
        return this.obs(action, true, { stopped: true });
      case 'robot.reset':
        this.stopped = false;
        return this.obs(action, true, { stopped: false });
      case 'robot.act': {
        if (this.stopped) {
          return this.obs(action, false, undefined,
            'estop latched — robot.act refused until a robot.reset re-arms');
        }
        if (typeof input.move !== 'string') return this.obs(action, false, undefined, 'missing command.move');
        const r = await this.driver.act({ move: input.move as RobotCommand['move'], ...(input.amount !== undefined && { amount: input.amount }) });
        return this.obs(action, r.ok, r, r.ok ? undefined : r.detail);
      }
      default:
        return this.obs(action, false, undefined, `environment '${this.id}' does not support capability '${action.capability}'`);
    }
  }

  private obs(action: Action, success: boolean, output?: unknown, error?: string): Observation {
    return createObservation({
      actionId: action.id, source: `env://${this.id}`, kind: 'env-change',
      success, ...(output !== undefined && { output }), ...(error !== undefined && { error }),
    });
  }
}
