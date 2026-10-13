import type { ReactNode } from "react";

/**
 * What the delivery gate runs on every package (packages/verifier: secrets, static, dependencies, licenses, then
 * lint, typecheck, unit, build and E2E in the isolated sandbox) and what the AI Safety Pack adds to every app that
 * uses AI (catalog/components/security.ai-safety.turbineh). Copy only: no figures, no tool or vendor names.
 */
type Area = "Cybersecurity" | "AI safety" | "Code quality";

const Icon = ({ children }: { children: ReactNode }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-5 w-5"
  >
    {children}
  </svg>
);

const CHECKS: { area: Area; title: string; line: string; icon: ReactNode }[] = [
  {
    area: "Cybersecurity",
    title: "No leaked secrets",
    line: "The code and its git history are scanned; a secret-shaped value blocks delivery.",
    icon: (
      <Icon>
        <circle cx="8" cy="15" r="4" />
        <path d="M10.8 12.2 20 3M16 7l3 3M14 9l2 2" />
      </Icon>
    ),
  },
  {
    area: "Cybersecurity",
    title: "Security rules",
    line: "Static rules for injection, server actions without authorisation, XSS and open redirects.",
    icon: (
      <Icon>
        <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </Icon>
    ),
  },
  {
    area: "Cybersecurity",
    title: "Safe dependencies",
    line: "Every dependency checked for known vulnerabilities and against the licence policy.",
    icon: (
      <Icon>
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
        <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
      </Icon>
    ),
  },
  {
    area: "AI safety",
    title: "AI Safety Pack",
    line: "Injection screening, input and rate limits, optional PII redaction; model calls go through the orchestrator.",
    icon: (
      <Icon>
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        <rect x="7" y="7" width="10" height="10" rx="2" />
        <path d="M10 12h4M12 10v4" />
      </Icon>
    ),
  },
  {
    area: "Code quality",
    title: "Tested in a sealed sandbox",
    line: "Lint, strict types, unit and E2E tests on a real database — isolated, without internet.",
    icon: (
      <Icon>
        <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />
        <path d="M7.5 15h9" />
      </Icon>
    ),
  },
];

const AREA_STYLE: Record<Area, string> = {
  Cybersecurity: "text-teal",
  "AI safety": "text-ice",
  "Code quality": "text-amber",
};

/** Home: the checks every package passes before it is labelled verified. */
export function PackageChecks() {
  return (
    <section aria-labelledby="checks-title" className="mt-16 border-t border-line pt-12">
      <p className="eyebrow">Verified before delivery</p>
      <h2 id="checks-title" className="display mt-2 text-2xl font-semibold text-cream">
        Checks every package passes
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Cybersecurity, AI safety and code quality, run by the gate on every package — never decided
        by a model.
      </p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {CHECKS.map((c) => (
          <li
            key={c.title}
            className="flex flex-col rounded-xl border border-line bg-panel/30 p-5 transition-colors hover:border-teal/60"
          >
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-navy-900/70 ${AREA_STYLE[c.area]}`}
            >
              {c.icon}
            </span>
            <p className={`eyebrow mt-4 ${AREA_STYLE[c.area]}`}>{c.area}</p>
            <h3 className="mt-1 font-semibold text-cream">{c.title}</h3>
            <p className="mt-1 text-sm text-muted">{c.line}</p>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted">
        AI safety applies to every app that uses AI. A check that does not pass is shown with its
        fix, and the package is never labelled verified.
      </p>
    </section>
  );
}
