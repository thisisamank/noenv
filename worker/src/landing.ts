import type { Context } from "./context.ts";
import { escapeHtml } from "./pages.ts";
import { isSetupAvailable } from "./passkeys.ts";

const INSTALL_COMMAND = "npm install -g @thisisamank/noenv-cli";
const SITE = "https://noenv.thisisamank.in";

const SCRIPT = `for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(button.dataset.copy); } catch { return; }
    button.classList.add("copied");
    setTimeout(() => button.classList.remove("copied"), 1400);
  });
}`;

const STYLE = `
:root { color-scheme: light dark; --bg: #ffffff; --bg-2: #f6f9fc; --card: #ffffff; --hover: #eef3f8; --line: #e3e8ee; --line-2: #cfd7e1; --text: #0b1a2e; --muted: #4f5f75; --faint: #6b7a8f; --brand: #087a5b; --brand-hover: #06684d; --brand-ink: #ffffff; --brand-soft: #e3f6ee; --warn: #a86400; --warn-soft: #fdf3e1; --shadow: 0 1px 2px rgba(11, 26, 46, 0.06), 0 12px 32px -12px rgba(11, 26, 46, 0.18); --ease: cubic-bezier(0.23, 1, 0.32, 1); }
@media (prefers-color-scheme: dark) { :root { --bg: #07111f; --bg-2: #0b1828; --card: #0f1e31; --hover: #15263b; --line: #1c2d43; --line-2: #2a3d56; --text: #eef3f9; --muted: #a3b2c6; --faint: #8494aa; --brand: #34d399; --brand-hover: #6ee7b7; --brand-ink: #04241a; --brand-soft: #0d2e26; --warn: #fbbf24; --warn-soft: #2a2110; --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 12px 32px -12px rgba(0, 0, 0, 0.6); } }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
::selection { background: color-mix(in srgb, var(--brand) 28%, transparent); }
:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 4px; }
a { color: inherit; text-decoration: none; }
code, pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
svg { display: block; flex: none; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.wrap { width: min(1080px, 100% - 32px); margin: 0 auto; }
header { position: sticky; top: 0; z-index: 2; background: color-mix(in srgb, var(--bg) 85%, transparent); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
header .wrap { display: flex; align-items: center; gap: 16px; height: 60px; }
.logo { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 17px; letter-spacing: -0.03em; }
.mark { width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center; background: var(--brand); color: var(--brand-ink); }
.mark svg { width: 15px; height: 15px; stroke-width: 2.2; }
.host { font: 12px ui-monospace, monospace; color: var(--muted); padding: 3px 8px; border-radius: 6px; background: var(--bg-2); border: 1px solid var(--line); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
nav { margin-left: auto; display: flex; align-items: center; gap: 4px; }
nav a { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 10px; border-radius: 8px; color: var(--muted); font-weight: 500; font-size: 14px; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 40px; padding: 0 16px; border-radius: 8px; font-weight: 500; font-size: 14px; border: 1px solid var(--line-2); background: var(--card); color: var(--text); white-space: nowrap; transition: transform 160ms var(--ease), background-color 120ms, border-color 120ms; }
.btn:active { transform: scale(0.97); }
.btn.primary { background: var(--brand); border-color: var(--brand); color: var(--brand-ink); }
main { padding: 56px 0 80px; }
.setup { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding: 16px 20px; margin-bottom: 40px; border-radius: 12px; background: var(--warn-soft); border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent); }
.setup svg { color: var(--warn); width: 20px; height: 20px; }
.setup div { flex: 1; min-width: 220px; }
.setup b { display: block; font-weight: 600; }
.setup span { color: var(--muted); font-size: 14px; }
.intro { display: grid; gap: 14px; max-width: 680px; margin-bottom: 40px; }
h1 { font-size: clamp(32px, 4.4vw, 48px); line-height: 1.06; letter-spacing: -0.04em; font-weight: 600; text-wrap: balance; }
.intro p { color: var(--muted); font-size: 18px; }
.steps { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.45fr) minmax(0, 1fr); gap: 16px; list-style: none; counter-reset: step; }
.step { counter-increment: step; display: grid; gap: 12px; align-content: start; padding: 22px; border-radius: 14px; background: var(--card); border: 1px solid var(--line); box-shadow: var(--shadow); }
.step::before { content: counter(step); width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--brand); color: var(--brand-ink); font-weight: 600; font-size: 13px; }
h2 { font-size: 18px; letter-spacing: -0.02em; font-weight: 600; }
h3 { font-size: 16px; letter-spacing: -0.015em; font-weight: 600; }
.step p, .card p { color: var(--muted); font-size: 14px; }
.code { position: relative; border-radius: 10px; background: var(--bg-2); border: 1px solid var(--line); }
.code pre { padding: 12px 44px 12px 14px; font-size: 12.5px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.code .c { color: var(--faint); }
.code .ok { color: var(--brand); }
.copy { position: absolute; top: 6px; right: 6px; width: 32px; height: 32px; display: grid; place-items: center; border-radius: 7px; border: 0; background: transparent; color: var(--faint); cursor: pointer; transition: color 120ms, background-color 120ms, transform 160ms var(--ease); }
.copy:active { transform: scale(0.94); }
.copy .done, .copy.copied .idle { display: none; }
.copy.copied .done { display: block; color: var(--brand); }
.tabs { display: grid; gap: 10px; }
.tabs input { position: absolute; opacity: 0; pointer-events: none; }
.tab-row { display: inline-flex; gap: 2px; padding: 3px; border-radius: 9px; background: var(--bg-2); border: 1px solid var(--line); width: fit-content; }
.tab-row label { padding: 4px 12px; border-radius: 6px; font-size: 13px; font-weight: 500; color: var(--muted); cursor: pointer; }
.panel { display: none; }
#sh-zsh:checked ~ .tab-row label[for="sh-zsh"], #sh-bash:checked ~ .tab-row label[for="sh-bash"] { background: var(--card); color: var(--text); box-shadow: 0 1px 2px rgba(11, 26, 46, 0.12); }
#sh-zsh:focus-visible ~ .tab-row label[for="sh-zsh"], #sh-bash:focus-visible ~ .tab-row label[for="sh-bash"] { outline: 2px solid var(--brand); }
#sh-zsh:checked ~ .panel.zsh, #sh-bash:checked ~ .panel.bash { display: grid; gap: 8px; }
.panel small { color: var(--faint); font-size: 12.5px; }
.panel small code { color: var(--text); }
.section-title { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin: 64px 0 20px; }
.section-title h2 { font-size: 26px; letter-spacing: -0.03em; }
.section-title a { color: var(--brand); font-weight: 500; font-size: 14px; display: inline-flex; align-items: center; gap: 6px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.card { display: grid; gap: 10px; align-content: start; padding: 22px; border-radius: 14px; background: var(--card); border: 1px solid var(--line); }
.card-head { display: flex; align-items: center; gap: 10px; }
.card-head span { width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center; background: var(--brand-soft); color: var(--brand); }
.card-head h3 { flex: 1; }
.card-head a { color: var(--faint); }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
.table { border-radius: 14px; border: 1px solid var(--line); overflow: hidden; background: var(--card); overflow-x: auto; }
th { text-align: left; font-weight: 500; font-size: 12px; color: var(--faint); padding: 10px 16px; background: var(--bg-2); border-bottom: 1px solid var(--line); }
td { padding: 10px 16px; border-bottom: 1px solid var(--line); color: var(--muted); }
tr:last-child td { border-bottom: 0; }
td:first-child { white-space: nowrap; }
td code { font-size: 12.5px; color: var(--text); }
.guides { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.guide { display: grid; gap: 6px; align-content: start; padding: 16px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg-2); transition: border-color 120ms, background-color 120ms; }
.guide b { font-weight: 600; font-size: 14px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.guide b svg { color: var(--faint); width: 14px; height: 14px; transition: transform 160ms var(--ease); }
.guide span { color: var(--muted); font-size: 13px; }
footer { border-top: 1px solid var(--line); color: var(--faint); font-size: 13px; }
footer .wrap { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; padding: 24px 0; }
footer .wrap > :first-child { margin-right: auto; }
@media (hover: hover) and (pointer: fine) {
  nav a:hover { background: var(--hover); color: var(--text); }
  .btn:hover { border-color: var(--faint); }
  .btn.primary:hover { background: var(--brand-hover); border-color: var(--brand-hover); }
  .copy:hover { background: var(--hover); color: var(--text); }
  .card-head a:hover, footer a:hover { color: var(--text); }
  .guide:hover { border-color: var(--line-2); background: var(--card); }
  .guide:hover b svg { transform: translateX(2px); color: var(--brand); }
}
@media (max-width: 900px) { .steps, .grid { grid-template-columns: minmax(0, 1fr); } .guides { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .host, nav .ext { display: none; } .guides { grid-template-columns: minmax(0, 1fr); } main { padding-top: 32px; } .btn, .copy { min-height: 44px; } .copy { width: 44px; height: 44px; top: 2px; right: 2px; } }
@media (prefers-reduced-motion: reduce) { * { transition-duration: 1ms !important; } }
`;

const ICONS: Record<string, string> = {
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M16 7l3 3M14 9l2 2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17h.01"/>',
  repo: '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7.5v9M18 10c0 4-6 3-11.2 7"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 14l6 0"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/>',
  cloud: '<path d="M18 19H7a5 5 0 0 1-.8-9.9A7 7 0 0 1 19.6 11 4 4 0 0 1 18 19z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.7.8 2.8 2.6 3 5.2"/>',
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
};

function icon(name: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

function code(text: string, display = escapeHtml(text)): string {
  return `<div class="code"><pre><code>${display}</code></pre><button class="copy" type="button" data-copy="${escapeHtml(text)}" aria-label="Copy">${icon("copy").replace("<svg", '<svg class="idle"')}${icon("check").replace("<svg", '<svg class="done"')}</button></div>`;
}

function card(iconName: string, title: string, guide: string, body: string): string {
  return `<article class="card"><div class="card-head"><span>${icon(iconName)}</span><h3>${title}</h3><a href="${SITE}/guides/${guide}" aria-label="${title} guide">${icon("external")}</a></div>${body}</article>`;
}

const GUIDES: [string, string, string][] = [
  ["getting-started", "Getting started", "Deploy, sign in, first secret"],
  ["migrate-from-env", "Migrate from .env", "Move files in safely"],
  ["multiple-accounts", "Multiple accounts", "Several teams, one laptop"],
  ["agents-ci-and-workers", "Agents, CI, Workers", "noenv exec and wrangler"],
  ["team-and-access", "Team and access", "Invites, roles, keys"],
  ["policies-and-devices", "Policies and devices", ".env rules, compliance"],
];

const COMMANDS: [string, string][] = [
  ["noenv status", "Show the account, your user, and the current project"],
  ["noenv secret set KEY", "Save a secret as a new version"],
  ["noenv secret list", "List the secrets in this environment"],
  ["noenv secret history KEY", "List the versions of a secret"],
  ["noenv secret rollback KEY VERSION", "Restore an older version"],
  ["noenv exec -- CMD", "Run a command with this repository's secrets"],
  ["noenv wrangler [KEY...]", "Push secrets to your Worker"],
  ["noenv grant EMAIL ROLE", "Give a person access and share the key"],
];

export async function landingPage({ request, env }: Context): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;
  const setup = await isSetupAvailable(env);
  const shell = (kind: "zsh" | "bash") => `export NOENV_URL="${origin}"\neval "$(noenv shell ${kind})"`;

  const banner = setup
    ? `<div class="setup">${icon("alert")}<div><b>This deployment has no admin yet.</b><span>Finish setup with the admin email you entered when you deployed.</span></div><a class="btn primary" href="/dashboard/">Finish setup ${icon("arrow")}</a></div>`
    : "";

  const body = `<header><div class="wrap">
  <a class="logo" href="/"><span class="mark">${icon("key")}</span>noenv</a>
  <span class="host" title="${escapeHtml(origin)}">${escapeHtml(url.host)}</span>
  <nav>
    <a class="ext" href="${SITE}/guides">Guides</a>
    <a class="ext" href="${SITE}/changelog">Changelog</a>
    <a class="btn primary" href="/dashboard/">${icon("dashboard")}Dashboard</a>
  </nav>
</div></header>
<main><div class="wrap">
${banner}
<div class="intro">
  <h1>Connect your terminal to this noenv.</h1>
  <p>Secrets for your projects load when you <code>cd</code> into a repository and unload when you leave it. Three steps, once per machine.</p>
</div>

<ol class="steps">
  <li class="step">
    <h2>Install the CLI</h2>
    <p>Needs Node.js 22 or newer.</p>
    ${code(INSTALL_COMMAND)}
  </li>
  <li class="step">
    <h2>Add noenv to your shell</h2>
    <div class="tabs">
      <input type="radio" name="shell" id="sh-zsh" checked><input type="radio" name="shell" id="sh-bash">
      <div class="tab-row"><label for="sh-zsh">zsh</label><label for="sh-bash">bash</label></div>
      <div class="panel zsh"><small>Add to <code>~/.zshrc</code></small>${code(shell("zsh"))}</div>
      <div class="panel bash"><small>Add to <code>~/.bashrc</code></small>${code(shell("bash"))}</div>
    </div>
  </li>
  <li class="step">
    <h2>Open a new terminal</h2>
    <p>Go into a repository. Your browser opens once so you can approve the terminal with your passkey.</p>
    <div class="code"><pre><code><span class="c">~/code ❯</span> cd api
<span class="ok">noenv: loaded 12 secrets</span></code></pre></div>
  </li>
</ol>

<div class="section-title"><h2>Then</h2><a href="${SITE}/guides">All guides ${icon("arrow")}</a></div>
<div class="grid">
  ${card("repo", "Add a project", "getting-started#project", `<p>The git <code>origin</code> is the project. <code>init</code> creates it and a <code>.noenv</code> file to commit.</p>${code("noenv init\nnoenv secret set API_KEY")}`)}
  ${card("file", "Move your .env files in", "migrate-from-env", `<p>Uploads every value, reads it back, and only then offers to delete the file.</p>${code("noenv migrate")}`)}
  ${card("bot", "Coding agents and CI", "agents-ci-and-workers", `<p>Agents start a fresh shell for each command. Give them this line in <code>CLAUDE.md</code> or <code>AGENTS.md</code>:</p>${code("Run commands that need environment variables with `noenv exec -- <command>`. Do not create .env files.")}`)}
  ${card("cloud", "Push secrets to a Worker", "agents-ci-and-workers#wrangler", `<p>Pick keys in a list. They go to <code>wrangler secret bulk</code> on stdin, never on screen.</p>${code("noenv wrangler")}`)}
  ${card("users", "Work with more than one team", "multiple-accounts", `<p>Add this deployment as an account. <code>noenv init</code> asks which account a repository uses and saves its URL in <code>.noenv</code>.</p>${code(`noenv account add ${origin}\nnoenv init`)}`)}
  ${card("dashboard", "Manage it in the browser", "team-and-access", `<p>Projects, secret history and rollback, team invites, <code>.env</code> policies, and device compliance.</p><a class="btn" href="/dashboard/">Open the dashboard ${icon("arrow")}</a>`)}
</div>

<div class="section-title"><h2>Everyday commands</h2></div>
<div class="table"><table><thead><tr><th>Command</th><th>What it does</th></tr></thead><tbody>
${COMMANDS.map(([command, text]) => `<tr><td><code>${escapeHtml(command)}</code></td><td>${text}</td></tr>`).join("\n")}
</tbody></table></div>

<div class="section-title"><h2>Guides</h2><a href="${SITE}/changelog">What's new ${icon("arrow")}</a></div>
<div class="guides">
${GUIDES.map(([slug, title, text]) => `<a class="guide" href="${SITE}/guides/${slug}"><b>${title}${icon("arrow")}</b><span>${text}</span></a>`).join("\n")}
</div>
</div></main>
<footer><div class="wrap"><span>Values are encrypted on your machine. This server stores only ciphertext.</span><a href="${SITE}">noenv.thisisamank.in</a><a href="https://github.com/thisisamank/noenv">GitHub</a></div></footer>
<script>${SCRIPT}</script>`;

  const scriptHash = await sha256Base64(SCRIPT);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>noenv · ${escapeHtml(url.host)}</title>
<style>${STYLE}</style>
</head>
<body>${body}</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'; frame-ancestors 'none'`,
    },
  });
}

async function sha256Base64(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...digest));
}
