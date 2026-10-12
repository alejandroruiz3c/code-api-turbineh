import Mustache from "mustache";

/**
 * Renders a prompt template written by the app owner: values are inserted verbatim (no HTML escaping, which would
 * corrupt prompts) and never executed. Never let end users write templates. Missing values render as empty.
 */
export function renderPrompt(template: string, values: Record<string, unknown>): string {
  return Mustache.render(template, values, {}, { escape: (s: string) => s });
}

/** Same template engine for HTML output (values HTML-escaped). */
export function renderHtml(template: string, values: Record<string, unknown>): string {
  return Mustache.render(template, values);
}
