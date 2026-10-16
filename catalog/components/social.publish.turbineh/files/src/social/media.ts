import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { isIP } from "node:net";

/**
 * Downloads a post's image for the networks that need the bytes (LinkedIn, X), without becoming a way into the
 * server's network (SSRF): https only, no redirects, every resolved address must be public (checked inside the
 * connection's own DNS lookup, so a rebinding answer cannot slip through), at most 5 MB, image types only.
 * Facebook and Instagram fetch the image URL themselves.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export interface Media {
  bytes: Buffer;
  contentType: string;
}

export type FetchMedia = (url: string) => Promise<Media>;

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaError";
  }
}

/** Private, loopback, link-local, CGNAT, multicast and reserved ranges (IPv4 and IPv6, incl. IPv4-mapped). */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  const ip = mapped ?? address;
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb") ||
    v6.startsWith("ff") ||
    v6.startsWith("64:ff9b:") ||
    v6.startsWith("2001:db8")
  );
}

type LookupCb = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

function publicLookup(hostname: string, options: object, cb: LookupCb) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, []);
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address)))
      return cb(
        Object.assign(new Error("Image host resolves to a private address"), { code: "EPRIVATE" }),
        [],
      );
    const all = (options as { all?: boolean }).all;
    if (all) return cb(null, list);
    const first = list[0] as LookupAddress;
    cb(null, first.address, first.family);
  });
}

/** Downloads a public https image (see the rules above). */
export const fetchPublicImage: FetchMedia = (raw) =>
  new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return reject(new MediaError("The image URL is not valid."));
    }
    if (url.protocol !== "https:" || url.username || url.password)
      return reject(new MediaError("The image must be a public https:// URL."));
    if (
      isIP(url.hostname.replace(/^\[|\]$/g, "")) &&
      isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ""))
    )
      return reject(new MediaError("The image URL points to a private address."));
    const req = request(
      url,
      { method: "GET", lookup: publicLookup as never, timeout: 15_000 },
      (res) => {
        const type = (res.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        if ((res.statusCode ?? 0) !== 200) {
          res.resume();
          return reject(
            new MediaError(`The image could not be downloaded (HTTP ${res.statusCode}).`),
          );
        }
        if (!TYPES.includes(type)) {
          res.resume();
          return reject(new MediaError("The URL is not a JPEG, PNG, GIF or WebP image."));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_IMAGE_BYTES) {
            req.destroy();
            reject(new MediaError("The image is larger than 5 MB."));
          } else chunks.push(c);
        });
        res.on("end", () => resolve({ bytes: Buffer.concat(chunks), contentType: type }));
      },
    );
    req.on("timeout", () => req.destroy(new MediaError("The image download timed out.")));
    req.on("error", (e) =>
      reject(e instanceof MediaError ? e : new MediaError("The image could not be downloaded.")),
    );
    req.end();
  });
