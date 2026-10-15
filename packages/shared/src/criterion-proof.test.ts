import { describe, expect, it } from "vitest";
import { proofVerdict, proofVeto } from "./criterion-proof.js";
import { PROOF_PAIRS, type ProofPair } from "./criterion-proof.fixtures.js";
import { RULE_PAIRS } from "./criterion-proof.rule-fixtures.js";

function score(pairs: ProofPair[]) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  const wrong: string[] = [];
  for (const p of pairs) {
    const v = proofVerdict(p.criterion, p.test);
    if (v.proven && p.met) tp++;
    else if (v.proven && !p.met) {
      fp++;
      wrong.push(`FP ${p.id}`);
    } else if (!v.proven && p.met) {
      fn++;
      wrong.push(`FN ${p.id}: ${v.reason}`);
    }
  }
  return {
    pairs: pairs.length,
    tp,
    fp,
    fn,
    precision: tp / Math.max(1, tp + fp),
    recall: tp / Math.max(1, tp + fn),
    wrong,
  };
}

describe("criterion → test proof (precision first)", () => {
  it("the false matches of production build f195341c all come out open", () => {
    for (const p of PROOF_PAIRS.filter((x) => x.id.startsWith("prod-")))
      expect({ id: p.id, proven: proofVerdict(p.criterion, p.test).proven }).toEqual({
        id: p.id,
        proven: false,
      });
  });

  it("the bookings test cited for seven unrelated criteria proves none of them (ADR-0043)", () => {
    const cited = RULE_PAIRS.filter(
      (p) => p.test.title === "the owner books a slot and sees it in the calendar" && !p.met,
    );
    expect(cited).toHaveLength(7);
    for (const p of cited) expect(proofVerdict(p.criterion, p.test).proven, p.id).toBe(false);
  });

  it("precision ≥ 0.98 on the labelled set (and reports recall)", () => {
    expect(PROOF_PAIRS.length).toBeGreaterThanOrEqual(30);
    const r = score(PROOF_PAIRS);
    console.log(JSON.stringify({ set: "generated and decider pairs", ...r }));
    expect(r.fp).toBe(0);
    expect(r.precision).toBeGreaterThanOrEqual(0.98);
  });

  it("precision ≥ 0.98 on ≥ 40 pairs from hand-written acceptance.yaml rules (and reports recall)", () => {
    expect(RULE_PAIRS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(RULE_PAIRS.map((p) => p.id)).size).toBe(RULE_PAIRS.length);
    const r = score(RULE_PAIRS);
    const all = score([...PROOF_PAIRS, ...RULE_PAIRS]);
    console.log(JSON.stringify({ set: "hand-written rule pairs", ...r }));
    console.log(JSON.stringify({ set: "all pairs", ...all, wrong: undefined }));
    expect(r.fp).toBe(0);
    expect(r.precision).toBeGreaterThanOrEqual(0.98);
    expect(all.precision).toBeGreaterThanOrEqual(0.98);
    // Recall floor, so a later change cannot silently turn every hand-written proof off.
    expect(r.recall).toBeGreaterThanOrEqual(0.4);
  });

  it("vetoes a match that ignores a refusal or the actor", () => {
    expect(proofVeto("A viewer cannot edit a note.", { title: "owner edits a note" })).toMatch(
      /refusal/,
    );
    expect(
      proofVeto("An editor can edit tasks.", { title: "owner edits a task and sees the change" }),
    ).toMatch(/editor/);
    expect(proofVeto("Owner can edit a task.", { title: "owner edits a task" })).toBe("");
  });

  it("ignores Given/When/Then mechanics but not what is checked", () => {
    const test = {
      title: "a shopper adds a product to the cart at its price with quantity one",
      assertions: ['await expect(page.getByTestId("cart-subtotal")).toContainText("49.90");'],
    };
    expect(
      proofVerdict(
        "Given a user is on a product page, when they click the 'Add to Cart' button, then the item must appear in the cart with the correct price and initial quantity of one.",
        test,
      ).proven,
    ).toBe(true);
    expect(
      proofVerdict(
        "Given a shopper, when they remove a product from the cart, it disappears.",
        test,
      ).reason,
    ).toMatch(/delet/);
  });
});
