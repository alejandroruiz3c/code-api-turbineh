import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeFaq, type BuildSpec } from "@turbineh/compiler";

type Site = NonNullable<BuildSpec["site"]>;

/** Deterministic copy when the model's site part is missing: honest, generic, built from the summary. */
export function fallbackSite(spec: BuildSpec): Site {
  return {
    tagline: spec.app_name,
    hero_subtitle: spec.summary.slice(0, 220),
    features: [
      { title: "Simple to use", text: "A clear interface that works on any device." },
      { title: "Secure by default", text: "Validated inputs, protected forms and safe defaults." },
      { title: "Built to grow", text: "Add pages and features as your business evolves." },
    ],
    steps: [
      { title: "Get in touch", text: "Tell us what you need." },
      { title: "We get to work", text: "We prepare everything for you." },
      { title: "Enjoy the result", text: "Use it from day one." },
    ],
    services: [
      { title: "Consulting", text: "We help you choose the right approach." },
      { title: "Delivery", text: "We build and deliver what you need." },
      { title: "Support", text: "We stay with you after launch." },
    ],
    about: spec.summary,
    faq: [
      { q: "How do I get started?", a: "Use the form on this page and we will get back to you." },
      { q: "Is my data safe?", a: "We only use your data to answer you and never share it." },
      {
        q: "How can I contact you?",
        a: "Use the contact form; we usually answer within a business day.",
      },
    ],
    cta: "Get started",
  };
}

/** Writes src/content/site.ts for recipes that render public-site copy (only if the template has the file). */
export function writeSiteContent(outDir: string, spec: BuildSpec): boolean {
  const path = join(outDir, "src/content/site.ts");
  if (!existsSync(path)) return false;
  const raw = spec.site ?? fallbackSite(spec);
  const site = { ...raw, faq: normalizeFaq(raw.faq) };
  writeFileSync(
    path,
    `// turbineh:generated\n/** Public-site copy (rendered as text). Edit freely: every page reads from here. */\nexport const SITE = ${JSON.stringify(site, null, 2)} as const;\n`,
  );
  return true;
}
