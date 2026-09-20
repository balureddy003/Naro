/**
 * The port between a robotics environment and a robot.
 * The environment knows capability routing and safety latching;
 * the driver knows actuators. Real drivers wrap ROS/gRPC/serial;
 * GridSimDriver is a deterministic 2D sim for tests and teaching.
 */

export interface Pose { readonly x: number; readonly y: number; readonly heading: number }

export interface RobotSensors {
  readonly pose: Pose;
  readonly battery: number; // 0-1
  readonly blocked: boolean;
  readonly telemetry?: Readonly<Record<string, unknown>>;
}

export interface RobotCommand {
  readonly move: 'forward' | 'backward' | 'turn_left' | 'turn_right';
  /** grid units for moves, degrees for turns. Default 1 / 90. */
  readonly amount?: number;
}

export interface ActResult {
  readonly ok: boolean;
  readonly pose: Pose;
  readonly detail?: string;
}

export interface RobotDriver {
  sense(): Promise<RobotSensors> | RobotSensors;
  act(command: RobotCommand): Promise<ActResult> | ActResult;
  estop(): Promise<void> | void;
}

/** Deterministic grid-world robot — a world model you can also use as a TreeSearch simulator. */
export class GridSimDriver implements RobotDriver {
  private x: number; private y: number; private heading: number;
  private battery = 1;
  private readonly walls: ReadonlySet<string>;

  constructor(opts: { size: number; start?: Pose; walls?: readonly [number, number][] }) {
    this.x = opts.start?.x ?? 0;
    this.y = opts.start?.y ?? 0;
    this.heading = opts.start?.heading ?? 0;
    this.size = opts.size;
    this.walls = new Set((opts.walls ?? []).map(([x, y]) => `${x},${y}`));
  }
  private readonly size: number;

  sense(): RobotSensors {
    const [nx, ny] = this.ahead();
    return {
      pose: { x: this.x, y: this.y, heading: this.heading },
      battery: this.battery,
      blocked: this.outOfBounds(nx, ny) || this.walls.has(`${nx},${ny}`),
      telemetry: { size: this.size },
    };
  }

  act(cmd: RobotCommand): ActResult {
    this.battery = Math.max(0, this.battery - 0.01);
    switch (cmd.move) {
      case 'turn_right': this.heading = (this.heading + 90) % 360; break;
      case 'turn_left': this.heading = (this.heading + 270) % 360; break;
      case 'forward': case 'backward': {
        const steps = cmd.amount ?? 1;
        const dir = cmd.move === 'forward' ? 1 : -1;
        for (let i = 0; i < steps; i++) {
          const [ax, ay] = this.ahead();
          const nx = this.x + (ax - this.x) * dir;
          const ny = this.y + (ay - this.y) * dir;
          if (this.outOfBounds(nx, ny)) return { ok: false, pose: this.pose(), detail: `bounds at (${nx},${ny})` };
          if (this.walls.has(`${nx},${ny}`)) return { ok: false, pose: this.pose(), detail: `wall at (${nx},${ny})` };
          this.x = nx; this.y = ny;
        }
      }
    }
    return { ok: true, pose: this.pose() };
  }

  estop(): void { /* latched by the environment, not the driver */ }

  private ahead(): [number, number] {
    const r = [[0, -1], [1, 0], [0, 1], [-1, 0]][this.heading / 90]!;
    return [this.x + r[0]!, this.y + r[1]!];
  }
  private outOfBounds(x: number, y: number): boolean {
    return x < 0 || y < 0 || x >= this.size || y >= this.size;
  }
  private pose(): Pose { return { x: this.x, y: this.y, heading: this.heading } }
}
