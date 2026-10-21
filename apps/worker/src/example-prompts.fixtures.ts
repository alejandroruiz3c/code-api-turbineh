/**
 * Compiled specifications of every example prompt TurbineH shows (ADR-0069): the wizard's suggestions, each use case's
 * example (Discover, /use, the product-question help) and the examples of the README and the API page. The CI guard
 * (example-prompts.test.ts) passes each through the scope gate exactly as the worker does and requires it covered.
 *
 * `source: "compiled"`: the compiler's own output for that prompt (production, before the fix of ADR-0069), kept as
 * the regression it is. `source: "written"`: written in the compiler's format from the example (Given/When/Then and
 * plain criteria, the entities the request names); when an example changes, compile it and update its fixture.
 * `open`: criteria of the example no shipped test proves, each with the reason (reviewed; the gate still covers them).
 */
export interface ExampleFixture {
  prompt: string;
  source: "compiled" | "written";
  recipe: string;
  app_name: string;
  summary: string;
  roles: string[];
  entities: { name: string; fields: { name: string; type: string; required: boolean }[] }[];
  acceptance_criteria: string[];
  open?: Record<string, string>;
}

const f = (name: string, type = "string", required = true) => ({ name, type, required });

export const EXAMPLE_FIXTURES: ExampleFixture[] = [
  {
    source: "compiled",
    prompt:
      "An AI booking agent for a physiotherapy clinic that checks availability and books 45-minute appointments",
    recipe: "ai-agents",
    app_name: "PhysioFlow AI",
    summary:
      "An AI-driven booking assistant that automates 45-minute physiotherapy appointment scheduling based on real-time availability.",
    roles: ["patient", "clinic_administrator", "physiotherapist"],
    entities: [
      {
        name: "Patient",
        fields: [
          {
            name: "name",
            type: "string",
            required: true,
          },
          {
            name: "email",
            type: "string",
            required: true,
          },
          {
            name: "phoneNumber",
            type: "string",
            required: true,
          },
        ],
      },
      {
        name: "Appointment",
        fields: [
          {
            name: "startTime",
            type: "datetime",
            required: true,
          },
          {
            name: "endTime",
            type: "datetime",
            required: true,
          },
          {
            name: "patientId",
            type: "string",
            required: true,
          },
          {
            name: "status",
            type: "string",
            required: true,
          },
          {
            name: "notes",
            type: "string",
            required: false,
          },
        ],
      },
      {
        name: "Staff",
        fields: [
          {
            name: "physiotherapistName",
            type: "string",
            required: true,
          },
          {
            name: "specialization",
            type: "string",
            required: false,
          },
        ],
      },
    ],
    acceptance_criteria: [
      "Given a user requests an appointment, the agent must query the clinic's calendar to identify available 45-minute time slots.",
      "Given a user selects a specific time slot, the agent must verify the slot is still available before proceeding to booking.",
      "Given a valid time slot and user details are provided, the agent must create a new appointment entry in the clinic's database.",
      "Given a booking is successful, the agent must provide the user with a confirmation message including the date and time.",
      "Given a user requests a time that is already occupied, the agent must inform the user and suggest the next available 45-minute slot.",
    ],
    open: {
      "Given a user requests a time that is already occupied, the agent must inform the user and suggest the next available 45-minute slot.":
        "Suggesting the next free slot is not proved by a test: the booking assistant's tests prove it books only real free slots and never an invented time.",
    },
  },
  {
    source: "compiled",
    prompt: "A simple online store for a sock brand with sizes, cart and card payments",
    recipe: "storefront",
    app_name: "SockStack",
    summary:
      "A streamlined e-commerce platform for purchasing branded socks with integrated size selection and secure payment processing.",
    roles: ["customer", "store_admin"],
    entities: [
      {
        name: "Product",
        fields: [
          {
            name: "id",
            type: "string",
            required: true,
          },
          {
            name: "name",
            type: "string",
            required: true,
          },
          {
            name: "description",
            type: "string",
            required: false,
          },
          {
            name: "price",
            type: "decimal",
            required: true,
          },
          {
            name: "imageUrl",
            type: "string",
            required: true,
          },
        ],
      },
      {
        name: "ProductVariant",
        fields: [
          {
            name: "id",
            type: "string",
            required: true,
          },
          {
            name: "productId",
            type: "string",
            required: true,
          },
          {
            name: "size",
            type: "string",
            required: true,
          },
          {
            name: "stockQuantity",
            type: "integer",
            required: true,
          },
        ],
      },
      {
        name: "CartItem",
        fields: [
          {
            name: "id",
            type: "string",
            required: true,
          },
          {
            name: "userId",
            type: "string",
            required: true,
          },
          {
            name: "variantId",
            type: "string",
            required: true,
          },
          {
            name: "quantity",
            type: "integer",
            required: true,
          },
        ],
      },
      {
        name: "Order",
        fields: [
          {
            name: "id",
            type: "string",
            required: true,
          },
          {
            name: "userId",
            type: "string",
            required: true,
          },
          {
            name: "totalAmount",
            type: "decimal",
            required: true,
          },
          {
            name: "status",
            type: "string",
            required: true,
          },
          {
            name: "createdAt",
            type: "datetime",
            required: true,
          },
        ],
      },
    ],
    acceptance_criteria: [
      "Given a user is on a product page, when they select a specific size and click 'Add to Cart', then the item is added to the shopping cart.",
      "Given a user has items in their cart, when they navigate to the cart page, then the total price is calculated correctly based on item quantities.",
      "Given a user is in the checkout flow, when they enter valid credit card details and submit, then the payment is processed and a confirmation is shown.",
      "Given a user is on a product page, when they attempt to add a size that is out of stock, then the 'Add to Cart' button is disabled.",
      "Given a user has items in their cart, when they click 'Remove' on a specific item, then that item is deleted from the cart and the total price updates.",
    ],
    open: {
      "Given a user has items in their cart, when they navigate to the cart page, then the total price is calculated correctly based on item quantities.":
        "Storefront wording not yet absorbed by its canonical criteria (the storefront is being extended in the commerce workstream).",
      "Given a user is in the checkout flow, when they enter valid credit card details and submit, then the payment is processed and a confirmation is shown.":
        "Storefront wording not yet absorbed by its canonical criteria (the storefront is being extended in the commerce workstream).",
      "Given a user is on a product page, when they attempt to add a size that is out of stock, then the 'Add to Cart' button is disabled.":
        "No storefront test proves a disabled 'Add to Cart' for an out-of-stock option yet (commerce workstream).",
    },
  },
  {
    source: "compiled",
    prompt: "A support assistant that answers from our help centre and escalates to a human",
    recipe: "ai-agents",
    app_name: "SupportFlow AI",
    summary:
      "An intelligent support assistant that resolves queries using help center documentation and seamlessly escalates complex issues to human agents.",
    roles: ["customer", "support_agent", "admin"],
    entities: [
      {
        name: "HelpArticle",
        fields: [
          {
            name: "articleId",
            type: "string",
            required: true,
          },
          {
            name: "title",
            type: "string",
            required: true,
          },
          {
            name: "content",
            type: "string",
            required: true,
          },
          {
            name: "category",
            type: "string",
            required: false,
          },
        ],
      },
      {
        name: "Conversation",
        fields: [
          {
            name: "conversationId",
            type: "string",
            required: true,
          },
          {
            name: "userId",
            type: "string",
            required: true,
          },
          {
            name: "status",
            type: "string",
            required: true,
          },
          {
            name: "isEscalated",
            type: "boolean",
            required: true,
          },
        ],
      },
      {
        name: "ChatMessage",
        fields: [
          {
            name: "messageId",
            type: "string",
            required: true,
          },
          {
            name: "conversationId",
            type: "string",
            required: true,
          },
          {
            name: "senderType",
            type: "string",
            required: true,
          },
          {
            name: "text",
            type: "string",
            required: true,
          },
          {
            name: "timestamp",
            type: "datetime",
            required: true,
          },
        ],
      },
      {
        name: "EscalationTicket",
        fields: [
          {
            name: "escalationId",
            type: "string",
            required: true,
          },
          {
            name: "conversationId",
            type: "string",
            required: true,
          },
          {
            name: "agentId",
            type: "string",
            required: false,
          },
          {
            name: "priority",
            type: "string",
            required: true,
          },
          {
            name: "resolutionSummary",
            type: "string",
            required: false,
          },
        ],
      },
    ],
    acceptance_criteria: [
      "Given a user query, the assistant retrieves and displays a relevant article from the help centre.",
      "Given a user query that cannot be answered by the help centre, the assistant provides an option to escalate to a human.",
      "Given the user selects the escalation option, the system creates a support ticket and notifies a human agent.",
    ],
  },
  {
    source: "compiled",
    prompt:
      "AI assistants with instructions and allowed tools (escalate to a human by email), chat over a knowledge base of the team's documents, batch AI processing of records (classify, extract, summarise), usage and audit — every AI call through the TurbineH orchestrator with its AI Safety Pack",
    recipe: "ai-agents",
    app_name: "TurbineH Orchestrator",
    summary:
      "An AI orchestration platform for managing specialized assistants, document-based chat, and batch processing with integrated safety and audit controls.",
    roles: ["admin", "knowledge_manager", "operator", "auditor"],
    entities: [
      {
        name: "Assistant",
        fields: [
          {
            name: "name",
            type: "string",
            required: true,
          },
          {
            name: "instructions",
            type: "text",
            required: true,
          },
          {
            name: "allowedTools",
            type: "string",
            required: false,
          },
          {
            name: "escalationEmail",
            type: "string",
            required: false,
          },
        ],
      },
      {
        name: "Document",
        fields: [
          {
            name: "title",
            type: "string",
            required: true,
          },
          {
            name: "content",
            type: "text",
            required: true,
          },
          {
            name: "sourceUrl",
            type: "string",
            required: false,
          },
        ],
      },
      {
        name: "ChatMessage",
        fields: [
          {
            name: "assistantId",
            type: "string",
            required: true,
          },
          {
            name: "role",
            type: "string",
            required: true,
          },
          {
            name: "message",
            type: "text",
            required: true,
          },
        ],
      },
      {
        name: "BatchJob",
        fields: [
          {
            name: "targetTable",
            type: "string",
            required: true,
          },
          {
            name: "operationType",
            type: "string",
            required: true,
          },
          {
            name: "status",
            type: "string",
            required: true,
          },
          {
            name: "results",
            type: "text",
            required: false,
          },
        ],
      },
    ],
    acceptance_criteria: [
      "Given a user interacts with an AI assistant, when the assistant encounters a query outside its scope, then it must trigger an escalation email to a human agent.",
      "Given an AI assistant is configured with specific tools, when a user makes a request, then the assistant must only execute the permitted tools.",
      "Given a set of team documents, when a user asks a question in chat, then the assistant must retrieve answers based on the provided knowledge base.",
      "Given a collection of records, when a batch processing job is initiated, then the system must perform the requested classification, extraction, or summarization on all records.",
      "Given an AI interaction occurs, then the system must route the request through the TurbineH orchestrator.",
      "Given an AI request is processed, then the TurbineH AI Safety Pack must validate the call before execution.",
      "Given an AI call is completed, then the system must log the usage and audit details for tracking purposes.",
    ],
  },
  {
    prompt:
      "Analytics dashboards for a team — import data from CSV or enter it, KPIs with period comparison, time series and breakdown charts, filters and export",
    source: "written",
    recipe: "analytics-dashboard",
    app_name: "Team Analytics",
    summary:
      "Team dashboard with CSV import or manual entry, KPIs compared with the previous period, charts, filters and export.",
    roles: ["owner", "analyst"],
    entities: [
      {
        name: "Metric",
        fields: [f("name"), f("value", "decimal"), f("date", "date"), f("category")],
      },
    ],
    acceptance_criteria: [
      "Given a CSV file with metric rows, when the owner imports it, then invalid rows are rejected and the dashboard shows the KPIs and charts.",
      "Given the dashboard, when the owner enters a value by hand, then the KPIs include it in its period.",
      "The KPIs compare the selected period with the previous period of the same length.",
      "Given data for several weeks, when the dashboard loads, then it shows a time series chart and a breakdown chart by category.",
      "Given a category filter is applied, when the owner clicks export, then the filtered data is downloaded as a CSV file.",
    ],
  },
  {
    prompt:
      "Online booking site for an appointment business — public booking page (service, team member or any, real free times, no account), confirmation email with a cancel link and a notice policy, no double bookings, staff calendar per team member (day and week), time off, move and cancel with customer emails",
    source: "written",
    recipe: "bookings",
    app_name: "Appointments",
    summary:
      "Public booking page with real free times, confirmation and cancel emails, staff calendar, time off and rescheduling.",
    roles: ["owner", "staff", "customer"],
    entities: [],
    acceptance_criteria: [
      "Given a customer on the public booking page, when they pick a service, a team member or any, and a free time, then the booking is created without an account.",
      "Given a booking is created, then a confirmation email with a cancel link is sent to the customer.",
      "Given a customer opens the cancel link before the notice period, then the booking is cancelled; inside the notice period the cancellation is refused.",
      "Given a time already booked for a team member, when another customer tries to book it, then it is not offered and cannot be booked twice.",
      "Given a staff member signs in, then they see the bookings in a day and week calendar per team member.",
      "Given a staff member adds time off, then those times are no longer offered for booking.",
      "Given a booking, when a staff member moves it to another time or cancels it, then the customer receives an email each time.",
    ],
  },
  {
    prompt:
      "Client portal where clients submit requests with file uploads and follow their status; staff review and update them",
    source: "written",
    recipe: "client-portal",
    app_name: "Client Portal",
    summary:
      "Clients submit requests with files and follow their status; staff review and update them.",
    roles: ["client", "staff"],
    entities: [],
    acceptance_criteria: [
      "Given a signed-in client, when they submit a request with a file attached, then the request is created with the file.",
      "Given a submitted request, when the client opens their requests, then they see its current status.",
      "Given a request, when staff review it and update its status, then the client sees the new status.",
      "Given a client uploads an HTML file disguised as a PDF, then the upload is rejected.",
    ],
  },
  {
    prompt:
      "Corporate website with home, services, about, blog with RSS, contact form and an admin panel to edit content, posts and messages",
    source: "written",
    recipe: "corporate-site",
    app_name: "Company Site",
    summary:
      "Corporate website with home, services, about, a blog with RSS, a contact form and an admin panel.",
    roles: ["admin", "visitor"],
    entities: [],
    acceptance_criteria: [
      "Given a visitor, when they browse the site, then the home, services, about and contact pages are shown.",
      "Given the admin publishes a blog post, then it appears on the blog, in the RSS feed and in the sitemap.",
      "Given a visitor submits the contact form, then they see a confirmation.",
      "Given the admin edits the home page headline, then the home page shows the new headline.",
      "Given a visitor sent a message, when the admin opens the dashboard, then the admin reads the contact message.",
    ],
    open: {
      "Given a visitor sent a message, when the admin opens the dashboard, then the admin reads the contact message.":
        "Names two actors (the visitor who sends, the admin who reads): a canonical function serves one actor, so it is not mapped (precision, ADR-0063).",
    },
  },
  {
    prompt: "Internal back-office tool with tables, search, CSV import and export",
    source: "written",
    recipe: "internal-tool",
    app_name: "Back Office",
    summary:
      "Internal back-office tool to manage customer records in tables with search, CSV import and export.",
    roles: ["admin", "operator"],
    entities: [{ name: "Customer", fields: [f("name"), f("email", "email"), f("company")] }],
    acceptance_criteria: [
      "The owner creates a customer and sees it in the list",
      "The owner searches customers by text and the list shows only the matching customers",
      "Given a CSV file of customers, when the owner imports it, then the customers are added from the CSV file.",
      "Given the customer list, when the owner exports it, then all customer records are downloaded in CSV format.",
    ],
  },
  {
    prompt: "Public landing page with a waitlist form, confirmation email and an admin panel",
    source: "written",
    recipe: "landing-waitlist",
    app_name: "Launch Waitlist",
    summary:
      "Public landing page where visitors join a waitlist, get a confirmation email, and the owner sees sign-ups.",
    roles: ["owner", "visitor"],
    entities: [],
    acceptance_criteria: [
      "Given a visitor on the landing page, when they submit their name and email, then they join the waitlist.",
      "Given a visitor joins the waitlist, then a confirmation email is sent to their address.",
      "Given the owner signs in, when they open the admin panel, then they see the list of waitlist sign-ups.",
    ],
  },
  {
    prompt:
      "Project and task management for teams with kanban boards, assignees, priorities, due dates, comments, a personal task list, editing and deleting projects and tasks, and archiving with restore",
    source: "written",
    recipe: "projects",
    app_name: "Team Projects",
    summary:
      "Projects and tasks on kanban boards with assignees, priorities, due dates, comments, my tasks and archiving.",
    roles: ["owner", "member"],
    entities: [],
    acceptance_criteria: [
      "Given a project, when the owner creates a task assigned to a team member, then the task appears on the board with its assignee.",
      "Given a task on the kanban board, when the owner moves it from To do to In progress, then the new status is persisted.",
      "Given a task with a priority and a due date in the past, then it is flagged as overdue.",
      "Given a task, when the owner adds a comment, then the comment is visible on the task.",
      "Given tasks assigned to the owner, when they open My tasks, then they see those tasks.",
      "Given a task, when the owner edits its title, then the change is saved.",
      "Given a project, when the owner deletes it, then the project and its tasks are removed.",
      "Given a task, when the owner archives it, then it leaves the board and can be restored.",
    ],
  },
  {
    prompt: "Multi-tenant SaaS with sign-in, workspaces, roles and CRUD screens",
    source: "written",
    recipe: "saas-crud",
    app_name: "Workspace SaaS",
    summary:
      "Multi-tenant SaaS where teams sign in to their workspace and manage clients with roles.",
    roles: ["owner", "admin", "member"],
    entities: [
      { name: "Client", fields: [f("name"), f("email", "email"), f("notes", "text", false)] },
    ],
    acceptance_criteria: [
      "A returning user signs out, signs in again and resumes their workspace",
      "Given a new user signs up, then their workspace is created with them as the owner.",
      "A member cannot change settings, manage members or read the audit log.",
      "The owner creates a client and sees it in the list",
      "The owner edits a client and sees the change",
      "The owner deletes a client and it is no longer in the list",
    ],
  },
  {
    prompt:
      "Online shop with product catalog and images, product variants (size, colour…) with own SKU, price and stock, cart, discount codes (percent or fixed amount, minimum order, usage limit, expiry), several currencies with fixed prices per currency, shipping options by country and currency, taxes by country or automatic Stripe Tax, Stripe Checkout payments, orders and stock, and an admin panel",
    source: "written",
    recipe: "storefront",
    app_name: "Online Shop",
    summary:
      "Online shop with a product catalogue, variants, cart, discount codes, currencies, shipping, taxes, Stripe Checkout and an admin panel.",
    roles: ["admin", "customer"],
    entities: [],
    acceptance_criteria: [
      "Given a shopper on the catalogue, when they click a product, then its detail page shows the product with its price.",
      "Given the admin creates a product with an image, then it appears in the catalogue.",
      "Given the admin adds variants with their own SKU, price and stock, then the shopper can pick a variant.",
      "Given a shopper adds a product to the cart, when they change the quantity, then the subtotal updates.",
      "Given a valid discount code, when the shopper applies it at checkout, then the discount is applied and the code is counted once.",
      "Given the admin sets shipping options by country and a tax rate, then checkout uses them.",
      "Given a shopper pays with Stripe Checkout, then the signed webhook marks the order paid and decrements the stock.",
      "Given the owner opens the admin area, then they see all orders with their payment status.",
    ],
  },
  {
    prompt:
      "Personal trackers (habits, health, money or any daily quantity) — goals, quick logging, streaks, 30-day history and weekly totals",
    source: "written",
    recipe: "tracker",
    app_name: "Daily Tracker",
    summary:
      "Personal trackers for habits and daily quantities with goals, quick logging, streaks, history and weekly totals.",
    roles: ["owner"],
    entities: [],
    acceptance_criteria: [
      "Given a tracker with a daily goal, when the user logs amounts, then they add up towards the goal.",
      "Given a habit, when the user checks in today, then a streak starts.",
      "Given today's goal is met, then the 30-day history marks today as met.",
      "The weekly total adds up the logs of the last 7 days.",
    ],
  },
  {
    prompt:
      "A client portal where clients submit requests with attachments and follow their status",
    source: "written",
    recipe: "client-portal",
    app_name: "Client Requests",
    summary: "Clients submit requests with attachments and follow their status.",
    roles: ["client", "staff"],
    entities: [],
    acceptance_criteria: [
      "Given a signed-in client, when they submit a request with an attachment, then the request is created with the file.",
      "Given a submitted request, when the client opens it, then they see its current status.",
      "Given staff update the status of a request, then the client sees the new status.",
    ],
  },
  {
    prompt: "Bookings for a physiotherapy clinic",
    source: "written",
    recipe: "bookings",
    app_name: "Physio Bookings",
    summary:
      "Online bookings for a physiotherapy clinic: patients book a free time on a public page.",
    roles: ["owner", "physiotherapist", "patient"],
    entities: [],
    acceptance_criteria: [
      "Given a patient on the public booking page, when they choose a service and a free time, then the booking is created without an account.",
      "Given a booking is created, then the patient receives a confirmation email with a cancel link.",
      "Given a time is already booked for a physiotherapist, then it cannot be booked twice.",
    ],
  },
  {
    prompt: "a support agent over our help centre",
    source: "written",
    recipe: "ai-agents",
    app_name: "Help Centre Agent",
    summary: "A support agent that answers customer questions from the help centre articles.",
    roles: ["admin", "customer"],
    entities: [{ name: "HelpArticle", fields: [f("title"), f("content", "text")] }],
    acceptance_criteria: [
      "Given a customer asks a question, when a help centre article covers it, then the agent answers from that article.",
      "Given an admin adds a help centre article, then it is added to the knowledge base.",
      "Given a customer message tries to override the agent's instructions, then it is refused with a safe message.",
    ],
  },
];
