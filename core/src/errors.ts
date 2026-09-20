/**
 * Base error for everything Naro throws.
 * `code` is stable and machine-readable; `message` is for humans.
 */
export class NaroError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/**
 * Thrown when code attempts an agent state transition the state machine forbids.
 * This is the guardrail that keeps every execution inside the lifecycle contract.
 */
export class InvalidTransitionError extends NaroError {
  constructor(from: string, to: string) {
    super('invalid-transition', `Invalid agent state transition: ${from} → ${to}`);
  }
}

/**
 * Thrown when a capability is invoked on something that does not support it —
 * e.g. asking a text-only model for embeddings. Naro never silently degrades.
 */
export class CapabilityNotSupportedError extends NaroError {
  constructor(capability: string, owner: string) {
    super('capability-not-supported', `${owner} does not support capability '${capability}'`);
  }
}
