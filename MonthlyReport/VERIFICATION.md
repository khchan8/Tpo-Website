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
