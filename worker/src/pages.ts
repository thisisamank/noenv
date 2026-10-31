const STYLE = `
  :root { color-scheme: dark; --bg: #0b0c0e; --panel: #111215; --line: #222429; --text: #ececef; --muted: #8d9099; --white: #f4f4f5; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.6 system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  main { max-width: 640px; margin: 0 auto; padding: 48px 16px; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 8px; }
  h2 { font-size: 15px; font-weight: 600; margin: 32px 0 8px; }
  p { color: var(--muted); }
  a { color: var(--text); text-underline-offset: 3px; }
  strong { color: var(--text); font-weight: 500; }
  code, pre { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13px; }
  pre { background: var(--panel); border: 1px solid var(--line); padding: 12px 16px; border-radius: 8px; overflow-x: auto; }
  input { font: inherit; font-family: ui-monospace, monospace; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; letter-spacing: 0.1em; text-transform: uppercase; }
  button { font: inherit; font-weight: 500; padding: 8px 16px; background: var(--white); color: var(--bg); border: 0; border-radius: 8px; cursor: pointer; }
`;

const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'";

export function htmlPage(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": CSP,
    },
  });
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
