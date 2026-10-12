import type { CapabilitySummary, Requirement } from "@turbineh/shared";

/**
 * Complete use cases available today (catalog/recipes). Product copy for Discover; the engine search returns the
 * same shape (and real component counts). Requirements are what the flow needs before it runs in a project.
 * No figures here that do not come from bench/: `components: 0` means "not counted here".
 */
const base = ["Next.js 16", "TypeScript", "PostgreSQL"];
const env = (name: string, why: string): Requirement => ({
  kind: "env",
  name,
  why,
  satisfied: false,
});
const db = env("DATABASE_URL", "PostgreSQL connection for your data");
const auth = env("BETTER_AUTH_SECRET", "Signs sessions (generated for you when we deploy)");

export interface UseCase extends CapabilitySummary {
  keywords: string[];
}

export const USE_CASES: UseCase[] = [
  {
    id: "ai-agents",
    kind: "use_case",
    name: "AI agents & inference processes",
    summary:
      "Assistants with instructions and allowed tools, chat over your documents with sources, batch classify, extract or summarise — every AI call through the TurbineH orchestrator, with AI safety built in.",
    components: 0,
    stacks: base,
    requirements: [
      db,
      auth,
      env("TURBINEH_AI_TOKEN", "Your app's access to TurbineH AI — no model keys needed"),
    ],
    example:
      "A support assistant that answers from a help-centre document and refuses a prompt injection",
    keywords: [
      "ai",
      "agent",
      "assistant",
      "chatbot",
      "support",
      "rag",
      "knowledge",
      "classify",
      "inference",
      "llm",
      "summarise",
      "summarize",
    ],
  },
  {
    id: "storefront",
    kind: "use_case",
    name: "E-commerce store",
    summary:
      "Catalog with variants, cart, discount codes, several currencies, shipping and taxes by country, card payments and order emails.",
    components: 0,
    stacks: base,
    requirements: [
      db,
      auth,
      env("STRIPE_SECRET_KEY", "Card payments"),
      env("STRIPE_WEBHOOK_SECRET", "Confirms paid orders"),
    ],
    example: "A sock shop with sizes, EUR + USD and a 10% code, paid through a test checkout",
    keywords: [
      "shop",
      "store",
      "ecommerce",
      "e-commerce",
      "cart",
      "checkout",
      "payments",
      "products",
      "coupons",
    ],
  },
  {
    id: "bookings",
    kind: "use_case",
    name: "Bookings & appointments",
    summary: "Weekly availability, conflict-free booking, calendar and email confirmations.",
    components: 0,
    stacks: base,
    requirements: [db, auth],
    example: "A physiotherapy clinic taking 45-minute appointments without double bookings",
    keywords: [
      "booking",
      "bookings",
      "reservation",
      "appointment",
      "calendar",
      "schedule",
      "clinic",
    ],
  },
  {
    id: "saas-crud",
    kind: "use_case",
    name: "Multi-tenant SaaS",
    summary:
      "Sign-in, workspaces, roles and data screens with create, edit, search, import and export.",
    components: 0,
    stacks: base,
    requirements: [db, auth],
    example: "A language-school SaaS with students and courses per workspace",
    keywords: ["saas", "crud", "workspace", "tenant", "roles", "admin", "subscription"],
  },
  {
    id: "internal-tool",
    kind: "use_case",
    name: "Internal back-office tool",
    summary: "Tables, search, CSV import and export for a team's operations.",
    components: 0,
    stacks: base,
    requirements: [db, auth],
    example: "A gym's members and membership plans with staff login",
    keywords: ["internal", "back-office", "backoffice", "operations", "table", "csv"],
  },
  {
    id: "client-portal",
    kind: "use_case",
    name: "Client portal",
    summary:
      "Clients submit requests with file uploads and follow their status; staff review and update them.",
    components: 0,
    stacks: base,
    requirements: [db, auth],
    example: "An agency portal where clients upload briefs and track progress",
    keywords: ["portal", "client", "requests", "tickets", "uploads"],
  },
  {
    id: "corporate-site",
    kind: "use_case",
    name: "Corporate website",
    summary:
      "Home, services, about, blog with RSS, contact form and an admin panel — optimised for AI search engines.",
    components: 0,
    stacks: base,
    requirements: [db, auth],
    example: "An architecture studio's site with a blog and a contact form",
    keywords: ["website", "corporate", "blog", "cms", "seo", "contact"],
  },
  {
    id: "landing-waitlist",
    kind: "use_case",
    name: "Landing page with waitlist",
    summary: "Public landing, waitlist form, confirmation email and an admin panel.",
    components: 0,
    stacks: base,
    requirements: [db, auth],
    example: "A product launch page collecting sign-ups",
    keywords: ["landing", "waitlist", "launch", "signup", "marketing"],
  },
  {
    id: "projects",
    kind: "use_case",
    name: "Projects & tasks",
    summary: "Kanban boards, assignees, priorities, due dates, comments and a personal task list.",
    components: 0,
    stacks: base,
    requirements: [db, auth],
    example: "A product team's board with priorities and due dates",
    keywords: ["project", "task", "kanban", "todo", "team"],
  },
  {
    id: "analytics-dashboard",
    kind: "use_case",
    name: "Analytics dashboard",
    summary: "Import data from CSV, KPIs with period comparison, charts, filters and export.",
    components: 0,
    stacks: base,
    requirements: [db, auth],
    example: "Monthly sales KPIs from a CSV with period comparison",
    keywords: ["analytics", "dashboard", "kpi", "charts", "reports", "metrics"],
  },
  {
    id: "tracker",
    kind: "use_case",
    name: "Trackers",
    summary:
      "Habits, health, money or any daily quantity — goals, quick logging, streaks and history.",
    components: 0,
    stacks: base,
    requirements: [db, auth],
    example: "A habit tracker with streaks and weekly totals",
    keywords: ["tracker", "habit", "health", "streak", "log"],
  },
];

const words = (q: string) =>
  q
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length > 1);

/** Simple relevance: words of the need found in the use case keywords, name and summary. */
export function matchUseCases(q: string): UseCase[] {
  const ws = words(q);
  if (ws.length === 0) return USE_CASES;
  return USE_CASES.map((u) => {
    const hay = `${u.keywords.join(" ")} ${u.name} ${u.summary}`.toLowerCase();
    return { u, score: ws.filter((w) => hay.includes(w)).length };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.u);
}
