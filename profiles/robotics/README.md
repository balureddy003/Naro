# @naro/profile-robotics

A robotics agent's world: **sensors in, actuators out, estop always live**.

## The port

`RobotDriver` — `sense / act / estop`. `GridSimDriver` ships a deterministic
2D grid world (position, heading, walls, battery) that doubles as a
`TreeSearchReasoner` world-model simulator — the same sim that executes can
predict.

## Capabilities

| Capability | Side effect | Note |
|---|---|---|
| `robot.sense` | read | pose, battery, blocked |
| `robot.act` | destructive | moves a physical body — gate with policy |
| `robot.estop` | **read** | deliberately ungateable: a safety stop is never deniable |
| `robot.reset` | write | re-arms after estop — itself gateable |

The estop **latch lives in the environment**, not the driver — even a buggy
driver can't move after a stop until a gated `robot.reset` re-arms.
