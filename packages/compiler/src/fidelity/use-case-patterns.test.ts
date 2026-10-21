import { describe, expect, it } from "vitest";
import type { Constraints } from "./constraints.js";
import { sentences } from "./text.js";
import {
  askedResolution,
  detectBlog,
  detectMatching,
  detectScreenRecording,
} from "./use-case-patterns.js";

/** Synthetic requests paraphrasing real demand (ADR-0073); never customers' words. */
const c = (pageSize: number | null = null) => ({ pageSize }) as unknown as Constraints;
const blog = (t: string, size: number | null = null) => detectBlog(sentences(t), c(size));
const rec = (t: string) => detectScreenRecording(t, sentences(t));
const match = (t: string) => detectMatching(t, sentences(t));

describe("blog pattern (content.blog)", () => {
  it("a blog about a topic is a blog, whatever the topic (AI included)", () => {
    const [p] = blog("A minimal blog where our lab publishes notes about machine learning papers");
    expect(p?.id).toBe("blog");
    expect(p?.params).toEqual({ postsPerPage: 10, wordsPerMinute: 200, feedItems: 20 });
  });
  it("articles people read on the site, with the page size the request states", () => {
    expect(
      blog("Editors publish articles for readers. Show 6 per page.", 6)[0]?.params,
    ).toMatchObject({
      postsPerPage: 6,
    });
  });
  it("publishing posts to social networks is not a blog", () => {
    expect(blog("Team members publish posts to LinkedIn and Instagram every week")).toEqual([]);
  });
  it("a shop without articles selects nothing", () => {
    expect(blog("An online shop for handmade candles with a cart and checkout")).toEqual([]);
  });
});

describe("screen recording pattern (media.screen-recording)", () => {
  it("a Loom-like recorder in 4K with layouts asks for 2160p, never promises it", () => {
    const [p] = rec(
      "I want a tool like Loom to record my screen and my webcam in 4K, with several layouts",
    );
    expect(p?.params).toMatchObject({ maxResolution: "2160p", frameRate: 30, shareLinks: true });
    expect(p?.params.layouts).toEqual(["bubble", "side-by-side", "screen-only", "camera-only"]);
    expect(p?.assumptions.join(" ")).toMatch(/not guaranteed/);
  });
  it("Spanish wording: grabar pantalla y cámara", () => {
    expect(
      rec("Una aplicación para grabar la pantalla y la cámara a 60 fps")[0]?.params,
    ).toMatchObject({
      maxResolution: "1080p",
      frameRate: 60,
    });
  });
  it("a weaving loom, a photo upload or a video gallery is not screen recording", () => {
    expect(
      rec("An inventory app for a textile workshop that tracks each loom and its yarn"),
    ).toEqual([]);
    expect(rec("Members upload photos taken with their camera to the gallery")).toEqual([]);
    expect(rec("A page that embeds our product videos")).toEqual([]);
  });
  it("reads the resolution presets", () => {
    expect(askedResolution("record at 1440p")).toBe("1440p");
    expect(askedResolution("full HD please")).toBe("1080p");
    expect(askedResolution("3840x2160 capture")).toBe("2160p");
    expect(askedResolution("record the screen")).toBeNull();
  });
});

describe("matching pattern (domain.matching)", () => {
  it("opportunities matched against an organization profile", () => {
    const [p] = match(
      "A B2B platform for monitoring public tenders.\n- Each company configures its sectors, regions and keywords.\n- The dashboard lists the tenders relevant to its profile.",
    );
    expect(p?.params).toEqual({
      entity: { singular: "tender", plural: "tenders" },
      weights: { sectors: 3, activities: 2, regions: 2, keywords: 1 },
      minScore: 1,
    });
  });
  it("defaults to opportunities", () => {
    expect(
      match("Show the opportunities that match our interests and sectors")[0]?.params.entity,
    ).toEqual({ singular: "opportunity", plural: "opportunities" });
  });
  it("needs a profile: a plain sales pipeline or a dating app is not matching", () => {
    expect(match("A CRM where the team tracks sales opportunities through stages")).toEqual([]);
    expect(match("Users swipe and match with each other")).toEqual([]);
  });
});
