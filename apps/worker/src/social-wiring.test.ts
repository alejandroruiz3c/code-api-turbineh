import { join } from "node:path";
import type { BuildSpec } from "@turbineh/compiler";
import { describe, expect, it } from "vitest";
import { checkSpec, SOCIAL_PUBLISHER_PROMPT } from "./combinations.js";
import { wireFidelitySync } from "./fidelity-wiring.js";

/**
 * Selection of the social components (ADR-0067) against the real catalogue: a request that connects, publishes to
 * and measures LinkedIn, Facebook, Instagram and X selects social.connections, social.publish and social.metrics with
 * the request's parameters (validated against each params.schema.json); plain social links select nothing.
 */
const componentsDir = join(import.meta.dirname, "../../../catalog/components");
const wire = (prompt: string, spec: BuildSpec = checkSpec("saas-crud", prompt)) =>
  wireFidelitySync(prompt, spec, {
    recipeId: "saas-crud",
    recipeChain: ["saas-crud"],
    componentsDir,
    knownEntities: [],
  });

describe("social components are selected by the fidelity wiring", () => {
  it("a social publisher request selects connections, publishing and metrics with its networks and approval", () => {
    const { wired } = wire(SOCIAL_PUBLISHER_PROMPT);
    const byComponent = Object.fromEntries(wired.selected.map((s) => [s.component, s]));
    expect(byComponent["social.connections.turbineh"]?.params).toEqual({
      providers: ["linkedin", "meta", "x"],
    });
    expect(byComponent["social.publish.turbineh"]?.params).toEqual({
      networks: ["linkedin", "facebook", "instagram", "x"],
      requireApproval: true,
      maxAttempts: 5,
    });
    expect(byComponent["social.metrics.turbineh"]?.params).toEqual({
      refreshHours: 6,
      windowDays: 30,
    });
    expect(byComponent["social.publish.turbineh"]?.capability).toBe("social.publish");
  });

  it("only the networks the request names; no approval when it says posts go out without review", () => {
    const { wired } = wire(
      "Schedule posts to LinkedIn and X without approval; the owner connects both accounts.",
    );
    const publish = wired.selected.find((s) => s.component === "social.publish.turbineh");
    expect(publish?.params).toMatchObject({ networks: ["linkedin", "x"], requireApproval: false });
    expect(
      wired.selected.find((s) => s.component === "social.connections.turbineh")?.params,
    ).toEqual({
      providers: ["linkedin", "x"],
    });
    expect(wired.selected.some((s) => s.component === "social.metrics.turbineh")).toBe(false);
  });

  it("links to social profiles and share buttons are plain content: no social component", () => {
    const { wired } = wire(
      "A bakery website with a menu, opening hours, links to our Instagram and Facebook profiles and share buttons on each recipe.",
    );
    expect(wired.selected.filter((s) => s.component.startsWith("social."))).toEqual([]);
  });
});
