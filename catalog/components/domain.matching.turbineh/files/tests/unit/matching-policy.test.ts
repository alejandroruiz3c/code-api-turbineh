import { describe, expect, it } from "vitest";
import { allows } from "@/server/permissions";
import {
  mayCreateRecords,
  mayEditProfile,
  mayEditRecords,
  mayGiveFeedback,
} from "@/matching/policy";
import { ROLES } from "@/server/role-policy";

describe("matching policy follows the app's role matrix", () => {
  it("only roles that may configure edit the organization's matching profile; unknown roles may do nothing", () => {
    for (const role of ROLES) {
      expect(mayEditProfile(role)).toBe(allows(role, "configure"));
      expect(mayCreateRecords(role)).toBe(allows(role, "create"));
      expect(mayEditRecords(role)).toBe(allows(role, "update"));
      expect(mayGiveFeedback(role)).toBe(allows(role, "read"));
    }
    expect(ROLES.some((r) => !mayEditProfile(r))).toBe(true);
    expect(mayEditProfile("intruder")).toBe(false);
    expect(mayGiveFeedback("intruder")).toBe(false);
  });
});
