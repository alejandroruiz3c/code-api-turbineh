import type { ReactNode } from "react";

/**
 * Small, safe Markdown renderer for blog posts: headings (#, ##, ###), paragraphs, bullet and numbered lists,
 * **bold**, *italic*, `code` and [links](https://…). It produces React elements only — raw HTML is shown as text,
 * and links are limited to http(s), mailto and site-relative paths.
 */
export function safeHref(url: string): string | null {
  return /^(https?:\/\/|mailto:|\/(?!\/))/i.test(url.trim()) ? url.trim() : null;
}

export function inline(text: string, keyBase = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const key = `${keyBase}-${k++}`;
    if (t.startsWith("**")) out.push(<strong key={key}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={key}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const [, label = "", url = ""] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t) ?? [];
      const href = safeHref(url);
      out.push(
        href ? (
          <a
            key={key}
            href={href}
            className="underline"
            rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
          >
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else out.push(<em key={key}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks = source.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-4 leading-relaxed">
      {blocks.map((block, i) => {
        const b = block.trim();
        if (!b) return null;
        const heading = /^(#{1,3})\s+(.+)$/.exec(b);
        if (heading) {
          const level = heading[1]?.length ?? 1;
          const content = inline(heading[2] ?? "", `h${i}`);
          return level === 1 ? (
            <h2 key={i} className="text-2xl font-semibold">
              {content}
            </h2>
          ) : level === 2 ? (
            <h3 key={i} className="text-xl font-semibold">
              {content}
            </h3>
          ) : (
            <h4 key={i} className="text-lg font-semibold">
              {content}
            </h4>
          );
        }
        const lines = b.split("\n");
        if (lines.every((l) => /^[-*]\s+/.test(l))) {
          return (
            <ul key={i} className="list-disc pl-6">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^[-*]\s+/, ""), `u${i}-${j}`)}</li>
              ))}
            </ul>
          );
        }
        if (lines.every((l) => /^\d+\.\s+/.test(l))) {
          return (
            <ol key={i} className="list-decimal pl-6">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\d+\.\s+/, ""), `o${i}-${j}`)}</li>
              ))}
            </ol>
          );
        }
        return <p key={i}>{inline(lines.join(" "), `p${i}`)}</p>;
      })}
    </div>
  );
}
