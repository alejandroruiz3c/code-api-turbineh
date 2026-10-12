import Ajv, { type ErrorObject } from "ajv";

const ajv = new Ajv({ allErrors: true, strict: true });

/** Validates a value against a JSON Schema; errors are short and safe to log (no values echoed). */
export function validateJson(
  schema: object,
  value: unknown,
): { ok: true } | { ok: false; errors: string[] } {
  const validate = ajv.compile(schema);
  if (validate(value)) return { ok: true };
  return {
    ok: false,
    errors: (validate.errors ?? []).map(
      (e: ErrorObject) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
    ),
  };
}
