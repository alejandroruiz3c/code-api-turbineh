import { describe, expect, it } from "vitest";
import { Webhook } from "standardwebhooks";
describe("standardwebhooks contract", () => {
  it("verifies a signed payload and rejects tampering", () => {
    const wh = new Webhook(Buffer.from("secret-for-tests").toString("base64"));
    const id = "msg_1";
    const ts = new Date();
    const payload = JSON.stringify({ a: 1 });
    const sig = wh.sign(id, ts, payload);
    const headers = {
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(ts.getTime() / 1000)),
      "webhook-signature": sig,
    };
    expect(wh.verify(payload, headers)).toEqual({ a: 1 });
    expect(() => wh.verify(payload.replace("1", "2"), headers)).toThrow();
  });
});
