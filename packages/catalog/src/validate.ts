import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { parse } from "yaml";
import schema from "./component.schema.json" with { type: "json" };

/** Licenses allowed for `approved` components in the beta (PLAN §3.6). */
export const ALLOWED_LICENSES = [
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
] as const;

export interface ComponentManifest {
  schema: "turbineh.component/v0.1";
  id: string;
  version: string;
  status: "discovered" | "evaluated" | "approved" | "deprecated";
  category: string;
  license: { declared: string; detected: string; obligations?: string[] };
  quality: { tests: { command: string; passed: boolean; date?: string } };
  security: {
    scanned_at?: string;
    tools: string[];
    findings: { id: string; severity: string; mitigation?: string }[];
    scope: string;
  };
  evidence: { claim: string; origin: string; ref?: string }[];
  relations: { requires: string[]; provides: string[]; conflicts: string[]; tested_with: string[] };
  [key: string]: unknown;
}

export interface ValidationResult {
  file: string;
  ok: boolean;
  errors: string[];
}

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile<ComponentManifest>(schema);

/**
 * Deterministic gate for `approved` (PLAN §3.2/§3.6): schema-valid, contract tests green,
 * scanned with no unmitigated critical/high findings, allowed license with no
 * declared/detected mismatch, and at least one claim backed by a test.
 */
export function approvalErrors(m: ComponentManifest): string[] {
  const errors: string[] = [];
  if (!m.quality.tests.passed) errors.push("approved requires quality.tests.passed = true");
  if (!m.security.scanned_at) errors.push("approved requires security.scanned_at");
  const blocking = m.security.findings.filter(
    (f) => (f.severity === "critical" || f.severity === "high") && !f.mitigation,
  );
  if (blocking.length)
    errors.push(
      `approved blocked by unmitigated findings: ${blocking.map((f) => f.id).join(", ")}`,
    );
  if (m.license.declared !== m.license.detected) {
    errors.push(
      `license mismatch: declared ${m.license.declared} vs detected ${m.license.detected}`,
    );
  }
  if (!(ALLOWED_LICENSES as readonly string[]).includes(m.license.detected)) {
    errors.push(`license ${m.license.detected} is not in the beta allow-list`);
  }
  if (!m.evidence.some((e) => e.origin === "tested")) {
    errors.push("approved requires at least one evidence entry with origin = tested");
  }
  return errors;
}

export function validateManifest(data: unknown, file = "<inline>"): ValidationResult {
  if (!validateSchema(data)) {
    const errors = (validateSchema.errors ?? []).map(
      (e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
    );
    return { file, ok: false, errors };
  }
  const errors = data.status === "approved" ? approvalErrors(data) : [];
  const expectedCategory = data.id.split(".")[0];
  if (expectedCategory !== data.category) {
    errors.push(`id prefix "${expectedCategory}" must match category "${data.category}"`);
  }
  return { file, ok: errors.length === 0, errors };
}

export function validateManifestFile(path: string): ValidationResult {
  try {
    return validateManifest(parse(readFileSync(path, "utf8")), path);
  } catch (err) {
    return { file: path, ok: false, errors: [`unreadable YAML: ${(err as Error).message}`] };
  }
}
