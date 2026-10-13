import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

/**
 * Component guides (turbineh.guide/v0.1, ADR-0033): what a component does, when to use it and when not, trade-offs,
 * configuration, interfaces, extension points, compatibility, security, guarantees linked to tests, limits, a minimal
 * example, keywords and synonyms. Optional per component (`guide.yaml`, plus `guide.<part>.yaml` for sub-parts).
 * Read by the decider (keywords in the candidate card), rendered into apps as docs/components/*.md for coding agents.
 */
export interface ComponentGuide {
  schema: "turbineh.guide/v0.1";
  component: string;
  part?: string;
  title: string;
  summary: string;
  keywords: string[];
  synonyms?: Record<string, string[]>;
  use_cases: string[];
  use_when: string[];
  avoid_when: string[];
  tradeoffs: { choice: string; gain: string; cost: string }[];
  config: { name: string; default?: string; description: string }[];
  interfaces: { name: string; signature: string; where?: string }[];
  extension_points: { what: string; where: string; how: string }[];
  compatibility: Record<string, unknown>;
  security: string[];
  guarantees: { claim: string; test: string }[];
  limits: string[];
  example: string;
  /**
   * Parameters from the request (ADR-0040), for components that declare `params` in component.yaml: the app file,
   * its JSON Schema and each field in words, so a compiler (or a person) can write them from a spec.
   */
  params?: {
    file: string;
    schema: string;
    fields: { name: string; description: string; default?: string }[];
    example?: string;
  };
}

const REQUIRED: (keyof ComponentGuide)[] = [
  "title",
  "summary",
  "keywords",
  "use_cases",
  "use_when",
  "avoid_when",
  "tradeoffs",
  "config",
  "interfaces",
  "extension_points",
  "compatibility",
  "security",
  "guarantees",
  "limits",
  "example",
];

/** Directories whose files a component ships into apps: files/, files-ai/, files-recipe/<recipe>/, files-with/<id>/. */
export function shippedDirs(componentDir: string): string[] {
  const nested = (d: string) =>
    existsSync(join(componentDir, d))
      ? readdirSync(join(componentDir, d)).map((x) => join(componentDir, d, x))
      : [];
  return [
    join(componentDir, "files"),
    join(componentDir, "files-ai"),
    ...nested("files-recipe"),
    ...nested("files-with"),
  ];
}

/** Guide files of one component directory (guide.yaml, guide.<part>.yaml). */
export function guideFiles(componentDir: string): string[] {
  if (!existsSync(componentDir)) return [];
  return readdirSync(componentDir)
    .filter((f) => /^guide(\.[a-z0-9-]+)?\.yaml$/.test(f))
    .sort()
    .map((f) => join(componentDir, f));
}

export function readGuides(componentDir: string): ComponentGuide[] {
  return guideFiles(componentDir).map((f) => parse(readFileSync(f, "utf8")) as ComponentGuide);
}

/**
 * Structural checks plus "guarantees are linked to real tests": the test file must ship with the component
 * (files/ or files-ai/) and, when a title follows "›", that title must appear in the file.
 */
export function guideErrors(componentDir: string, id: string): string[] {
  const errors: string[] = [];
  for (const file of guideFiles(componentDir)) {
    const name = file.slice(componentDir.length + 1);
    let g: Partial<ComponentGuide>;
    try {
      g = parse(readFileSync(file, "utf8")) as Partial<ComponentGuide>;
    } catch {
      errors.push(`${name}: not valid YAML`);
      continue;
    }
    if (g.schema !== "turbineh.guide/v0.1")
      errors.push(`${name}: schema must be turbineh.guide/v0.1`);
    if (g.component !== id) errors.push(`${name}: component must be "${id}"`);
    for (const k of REQUIRED) {
      const v = g[k];
      if (v === undefined || v === null || (Array.isArray(v) && v.length === 0) || v === "")
        errors.push(`${name}: "${k}" is required`);
    }
    for (const e of g.extension_points ?? [])
      if (!e?.what || !e.where || !e.how)
        errors.push(`${name}: extension_points need what, where, how`);
    const manifest = join(componentDir, "component.yaml");
    const declared = existsSync(manifest)
      ? (parse(readFileSync(manifest, "utf8")) as { params?: { file: string; schema: string } })
          .params
      : undefined;
    if (declared && !g.params?.fields?.length)
      errors.push(
        `${name}: "params" (file, schema, fields) is required for a parameterised component`,
      );
    if (
      declared &&
      g.params &&
      (g.params.file !== declared.file || g.params.schema !== declared.schema)
    )
      errors.push(
        `${name}: params.file/schema must match component.yaml (${declared.file}, ${declared.schema})`,
      );
    for (const t of g.guarantees ?? []) {
      const [path, title] = String(t?.test ?? "").split(" › ");
      const filePath = path?.trim() ?? "";
      // Shipped with the component (files/, files-ai/ or its contract test at the root) or, for components vendored
      // in the recipe templates, "recipe template <recipe>/<path>".
      const tpl = /^recipe template ([a-z0-9-]+)\/(.+)$/.exec(filePath);
      const shipped = (
        tpl
          ? [join(componentDir, "../../recipes", tpl[1] ?? "", "template", tpl[2] ?? "")]
          : [...shippedDirs(componentDir), "."].map((d) =>
              join(d === "." ? componentDir : d, filePath),
            )
      ).find((p) => existsSync(p));
      if (!filePath || !shipped) {
        errors.push(
          `${name}: guarantee "${t?.claim}" points to ${filePath || "no test"}, not shipped with the component`,
        );
        continue;
      }
      if (title && !readFileSync(shipped, "utf8").includes(title.trim()))
        errors.push(`${name}: guarantee test "${title.trim()}" not found in ${filePath}`);
    }
  }
  return errors;
}

const list = (xs: readonly string[] | undefined) => (xs ?? []).map((x) => `- ${x}`).join("\n");

/** Markdown for apps (docs/components/<id>.md): the same content, readable by people and coding agents. */
export function guideMarkdown(g: ComponentGuide): string {
  const cell = (s: string | undefined) =>
    String(s ?? "")
      .replace(/\|/g, "\\|")
      .replace(/\n/g, " ");
  return `<!-- turbineh:generated from catalog guide ${g.component}${g.part ? ` (${g.part})` : ""} -->
# ${g.title}

${g.summary}

**Keywords:** ${g.keywords.join(", ")}
${
  g.synonyms
    ? `\n**Also called:** ${Object.entries(g.synonyms)
        .map(([k, v]) => `${k} = ${v.join(", ")}`)
        .join("; ")}\n`
    : ""
}
## Use cases

${list(g.use_cases)}

## Use it when

${list(g.use_when)}

## Do not use it when

${list(g.avoid_when)}

## Trade-offs

| Choice | Gain | Cost |
| --- | --- | --- |
${g.tradeoffs.map((t) => `| ${cell(t.choice)} | ${cell(t.gain)} | ${cell(t.cost)} |`).join("\n")}

## Configuration

| Name | Default | Description |
| --- | --- | --- |
${g.config.map((c) => `| \`${cell(c.name)}\` | ${cell(c.default) || "—"} | ${cell(c.description)} |`).join("\n")}

## Interfaces

${g.interfaces.map((i) => `- **${i.name}** — \`${i.signature}\`${i.where ? ` (\`${i.where}\`)` : ""}`).join("\n")}

## Extension points

${g.extension_points.map((e) => `- **${e.what}** — \`${e.where}\`: ${e.how}`).join("\n")}

## Compatibility

${Object.entries(g.compatibility)
  .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
  .join("\n")}

## Security

${list(g.security)}

## Guarantees (each proved by a test in this repository)

${g.guarantees.map((t) => `- ${t.claim} — \`${t.test}\``).join("\n")}

## Known limits

${list(g.limits)}

## Minimal example

\`\`\`ts
${g.example.trim()}
\`\`\`
${
  g.params
    ? `
## Parameters from the request

Written by TurbineH to \`${g.params.file}\` (JSON Schema: \`${g.params.schema}\` in the catalogue component); edit the file to
change them, it is validated at start-up.

| Field | Default | Description |
| --- | --- | --- |
${g.params.fields.map((f) => `| \`${cell(f.name)}\` | ${cell(f.default) || "—"} | ${cell(f.description)} |`).join("\n")}
${g.params.example ? `\n\`\`\`json\n${g.params.example.trim()}\n\`\`\`\n` : ""}`
    : ""
}`;
}
