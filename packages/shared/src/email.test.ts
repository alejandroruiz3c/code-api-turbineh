import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DEMAND_ALERT_EMAIL,
  DEFAULT_EMAIL_FROM,
  escapeHtml,
  isEmailAddress,
  mailerFromEnv,
  resendMailer,
  resetMailerWarning,
} from "./email.js";

afterEach(() => {
  vi.restoreAllMocks();
  resetMailerWarning();
});

describe("resendMailer", () => {
  it("posts one message to the Resend API with the key, sender and idempotency key", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "em_1" }));
    const mailer = resendMailer({ apiKey: "re_test_key", fetch: fetchMock as typeof fetch });
    const r = await mailer.send({
      to: "person@example.com",
      subject: "s",
      html: "<p>h</p>",
      text: "t",
      idempotencyKey: "k-1",
    });
    expect(r).toEqual({ ok: true, id: "em_1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");
    expect(headers["Idempotency-Key"]).toBe("k-1");
    expect(JSON.parse(init.body as string)).toEqual({
      from: DEFAULT_EMAIL_FROM,
      to: ["person@example.com"],
      subject: "s",
      html: "<p>h</p>",
      text: "t",
    });
  });

  it("sends attachments base64-encoded (ADR-0061)", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "em_2" }));
    const mailer = resendMailer({ apiKey: "re_test_key", fetch: fetchMock as typeof fetch });
    await mailer.send({
      to: "owner@example.com",
      subject: "s",
      html: "h",
      text: "t",
      attachments: [{ filename: "people.csv", content: "email,name\r\nañ@x.test,Ñ\r\n" }],
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      attachments: { filename: string; content: string }[];
    };
    expect(body.attachments[0]?.filename).toBe("people.csv");
    expect(Buffer.from(body.attachments[0]?.content ?? "", "base64").toString("utf8")).toBe(
      "email,name\r\nañ@x.test,Ñ\r\n",
    );
  });

  it("returns failures instead of throwing (HTTP error and network error)", async () => {
    const http = resendMailer({
      apiKey: "k",
      fetch: (async () =>
        Response.json({ name: "validation_error" }, { status: 422 })) as typeof fetch,
    });
    expect(await http.send({ to: "a@b.co", subject: "s", html: "", text: "" })).toEqual({
      ok: false,
      status: 422,
      error: "validation_error",
    });
    const down = resendMailer({
      apiKey: "k",
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    expect(await down.send({ to: "a@b.co", subject: "s", html: "", text: "" })).toMatchObject({
      ok: false,
      status: 0,
    });
  });
});

describe("mailerFromEnv", () => {
  it("is null without RESEND_API_KEY and warns once", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(mailerFromEnv({})).toBeNull();
    expect(mailerFromEnv({ RESEND_API_KEY: "" })).toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("reads the sender, owner alert address and app URL, with defaults", () => {
    const d = mailerFromEnv({ RESEND_API_KEY: "k" });
    expect(d?.from).toBe(DEFAULT_EMAIL_FROM);
    expect(d?.ownerAlertTo).toBe(DEFAULT_DEMAND_ALERT_EMAIL);
    expect(d?.appUrl).toBe("https://software.turbineh.com");
    const c = mailerFromEnv({
      RESEND_API_KEY: "k",
      EMAIL_FROM: "TurbineH <x@turbineh.com>",
      DEMAND_ALERT_EMAIL: "ops@turbineh.com",
      BETTER_AUTH_URL: "https://staging.software.turbineh.com/",
    });
    expect(c).toMatchObject({
      from: "TurbineH <x@turbineh.com>",
      ownerAlertTo: "ops@turbineh.com",
      appUrl: "https://staging.software.turbineh.com",
    });
  });
});

describe("escapeHtml / isEmailAddress", () => {
  it("escapes markup and quotes", () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe(
      "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;",
    );
  });
  it("accepts one plain address only", () => {
    expect(isEmailAddress("a.b@turbineh.com")).toBe(true);
    expect(isEmailAddress("A <a@b.co>")).toBe(false);
    expect(isEmailAddress("a@b.co, c@d.co")).toBe(false);
    expect(isEmailAddress("a@b.co\r\nBcc: x@y.z")).toBe(false);
    expect(isEmailAddress(null)).toBe(false);
  });
});
