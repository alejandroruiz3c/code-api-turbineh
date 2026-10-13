import { describe, expect, it } from "vitest";
import { proofVerdict, type ProofAlias, type ProofCandidate } from "./criterion-proof.js";

/** Criteria aliases (ADR-0047): a component's declared words, resolved from this app's params. */
const ALIASES: ProofAlias[] = [
  { term: "customer", means: ["patient"] },
  { term: "staff member", means: ["physiotherapist"] },
  { term: "business", means: ["flex physio", "clinic"] },
  { term: "service", means: ["first visit", "follow-up"], asserted: "params\\.services" },
];

const pricing =
  "Given a patient asks about pricing, when the assistant responds, then it must state 60 € for the first visit and 50 € for follow-ups.";

const pricesTest = (assertions: string[]): ProofCandidate => ({
  title:
    "a customer asks about prices: the assistant responds stating each service with its price, from the business's data",
  assertions,
  aliases: ALIASES,
});

describe("criteria aliases", () => {
  it("a declared word alias names the actor when the test uses the component's word", () => {
    const cancel =
      "Given a patient requests to cancel, when the appointment is less than 24 hours away, then the assistant must refuse the cancellation.";
    const test: ProofCandidate = {
      title:
        "a customer requests to cancel a booking that starts less than the notice hours away: the assistant refuses the cancellation",
    };
    expect(proofVerdict(cancel, test).reason).toMatch(/does not act as patient/);
    expect(proofVerdict(cancel, { ...test, aliases: ALIASES }).proven).toBe(true);
  });

  it("applies a word alias only when the test names its term", () => {
    const test: ProofCandidate = {
      title: "the assistant refuses to cancel a booking inside the notice period",
      aliases: ALIASES,
    };
    expect(proofVerdict("A patient cannot cancel inside the notice period.", test).reason).toMatch(
      /patient/,
    );
  });

  it("counts a fact only when the test asserts the value from params", () => {
    expect(
      proofVerdict(
        pricing,
        pricesTest([
          'expect(reply, "states each service and its price from params.services").toContain(`${s.name} ${s.price}`);',
        ]),
      ).proven,
    ).toBe(true);
    // Same title, but nothing asserts the services of params: "first visit" and "follow-ups" are not proven.
    expect(
      proofVerdict(pricing, pricesTest(['expect(reply).toContain("Prices:");'])).reason,
    ).toMatch(/first, visit, follow/);
  });

  it("never lets an alias stand in for a refusal", () => {
    const refusing: ProofAlias[] = [{ term: "customer", means: ["patient", "cannot book"] }];
    expect(
      proofVerdict("A patient cannot book outside the opening hours.", {
        title: "a customer books outside the opening hours",
        aliases: refusing,
      }).reason,
    ).toMatch(/refusal/);
  });

  it("does not equate words the params do not define (therapist ≠ physiotherapist)", () => {
    expect(
      proofVerdict(
        "Given a patient provides a chosen therapist, the assistant books with that therapist.",
        {
          title: "a customer books with the chosen staff member through the assistant",
          aliases: ALIASES,
        },
      ).reason,
    ).toMatch(/therapist/);
  });
});
