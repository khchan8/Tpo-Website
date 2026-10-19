# TPO v4 verification — 7 September 2026

The bound Google Sheet was updated and exported again for verification. The website changes are in the MonthlyReport working directory; they have not been published.

## Confirmed live

- Effective and reported timezone: Asia/Bangkok.
- Latest actual revenue period: Jul-26. Aug-26 input slots exist across the monthly input tables and remain blank.
- Repeating month setup completed successfully and created no duplicate rows.
- All 284 Report Model entries match the shared calculation engine, allowing insignificant floating-point serialization differences.
- Existing financial, customer-revenue, and customer-count inputs were preserved.
- Assumptions E12: 11,202,256. E13: 153,034.
- Q1 2026 customer concentrations are positive; the portfolio total is approximately 101.3661% of P&L revenue. The excess remains a reconciliation warning.
- Mana Q2 2026 remains 2,691,940.
- Working capital totals remain blank wherever inventory or AP is missing.
- Dashboard quarter columns run chronologically through Q3 2026. Quarter-end cash and first-month customer counts agree with their source periods.
- Forward-Looking Risk compares July 2025 with July 2026. Current EBIT is -576,531 and the deterministic status is Operating Loss / High Risk.
- Fresh LLM input contains 11 sections and 70,556 characters. The copied text matches the sheet payload exactly.

## Code and website checks

- 40 automated tests pass, including month/year rollovers, repeated setup, blank versus zero, dates and Bangkok timezone, malformed/duplicate inputs, missing working capital, matched-month risk, formula dependencies, stale AI batches, import routing, and rollback.
- The website and Apps Script use the same core source; the project build reproduces the installed bundle.
- The local website preview displayed current dashboard and risk figures. Visual inspection identified clipped navigation at intermediate widths; the navigation now collapses before that happens.

## Remaining source-data work

There are no current error-level source findings. Missing customer-ledger coverage, revenue reconciliation differences, and missing working-capital components still generate warnings. No cause has been established for the 153,034 Q1 reconciliation gap.

The importer has been tested with local fixtures. No fabricated AI response was imported into the live Commentary sheet. The user can now copy the prepared input into their chosen AI chat and paste the response into LLM Output before importing it.

## TPO v9 verification — 19 October 2026

### 1. Automated test suites
- **Python extractor suite**: 33 tests pass (`tests/test_monthly_input_extract.py`) using isolated virtualenv with pinned `openpyxl==3.1.5`. Covers layout anchors, year/month titles, actual vs. future classification, salary sentinels (genuine zero vs. non-formula blank), formula cache presence/errors/shared-formula followers, AP blank-detail versus missing totals, borrowing exclusions, HALF_UP rounding, and review workbook text metadata.
- **Node workflow suite**: All automated tests pass (`tests/*.test.cjs`), covering pure planning, difference arithmetic, baseline differences (+, −, zero, blank, sub-display percentages), reordered headers, blank slot filling, contiguous appends, historical defaults, recognized formula preservation (canonical and legacy direct arithmetic), literal conversion, conflict detection (raw formula, custom formula, disagreeing quarter, duplicate headers), rollback in each destination with lock release, fresh preview zero writes, and stale preview rejection.

### 2. Real-source accounting smoke
- **Source workbook**: `TPO FS Program (updated 2026-10-14).xlsm`.
- **Source immutability**: SHA-256 byte-identical before and after extraction: `bf5d85158707dc6caab03d851b5cef32a1c08bcf880d1add9494d1e0c1ff1810`.
- **Extracted range**: Exactly 21 actual months (`2025-01` through `2025-12` and `2026-01` through `2026-09`). Later sentinels are blank; no phantom months extracted.
- **September 2026 amounts**:
  - Revenue: 206,463,271 satang (2,064,632.71 THB)
  - COGS: 64,305,055 satang (643,050.55 THB)
  - SG&A: 197,684,895 satang (1,976,848.95 THB)
  - Net Income: -55,810,443 satang (-558,104.43 THB)
  - Cash: 315,912,443 satang (3,159,124.43 THB)
  - AR: 268,004,997 satang (2,680,049.97 THB)
  - Inventory: 337,391,323 satang (3,373,913.23 THB)
  - AP: 1,369,019,294 satang (13,690,192.94 THB)
  - Computed GP: 142,158,216 satang (1,421,582.16 THB)
  - Computed EBIT: -55,526,679 satang (-555,266.79 THB)
  - Computed NWC: -447,710,531 satang (-4,477,105.31 THB)
- **Reconciliation**: All 21 month pairs pass raw Decimal and satang identity checks for GP, EBIT, and AP-minus-borrowings within 0.01 THB before single rounding.

### 3. Historical baseline snapshot smoke
Verified against the captured live audit snapshot (`sheets-cleanup-live-audit.json`, `capturedAt: 2026-10-07T13:10:34.008Z`):
- **August 2026 Net Income**: 162,690.00 THB → -44,187.89 THB; delta: -206,877.89 THB (-127.1608%).
- **August 2026 Cash Balance**: 3,340,966.00 THB → 3,341,588.53 THB; delta: +622.53 THB (+0.0186%).

### 4. Interactive dialog and browser acceptance
- **Managed Chromium harness**: Tested with native file upload against actual `menuImportMonthlyActuals()` HTML and real VM RPC handlers.
- **Default selections**: August 2026 unchecked (`defaultSelected: false`), September 2026 checked (`defaultSelected: true`).
- **September apply**: 12 backed-up writes across MonthlyFinancials and 1. Working Capital, installing canonical blank-safe formulas. Repair Backup recorded previous states; unrelated inputs, Commentary, and manifest remained untouched.
- **Re-preview zero-write state**: September marked unchanged, zero writes performed.
- **August apply**: Corrected raw cash, payables, and net income, refreshing derived formulas with disclosed reasons.
- **Stale rejection**: Mutations between preview and apply rejected pre-mutation with `Monthly inputs changed after preview. Preview again; nothing was imported.`; zero source writes were executed and no rollback was needed or performed.

### 5. Operational limits and verification scope
- **Not a concurrent human-edit transaction**: `backupAndWrite_` serializes script actions under document lock and restores cells on script failure, reporting incomplete restores if rollback encounters errors. It does not prevent concurrent manual human cell editing in Google Sheets during an apply transaction; operators must not edit `MonthlyFinancials` or `1. Working Capital` while applying.
- **Recalculation prerequisite**: Stored formula caches in the source workbook do not prove freshness; recalculate and save the workbook in Excel prior to running the extractor.
- **Explicit live Google Sheets formula recalculation not observed**: Automated tests verified the local VM runtime, Node test runner (115 tests passing), and managed Chromium DOM interactions. Live Google Sheets formula recalculation and the authenticated menu surface require owner-run execution in the live workbook.
- **Owner-run live installation**: Code delivery is the complete regenerated `apps-script/Code.gs`. The bound script must be replaced in full by the sheet owner, followed by saving, reloading Sheets, opening **📊 TPO → 1. Enter monthly data → Import accounting actuals…**, uploading the JSON pack, reviewing differences, selecting approved months, applying, inspecting **Repair Backup**, and running **📊 TPO → 2. Check & calculate** to verify sheet recalculation, review Data Validation, and prepare a fresh AI prompt.
