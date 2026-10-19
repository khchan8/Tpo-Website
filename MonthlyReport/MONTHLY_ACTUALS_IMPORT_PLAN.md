# Monthly accounting actuals import

## Context
Build an actuals-only extractor and a preview/apply dialog for the existing TPO Monthly Report. Read `TPO FS Program (updated 2026-10-14).xlsm` without modifying it; deliver a narrow JSON import pack and a human-readable XLSX review copy, then write approved months into the existing `MonthlyFinancials` and `1. Working Capital` tabs. Cash must include BS rows 5–8; accounts payable must include all liability detail rows 48–66 except borrowing rows 53–54. Notify the user of every changed amount, including historical corrections, with old/new values, signed amount difference and percentage difference; never import the separate customer revenue/count, operational-input, or assumption sheets.

## Findings that constrain implementation
- `tools/apps-script/workflow.gs`: `onOpen()` has a stage-1 submenu; `dialog_(title,body,script,height)`, `serverAction_(name,action)`, `locked_(action)`, `digest_(text)`, `ensureSize_()`, `plainText_()` and `columnName_()` are existing integration points. Document-lock cleanup includes flush and release, preserving failure context.
- `tools/apps-script/validation.gs`: reuse `backupAndWrite_(plan,label)` with `{sheet,row,col,value,reason,formula,text}` entries. It snapshots values/formulas/formats and logs Repair Backup before source writes, restores attempted writes on failure, and reports incomplete rollback. Do not introduce a second source-write or rollback mechanism.
- `js/report-core.js`: `TPOCore.defs`, `month()`, `number()`, `col()` and `analyze()` provide the existing target contracts and arithmetic checks. `MonthlyFinancials` aliases support `Revenue` as well as `Total Revenue`; use the existing aliases, not a competing header convention.
- `repairPlan_()` currently installs GP/EBIT formulas only for the next-month slot. Historical rows can still contain literal GP/EBIT values; importing revised raw values without refreshing these calculations can break financial identities. Its repair/scaffold action also touches separate customer/operational inputs, so do not call repair or Check & calculate inside the importer transaction.
- `tools/build-apps-script.cjs` currently concatenates `js/report-core.js`, `tools/apps-script/workflow.gs` and `tools/apps-script/validation.gs` into `apps-script/Code.gs`. Edit source modules, never the generated bundle directly.
- Real Sheet objects require `getName()`, not `.name`; current tests deliberately throw on `.name`. Preserve this API-fidelity guard.
- Verified source profile: current-year PL R:AC and BS D:O; prior-year PL AG:AR and BS Q:AB. This file contains 12 actual months in 2025 plus January–September 2026. Its PL/BS month headers use a month/day display format, so the stored date year is not authoritative.
- Read-only Decimal checks across all 21 reported month pairs verified GP, EBIT and AP-minus-borrowings identities; maximum source residual was below 0.00000001 THB. Some AP detail cells are genuinely absent (for example BS!Q52 and BS!D52), not formulas with missing caches. The supported ledger's blank-detail treatment must be explicit below.
- `tests/manual-workflow.test.cjs` exports `{runtime,fixture,sampleResponse}` at line 528 and supplies Sheet/Range mocks plus `failOnce`, `flushFail()` and `failProps()`. Append importer tests in this existing file instead of importing its test-registered module into another test suite. The adapter does not calculate spreadsheet formulas: preserve this limit and supply explicit cached-value fixtures where needed.
- There is no existing Python dependency manifest or Python test convention in this workspace. openpyxl is absent in the current runtime; using its existing builder API plus an isolated pinned environment avoids implementing a second OpenXML workbook reader/writer.

## Approach
Dependency order: extraction and the pure Apps Script planner can be implemented independently against the fixed pack schema. Transactional apply depends on the planner; dialog/build integration depends on the apply contract. Do not delegate competing schemas or run builds/tests before these slices are integrated.

### 1. Extract a narrow actuals pack and review XLSX
Add `tools/extract-monthly-input.py`. There is no existing monthly-input extractor; `build_google_sheets_model.py` creates compensation/scenario workbooks, not an input pack. Reuse its dual-load approach (`openpyxl.load_workbook(..., data_only=False)` and `data_only=True`) without calling `convert_source_workbook()` or building compensation/forecast tabs. Leave the existing builder and all its flags unchanged.

Use the builder's existing dependency, openpyxl. Add `tools/requirements-monthly-input.txt` containing `openpyxl==3.1.5` so a fresh environment has an explicit dependency contract; no global installation or Google credentials are required. Public Python entry points are `extract_monthly_inputs(source: Path) -> dict`, `write_review_workbook(pack: dict, output: Path) -> None`, and `main(argv=None) -> int`.

CLI: `python3 tools/extract-monthly-input.py --source <xlsm-or-xlsx> --output-prefix <path-without-extension>`. Both flags are required. Produce `<prefix>.json` and `<prefix>.xlsx`; refuse to overwrite existing outputs or resolve either output to the source file. Validate the entire input before producing output, write via temporary paths, and exit nonzero with the exact source cell(s) on failure. Never recalculate formulas, run macros, save over the source, or treat the existing compensation-model output as authoritative actuals.

Support one strictly validated PL/BS layout, with the year derived dynamically rather than hardcoded to 2026:
1. Parse `PL!A2` and `BS!A2` with whitespace-tolerant, case-insensitive `Profit & (Loss) report : YTD <English month> <YYYY>` and `Balance Sheet : YTD <English month> <YYYY>` patterns; require matching month/year. A filename date is not evidence of an actual reporting period.
2. Current year: PL R:AC and BS D:O. Prior year: PL AG:AR and BS Q:AB. Require `PL!AD3 = YTD-<current YY>`, `PL!AS3 = YTD-<previous YY>`, `IncomeStatement!R6 = current YYYY`, `IncomeStatement!AS6 = previous YYYY`, `IncomeStatement!R7 = Jan-<current YY>` and `IncomeStatement!AS7 = Jan-<previous YY>`. Missing/disagreeing anchors stop extraction.
3. Verify all monthly header positions in PL/BS row 3 have January–December month components in order, using only the header's month component; derive year from the verified block. In this source, PL!AG3/BS!Q3 are stored as 2026-01-25 but display Jan-25, and PL!R3/BS!D3 are stored as 2026-01-26 but display Jan-26. Never use their stored year or infer a year from the day number.
4. Actual classification is the existing PL row-107 salary sentinel: a numeric value, including genuine zero, means reported; a non-formula blank means unreported. A formula without a numeric cached sentinel is an error, not an unreported month. Require contiguous actual months from January; reject a populated sentinel after a gap. The current-year actual run must end exactly at the title's reporting month, with later sentinels blank. The prior-year run must contain all 12 months; reject incomplete prior comparison data rather than inventing year coverage.
5. Before any fixed-row extraction, normalize account codes without changing numeric decimal identity and check PL column A anchors `{15:T-R002,63:T-C,65:T-N001,107:53011.09,170:T-E,172:T-N002,197:PL}` plus whitespace/case-normalized labels: Total Revenues (Sales), Total Cost of Goods Sold, Gross Profit, Salary - Management, Total Selling General and Administrative Expenses (ignore comma punctuation), Profit (Loss) before Other incomes and expenses, Net Income.
6. Check BS column A anchors `{5:11111,6:11112,7:11121.01,8:11122.01,9:11311,12:11511,13:11521,14:11541,48:21311,49:21399,50:21911.99,51:21919,52:21921,53:21941,54:21942,55:21951.01,56:21951.03,57:21951.99,58:21952.01,59:21953,60:27111,61:27113,62:27121,63:27123,64:27124,65:27125,66:27140}` and BS!B68 label Total Liabilities. Require borrowing labels at B53/B54 to contain borrowing, AR B9 to identify trade receivables, and inventory labels B12:B14 to identify Finished Goods / Raw Material / Product packing materials. A shifted/unsupported layout fails with the exact discrepant cell; do not scan for a vaguely similar subtotal and proceed.

The fixed accounting mapping is:

| JSON field | Source PL/BS row(s) | Destination |
|---|---|---|
| revenueCents | PL 15 | MonthlyFinancials / Total Revenue |
| cogsCents | PL 63 | MonthlyFinancials / COGS |
| sgaCents | PL 170 | MonthlyFinancials / SG&A |
| netIncomeCents | PL 197, not pretax 193 | MonthlyFinancials / Net Income |
| cashCents | sum BS 5–8 | 1. Working Capital / Cash Balance |
| arCents | BS 9 only | 1. Working Capital / Accounts Receivable |
| inventoryCents | sum BS 12–14 | 1. Working Capital / Inventory Value |
| apCents | sum BS 48–52 and 55–66 | 1. Working Capital / Accounts Payable |

Use integer satang in JSON to avoid cross-runtime floating-point comparison noise. Python uses `Decimal(str(value))` and ROUND_HALF_UP to cents; sum source amounts in Decimal then round the field total once. Preserve negative values. Formula errors, booleans, non-finite numbers and missing required totals/caches are errors, not zero. Resolve shared formulas through openpyxl's formula view and require their cached numeric values; do not evaluate VBA UDFs or freeze unrelated source cells.

Cash components, inventory components, AR, PL required fields/checks and BS liability subtotal/borrowing totals must be explicit numeric values or numeric formula caches. For AP detail rows only, a genuinely absent/non-formula blank is a zero contribution in this validated trial-balance layout. A present formula with no numeric cache is always an error. Reconcile the Decimal AP detail sum to BS row 68 minus rows 53 and 54 within one satang for every month; this both verifies the exclusion and detects a missing detail amount hidden by the total. Never reuse this source-specific blank-ledger rule for blank destination inputs. Include excluded borrowing source refs in the review Source Map as exclusion notes, not imported amounts.

Exact pack schema (no extra tables, arbitrary sheet names or executable formulas):

```json
{
  "schema": "tpo-monthly-actuals-v1",
  "source": {"filename": "<basename>", "sha256": "<64 lowercase hex>", "reportMonth": "2026-09"},
  "months": [{
    "month": "2026-09",
    "financials": {"revenueCents": 206463271, "cogsCents": 64305055, "sgaCents": 197684895, "netIncomeCents": -55810443},
    "workingCapital": {"cashCents": 315912443, "arCents": 268004997, "inventoryCents": 337391323, "apCents": 1369019294},
    "checks": {"grossProfitCents": 142158216, "ebitCents": -55526679},
    "sourceRefs": {"revenueCents": ["PL!Z15"], "cogsCents": ["PL!Z63"], "sgaCents": ["PL!Z170"], "netIncomeCents": ["PL!Z197"], "cashCents": ["BS!L5", "BS!L6", "BS!L7", "BS!L8"], "arCents": ["BS!L9"], "inventoryCents": ["BS!L12", "BS!L13", "BS!L14"], "apCents": ["BS!L48", "BS!L49", "BS!L50", "BS!L51", "BS!L52", "BS!L55", "BS!L56", "BS!L57", "BS!L58", "BS!L59", "BS!L60", "BS!L61", "BS!L62", "BS!L63", "BS!L64", "BS!L65", "BS!L66"]}
  }]
}
```

Export all actual months in the two verified year blocks, sorted ascending, at most 24 unique months; do not use file modification dates or today's date as the reporting period. Keep source filename/checksum and every contributing source cell. `checks` comes from PL 65 and 172 and must reconcile to revenue–COGS and GP–SG&A within one satang; reject a mismatch rather than balance it.

The review XLSX has exactly three sheets: `MonthlyFinancials`, `1. Working Capital`, and `Source Map`. The first two use the report's canonical column headers and numeric THB values, including computed GP/EBIT/Quarter/NWC for human review only. `Source Map` identifies source filename/checksum, month, field and contributing cells. Add a visible note on Source Map: `Review copy only. Import the JSON pack; do not replace the report workbook or paste over calculated columns.` The review workbook contains no forecasts, macros, VBA UDFs, external links or copied original financial-statement tabs.
Store metadata/source-reference strings as explicit Excel text, including a source filename starting with `=`; none of the review-copy metadata may become an executable formula. Open source workbooks read-only with external-link retention disabled, and close both views after extraction.


### 2. Build read-only planning and complete difference notifications
Add `tools/apps-script/monthly-import.gs`, loaded after validation by the build script. No equivalent monthly-actuals planner exists. Keep parsing, target reads and cell-write planning separate:
- `parseMonthlyActualsPack_(text)` validates the exact schema, 1–24 unique canonical YYYY-MM months, nonempty source basename, 64-lowercase-hex SHA-256, valid source reportMonth, all required source-reference arrays and safe integer-satang values/financial identities. Also reject projected derived amounts or deltas outside JavaScript's safe-integer range. Reject unknown/missing keys, extra tables, formulas, invalid JSON, duplicate months, size above `TPO.maxPrompt`, and a month outside the prior/current years implied by `source.reportMonth` or beyond that current-year reporting month. Source refs are provenance only, never executable or destination instructions.
- `readMonthlyImportTargets_()` reads only the two destination tabs, including headers, values, formulas and sheet IDs, respecting `TPO.maxSourceCells`. Normalize real Date month cells using the same spreadsheet-timezone convention as `readSources_()`. Require both tabs and their required header aliases; reject duplicate matching headers, duplicate month keys and nonempty data rows with invalid/missing months. Do not silently create tabs or guess columns. Extra unrelated columns remain untouched.
- `monthlyActualsPlan_(pack, targets, selectedMonths = null)` is a pure function returning `{months, plan}`. It keys by canonical month and uses `TPOCore.defs` aliases/`month()`/`number()`/`col()`. With null selection, compute all preview records and conflicts without allocating/appending rows, and return an empty write plan. With a validated selection, compute the same records and construct writes only for selected months, allocating append rows in chronological selected-month order independently in each destination.
- `monthlyActualsDiff_(oldCents, newCents)` returns signed `deltaCents` and `deltaPercent = 100 * deltaCents / abs(oldCents)`. Blank old values produce null differences (`New value`); old zero produces a real amount difference and null percentage (`N/A (previous value is zero)`). Negative baselines use the absolute denominator so an improvement from a loss has a positive sign.

Normalize existing numeric target values to cents using a decimal-string HALF_UP helper (including exponent expansion); blank is not zero, and invalid/percent/currency-incompatible values are blocking conflicts. Compare cents exactly: no THB or percentage materiality threshold, and no suppression of rounding-sized corrections. Do not rewrite a numeric string solely for representation if its cents are unchanged.

Preview every changed field for every actual month, including historical months, with `Month | Sheet | Field | Previous | Proposed | Difference (THB) | Difference (%) | Source cells`. THB uses two decimals; percentage uses four decimals, explicit +/−, and a signed `<0.0001%` marker for smaller nonzero changes. Label percentage as change versus the absolute previous value. Never hide unselected historical differences. Include calculated GP/EBIT/NWC differences and formula-only refreshes in the preview, clearly marked calculated rather than imported inputs. Unchanged values need only a summary count.

Month selection is the approval unit: one checkbox authorizes that month's changed raw fields plus disclosed calculated-cell refreshes in both target tabs. Determine the destination's latest actual month from the latest MonthlyFinancials row with numeric revenue, including genuine zero (blank future slots do not count). Default-check only the latest source actual month when it is at least that destination month, has changes and has no conflicts; all earlier source months start unchecked. If the entire pack predates the destination's latest actual month, or the latest source month is unchanged, select nothing automatically. Show counts of changed existing values, new values, and unselected historical corrections before the table. A source month already present in one target and absent in the other is still one month proposal, with each destination handled separately.

Fix the RPC display contract so the UI does not invent its own difference arithmetic:
`previewMonthlyActualsImport()` returns `{previewHash, source, summary, months}`. `summary` contains `{changedExisting, newValues, historicalMonths, unchanged}`. Each month record is `{month, label, status, defaultSelected, conflicts, changes}`; `status` is exactly `new | changed | unchanged | blocked`. A month is new when neither destination has populated raw input amounts for it, even if blank keyed slots exist. `conflicts` is an array of `{sheet, cell, message}`. `changes` is an array of `{sheet, cell, field, kind, previousCents, proposedCents, deltaCents, deltaPercent, sourceRefs, formulaRefresh}`; `kind` is `input | calculated`, and `formulaRefresh` is boolean. Null prior/difference values have the labels specified above. New period/quarter metadata is described in the month header/notes, not treated as a monetary difference. Per-month conflicts disable only that month; malformed schema, missing/duplicate headers or duplicate/invalid destination keys invalidate the whole preview.
For preview records targeting an absent month row, use `cell: 'New row'` rather than promising a physical address before selection. At apply, allocate only selected absent rows contiguously after each tab's last used row and generate their formulas with the resolved row numbers. Unselected missing historical months must not reserve physical rows or create blank gaps. Existing-row preview addresses remain exact.



### 3. Apply only approved months with existing backup and rollback
Expose `previewMonthlyActualsImport(text)` and `applyMonthlyActualsImport(text, selectedMonths, previewHash)` in the new module. Each wraps `serverAction_()` and a single `locked_()`; do not nest locks.

Preview validates, reads targets, builds the pure plan and returns only the display data plus a `previewHash = digest_(JSON.stringify([digest_(text), targetSnapshots]))`. Target snapshots include stable tab IDs, complete headers, exact values and formulas in deterministic sheet order. No DocumentProperties manifest, cache token, input-tab writes or backup rows are needed for preview. Apply repeats all parsing and planning under the lock, compares the hash, and rejects stale packs/targets with `Monthly inputs changed after preview. Preview again; nothing was imported.` It trusts only selected month identifiers from the client, never client-supplied cell addresses/values. Empty/duplicate/unknown selection is an error; an unchanged selected month produces no writes.

Write plans may contain only:
- Changed four raw financial fields and four raw working-capital fields, as numeric THB (`cents / 100`). A formula in a raw-input destination is a blocking conflict, not permission to overwrite it.
- Canonical text month labels (`Sep-26`, text-protected via `text:true`) for genuinely new rows; use an existing same-month slot where available, otherwise append after the last used row without inserting/reordering rows.
- Quarter labels for new/blank Quarter cells, derived from the month. An existing nonblank quarter must agree; preserve agreeing content/formulas, reject disagreement.
- GP/EBIT/NWC calculations for selected months, as described below. All other cells/tabs are untouched, including Commentary, LLM exchange sheets, Report Settings and all separately maintained inputs.

For GP/EBIT/NWC, use the existing blank-safe formulas from `repairPlan_()` with actual mapped column letters and row numbers:
- GP: `=IF(COUNT(<Revenue>,<COGS>)=2,<Revenue>-<COGS>,"")`.
- EBIT: `=IF(COUNT(<GP>,<SG&A>)=2,<GP>-<SG&A>,"")`.
- NWC: `=IF(COUNT(<Cash>,<AR>,<Inventory>,<AP>)=4,<Cash>+<AR>+<Inventory>-<AP>,"")`.
Recognize and preserve these existing formulas and the equivalent legacy direct arithmetic formulas (`=<Revenue>-<COGS>`, `=<GP>-<SG&A>`, `=<Cash>+<AR>+<Inventory>-<AP>`), ignoring whitespace/case. Convert literals/blanks into canonical formulas only for selected months and disclose each formula refresh in the preview, even when the numeric result is unchanged. Any other formula in these three derived cells is a per-month blocking conflict: show its cell, leave it untouched and disable that month. This avoids pretending to know the result of an arbitrary custom formula. Never replace derived values with imported constants.

After all validation and stale checks, grow only destination row capacity with `ensureSize_()` if an append needs it; no columns/tabs are added or deleted. Empty capacity added before a later failure may remain, matching existing repair semantics. Use one `backupAndWrite_(combinedPlan, 'Import accounting actuals')` call for the entire approved selection. Every write's reason records source basename, SHA-256 and source refs, or identifies a disclosed derived-formula refresh. Zero plan means no backup creation/growth. Return `{months, changes, already, warnings}` only after backup/write flush succeeds; propagate original and rollback failures through existing error diagnostics, never false success.

The lock serializes TPO script actions, not manual cell editing. Recheck snapshots immediately before the first source mutation and tell the operator `Do not edit MonthlyFinancials or 1. Working Capital while applying.` Do not claim this is a Sheets transaction against concurrent human edits. Apply's `months` result contains the selected canonical month keys; `changes` is the number of backed-up cell writes; `already` is true only for a zero-write plan; `warnings` contains only real warnings, not synthetic success fallbacks.

Do not call `setup_()`, `repairAndScaffold_()`, `checkAndCalculate_()` or reset the LLM manifest inside this operation. Success text must say `Run TPO → 2. Check & calculate, review Data Validation, then prepare a fresh AI prompt.` The existing source-hash check already rejects old AI responses after input changes. Re-uploading the same pack and previewing again must show unchanged amounts and perform zero writes; applying an obsolete preview after an earlier successful import is correctly rejected as stale.

### 4. Integrate the dialog into the existing five-stage workflow
In `workflow.gs:onOpen()`, add `.addItem('Import accounting actuals…', 'menuImportMonthlyActuals')` immediately after the stage-1 input checklist; keep all other stages/tools intact. Add one sentence to the checklist explaining that the JSON importer fills financial/working-capital inputs and that customer/operational/assumption data remain separate.

Implement `menuImportMonthlyActuals()` in the new module using `uiAction_()` and `dialog_('TPO · Import accounting actuals', body, script, 700)`. Provide JSON file input (`accept=.json,application/json`), `Preview differences`, the month checkboxes/difference table, `Apply selected months`, `Close`, and the existing `#status`/error pattern. Use native FileReader/file.text(), not an XLSX parser in the browser. File change invalidates the prior preview and disables Apply. Disable controls during RPCs; Apply remains disabled until a successful nonempty, conflict-free selection is available. Render all source strings with DOM textContent (or `htmlEscape_()` for server-generated HTML), not raw innerHTML. Use a horizontally/vertically scrollable table with local checkbox sizing so the existing global `input{width:100%}` rule does not distort month controls. Failures remain visible, never show success or close the dialog automatically; stale errors require a fresh Preview.

After apply, disable the old Apply action, report changed cells/months plus backup location, retain the reviewed differences and show the stage-2/fresh-prompt instruction. An identical pack can be previewed again to show `No changes to import.` Do not add a public web app, OAuth client, direct Sheets API writer or website-facing importer.

Update `tools/build-apps-script.cjs` to append the new module after validation; generated `apps-script/Code.gs` remains the single owner-installed artifact. Set `TPO.build` to `2026-10-19-v9`. The existing manual-workflow test's literal old-build assertion is incidental: remove it rather than re-pin it; retain the test's meaningful guide-refresh/preservation/idempotence assertions.

## Critical files and anchors
- `tools/apps-script/validation.gs:195 backupAndWrite_` — authoritative source-write audit and recovery; reuse without weakening it.
- `tools/apps-script/validation.gs:350–355,385–388 repairPlan_` — existing blank-safe formulas and legacy derived-cell ownership; do not call the broad repair during import.
- `tools/apps-script/workflow.gs:218 locked_,257 digest_,347 readSources_,817 dialog_` — lock, stale-state fingerprint, date normalization and dialog patterns.
- `js/report-core.js:51 TPOCore.defs,95 records` — header aliases, canonical month keys and duplicate-period behavior.
- `build_google_sheets_model.py:213 convert_source_workbook,3142 build_google_sheets_workbook` — borrow source-reading technique only; avoid conversion side effects and compensation/forecast generation.

## Verification
Working directory for all commands: `/home/khchan/Projects/Codes/Tpo-Website/MonthlyReport`. No Google credentials or production-sheet writes are needed for automated proof. Run tests/builds once after implementation slices are integrated, not mid-flight in delegated work.

### Permanent behavior tests
Add `tests/test_monthly_input_extract.py` using standard-library unittest and temporary synthetic workbooks created with the same pinned openpyxl dependency. Import the hyphenated extractor path using `importlib.util.spec_from_file_location`; do not import the compensation builder. Keep fixtures isolated; patch synthetic OpenXML cache entries with zipfile/XML where a test needs a real cached formula or shared-formula follower, since openpyxl does not calculate formulas. No dependency on the private accounting workbook or session audit belongs in permanent tests.

Cover actual-vs-future classification including genuine zero salary/revenue, a populated sentinel after a gap, misleading 2026-01-25 prior-year header, strict account/layout and title/year guards, missing/error formula caches including shared followers, AP leaf blanks versus missing required totals, negative COGS, HALF_UP cent rounding, and omission of both borrowing rows when their values are large. Prove the AP total is unchanged when the borrowing amounts and liability subtotal rise together, and does change when an included liability changes. Read back generated review XLSX and JSON values and verify identical THB/cents and source immutability. Invalid input must produce a useful cell reference and no successful output pair.

Append Apps Script tests to `tests/manual-workflow.test.cjs`, reusing `runtime()`, `fixture()`, `Sheet.failOnce`, `flushFail()`, the existing property store and strict `Sheet.name` guard. Do not create permanent menu-wiring/HTML-substring/script-compilation tests or import this test-registered file into a second test file. Add deterministic tests for:
- Preview leaves input values/formulas, backup rows and LLM state untouched; positive/negative/zero/blank baseline differences are correct, including one-satang changes and sub-display percentage changes. Assert structured behavioral outputs rather than exact incidental dialog wording.
- Reordered headers/rows, an existing blank month slot, and appended months resolve to the correct cells; independently populated or absent rows in the two tabs do not create duplicates.
- Historical months begin unselected and remain unchanged unless included in the apply selection; an entirely older pack never auto-selects a correction. A selected historical correction refreshes legacy derived literals, preserves recognized formulas and never writes formula-owned constants. Selecting a single new month does not reserve rows for unselected missing history.
- Raw-input formula conflict, custom derived formula conflict, invalid packet/month selection, duplicate headers/months and stale preview fail before any source/backup mutation. A blocked historical month does not prevent applying a different valid selected month.
- All separate inputs, Commentary, LLM exchange values and manifest keys remain unchanged. Diagnostics may update the existing last-error keys on failures; do not equate diagnostic logging with LLM manifest mutation.
- Injected write failure after earlier writes in each destination restores both tabs' prior values/formulas/formats with Repair Backup evidence; original and rollback errors are surfaced, not successful results. Verify lock release after failure through a subsequent valid call.
- Fresh-preview identical reimport produces zero writes and no added backup rows; an old pre-apply hash is rejected, not accepted as current approval.

The Sheet adapter stores formula strings, not calculated caches. For existing-formula and repeat-preview cases, supply explicit cached values with `sh.put(row, col, {value, formula, rich: null})` in the test fixture/recalculation boundary; do not add a fake general formula engine or a product fallback for the adapter. Independently verify the projected financial/NWC identities through the actual `TPOCore.analyze()` numeric inputs, and check preservation/conversion as observable cell formula ownership. Full Google Sheets formula evaluation remains an owner-run verification limit, not a claimed VM result.

### Commands and actual-source smoke
If no suitable interpreter already has openpyxl, use an isolated temporary environment, never system pip:

```sh
python3 -m venv /tmp/tpo-monthly-import-venv
/tmp/tpo-monthly-import-venv/bin/python -m pip install -r tools/requirements-monthly-input.txt
/tmp/tpo-monthly-import-venv/bin/python -m unittest discover -s tests -p 'test_monthly_input_extract.py'
node tools/build-apps-script.cjs && node --test tests/*.test.cjs
/tmp/tpo-monthly-import-venv/bin/python tools/extract-monthly-input.py --source 'TPO FS Program (updated 2026-10-14).xlsm' --output-prefix /tmp/tpo-monthly-input-smoke
```

Reuse an existing suitable temporary environment/output prefix rather than overwriting or repeating setup. Keep generated JSON/XLSX and smoke artifacts outside the repository, so `git add .` does not accidentally publish new accounting extracts. If pip/venv setup is unavailable, use an already installed compatible openpyxl environment if discovered; otherwise finish the dependency-free Apps Script implementation/proof and report the exact missing dependency/network error, without substituting a second ad hoc OOXML implementation.

Actual-source acceptance:
- Exactly 21 month records: 2025-01 through 2025-12 and 2026-01 through 2026-09. No 2026-10/11/12 records, despite zero P&L subtotals. Source bytes/checksum unchanged.
- September JSON cents: revenue 206463271; COGS 64305055; SG&A 197684895; net income -55810443; cash 315912443; AR 268004997; inventory 337391323; AP 1369019294. Computed GP is 142158216, EBIT -55526679, NWC -447710531. Review XLSX shows corresponding THB values and no borrowing rows in imported AP provenance.
- All 21 month pairs pass GP/EBIT and AP identity checks.
- Against the October-7 snapshot, August Net Income 162690.00 → -44187.89 must show delta -206877.89 and -127.1608%; August Cash 3340966.00 → 3341588.53 must show +622.53 and +0.0186%. Do not treat that snapshot as current production data.

The captured baseline exists at `/home/khchan/.omp/agent/sessions/-Projects-Codes-Tpo-Website-MonthlyReport/2026-10-07T13-29-36-023Z_01a1168e-2217-71c3-afd6-7d838fe680c3/local/sheets-cleanup-live-audit.json` (`capturedAt: 2026-10-07T13:10:34.008Z`). Load it programmatically into a COPY of the exported test runtime: sourceTables supply input arrays, guideAndHeaderTables supply the guides/Commentary, userEnteredGrid overlays formula strings while preserving cached values. Do not print the whole private fixture. To load the existing runtime for a throwaway smoke without registering its tests, evaluate the test module with a custom require returning a no-op function for `node:test`, preserve __dirname as the tests directory, and use its existing module.exports. If the private fixture is unavailable, use `fixture()` plus explicit August baseline rows with the values above, mark the smoke as synthetic, and still execute the real source extractor.

### Actual dialog and owner-run checks
Serve the HTML generated by the actual `menuImportMonthlyActuals()` on a session-owned local HTTP server. Bridge chainable `google.script.run.withSuccessHandler().withFailureHandler()` calls to the actual preview/apply VM handlers (not a fake success response); expose a read-only copied-state endpoint for observation. Open a managed Chromium tab using the browser tool, upload the generated JSON with uploadFile(), and verify the rendered month checkboxes, all old/new/THB/% differences and source refs. Confirm August starts unchecked and September selected; apply September and inspect target cells, new-row formulas, Repair Backup, and unchanged separate inputs. Re-preview/reimport for the zero-write case. Then select August to observe corrected cash/payables/net income and disclosed derived refreshes; force a stale preview and verify no source writes, and exercise a prior-zero percentage label. Use a screenshot for visual proof and DOM/state inspection for exact values; report spreadsheet-formula-evaluation limits honestly.

Owner-run live instructions after installing the complete regenerated `apps-script/Code.gs`: save/reload, open `TPO → 1. Enter monthly data → Import accounting actuals…`, upload JSON, review/select months, apply, inspect Repair Backup, then run `2. Check & calculate`. Confirm GP/EBIT/NWC recalculate, review Data Validation/customer coverage warnings, and prepare a fresh AI batch. Never imply that GitHub push installs the bound script or that copied-VM/Chromium proof observed the authenticated live Sheets surface.

## Assumptions and contingencies
- The broad AP definition is deliberate: all BS liability detail amounts except the two borrowing accounts, including accruals and tax payables. Do not replace it with trade payables only.
- Historical revisions are visible but opt-in. The latest source actual month alone is selected by default only when it is not older than the destination's latest actual month; an entirely older pack starts with no selections. The user can choose additional months in the same reviewed transaction.
- The supported source profile is the inspected PL/BS layout; on changed anchors/ambiguous years/missing caches, stop with exact source references and request a recalculated/saved source or updated mapping, never guess from the filename. Formula-cache presence does not prove freshness; tell the operator to recalculate and save the original in Excel before extraction.
- If openpyxl is unavailable, create an isolated temporary virtualenv for execution/smokes and install the pinned requirements there; do not change system packages or the existing builder.
- Owner-run installation of the regenerated complete `apps-script/Code.gs` remains separate from GitHub deployment. Use only workbook copies/adapters for automation; without an authenticated owner session, explicitly report that the real Google Sheets menu/recalculation surface was not observed and supply installation/run steps.
