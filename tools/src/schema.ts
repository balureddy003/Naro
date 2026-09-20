/**
 * A deliberately small subset of JSON Schema — enough to describe tool
 * inputs/outputs honestly without a validation dependency.
 *
 * This is a *contract boundary*, not a validator library: adapters can
 * swap in ajv or zod behind `SchemaValidator` when a deployment needs
 * the full spec.
 */
export interface JsonSchema {
  readonly type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly enum?: readonly unknown[];
  readonly additionalProperties?: boolean;
  readonly description?: string;
}

export interface ValidationError {
  readonly path: string;   // JSON-path-ish, e.g. '$.user.name'
  readonly message: string;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value; // 'object' | 'number' | 'string' | 'boolean' | ...
}

function typeMatches(expected: string, actual: string): boolean {
  if (expected === 'number' && actual === 'integer') return true; // int ⊆ number
  return expected === actual;
}

/** Returns a list of violations; empty means valid. */
export function validate(schema: JsonSchema, value: unknown, path = '$'): ValidationError[] {
  const errors: ValidationError[] = [];
  const fail = (message: string) => errors.push({ path, message });

  if (schema.enum && !schema.enum.some((v) => v === value)) {
    fail(`must be one of ${JSON.stringify(schema.enum)}`);
    return errors; // enum mismatch — deeper checks are noise
  }

  if (schema.type) {
    const actual = typeOf(value);
    if (!typeMatches(schema.type, actual)) {
      fail(`expected ${schema.type}, got ${actual}`);
      return errors;
    }
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) fail(`missing required property '${key}'`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in obj) errors.push(...validate(sub, obj[key], `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) fail(`unexpected property '${key}'`);
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => errors.push(...validate(schema.items!, item, `${path}[${i}]`)));
  }

  return errors;
}
