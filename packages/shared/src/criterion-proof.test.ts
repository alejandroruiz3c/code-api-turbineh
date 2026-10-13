import { describe, expect, it } from "vitest";
import { proofVerdict, proofVeto } from "./criterion-proof.js";
import { PROOF_PAIRS } from "./criterion-proof.fixtures.js";

describe("criterion → test proof (precision first)", () => {
  it("the false matches of production build f195341c all come out open", () => {
    for (const p of PROOF_PAIRS.filter((x) => x.id.startsWith("prod-")))
      expect({ id: p.id, proven: proofVerdict(p.criterion, p.test).proven }).toEqual({
        id: p.id,
        proven: false,
      });
  });

  it("precision ≥ 0.98 on the labelled set (and reports recall)", () => {
    expect(PROOF_PAIRS.length).toBeGreaterThanOrEqual(30);
    let tp = 0;
    let fp = 0;
    let fn = 0;
    const wrong: string[] = [];
    for (const p of PROOF_PAIRS) {
      const proven = proofVerdict(p.criterion, p.test).proven;
      if (proven && p.met) tp++;
      else if (proven && !p.met) {
        fp++;
        wrong.push(`FP ${p.id}`);
      } else if (!proven && p.met) {
        fn++;
        wrong.push(`FN ${p.id}: ${proofVerdict(p.criterion, p.test).reason}`);
      }
    }
    const precision = tp / Math.max(1, tp + fp);
    const recall = tp / Math.max(1, tp + fn);
    console.log(
      JSON.stringify({ pairs: PROOF_PAIRS.length, tp, fp, fn, precision, recall, wrong }),
    );
    expect(fp).toBe(0);
    expect(precision).toBeGreaterThanOrEqual(0.98);
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
});
