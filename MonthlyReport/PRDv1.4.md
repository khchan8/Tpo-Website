# PRD v1.4 — TPO Wellness Monthly Performance Website

**Status:** Draft for sign-off · **Author:** Claude Code · **Date:** 2026-06-20
**Scope:** Front-end SPA (`MonthlyReport/`) only. No Apps Script changes in this PRD.
**Rule:** No production code is written until this PRD is approved. Approve, edit, or reject sections below.

---

## 1. Purpose

Turn the existing static SPA (Tailwind + ECharts, reading a live Google Sheet) into a polished,
correct, board-ready briefing. v1.3 shipped the data plumbing but has a cluster of visible defects
(charts spill over, only one customer shows, two board tables are empty/mis-headed, no Strategic
Dashboard view) plus two requested enhancements (per-chart data-range selector, tighter nav).

This PRD defines the **target interface** and the **root-cause fixes** for every reported issue,
grounded in the **actual** sheet structure (verified by probing every tab — see Appendix A).

---

## 2. Goals & non-goals

**Goals**
1. Every chart paints at the correct size on **first** view (no spillover, no "fixes on re-click").
2. Every customer in the Assumptions tab renders a real view (all 5, not just Mana).
3. Every tab in the sheet that the board expects has a corresponding, correct view — including a new
   **Strategic Dashboard** view.
4. Each time-series chart has a **data-range control** the viewer can change.
5. Board tables (Working Capital, Forward-Looking) show correct headers and all rows.
6. Nav is a single, non-wrapping row at desktop widths.
7. Footer "Source: Google Sheet (live)" removed.

**Non-goals (this PRD)**
- Apps Script / commentary generator (separate track, already shipped v1.3).
- Changing the sheet itself (we adapt the SPA to the sheet as-is).
- Auth / multi-tenant (single public board page, link = the secret).
- Dark mode, i18n, PDF export.

---

## 3. Problem inventory — root causes (each verified)

Every item below was confirmed against the live sheet. The "Evidence" cites the actual row layout.

### 3.1 Charts spill over on first paint (Overview, Customers)
- **Symptom:** First click → Monthly-revenue chart overflows into the Customer-mix card; pie sits
  outside its frame. Clicking away and back "fixes" it.
- **Root cause:** `views.js` initialises ECharts inside `queueMicrotask(() => ensureChart(...))`,
  which fires **before the CSS grid has laid the container out**. `echarts.init(host)` reads the
  host's width at call time — when that width is still 0, the chart renders at 0/wrong width and
  overflows its neighbours. Re-rendering later (after layout) sizes it correctly, hence the
  self-heal.
- **Fix:** Replace the `queueMicrotask + ensureChart` pattern with a `chartCard()` component that
  (a) defers init with a **double `requestAnimationFrame`**, (b) calls `instance.resize()` after
  mount, (c) attaches a **`ResizeObserver`** to re-fit on container changes, and (d) **disposes**
  the instance on view change. (§5.1)

### 3.2 Only one customer (Mana) shows
- **Symptom:** Customers area shows Mana only; the other four look blank.
- **Evidence:** `CustomerRevenueMonthly` contains **Mana rows only, and their Revenue column is
  empty** (rows r1–r7 are `Mana | May-24`, `Mana | Jun-24`, … with no value). The other four
  customers have no rows at all. Meanwhile `2. Customer Economics` has **all 5** customers with full
  quarterly Gross Revenue / Concentration / GP / Margin for Q1 2026.
- **Root cause:** `viewCustomer` sources its monthly+quarterly series from
  `data.customerRevenue[slug].series`, which is built from `CustomerRevenueMonthly` → empty for 4/5
  customers, and the 5th (Mana) is itself sparse. The real per-customer economics live in the
  Customer Economics board table and are currently unused.
- **Fix:** Source the **quarterly customer economics** from `2. Customer Economics` (reliable, all 5).
  Show **monthly** series from `CustomerRevenueMonthly` **where it exists**, clearly labelled
  "monthly detail (where entered)". The subnav lists all 5 from Assumptions regardless. (§6.3)

### 3.3 No Strategic Dashboard view
- **Symptom:** The site has no Strategic Dashboard; `3. Strategic Dashboard` is read by `data.js`
  but never rendered, and there's no nav entry.
- **Evidence:** `3. Strategic Dashboard` is a clean KPI matrix: rows = Strategic Metric
  (Active Customers, New Accounts, Retention, Revenue/Customer, Top-5 Concentration, EBITDA, Cash
  Balance, …), columns = Q1 2025 / Q4 2025 / Q1 2026 / Q2 2026 (Through May).
- **Root cause (a):** No view function and no nav link exist.
- **Root cause (b):** `shapeDashboardBoard` starts reading at row index 3, but the sheet's header is
  row 0 and data starts row 1 → it skips the first metrics and reads garbage.
- **Fix:** Add `viewDashboard` + nav link; fix the shaper to header=row0, data from row1. (§6.6)

### 3.4 Nav wraps to two rows ("Working Capital" / "Forward-looking" are tall)
- **Symptom:** Those two buttons occupy two lines while others are one line.
- **Root cause:** Nav links have `padding 6px 10px` with **no `white-space: nowrap`**, so a two-word
  label wraps inside its own button when the flex row gets tight, doubling its height.
- **Fix:** `white-space: nowrap` on `#primary-nav a`; make the nav a single scrollable row on narrow
  widths; reserve space for the health chip so the row doesn't reflow when it appears. (§5.3)

### 3.5 Working Capital board table has no header / wrong header
- **Symptom:** "the Board table is without header and instead Row #2 in the sheet became the header."
- **Evidence:** `1. Working Capital` row 0 **is** the header
  (`Reporting Month | Cash Balance | AR | Inventory Value | AP | Net Working Capital`); data is
  rows 1+; row 7 is a `<add month>` placeholder.
- **Root cause:** `shapeWorkingCapitalBoard` sets `header = rows[1]` and starts data at `i = 2`
  (it wrongly assumes a title row at 0). So the Dec-25 **data row** is treated as the header, the
  real header row is dropped, and the placeholder row leaks in. On top of that, the view builds a
  `<thead>` with 5 cells but `<tbody>` rows with 6 cells (month + 5 values) → column drift and no
  "Month" header. (Also: `compute.nwcSeries()` then `find("Cash")` against month-labelled rows and
  returns zeros, so the WC chart is silently all-zero too.)
- **Fix:** Rewrite the shape to expose (a) `months`, (b) a `series[]` of named components
  (Cash/AR/Inventory/AP/NWC) each with a values array, and (c) explicit `tableHeaders` +
  `tableRows` for the board echo. Drop the `<add month>` row. Rewrite `nwcSeries` to consume
  `series[]` directly. Render the table with `Reporting Month` as the first column header. (§6.4)

### 3.6 Forward-Looking is empty (no chart/table)
- **Symptom:** Forward-looking view shows only the June-risk banner + commentary.
- **Evidence:** `4. Forward-Looking Risk` is **not** a Risk|Status|Mitigation register — it's a
  **forward-looking P&L comparison**: `Reporting Period | Revenue | COGS | Gross Profit | SG&A |
  Net Income | Risk Status`, with two rows: Q2 2025 (Full Quarter, "Historical Actual") and
  Q2 2026 (Apr & May, "Incomplete — High June…").
- **Root cause:** `shapeForwardLookingBoard` expects `label=r[0], status=r[1], mitigation=r[2]`
  starting at row 3. The real tab has 3 rows total (header + 2 data) and a totally different shape,
  so the shaper returns an empty `items[]` and the view renders nothing.
- **Fix:** Reshape to a comparison table (period × P&L lines) plus a **Risk Status** callout chip
  per period. Keep the seasonal June-risk banner. (§6.7)

### 3.7 Footer "Source: Google Sheet (live)"
- **Symptom:** Footer line should be removed.
- **Evidence:** `index.html` line 73 (footer) and `views.js` `viewAbout` line ~571 both reference it.
- **Fix:** Remove the source clause from the footer; keep "Reported in THB" + as-of. Trim the About
  line too. (§6.8)

---

## 4. Information architecture & navigation

### 4.1 Nav order (target)
```
Overview · Strategic Dashboard · Seasonality · Customers ▾ · Financials · Working Capital · Forward-Looking · Glossary
```
- **Strategic Dashboard** is new, placed right after Overview (it's the headline KPI matrix the
  board opens with).
- "Working Capital" and "Forward-looking" labels stay (board vocabulary) but are forced to one line.
- Single non-wrapping row on ≥1024px; horizontally scrollable with a fade on narrow widths.
- Customers keeps its pill subnav (all 5 customers), auto-selecting the first on entry.

### 4.2 Global header / footer
- Header: logo + title (unchanged), nav (§4.1), health chip ("Data healthy" / "Data note · N gaps"),
  "As of <month>".
- **Footer (revised):** remove "Source: Google Sheet (live)". Keep `Reported in THB · As of <month>`
  on the left; keep Glossary link on the right.

---

## 5. Component & design system

### 5.1 `chartCard` — the chart container with range selector (NEW)
Every chart becomes a `chartCard`:

```
┌───────────────────────────────────────────────┐
│ <h2 title>                       [All|12M|6M|YTD]│   ← header row: title left, segmented range right
├───────────────────────────────────────────────┤
│                                               │
│               ECharts canvas                  │   ← fixed height, ResizeObserver-fitted
│                                               │
└───────────────────────────────────────────────┘
```

**API (planned):**
```js
chartCard({
  title,           // string
  subtitle,        // optional small text
  rangeKey,        // 'monthly' | 'quarterly' | 'customer-monthly' | 'none'
  height,          // px
  buildOption,     // (slicedData) => ECharts option
  data,            // full series {labels:[], series:[{name,values[]}]}
})
```
- **Range control** is a segmented control bound to per-chart state. Presets:
  - `monthly`-bound charts → **All · 12M · 6M · YTD** (trailing windows on the month axis; YTD =
    months in the latest data year).
  - `quarterly`-bound charts → **All · Last 4Q · Last 8Q** (fewer points, so coarser presets).
  - `none` (e.g., donut, single-bar) → no control shown.
- On range change: slice `data` → call `buildOption` → `instance.setOption(opt, true)` (no re-init).
- **Sizing fix lives here:** init is deferred with double `requestAnimationFrame`; on init we call
  `resize()`; a `ResizeObserver` keeps it fitted; the instance is **disposed** when the view unmounts.
  This is the single change that kills 3.1.

### 5.2 `boardTable` — board echo tables
Small helper rendering a header row + body rows with the existing `.board-table` styling, plus
optional row variants (`subtotal`, `partial`). Fixes the header drift in 3.5 and powers 3.6.

### 5.3 Nav CSS (revised)
```css
#primary-nav { display:flex; align-items:center; gap:.25rem; overflow-x:auto;
               scrollbar-width:none; }
#primary-nav::-webkit-scrollbar { display:none; }
#primary-nav a { white-space:nowrap; padding:6px 10px; border-radius:4px; }
```
Reserve a fixed-width slot for the health chip so the nav doesn't reflow when it appears.

### 5.4 Design tokens (unchanged)
Ink `#0B1F3A` · Sea `#115E67` · Tide `#1A8A96` · Sand `#E9E2D0` · Gold `#C9A24B` · Rust `#A14B2A`.
ECharts palette stays. Fraunces (serif headings) + Inter (UI). No new fonts.

---

## 6. View-by-view spec

Each view: **source → KPIs → charts (with range) → tables → commentary.**

### 6.1 Overview
- KPIs: latest-month revenue, YTD revenue, YTD gross margin, active customers (latest).
- Charts: (a) Monthly revenue trend — line + low-season band, range `monthly`.
  (b) Customer mix donut (latest month) — range `none`.
- Recon WARN banner if customer vs P&L revenue diverges.
- Commentary: `overview`.

### 6.2 Strategic Dashboard (NEW)
- Source: `3. Strategic Dashboard` (fixed shape).
- Layout: KPI matrix as a board table (rows = metrics, columns = the 4 periods) + a small bar chart
  comparing a chosen metric across periods (e.g., Active Customers), range `none`.
- Highlights Q2 2026 as "Through May".
- Commentary: `strategic-dashboard` (generated in the sheet; if absent, friendly fallback).

### 6.3 Seasonality
- Charts: (a) Monthly revenue & GP (bar+line, low-season band), range `monthly`.
  (b) Active customers line, range `monthly`.
- Commentary: `seasonality`.

### 6.4 Customers (per customer, all 5)
- Subnav: all customers from Assumptions.
- KPIs: latest-month revenue, YTD revenue, mix share (latest), contribution margin.
- Charts:
  - (a) **Quarter-to-quarter** revenue & GP — sourced from **Customer Economics** (all 5 present),
    range `quarterly`. *This is the reliable per-customer chart.*
  - (b) **Month-to-month** revenue — sourced from `CustomerRevenueMonthly` **where present**;
    labelled "monthly detail (where entered)"; if a customer has no monthly rows, show an inline
    note instead of an empty chart. range `monthly`.
- Latest-quarter strip (revenue / GP est. / Δ vs prior Q).
- Commentary: `<slug>`.

### 6.5 Financials (Quarterly Performance)
- KPIs: Q1'25 / Q1'26 revenue, Δ Q1 YoY, Q2'26 partial.
- Charts: quarterly revenue bar (Q2'26 hatched/amber = partial), range `quarterly`.
- Table: quarterly P&L (Revenue…Net Income), Q2'26 row marked partial.
- Commentary: `financial-performance`.

### 6.6 Working Capital
- Source: fixed `1. Working Capital` shape (§3.5 fix).
- KPIs: latest Cash / AR / Inventory / AP / NWC.
- Charts: components line+NWC bar, range `monthly`.
- **Table:** `Reporting Month | Cash Balance | AR | Inventory | AP | Net Working Capital`, every
  real month row, NWC row styled as subtotal. (No `<add month>`.)
- Commentary: `working-capital`.

### 6.7 Forward-Looking (redesign)
- Source: fixed `4. Forward-Looking Risk` shape (§3.6 fix).
- **Comparison table:** rows = P&L lines (Revenue…Net Income), columns = Q2 2025 (Full) vs Q2 2026
  (Apr & May) + a Δ column; each period header carries its **Risk Status** chip
  ("Historical Actual" / "Incomplete — High June…").
- **Risk callout card:** surfaces the Q2 2026 Risk Status text prominently.
- Seasonal June-risk banner (kept).
- Commentary: `forward-looking`.

### 6.8 Glossary / About
- Existing glossary list; trim the trailing "Source: live Google Sheet" line.

---

## 7. Data-layer changes (`js/data.js`, `js/compute.js`)

| Shape fn | Current | Fix |
|---|---|---|
| `shapeAssumptions` | OK | No change (5 customers read correctly). |
| `shapeMonthly` | OK | No change. |
| `shapeCustomerRevenue` | OK code, **sparse data** | No code change; consumers move to Customer Economics for quarterly. |
| `shapeQuarterlyBoard` | OK (has real title row) | No change. |
| `shapeWorkingCapitalBoard` | **off-by-one + orientation** | header=row0, data from row1; drop `<add month>`; return `months`, `series[]`, `tableHeaders`, `tableRows`. |
| `shapeCustomerEconBoard` | **off-by-one** | header=row0, data from row1; return per-customer quarterly {name, quarter, revenue, concentration, gp, margin} + total. **New primary source for Customers.** |
| `shapeDashboardBoard` | **off-by-one** | header=row0, data from row1; return periods[] + metric rows. |
| `shapeForwardLookingBoard` | **wrong shape entirely** | return periods[] (each {label, pnl:{revenue,cogs,gp,sga,net}, riskStatus}). |
| `compute.nwcSeries` | breaks on new WC shape | consume `workingCapital.series[]`. |
| `compute.concentrationLatest` | OK | No change (still uses customerRevenue for latest-month mix). |

---

## 8. Acceptance criteria

1. **First-paint:** open Overview then Customers on a cold load — no chart overflows its card; no
   manual re-click needed.
2. **Customers:** all 5 customers appear in the subnav; each shows a populated quarterly chart.
3. **Strategic Dashboard:** new view reachable from nav; shows the full metric matrix.
4. **Range selector:** changing All→12M→6M→YTD on any monthly chart re-slices the x-axis without
   page reload; persists for the session.
5. **Working Capital table:** first header cell = "Reporting Month"; all real months present;
   `<add month>` gone; NWC bar chart non-zero.
6. **Forward-Looking:** comparison table with both periods + Risk Status chips visible.
7. **Nav:** single row at 1280px; "Working Capital" and "Forward-looking" render on one line.
8. **Footer:** no "Source: Google Sheet (live)".
9. **No regressions:** reconciliation chip, partial-quarter hatching, low-season bands, commentary
   cards all still work.
10. **Performance:** initial load unchanged; charts dispose on navigation (no leaked instances).

---

## 9. Implementation plan (after approval)

- **Step 1 — plumbing:** `chartCard` + `boardTable` helpers + ECharts sizing fix (kills 3.1).
- **Step 2 — data layer:** the 5 shaper/compute fixes (§7).
- **Step 3 — views:** wrap existing charts in `chartCard` + range selectors; rebuild Working Capital
  table; rebuild Forward-Looking; add Strategic Dashboard; trim footer/About.
- **Step 4 — nav:** nowrap + scroll CSS (§5.3).
- **Step 5 — verify:** walk all 8 acceptance criteria against the live sheet.

Files touched: `js/views.js` (largest), `js/data.js`, `js/compute.js`, `js/app.js` (nav),
`assets/styles.css`, `index.html` (footer). No new dependencies.

---

## 10. Open decisions (recommendation shown; override if you disagree)

1. **Customer monthly chart** when `CustomerRevenueMonthly` is empty for a customer → show an inline
   "monthly detail not entered for this customer" note rather than an empty chart. **(Recommend:
   yes.)**
2. **Range presets** for quarterly charts → All / Last 4Q / Last 8Q. **(Recommend: yes.)**
3. **Strategic Dashboard placement** → dedicated view right after Overview. **(Recommend: yes;
   alternative = fold into Overview, rejected because Overview is already full.)**
4. **YTD definition** → calendar year of the latest data month. **(Recommend: yes.)**

---

## Appendix A — Actual sheet structure (verified 2026-06-20)

- **Assumptions:** header r0; customers r1–5 = Mana 70%, Auntie Aloha 65%, Fuzzies 68%, Tyson 70%,
  Private Label 55%.
- **MonthlyFinancials:** header r0; data r1+ (Month, Total Revenue, COGS, GP, SG&A, EBIT, Net
  Income), Jan-25 → May-26.
- **CustomerRevenueMonthly:** header r0; data r1+ are **Mana rows with empty Revenue**; other
  customers absent.
- **CustomerCount:** header r0; data r1+ (Month, Customer Count), May-24 → May-26.
- **Quarterly Financials:** title r0; header r1; data r2+ (Line, Q1'25…Q2'26).
- **1. Working Capital:** header r0; data r1+; row 7 = `<add month>` placeholder.
- **2. Customer Economics:** header r0; data r1–5 (all 5 customers, Q1 2026) + r6 Total Portfolio.
- **3. Strategic Dashboard:** header r0 (Strategic Metric, Q1'25, Q4'25, Q1'26, Q2'26 Through May);
  data r1+.
- **4. Forward-Looking Risk:** header r0 (Reporting Period, Revenue, COGS, GP, SG&A, Net Income,
  Risk Status); data r1 (Q2'25 Full, "Historical Actual"), r2 (Q2'26 Apr&May,
  "Incomplete — High June…").
- **Commentary:** header r0; data r1+ (View, Commentary, Status, Started, Error, Attempts, Thinking
  Info) — already correct.
