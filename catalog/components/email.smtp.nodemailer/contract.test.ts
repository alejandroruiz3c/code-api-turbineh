import { describe, expect, it } from "vitest";
import nodemailer from "nodemailer";
describe("nodemailer contract", () => {
  it("builds a message with the JSON transport", async () => {
    const t = nodemailer.createTransport({ jsonTransport: true });
    const info = await t.sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "s",
      text: "t",
    });
    expect(JSON.parse(info.message as string).subject).toBe("s");
  });
});
