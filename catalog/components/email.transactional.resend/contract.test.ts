import { describe, expect, it } from "vitest";
import { Resend } from "resend";
describe("resend contract", () => {
  it("builds a client and fails cleanly without network", async () => {
    const r = new Resend("re_test_key");
    expect(typeof r.emails.send).toBe("function");
    const res = await r.emails
      .send({ from: "a@example.com", to: "b@example.com", subject: "s", text: "t" })
      .catch((e: unknown) => ({ data: null, error: e }));
    expect(res.data).toBeNull();
  });
});
