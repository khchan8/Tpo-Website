# TPO Wellness — Monthly Performance Board Portal

A static, board-ready web portal that reads a **Google Sheet live** and renders the monthly
briefing. It was originally prototyped with NotebookLM (see `Enhancing Board Report with
NotebookLM.md`) but that path produced unreliable numbers, so the design pivoted to a
**direct‑read architecture**: the Google Sheet is the single source of truth, a static SPA renders
it, and an Apps Script generates the prose commentary with the LLM provider of your choice.

> **This document supersedes `SETUP.md`** (kept for history). It reflects the current v1.5+ build.

---

## ⏱ Quick start (≈5 minutes)

The fastest path to a live portal. Details for each step are in §5.

1. **Make a Google Sheet** — Google Sheets → *File → Import → Upload* `TPO_Monthly_Input.xlsx`
   (this folder) → *Replace spreadsheet*. Confirm 13 tabs (§3).
2. **Share it** — *Share → Anyone with the link → Viewer* (this is the data on/off switch).
3. **Get a read‑only Sheets API key** — Google Cloud Console → enable **Sheets API** → create an
   **API key** → restrict it to **HTTP referrers** `https://khchan8.github.io/*` **and**
   `https://tpowellness.com/*`, and to the Sheets API only.
4. **Fill `config.js`** — paste the **Sheet ID** (from the sheet URL) and the **API key**.
5. **Install the commentary engine** — in the sheet: *Extensions → Apps Script* → delete the
   placeholder → paste all of `apps-script/Code.gs` → Save → reload. Then **📊 TPO → Settings** →
   pick your LLM provider (Gemini / MiniMax / OpenAI‑compatible), paste its key, **Test connection**
   → **Save**.
6. **Publish** — push the folder to GitHub and enable **Pages** (branch `main`, root). Visit
   `https://khchan8.github.io/Tpo-Website/MonthlyReport/`.

Then each month: edit the data tabs → **📊 TPO → Generate Commentary (Resume)…** → reload. No code,
no push. (Full workflow in §6.)

---

## 1. How it works

```
 ┌──────────────────┐   Google Sheets API v4 (read‑only, key‑authed)   ┌──────────────────────┐
 │  Google Sheet    │ ◄────────────── batchGet ──────────────────────  │  Static SPA          │
 │  (13 tabs)       │                                                 │  index.html + js/    │
 │  source of truth │                                                 │  hosted on GitHub    │
 └────────┬─────────┘                                                 │  Pages → custom domain│
          │                                                           └──────────▲───────────┘
          │ bound Apps Script                                                    │ reads Commentary tab
          ▼                                                                      │
 ┌──────────────────┐   LLM call (Gemini / MiniMax / OpenAI‑compatible)         │
 │  📊 TPO menu     │ ──writes Briefing text──►  Commentary tab  ───────────────┘
 │  Generate        │ ──writes Thinking trace──► Commentary tab (col G)
 │  Commentary      │
 └──────────────────┘
```

- **Deterministic math only.** Every total, margin, ratio, and quarter roll‑up is computed in the
  browser (`js/compute.js`). The LLM never does arithmetic — it only writes prose from a pre‑built
  figures block. (This is the lesson from the NotebookLM experiment.)
- **No server.** The SPA is pure HTML/JS/CSS on GitHub Pages. The only "backend" is the Google Sheet
  itself (read via the Sheets API) and the Apps Script (bound to the sheet) that writes commentary.

---

## 2. Features

### Portal (the website)
- **8 views** with a single‑row nav: **Overview · Dashboard · Seasonality · Customers ▾ ·
  Financials · Working Capital · Forward‑Looking · Glossary**.
- **Data‑driven Customers** — every customer in the `Assumptions` tab gets its own view
  (sub‑nav + dedicated page) automatically; no code change to add one.
- **Per‑chart range selectors** — All / 12M / 6M / YTD (monthly charts) and All / Last 4Q /
  Last 8Q (quarterly charts).
- **Strategic Dashboard** view — the full KPI matrix across reference periods + a metric‑selector
  bar chart.
- **Financials** shows **both** monthly and quarterly P&L (chart + table); quarterly is read from
  the `Quarterly Financials` tab.
- **Partial‑quarter handling** — the current quarter is flagged amber while incomplete and turns
  green automatically once its 3rd month is entered (data‑driven, no code edits).
- **Reconciliation health indicator** — surfaces when Σ customer revenue ≠ P&L revenue.
- **Click‑through** — click a customer segment in the Overview mix donut to jump to that customer.
- **Executive‑Briefing design system** — Fraunces + Inter, ECharts, low‑season bands, hatched
  partial bars, KPI tiles, briefing cards.

### Content externalization (edit the sheet, not the code)
- **`Glossary` tab** drives the Glossary view.
- **`Content` tab** (key → value) drives subtitles, the briefing fallback message, brand/title, etc.
  Unknown keys silently fall back to built‑in defaults, so a missing row never breaks the site.

### Apps Script (commentary engine, `apps-script/Code.gs`)
- **Multi‑provider**: Google Gemini, MiniMax (M‑series), or any OpenAI‑compatible endpoint —
  chosen in a **Settings dialog** (provider, API key, endpoint URL, model, **Fetch models** button,
  rate‑limit toggle). Keys live in Script Properties, never in code.
- **Resumable generation** — processes one briefing per minute via a time‑driven trigger, safely
  under the 6‑minute Apps Script cap. Toasts show progress; **Pause** / **Reset Status** controls.
- **Thinking‑model support** — splits `<think>…</think>` traces into column G ("Thinking Info") so
  the board‑facing commentary (column B) stays clean.
- **Retry / backoff** — exponential backoff with server `retry`‑hint honoring (per‑provider policy
  work is proposed in `PRDv1.5.md` §10).
- **Add Customer… wizard** — adds a customer to `Assumptions`, seeds their `CustomerRevenueQuarterly`
  rows, and creates the `Commentary` row — all from a menu dialog.
- **Live model listing** — the **Fetch models** button pulls the model list straight from the
  provider's `/models` endpoint.

### Security & deployment
- Read‑only, Sheets‑API‑only, **referrer‑restricted** API key.
- Custom domain (`tpowellness.com`) on Cloudflare; optional **Cloudflare Zero Trust** login for
  per‑email access control (see `PRDv1.6.md`).

---

## 3. The Google Sheet (13 tabs)

Maintained by you in Google Sheets. The latest seed is `TPO_Monthly_Input.xlsx` in this folder.

| Tab | Purpose | Layout |
|---|---|---|
| `README` | Notes for the sheet maintainer | free text |
| `Assumptions` | Customer list + margins; global params (Currency, Low season, Reporting period) | A‑B customers; D‑E params |
| `Glossary` | Terms shown in the Glossary view | `Term \| Definition` |
| `MonthlyFinancials` | Raw monthly P&L | `Month \| Total Revenue \| COGS \| GP \| SG&A \| EBIT \| Net Income \| Quarter` |
| `Quarterly Financials` | Quarterly P&L (long format, SUMIF from monthly) | `Quarter \| Total Revenue \| COGS \| …` |
| `CustomerRevenueMonthly` | Per‑customer monthly revenue (optional monthly detail) | `Customer \| Month \| Revenue` |
| `CustomerRevenueQuarterly` | Per‑customer quarterly revenue — **drives each customer's Q‑to‑Q chart** | `Customer \| Quarter \| Revenue` |
| `CustomerCount` | Active customer count by month | `Month \| Customer Count` |
| `1. Working Capital` | Cash, AR, Inventory, AP, NWC by month | `Reporting Month \| …` |
| `2. Customer Economics` | Per‑customer GP / concentration / margin | `Customer Brand \| Quarter \| …` |
| `3. Strategic Dashboard` | KPI matrix across reference periods | `Strategic Metric \| Q1 2025 \| …` |
| `4. Forward-Looking Risk` | Q2'25 vs Q2'26 partial P&L + Risk Status | `Reporting Period \| … \| Risk Status` |
| `Commentary` | Generated briefings (written by the Apps Script) | `View \| Commentary \| Status \| … \| Thinking Info` |

> Column layouts matter — the site reads by position. If you rename a column, update the matching
> shaper in `js/data.js`.

---

## 4. Prerequisites

| # | Item | Where |
|---|---|---|
| 1 | A Google account | — |
| 2 | The seed workbook `TPO_Monthly_Input.xlsx` (this folder) | local |
| 3 | A **read‑only Google Sheets API key** (referrer‑restricted) | Google Cloud Console |
| 4 | An **LLM API key** for commentary — Gemini (AI Studio), MiniMax, or any OpenAI‑compatible provider | provider dashboard |
| 5 | A GitHub repo for the site (this folder) | GitHub |

---

## 5. Setup (one‑time)

### Step 1 — Create the Google Sheet
1. Google Sheets → **Blank spreadsheet**.
2. **File → Import → Upload** `TPO_Monthly_Input.xlsx` → **Replace spreadsheet**.
3. Confirm all **13 tabs** from §3 are present.

### Step 2 — Create the read‑only Sheets API key
1. Google Cloud Console → **APIs & Services → Library** → enable **Google Sheets API**.
2. **Credentials → Create credentials → API key**.
3. **Edit the key**:
   - **Application restrictions → HTTP referrers (web sites)** and add **both** origins you'll serve from:
     - `https://khchan8.github.io/*`
     - `https://tpowellness.com/*` (and `http://tpowellness.com/*` until HTTPS is enforced)
   - **API restrictions → Restrict key → Google Sheets API**.
4. Copy the key. (It is read‑only and referrer‑locked, so it's harmless if glimpsed.)

### Step 3 — Share the sheet for API read access
- **Share → Anyone with the link → Viewer**. (The Sheets API can only read a sheet via API key when
  it's link‑shared. This is the data on/off switch — unshare to hide the report.)

### Step 4 — Fill `config.js`
Open `config.js` and set:
```js
SHEET_ID: "the-long-id-between-/d/-and-/edit-in-the-sheet-url",
API_KEY:  "your-read-only-referrer-restricted-key",
```
`TABS`, `COMPANY`, `CURRENCY`, `REPORT_TITLE` are pre‑filled; edit only if you rename a tab or rebrand.

### Step 5 — Install the Apps Script (commentary engine)
1. In the sheet: **Extensions → Apps Script**. Delete the placeholder `Code.gs`.
2. Open `apps-script/Code.gs` from this repo, copy the **entire** file, paste it in. Save.
3. Reload the sheet — the **📊 TPO** menu appears.
4. **📊 TPO → Settings → Open Settings…** and configure your provider:
   - Pick **Gemini**, **MiniMax**, or **Custom OpenAI‑compatible**.
   - Paste the API key. For non‑Gemini providers, set the **Endpoint URL**
     (MiniMax default: `https://api.minimaxi.com/v1`) and pick a model (use **Fetch models** to pull
     the live list).
   - Click **Test connection** → then **Save**. (Keys are stored in Script Properties.)
5. **📊 TPO → Generate Commentary (Resume)…** to generate the briefings into the `Commentary` tab.

> Legacy: you can also set a `GEMINI_API_KEY` script property manually under
> Project Settings → Script properties; the Settings dialog is the recommended path.

### Step 6 — Publish the site
From the repo root (`Tpo-Website/`):
```bash
git add .
git commit -m "Publish TPO Monthly Report"
git push
```
Enable **GitHub Pages** (repo Settings → Pages → branch `main` / root). Wait ~30s, then visit
`https://khchan8.github.io/Tpo-Website/MonthlyReport/`.

### Step 7 (optional) — Custom domain + Cloudflare
- Point a CNAME (e.g. `tpowellness.com`) at your Pages site; enable it under repo Settings → Pages.
- Because the site is served from the custom domain, the API‑key referrer restriction **must include
  the custom domain** (Step 2 already covers it). `index.html` carries a
  `<meta name="referrer" content="no-referrer-when-downgrade">` tag so the cross‑origin Sheets‑API
  call sends a full‑path referer that matches the restriction.
- For per‑email login gating, follow `PRDv1.6.md` (Cloudflare Zero Trust).

---

## 6. Monthly workflow (sheet‑only, no code)

1. Update the **data tabs**: `MonthlyFinancials`, `CustomerRevenueMonthly`/`CustomerRevenueQuarterly`,
   `CustomerCount`, `1. Working Capital`, and the board tables (`2. Customer Economics`,
   `3. Strategic Dashboard`, `4. Forward-Looking Risk`). `Quarterly Financials` recomputes from
   monthly via SUMIF.
2. (Optional) tweak wording in `Glossary` / `Content`.
3. **📊 TPO → Generate Commentary (Resume)…** to refresh the prose.
4. Reload the site. **Done — no git push.**

---

## 7. Adding a customer

**Easiest — the wizard:** **📊 TPO → Add Customer…** → enter name + contribution margin. It appends
to `Assumptions`, seeds the customer's `CustomerRevenueQuarterly` rows (revenue blank — just type
the numbers), and creates the `Commentary` row. Reload the site; the new customer appears under
**Customers** and its Q‑to‑Q chart populates once you enter quarterly revenue.

**Manual:** add the row to `Assumptions` (name + margin) and to `CustomerRevenueQuarterly`.

---

## 8. LLM provider configuration (Apps Script)

All via **📊 TPO → Settings → Open Settings…**:

- **Provider**: Gemini / MiniMax / Custom OpenAI‑compatible.
- **Endpoint URL**: required for non‑Gemini (MiniMax default `https://api.minimaxi.com/v1`).
- **Model**: pick from the registry, or **Fetch models** to list what the key can access, or
  **Custom…** to type any id.
- **Rate‑limit sequence**: ON for Gemini free‑tier (synthetic 1.5s→3s→6s backoff); OFF for
  MiniMax/paid (retry immediately, honor server `Retry‑After`). MiniMax is fast by default.
- **Test connection** before saving.

Thinking models (e.g. MiniMax‑M3): their `<think>…</think>` trace is auto‑split into column G.

---

## 9. Security model

- **Sheet sharing toggle is the master on/off switch.** Unshared → the site shows a graceful
  "Report not available" state (no leaked numbers). "Anyone with link → Viewer" → renders.
- **API key**: read‑only, Sheets‑API‑only, referrer‑restricted to your Pages + custom domain.
- **`config.js` contains the API key**, so **the GitHub repo must be PRIVATE** (or rely solely on
  the referrer restriction — recommended defense‑in‑depth is a private repo).
- **Site URL = the secret** you share with the board.
- **Optional hardening**: Cloudflare Zero Trust per‑email login (`PRDv1.6.md`).

---

## 10. Caching & publishing updates

- The site loads JS/CSS with a `?v=N` cache‑buster (`index.html`). **When you change any JS/CSS,
  bump the `?v=` number** so browsers refetch. (Data‑only changes need no bump — the SPA reads the
  sheet live.)
- GitHub Pages caches assets (~4h) and serves via a CDN; after a push, hard‑reload
  (**Ctrl/Cmd + Shift + R**) or wait out the CDN window.
- Data updates (sheet only) are **instant** on reload — no CDN concern, because the SPA fetches the
  sheet at runtime.

---

## 11. File map

```
MonthlyReport/
├── index.html              ← SPA shell (Tailwind + ECharts CDN), referrer meta, cache‑busted scripts
├── config.js               ← SHEET_ID, API_KEY, TABS, COMPANY/CURRENCY/REPORT_TITLE  (edit once)
├── README.md               ← this file
├── SETUP.md                ← older condensed setup (superseded by README)
├── PRDv1.4.md / 1.5 / 1.6  ← design history & open proposals
├── TPO_Monthly_Input.xlsx  ← latest seed workbook (13 tabs) — import into Google Sheets
├── assets/
│   └── styles.css          ← Executive‑Briefing design accents (KPI tiles, range control, nav…)
├── js/
│   ├── data.js             ← Sheets API batchGet + shapers (incl. Glossary, Content, quarterly)
│   ├── compute.js          ← deterministic math (no LLM): rollups, margins, cordon, reconciliation
│   ├── views.js            ← every view's render fn + chartCard + boardTable + content() helper
│   └── app.js              ← router, nav, boot, chart disposal
└── apps-script/
    └── Code.gs             ← paste into Extensions → Apps Script (commentary engine + Settings)
```

---

## 12. What the site computes vs. shows verbatim

| Thing | Source |
|---|---|
| Monthly P&L | `MonthlyFinancials` (raw) |
| Quarterly P&L | `Quarterly Financials` (long, SUMIF) |
| Working capital, Customer Economics, Dashboard, Forward‑Looking | board tabs (shown) |
| Quarter roll‑ups, NWC, margins, concentration, seasonality bands, partial‑quarter flag, reconciliation | **computed in JS** |
| Commentary prose | LLM (via Apps Script) → `Commentary` tab |
| Charts | ECharts, fed by computed values |

---

## 13. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Site loads but **no data / "Report not available"** | Sheet not link‑shared (Step 3), or API‑key referrer doesn't include the domain you're visiting (Step 2). |
| Data loads on `github.io` but **not on the custom domain** | API‑key referrer restriction missing the custom domain — add `https://tpowellness.com/*`. |
| **Numbers look shifted / COGS shown as revenue** | A board‑tab header row moved; check the column layout matches §3 and the shaper in `js/data.js`. |
| **Charts spill over / wrong size on first click** | Stale cached JS — hard‑reload (`Ctrl/Cmd+Shift+R`); confirm `?v=` was bumped. |
| **"Data note · N gaps" chip** | Σ customer revenue ≠ P&L revenue for N months — populate `CustomerRevenueMonthly`/`Quarterly` fully; informational, non‑blocking. |
| **Commentary not generating** | No API key / wrong provider — **📊 TPO → Settings**; check the Error column in `Commentary`. |
| **MiniMax 429 / rate‑limited** | Rate‑limit toggle or model quota; the engine backs off and retries; check toasts + Error column. |

---

## 14. Roadmap / open proposals

Implemented: v1.4 chart/UX rebuild, Strategic Dashboard, customer quarterly trend, content
externalization (Glossary/Content), Add‑Customer wizard, multi‑provider commentary.
Proposed (see `PRDv1.5.md`): §10 retry/rate‑limit decoupling, §11 Apps Script figure‑builder
column fixes; `PRDv1.6.md`: Cloudflare Zero Trust access control.

---

*Reported in THB. The Google Sheet is the single source of truth; this portal only reads and
renders it.*
