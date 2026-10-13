/**
 * Labelled pairs from hand-written acceptance.yaml rules (ADR-0043, learning round 2026-10-13): each criterion with the
 * test a rule cited for it in a delivered package, and that test as shipped (title and key assertions, read from the
 * package or, for bookings, from the recipe template the package was assembled from). `met` is the human label. The
 * bookings pairs include the known false "met": "the owner books a slot and sees it in the calendar" cited for seven
 * unrelated criteria. Precision must stay at or above 0.98 on these plus `PROOF_PAIRS`.
 */
import type { ProofPair } from "./criterion-proof.fixtures.js";

export const RULE_PAIRS: ProofPair[] = [
  {
    id: "rule-bookings-1",
    criterion:
      "Given a customer provides a name, email, and phone, the system creates a booking and sends a confirmation email.",
    test: {
      title: "the owner books a slot and sees it in the calendar",
      assertions: [
        'await page.getByLabel("Customer name").fill("Grace Client");',
        'await page.getByLabel("Customer email").fill("grace@example.com");',
        'await page.getByLabel("Starts (UTC)").fill(`${tomorrow()}T10:00`);',
        'await page.getByLabel("Ends (UTC)").fill(`${tomorrow()}T10:30`);',
        'await expect(page.getByRole("status")).toContainText("Booking confirmed");',
        'await expect(page.getByText("Grace Client")).toBeVisible();',
      ],
    },
    met: false,
  },
  {
    id: "rule-bookings-2",
    criterion:
      "Given a customer receives a confirmation email, they can click the link to cancel the booking if it is more than 12 hours before the start time.",
    test: {
      title: "the owner books a slot and sees it in the calendar",
      assertions: [
        'await page.getByLabel("Customer name").fill("Grace Client");',
        'await page.getByLabel("Customer email").fill("grace@example.com");',
        'await page.getByLabel("Starts (UTC)").fill(`${tomorrow()}T10:00`);',
        'await page.getByLabel("Ends (UTC)").fill(`${tomorrow()}T10:30`);',
        'await expect(page.getByRole("status")).toContainText("Booking confirmed");',
        'await expect(page.getByText("Grace Client")).toBeVisible();',
      ],
    },
    met: false,
  },
  {
    id: "rule-bookings-3",
    criterion:
      "Given a customer attempts to book a slot that is already taken, the system prevents the double booking.",
    test: {
      title: "the owner books a slot and sees it in the calendar",
      assertions: [
        'await page.getByLabel("Customer name").fill("Grace Client");',
        'await page.getByLabel("Customer email").fill("grace@example.com");',
        'await page.getByLabel("Starts (UTC)").fill(`${tomorrow()}T10:00`);',
        'await page.getByLabel("Ends (UTC)").fill(`${tomorrow()}T10:30`);',
        'await expect(page.getByRole("status")).toContainText("Booking confirmed");',
        'await expect(page.getByText("Grace Client")).toBeVisible();',
      ],
    },
    met: false,
  },
  {
    id: "rule-bookings-4",
    criterion:
      "Given a staff member signs in, they can view a calendar displaying bookings for the day and week per stylist.",
    test: {
      title: "the owner books a slot and sees it in the calendar",
      assertions: [
        'await page.getByLabel("Customer name").fill("Grace Client");',
        'await page.getByLabel("Customer email").fill("grace@example.com");',
        'await page.getByLabel("Starts (UTC)").fill(`${tomorrow()}T10:00`);',
        'await page.getByLabel("Ends (UTC)").fill(`${tomorrow()}T10:30`);',
        'await expect(page.getByRole("status")).toContainText("Booking confirmed");',
        'await expect(page.getByText("Grace Client")).toBeVisible();',
      ],
    },
    met: false,
  },
  {
    id: "rule-bookings-5",
    criterion:
      "Given a staff member is authenticated, they can block specific time slots to make them unavailable for booking.",
    test: {
      title: "the owner books a slot and sees it in the calendar",
      assertions: [
        'await page.getByLabel("Customer name").fill("Grace Client");',
        'await page.getByLabel("Customer email").fill("grace@example.com");',
        'await page.getByLabel("Starts (UTC)").fill(`${tomorrow()}T10:00`);',
        'await page.getByLabel("Ends (UTC)").fill(`${tomorrow()}T10:30`);',
        'await expect(page.getByRole("status")).toContainText("Booking confirmed");',
        'await expect(page.getByText("Grace Client")).toBeVisible();',
      ],
    },
    met: false,
  },
  {
    id: "rule-bookings-6",
    criterion:
      "Given a staff member is authenticated, they can move an existing booking to a different time slot.",
    test: {
      title: "the owner books a slot and sees it in the calendar",
      assertions: [
        'await page.getByLabel("Customer name").fill("Grace Client");',
        'await page.getByLabel("Customer email").fill("grace@example.com");',
        'await page.getByLabel("Starts (UTC)").fill(`${tomorrow()}T10:00`);',
        'await page.getByLabel("Ends (UTC)").fill(`${tomorrow()}T10:30`);',
        'await expect(page.getByRole("status")).toContainText("Booking confirmed");',
        'await expect(page.getByText("Grace Client")).toBeVisible();',
      ],
    },
    met: false,
  },
  {
    id: "rule-bookings-7",
    criterion:
      "Given a staff member is authenticated, they can cancel a booking, triggering an automated email to the customer.",
    test: {
      title: "the owner books a slot and sees it in the calendar",
      assertions: [
        'await page.getByLabel("Customer name").fill("Grace Client");',
        'await page.getByLabel("Customer email").fill("grace@example.com");',
        'await page.getByLabel("Starts (UTC)").fill(`${tomorrow()}T10:00`);',
        'await page.getByLabel("Ends (UTC)").fill(`${tomorrow()}T10:30`);',
        'await expect(page.getByRole("status")).toContainText("Booking confirmed");',
        'await expect(page.getByText("Grace Client")).toBeVisible();',
      ],
    },
    met: false,
  },
  {
    id: "rule-bookings-8",
    criterion:
      "Given a customer selects a service, they can only choose time slots that match the service duration.",
    test: {
      title: "rejects past, too short and too long bookings",
      assertions: [
        'expect(slotProblem(slot("2029-12-31T09:00", "2029-12-31T10:00"), now)).toMatch(/future/);',
        'expect(slotProblem(slot("2030-01-07T09:00", "2030-01-07T09:05"), now)).toMatch(/at least/);',
        'expect(slotProblem(slot("2030-01-07T09:00", "2030-01-07T18:00"), now)).toMatch(/at most/);',
        'expect(slotProblem(slot("2030-01-07T09:00", "2030-01-07T10:00"), now)).toBeNull();',
      ],
    },
    met: false,
  },
  {
    id: "rule-bookings-9",
    criterion:
      "Given a customer attempts to book a slot that is already taken, the system prevents the double booking.",
    test: {
      title: "an overlapping booking is rejected",
      assertions: [
        'await page.getByLabel("Customer name").fill("Overlap Client");',
        'await page.getByLabel("Customer email").fill("overlap@example.com");',
        'await page.getByLabel("Starts (UTC)").fill(`${tomorrow()}T10:15`);',
        'await page.getByLabel("Ends (UTC)").fill(`${tomorrow()}T10:45`);',
        'await expect(page.getByRole("status")).toContainText("already booked");',
      ],
    },
    met: true,
  },
  {
    id: "rule-bookings-10",
    criterion: "The owner books a slot and sees it in the calendar.",
    test: {
      title: "the owner books a slot and sees it in the calendar",
      assertions: [
        'await page.getByLabel("Customer name").fill("Grace Client");',
        'await page.getByLabel("Customer email").fill("grace@example.com");',
        'await page.getByLabel("Starts (UTC)").fill(`${tomorrow()}T10:00`);',
        'await page.getByLabel("Ends (UTC)").fill(`${tomorrow()}T10:30`);',
        'await expect(page.getByRole("status")).toContainText("Booking confirmed");',
        'await expect(page.getByText("Grace Client")).toBeVisible();',
      ],
    },
    met: true,
  },
  {
    id: "rule-bookings-11",
    criterion: "A booking outside the opening hours is rejected.",
    test: {
      title: "a booking outside the opening hours is rejected",
      assertions: [
        'await page.getByLabel("Customer name").fill("Night Client");',
        'await page.getByLabel("Customer email").fill("night@example.com");',
        'await page.getByLabel("Starts (UTC)").fill(`${tomorrow()}T21:00`);',
        'await page.getByLabel("Ends (UTC)").fill(`${tomorrow()}T21:30`);',
        'await expect(page.getByRole("status")).toContainText("outside the availability");',
      ],
    },
    met: true,
  },
  {
    id: "rule-agent-0",
    criterion:
      "Given a patient asks for availability, when the assistant queries the clinic data, then it must only return slots within Mon-Fri 09:00-19:00 Europe/Madrid.",
    test: {
      title: "never books an invented time",
      assertions: [
        "expect(reply).toMatch(/Sorry: (That time is not available|There are no free times)/);",
        'await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0);',
      ],
    },
    met: false,
  },
  {
    id: "rule-agent-1",
    criterion:
      "Given a patient requests a booking, when the assistant identifies a slot, then it must confirm the date, time, and therapist with the patient before calling the booking tool.",
    test: {
      title: "only knows registry tools; sending email is irreversible",
      assertions: [
        'expect(isTool("email_me")).toBe(true);',
        'expect(isTool("rm_rf")).toBe(false);',
        'expect(TOOL_REGISTRY.find((t) => t.name === "email_me")?.irreversible).toBe(true);',
      ],
    },
    met: false,
  },
  {
    id: "rule-agent-2",
    criterion:
      "Given a patient provides a chosen therapist, when the assistant checks availability, then it must filter results specifically for that physiotherapist.",
    test: {
      title: "never books an invented time",
      assertions: [
        "expect(reply).toMatch(/Sorry: (That time is not available|There are no free times)/);",
        'await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0);',
      ],
    },
    met: false,
  },
  {
    id: "rule-agent-3",
    criterion:
      "Given a patient requests to reschedule, when the assistant processes the request, then it must use the tool to move the existing booking to a new slot.",
    test: {
      title: "only knows registry tools; sending email is irreversible",
      assertions: [
        'expect(isTool("email_me")).toBe(true);',
        'expect(isTool("rm_rf")).toBe(false);',
        'expect(TOOL_REGISTRY.find((t) => t.name === "email_me")?.irreversible).toBe(true);',
      ],
    },
    met: false,
  },
  {
    id: "rule-agent-4",
    criterion:
      "Given a patient requests to cancel, when the appointment is less than 24 hours away, then the assistant must refuse the cancellation.",
    test: {
      title:
        "books only a real free time, after the person confirms, and logs the confirmation email",
      assertions: [
        'expect(proposal).toContain("Shall I go ahead?");',
        'await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();',
        "expect(ref, done).not.toBeNull();",
        'expect(done).toContain("confirmation email");',
        "await expect(row).toContainText(email);",
        "await expect(row).toContainText(/confirmation: (logged|sent)/);",
      ],
    },
    met: false,
  },
  {
    id: "rule-agent-5",
    criterion:
      "Given a patient asks about pricing, when the assistant responds, then it must state 60 € for the first visit and 50 € for follow-ups.",
    test: {
      title: "creates an assistant that answers from the knowledge base",
      assertions: [
        'await page.getByLabel("Name").fill("Support bot");',
        '.getByLabel("Instructions")',
        'await page.getByLabel("Escalate to a person").check();',
        'await expect(page.getByRole("heading", { name: "Support bot" })).toBeVisible();',
        'await page.getByLabel("Message").fill("How do refunds work?");',
        'await expect(answer).toContainText("How do refunds work?");',
        'await expect(answer).toContainText("Sources: Refund policy");',
      ],
    },
    met: false,
  },
  {
    id: "rule-agent-6",
    criterion:
      "Given a patient asks for the clinic location, when the assistant responds, then it must provide the correct clinic address.",
    test: {
      title: "creates an assistant that answers from the knowledge base",
      assertions: [
        'await page.getByLabel("Name").fill("Support bot");',
        '.getByLabel("Instructions")',
        'await page.getByLabel("Escalate to a person").check();',
        'await expect(page.getByRole("heading", { name: "Support bot" })).toBeVisible();',
        'await page.getByLabel("Message").fill("How do refunds work?");',
        'await expect(answer).toContainText("How do refunds work?");',
        'await expect(answer).toContainText("Sources: Refund policy");',
      ],
    },
    met: false,
  },
  {
    id: "rule-agent-7",
    criterion:
      "Given a patient asks what to bring, when the assistant responds, then it must provide the relevant clinic instructions.",
    test: {
      title: "creates an assistant that answers from the knowledge base",
      assertions: [
        'await page.getByLabel("Name").fill("Support bot");',
        '.getByLabel("Instructions")',
        'await page.getByLabel("Escalate to a person").check();',
        'await expect(page.getByRole("heading", { name: "Support bot" })).toBeVisible();',
        'await page.getByLabel("Message").fill("How do refunds work?");',
        'await expect(answer).toContainText("How do refunds work?");',
        'await expect(answer).toContainText("Sources: Refund policy");',
      ],
    },
    met: false,
  },
  {
    id: "rule-agent-8",
    criterion:
      "Given a successful booking, when the process completes, then the assistant must trigger a confirmation email to the patient.",
    test: {
      title: "never executes an irreversible tool before an explicit confirmation",
      assertions: [
        'expect(first.status).toBe("needs_confirmation");',
        'expect(first.pending?.summary).toBe("Book 10:00");',
        "expect(booked).toEqual([]);",
        "expect(booked).toEqual([]);",
        "expect(unclear.state.pending).toBeNull();",
        'expect(booked).toEqual(["10:00"]);',
        'expect(done.status).toBe("answered");',
        "expect(done.state.pending).toBeNull();",
      ],
    },
    met: false,
  },
  {
    id: "rule-agent-9",
    criterion:
      "Given a staff member accesses the dashboard, when they sign in, then they must be able to view and manage all existing bookings.",
    test: {
      title:
        "books only a real free time, after the person confirms, and logs the confirmation email",
      assertions: [
        'expect(proposal).toContain("Shall I go ahead?");',
        'await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();',
        "expect(ref, done).not.toBeNull();",
        'expect(done).toContain("confirmation email");',
        "await expect(row).toContainText(email);",
        "await expect(row).toContainText(/confirmation: (logged|sent)/);",
      ],
    },
    met: false,
  },
  {
    id: "rule-agent-10",
    criterion:
      "Given a user sends a request, when the input exceeds the defined character limit, then the assistant must reject the input to prevent abuse.",
    test: {
      title: "rejects prompt injection and oversized messages",
      assertions: [
        "expect(injected.status()).toBe(400);",
        'expect((await injected.json()).error).toContain("can\'t be processed");',
        "expect(big.status()).toBe(400);",
      ],
    },
    met: true,
  },
  {
    id: "rule-agent-11",
    criterion:
      "Given a user sends multiple rapid requests, when the rate limit is exceeded, then the assistant must throttle the responses.",
    test: {
      title: "rejects prompt injection and oversized messages",
      assertions: [
        "expect(injected.status()).toBe(400);",
        'expect((await injected.json()).error).toContain("can\'t be processed");',
        "expect(big.status()).toBe(400);",
      ],
    },
    met: false,
  },
  {
    id: "rule-agent-12",
    criterion:
      "Given a malicious prompt injection attempt, when the input is processed, then the assistant must refuse to deviate from its booking assistant persona.",
    test: {
      title: "refuses a prompt-injection attempt with a safe message",
      assertions: [
        '.getByLabel("Message")',
        'await expect(page.locator(\'p[role="alert"]\')).toContainText("can\'t be processed");',
        "await expect(page.locator('article[data-role=\"user\"]')).toHaveCount(1);",
      ],
    },
    met: true,
  },
  {
    id: "rule-agent-13",
    criterion:
      "Given the test suite runs, when the LLM is called, then it must communicate with a local mock endpoint instead of the real OpenAI API.",
    test: {
      title: "uses an OpenAI-compatible endpoint from the environment, else the TurbineH gateway",
      assertions: [
        "expect(modelEndpoint()).toMatchObject({",
        'expect(aiConfig().AI_STRUCTURER_MODEL).toBe("local-model");',
        'expect(modelEndpoint().kind).toBe("gateway");',
      ],
    },
    met: false,
  },
  {
    id: "rule-client-portal-14",
    criterion: "Staff can view a comprehensive list of all registered client companies.",
    test: {
      title: "sign-up follows the app's policy (staff-only apps refuse other emails)",
      assertions: [
        'await page.getByLabel("Name", { exact: true }).fill("Curious Visitor");',
        'await page.getByLabel("Email").fill(`visitor-${Date.now()}@example.com`);',
        'await page.getByLabel("Password").fill(PASSWORD);',
        "await expect(page.getByText(/reserved for staff/)).toBeVisible();",
        "await expect(page).toHaveURL(/\\/sign-up/);",
      ],
    },
    met: false,
  },
  {
    id: "rule-corporate-site-15",
    criterion:
      "Given a user visits the Home page, they should see a hero section and key figures displayed.",
    test: {
      title: "browses home, services, about and contact",
      assertions: [
        'await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();',
        'await expect(page.getByRole("heading", { name: "What we do" })).toBeVisible();',
        'await expect(page.getByRole("heading", { name: "Services", level: 1 })).toBeVisible();',
        'await expect(page.getByRole("heading", { name: /About/, level: 1 })).toBeVisible();',
      ],
    },
    met: false,
  },
  {
    id: "rule-corporate-site-16",
    criterion:
      "Given a user navigates to the Services section, they should be able to access individual pages for each of the four services.",
    test: {
      title: "browses home, services, about and contact",
      assertions: [
        'await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();',
        'await expect(page.getByRole("heading", { name: "What we do" })).toBeVisible();',
        'await expect(page.getByRole("heading", { name: "Services", level: 1 })).toBeVisible();',
        'await expect(page.getByRole("heading", { name: /About/, level: 1 })).toBeVisible();',
      ],
    },
    met: false,
  },
  {
    id: "rule-corporate-site-17",
    criterion:
      "Given a user selects a project from the portfolio, they should be directed to a dedicated project page.",
    test: {
      title: "browses home, services, about and contact",
      assertions: [
        'await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();',
        'await expect(page.getByRole("heading", { name: "What we do" })).toBeVisible();',
        'await expect(page.getByRole("heading", { name: "Services", level: 1 })).toBeVisible();',
        'await expect(page.getByRole("heading", { name: /About/, level: 1 })).toBeVisible();',
      ],
    },
    met: false,
  },
  {
    id: "rule-corporate-site-18",
    criterion: "Given a user visits the Team page, they should see the staff members.",
    test: {
      title: "browses home, services, about and contact",
      assertions: [
        'await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();',
        'await expect(page.getByRole("heading", { name: "What we do" })).toBeVisible();',
        'await expect(page.getByRole("heading", { name: "Services", level: 1 })).toBeVisible();',
        'await expect(page.getByRole("heading", { name: /About/, level: 1 })).toBeVisible();',
      ],
    },
    met: false,
  },
  {
    id: "rule-corporate-site-19",
    criterion: "Given a user visits the Careers page, they should see a list of open positions.",
    test: {
      title: "browses home, services, about and contact",
      assertions: [
        'await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();',
        'await expect(page.getByRole("heading", { name: "What we do" })).toBeVisible();',
        'await expect(page.getByRole("heading", { name: "Services", level: 1 })).toBeVisible();',
        'await expect(page.getByRole("heading", { name: /About/, level: 1 })).toBeVisible();',
      ],
    },
    met: false,
  },
  {
    id: "rule-corporate-site-20",
    criterion:
      "Given a user submits the Contact form with valid data, the request should be stored in the database and emailed to the firm.",
    test: {
      title: "sends a contact message",
      assertions: [
        'await page.getByLabel("Name").fill("Grace Visitor");',
        'await page.getByLabel("Email").fill("grace@example.com");',
        'await page.getByLabel("Company (optional)").fill("Grace Builders");',
        'await page.getByLabel("Message").fill("We would like a quote for a new project.");',
        "await page.getByLabel(/I agree/).check();",
        'await expect(page.getByRole("status")).toContainText("Thanks!");',
      ],
    },
    met: false,
  },
  {
    id: "rule-corporate-site-21",
    criterion:
      "Given a user submits the Contact form, the system should enforce rate-limiting and spam protection.",
    test: {
      title: "sends a contact message",
      assertions: [
        'await page.getByLabel("Name").fill("Grace Visitor");',
        'await page.getByLabel("Email").fill("grace@example.com");',
        'await page.getByLabel("Company (optional)").fill("Grace Builders");',
        'await page.getByLabel("Message").fill("We would like a quote for a new project.");',
        "await page.getByLabel(/I agree/).check();",
        'await expect(page.getByRole("status")).toContainText("Thanks!");',
      ],
    },
    met: false,
  },
  {
    id: "rule-corporate-site-22",
    criterion:
      "Given a staff member signs in, they should be able to edit projects and open positions.",
    test: {
      title: "owner edits a project and sees the change",
      assertions: [
        'await expect(page.getByRole("heading", { name: "Edit project" })).toBeVisible();',
        'await page.getByLabel("Title", { exact: true }).fill("Project Title sample edited");',
        'await expect(page.getByRole("cell", { name: "Project Title sample edited" }).first()).toBeVisible();',
      ],
    },
    met: false,
  },
  {
    id: "rule-corporate-site-23",
    criterion: "Given a staff member signs in, they should be able to read contact requests.",
    test: {
      title: "the admin reads the message",
      assertions: [
        'await expect(page.getByText("We would like a quote for a new project.")).toBeVisible();',
        "await expect(page.getByText(/consent given/).first()).toBeVisible();",
      ],
    },
    met: true,
  },
  {
    id: "rule-corporate-site-24",
    criterion:
      "Given a web crawler visits the site, it should find valid metadata, a sitemap, a robots.txt, and Open Graph images.",
    test: {
      title: "is ready for search and AI answer engines (JSON-LD, llms.txt, robots, sitemap)",
      assertions: [
        "await expect(page.locator('script[type=\"application/ld+json\"]')).toHaveCount(3);",
        'expect(await (await request.get("/llms.txt")).text()).toContain("## Services");',
        'expect(robots).toContain("ClaudeBot");',
        'expect(robots).toContain("Disallow: /dashboard");',
      ],
    },
    met: false,
  },
  {
    id: "rule-corporate-site-25",
    criterion:
      "Given the development environment, running `pnpm db:migrate` should update the PostgreSQL schema via `DATABASE_URL`.",
    test: {
      title: "the admin publishes a post that appears on the blog, RSS and sitemap",
      assertions: [
        'await page.getByLabel("Title").fill("Our first article");',
        'await page.getByLabel("Summary").fill("What we learned in our first year.");',
        'await page.getByLabel(/Text \\(Markdown/).fill("# Hello\\n\\nThis is **our** first article.");',
        'await page.getByLabel("Published").check();',
        'await expect(page.getByRole("cell", { name: "Our first article" })).toBeVisible();',
        'await expect(page.getByRole("heading", { name: "Our first article", level: 1 })).toBeVisible();',
        'expect(await (await request.get("/blog/rss.xml")).text()).toContain("Our first article");',
        'expect(await (await request.get("/sitemap.xml")).text()).toContain("/blog/our-first-article");',
      ],
    },
    met: false,
  },
  {
    id: "rule-corporate-site-26",
    criterion:
      "Given the development environment, running `pnpm test:e2e` should execute Playwright tests against a running `next start` server without internet access.",
    test: {
      title:
        "E2E owns its URLs: auth runs on the server Playwright started, whatever the ambient BETTER_AUTH_URL",
      assertions: [
        "expect(process.env.BETTER_AUTH_URL).toBe(baseURL);",
        "await expect(page).toHaveURL(new RegExp(`^${baseURL}/dashboard`));",
        'await expect(page.getByTestId("role")).toHaveText("owner");',
      ],
    },
    met: false,
  },
  {
    id: "rule-projects-27",
    criterion:
      "Given the 'pnpm job:overdue' script is executed, when no email provider is configured, then the email content must be written to the application logs.",
    test: {
      title: "flags overdue tasks that are not done",
      assertions: [
        'expect(isOverdue("2026-01-01", "doing", "2026-01-02")).toBe(true);',
        'expect(isOverdue("2026-01-01", "done", "2026-01-02")).toBe(false);',
        'expect(isOverdue(null, "todo", "2026-01-02")).toBe(false);',
      ],
    },
    met: false,
  },
  {
    id: "rule-projects-28",
    criterion:
      "Given a task, when a user changes its priority to 'urgent', then the priority must be updated in the database.",
    test: {
      title: "orders my tasks by due date, then priority",
      assertions: [
        'expect([...list].sort(byUrgency).map((t) => t.priority)).toEqual(["high", "low", "urgent"]);',
      ],
    },
    met: false,
  },
  {
    id: "rule-shop-29",
    criterion:
      "Given a user is browsing the catalogue, when they enter a product name in the search bar, then the displayed list must filter to only show matching products.",
    test: {
      title: "shoppers search the catalogue by product name: only matching products are listed",
      assertions: [
        '.or(page.getByLabel("Search products"))',
        'await expect(page.getByRole("link", { name: /Linen Shirt/ }).first()).toBeVisible();',
        'await expect(page.getByRole("link", { name: /Cotton Tee/ })).toHaveCount(0);',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-30",
    criterion:
      "Given a user is on a product page, when they click the 'Add to Cart' button, then the item must appear in the cart with the correct price and initial quantity of one.",
    test: {
      title:
        "a shopper adds a product to the cart at its price with quantity one; changing the quantity updates the subtotal",
      assertions: [
        "await expect(page).toHaveURL(/\\/cart/);",
        'await expect(page.getByLabel("Quantity of Linen Shirt")).toHaveValue("1");',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("49.90");',
        'await page.getByLabel("Quantity of Linen Shirt").fill("3");',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("149.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-31",
    criterion:
      "Given a user has items in their cart, when they increase the quantity of a specific item, then the cart subtotal must update to reflect the new total.",
    test: {
      title:
        "a shopper adds a product to the cart at its price with quantity one; changing the quantity updates the subtotal",
      assertions: [
        "await expect(page).toHaveURL(/\\/cart/);",
        'await expect(page.getByLabel("Quantity of Linen Shirt")).toHaveValue("1");',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("49.90");',
        'await page.getByLabel("Quantity of Linen Shirt").fill("3");',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("149.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-32",
    criterion:
      "Given a user proceeds to checkout, when they complete the Stripe payment, then the server must receive a signed webhook and mark the order status as 'Paid'.",
    test: {
      title:
        "pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged",
      assertions: [
        'await expect(page.getByRole("heading", { name: "Linen Shirt", level: 1 })).toBeVisible();',
        'await expect(page.getByTestId("price")).toContainText("49.90");',
        'await page.getByLabel("Quantity").fill("2");',
        'await expect(page.getByTestId("cart-total")).toContainText("99.80");',
        'await expect(page.getByTestId("price")).toContainText("From");',
        "await page.getByLabel(/^L —/).check();",
        'await expect(page.getByText("Cotton Tee — L")).toBeVisible();',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("121.80");',
        'await page.getByLabel("Ship to").selectOption("ES");',
        'await expect(page.getByTestId("cart-shipping")).toContainText("4.90");',
        'await expect(page.getByTestId("cart-tax")).toContainText("21.99");',
        'await expect(page.getByTestId("cart-total")).toContainText("126.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-33",
    criterion:
      "Given an order is marked as 'Paid' via webhook, then the stock level for each purchased product must be decremented by the quantity ordered.",
    test: {
      title:
        "pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged",
      assertions: [
        'await expect(page.getByRole("heading", { name: "Linen Shirt", level: 1 })).toBeVisible();',
        'await expect(page.getByTestId("price")).toContainText("49.90");',
        'await page.getByLabel("Quantity").fill("2");',
        'await expect(page.getByTestId("cart-total")).toContainText("99.80");',
        'await expect(page.getByTestId("price")).toContainText("From");',
        "await page.getByLabel(/^L —/).check();",
        'await expect(page.getByText("Cotton Tee — L")).toBeVisible();',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("121.80");',
        'await page.getByLabel("Ship to").selectOption("ES");',
        'await expect(page.getByTestId("cart-shipping")).toContainText("4.90");',
        'await expect(page.getByTestId("cart-tax")).toContainText("21.99");',
        'await expect(page.getByTestId("cart-total")).toContainText("126.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-34",
    criterion:
      "Given a successful payment, when the order process completes, then an order confirmation email must be logged to the console containing the order details.",
    test: {
      title:
        "pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged",
      assertions: [
        'await expect(page.getByRole("heading", { name: "Linen Shirt", level: 1 })).toBeVisible();',
        'await expect(page.getByTestId("price")).toContainText("49.90");',
        'await page.getByLabel("Quantity").fill("2");',
        'await expect(page.getByTestId("cart-total")).toContainText("99.80");',
        'await expect(page.getByTestId("price")).toContainText("From");',
        "await page.getByLabel(/^L —/).check();",
        'await expect(page.getByText("Cotton Tee — L")).toBeVisible();',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("121.80");',
        'await page.getByLabel("Ship to").selectOption("ES");',
        'await expect(page.getByTestId("cart-shipping")).toContainText("4.90");',
        'await expect(page.getByTestId("cart-tax")).toContainText("21.99");',
        'await expect(page.getByTestId("cart-total")).toContainText("126.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-35",
    criterion:
      "Given an authenticated admin user is in the admin area, when they update a product's stock level, then the change must be reflected in the public catalogue.",
    test: {
      title: "the admin updates a product's stock level and the public catalogue reflects it",
      assertions: [
        'await page.getByLabel("Name", { exact: true }).fill("Stock Test Grinder");',
        'await page.getByLabel(/^Price/).fill("89.00");',
        'await page.getByLabel("Description").fill("A hand grinder used to check stock updates.");',
        'await page.getByLabel(/Stock/).fill("0");',
        'await expect(page.getByRole("cell", { name: "Stock Test Grinder" })).toBeVisible();',
        'await expect(page.getByText("Out of stock")).toBeVisible();',
        'await expect(page.getByRole("button", { name: "Add to cart" })).toHaveCount(0);',
        'await page.getByLabel(/Stock/).fill("4");',
        "await expect(page).toHaveURL(/\\/dashboard\\/products$/);",
        'await expect(page.getByTestId("stock")).toHaveText("4 in stock");',
        'await expect(page.getByRole("button", { name: "Add to cart" })).toBeVisible();',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-36",
    criterion:
      "Given a product catalogue, when a user searches for a term, then only products matching the term are displayed.",
    test: {
      title: "shoppers search the catalogue by product name: only matching products are listed",
      assertions: [
        '.or(page.getByLabel("Search products"))',
        'await expect(page.getByRole("link", { name: /Linen Shirt/ }).first()).toBeVisible();',
        'await expect(page.getByRole("link", { name: /Cotton Tee/ })).toHaveCount(0);',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-37",
    criterion:
      "Given a product list, when a user clicks a product, then the application navigates to that specific product's detail page.",
    test: {
      title: "a shopper clicks a product in the list and lands on that product's detail page",
      assertions: [
        "await expect(page).toHaveURL(/\\/shop\\/[^/?]+$/);",
        'await expect(page.getByRole("heading", { level: 1, name: "Ethiopia Yirgacheffe" })).toBeVisible();',
        'await expect(page.getByRole("button", { name: "Add to cart" })).toBeVisible();',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-38",
    criterion:
      "Given a product page, when a user clicks 'Add to Cart', then the item is added to the shopping cart with the correct initial quantity.",
    test: {
      title:
        "a shopper adds a product to the cart at its price with quantity one; changing the quantity updates the subtotal",
      assertions: [
        "await expect(page).toHaveURL(/\\/cart/);",
        'await expect(page.getByLabel("Quantity of Linen Shirt")).toHaveValue("1");',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("49.90");',
        'await page.getByLabel("Quantity of Linen Shirt").fill("3");',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("149.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-39",
    criterion:
      "Given a shopping cart, when a user changes an item's quantity, then the cart total is updated accordingly.",
    test: {
      title:
        "a shopper adds a product to the cart at its price with quantity one; changing the quantity updates the subtotal",
      assertions: [
        "await expect(page).toHaveURL(/\\/cart/);",
        'await expect(page.getByLabel("Quantity of Linen Shirt")).toHaveValue("1");',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("49.90");',
        'await page.getByLabel("Quantity of Linen Shirt").fill("3");',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("149.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-40",
    criterion:
      "Given a cart with items, when a user proceeds to checkout, then they are redirected to a Stripe Checkout session with server-computed amounts.",
    test: {
      title:
        "pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged",
      assertions: [
        'await expect(page.getByRole("heading", { name: "Linen Shirt", level: 1 })).toBeVisible();',
        'await expect(page.getByTestId("price")).toContainText("49.90");',
        'await page.getByLabel("Quantity").fill("2");',
        'await expect(page.getByTestId("cart-total")).toContainText("99.80");',
        'await expect(page.getByTestId("price")).toContainText("From");',
        "await page.getByLabel(/^L —/).check();",
        'await expect(page.getByText("Cotton Tee — L")).toBeVisible();',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("121.80");',
        'await page.getByLabel("Ship to").selectOption("ES");',
        'await expect(page.getByTestId("cart-shipping")).toContainText("4.90");',
        'await expect(page.getByTestId("cart-tax")).toContainText("21.99");',
        'await expect(page.getByTestId("cart-total")).toContainText("126.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-41",
    criterion:
      "Given a successful Stripe payment, when the signed webhook is received, then the order status is marked as paid.",
    test: {
      title:
        "pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged",
      assertions: [
        'await expect(page.getByRole("heading", { name: "Linen Shirt", level: 1 })).toBeVisible();',
        'await expect(page.getByTestId("price")).toContainText("49.90");',
        'await page.getByLabel("Quantity").fill("2");',
        'await expect(page.getByTestId("cart-total")).toContainText("99.80");',
        'await expect(page.getByTestId("price")).toContainText("From");',
        "await page.getByLabel(/^L —/).check();",
        'await expect(page.getByText("Cotton Tee — L")).toBeVisible();',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("121.80");',
        'await page.getByLabel("Ship to").selectOption("ES");',
        'await expect(page.getByTestId("cart-shipping")).toContainText("4.90");',
        'await expect(page.getByTestId("cart-tax")).toContainText("21.99");',
        'await expect(page.getByTestId("cart-total")).toContainText("126.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-42",
    criterion:
      "Given a successful Stripe payment, when the signed webhook is received, then the corresponding product stock is decremented in the database.",
    test: {
      title:
        "pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged",
      assertions: [
        'await expect(page.getByRole("heading", { name: "Linen Shirt", level: 1 })).toBeVisible();',
        'await expect(page.getByTestId("price")).toContainText("49.90");',
        'await page.getByLabel("Quantity").fill("2");',
        'await expect(page.getByTestId("cart-total")).toContainText("99.80");',
        'await expect(page.getByTestId("price")).toContainText("From");',
        "await page.getByLabel(/^L —/).check();",
        'await expect(page.getByText("Cotton Tee — L")).toBeVisible();',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("121.80");',
        'await page.getByLabel("Ship to").selectOption("ES");',
        'await expect(page.getByTestId("cart-shipping")).toContainText("4.90");',
        'await expect(page.getByTestId("cart-tax")).toContainText("21.99");',
        'await expect(page.getByTestId("cart-total")).toContainText("126.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-43",
    criterion:
      "Given an authenticated owner, when they access the admin area, then they can create, read, update, and delete products.",
    test: {
      title: "the admin creates a product with an image",
      assertions: [
        'await page.getByLabel("Name").fill("Linen Shirt");',
        'await page.getByLabel(/^Price/).fill("49.90");',
        'await page.getByLabel("Description").fill("A breathable linen shirt for summer days.");',
        'await page.getByLabel(/Stock/).fill("5");',
        ".getByLabel(/upload an image/)",
        'await expect(page.getByRole("cell", { name: "Linen Shirt" })).toBeVisible();',
      ],
    },
    met: false,
  },
  {
    id: "rule-shop-44",
    criterion:
      "Given an authenticated owner, when they access the admin area, then they can view a list of all orders.",
    test: {
      title: "the admin sees every order with its payment status in the orders section",
      assertions: [
        "await expect(page.locator('tr[data-status=\"paid\"]').first()).toBeVisible();",
        "await expect(page.locator('tr[data-status=\"pending\"]').first()).toBeVisible();",
        'expect(await page.locator("tr[data-order-id]").count()).toBeGreaterThanOrEqual(3);',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-45",
    criterion:
      "Given a completed order, when the system processes the payment, then an order confirmation email is logged to the console if no email provider is configured.",
    test: {
      title:
        "pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged",
      assertions: [
        'await expect(page.getByRole("heading", { name: "Linen Shirt", level: 1 })).toBeVisible();',
        'await expect(page.getByTestId("price")).toContainText("49.90");',
        'await page.getByLabel("Quantity").fill("2");',
        'await expect(page.getByTestId("cart-total")).toContainText("99.80");',
        'await expect(page.getByTestId("price")).toContainText("From");',
        "await page.getByLabel(/^L —/).check();",
        'await expect(page.getByText("Cotton Tee — L")).toBeVisible();',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("121.80");',
        'await page.getByLabel("Ship to").selectOption("ES");',
        'await expect(page.getByTestId("cart-shipping")).toContainText("4.90");',
        'await expect(page.getByTestId("cart-tax")).toContainText("21.99");',
        'await expect(page.getByTestId("cart-total")).toContainText("126.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-46",
    criterion:
      "Given a user is browsing the catalogue, when they enter a search term, then the displayed products must match the query.",
    test: {
      title: "shoppers search the catalogue by product name: only matching products are listed",
      assertions: [
        '.or(page.getByLabel("Search products"))',
        'await expect(page.getByRole("link", { name: /Linen Shirt/ }).first()).toBeVisible();',
        'await expect(page.getByRole("link", { name: /Cotton Tee/ })).toHaveCount(0);',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-47",
    criterion:
      "Given a user is on a product page, when they click 'Add to Cart', then the item must appear in their shopping cart.",
    test: {
      title:
        "a shopper adds a product to the cart at its price with quantity one; changing the quantity updates the subtotal",
      assertions: [
        "await expect(page).toHaveURL(/\\/cart/);",
        'await expect(page.getByLabel("Quantity of Linen Shirt")).toHaveValue("1");',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("49.90");',
        'await page.getByLabel("Quantity of Linen Shirt").fill("3");',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("149.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-48",
    criterion:
      "Given a user has items in their cart, when they adjust the quantity, then the cart total must update accordingly.",
    test: {
      title:
        "a shopper adds a product to the cart at its price with quantity one; changing the quantity updates the subtotal",
      assertions: [
        "await expect(page).toHaveURL(/\\/cart/);",
        'await expect(page.getByLabel("Quantity of Linen Shirt")).toHaveValue("1");',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("49.90");',
        'await page.getByLabel("Quantity of Linen Shirt").fill("3");',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("149.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-49",
    criterion:
      "Given a user initiates checkout, when they are redirected to Stripe, then the payment amount must match the server-calculated total.",
    test: {
      title:
        "pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged",
      assertions: [
        'await expect(page.getByRole("heading", { name: "Linen Shirt", level: 1 })).toBeVisible();',
        'await expect(page.getByTestId("price")).toContainText("49.90");',
        'await page.getByLabel("Quantity").fill("2");',
        'await expect(page.getByTestId("cart-total")).toContainText("99.80");',
        'await expect(page.getByTestId("price")).toContainText("From");',
        "await page.getByLabel(/^L —/).check();",
        'await expect(page.getByText("Cotton Tee — L")).toBeVisible();',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("121.80");',
        'await page.getByLabel("Ship to").selectOption("ES");',
        'await expect(page.getByTestId("cart-shipping")).toContainText("4.90");',
        'await expect(page.getByTestId("cart-tax")).toContainText("21.99");',
        'await expect(page.getByTestId("cart-total")).toContainText("126.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-50",
    criterion:
      "Given a successful Stripe payment, when the signed webhook is received, then the order status must change to 'paid'.",
    test: {
      title:
        "pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged",
      assertions: [
        'await expect(page.getByRole("heading", { name: "Linen Shirt", level: 1 })).toBeVisible();',
        'await expect(page.getByTestId("price")).toContainText("49.90");',
        'await page.getByLabel("Quantity").fill("2");',
        'await expect(page.getByTestId("cart-total")).toContainText("99.80");',
        'await expect(page.getByTestId("price")).toContainText("From");',
        "await page.getByLabel(/^L —/).check();",
        'await expect(page.getByText("Cotton Tee — L")).toBeVisible();',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("121.80");',
        'await page.getByLabel("Ship to").selectOption("ES");',
        'await expect(page.getByTestId("cart-shipping")).toContainText("4.90");',
        'await expect(page.getByTestId("cart-tax")).toContainText("21.99");',
        'await expect(page.getByTestId("cart-total")).toContainText("126.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-51",
    criterion:
      "Given a successful Stripe payment, when the signed webhook is received, then the product stock must be decremented by the ordered amount.",
    test: {
      title:
        "pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged",
      assertions: [
        'await expect(page.getByRole("heading", { name: "Linen Shirt", level: 1 })).toBeVisible();',
        'await expect(page.getByTestId("price")).toContainText("49.90");',
        'await page.getByLabel("Quantity").fill("2");',
        'await expect(page.getByTestId("cart-total")).toContainText("99.80");',
        'await expect(page.getByTestId("price")).toContainText("From");',
        "await page.getByLabel(/^L —/).check();",
        'await expect(page.getByText("Cotton Tee — L")).toBeVisible();',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("121.80");',
        'await page.getByLabel("Ship to").selectOption("ES");',
        'await expect(page.getByTestId("cart-shipping")).toContainText("4.90");',
        'await expect(page.getByTestId("cart-tax")).toContainText("21.99");',
        'await expect(page.getByTestId("cart-total")).toContainText("126.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-52",
    criterion:
      "Given a successful order, when the system processes the payment, then an order confirmation email must be sent or logged.",
    test: {
      title:
        "pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged",
      assertions: [
        'await expect(page.getByRole("heading", { name: "Linen Shirt", level: 1 })).toBeVisible();',
        'await expect(page.getByTestId("price")).toContainText("49.90");',
        'await page.getByLabel("Quantity").fill("2");',
        'await expect(page.getByTestId("cart-total")).toContainText("99.80");',
        'await expect(page.getByTestId("price")).toContainText("From");',
        "await page.getByLabel(/^L —/).check();",
        'await expect(page.getByText("Cotton Tee — L")).toBeVisible();',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("121.80");',
        'await page.getByLabel("Ship to").selectOption("ES");',
        'await expect(page.getByTestId("cart-shipping")).toContainText("4.90");',
        'await expect(page.getByTestId("cart-tax")).toContainText("21.99");',
        'await expect(page.getByTestId("cart-total")).toContainText("126.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-53",
    criterion:
      "Given an authenticated owner, when they access the admin area, then they must be able to create or edit products.",
    test: {
      title: "the admin creates a product with an image",
      assertions: [
        'await page.getByLabel("Name").fill("Linen Shirt");',
        'await page.getByLabel(/^Price/).fill("49.90");',
        'await page.getByLabel("Description").fill("A breathable linen shirt for summer days.");',
        'await page.getByLabel(/Stock/).fill("5");',
        ".getByLabel(/upload an image/)",
        'await expect(page.getByRole("cell", { name: "Linen Shirt" })).toBeVisible();',
      ],
    },
    met: false,
  },
  {
    id: "rule-shop-54",
    criterion:
      "Given an authenticated owner, when they access the admin area, then they must be able to view a list of all orders.",
    test: {
      title: "the admin sees every order with its payment status in the orders section",
      assertions: [
        "await expect(page.locator('tr[data-status=\"paid\"]').first()).toBeVisible();",
        "await expect(page.locator('tr[data-status=\"pending\"]').first()).toBeVisible();",
        'expect(await page.locator("tr[data-order-id]").count()).toBeGreaterThanOrEqual(3);',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-55",
    criterion:
      "Given a user proceeds to checkout, when they complete the Stripe payment, then the server must receive a signed webhook to process the order.",
    test: {
      title:
        "pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged",
      assertions: [
        'await expect(page.getByRole("heading", { name: "Linen Shirt", level: 1 })).toBeVisible();',
        'await expect(page.getByTestId("price")).toContainText("49.90");',
        'await page.getByLabel("Quantity").fill("2");',
        'await expect(page.getByTestId("cart-total")).toContainText("99.80");',
        'await expect(page.getByTestId("price")).toContainText("From");',
        "await page.getByLabel(/^L —/).check();",
        'await expect(page.getByText("Cotton Tee — L")).toBeVisible();',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("121.80");',
        'await page.getByLabel("Ship to").selectOption("ES");',
        'await expect(page.getByTestId("cart-shipping")).toContainText("4.90");',
        'await expect(page.getByTestId("cart-tax")).toContainText("21.99");',
        'await expect(page.getByTestId("cart-total")).toContainText("126.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-56",
    criterion:
      "Given a successful payment webhook is received, then the product stock level in the database must decrement by the ordered amount.",
    test: {
      title:
        "pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged",
      assertions: [
        'await expect(page.getByRole("heading", { name: "Linen Shirt", level: 1 })).toBeVisible();',
        'await expect(page.getByTestId("price")).toContainText("49.90");',
        'await page.getByLabel("Quantity").fill("2");',
        'await expect(page.getByTestId("cart-total")).toContainText("99.80");',
        'await expect(page.getByTestId("price")).toContainText("From");',
        "await page.getByLabel(/^L —/).check();",
        'await expect(page.getByText("Cotton Tee — L")).toBeVisible();',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("121.80");',
        'await page.getByLabel("Ship to").selectOption("ES");',
        'await expect(page.getByTestId("cart-shipping")).toContainText("4.90");',
        'await expect(page.getByTestId("cart-tax")).toContainText("21.99");',
        'await expect(page.getByTestId("cart-total")).toContainText("126.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-57",
    criterion:
      "Given a successful order, when no email provider is configured, then the order confirmation must be recorded in the system logs.",
    test: {
      title:
        "pays with Stripe Checkout: server-computed amounts, signed webhook marks the order paid, stock decremented, confirmation email logged",
      assertions: [
        'await expect(page.getByRole("heading", { name: "Linen Shirt", level: 1 })).toBeVisible();',
        'await expect(page.getByTestId("price")).toContainText("49.90");',
        'await page.getByLabel("Quantity").fill("2");',
        'await expect(page.getByTestId("cart-total")).toContainText("99.80");',
        'await expect(page.getByTestId("price")).toContainText("From");',
        "await page.getByLabel(/^L —/).check();",
        'await expect(page.getByText("Cotton Tee — L")).toBeVisible();',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("121.80");',
        'await page.getByLabel("Ship to").selectOption("ES");',
        'await expect(page.getByTestId("cart-shipping")).toContainText("4.90");',
        'await expect(page.getByTestId("cart-tax")).toContainText("21.99");',
        'await expect(page.getByTestId("cart-total")).toContainText("126.70");',
      ],
    },
    met: true,
  },
  {
    id: "rule-shop-58",
    criterion:
      "Given an authenticated owner, when they access the admin area, then they must be able to create or edit product details.",
    test: {
      title:
        "a shopper adds a product to the cart at its price with quantity one; changing the quantity updates the subtotal",
      assertions: [
        "await expect(page).toHaveURL(/\\/cart/);",
        'await expect(page.getByLabel("Quantity of Linen Shirt")).toHaveValue("1");',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("49.90");',
        'await page.getByLabel("Quantity of Linen Shirt").fill("3");',
        'await expect(page.getByTestId("cart-subtotal")).toContainText("149.70");',
      ],
    },
    met: false,
  },
  {
    id: "rule-shop-59",
    criterion:
      "Given the application is running, when the 'test:e2e' script is executed, then all Playwright tests must pass using the provided environment variables.",
    test: {
      title:
        "E2E owns its URLs: auth runs on the server Playwright started, whatever the ambient BETTER_AUTH_URL",
      assertions: [
        "expect(process.env.BETTER_AUTH_URL).toBe(baseURL);",
        "await expect(page).toHaveURL(new RegExp(`^${baseURL}/dashboard`));",
        'await expect(page.getByTestId("role")).toHaveText("owner");',
      ],
    },
    met: false,
  },
];
