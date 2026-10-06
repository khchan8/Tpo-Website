/**
 * Cloudflare Worker — HTTP Basic Auth gate for https://tpowellness.com/MonthlyReport/
 * The Worker sits in front of GitHub Pages (origin). Without valid credentials the
 * browser receives 401 and never receives any page content, source, or config.js.
 *
 * Deployment (see SETUP.md "Password protection"):
 * dashboard → Workers & Pages → Create an app → Start with Hello World →
 * name it `monthly-report-gate` → Deploy → Edit code → paste this file → Save and deploy.
 * Settings → Domains & Routes → Add Route: `*tpowellness.com/MonthlyReport*`
 *
 * Credentials:
 * - PASSWORD: the dashboard variable/secret `PASSWORD` if set, otherwise DEFAULT_PASSWORD.
 * - USERNAME (optional): the dashboard variable/secret `USERNAME` if set, otherwise DEFAULT_USERNAME.
 *   If left empty, any username is accepted.
 */
const DEFAULT_PASSWORD = "Tpo888";
const DEFAULT_USERNAME = ""; // Leave empty to accept any username, or set e.g. "admin"

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

  const username = credentials.slice(0, separator);
  const password = credentials.slice(separator + 1);

  const expectedUser = String(env.USERNAME || DEFAULT_USERNAME).trim();
  if (expectedUser && !timingSafeEqual(username, expectedUser)) {
    return false;
  }

  const expectedPass = String(env.PASSWORD || DEFAULT_PASSWORD);
  return timingSafeEqual(password, expectedPass);
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

