const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/**
 * Minimal standalone page for the GitHub connection steps that happen outside the product area (CLI tickets,
 * callback results). Text is escaped; the only markup is ours. No scripts.
 */
export function htmlPage(
  title: string,
  paragraphs: string[],
  form?: { action: string; fields: Record<string, string>; button: string },
  status = 200,
): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · YES IF for Builders</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1626;color:#dfe9f5;font:15px/1.6 system-ui,sans-serif}
main{max-width:520px;padding:32px;border:1px solid #23344d;border-radius:16px;background:#101e33}
h1{font-size:20px;color:#f6efe2;margin:0 0 12px}code{color:#3ccfbf;font-size:18px;letter-spacing:.08em}
button{margin-top:16px;border:0;border-radius:999px;background:#f2a93b;color:#0b1626;font-weight:600;padding:10px 22px;font-size:15px;cursor:pointer}
p{margin:8px 0}.muted{color:#8aa0bb;font-size:13px}</style></head>
<body><main><h1>${esc(title)}</h1>${paragraphs.map((p) => `<p>${p.startsWith("~") ? `<span class="muted">${esc(p.slice(1))}</span>` : esc(p).replace(/`([^`]+)`/g, "<code>$1</code>")}</p>`).join("")}
${
  form
    ? `<form method="post" action="${esc(form.action)}">${Object.entries(form.fields)
        .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
        .join("")}<button type="submit">${esc(form.button)}</button></form>`
    : ""
}
</main></body></html>`;
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com",
    },
  });
}
