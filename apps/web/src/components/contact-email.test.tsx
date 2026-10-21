import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AccessPage from "@/app/access/page";
import { EMAIL_PURPOSE, looksLikeEmail } from "@/lib/contact";
import { NotifyWhenCoveredView } from "./contact-email";
import { NotCovered } from "./not-covered";

/** ADR-0074: the access page asks for the email and says what it is for; the not-covered screen offers to notify. */

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&");

describe("/access", () => {
  it("asks for the token and a required email, with its purpose", async () => {
    const html = renderToStaticMarkup(await AccessPage({ searchParams: Promise.resolve({}) }));
    expect(html).toMatch(/<input[^>]*name="email"[^>]*>/);
    const email = html.match(/<input[^>]*name="email"[^>]*>/)?.[0] ?? "";
    expect(email).toContain('type="email"');
    expect(email).toContain("required");
    expect(text(html)).toContain(EMAIL_PURPOSE);
    expect(html).not.toContain('role="alert"');
  });

  it("names the field that was wrong", async () => {
    const bad = text(
      renderToStaticMarkup(await AccessPage({ searchParams: Promise.resolve({ error: "email" }) })),
    );
    expect(bad).toContain("Enter a valid email address.");
    expect(bad).not.toContain("That token is not valid");
    const token = text(
      renderToStaticMarkup(await AccessPage({ searchParams: Promise.resolve({ error: "token" }) })),
    );
    expect(token).toContain("That token is not valid");
  });
});

describe("Notify me when it's covered", () => {
  const view = (
    state: Parameters<typeof NotifyWhenCoveredView>[0]["state"],
    error: string | null = null,
  ) =>
    renderToStaticMarkup(
      <NotifyWhenCoveredView
        state={state}
        email=""
        busy={false}
        error={error}
        onEmail={() => {}}
        onSubmit={() => {}}
      />,
    );

  it("asks for an email only when none is on file", () => {
    const ask = view("ask");
    expect(ask).toContain('data-testid="notify-when-covered"');
    expect(text(ask)).toContain("Notify me when it's covered");
    expect(text(ask)).toContain(EMAIL_PURPOSE);
    expect(ask).toMatch(/<input[^>]*type="email"[^>]*required/);
    expect(view("on_file")).toContain('data-testid="notify-on-file"');
    expect(view("on_file")).not.toContain("<input");
    expect(text(view("saved"))).toContain("you're on the priority list");
    expect(view("loading")).toBe("");
    expect(view("hidden")).toBe("");
    expect(text(view("ask", "Enter a valid email address."))).toContain(
      "Enter a valid email address.",
    );
  });

  it("the not-covered explanation renders with the flow id (the field loads in the browser)", () => {
    const html = renderToStaticMarkup(
      <NotCovered
        flowId="00000000-0000-4000-8000-000000000001"
        explanation={{
          title: "The library doesn't cover this use case yet.",
          useCase: "automatic seller payouts",
          notCovered: [
            {
              requirement: "Automatic seller payouts",
              covered: false,
              why: "no verified component yet",
            },
          ],
          priority: "We'll notify you with priority as soon as it does.",
          canDoNow: "Build a covered use case.",
          offer: null,
        }}
      />,
    );
    expect(html).toContain('data-testid="not-covered-explanation"');
  });

  it("validates like the server", () => {
    expect(looksLikeEmail(" person@example.com ")).toBe(true);
    for (const bad of ["", "person", "a@b", "two words@example.com"])
      expect(looksLikeEmail(bad)).toBe(false);
  });
});
