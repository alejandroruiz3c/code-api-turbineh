import { setTimeout as sleep } from "node:timers/promises";
import { graph } from "./graph";
import { providerFetch, ProviderError } from "./http";
import { fetchPublicImage, MediaError, type FetchMedia } from "./media";
import { endpoints, type Network } from "./networks";

/**
 * One publication on one network (component social.publish.turbineh), with each network's current official API:
 *  - LinkedIn Posts API: POST /rest/posts (Linkedin-Version, X-Restli-Protocol-Version 2.0.0), author
 *    urn:li:person:<id>, commentary in LinkedIn's "little" text format; images through the Images API
 *    (initializeUpload, then PUT the bytes). The post URN comes back in the x-restli-id header.
 *  - Facebook Page: POST /{page-id}/feed (message) or /{page-id}/photos (url + caption) with the Page token.
 *  - Instagram (professional account linked to the Page): POST /{ig-user-id}/media (image_url, caption), wait until
 *    the container is FINISHED, then POST /{ig-user-id}/media_publish (creation_id).
 *  - X API v2: POST /2/tweets (text, media.media_ids); images through POST /2/media/upload (multipart, tweet_image).
 * Pure functions over fetch: the caller passes the plain token for this one call.
 */
export interface PublishInput {
  network: Network;
  token: string;
  /** The connection's account id (LinkedIn person id, Page id, Instagram user id, X user id). */
  accountId: string;
  text: string;
  imageUrl: string | null;
}

export interface Published {
  externalId: string;
  externalUrl: string | null;
}

export interface PublishDeps {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  fetchMedia?: FetchMedia;
  /** Instagram container polling (tests shorten it). */
  pollMs?: number;
  pollTimes?: number;
}

/** LinkedIn "little" text: reserved characters are escaped; #hashtags become hashtag templates. */
export function toLittleText(text: string): string {
  const escape = (s: string) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
  const out: string[] = [];
  let last = 0;
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]+)/gu)) {
    const start = (m.index ?? 0) + (m[1]?.length ?? 0);
    out.push(escape(text.slice(last, start)), `{hashtag|\\#|${escape(m[2] ?? "")}}`);
    last = start + 1 + (m[2]?.length ?? 0);
  }
  out.push(escape(text.slice(last)));
  return out.join("");
}

async function media(url: string, deps: PublishDeps, network: Network) {
  try {
    return await (deps.fetchMedia ?? fetchPublicImage)(url);
  } catch (err) {
    // The image itself is the problem: retrying will not help.
    throw new ProviderError(
      network,
      422,
      "image",
      err instanceof MediaError ? err.message : "The image could not be downloaded.",
    );
  }
}

async function linkedin(input: PublishInput, deps: PublishDeps): Promise<Published> {
  const e = endpoints(deps.env).linkedin;
  const headers = {
    authorization: `Bearer ${input.token}`,
    "linkedin-version": e.version,
    "x-restli-protocol-version": "2.0.0",
    "content-type": "application/json",
  };
  const author = `urn:li:person:${input.accountId}`;
  let content: { media: { id: string } } | undefined;
  if (input.imageUrl) {
    const img = await media(input.imageUrl, deps, "linkedin");
    const init = await providerFetch<{ value?: { uploadUrl?: string; image?: string } }>(
      "linkedin",
      `${e.api}/rest/images?action=initializeUpload`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
      },
      deps.fetchImpl,
    );
    const { uploadUrl, image } = init.body.value ?? {};
    if (!uploadUrl || !image)
      throw new ProviderError("linkedin", 200, "upload", "initializeUpload returned no upload URL");
    await providerFetch(
      "linkedin",
      uploadUrl,
      {
        method: "PUT",
        headers: { authorization: `Bearer ${input.token}`, "content-type": img.contentType },
        body: new Uint8Array(img.bytes),
      },
      deps.fetchImpl,
    );
    content = { media: { id: image } };
  }
  const res = await providerFetch(
    "linkedin",
    `${e.api}/rest/posts`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        author,
        commentary: toLittleText(input.text),
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        ...(content ? { content } : {}),
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    },
    deps.fetchImpl,
  );
  const urn = res.headers.get("x-restli-id");
  if (!urn)
    throw new ProviderError("linkedin", res.status, "no_id", "LinkedIn did not return the post id");
  return { externalId: urn, externalUrl: `https://www.linkedin.com/feed/update/${urn}/` };
}

async function facebook(input: PublishInput, deps: PublishDeps): Promise<Published> {
  const opts = { env: deps.env, fetchImpl: deps.fetchImpl, network: "facebook" as const };
  const page = encodeURIComponent(input.accountId);
  if (input.imageUrl) {
    const r = await graph<{ id?: string; post_id?: string }>(
      "POST",
      `/${page}/photos`,
      { url: input.imageUrl, caption: input.text, published: "true" },
      input.token,
      opts,
    );
    const id = r.body.post_id ?? r.body.id;
    if (!id)
      throw new ProviderError("facebook", r.status, "no_id", "Facebook did not return the post id");
    return { externalId: id, externalUrl: `https://www.facebook.com/${id}` };
  }
  const r = await graph<{ id?: string }>(
    "POST",
    `/${page}/feed`,
    { message: input.text, published: "true" },
    input.token,
    opts,
  );
  if (!r.body.id)
    throw new ProviderError("facebook", r.status, "no_id", "Facebook did not return the post id");
  return { externalId: r.body.id, externalUrl: `https://www.facebook.com/${r.body.id}` };
}

async function instagram(input: PublishInput, deps: PublishDeps): Promise<Published> {
  const opts = { env: deps.env, fetchImpl: deps.fetchImpl, network: "instagram" as const };
  if (!input.imageUrl)
    throw new ProviderError("instagram", 422, "image", "Instagram needs an image");
  const ig = encodeURIComponent(input.accountId);
  const container = await graph<{ id?: string }>(
    "POST",
    `/${ig}/media`,
    { image_url: input.imageUrl, caption: input.text },
    input.token,
    opts,
  );
  const creation = container.body.id;
  if (!creation)
    throw new ProviderError(
      "instagram",
      container.status,
      "no_id",
      "Instagram did not return a container id",
    );
  for (let i = 0; i < (deps.pollTimes ?? 6); i++) {
    const s = await graph<{ status_code?: string }>(
      "GET",
      `/${encodeURIComponent(creation)}`,
      { fields: "status_code" },
      input.token,
      opts,
    );
    const code = s.body.status_code;
    if (code === "FINISHED") break;
    if (code === "ERROR" || code === "EXPIRED")
      throw new ProviderError(
        "instagram",
        422,
        code,
        `Instagram could not process the image (${code}): use a JPEG under 8 MB`,
      );
    if (i === (deps.pollTimes ?? 6) - 1)
      // Not ready yet: a later attempt creates a new container (unpublished containers expire after 24 hours).
      throw new ProviderError(
        "instagram",
        503,
        "IN_PROGRESS",
        "Instagram is still processing the image",
      );
    await sleep(deps.pollMs ?? 5_000);
  }
  const published = await graph<{ id?: string }>(
    "POST",
    `/${ig}/media_publish`,
    { creation_id: creation },
    input.token,
    opts,
  );
  if (!published.body.id)
    throw new ProviderError(
      "instagram",
      published.status,
      "no_id",
      "Instagram did not return the media id",
    );
  return { externalId: published.body.id, externalUrl: null };
}

async function x(input: PublishInput, deps: PublishDeps): Promise<Published> {
  const api = endpoints(deps.env).x.api;
  const auth = { authorization: `Bearer ${input.token}` };
  let mediaIds: string[] | undefined;
  if (input.imageUrl) {
    const img = await media(input.imageUrl, deps, "x");
    const body = new FormData();
    body.set("media", new Blob([new Uint8Array(img.bytes)], { type: img.contentType }), "image");
    body.set("media_category", "tweet_image");
    const up = await providerFetch<{ data?: { id?: string } }>(
      "x",
      `${api}/2/media/upload`,
      { method: "POST", headers: auth, body },
      deps.fetchImpl,
    );
    if (!up.body.data?.id)
      throw new ProviderError("x", up.status, "no_id", "X did not return a media id");
    mediaIds = [up.body.data.id];
  }
  const res = await providerFetch<{ data?: { id?: string } }>(
    "x",
    `${api}/2/tweets`,
    {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        text: input.text,
        ...(mediaIds ? { media: { media_ids: mediaIds } } : {}),
      }),
    },
    deps.fetchImpl,
  );
  const id = res.body.data?.id;
  if (!id) throw new ProviderError("x", res.status, "no_id", "X did not return the post id");
  return { externalId: id, externalUrl: `https://x.com/i/web/status/${id}` };
}

export function publishTo(input: PublishInput, deps: PublishDeps = {}): Promise<Published> {
  return { linkedin, facebook, instagram, x }[input.network](input, deps);
}
