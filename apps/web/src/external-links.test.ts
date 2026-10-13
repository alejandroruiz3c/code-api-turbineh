import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Links that leave the product open in a new tab with rel="noopener noreferrer".
 * Internal navigation (href starting with "/" or "#") stays in the same tab, and so do the
 * OAuth connect flows (connectUrl, /deploy/vercel/connect): they must come back to this tab.
 */
const src = dirname(fileURLToPath(import.meta.url));

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
  );

/** Opening `<a ...>` tags, attributes included (they may span several lines). */
function anchors(code: string): { tag: string; line: number }[] {
  const out: { tag: string; line: number }[] = [];
  const re = /<a(?=[\s>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let depth = 0;
    let i = m.index + 2;
    for (; i < code.length; i++) {
      const c = code[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push({ tag: code.slice(m.index, i + 1), line: code.slice(0, m.index).split("\n").length });
  }
  return out;
}

const internal = (tag: string) => /\shref=(?:"[/#]|\{`[/#]|\{connectUrl\()/.test(tag);

const all = files(src).flatMap((f) =>
  anchors(readFileSync(f, "utf8")).map((a) => ({ ...a, file: relative(src, f) })),
);

describe("links that leave the product", () => {
  it("finds links to check", () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it('open in a new tab with rel="noopener noreferrer"', () => {
    const bad = all
      .filter((a) => !internal(a.tag))
      .filter((a) => !/\starget="_blank"/.test(a.tag) || !/\srel="noopener noreferrer"/.test(a.tag))
      .map((a) => `${a.file}:${a.line}`);
    expect(bad).toEqual([]);
  });
});
