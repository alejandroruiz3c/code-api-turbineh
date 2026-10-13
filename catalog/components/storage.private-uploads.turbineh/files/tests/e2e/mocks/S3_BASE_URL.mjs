// Local mock of an S3-compatible bucket for the E2E tests (started by playwright.config.ts, which points S3_BASE_URL
// here and gives the app throwaway S3 credentials): uploads run through the production S3 driver fully offline.
// Like a private bucket, every request must carry a valid AWS Signature V4 for those credentials — checked here with
// an implementation independent from the app's — and nothing is readable anonymously.
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";
import process from "node:process";
import { URL } from "node:url";

const port = Number(process.env.MOCK_PORT ?? 12100);
const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? "";
const secret = process.env.S3_SECRET_ACCESS_KEY ?? "";
const objects = new Map();

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
const rfc3986 = (s) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** Recomputes the SigV4 signature of a request and compares it with the one it carries. */
function validSignature(req, url, body) {
  const auth = req.headers.authorization ?? "";
  const m =
    /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(
      auth,
    );
  if (!m || !accessKeyId || m[1] !== accessKeyId) return false;
  const [, , day, region, signed, signature] = m;
  const payloadHash = req.headers["x-amz-content-sha256"];
  if (payloadHash !== sha256(body)) return false;
  const amzDate = req.headers["x-amz-date"] ?? "";
  if (!amzDate.startsWith(day)) return false;
  const names = signed.split(";");
  const canonicalHeaders = names
    .map(
      (n) =>
        `${n}:${String(req.headers[n] ?? "")
          .trim()
          .replace(/\s+/g, " ")}\n`,
    )
    .join("");
  const path = decodeURIComponent(url.pathname).split("/").map(rfc3986).join("/");
  const query = [...url.searchParams.entries()]
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .sort()
    .join("&");
  const canonical = [req.method, path, query, canonicalHeaders, signed, payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), "s3"), "aws4_request");
  return createHmac("sha256", key).update(toSign).digest("hex") === signature;
}

createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const reply = (status, data = "", type = "application/xml") => {
      res.writeHead(status, { "content-type": type });
      res.end(data);
    };
    if (req.method === "GET" && url.pathname === "/health") return reply(200, "ok", "text/plain");
    // Test helper: what the bucket holds (keys and sizes only).
    if (req.method === "GET" && url.pathname === "/__objects")
      return reply(
        200,
        JSON.stringify([...objects].map(([k, v]) => ({ key: k, size: v.body.length }))),
        "application/json",
      );
    if (!validSignature(req, url, body))
      return reply(403, "<Error><Code>SignatureDoesNotMatch</Code></Error>");
    const key = decodeURIComponent(url.pathname);
    if (req.method === "PUT") {
      objects.set(key, { body, type: req.headers["content-type"] ?? "application/octet-stream" });
      res.writeHead(200, { etag: `"${sha256(body).slice(0, 32)}"` });
      return res.end();
    }
    if (req.method === "GET") {
      const o = objects.get(key);
      if (!o) return reply(404, "<Error><Code>NoSuchKey</Code></Error>");
      res.writeHead(200, { "content-type": o.type, "content-length": o.body.length });
      return res.end(o.body);
    }
    if (req.method === "DELETE") {
      objects.delete(key);
      res.writeHead(204);
      return res.end();
    }
    return reply(405, "<Error><Code>MethodNotAllowed</Code></Error>");
  });
}).listen(port, "127.0.0.1", () => console.log(`S3 mock on ${port}`));
