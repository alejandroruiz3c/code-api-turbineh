import { parse, stringify } from "yaml";

const MAX_YAML_LENGTH = 500_000;

/** Parses YAML with safe defaults: no custom tags, bounded size and alias expansion (no "billion laughs"). */
export function parseYaml(text: string): unknown {
  if (text.length > MAX_YAML_LENGTH) throw new Error("YAML is too large");
  return parse(text, { maxAliasCount: 50, customTags: [], prettyErrors: false });
}

export function toYaml(value: unknown): string {
  return stringify(value);
}
