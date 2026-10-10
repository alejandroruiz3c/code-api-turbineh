import { describe, expect, it } from "vitest";
import { percentile, readEnv } from "./index.js";

describe("readEnv", () => {
  it("applies defaults and treats empty strings as unset", () => {
    const env = readEnv({ TYPESAFE_API_KEY: "", BACKUP_CODER_PRIMARY: "" });
    expect(env.TYPESAFE_API_KEY).toBeUndefined();
    expect(env.BACKUP_CODER_PRIMARY).toBeUndefined();
    expect(env.DECIDER_PRIMARY).toBe("jev");
    expect(env.COMPILER_MODEL).toBe("gemma4:12b");
  });

  it("rejects malformed model references", () => {
    expect(() => readEnv({ BACKUP_CODER_PRIMARY: "no-provider" })).toThrow();
    expect(readEnv({ BACKUP_CODER_PRIMARY: "nebius:deepseek-ai/X" }).BACKUP_CODER_PRIMARY).toBe(
      "nebius:deepseek-ai/X",
    );
  });
});

describe("percentile", () => {
  it("uses nearest rank", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([], 50)).toBeNaN();
  });
});
