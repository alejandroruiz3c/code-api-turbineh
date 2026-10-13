import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";

/**
 * Domain component parameters (ADR-0041). A component that is parameterised by the request declares
 * `params: { file, schema }` in component.yaml: `file` is the app file the assembler writes (e.g.
 * src/workflow/params.json) and `schema` a JSON Schema (draft 2020-12) in the component directory. The compiler
 * generates params against that schema; the shipped default (files/<file>) must satisfy it, so a component assembled
 * without request parameters still works.
 */
export interface ParamsDecl {
  file: string;
  schema: string;
  entities?: string[];
}

export function readParamsDecl(componentDir: string): ParamsDecl | null {
  const manifest = join(componentDir, "component.yaml");
  if (!existsSync(manifest)) return null;
  const m = parse(readFileSync(manifest, "utf8")) as { params?: ParamsDecl };
  return m.params ?? null;
}

/** The JSON Schema of a component's params, or null. */
export function paramsSchema(componentDir: string): Record<string, unknown> | null {
  const decl = readParamsDecl(componentDir);
  if (!decl || !existsSync(join(componentDir, decl.schema))) return null;
  return JSON.parse(readFileSync(join(componentDir, decl.schema), "utf8")) as Record<
    string,
    unknown
  >;
}

/** Validates `params` against the component's schema: [] when valid, otherwise readable errors. */
export function validateParams(componentDir: string, params: unknown): string[] {
  const schema = paramsSchema(componentDir);
  if (!schema) return ["component declares no params schema"];
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const check = ajv.compile(schema);
  if (check(params)) return [];
  return (check.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`);
}

/** catalog:validate: the schema exists and compiles, the default shipped in files/ satisfies it. */
export function paramsErrors(componentDir: string): string[] {
  const decl = readParamsDecl(componentDir);
  if (!decl) return [];
  const schemaPath = join(componentDir, decl.schema);
  if (!existsSync(schemaPath)) return [`params.schema ${decl.schema} does not exist`];
  let schema: Record<string, unknown>;
  try {
    schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
    new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  } catch (err) {
    return [`params.schema ${decl.schema} is not a valid JSON Schema: ${(err as Error).message}`];
  }
  const defaults = join(componentDir, "files", decl.file);
  if (!existsSync(defaults)) return [`params.file ${decl.file} is not shipped in files/ (default)`];
  const errors = validateParams(
    componentDir,
    JSON.parse(readFileSync(defaults, "utf8")) as unknown,
  );
  return errors.map((e) => `default ${decl.file} does not satisfy ${decl.schema}: ${e}`);
}
