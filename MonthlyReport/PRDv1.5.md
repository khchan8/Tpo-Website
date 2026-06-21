# PRD v1.5 — Content Externalization (Sheet-Driven Editorial)

**Status:** Draft for sign-off · **Date:** 2026-06-20
**Goal:** Make the monthly workflow **sheet-only**. After this, updating the report each month = edit
the Google Sheet (data + content). No code edits, no `git push`, no Claude.
**Scope:** Front-end SPA (`MonthlyReport/`) + two new sheet tabs. No Apps Script changes.

---

## 1. Problem

Right now several pieces of **editorial / time-sensitive content live in the code**, so changing them
requires a developer + a push:

| Content | Today | Changes how often? |
|---|---|---|
| Glossary terms & definitions | Hardcoded array in `views.js` | Occasionally (board vocabulary) |
| Currency ("THB") | Hardcoded in `index.html` footer + `config.js` | Rarely, but it's data |
| Company name / report title | Hardcoded in `config.js` + `index.html` | Rarely |
| Low-season months (Jun–Oct) | Hardcoded `Set` in `compute.js` (×2 spots) | Rarely, but `Assumptions` already stores it |
| View subtitles & section descriptions | Hardcoded strings in each view | **Monthly** (reference the current quarter) |
| Briefing fallback messages | Hardcoded | Monthly |
| "Q2 2026 / Through May" narrative | Hardcoded prose in several views | **Monthly** (stale the moment a new month lands) |

Meanwhile the **`Assumptions` tab already holds** `Currency`, `Low season`, `Reporting period`,
`Active Customers rule`, `Q2 2026 cordon` — but the site **reads none of them** (only the customer
names + margins in cols A–B).

**The win:** move all of the above into the sheet, with safe fallbacks, so a non-technical update of
the sheet is the complete monthly workflow.

---

## 2. Proposed sheet changes

### 2.1 New tab — `Glossary`
Two columns, one row per term:
```
Term | Definition
Low season (Jun – Oct) | The seasonal trough — outside this window, revenue and active customers step up materially.
Q2 2026 cordon | Through May only — never label as a complete quarter, never annualize or extrapolate.
…  (seed with the 7 terms currently in views.js)
```
Drives the **Glossary** view (§4.1).

### 2.2 New tab — `Content`
A key → value store for every editorial string, keyed by a stable id. One row each:
```
Key                       | Value
company.name              | TPO Wellness
report.title              | Monthly Performance — Board Briefing
currency                  | THB
footer.note               | Reported in {currency}   (or just "Reported in THB")
overview.subtitle         | Top-line performance and customer mix at a glance.
seasonality.subtitle      | The business is structurally seasonal — Jun through Oct is the low season.
financials.subtitle       | Monthly figures from MonthlyFinancials; quarterly from the Quarterly Financials tab.
workingcapital.subtitle   | Cash, receivables, inventory and payables — and the resulting Net Working Capital.
forwardlooking.subtitle   | Risk register and seasonal inflection.
briefing.fallback         | Commentary pending — click "Generate Commentary" in the Google Sheet menu.
reconciliation.note       | Customer-level revenue and P&L revenue disagree on {n} month(s)…
```
*Placeholders like `{currency}` / `{n}` are filled by the code at render time.* Drives subtitles,
fallbacks, footer, header brand/title (§4.2). Unknown keys silently fall back to the built-in default.

### 2.3 Use the `Assumptions` params already there
`shapeAssumptions` already parses cols D–E into a `params` map; it's just unused. Wire it up:
- `Currency` → footer + money formatting suffix.
- `Low season` (e.g. "June - October") → parsed into the month set that drives the low-season bands
  **and** the Forward-Looking "next month enters low season" logic (replaces the hardcoded `Jun–Oct`).
- `Reporting period (as-of)` → optional explicit label (the site already derives it from data; this
  is a cross-check).

---

## 3. What moves where

| Today (code) | After (sheet) | Fallback if missing |
|---|---|---|
| `views.js` glossary array | `Glossary` tab | built-in 7 terms |
| `index.html` "Reported in THB" | `Content.footer.note` / Assumptions `Currency` | "Reported in THB" |
| `config.js` COMPANY / REPORT_TITLE | `Content.company.name` / `Content.report.title` | current values |
| `compute.js` `LOW_SEASON` set | `Assumptions` `Low season` parsed | Jun–Oct |
| `views.js` per-view subtitle strings | `Content.<view>.subtitle` | current strings |
| `briefingCard` fallback strings | `Content.briefing.fallback` | current string |
| Forward-Looking "next month low" hardcode | derived from `Low season` param | Jun–Oct |

**Stays in code (structural / technical):** design tokens, chart options, KPI metric selections,
nav/routing, formatting & math (`compute.js`), the reconciliation logic.

---

## 4. Design

### 4.1 Glossary view
Read `data.glossary` (from the `Glossary` tab: `[{term, definition}]`). Render exactly as today.
Empty tab → fall back to the built-in list.

### 4.2 Brand / title / currency
A single `content(key, fallback)` helper reads from `data.content` (the `Content` tab as an object).
- Header brand + report title + `<title>` → `content("company.name")`, `content("report.title")`.
- Footer → `content("footer.note", "Reported in THB")`, with `{currency}` replaced from
  `assumptions.params.Currency` (or `content("currency")`).
- Money formatting: the `฿` symbol is cosmetic and can stay in the formatter; the footer text is what
  references the currency code.

### 4.3 Dynamic low season
`compute.js` gains `setLowSeason(monthsArray)`; `data.js` calls it from the `Assumptions` `Low season`
param at load. `isLowSeason`, the chart bands, and the Forward-Looking seasonal banner all follow.
Default `["Jun","Jul","Aug","Sep","Oct"]` if the param is absent.

### 4.4 Time-sensitive narrative
Replace literal "Q2 2026" / "Through May" prose with values **derived from the data** (the current
quarter label and the partial-month count — already computed by `quarterCordon`). So the banner reads
"Q3 2026 covers 1 month only (through Jul-26)…" automatically next month — no edits.

### 4.5 Fallback contract
Every externalized string has a built-in default. If the sheet tab is missing a key (or the whole
tab), the site uses the default and continues. **The site never breaks because of a missing content
row.**

---

## 5. Monthly workflow (target)

1. Update data tabs (`MonthlyFinancials`, `CustomerRevenueMonthly`/`Quarterly`, `CustomerCount`,
   `1. Working Capital`, board tables).
2. Optionally tweak `Content` / `Glossary` wording.
3. Run **📊 TPO → Generate Commentary**.
4. Share the sheet; reload the site. **Done — no git, no push.**

---

## 6. Implementation plan (after approval)

1. **Sheet seeds:** add `Glossary` + `Content` tabs to `TPO_Monthly_Input.xlsx` (scriptable); you
   replicate in Google Sheets. Add `company.name` / `report.title` rows + a `Currency`/`Low season`
   note if not present.
2. `config.js` `TABS`: add `"Glossary"`, `"Content"`.
3. `data.js`: `shapeGlossary(rows)` → `[{term, definition}]`; `shapeContent(rows)` → `{key:value}`;
   expose `data.glossary`, `data.content`; wire `assumptions.params` through.
4. `compute.js`: configurable low-season set.
5. `views.js`: `content(key, fallback)` helper; replace hardcoded glossary, subtitles, fallbacks,
   footer/brand; derive time-sensitive text from `quarterCordon`.
6. `index.html`: brand/title/footer read from config-injected content (or left as defaults filled by JS).
7. Bump `?v=19`; verify fallbacks (delete a key → default shows).

**Files:** `js/data.js`, `js/compute.js`, `js/views.js`, `js/app.js` (footer as-of already dynamic),
`config.js`, `index.html`, + the two new sheet tabs.

---

## 7. Acceptance criteria

1. Editing `Glossary` tab text changes the Glossary view with no code change.
2. Editing `Content` rows (subtitle, footer note, company name) changes the site with no code change.
3. Changing `Assumptions` `Low season` to e.g. "May - September" moves the seasonal bands.
4. Changing `Assumptions` `Currency` updates the footer text.
5. Deleting the `Glossary` or `Content` tab entirely → site still renders with built-in defaults.
6. The "Q2 2026 / Through May" banners derive from data; after adding June they re-label themselves.
7. No regression in any chart, KPI, or the reconciliation chip.

---

## 8. Out of scope (this PRD)

- Apps Script commentary generator *beyond* the customer work in §9.
- Multi-currency conversion (only the displayed code/suffix is externalized).
- Per-user personalization / auth.
- Re-doing the reconciliation chip (it stays as-is; see chat note on "Data note · N gaps").

---

## 9. Customer extensibility — adding a new customer

**Question:** *If a new customer is added to the Google Sheet, does the site handle it gracefully?
And can the Apps Script add a customer?*

### 9.1 Site behavior today (verified — it's already data-driven)
A grep confirms **no customer name is hardcoded anywhere**. Three places read customers from the
`Assumptions` tab:
- Site nav/subnav — `app.js` (`assumptions.customers`)
- The customer view — `views.js` (`customers.find(c => c.slug === slug)`)
- Commentary task list — `Code.gs buildAllTasks_` (`getRows_(TABS.ASSUMPTIONS)`)

So a new customer **already appears automatically** in the Customers subnav, gets its own view, joins
the Overview mix donut (if present in `2. Customer Economics`), and gets a Commentary briefing row on
the next Generate Commentary run — **with no code change**.

**Minimum to make a customer useful:**
1. `Assumptions` → name + contribution margin (REQUIRED; drives nav + view + commentary key).
2. `CustomerRevenueQuarterly` → rows for the customer (drives the Q-to-Q chart + KPIs — primary source).
3. *(Optional)* `2. Customer Economics` → a row (Overview mix donut + econ KPIs).
4. *(Optional)* `CustomerRevenueMonthly` → rows (M-to-M detail).

**Graceful degradation:** a customer in `Assumptions` with no revenue anywhere renders with "—" KPIs,
an empty chart, and a "monthly detail not entered" note. It never crashes.

### 9.2 Caveats that would bite a new customer (fix as part of this work)
a. **Slug mismatch (latent bug).** Apps Script builds the commentary key with
   `name.toLowerCase().replace(/\s+/g,"-")`; the site uses `slugify` (lowercase + non-alphanumeric→"-"
   + collapse). They agree for plain names ("Auntie Aloha" → `auntie-aloha`) but **diverge on
   punctuation** — e.g. "Café & Co" → Apps Script `café-&-co` vs site `cafe-co`. A divergent slug
   means the commentary row key ≠ the site's briefing key → **the briefing silently never shows** for
   that customer. → Unify on one slug rule (apply the site's `slugify` in Apps Script).
b. **Commentary prompt uses the wrong source.** `buildCustomerFigures_` reads
   `CustomerRevenueMonthly` (sparse/empty for most customers) → the prompt often says *"No revenue
   rows found"* → weak commentary. The site displays from `CustomerRevenueQuarterly`. → Switch
   `buildCustomerFigures_` to `CustomerRevenueQuarterly` so the briefing matches the chart.
c. **Palette wrap.** ECharts uses 7 colors; >7 customers reuse colors. Cosmetic — extend the palette
   if you expect >7 customers.
d. *(Related, not customer-specific)* **`buildWorkingCapitalFigures_` off-by-one** — reads
   `wcRows[1]` as the header, but the Working Capital header is row 0 (same root cause as the site
   bug fixed in v1.4). Fix alongside so WC commentary is correct.

### 9.3 Proposed Apps Script: "Add Customer…" wizard
New menu item under 📊 TPO:
```
📊 TPO
  Generate Commentary…
  ---
  Add Customer…        ← NEW
  ---
  Test Connection
  Settings  ▸
```
Flow (HtmlService modal, same scaffolding/CSS as the Settings dialog):
1. Inputs: **Customer name**, **Contribution margin** (%, sensible default), optional **"seed
   quarterly rows"** checkbox (default on).
2. **Validate:** name non-empty; **not a duplicate** of an existing customer (case-insensitive, by
   slug); margin parses to a number.
3. On confirm:
   - Append `{name, margin}` to `Assumptions` (cols A–B).
   - Seed `CustomerRevenueQuarterly`: one row per quarter already present in that tab (copy the
     quarter labels from an existing customer), `Revenue` blank — so the user only types numbers.
   - Append a `Commentary` row for the new slug (so Generate Commentary picks it up immediately).
   - *(Optional)* seed a `2. Customer Economics` row for the latest quarter (blank).
4. Toast: *"Added `<name>`. Enter their quarterly revenue in CustomerRevenueQuarterly, then
   Generate Commentary (Resume)."*
5. **Safe:** Cancel changes nothing; a duplicate is rejected with a clear message; the slug is
   computed with the unified `slugify_` so the site and commentary agree.

**Result:** adding a customer becomes a ~30-second, no-code, sheet-only action; the site and the
commentary pick it up automatically on reload / next generation.

### 9.4 Acceptance criteria (customer add)
1. Add a customer via the wizard → it appears in the Customers subnav on reload, no code change.
2. After entering quarterly revenue, its Q-to-Q chart + KPIs populate.
3. Generate Commentary produces a briefing for the new customer, and it displays on the site
   (slug matches).
4. A customer with punctuation in the name (e.g. "Café & Co") gets one consistent slug across
   Apps Script + site → briefing displays.
5. Adding a duplicate name is rejected with a clear message.
6. Cancelling the wizard changes nothing.

### 9.5 Implementation notes
- Add `CUST_REV_Q: "CustomerRevenueQuarterly"` to the `TABS` map.
- Add a shared `slugify_(name)` in `Code.gs` that matches the site's `D.slugify`; use it in
  `buildAllTasks_` and the wizard.
- `buildCustomerFigures_` reads `getRows_(TABS.CUST_REV_Q)` (quarterly) → latest-quarter revenue,
  GP estimate (×margin), quarters reported.
- Fix `buildWorkingCapitalFigures_` header row (0 not 1).
- Wizard dialog reuses the Settings dialog pattern (same CSS tokens, `google.script.run`).

---

## 10. LLM retry / rate-limit decoupling (Apps Script)

**Problem:** The retry/backoff machinery was built for **Gemini's free-tier quotas** (~5 req/min,
needs 1.5s→3s→6s exponential backoff), then threaded through **every** provider via one shared
`runWithRetry_` plus a single global `LLM_RATE_LIMIT` toggle. MiniMax / OpenAI-compatible traffic
ends up flowing through Gemini-shaped code paths. It has become coupled and hard to reason about.

### 10.1 What's actually wrong today (verified in `Code.gs`)
1. **Dead code.** `LLM_CONCURRENCY` (l.312) and `LLM_STAGGER_MS` (l.313) are defined but **never
   referenced** anywhere — leftover from a concurrent-execution design that was abandoned (generation
   is sequential: one task per trigger tick). Misleading.
2. **Global toggle read inside the shared loop.** `runWithRetry_` calls `getRateLimit_()` itself
   (l.388) and branches `baseMs = rateLimited ? 1500 : 0`. Provider behaviour is decided by a global
   flag, not by the provider.
3. **`Retry-After` header is never parsed.** The string "Retry-After" appears only in *comments*
   (l.252, 1085, 1350). `parseRetryDelayMs_` (l.497) only extracts Gemini's `"retry in Ns"` **body**
   text. So when MiniMax / OpenAI-compat returns `429` with a `Retry-After: 30` **header**, it is
   **ignored**, and with rate-limit OFF the loop retries at **0 ms** — i.e. it hammers the endpoint.
   A real correctness bug hiding inside the coupling.
4. **Truncation retry is Gemini-motivated but global.** The MAX_TOKENS / no-terminator retry
   (l.411–420, from the 600→1024-token free-tier fix) runs for every provider, adding synthetic
   backoff sleeps to MiniMax runs that don't need them.
5. **One size fits all.** `LLM_MAX_RETRIES = 5`, `LLM_BASE_BACKOFF_MS = 1500`, `LLM_MAX_BACKOFF_MS =
   60000` are globals; there's no way to say "Gemini = cautious, MiniMax = lean" without the toggle.

### 10.2 Proposal: a **retry policy per provider**, one generic executor

Move every provider-specific knob into a **policy object**, and make the shared loop take it as a
parameter (no global state read inside the loop). Provider quirks stop leaking into shared code.

```js
// Each provider describes its own retry behaviour.
const POLICIES = {
  gemini: {
    label: "Gemini",
    maxRetries: 5,
    backoffBaseMs: 1500,      // exponential: 1500 → 3000 → 6000 …
    backoffCapMs: 60000,
    retryOnTruncation: true,  // free-tier 1024-token budget can cut mid-sentence
    retryHintMs: (res, body) => parseGeminiRetryMs_(body),       // "retry in 6.7s" in the body
  },
  openai_compat: {            // used for minimax + openai_compat providers
    label: "OpenAI-compatible",
    maxRetries: 3,
    backoffBaseMs: 0,         // no synthetic backoff — retry fast
    backoffCapMs: 30000,
    retryOnTruncation: false,
    retryHintMs: (res, body) => parseRetryAfterHeaderMs_(res),   // Retry-After header (seconds)
  },
};
```

A single generic executor replaces the current `runWithRetry_`:
```js
function requestWithPolicy_(label, requestFn, policy, opts) {
  // maxRetries, backoff, truncation, and hint-parsing all come from `policy`.
  // No getRateLimit_() read here. (See §10.4 for the optional override.)
}
```
- `callGemini_(…)`         → `requestWithPolicy_(model, fn, POLICIES.gemini, opts)`
- `callOpenAICompat_(…)`   → `requestWithPolicy_(model, fn, POLICIES.openai_compat, opts)`
- `callLLM_(…)`            just dispatches (unchanged).

### 10.3 What gets simpler / deleted
- **Delete** `LLM_CONCURRENCY` and `LLM_STAGGER_MS` (dead).
- **Delete** the `rateLimited`/`baseMs` branch inside the loop — the base comes from the policy.
- **Split** `parseRetryDelayMs_` into two tiny, honestly-named functions:
  - `parseGeminiRetryMs_(body)` — regex `"retry in Ns"` from the body (current logic);
  - `parseRetryAfterHeaderMs_(res)` — read `res.getHeaders()["Retry-After"]` (seconds → ms). **New**,
    fixes the OpenAI-compat bug.
  - Each policy points `retryHintMs` at the right one. The shared loop just calls `policy.retryHintMs(res, body)`.
- **Gate** the truncation retry on `policy.retryOnTruncation` (Gemini yes, others no).
- The `onRetry` toast callback keeps working; it just reports the sleep the policy chose.

### 10.4 The `LLM_RATE_LIMIT` toggle becomes a lightweight override
Today the toggle is load-bearing (it's the only thing making MiniMax fast). After this change,
**MiniMax / OpenAI-compat are fast by default** via their policy — no toggle needed for normal use.
Keep the existing `LLM_RATE_LIMIT` property + Settings checkbox as an explicit **"force fast mode"**
escape hatch that, when OFF, zeroes `backoffBaseMs` and disables truncation retry for *whichever*
provider is active (useful if someone runs Gemini on a paid key). Default per provider rules
otherwise. Net effect: simpler mental model, and the Gemini path is unchanged.

### 10.5 Correctness wins (not just cleanup)
- MiniMax / OpenAI-compat 429s now **honour the `Retry-After` header** instead of retrying at 0 ms.
- No more synthetic 1.5s/3s/6s sleeps on MiniMax success-adjacent retries.
- Truncation retries (and their sleeps) no longer fire on providers that don't truncate.

### 10.6 Acceptance criteria
1. Gemini path behaves exactly as before (5 retries, 1.5s→… exponential, body "retry in Ns",
   truncation retry). No regression.
2. MiniMax path: `backoffBaseMs = 0`, no truncation retry, and on a 429 with `Retry-After: 30` it
   waits ~30s (was: 0s).
3. `LLM_CONCURRENCY` / `LLM_STAGGER_MS` are gone; nothing references them.
4. The shared executor contains **no** provider name and **no** `getRateLimit_()` call.
5. Settings "Rate-limit sequence" toggle still works as a force-fast-mode override; OFF makes any
   provider skip synthetic backoff + truncation retry.
6. Generating all commentary with MiniMax completes with meaningfully fewer/shorter sleeps than today.

### 10.7 Implementation notes
- Add `POLICIES` map + `requestWithPolicy_`; rewrite `callGemini_` / `callOpenAICompat_` to call it.
- Add `parseRetryAfterHeaderMs_(res)`; keep `parseGeminiRetryMs_(body)` (rename of the body parser).
- Apply the `LLM_RATE_LIMIT` override inside `requestWithPolicy_` at the top (one place): if the
  override is "off", force `baseMs = 0` and `retryOnTruncation = false` on the chosen policy.
- Leave response extraction (`extractAssistantText_`, `extractFinishReason_`, `splitThinking_`) as-is
  — those are already provider-aware by response shape and stay shared.
- No Settings-UI change required (the toggle's label/help can stay; optionally reword to
  "Force fast mode (disable synthetic backoff)").

---

## 11. Optimizations (Implemented)

1. **Seasonality Expansion Safety**: The `Low season` parameter parses month ranges robustly using modulo arithmetic (e.g. `November - February` safely resolves to `Nov, Dec, Jan, Feb` crossing the year boundary).
2. **Chart Resize Debouncing**: Window resize events in `views.js` are debounced (100ms) before calling `chart.resize()` to avoid ECharts reflow layout thrashing when resizing the window.
3. **Graceful Margin Fallbacks**: The new Add Customer wizard seamlessly coerces percentage values even if inputted directly as integers (e.g. `45` → `45%`).
4. **Decoupled API Settings**: Clarified the rate limit checkbox to `Enable synthetic backoff`. When checked (ON), the system adds artificial sleeps between retries for Free-tier APIs. When unchecked (OFF), it runs as fast as the API allows, honoring native `Retry-After` headers if available.
