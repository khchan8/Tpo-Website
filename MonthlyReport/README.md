# TPO monthly report — manual AI workflow, v5

The Apps Script, calculated Google Sheets cells, and website use the same calculation engine. By default, the reporting period follows the latest month with valid actual revenue in MonthlyFinancials; Report settings can apply a historical cut-off. Blank future rows such as Aug-27 and Sep-27 are allowed and ignored; an explicit zero is actual data. An expense-only future row remains pending until revenue is entered.

## Monthly workflow

1. Run **Prepare Next Month Slots (Fill in the blanks)**. It reuses or creates the next calendar month's rows, supplies blank-safe GP/EBIT/NWC formulas, and adds missing quarter sections. Fill the raw source figures. Repeated runs preserve entered values and reuse existing slots.
2. **📊 TPO → Format & verify all sheets**. This protects reporting month labels as explicit text, normalizes unambiguous numeric text, and applies amount/percentage formats, and writes **Data Validation**. It preserves blank inputs and formulas. Previous converted values are recorded in **Repair Backup**.
3. Resolve errors. **Repair calculated sheets** installs or restores dynamic quarter totals, customer contribution/concentration, working capital, dashboard, matching-period comparisons, and as-of formulas. Month setup also performs this repair. Once installed, changing source figures recalculates these cells automatically. Run month setup to create new sections; no formula dragging is needed.
4. **1. Prepare LLM Input + Copy… → Copy all**. Paste into Gemini, ChatGPT, DeepSeek, or another AI chat. The prompt requests the report sections and customers selected in shared Report settings, with calculated summaries, normalized supporting tables, quality notes, and a JSON response template.
5. Copy the AI response. Use **Paste AI response…** to save it to **LLM Output**, or paste into that sheet starting at **A8**.
6. **3. Import LLM Output** writes matching entries into **Commentary A:C**. Reload the website.

The prose style remains 2–4 English sentences, 50–90 words per section. No LLM API key is needed. The script does not send data to an AI provider; you choose where to paste it.

## Installation

Replace the complete bound Apps Script with **Code.gs** (project delivery: **apps-script/Code.gs**). Do not append it or install multiple versions together. Save and reload Google Sheets, then run **Repair calculated sheets** once. Google may require authorization or identity verification on the first run. All dialogs are embedded in the file. Copying this file into GitHub does not update the bound Google script; installation in Sheets is separate. See **SETUP.md** for the complete setup workflow.

Commentary uses **View | Commentary | Status** in A:C. It does not recreate the deleted D:G columns. The generated **LLM-Input** and **LLM Output** sheets use rows 1–7 for metadata and A8 onward for text. Use the copy dialog to concatenate prompt chunks; copying a spreadsheet range can introduce tabs/newlines.

## Data contracts

| Sheet | Expected columns in the original layout |
|---|---|
| MonthlyFinancials | Month, Total Revenue, COGS, Gross Profit, SG&A, EBIT, Net Income, Quarter |
| Quarterly Financials | Quarter, Total Revenue, COGS, Gross Profit, SG&A, EBIT, Net Income |
| CustomerRevenueMonthly | Customer, Month, Revenue |
| CustomerRevenueQuarterly | Customer, Quarter, Revenue |
| CustomerCount | Month, Customer Count |
| 1. Working Capital | Reporting Month, Cash Balance, Accounts Receivable, Inventory Value, Accounts Payable, Net Working Capital |
| 2. Customer Economics | Customer Brand, Quarter, Gross Revenue, Revenue Concentration, Estimated Contribution (legacy Gross Profit accepted), Contribution Margin |
| 3. Strategic Dashboard | Strategic Metric, then quarter columns |
| 4. Forward-Looking Risk | Reporting Period, Revenue, COGS, Gross Profit, SG&A, EBIT, Net Income, Risk Status |
| Dashboard Inputs | Quarter, Metric, Value — manual new-account counts, retention, inventory turns, and custom metrics |
| Report Model | Generated key/value spill; do not type into this sheet |
| Assumptions | Customer and contribution margin in A:B; parameters in D:E |

The tabular readers find columns by header. Missing required headers exclude that table and identify the problem. Month inputs include real dates, Sheets date serials, Jul-26, July-26, 27-Jul-26, and ISO dates. Ambiguous numeric text dates such as 07/08/26 are rejected. Numeric text accepts correctly grouped commas, the baht symbol, negative parentheses, and percentage notation for percentage fields.

Duplicate populated period/customer keys are excluded rather than summed. Scaffolding also rejects duplicate empty slots. Error-level findings block AI input preparation; repairs can replace broken derived formulas but stop on invalid primary inputs. Missing or malformed numbers remain unavailable. Monetary checks allow small whole-baht rounding differences. Blank or invalid GP/EBIT values do not silently become zero in quarterly or YTD totals.

- Quarter totals derive from unique monthly rows. Partial quarters compare only with the same available months one year earlier. Three rows indicate coverage, not proof that individual months are finalized.
- Working capital requires all four components: cash + AR + inventory − AP. Enter zero when a component is actually zero. An existing formula that treats blanks as zero is not accepted as a validated NWC result.
- Customer mix shares refer to the listed customer total. Company-wide concentration requires reconciliation with the P&L; otherwise it is unavailable. Customer contribution is revenue × assumed margin, not audited gross profit.
- Active customers follow the first month of a quarter. Cash uses quarter-end working-capital data. EBITDA is explicitly labelled an EBIT proxy because D&A is unavailable.
- Low season follows Assumptions. The current workbook specifies May–October.

**Report Model** contains one range-fed `TPO_REPORT_MODEL` custom function using the same `TPOCore` as the website. Derived sheet cells use keyed `INDEX/MATCH` lookups into that model, preserving real zeros and missing values. The function receives only primary inputs; derived outputs never feed back into it. Google recalculates when the referenced input ranges change. Month setup expands capacity as needed. If you manually add rows outside the generated range, rerun Repair calculated sheets. Allow Sheets to finish calculating before validation or AI export; a model error stays visible rather than displaying old totals.

Existing manually maintained dashboard values migrate once into **Dashboard Inputs**. Edit them there afterward. Customer Economics revenue comes from **CustomerRevenueQuarterly**, with each portfolio total scoped to an explicit quarter. Source numbers and replaced formulas are recorded in **Repair Backup** before changes. Formula errors identify the source sheet/cell; failed writes attempt rollback.

Forward risk is deterministic: negative current matched EBIT is **Operating Loss / High Risk**; positive improvement is **Improving / On Track**; a decline is **Contracting / Moderate Risk**; equal EBIT is **Stable / Monitor**. Missing EBIT or baseline is explicitly unavailable. Coverage is a separate column; missing prior-year months never become zero. This is historical comparison, not a forecast or AI classification.

The supplied workbook's Q1 2026 customer revenue exceeds P&L revenue by **฿153,034** (฿11,355,290 − ฿11,202,256). It remains a reconciliation warning; timing differences are a possible explanation, not established by the data.

Supporting tables in the AI prompt are normalized and filtered; they are not a raw cell dump. Rows are labelled `normalized_row`. Error/warning notes identify original sheet cells. Unsafe derived figures and ambiguous duplicate rows are not supplied as authoritative inputs. Validate facts in the resulting prose before using them; the importer validates structure and routing, not the AI's reasoning.

## Timezone and diagnostics

This workbook has returned `""` from `getSpreadsheetTimeZone()` even after saving Bangkok in Settings. **v3.2 uses the explicit `TPO.timezone = 'Asia/Bangkok'` fallback** when that happens. Format & verify also tries `setSpreadsheetTimeZone('Asia/Bangkok')`. Data Validation records the reported and effective zones, including when fallback remains necessary. It never uses the computer's or script project's default timezone implicitly.

**Run diagnostics…** checks timezone and source data. **Show last error…** reopens the latest per-user error, including build, action, function stack, sheet/cell context where available, actual timezone value/type, and error reference. Errors are also logged in Apps Script Executions.

## Import protections

Responses must contain the current batch ID, schema version, and each expected View exactly once. Invalid/incomplete JSON, unknown identifiers, formulas in pasted cells, and source changes after preparation are rejected before commentary writes. JSON inside one enclosing code fence is accepted. Long text is split safely into 30,000-character cells.

Imports preserve unrelated Commentary rows and try to restore original values on a write failure. Repeating an unchanged import is a no-op. A document lock serializes script actions but does not prevent manual edits by other collaborators.

The website marks commentary from an older workflow or different data snapshot as requiring regeneration and keeps it under a collapsed “Previous commentary” section. Newly imported commentary carries a period and a data checksum in Status. This checksum detects accidental data changes; it is not a security signature.

## Website controls & page visibility

The **Setup & data health** (`#/setup`) view includes interactive **Report controls** that govern report presentation, tab visibility, and export behavior:

### 1. Page & Customer Visibility (Hide / Show / Auto)
- **Report tabs & Customer pages tables**: Each section (Overview, Dashboard, Seasonality, Customers, Financials, Working Capital, Forward-looking, Glossary) and each individual customer brand can be customized:
  - **Show**: Always displays the section in the top navigation bar.
  - **Hide**: Hides the section from the navigation bar and report exports. *Note: Hiding a customer or tab never excludes its revenue from company-wide P&L totals or calculations.*
  - **Auto**: Displays the section only when usable data exists (including actual zeroes).
  - **Label & Order**: Customize the display name or reorder navigation tabs.
  - **AI input & Export**: Select requested commentary sections or visible sections for print/CSV exports. AI selection uses shared settings; supporting source tables remain included for context.

### 2. General Controls
- **Reporting cut-off**: Locks the report to a specific historical month (or defaults to the latest actual month).
- **Opening tab**: Configures which tab loads when first opening the site.
- **Chart ranges & Amount display**: Default to 6m/12m/YTD/All periods, and Full amounts / Thousands / Millions.
- **Decimal places & Table spacing**: Control number precision and compact/comfortable table densities.

### 3. Personal Preferences vs. Shared Defaults
- **Personal configuration (browser only)**: Clicking **Apply in this browser** saves your settings to browser `localStorage`. Preferences persist across browser sessions and override shared defaults without affecting other users. Click **Reset to shared defaults** to restore the default state.
- **Shared report defaults (for everyone / the board)**:
  1. Customize the controls on the website, then click **Prepare shared settings**.
  2. Copy the generated JSON configuration text.
  3. In Google Sheets, open **📊 TPO → Report settings…**.
  4. Paste the JSON into the box and click **Save pasted configuration** (or adjust controls in the dialog and click **Save shared controls**).
  5. The settings are saved into the `Report Settings` sheet tab in Google Sheets. Visitors without personal overrides receive these shared defaults when they reload data.

### 4. Presets & Archiving
- **Built-in presets**:
  - `@board` (Board meeting): Automatically hides Seasonality and Glossary, sets range to 12 months, and switches currency format to millions.
  - `@full` (Full management report): Shows all tabs and customer pages.
- **Custom presets**: Enter a preset name and click **Save preset** to save reusable configurations in your browser. The dropdown updates immediately and selects the saved preset. Reusing a name replaces that preset; other presets are preserved.
- **Export & archive**:
  - **Print selected report**: Clean, print-formatted view omitting hidden sections.
  - **Download selected report data (CSV)**: Export visible data tables to CSV.
  - **Save report snapshot**: Exports all loaded source data, including hidden customers, plus commentary, settings and capture time. Import uses captured data without refreshing Sheets and verifies its calculation version and fingerprint. Loading the website and external assets may still require a connection; this is not a fully offline application. A historical cut-off recalculates current data rather than restoring previous source revisions.

### 5. Data & Commentary Health
- **Data readiness**: Filter validation issues by severity (`actionable`, `error`, `warning`, `info`, `all`) or search by period (e.g. `Jul-26`). Click cell links to jump straight to source cells in Google Sheets.
- **Commentary readiness**: Verifies whether commentary in each section is current against the latest data fingerprint or requires regeneration.

**Setup & data health** remains reachable even if data is blank or the connection fails. Incomplete totals render as dashes. Dates and currency formatting do not control parsing. Scripts load with `defer`; `index.html` uses compiled **assets/utilities.css**.

## Maintenance and tests

Source files are **js/report-core.js**, **tools/apps-script/workflow.gs**, and **tools/apps-script/validation.gs**. Run `node tools/build-apps-script.cjs` to regenerate apps-script/Code.gs. Do not edit generated copies separately.

Run `node --test tests/*.test.cjs`. Tests cover dates/timezones, placeholders/zeroes, header mapping, malformed/duplicate inputs, null propagation, matched-period comparisons, long Unicode prompts, JSON import routing, stale batches, rollback, diagnostics, and shared website/script behavior.

Static CSS rebuild command:

```text
npx --yes --package=tailwindcss@3.4.17 tailwindcss --config tools/tailwind.config.cjs --input tools/tailwind-input.css --output assets/utilities.css --minify
```

Google references: [date formatting](https://developers.google.com/apps-script/reference/utilities/utilities#formatdatedate,-timezone,-format), [spreadsheet timezone](https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet#setSpreadsheetTimeZone(String)), [unformatted Sheets values](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get).

Reporting-month safety: Sheets can interpret a label such as Jan-25 as January 25 of the current year when changing date formats. Version 3.2 writes the verified month-year label with plain-text format before other formatting or timezone repair. Conflicting month/quarter pairs are excluded and block AI export.
