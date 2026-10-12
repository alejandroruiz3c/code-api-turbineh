import { describe, expect, it } from "vitest";
import { simpleParser } from "mailparser";
describe("mailparser contract", () => {
  it("parses a raw MIME email with an attachment", async () => {
    const raw = [
      "From: Ana <ana@example.test>",
      "To: support@example.test",
      "Subject: Refund for order o-42",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "The parcel arrived damaged.",
      "--b1",
      'Content-Type: text/plain; name="note.txt"',
      'Content-Disposition: attachment; filename="note.txt"',
      "",
      "photo to follow",
      "--b1--",
      "",
    ].join("\r\n");
    const mail = await simpleParser(raw);
    expect(mail.subject).toBe("Refund for order o-42");
    expect(mail.from?.value[0]?.address).toBe("ana@example.test");
    expect(mail.text?.trim()).toBe("The parcel arrived damaged.");
    expect(mail.attachments.map((a) => a.filename)).toEqual(["note.txt"]);
  });
});
