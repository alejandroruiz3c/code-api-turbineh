import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { OWNER_EMAIL, signIn } from "./helpers";

/**
 * Matching (component domain.matching.turbineh): an organization's profile, its records (opportunities, tenders…)
 * with search and filters, deterministic matches with their reasons, feedback, and strict organization isolation on
 * pages and on the JSON API. Each title states the criterion it proves.
 */
type Params = { entity: { singular: string; plural: string } };
const params = JSON.parse(readFileSync("src/matching/params.json", "utf8")) as Params;
const { singular } = params.entity;
const RUN = Date.now().toString(36);
const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const records = {
  solar: {
    title: `Solar plant EPC ${RUN}`,
    description: `Design and installation of a 5 MW solar plant with battery storage (${RUN}).`,
    sector: "Renewable energy",
    activity: "Installation",
    region: "Sevilla, Andalucía",
    deadline: iso(40),
    sourceUrl: `https://tenders.example.org/notice/${RUN}`,
  },
  battery: {
    title: `Battery storage pilot ${RUN}`,
    description: `Municipal pilot (${RUN}).`,
    sector: "Utilities",
    activity: "Consulting",
    region: "Porto, Portugal",
    deadline: iso(10),
    sourceUrl: "",
  },
  cleaning: {
    title: `Office cleaning ${RUN}`,
    description: `Cleaning services (${RUN}).`,
    sector: "Facilities",
    activity: "Cleaning",
    region: "Madrid",
    deadline: iso(20),
    sourceUrl: "",
  },
  expired: {
    title: `Expired solar call ${RUN}`,
    description: `Closed call for solar installers (${RUN}).`,
    sector: "Renewable energy",
    activity: "Installation",
    region: "Andalucía",
    deadline: "2020-01-15",
    sourceUrl: "",
  },
};
const ids: Record<string, string> = {};

async function addRecord(page: Page, r: (typeof records)[keyof typeof records]): Promise<string> {
  await page.goto("/dashboard/matching/records");
  await page.getByLabel("Title").fill(r.title);
  await page.getByLabel("Description").fill(r.description);
  await page.getByLabel("Sector", { exact: true }).last().fill(r.sector);
  await page.getByLabel("Activity").fill(r.activity);
  await page.getByLabel("Region", { exact: true }).last().fill(r.region);
  await page.getByLabel("Deadline", { exact: true }).fill(r.deadline);
  if (r.sourceUrl) await page.getByLabel("Source URL").fill(r.sourceUrl);
  await page.getByRole("button", { name: `Add ${singular}` }).click();
  await expect(page).toHaveURL(/\/dashboard\/matching\/records\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: r.title })).toBeVisible();
  return page.url().split("/").at(-1) ?? "";
}

const matchRows = (page: Page) => page.getByTestId("match-row").filter({ hasText: RUN });

test.describe.serial("matching", () => {
  test("the organization saves its profile with sectors, business activities, geographic coverage and interest keywords", async ({
    page,
  }) => {
    await page.goto("/dashboard/matching/profile");
    await page.getByLabel("Sectors").fill("Renewable energy");
    await page.getByLabel("Business activities").fill("Installation");
    await page.getByLabel("Geographic coverage").fill("Andalucía, Portugal");
    await page.getByLabel("Interest keywords").fill("solar\nbattery storage");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByRole("status")).toHaveText("Profile saved.");
    await page.reload();
    await expect(page.getByLabel("Geographic coverage")).toHaveValue("Andalucía\nPortugal");
    await expect(page.getByLabel("Interest keywords")).toHaveValue("solar\nbattery storage");
  });

  test("the owner adds opportunities and finds them by text search and by sector, region, status and deadline filters", async ({
    page,
  }) => {
    for (const [key, r] of Object.entries(records)) ids[key] = await addRecord(page, r);
    const list = (query: string) => page.goto(`/dashboard/matching/records?${query}`);
    const rows = page.getByTestId("record-row").filter({ hasText: RUN });
    await list(`q=${encodeURIComponent("battery storage pilot")}`);
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(records.battery.title);
    await list(`q=${RUN}&sector=${encodeURIComponent("renewable")}`);
    await expect(rows).toHaveCount(2);
    await list(`q=${RUN}&region=portugal`);
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(records.battery.title);
    await list(`q=${RUN}&before=${iso(15)}`);
    await expect(rows).toHaveCount(2); // battery (in 10 days) and the expired call
    // Closing a record: the status filter finds it.
    await page.goto(`/dashboard/matching/records/${ids.cleaning}`);
    await page.getByLabel("Status").selectOption("closed");
    await page.getByRole("button", { name: `Save ${singular}` }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");
    await list(`q=${RUN}&status=closed`);
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(records.cleaning.title);
  });

  test("the detail page shows the full description, the source link and why it matches the organization's profile", async ({
    page,
  }) => {
    await page.goto(`/dashboard/matching/records/${ids.solar}`);
    await expect(page.getByTestId("record-description")).toHaveText(records.solar.description);
    await expect(page.getByTestId("record-source")).toHaveAttribute(
      "href",
      records.solar.sourceUrl,
    );
    await expect(page.getByTestId("record-why")).toContainText("sector: Renewable energy");
    await expect(page.getByTestId("record-why")).toContainText("region: Andalucía");
  });

  test("the dashboard shows the opportunities that match the organization's interests, best first, with why each one matches", async ({
    page,
  }) => {
    await page.goto("/dashboard/matching");
    const rows = matchRows(page);
    // solar: sector 3 + activity 2 + region 2 + keywords solar 1 + battery storage 1 = 9; battery: region 2 + keyword 1.
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(records.solar.title);
    await expect(rows.nth(0).getByTestId("match-score")).toHaveText("Score 9");
    await expect(rows.nth(0).getByTestId("match-why")).toHaveText(
      "Why: sector: Renewable energy, activity: Installation, region: Andalucía, keyword: solar, keyword: battery storage",
    );
    await expect(rows.nth(1)).toContainText(records.battery.title);
    await expect(rows.nth(1).getByTestId("match-why")).toHaveText(
      "Why: region: Portugal, keyword: battery storage",
    );
    // Not matched: nothing in common (and closed), or past its deadline.
    await expect(page.getByText(records.cleaning.title)).toHaveCount(0);
    await expect(page.getByText(records.expired.title)).toHaveCount(0);
  });

  test("a member marks an opportunity not relevant and it leaves the matches; interested is recorded", async ({
    page,
  }) => {
    await page.goto(`/dashboard/matching/records/${ids.battery}`);
    await page.getByRole("button", { name: "Not relevant" }).click();
    await expect(page.getByRole("button", { name: "Not relevant" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.goto("/dashboard/matching");
    await expect(matchRows(page)).toHaveCount(1);
    await expect(page.getByText(records.battery.title)).toHaveCount(0);
    await page.goto(`/dashboard/matching/records/${ids.solar}`);
    await page.getByRole("button", { name: "Interested" }).click();
    await expect(page.getByRole("button", { name: "Interested" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.goto("/dashboard/matching");
    await expect(matchRows(page)).toHaveCount(1);
  });

  test("the API answers only the active organization's records and matches, and refuses requests without a session", async ({
    page,
    browser,
  }) => {
    const list = await page.request.get(`/api/matching/opportunities?q=${RUN}`);
    expect(list.status()).toBe(200);
    const titles = ((await list.json()) as { data: { title: string }[] }).data.map((r) => r.title);
    expect(titles.sort()).toEqual(
      Object.values(records)
        .map((r) => r.title)
        .sort(),
    );
    const one = await page.request.get(`/api/matching/opportunities/${ids.solar}`);
    expect(one.status()).toBe(200);
    expect(((await one.json()) as { data: { sourceUrl: string } }).data.sourceUrl).toBe(
      records.solar.sourceUrl,
    );
    const matches = (await (await page.request.get("/api/matching/matches")).json()) as {
      data: { id: string; score: number; reasons: { text: string }[] }[];
    };
    const top = matches.data.find((m) => m.id === ids.solar);
    expect(top?.score).toBe(9);
    expect(top?.reasons.map((r) => r.text)).toContain("keyword: solar");
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const res = await anonymous.request.get(
      `${test.info().project.use.baseURL}/api/matching/matches`,
    );
    expect(res.status()).toBe(401);
    await anonymous.close();
  });

  test("a user cannot access data belonging to another organization: its record ids answer 404 on pages and in every API request, and lists never show them", async ({
    browser,
  }) => {
    // The same person in a second organization (fresh session; the stored owner session keeps its organization).
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await signIn(page, OWNER_EMAIL);
    await expect(page).toHaveURL(/\/dashboard/);
    await page.getByRole("link", { name: "+ New organization" }).click();
    await page.getByLabel("Organization name").fill(`Matching other ${RUN}`);
    await page.getByRole("button", { name: "Create organization" }).click();
    await expect(page.getByTestId("organization")).toHaveText(`Matching other ${RUN}`);
    for (const id of Object.values(ids)) {
      expect((await page.request.get(`/api/matching/opportunities/${id}`)).status()).toBe(404);
      const res = await page.goto(`/dashboard/matching/records/${id}`);
      expect(res?.status()).toBe(404);
    }
    const list = (await (
      await page.request.get(`/api/matching/opportunities?q=${RUN}`)
    ).json()) as {
      data: unknown[];
    };
    expect(list.data).toEqual([]);
    const matches = (await (await page.request.get("/api/matching/matches")).json()) as {
      data: unknown[];
    };
    expect(matches.data).toEqual([]);
    await page.goto("/dashboard/matching/profile");
    await expect(page.getByLabel("Sectors")).toHaveValue("");
    await page.goto("/dashboard/matching/records");
    await expect(page.getByTestId("record-row").filter({ hasText: RUN })).toHaveCount(0);
    await context.close();
  });
});
