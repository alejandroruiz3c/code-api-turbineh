import { jsonLd } from "./text";

/**
 * GEO (generative engine optimisation): structured, quotable facts for AI answer engines and search.
 * AI crawlers are allowed on public pages by default (change AI_CRAWLERS_ALLOWED to opt out).
 */
export const AI_CRAWLERS_ALLOWED = true;
export const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
];

export const faqJsonLd = (faq: readonly { q: string; a: string }[]) =>
  jsonLd({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  });

export const websiteJsonLd = (name: string, url: string, description: string) =>
  jsonLd({ "@context": "https://schema.org", "@type": "WebSite", name, url, description });

/** robots.txt rules: public pages open (also to AI crawlers unless opted out), private areas closed. */
export function robotsRules(disallow: string[]) {
  return [
    { userAgent: "*", allow: "/", disallow },
    AI_CRAWLERS_ALLOWED
      ? { userAgent: AI_CRAWLERS, allow: "/", disallow }
      : { userAgent: AI_CRAWLERS, disallow: "/" },
  ];
}

/** Plain-text line safe for llms.txt (no newlines, bounded). */
export const line = (s: string, max = 300) => s.replace(/\s+/g, " ").trim().slice(0, max);
