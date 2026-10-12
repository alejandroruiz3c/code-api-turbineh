import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

function sign(body: string): string {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET ?? "")
    .update(`${t}.${body}`)
    .digest("hex")}`;
}

test("an owner subscribes to Pro and the plan follows Stripe's signed events", async ({
  page,
  request,
}) => {
  await page.goto("/dashboard/billing");
  await expect(page.getByTestId("plan")).toHaveText("Free");
  const org = (await page.locator("[data-workspace]").getAttribute("data-workspace")) ?? "";
  await page.route("https://checkout.stripe.com/**", (r) =>
    r.fulfill({ body: "Stripe Checkout (simulated)", contentType: "text/plain" }),
  );
  await page.getByRole("button", { name: "Upgrade to Pro" }).click();
  await page.waitForURL(/checkout\.stripe\.com/);
  await page.unroute("https://checkout.stripe.com/**");

  const send = async (event: unknown) => {
    const body = JSON.stringify(event);
    const res = await request.post("/api/billing/webhook", {
      data: body,
      headers: { "content-type": "application/json", "stripe-signature": sign(body) },
    });
    expect(res.status()).toBe(200);
  };
  await send({
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_sub",
        mode: "subscription",
        customer: "cus_test",
        subscription: "sub_test",
        client_reference_id: org,
      },
    },
  });
  await page.goto("/dashboard/billing");
  await expect(page.getByTestId("plan")).toHaveText("Pro");

  await send({
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_test",
        customer: "cus_test",
        status: "canceled",
        metadata: { organization_id: org },
      },
    },
  });
  await page.goto("/dashboard/billing");
  await expect(page.getByTestId("plan")).toHaveText("Free");

  const forged = await request.post("/api/billing/webhook", {
    data: "{}",
    headers: { "stripe-signature": "t=1,v1=00" },
  });
  expect(forged.status()).toBe(400);
});
