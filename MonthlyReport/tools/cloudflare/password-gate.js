/**
 * Cloudflare Worker — HTTP Basic Auth gate for https://tpowellness.com/MonthlyReport/
 * The Worker sits in front of GitHub Pages (origin). Without the password the
 * browser receives 401 and never receives any page content, source, or config.js.
 *
 * Deployment (see SETUP.md "Password protection"): dashboard → Workers & Pages →
 * Create Worker → paste this file → Settings → Domains & Routes → Add Route:
 *   tpowellness.com/MonthlyReport*
 *
 * Password: the dashboard variable/secret `PASSWORD` if set, otherwise
 * DEFAULT_PASSWORD below. Any username is accepted.
 */
const DEFAULT_PASSWORD = "Tpo888";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const guarded = pathname === "/MonthlyReport" || pathname.startsWith("/MonthlyReport/");
    if (guarded && !authorized(request, env)) return challenge();
    return fetch(request); // forwards to the origin defined by the zone DNS (GitHub Pages)
  },
};

function authorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) return false;
  let credentials = "";
  try { credentials = atob(match[1]); } catch { return false; }
  const separator = credentials.indexOf(":");
  if (separator < 0) return false;
  return timingSafeEqual(credentials.slice(separator + 1), String(env.PASSWORD || DEFAULT_PASSWORD));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function challenge() {
  return new Response("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="TPO Monthly Report", charset="UTF-8"' },
  });
}
