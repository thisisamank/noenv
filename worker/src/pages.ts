const STYLE = `
  :root { color-scheme: light dark; --bg: #ffffff; --panel: #fafafa; --line: #ebebeb; --text: #171717; --muted: #666666; --inverse-bg: #171717; --inverse-text: #ffffff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #000000; --panel: #0a0a0a; --line: #1f1f1f; --text: #ededed; --muted: #a1a1a1; --inverse-bg: #ededed; --inverse-text: #0a0a0a; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.6 system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  ::selection { background: var(--text); color: var(--bg); }
  main { max-width: 640px; margin: 0 auto; padding: 64px 16px; }
  h1 { font-size: 32px; line-height: 1.1; letter-spacing: -0.035em; font-weight: 600; margin: 0 0 12px; }
  h2 { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; margin: 36px 0 8px; }
  p { color: var(--muted); }
  a { color: var(--text); text-decoration-color: var(--line); text-underline-offset: 3px; }
  a:hover { text-decoration-color: var(--text); }
  strong { color: var(--text); font-weight: 500; }
  code, pre { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13px; }
  pre { background: var(--panel); border: 1px solid var(--line); padding: 14px 16px; border-radius: 8px; overflow-x: auto; line-height: 1.75; }
  input { font: inherit; font-family: ui-monospace, monospace; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; letter-spacing: 0.1em; text-transform: uppercase; }
  input:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
  button { font: inherit; font-weight: 500; padding: 8px 18px; background: var(--inverse-bg); color: var(--inverse-text); border: 0; border-radius: 999px; cursor: pointer; transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1); }
  button:active { transform: scale(0.97); }
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
