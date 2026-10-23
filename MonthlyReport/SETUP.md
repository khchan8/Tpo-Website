# TPO Monthly Report — setup and monthly workflow

The website reads Google Sheets and calculates validated report figures. Apps Script prepares a prompt for your chosen AI chat and imports its response into Commentary. No Gemini, OpenAI, or other LLM API key is required.

## Install or update the Google Sheets script

Use the existing reporting workbook; updating the script does not require importing or replacing the workbook.

1. In Google Sheets, open **Extensions → Apps Script**.
2. Replace the complete contents of the existing report script with the repository's **apps-script/Code.gs**. Do not append another copy or keep duplicate report functions in other script files.
3. Save and reload Google Sheets. Authorize the script when Google requests it.
4. Run **📊 TPO → 2. Check & calculate**. This sets up the workflow sheets, normalizes numeric text, repairs calculated sheets, performs obsolete-content cleanup, and writes **Data Validation**. Resolve reported errors.
5. Open **📊 TPO → Tools & settings → Report settings…** to create or edit the shared **Report Settings** configuration. Saving settings also refreshes derived formulas.

The script maintains **LLM-Input**, **LLM Output**, and **Commentary**. Commentary uses **View | Commentary | Status** in A:C; the removed D:G columns are not needed. Input/output rows 1–7 contain metadata; prompt and response text start at A8.

Copying Code.gs into GitHub does not install it in Google Sheets. The website and the bound Apps Script are updated separately.

### v12: code audit cleanup (`2026-10-23-v12`)

Install build **`2026-10-23-v12`** (replace the complete contents of `apps-script/Code.gs` into the bound Google script, save, and reload Sheets). No workflow changes; this build is an internal cleanup:

- **Importer consolidation**: the accounting and sales importers now share one module (`tools/apps-script/import-common.gs`) for satang math, destination-tab reading, preview hashing, selection validation, plan finalization, the preview/apply RPC envelope (including the immediate pre-mutation recheck) and the parameterized preview/apply dialog. The two original modules totaled 1,391 lines; together with the new shared module they now total 1,158 lines, a net reduction of 233 lines. Pack contracts, formula protection, preview checks and backup/rollback behavior are retained.
- **Removed dead legacy cleanup branches** that could no longer trigger after the v8 migration: the Assumptions `D10:E13` reconciliation-block clearer, the pre-Sheets Python-pipeline README replacement, `cordon`/`data note (warn)`/`turnaround storyline` glossary renames, the empty `Old Commentary` column-D header clearer, the legacy Customer Economics total-row quarter shim, and the always-false `sourcesCleared` reporting. The live managed README/Glossary refresh and custom-content protection are unchanged and still tested.
- **I/O fixes**: *3. Prepare AI prompt + copy…* no longer writes Data Validation twice; the paste-import path no longer re-reads all source sheets a second time for the same staleness check (the pre-mutation recheck remains); the Report settings dialog reads only `Assumptions!A:B` for its customer list instead of every source sheet.
- **Repository cleanup**: removed `apps-script/Code.gs.old` (pre-v4 Gemini-API backup), the executed `MONTHLY_ACTUALS_IMPORT_PLAN.md`, superseded `PRDv1.4/1.5.md` and the stale `VERIFICATION.md`.

### v11: numbered input submenu and month-aware slot preparation (`2026-10-23-v11`)

Install build **`2026-10-23-v11`** (replace the complete contents of `apps-script/Code.gs` into the bound Google script, save, and reload Sheets).

**1. Enter monthly data** items are now numbered in workflow order: **1. Input checklist…, 2. Prepare next month slots, 3. Import accounting actuals…, 4. Import sales data…, 5. Add customer…**. Slot preparation now runs before the imports.

**2. Prepare next month slots** is now per-tab month-aware instead of following `MonthlyFinancials` alone:

- Each input tab (`MonthlyFinancials`, `1. Working Capital`, `CustomerRevenueMonthly`, `CustomerCount`) advances only on rows that actually contain data; a stray blank future row never drags a tab forward.
- When tabs disagree — for example accounting actuals imported through Sep-26 while the customer tabs still end Aug-26 — the run aligns the lagging tabs through the furthest actual month and writes nothing else. It no longer opens a month beyond the leader.
- When every tab is level, the run opens the following month for all tabs, as before.
- The completion toast names exactly what was created, e.g. `Prepared new input slots: CustomerRevenueMonthly Sep-26; CustomerCount Sep-26.` — or says nothing was needed.

*Recovering from the earlier v10 run:* delete the premature Oct-26 rows in the input tabs (label-only rows in `MonthlyFinancials` / `1. Working Capital` are harmless but can be deleted too), then run **2. Prepare next month slots**; it creates the missing Sep-26 rows in the customer tabs. Blank-safe formulas and quarter sections are repaired in the same pass.

### v10: sales data import (`2026-10-23-v10`)

Install build **`2026-10-23-v10`** (replace the complete contents of `apps-script/Code.gs` into the bound Google script, save, and reload Sheets). The new menu entry is **📊 TPO → 1. Enter monthly data → Import sales data…**.

#### 1. Extract the sales pack
Run **`tools/extract-sales-input.py`** (same pinned virtualenv and drag-and-drop shortcut as the accounting extractor) against the sales presentation workbook, e.g. `TPO Sep 2026 Sales Data for Presentation.xlsx`. It validates the per-customer tabs (`Mana`, `Auntie Aloha`, `Fuzzies`, `Tyson`, `Private Label`), `Overall Sales` and `Customer Count` read-only: one identical contiguous month grid on every tab, quarter rollups matching their months, and every month's five-customer total matching `Overall Sales`. It writes `<workbook>.json` (the `tpo-sales-actuals-v1` import pack) and a three-sheet review copy beside the source.

Months whose five-customer total disagrees with `Overall Sales` stay in the pack flagged `reconciled: false`; the importer blocks exactly those months (in the current Sep-2026 workbook that is only `2024-07`, where Tyson's monthly column omits its July sales). Fix the presentation tabs and re-extract to unblock.

#### 2. Import into Google Sheets
Open **Import sales data…**, upload the JSON pack, and preview. The importer fills **CustomerRevenueMonthly** and **CustomerCount** — customers must already exist in **Assumptions** (`Mana Cannabis` resolves to `Mana`; unknown or ambiguous names stop the import — add them first via **Add customer…**). Selection, Select-all, blocked months (formulas, unreconciled totals), historical-correction counting, preview staleness and Repair-Backup rollback behave exactly like the accounting-actuals importer.

#### Operational notes
- The sales import never touches `MonthlyFinancials`, `1. Working Capital`, `Assumptions`, derived tabs or LLM state; run the accounting import separately for financials.
- Automated tests cover pack validation, preview/apply, appends, rollback and both dialogs (122 Node + 52 Python tests). Live Google Sheets execution still requires owner-run installation as in v9.

### v9: accounting actuals import (`2026-10-19-v9`)

Install build **`2026-10-19-v9`** (replace the complete contents of `apps-script/Code.gs` into the bound Google script, save, and reload Sheets).

Apps Script compatibility: exact satang arithmetic uses `BigInt(0)` rather than a BigInt literal. This avoids the editor's `Unexpected token ILLEGAL` save error without changing rounding or overflow checks.

#### 1. Extract accounting actuals pack
Use the pinned Python virtualenv (`openpyxl==3.1.5`) to extract the validated accounting export:
```sh
python3 -m venv /tmp/tpo-monthly-import-venv
/tmp/tpo-monthly-import-venv/bin/python -m pip install -r tools/requirements-monthly-input.txt
/tmp/tpo-monthly-import-venv/bin/python tools/extract-monthly-input.py \
  --source 'TPO FS Program (updated 2026-10-14).xlsm' \
  --output-prefix /tmp/tpo-monthly-input-pack
```
This writes:
- `<prefix>.json` — validated actuals pack containing integer-satang amounts and per-cell provenance (`sourceRefs`).
- `<prefix>.xlsx` — three-sheet human review copy (`MonthlyFinancials`, `1. Working Capital`, `Source Map`). Note: review copy only; do not paste over calculated columns.

*Prerequisite:* The source workbook must be recalculated and saved in Excel before extraction. Formula cache presence does not prove freshness.

*Drag-and-drop shortcut:* drop the accounting export onto `tools/extract-monthly-input.py`. Windows drag-and-drop passes the file as the first argument (the interpreter owning `.py` needs the pinned openpyxl; the console stays open so the result or error is readable). On Linux, create a `.desktop` launcher with `Exec=<python-with-openpyxl> /path/to/tools/extract-monthly-input.py %f` and `Terminal=true`. Without `--output-prefix`, `<workbook>.json` and `<workbook>.xlsx` are written beside the source with the workbook's own name (a `.xlsx` source gets `<name>.review.xlsx` so the source is never overwritten).

#### 2. Import into Google Sheets
1. In Google Sheets, open **📊 TPO → 1. Enter monthly data → Import accounting actuals…**.
2. Upload the JSON import pack (`/tmp/tpo-monthly-input-pack.json`).
3. Click **Preview differences**. Inspect summary counts, month checkboxes, old/new amounts, signed THB differences, percentage changes versus absolute previous values, and source cell provenance.
4. Select approved months individually, or click **Select all months** to check every available month (blocked months remain unselected). The latest source actual month is checked by default when it is at least the destination reporting month; historical revisions remain opt-in. **Unselected historical corrections** updates whenever the selection changes and includes blocked historical corrections until their conflicts are resolved.
5. Click **Apply selected months**. The script applies approved months in a single transactional write using `backupAndWrite_`, recording previous values and formulas in **Repair Backup**.
6. Run **📊 TPO → 2. Check & calculate**, review **Data Validation** warnings, and prepare a fresh AI prompt.

*Operational limits:*
- `backupAndWrite_` serializes script actions under document lock and provides backup-backed recovery, recording previous values/formulas in **Repair Backup** before writes; if restoration fails during error handling, it reports an incomplete restore with cell coordinates so the operator can restore from the backup. It is not a concurrent human-edit-safe Sheets transaction; do not edit `MonthlyFinancials` or `1. Working Capital` while applying.
- Automated tests verified local VM runtime, Node test runner, and managed Chromium DOM interactions; explicit live Google Sheets formula recalculation was not observed and requires owner-run execution in the live workbook.
- *Owner-run live installation:* Code delivery is `apps-script/Code.gs`. The bound script must be replaced in full by the sheet owner, followed by saving, reloading Sheets, opening **📊 TPO → 1. Enter monthly data → Import accounting actuals…**, uploading the JSON pack, reviewing differences, selecting approved months, applying, inspecting **Repair Backup**, and running **📊 TPO → 2. Check & calculate** to verify recalculation, review Data Validation, and prepare a fresh AI prompt.
### v8: guided monthly workflow and one-step response import

Install build **`2026-10-07-v8`** (replace the whole bound script, save, reload). Then run **TPO → 2. Check & calculate**, or **TPO → Tools & settings → Clean up obsolete information**. Cleanup clears the retired Assumptions D10:E13 reconciliation block (original formulas are recorded in **Repair Backup**), refreshes the README/Glossary guides, and removes the empty **Old Commentary** header in D1; custom content is preserved and reported. Prepare a **new** AI prompt afterwards if source helper cells were cleared. The menu is now ordered around the monthly flow: **1. Enter monthly data → 2. Check & calculate → 3. Prepare AI prompt + copy → 4. Paste AI response & update Commentary → 5. Review Commentary**, with the remaining tools under **Tools & settings**. Step 4 saves the JSON response in **LLM Output** and updates Commentary in one action.

### v7: calculate customer quarters from monthly revenue

Install build **`2026-10-07-v7`**, then run **TPO → Repair calculated sheets** even if you previously repaired v6. This backs up old quarterly totals, replaces `CustomerRevenueQuarterly` revenue cells with formulas, and rewrites the `Report Model` arguments so the quarterly output cannot feed back into itself. Wait for custom-function recalculation, then run **Format & verify all sheets** and regenerate commentary.

Enter customer revenue only in **CustomerRevenueMonthly**. Historical quarters require one valid amount for every calendar month; the current quarter sums quarter-start through the latest financial reporting month. A missing month leaves the quarter blank, not zero. Current August Q3 totals should be Mana **774,820**, Auntie Aloha **1,145,367**, Fuzzies **857,842**, Tyson **904,933**, and Private Label **546,010**.

Four historical totals need missing monthly figures before they can be calculated: Auntie Aloha **Apr-24**, Fuzzies **Jul-24**, Tyson **Jan/Feb-25**, and Private Label **Jan-25**. Confirm whether each amount was genuinely zero or enter the actual revenue; do not infer it from the old quarter totals.

Keep the red tabs for **Assumptions**, **Dashboard Inputs**, **MonthlyFinancials**, **CustomerRevenueMonthly**, **CustomerCount**, and **1. Working Capital**. Do not mark `CustomerRevenueQuarterly` as a routine manual-input tab. Dashboard Inputs column C is the actual `Value`; column D examples are ignored by the calculation. Repair restores **Cash Balance As Of** and **Inventory Period** on the Strategic Dashboard, not in Dashboard Inputs.

No XLSX import is needed. Keep the downloaded workbook as the pre-migration snapshot, update the existing bound script, and download a fresh copy after repairing the live sheet. Importing XLSX does not install Apps Script and exported spill caches may block recalculation.


## Website configuration and publication

Keep the existing **config.js** with its **SHEET_ID** and Sheets **API_KEY**. The static website requires a Sheets API key and a workbook readable through that API. The API key is for loading spreadsheet data, not generating AI commentary. Keep its API and website referrer restrictions configured in Google Cloud.

The publication folder is **Tpo-Website/MonthlyReport/**. It must include **js/settings.js**, the other JavaScript modules, and the styles referenced by **index.html**. Run these checks from MonthlyReport:

```text
node --test tests/*.test.cjs
```

If Apps Script source modules were changed, run `node tools/build-apps-script.cjs` before testing and installing the resulting bundle. Review the changes, commit the intended MonthlyReport files, and push through the existing GitHub Pages workflow. Check deployment completion in GitHub Actions, then reload the website; a hard refresh can clear older cached assets.

Sheet sharing and page visibility are different controls. Show/Hide does not restrict access to loaded data. A public workbook and its report URL should not be treated as confidential access controls. Changing sharing does not erase downloaded snapshots or data already loaded by a viewer.

## Password protection (Cloudflare Worker)

Visitors must enter credentials before the browser receives anything from `/MonthlyReport/` — including the page source and **config.js**. The gate is a Cloudflare Worker running in front of GitHub Pages; no website code changes, and removing it later only removes the prompt.

1. **Create the Worker**:
   - In Cloudflare sidebar: **Compute → Workers & Pages → Create an app** (or **Create**).
   - Under **Make something new**, click **Start with Hello World** (do *not* select "Connect GitHub", which creates a Pages project that lacks path routes).
   - Name it (for example `monthly-report-gate`) and click **Deploy**.
2. **Deploy the gate code**:
   - On the Worker overview, click **Edit code** (or **Quick edit**).
   - Replace the entire template code with **tools/cloudflare/password-gate.js** and click **Save and deploy**.
3. **Attach the Route**:
   - On the Worker page, open **Settings → Domains & Routes**.
   - Under **Routes**, click **Add → Route** (or **Add Route**).
   - Configure:
     - **Zone**: `tpowellness.com`
     - **Route**: `*tpowellness.com/MonthlyReport*`
     - **Failure mode**: `Fail closed (block)` (recommended for auth gates)
   - Click **Add Route**. *(Alternatively, configure from **Domains → tpowellness.com → Workers Routes → Add route**).*
4. **Configure credentials (Variables and Secrets)**:
   - Worker **Settings → Variables and Secrets → Add**:
     - `PASSWORD`: Custom password (overrides default `Tpo888`).
     - `USERNAME` *(optional)*: Specific username to require (e.g. `admin`). If left unset, any username is accepted.
5. **DNS prerequisite**:
   - In **Domains → tpowellness.com → DNS → Records**, ensure the record pointing to GitHub Pages has **Proxy status: Proxied (Orange Cloud ☁️)**. If set to DNS-only (Grey Cloud), traffic bypasses Cloudflare Workers.

Browsers cache and resend the HTTP Basic credentials automatically until the browser is closed. The gate protects the website URL, not the workbook: the Google Sheet remains readable through its public API key, as noted above. Hiding the financials themselves would additionally require restricting the sheet and changing how the site loads data.

## Monthly workflow

1. Run **📊 TPO → 1. Enter monthly data → Prepare next month slots**. This creates empty row slots for the new period across all input sheets. **Input checklist…** in the same submenu shows what to type and links to the input tabs.
2. Enter raw figures into the **manual input sheets** (leave unknown future slots blank; enter `0` only for a genuine zero):
   - **`MonthlyFinancials`**: Enter `Total Revenue`, `COGS`, `SG&A`, and `Net Income`. (`Gross Profit`, `EBIT`, and `Quarter` are calculated automatically).
   - **`CustomerRevenueMonthly`**: Enter monthly `Revenue` for each customer.
   - **`CustomerCount`**: Enter `Customer Count` for the month.
   - **`1. Working Capital`**: Enter `Cash Balance`, `Accounts Receivable`, `Inventory Value`, and `Accounts Payable`. (`Net Working Capital` calculates automatically).
   - **`Dashboard Inputs`** *(optional)*: Enter `New Accounts Opened`, `Customer Retention Rate`, and other non-calculated operational metrics as `Quarter | Metric | Value`. Enter retention as a percentage (e.g. `94%`) or fraction (`0.94`); leave unknown values blank. **Do not enter Inventory Turns**—it calculates automatically from COGS and inventory balances.

   > [!IMPORTANT]
   > **Do not type into derived sheets:** **`CustomerRevenueQuarterly`**, **`Quarterly Financials`**, **`2. Customer Economics`**, **`3. Strategic Dashboard`**, and **`4. Forward-Looking Risk`** are calculated automatically from the input sheets via `Report Model`. Manual edits to these sheets overwrite their formulas.

3. Run **📊 TPO → 2. Check & calculate**, review the **Data Validation** sheet, and resolve any reported errors; wait for recalculation to finish. Use **Tools & settings → Repair calculated sheets** if derived formulas ever need restoration.
4. Run **📊 TPO → 3. Prepare AI prompt + copy… → Copy all**. Paste the complete prompt into Gemini, ChatGPT, DeepSeek, or another AI chat.
5. Copy the AI's JSON response and run **📊 TPO → 4. Paste AI response & update Commentary…**. This validates the response against the prepared batch, saves it in **LLM Output**, and writes each entry to its matching Commentary row in one action (or paste the JSON into **LLM Output** at A8 and re-run step 4).
6. Run **📊 TPO → 5. Review Commentary** and check the prose for factual accuracy.
7. Use **Reload data** on the website's **Setup & data health** page.

Prepare a new prompt if source data, the shared reporting cut-off, or selected AI sections change. **Run diagnostics…** and **Show last error…** provide action, stack, timezone, and available source-cell context when troubleshooting.

## Report controls

Open **Setup & data health** (`#/setup`) to configure tab/customer Show, Hide, or Auto, labels, ordering, opening page, reporting cut-off, chart ranges, amount display, decimals, and table spacing. Hidden customers still contribute to company totals. Blank future periods do not advance the latest actual reporting month.

- **Apply in this browser** saves personal preferences across browser sessions. They override shared defaults until **Reset to shared defaults** is used.
- **Prepare shared settings** selects JSON for copying. In Google Sheets, open **Report settings…**, paste it, and click **Save pasted configuration**. Website visitors without personal overrides receive those defaults when they reload data.
- **AI input** selects the commentary sections requested in the next prompt. Normalized supporting tables remain included for context. Personal website preferences do not change the script's AI selection; save shared settings for that.
- **Export** selects visible sections for print/CSV. Hidden sections are excluded from those report exports.
- **Save preset** stores a named configuration and immediately selects it in the dropdown. Save again with the same name to replace it. **Apply preset** loads the selected configuration. Presets are stored in the current browser.

## Snapshots and exports

Print exports include tables, key figures, and briefings; they omit interactive charts. CSV contains numeric report data for selected visible sections.

**Save report snapshot** exports all loaded source data, including hidden customers, plus commentary, settings, capture time, and a calculation fingerprint. Importing the JSON validates the calculation version and fingerprint and uses the captured data without refreshing Google Sheets. Use **Return to live report** to resume live data.

A historical cut-off recalculates the currently loaded source data; it does not restore earlier source revisions. The snapshot fingerprint detects calculation differences, not authenticity. Snapshots are not a fully offline application: loading the website and external chart/font assets may still require a connection.

See **README.md** for data contracts, calculation rules, and import protections.
