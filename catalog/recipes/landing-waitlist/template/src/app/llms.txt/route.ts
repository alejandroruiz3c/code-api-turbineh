import { SITE } from "@/content/site";
import { env } from "@/env";
import { line } from "@/lib/geo";

/** /llms.txt — a concise, factual summary of this site for AI assistants and answer engines. */
export function GET(): Response {
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const body = [
    "# __APP_NAME__",
    "",
    `> ${line(SITE.hero_subtitle)}`,
    "",
    "## What it is",
    ...SITE.features.map((f) => `- ${line(f.title, 80)}: ${line(f.text)}`),
    "",
    "## How it works",
    ...SITE.steps.map((s, i) => `${i + 1}. ${line(s.title, 80)}: ${line(s.text)}`),
    "",
    "## FAQ",
    ...SITE.faq.flatMap((f) => [`- Q: ${line(f.q, 160)}`, `  A: ${line(f.a, 500)}`]),
    "",
    "## Links",
    `- [Home and waitlist](${base}/)`,
  ].join("\n");
  return new Response(`${body}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
