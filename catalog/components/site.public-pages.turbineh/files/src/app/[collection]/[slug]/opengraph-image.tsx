import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { collectionOf } from "@/site-pages/config";
import { publishedEntry } from "@/site-pages/service";

/** Open Graph image of an entry page (site.public-pages.turbineh): its title on the brand colours, 1200×630 PNG. */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "__APP_NAME__";

/** A theme token of src/app/globals.css (the request's palette), or a fallback. */
function token(name: string, fallback: string): string {
  try {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    return new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1] ?? fallback;
  } catch {
    return fallback;
  }
}

export default async function Image({
  params,
}: {
  params: Promise<{ collection: string; slug: string }>;
}) {
  const { collection, slug } = await params;
  const c = collectionOf(collection);
  const e = c ? await publishedEntry(c, slug) : null;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: token("brand", "#111827"),
        color: token("brand-contrast", "#ffffff"),
      }}
    >
      <div style={{ fontSize: 32 }}>{c ? c.plural : "__APP_NAME__"}</div>
      <div style={{ fontSize: 72, fontWeight: 700 }}>{e?.title ?? "__APP_NAME__"}</div>
      <div style={{ fontSize: 28 }}>__APP_NAME__</div>
    </div>,
    size,
  );
}
