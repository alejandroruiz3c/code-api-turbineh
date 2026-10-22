import type { Constraints } from "./constraints.js";
import type { PatternMatch } from "./patterns.js";

/**
 * Patterns of the use cases added from real demand (ADR-0073): a blog, screen + camera recording ("like Loom") and
 * records matched against an organization's profile (B2B opportunity monitoring). Detection and parameters come from
 * the request by code (deterministic); each pattern is selected only when an approved component provides it.
 */

/** Social publishing ("publish posts to LinkedIn") is the social components' job, never a blog. */
const SOCIAL =
  /\b(linked ?in|facebook|instagram|twitter|tweets?|tik ?tok|social[- ](media|networks?|accounts?|channels?))\b/i;

const BLOG =
  /\bblog\w*\b|\b(articles?|insights|newsroom|research notes)\b[^.;]{0,60}\b(publish|read|share|post)\w*|\b(publish|share|write)\w*\b[^.;]{0,40}\b(articles?|insights|newsroom)\b/i;

/** Blog (content.blog): a request for a blog or for publishing articles to read on the site. */
export function detectBlog(all: readonly string[], c: Constraints): PatternMatch[] {
  const evidence = all.filter((s) => BLOG.test(s) && !SOCIAL.test(s));
  if (evidence.length === 0) return [];
  const pageSize = c.pageSize ? Math.min(50, Math.max(1, c.pageSize)) : null;
  return [
    {
      id: "blog",
      params: { postsPerPage: pageSize ?? 10, wordsPerMinute: 200, feedItems: 20 },
      providedEntities: [],
      evidence,
      assumptions: [
        ...(pageSize ? [] : ["Posts per page not stated: 10."]),
        "Reading time at 200 words per minute; the RSS feed lists the 20 latest posts.",
      ],
    },
  ];
}

/** Recording the screen and/or the camera in the browser (English and Spanish wording; "like Loom"). */
const RECORDING =
  /\bscreen[- ]?(record\w*|captur\w*|cast\w*)|\brecord\w*\b[^.;]{0,40}\b(screens?|desktop|webcam|cameras?)\b|\b(webcam|cameras?)\b[^.;]{0,40}\brecord\w*|\b(like|similar to|clone of|alternative to|igual (que|a)|como|tipo)\s+loom\b|\bloom[- ](like|clone|alternative)\b|\bvideo messages?\b|\bgrab\w*\b[^.;]{0,40}\b(pantalla|c[aá]mara)\b|\bgrabaci[oó]n\w*\b[^.;]{0,30}\b(pantalla|c[aá]mara)\b/i;

/** The resolution asked for, as the component's preset ("4K" → 2160p). Never a promise: the device decides. */
export function askedResolution(text: string): "720p" | "1080p" | "1440p" | "2160p" | null {
  if (/\b(4k|2160p?|uhd|3840\s*[x×]\s*2160)\b/i.test(text)) return "2160p";
  if (/\b(1440p?|2k|qhd|2560\s*[x×]\s*1440)\b/i.test(text)) return "1440p";
  if (/\b(1080p?|full ?hd|fhd|1920\s*[x×]\s*1080)\b/i.test(text)) return "1080p";
  if (/\b(720p?|1280\s*[x×]\s*720)\b/i.test(text)) return "720p";
  return null;
}

/** Screen recording (media.screen-recording): screen + camera, layouts, resolution and frame rate from the request. */
export function detectScreenRecording(text: string, all: readonly string[]): PatternMatch[] {
  const evidence = all.filter((s) => RECORDING.test(s));
  if (evidence.length === 0) return [];
  const resolution = askedResolution(text);
  const fps = /\b60\s?(fps|frames)/i.test(text) ? 60 : /\b24\s?(fps|frames)/i.test(text) ? 24 : 30;
  const minutes = /\b(\d{1,3})[- ]?(minutes?|min)\b[^.;]{0,30}\b(record|video|recording)/i.exec(
    text,
  );
  const maxMinutes = minutes ? Math.min(120, Math.max(1, Number(minutes[1]))) : 30;
  return [
    {
      id: "screen-recording",
      params: {
        maxResolution: resolution ?? "1080p",
        frameRate: fps,
        layouts: ["bubble", "side-by-side", "screen-only", "camera-only"],
        maxMinutes,
        maxBytes: 524_288_000,
        shareLinks: true,
      },
      providedEntities: [],
      evidence,
      assumptions: [
        ...(resolution
          ? []
          : ["Resolution not stated: up to 1080p (the device may deliver less)."]),
        ...(resolution === "2160p"
          ? [
              "4K is asked for, not guaranteed: the app requests up to 3840×2160 and records at the highest resolution the screen and camera deliver, and shows it.",
            ]
          : []),
        ...(minutes ? [] : ["Longest recording not stated: 30 minutes."]),
        "Layouts: camera bubble in any corner, side by side, screen only, camera only.",
      ],
    },
  ];
}

/** Records the organization follows (the request's noun) → singular/plural. */
const MATCH_NOUNS: readonly [RegExp, string, string][] = [
  [/\bopportunit(y|ies)\b/i, "opportunity", "opportunities"],
  [/\btenders?\b/i, "tender", "tenders"],
  [/\bgrants?\b/i, "grant", "grants"],
  [/\b(calls? for (proposals|tenders)|public calls?)\b/i, "call", "calls"],
  [/\bleads?\b/i, "lead", "leads"],
];
const MATCHING =
  /\bmatch\w*\b[^.;]{0,80}\b(interests?|profiles?|sectors?|criteria|preferences|keywords?)\b|\b(relevant|matching|suitable)\b[^.;]{0,40}\b(opportunit\w+|tenders?|grants?|leads?|calls?)\b|\b(opportunit\w+|tenders?|grants?)\b[^.;]{0,80}\b(relevant|match\w*|fit)\b|\bopportunity (monitoring|matching|alerts?)\b/i;
const PROFILE = /\b(sectors?|activities|geograph\w*|regions?|territor\w*|interests?|keywords?)\b/i;

/**
 * Matching (domain.matching): records (opportunities, tenders, grants…) ranked against an organization's profile —
 * sectors, activities, regions, keywords — deterministically, with the reasons of each match. Needs both a matching
 * sentence and a profile the request describes.
 */
export function detectMatching(text: string, all: readonly string[]): PatternMatch[] {
  const evidence = all.filter((s) => MATCHING.test(s));
  if (evidence.length === 0 || !PROFILE.test(text)) return [];
  const noun = MATCH_NOUNS.find(([re]) => evidence.some((s) => re.test(s))) ??
    MATCH_NOUNS.find(([re]) => re.test(text)) ?? [null, "opportunity", "opportunities"];
  return [
    {
      id: "matching",
      params: {
        entity: { singular: noun[1], plural: noun[2] },
        weights: { sectors: 3, activities: 2, regions: 2, keywords: 1 },
        minScore: 1,
      },
      providedEntities: [],
      evidence: [...evidence, ...all.filter((s) => PROFILE.test(s) && !evidence.includes(s))],
      assumptions: [
        "Match weights not stated: sector 3, activity 2, region 2, keyword 1; a record needs a score of 1 to match.",
      ],
    },
  ];
}
