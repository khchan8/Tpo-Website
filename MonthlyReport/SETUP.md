# TPO Wellness — Monthly Performance Website

A static SPA that reads your Google Sheet live and renders the monthly board briefing.
Push **once** to GitHub Pages; thereafter you only edit the sheet and (optionally) regenerate
the prose commentary with Gemini.

---

## 1. What you need before publishing

| # | Item | Where it lives |
|---|---|---|
| 1 | Google Sheet (imported from `pipeline/inputs/TPO_Monthly_Input.xlsx`) | Your Google Drive |
| 2 | Read-only Sheets API key (referrer-restricted) | Google Cloud Console |
| 3 | Gemini API key (commentary) | Google AI Studio |
| 4 | Apps Script project bound to the sheet | Extensions → Apps Script |
| 5 | This folder published to GitHub Pages | `https://khchan8.github.io/Tpo-Website/MonthlyReport/` |

---

## 2. One-time setup

### Step 1 — Create the Google Sheet
1. Open Google Sheets → **Blank spreadsheet**.
2. **File → Import → Upload** `pipeline/inputs/TPO_Monthly_Input.xlsx` → **Replace spreadsheet**.
3. Confirm 12 tabs are present:
   `README`, `Assumptions`, `MonthlyFinancials`, `CustomerRevenueMonthly`,
   `CustomerRevenueQuarterly`, `CustomerCount`, `Quarterly Financials`,
   `1. Working Capital`, `2. Customer Economics`, `3. Strategic Dashboard`,
   `4. Forward-Looking Risk`, `Commentary`.
   (`CustomerRevenueQuarterly` = `Customer | Quarter | Revenue`, one row per customer per
   quarter — drives each customer's Quarter-to-Quarter chart.)
4. (Optional, security switch) Share → **Anyone with the link → Viewer** when the board
   should see the site. Unshare to hide. This is the on/off switch for the data.

### Step 2 — Create the Sheets API key
1. Google Cloud Console → **APIs & Services → Library** → enable **Google Sheets API**.
2. **APIs & Services → Credentials → Create credentials → API key**.
3. **Edit the key**:
   - **Application restrictions → HTTP referrers (websites)** → add:
     `https://khchan8.github.io/Tpo-Website/MonthlyReport/*`
   - **API restrictions → Restrict key → Google Sheets API**.
4. Copy the key.

### Step 3 — Fill the site config
1. In this folder, open `config.js`.
2. Replace the two placeholders:
   ```js
   SHEET_ID: "PASTE_THE_LONG_ID_FROM_THE_SHEET_URL",
   API_KEY:  "PASTE_THE_READONLY_KEY"
   ```
   The Sheet ID is the long string between `/d/` and `/edit` in the sheet's URL.

### Step 4 — Install the Apps Script (commentary)
1. In the sheet: **Extensions → Apps Script**.
2. Delete the placeholder `Code.gs` content.
3. Open `apps-script/Code.gs` from this repo, copy the whole file, paste it in.
4. **Project Settings → Script properties → Add script property**:
   - Property: `GEMINI_API_KEY`
   - Value: your Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).
5. Save. Reload the sheet. The menu **📊 TPO → Generate Commentary** appears.
6. Click it once to test (writes a few rows into the `Commentary` tab).

### Step 5 — Publish
From your repo root (`Tpo-Website/`):
```bash
git add .
git commit -m "TPO Monthly Report v1"
git push
```
Wait ~30 seconds. Visit `https://khchan8.github.io/Tpo-Website/MonthlyReport/`.

---

## 3. Monthly workflow

1. Open the Google Sheet and update the **raw** data tabs (`Assumptions`,
   `MonthlyFinancials`, `CustomerRevenueMonthly`, `CustomerCount`,
   `1. Working Capital`).
2. The board-table tabs (`Quarterly Financials`, `2. Customer Economics`,
   `3. Strategic Dashboard`, `4. Forward-Looking Risk`) recompute automatically
   because they use Sheets formulas.
3. **📊 TPO → Generate Commentary** (Gemini writes the prose).
4. Share the sheet **Anyone with the link → Viewer** when the board should see it.
5. Reload the site URL. Done — no git push, no publish.

---

## 4. File map

```
MonthlyReport/
├── index.html              ← SPA entry (Tailwind + ECharts CDN)
├── config.js               ← SHEET_ID + API_KEY (edit once)
├── assets/
│   ├── styles.css          ← Executive Briefing design accents
│   └── utilities.css       ← Compiled utility styles
├── js/
│   ├── report-core.js      ← Core calculation engine & settings normalizer
│   ├── data.js             ← Sheets API batchGet + shaper
│   ├── compute.js          ← deterministic math (no LLM)
│   ├── settings.js         ← Report controls (hide/unhide tabs, presets, export)
│   ├── views.js            ← every view's render function
│   └── app.js              ← router, controller + boot
├── apps-script/
│   └── Code.gs             ← paste into Extensions → Apps Script
└── SETUP.md                ← this file
```

---

## 5. Adding a customer (no code change)

1. `Assumptions` tab → add a row with the customer name + contribution margin.
2. `CustomerRevenueMonthly` → add rows `Customer | Month | Revenue`.
3. Reload the site. The new customer's view appears automatically under
   **Customers** in the nav.

---

## 6. Security model

- The **sheet sharing toggle** is the on/off switch:
  - Sheet **unshared** → the site loads with a graceful "Report not available"
    message (no broken error, no leaked numbers).
  - Sheet **"Anyone with link → Viewer"** → the site renders.
- The Sheets API key is **read-only**, **Sheets-API-only**, and **referrer-restricted**
  to your Pages URL — harmless if seen.
- Treat the **site URL** as the secret you share with the board.

---

## 7. What the site computes (vs what it shows verbatim)

| Thing | Source |
|---|---|
| Monthly financials (revenue, GP, EBIT, …) | `MonthlyFinancials` (KH-entered raw) |
| Quarterly P&L | `Quarterly Financials` (Sheets formulas → site shows) |
| Working capital components | `1. Working Capital` (Sheets formulas → site shows) |
| Customer Economics | `2. Customer Economics` (Sheets formulas → site shows) |
| Strategic Dashboard | `3. Strategic Dashboard` (Sheets formulas → site shows) |
| Forward-looking risks | `4. Forward-Looking Risk` (KH-entered) |
| Quarter roll-ups, NWC, margins, concentration, seasonality flags, Q2 partial flag, reconciliation | **Site (JS)** — deterministic |
| Commentary prose | Gemini via Apps Script → `Commentary` tab |
| Charts | ECharts, fed by computed values |