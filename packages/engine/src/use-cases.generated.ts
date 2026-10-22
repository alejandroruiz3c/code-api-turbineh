// turbineh:generated — pnpm --filter @turbineh/engine gen (from catalog/recipes and catalog/components). Do not edit by hand.
import type { CatalogTotals, UseCase } from "./types.js";

export const USE_CASES: UseCase[] = [
  {
    "id": "ai-agents",
    "name": "AI agents",
    "description": "AI assistants with instructions and allowed tools (escalate to a human by email), chat over a knowledge base of the team's documents, batch AI processing of records (classify, extract, summarise), usage and audit — every AI call through the TurbineH orchestrator with its AI Safety Pack",
    "tagline": "AI assistants that chat over a knowledge base, with allowed tools and escalation to a human.",
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
    ],
    "functions": [
      "AI assistants with instructions",
      "Allowed tools",
      "Knowledge base",
      "Chat over a knowledge base",
      "Batch classification",
      "Batch extraction",
      "Batch summaries",
      "AI usage and audit",
      "Prompt injections refused",
      "Escalate to a human",
      "Every AI call through the TurbineH orchestrator"
    ],
    "addOns": [
      {
        "id": "ai.mail-triage.turbineh",
        "name": "Mailbox triage",
        "tagline": "Every new email classified with a category and a priority; invoices recorded in a finance ledger.",
        "functions": [
          "Category and priority for every email",
          "Daily digest",
          "Invoices, receipts and payments extracted",
          "Excel export",
          "Totals per type and currency",
          "Injection attempts flagged, never obeyed",
          "Correct a ledger entry's type",
          "Owner-only pages"
        ]
      },
      {
        "id": "ai.recommendations.turbineh",
        "name": "Recommendation assistant",
        "tagline": "Recommends only verified records from your own catalogue and books viewings.",
        "functions": [
          "Records budget, location and needs",
          "Recommends only verified records",
          "Answers with verified facts",
          "Compares 2–4 records side by side",
          "Never invents a record",
          "Staff manage and verify the catalogue",
          "Staff-only catalogue management",
          "Books viewings on real free times"
        ]
      },
      {
        "id": "domain.bookings.turbineh",
        "name": "Bookings",
        "tagline": "A public booking page, a staff calendar and a notice policy.",
        "functions": [
          "Public booking page",
          "Confirmation email with a cancel link",
          "Cancel link with a notice policy",
          "No double bookings",
          "Staff calendar per team member",
          "Time off",
          "Move and cancel with customer emails",
          "Real free times",
          "Staff-only pages",
          "Booking tools for AI assistants",
          "Find bookings by email"
        ]
      },
      {
        "id": "domain.reminders.turbineh",
        "name": "Appointment reminders",
        "tagline": "Reminders before each appointment by email, SMS or WhatsApp.",
        "functions": [
          "Email reminders",
          "SMS reminders",
          "WhatsApp reminders",
          "Cancelled appointments are not reminded",
          "Reminder status for staff"
        ]
      },
      {
        "id": "email.inbox.imapflow",
        "name": "IMAP inbox",
        "tagline": "Reads one mailbox read-only and incrementally.",
        "functions": [
          "Read-only mailbox access",
          "Incremental sync",
          "Credentials only from environment variables",
          "Each message parsed"
        ]
      },
      {
        "id": "messaging.sms.twilio",
        "name": "SMS",
        "tagline": "Text messages with Twilio, sent only to numbers that agreed.",
        "functions": [
          "Twilio Messages API",
          "Only with consent; STOP respected",
          "Retried with exponential backoff",
          "Logged mode without credentials",
          "Phone numbers validated (E.164)"
        ]
      },
      {
        "id": "messaging.whatsapp.meta",
        "name": "WhatsApp",
        "tagline": "WhatsApp template messages with Meta's Cloud API, only to people who opted in.",
        "functions": [
          "WhatsApp Business Cloud API",
          "Sent only to people who opted in",
          "Retried with exponential backoff",
          "Signed delivery webhooks"
        ]
      },
      {
        "id": "social.connections.turbineh",
        "name": "Social accounts",
        "tagline": "Connect LinkedIn, Facebook, Instagram and X accounts with OAuth 2.0.",
        "functions": [
          "OAuth 2.0 account connection",
          "Encrypted tokens",
          "Tokens revoked on disconnect"
        ]
      },
      {
        "id": "social.metrics.turbineh",
        "name": "Social metrics",
        "tagline": "Likes, comments, shares and impressions of your published posts.",
        "functions": [
          "Likes, comments, shares and impressions"
        ]
      },
      {
        "id": "social.publish.turbineh",
        "name": "Social publishing",
        "tagline": "Schedule, approve and publish posts to each network.",
        "functions": [
          "Per-network format rules",
          "Approval and scheduling",
          "Retries with exponential backoff",
          "Append-only publication log",
          "Content calendar"
        ]
      }
    ]
  },
  {
    "id": "analytics-dashboard",
    "name": "Analytics dashboard",
    "description": "Analytics dashboards for a team — import data from CSV or enter it, KPIs with period comparison, time series and breakdown charts, filters and export",
    "tagline": "Team dashboards from CSV or entered data, with KPIs and charts.",
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
    ],
    "functions": [
      "CSV import",
      "Manual data entry",
      "KPIs with period comparison",
      "Time series charts",
      "Breakdown charts",
      "Filters and export"
    ],
    "addOns": [
      {
        "id": "domain.membership-access.turbineh",
        "name": "Team access",
        "tagline": "Invitations by email, roles and per-record access.",
        "functions": [
          "Invitations",
          "Roles",
          "Per-record scope"
        ]
      }
    ]
  },
  {
    "id": "bookings",
    "name": "Bookings and appointments",
    "description": "Online booking site for an appointment business — public booking page (service, team member or any, real free times, no account), confirmation email with a cancel link and a notice policy, no double bookings, staff calendar per team member (day and week), time off, move and cancel with customer emails",
    "tagline": "An online booking site for an appointment business.",
    "extends": "saas-crud",
    "capabilities": [
      "email.transactional",
      "ops.rate-limit",
      "data.pagination"
    ],
    "requiredComponents": [
      "domain.bookings.turbineh"
    ],
    "sections": [],
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
    ],
    "functions": [
      "Public booking page",
      "Confirmation email with a cancel link",
      "Cancel link with a notice policy",
      "No double bookings",
      "Staff calendar per team member",
      "Time off",
      "Move and cancel with customer emails",
      "Real free times",
      "Staff-only pages"
    ],
    "addOns": [
      {
        "id": "domain.reminders.turbineh",
        "name": "Appointment reminders",
        "tagline": "Reminders before each appointment by email, SMS or WhatsApp.",
        "functions": [
          "Email reminders",
          "SMS reminders",
          "WhatsApp reminders",
          "Cancelled appointments are not reminded",
          "Reminder status for staff"
        ]
      },
      {
        "id": "messaging.sms.twilio",
        "name": "SMS",
        "tagline": "Text messages with Twilio, sent only to numbers that agreed.",
        "functions": [
          "Twilio Messages API",
          "Only with consent; STOP respected",
          "Retried with exponential backoff",
          "Logged mode without credentials",
          "Phone numbers validated (E.164)"
        ]
      },
      {
        "id": "messaging.whatsapp.meta",
        "name": "WhatsApp",
        "tagline": "WhatsApp template messages with Meta's Cloud API, only to people who opted in.",
        "functions": [
          "WhatsApp Business Cloud API",
          "Sent only to people who opted in",
          "Retried with exponential backoff",
          "Signed delivery webhooks"
        ]
      },
      {
        "id": "payments.booking-deposit.turbineh",
        "name": "Pay to book",
        "tagline": "A card deposit or the full price when booking, with Stripe Checkout.",
        "functions": [
          "Card payment at booking time"
        ]
      }
    ]
  },
  {
    "id": "client-portal",
    "name": "Client portal",
    "description": "Client portal where clients submit requests with file uploads and follow their status; staff review and update them",
    "tagline": "Clients submit requests with file uploads and follow their status.",
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
    ],
    "functions": [
      "Submit requests",
      "File uploads",
      "Clients follow their status",
      "Staff review and update",
      "Unsafe files rejected"
    ],
    "addOns": [
      {
        "id": "domain.audit-log.turbineh",
        "name": "Audit log",
        "tagline": "Every change recorded with who and when, append-only.",
        "functions": [
          "Audit log"
        ]
      },
      {
        "id": "domain.membership-access.turbineh",
        "name": "Team access",
        "tagline": "Invitations by email, roles and per-record access.",
        "functions": [
          "Invitations",
          "Roles",
          "Per-record scope"
        ]
      },
      {
        "id": "domain.workflow.turbineh",
        "name": "Status workflows",
        "tagline": "States, allowed transitions by role and an immutable history.",
        "functions": [
          "Status workflows"
        ]
      }
    ]
  },
  {
    "id": "corporate-site",
    "name": "Corporate website",
    "description": "Corporate website with home, services, about, blog with RSS, contact form and an admin panel to edit content, posts and messages",
    "tagline": "A corporate website with a blog, a contact form and an admin panel to edit content.",
    "extends": "saas-crud",
    "capabilities": [
      "email.transactional",
      "ops.rate-limit",
      "data.pagination"
    ],
    "requiredComponents": [
      "content.blog.turbineh"
    ],
    "sections": [
      "Website texts",
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
    ],
    "functions": [
      "Home, services, about and contact pages",
      "Blog with RSS",
      "Contact form",
      "Admin panel to edit content",
      "Contact messages in the dashboard",
      "Ready for search and AI answer engines",
      "Staff-only editor",
      "Markdown posts with frontmatter",
      "Paginated list",
      "Post page with reading time",
      "Structured data",
      "Tags",
      "Author pages",
      "Post search",
      "RSS",
      "Sitemap",
      "Drafts and published states"
    ],
    "addOns": []
  },
  {
    "id": "internal-tool",
    "name": "Internal back-office tool",
    "description": "Internal back-office tool with tables, search, CSV import and export",
    "tagline": "An internal back-office tool with tables, search and CSV import and export.",
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
    ],
    "functions": [
      "Tables",
      "Search",
      "CSV import and export"
    ],
    "addOns": [
      {
        "id": "domain.audit-log.turbineh",
        "name": "Audit log",
        "tagline": "Every change recorded with who and when, append-only.",
        "functions": [
          "Audit log"
        ]
      },
      {
        "id": "domain.membership-access.turbineh",
        "name": "Team access",
        "tagline": "Invitations by email, roles and per-record access.",
        "functions": [
          "Invitations",
          "Roles",
          "Per-record scope"
        ]
      },
      {
        "id": "domain.workflow.turbineh",
        "name": "Status workflows",
        "tagline": "States, allowed transitions by role and an immutable history.",
        "functions": [
          "Status workflows"
        ]
      }
    ]
  },
  {
    "id": "landing-waitlist",
    "name": "Landing page with waitlist",
    "description": "Public landing page with a waitlist form, confirmation email and an admin panel",
    "tagline": "A public landing page with a waitlist form and a confirmation email.",
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
    ],
    "functions": [
      "Waitlist form",
      "Public landing page",
      "Confirmation email",
      "Admin panel with sign-ups"
    ],
    "addOns": [
      {
        "id": "content.blog.turbineh",
        "name": "Blog",
        "tagline": "A Markdown blog with drafts, authors, tags, RSS and a sitemap.",
        "functions": [
          "Staff-only editor",
          "Markdown posts with frontmatter",
          "Paginated list",
          "Post page with reading time",
          "Structured data",
          "Tags",
          "Author pages",
          "Post search",
          "RSS",
          "Sitemap",
          "Drafts and published states"
        ]
      }
    ]
  },
  {
    "id": "projects",
    "name": "Projects and tasks",
    "description": "Project and task management for teams with kanban boards, assignees, priorities, due dates, comments, a personal task list, editing and deleting projects and tasks, and archiving with restore",
    "tagline": "Project and task management for teams on kanban boards.",
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
    ],
    "functions": [
      "Kanban boards",
      "Assignees",
      "Priorities",
      "Due dates",
      "Comments",
      "Personal task list",
      "Projects and tasks",
      "Edit projects and tasks",
      "Delete projects and tasks",
      "Archive and restore"
    ],
    "addOns": [
      {
        "id": "domain.audit-log.turbineh",
        "name": "Audit log",
        "tagline": "Every change recorded with who and when, append-only.",
        "functions": [
          "Audit log"
        ]
      },
      {
        "id": "domain.membership-access.turbineh",
        "name": "Team access",
        "tagline": "Invitations by email, roles and per-record access.",
        "functions": [
          "Invitations",
          "Roles",
          "Per-record scope"
        ]
      },
      {
        "id": "domain.workflow.turbineh",
        "name": "Status workflows",
        "tagline": "States, allowed transitions by role and an immutable history.",
        "functions": [
          "Status workflows"
        ]
      }
    ]
  },
  {
    "id": "saas-crud",
    "name": "Multi-tenant SaaS",
    "description": "Multi-tenant SaaS with sign-in, workspaces, roles and CRUD screens",
    "tagline": "A multi-tenant SaaS with sign-in, workspaces, roles and CRUD screens.",
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
    ],
    "functions": [
      "Sign-in",
      "Workspaces",
      "Roles",
      "Create, list, edit and delete records",
      "CSV import and export",
      "Search",
      "Tag filter",
      "Sort",
      "Tenant isolation",
      "Switch between organizations",
      "Account profile"
    ],
    "addOns": [
      {
        "id": "content.blog.turbineh",
        "name": "Blog",
        "tagline": "A Markdown blog with drafts, authors, tags, RSS and a sitemap.",
        "functions": [
          "Staff-only editor",
          "Markdown posts with frontmatter",
          "Paginated list",
          "Post page with reading time",
          "Structured data",
          "Tags",
          "Author pages",
          "Post search",
          "RSS",
          "Sitemap",
          "Drafts and published states"
        ]
      },
      {
        "id": "domain.audit-log.turbineh",
        "name": "Audit log",
        "tagline": "Every change recorded with who and when, append-only.",
        "functions": [
          "Audit log"
        ]
      },
      {
        "id": "domain.matching.turbineh",
        "name": "Opportunity matching",
        "tagline": "Opportunities matched to each organization's profile, with the why of every match.",
        "functions": [
          "Organization profile",
          "Records with search and filters",
          "Detail page with why it matches",
          "Deterministic matching",
          "Relevance feedback",
          "Strict organization isolation"
        ]
      },
      {
        "id": "domain.membership-access.turbineh",
        "name": "Team access",
        "tagline": "Invitations by email, roles and per-record access.",
        "functions": [
          "Invitations",
          "Roles",
          "Per-record scope"
        ]
      },
      {
        "id": "domain.workflow.turbineh",
        "name": "Status workflows",
        "tagline": "States, allowed transitions by role and an immutable history.",
        "functions": [
          "Status workflows"
        ]
      },
      {
        "id": "media.screen-recording.turbineh",
        "name": "Screen recording",
        "tagline": "Loom-style screen and camera videos with share links.",
        "functions": [
          "Screen and camera recording",
          "Recording layouts",
          "Up to 4K",
          "Video player",
          "Share links",
          "Private storage",
          "MP4 or WebM only"
        ]
      },
      {
        "id": "messaging.sms.twilio",
        "name": "SMS",
        "tagline": "Text messages with Twilio, sent only to numbers that agreed.",
        "functions": [
          "Twilio Messages API",
          "Only with consent; STOP respected",
          "Retried with exponential backoff",
          "Logged mode without credentials",
          "Phone numbers validated (E.164)"
        ]
      },
      {
        "id": "messaging.whatsapp.meta",
        "name": "WhatsApp",
        "tagline": "WhatsApp template messages with Meta's Cloud API, only to people who opted in.",
        "functions": [
          "WhatsApp Business Cloud API",
          "Sent only to people who opted in",
          "Retried with exponential backoff",
          "Signed delivery webhooks"
        ]
      },
      {
        "id": "social.connections.turbineh",
        "name": "Social accounts",
        "tagline": "Connect LinkedIn, Facebook, Instagram and X accounts with OAuth 2.0.",
        "functions": [
          "OAuth 2.0 account connection",
          "Encrypted tokens",
          "Tokens revoked on disconnect"
        ]
      },
      {
        "id": "social.metrics.turbineh",
        "name": "Social metrics",
        "tagline": "Likes, comments, shares and impressions of your published posts.",
        "functions": [
          "Likes, comments, shares and impressions"
        ]
      },
      {
        "id": "social.publish.turbineh",
        "name": "Social publishing",
        "tagline": "Schedule, approve and publish posts to each network.",
        "functions": [
          "Per-network format rules",
          "Approval and scheduling",
          "Retries with exponential backoff",
          "Append-only publication log",
          "Content calendar"
        ]
      }
    ]
  },
  {
    "id": "storefront",
    "name": "Online store",
    "description": "Online shop with product catalog and images, product variants (size, colour…) with own SKU, price and stock, cart, discount codes (percent or fixed amount, minimum order, usage limit, expiry), several currencies with fixed prices per currency, shipping options by country and currency, taxes by country or automatic Stripe Tax, Stripe Checkout payments, orders and stock, and an admin panel",
    "tagline": "An online shop with variants, cart, discount codes and Stripe Checkout payments.",
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
    ],
    "functions": [
      "Product catalog",
      "Product search",
      "Product images",
      "Product variants",
      "Cart",
      "Discount codes",
      "Several currencies",
      "Shipping by country and currency",
      "Taxes by country",
      "Automatic Stripe Tax",
      "Stripe Checkout payments",
      "Orders and stock",
      "Admin panel",
      "Stock levels from the admin panel"
    ],
    "addOns": []
  },
  {
    "id": "tracker",
    "name": "Trackers",
    "description": "Personal trackers (habits, health, money or any daily quantity) — goals, quick logging, streaks, 30-day history and weekly totals",
    "tagline": "Personal trackers for habits, health, money or any daily quantity.",
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
    ],
    "functions": [
      "Goals",
      "Quick logging",
      "Streaks",
      "30-day history",
      "Weekly totals"
    ],
    "addOns": [
      {
        "id": "domain.audit-log.turbineh",
        "name": "Audit log",
        "tagline": "Every change recorded with who and when, append-only.",
        "functions": [
          "Audit log"
        ]
      },
      {
        "id": "domain.workflow.turbineh",
        "name": "Status workflows",
        "tagline": "States, allowed transitions by role and an immutable history.",
        "functions": [
          "Status workflows"
        ]
      }
    ]
  }
];

export const CATALOG_TOTALS: CatalogTotals = {
  "components": 171,
  "useCases": 11,
  "functions": 195
};
