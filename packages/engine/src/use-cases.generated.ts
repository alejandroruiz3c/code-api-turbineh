// turbineh:generated — pnpm --filter @turbineh/engine gen (from catalog/recipes). Do not edit by hand.
import type { UseCase } from "./types.js";

export const USE_CASES: UseCase[] = [
  {
    "id": "ai-agents",
    "name": "AI Agents",
    "description": "AI assistants with instructions and allowed tools, chat over a knowledge base of the team's documents, batch AI processing of records (classify, extract, summarise), usage and audit — every AI call through the TurbineH orchestrator with its AI Safety Pack",
    "extends": "saas-crud",
    "capabilities": [
      "data.pagination",
      "ops.rate-limit",
      "ai.orchestrator",
      "security.ai-safety"
    ],
    "requiredComponents": [
      "ai.orchestrator.turbineh",
      "security.ai-safety.turbineh"
    ],
    "sections": [
      "Assistants",
      "Knowledge",
      "AI processes",
      "AI usage",
      "AI audit"
    ],
    "keywords": [
      "ai",
      "agent",
      "agents",
      "assistant",
      "chatbot",
      "support agent",
      "knowledge base",
      "rag",
      "classification",
      "summarise",
      "summarize",
      "extraction",
      "inference",
      "llm"
    ]
  },
  {
    "id": "analytics-dashboard",
    "name": "Analytics Dashboard",
    "description": "Analytics dashboards for a team — import data from CSV or enter it, KPIs with period comparison, time series and breakdown charts, filters and export",
    "extends": "saas-crud",
    "capabilities": [
      "data.csv-import",
      "data.csv-export",
      "data.pagination"
    ],
    "requiredComponents": [],
    "sections": [
      "Analytics"
    ],
    "keywords": [
      "analytics",
      "dashboard",
      "kpi",
      "metrics",
      "charts",
      "reporting",
      "csv"
    ]
  },
  {
    "id": "bookings",
    "name": "Bookings",
    "description": "Bookings and appointments with weekly availability, conflict-free booking, a calendar and email confirmations",
    "extends": "saas-crud",
    "capabilities": [
      "email.transactional",
      "ops.rate-limit",
      "data.pagination"
    ],
    "requiredComponents": [],
    "sections": [
      "Bookings",
      "Calendar",
      "Availability"
    ],
    "keywords": [
      "booking",
      "bookings",
      "appointment",
      "reservation",
      "calendar",
      "schedule",
      "clinic",
      "salon",
      "availability"
    ]
  },
  {
    "id": "client-portal",
    "name": "Client Portal",
    "description": "Client portal where clients submit requests with file uploads and follow their status; staff review and update them",
    "extends": "saas-crud",
    "capabilities": [
      "ops.rate-limit",
      "data.pagination"
    ],
    "requiredComponents": [],
    "sections": [
      "Requests"
    ],
    "keywords": [
      "portal",
      "client portal",
      "customer portal",
      "documents",
      "invoices",
      "clients",
      "agency"
    ]
  },
  {
    "id": "corporate-site",
    "name": "Corporate Site",
    "description": "Corporate website with home, services, about, blog with RSS, contact form and an admin panel to edit content, posts and messages",
    "extends": "saas-crud",
    "capabilities": [
      "email.transactional",
      "ops.rate-limit",
      "data.pagination"
    ],
    "requiredComponents": [],
    "sections": [
      "Website texts",
      "Blog posts",
      "Messages"
    ],
    "keywords": [
      "corporate",
      "company website",
      "website",
      "site",
      "cms",
      "blog",
      "seo",
      "brochure"
    ]
  },
  {
    "id": "internal-tool",
    "name": "Internal Tool",
    "description": "Internal back-office tool with tables, search, CSV import and export",
    "extends": "saas-crud",
    "capabilities": [
      "data.csv-import",
      "data.csv-export",
      "data.pagination"
    ],
    "requiredComponents": [],
    "sections": [],
    "keywords": [
      "internal",
      "tool",
      "backoffice",
      "back office",
      "operations",
      "staff",
      "admin panel",
      "inventory"
    ]
  },
  {
    "id": "landing-waitlist",
    "name": "Landing Waitlist",
    "description": "Public landing page with a waitlist form, confirmation email and an admin panel",
    "extends": "saas-crud",
    "capabilities": [
      "email.transactional",
      "ops.rate-limit",
      "data.pagination"
    ],
    "requiredComponents": [],
    "sections": [
      "Waitlist"
    ],
    "keywords": [
      "landing",
      "waitlist",
      "launch",
      "signup",
      "lead",
      "marketing page",
      "pre-launch"
    ]
  },
  {
    "id": "projects",
    "name": "Projects",
    "description": "Project and task management for teams with kanban boards, assignees, priorities, due dates, comments and a personal task list",
    "extends": "saas-crud",
    "capabilities": [
      "data.pagination",
      "ops.rate-limit"
    ],
    "requiredComponents": [],
    "sections": [
      "Projects",
      "My tasks"
    ],
    "keywords": [
      "projects",
      "tasks",
      "kanban",
      "board",
      "project management",
      "team",
      "todo"
    ]
  },
  {
    "id": "saas-crud",
    "name": "Saas Crud",
    "description": "Multi-tenant SaaS with sign-in, workspaces, roles and CRUD screens",
    "extends": null,
    "capabilities": [
      "auth.session",
      "authz.organizations",
      "authz.roles",
      "data.orm",
      "data.validation",
      "data.pagination",
      "ui.table",
      "ui.form",
      "ui.layout",
      "security.headers",
      "ops.rate-limit"
    ],
    "requiredComponents": [],
    "sections": [],
    "keywords": [
      "saas",
      "crud",
      "admin",
      "records",
      "multi-tenant",
      "workspace",
      "management",
      "app",
      "manage"
    ]
  },
  {
    "id": "storefront",
    "name": "Storefront",
    "description": "Online shop with product catalog and images, product variants (size, colour…) with own SKU, price and stock, cart, discount codes (percent or fixed amount, minimum order, usage limit, expiry), several currencies with fixed prices per currency, shipping options by country and currency, taxes by country or automatic Stripe Tax, Stripe Checkout payments, orders and stock, and an admin panel",
    "extends": "saas-crud",
    "capabilities": [
      "email.transactional",
      "ops.rate-limit",
      "data.pagination"
    ],
    "requiredComponents": [],
    "sections": [
      "Products",
      "Shipping & taxes",
      "Coupons",
      "Orders"
    ],
    "keywords": [
      "ecommerce",
      "e-commerce",
      "shop",
      "store",
      "checkout",
      "cart",
      "products",
      "payments",
      "stripe",
      "orders"
    ]
  },
  {
    "id": "tracker",
    "name": "Tracker",
    "description": "Personal trackers for habits, health, money or any daily quantity — goals, quick logging, streaks, 30-day history and weekly totals",
    "extends": "saas-crud",
    "capabilities": [
      "data.pagination",
      "ops.rate-limit"
    ],
    "requiredComponents": [],
    "sections": [
      "My trackers"
    ],
    "keywords": [
      "tracker",
      "habit",
      "habits",
      "goals",
      "streak",
      "log",
      "fitness"
    ]
  }
];
