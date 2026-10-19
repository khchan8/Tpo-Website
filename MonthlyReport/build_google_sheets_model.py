#!/usr/bin/env python3
"""Build the Google Sheets-compatible TPO compensation model workbook.

Converts ``TPO FS Program (updated 2026-10-10).xlsm`` into a macro-free
``.xlsx`` that (a) retains every original worksheet, cached value, style and
visibility state, (b) replaces all VBA user-defined-function formulas with
plain formulas supported by both Excel and Google Sheets, and (c) adds a
transparent, formula-driven reconstruction of the Streamlit compensation
model (``app.py`` / ``model.py``) as seven new leading sheets.

``--company-v2`` instead builds the Company Focus V2 director workbook: one
editable payment proposal measured against a fixed salary-only baseline,
with formula-only source validation, built from the same immutable source.

``--company-v3`` builds the Company Focus V3 workbook: the identical V2
director dashboard plus a CEO/COO personal salary, dividend and Thai-tax
reference comparison added below row 800 of the Company Dashboard sheet,
with a THB/USD display selector, written to its own separate output file.

``--company-v3-1`` adds an Interactive Charts sheet to the unchanged V3
model: four one-variable salary/dividend sensitivities, each plotting
company EBITDA and both executives' take-home for the dashboard period.

``--company-v4`` builds the Company Focus V4 workbook: the V3 director
workbook rebuilt as a prospective 2027 executive incentive proposal (THB
200,000 monthly base salaries per executive effective 1 January 2027,
quarterly certified service-award targets, hypothetical dividend shares
and payout ratio at zero) plus one reasoning sheet ("V4 Plan") that
carries the source performance trend, the company EBITDA comparison
against the fixed THB 500,000 salary baseline and the CCC/Revenue Code
guardrails behind any future dividend. Awards are separately certified
service-based amounts posted at 2027 quarter ends; the workbook models
payments, it never authorizes them.
"""


import argparse
import os
import re
import sys
import zipfile
from pathlib import Path

import openpyxl
from openpyxl.chart import Reference, ScatterChart, Series
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.workbook.properties import CalcProperties
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.formula import ArrayFormula
from openpyxl.worksheet.hyperlink import Hyperlink
from openpyxl.worksheet.pagebreak import Break

ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE = ROOT / 'TPO FS Program (updated 2026-10-10).xlsm'
DEFAULT_OUTPUT = ROOT / 'TPO FS Program (updated 2026-10-10) - Google Sheets Model.xlsx'
DEFAULT_V2_OUTPUT = ROOT / 'TPO FS Program (updated 2026-10-10) - Company Focus V2.xlsx'
DEFAULT_V3_OUTPUT = ROOT / 'TPO FS Program (updated 2026-10-10) - Company Focus V3.xlsx'
DEFAULT_V31_OUTPUT = ROOT / 'TPO FS Program (updated 2026-10-10) - Company Focus V3.1.xlsx'
DEFAULT_V4_OUTPUT = ROOT / 'TPO FS Program (updated 2026-10-10) - Company Focus V4.xlsx'

# ---------------------------------------------------------------- palette ---
YELLOW = 'FFF2CC'   # user-editable scenario / case inputs
BLUE = 'D9EAF7'     # source-linked defaults and policy / tax assumptions
GREEN = 'E2F0D9'    # formula outputs
GREY = 'E7E6E6'     # labels and notes
LINK_BLUE = '0563C1'
LOSS_FILL = 'FFC7CE'
LOSS_FONT = '9C0006'
GOOD_FILL = 'C6EFCE'    # favorable change / improves verdict
GOOD_FONT = '006100'
WARN_FILL = 'FFEB9C'    # blocked input / mixed verdict
WARN_FONT = '9C6500'
NEUTRAL_FONT = '595959'  # no-change verdict
MONEY = '#,##0.00'
MONEY0 = '#,##0'
PCT = '0.0%'
PCT2 = '0.00%'
INT = '0'
DATEFMT = 'mmm yyyy'

THIN = Side(style='thin', color='BFBFBF')
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

# ------------------------------------------------------- model constants ---
# Mirrors app.py::CASES (kept literal so the builder stays deterministic and
# free of any streamlit import; tests cross-check against app.py).
CASES = [
    dict(id='salary_only', label='Salary only · reference', ceo_salary=500000, coo_salary=500000, ceo_share=0.0, coo_share=0.0),
    dict(id='equal_split', label='Current equal-split proposal', ceo_salary=100000, coo_salary=100000, ceo_share=0.25, coo_share=0.25),
    dict(id='salary_led', label='Higher fixed salaries', ceo_salary=250000, coo_salary=250000, ceo_share=0.15, coo_share=0.15),
    dict(id='retention_led', label='More profit retained', ceo_salary=100000, coo_salary=100000, ceo_share=0.10, coo_share=0.10),
    dict(id='unequal_roles', label='Unequal CEO and COO packages', ceo_salary=200000, coo_salary=100000, ceo_share=0.30, coo_share=0.20),
    dict(id='custom', label='Your custom case', ceo_salary=100000, coo_salary=100000, ceo_share=0.25, coo_share=0.25),
]

# Mirrors app.py::SUMMARY_METRICS (label, unit) in canonical order.
SUMMARY_METRICS = [
    ('Months', 'count'), ('Revenue', 'money'), ('Other net expenses', 'money'),
    ('Management expense', 'money'), ('Executive payroll', 'money'),
    ('Payroll saved vs salary-only reference', 'money'), ('Pre-tax profit', 'money'),
    ('EBITDA', 'money'), ('Pre-tax margin', 'percent'), ('Corporate tax provision', 'money'),
    ('After-tax profit', 'money'), ('After-tax margin', 'percent'),
    ('Legal reserve allocation', 'money'), ('Dividends declared', 'money'),
    ('Effective payout ratio', 'percent'), ('Dividends received', 'money'),
    ('Ending dividend payable', 'money'), ('Earnings kept', 'money'),
    ('Change in unappropriated retained earnings', 'money'),
    ('Opening unappropriated retained earnings', 'money'),
    ('Closing unappropriated retained earnings', 'money'), ('Loss months', 'count'),
    ('CEO gross salary', 'money'), ('CEO gross dividends', 'money'),
    ('CEO Thai salary tax', 'money'), ('CEO Thai dividend tax', 'money'),
    ('CEO social security', 'money'), ('CEO take-home after Thai tax', 'money'),
    ('CEO average monthly take-home', 'money'), ('COO gross salary', 'money'),
    ('COO gross dividends', 'money'), ('COO Thai salary tax', 'money'),
    ('COO Thai dividend tax', 'money'), ('COO social security', 'money'),
    ('COO take-home after Thai tax', 'money'), ('COO average monthly take-home', 'money'),
]

# Thai personal income tax bands used by model.progressive / thai_salary_tax.
PIT_BANDS = [
    (0, 150000, 0.00), (150000, 300000, 0.05), (300000, 500000, 0.10),
    (500000, 750000, 0.15), (750000, 1000000, 0.20), (1000000, 2000000, 0.25),
    (2000000, 5000000, 0.30), (5000000, 999999999999, 0.35),
]

MODEL_SHEETS = ['Model Guide', 'Model Inputs', 'Tax Tables', 'Operating Model',
                'Monthly Model', 'Case Summary', 'Formula Notes']

# Company Focus V2 (director presentation) sheets in delivered order; the two
# engine sheets are hidden in the delivered workbook.
V2_MODEL_SHEETS = ['Company Dashboard', 'Data Update Guide', 'Source Check',
                   'Operating Model', 'Company Calculation']

# Company Focus V3 uses the same five leading sheets as V2; the dashboard
# additionally carries the distant personal-reference block below row 800.
V3_MODEL_SHEETS = ['Company Dashboard', 'Data Update Guide', 'Source Check',
                   'Operating Model', 'Company Calculation']

V31_MODEL_SHEETS = ['Company Dashboard', 'Interactive Charts', 'Data Update Guide',
                    'Source Check', 'Operating Model', 'Company Calculation']

# Company Focus V4 adds one visible reasoning sheet after the dashboard; the
# personal-reference block and the five V3 sheets are otherwise unchanged.
V4_MODEL_SHEETS = ['Company Dashboard', 'V4 Plan', 'Data Update Guide',
                   'Source Check', 'Operating Model', 'Company Calculation']

UDF_NAMES = ('MTD', 'YTD_CY_Sum', 'YTD_LY_Sum', 'VarPercent')

# PL layout anchors (model.load_history is authoritative).
PL_ROWS = dict(revenue=15, management=107, pretax=193, da=150, interest=175)
PL_2025_FIRST_COL = 33   # AG  (Jan 2025) .. AR (Dec 2025)
PL_2026_FIRST_COL = 18   # R   (Jan 2026) .. Y (Aug 2026 actuals)

# Cells whose source cache is stale and which are therefore frozen to their
# last Excel-calculated value (see Formula Notes): PL!I158's prior-year cell
# was already non-zero when the workbook was last saved, but its cached
# percent (1 = +100%) predates that; every other VarPercent cell in the
# workbook follows the plain ratio rule.
FROZEN_SOURCE_CELLS = {'PL!I158': 1}

# Model Inputs cell map (referenced across sheets).
MI = dict(
    period='$C$5', start='$C$6', mode='$C$7', cit='$C$8', opening='$C$9',
    reserve='$C$10', taxloss='$C$11', allowance='$C$12', ssc='$C$13',
    growth='$C$14', cost_growth='$C$15', blend='$C$16', fx='$C$17',
    patcha='$C$18', constrained='$C$19', actual_month='$C$20',
    ref_ceo='$B$23', ref_coo='$B$24', ref_payroll='$B$25', reserve_rate='$B$26',
    reserve_target='$B$27', withholding='$B$28', sed_rate='$B$29',
    sed_cap='$B$30', personal_allowance='$B$31',
)
MI_REF = lambda key: f"'Model Inputs'!{MI[key]}"


def page_setup(ws, *, landscape=True, fit_width=True, title_rows=None):
    """Print/PDF rendering: fit wide sheets to one page across, repeat headers."""
    from openpyxl.worksheet.properties import PageSetupProperties
    ws.page_setup.orientation = 'landscape' if landscape else 'portrait'
    if fit_width:
        ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
    if title_rows:
        ws.print_title_rows = title_rows


def _fill(color):
    return PatternFill('solid', fgColor=color)


def put(ws, coord, value, *, fill=None, fmt=None, bold=False, italic=False,
        wrap=False, halign=None, valign='top', color=None, size=None,
        border=True, text=False):
    """Write a styled cell. ``text=True`` stores a leading-'=' string as
    literal text (formula templates in Formula Notes) instead of a formula."""
    c = ws[coord]
    c.value = value
    if text and isinstance(value, str) and value.startswith('='):
        c.data_type = 's'
    if fill:
        c.fill = _fill(fill)
    if fmt:
        c.number_format = fmt
    c.font = Font(bold=bold, italic=italic, color=color or '000000',
                  size=size or 11, name='Calibri')
    c.alignment = Alignment(horizontal=halign, vertical=valign, wrap_text=wrap)
    if border:
        c.border = BORDER
    return c


# ============================================================ source conversion
def convert_source_workbook(source: Path):
    """Load the .xlsm, replace VBA-UDF formulas, drop broken macro names."""
    wb = openpyxl.load_workbook(source)
    cached = openpyxl.load_workbook(source, data_only=True)

    varpercent = re.compile(r'^=\s*VarPercent\(([A-Z]+)(\d+),([A-Z]+)(\d+)\)\s*$', re.I)
    mtd = re.compile(r'^=\s*MTD\(\$([DF])\$7\)\s*$', re.I)
    ytd = re.compile(r'^=\s*YTD_(CY|LY)_Sum\(\$([KM])\$7\)\s*$', re.I)

    replaced = 0
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                v = cell.value
                if not isinstance(v, ArrayFormula):
                    continue
                text = v.text
                m = varpercent.match(text)
                if m:
                    cur, cur_r, prev, prev_r = m.groups()
                    cell.value = (
                        f'=IF(OR({prev}{prev_r}=0,{prev}{prev_r}=""),'
                        f'IF(OR({cur}{cur_r}=0,{cur}{cur_r}=""),0,1),'
                        f'{cur}{cur_r}/{prev}{prev_r}-1)')
                    replaced += 1
                    continue
                m = mtd.match(text)
                if m and ws.title == 'IncomeStatement':
                    replaced += _write_lookup(cell, m.group(1))
                    continue
                m = ytd.match(text)
                if m and ws.title == 'IncomeStatement':
                    replaced += _write_lookup(cell, m.group(2))
                    continue
                raise ValueError(f'Unsupported array formula {ws.title}!{cell.coordinate}: {text!r}')

    for name in [n for n in list(wb.defined_names)
                 if n.startswith('_xlpm.') or n.startswith('_xleta.')]:
        del wb.defined_names[name]

    for ref, value in FROZEN_SOURCE_CELLS.items():
        sheet, coord = ref.split('!')
        cached_value = cached[sheet][coord].value
        wb[sheet][coord] = cached_value if cached_value is not None else value
    return wb, replaced


def _write_lookup(cell, pl_col):
    """INDEX/MATCH the row's report code into PL; SUMIFS fallback covers codes
    stored as text in IncomeStatement but numeric in PL (e.g. '41210')."""
    r = cell.row
    cell.value = (f'=IFERROR(INDEX(PL!${pl_col}:${pl_col},MATCH($A{r},PL!$A:$A,0)),'
                  f'SUMIFS(PL!${pl_col}:${pl_col},PL!$A:$A,$A{r}))')
    return 1


# =================================================================== sheets ==
def _build_model_guide(wb):
    ws = wb.create_sheet('Model Guide')
    ws.sheet_properties.tabColor = '1F4E79'
    ws.sheet_view.showGridLines = False
    ws.column_dimensions['C'].width = 110

    put(ws, 'B2', 'TPO FS Program — Google Sheets compensation model', bold=True, size=16, border=False)
    put(ws, 'B3', 'Macro-free reconstruction of the Streamlit compensation planner (app.py / model.py) beside the original financial statements.', italic=True, border=False)

    rows = [
        ('Purpose', 'Compare six executive compensation cases (two salaries + two dividend shares) on one shared operating forecast, with company profitability, Thai personal tax and retained-earnings effects fully visible as cell formulas. Every figure is THB.'),
        ('Data flow', 'Original sheets (PL / BS / COGS / IncomeStatement / TB YTD) hold the imported accounting actuals → Operating Model links those actuals and extends them with the 2026 completion and 2027 forecast → Monthly Model rolls each of the six cases forward month by month (36 months each, 216 rows) → Case Summary aggregates the selected period for all six cases. Formula Notes documents every formula family.'),
        ('Actuals vs modeled months', 'Every 2026 month is classified by formula from the PL!R:AC row 107 salary sentinel (blank in unreported months): months labelled "Actual" link straight to PL rows 15 (revenue), 107 (management), 193 (pre-tax), 150 (D&A) and 175 (interest income); newly pasted contiguous months automatically extend the actual period. The remaining "2026 estimate" months scale the matching 2025 month by (contiguous 2026 actual YTD ÷ the same months of 2025); "2027 forecast" months rescale the completed 2026 year with the growth inputs and a blended 2025/2026 seasonality weight. A populated month after a blank one is an import error ("⚠ actual after gap"): it is never silently treated as actual — the status cell (Model Inputs!C20), the estimate/2027 rows and the Case Summary metrics all show visible warnings instead.'),
        ('Case visibility menu (Google Apps Script)', 'An .xlsx file cannot carry a Google Sheets-bound script, so the optional TPO Model menu is installed once by hand: (1) import this workbook into Google Sheets (File → Import → Upload, replace/create a spreadsheet); (2) open Extensions → Apps Script; (3) delete the default Code.gs content and paste the repository file apps-script/Code.gs; (4) create a new HTML file named exactly CaseVisibility and paste apps-script/CaseVisibility.html; (5) save the project, reload the spreadsheet, then use TPO Model → Choose visible cases… and authorize the script on first run (spreadsheet scope only). The script only hides/shows the per-case columns and row blocks described in its CASE_LAYOUT — it never edits values or formulas. Importing a fresh .xlsx creates a new spreadsheet, so the script must be installed again.'),
        ('IMPORTANT — what is a formula', 'Source actual values are imported inputs; every new calculation on the seven new sheets is a live cell formula referencing Model Inputs, Tax Tables and the original sheets. No compensation amount, tax rate, deduction or growth assumption is embedded in a formula — change the yellow or blue input cells and the whole model recalculates.'),
        ('Compensation timing', 'Executive salaries are monthly employment expense: they reduce pre-tax profit the month they are earned. Corporate tax is provided monthly on year-to-date taxable profit after loss carryforward, so a loss month automatically reverses part of the year’s provision. After-tax profit funds dividends in the same month they are earned (declared), but cash payment follows one month later: "dividends paid" in a month equal the prior month’s earned dividend, so December’s dividend is payable at the period end.'),
        ('Dividend availability modes', 'Economic allocation (default): dividends come only from current positive eligible profit; accumulated losses and the legal reserve are ignored. Apply modeled losses and reserve: eligible profit is additionally capped by non-negative retained earnings, and 5% of it is allocated to the legal reserve until the reserve target (10% of capital) is met, before any dividend may be declared.'),
        ('Start-year rule', 'With "Salary change starts in January 2026" the 2025 rows are an independent comparison run opened at BS!Q73, and January 2026 RESETS retained earnings to the selected opening (BS!D73 default), the reserve gap to the input default and the tax-loss carryforward to the verified input — the 2025 comparison never contaminates the 2026 timeline. With a 2025 start, January 2025 opens at BS!Q73 and the timeline runs continuously through 2027, updating the tax-loss carry at each year boundary.'),
        ('Color legend', 'Pale yellow = user-editable scenario or case input. Pale blue = source-linked defaults and policy/tax assumptions. Pale green = formula output. Grey = labels and notes. On Monthly Model every cell is a formula (pale green) or a label (grey); there are no editable cells there.'),
        ('Source conversion', 'The original 626 VBA-UDF formulas (MTD, YTD_CY_Sum, YTD_LY_Sum, VarPercent) were replaced with standard IF/OR/INDEX/MATCH/SUMIFS formulas; VBA macros, ActiveX controls and 13 broken macro parameter names were removed so the file opens cleanly in Google Sheets. See Formula Notes for the exact translations and the one frozen stale-cache cell (PL!I158).'),
    ]
    r = 5
    for title, text in rows:
        put(ws, f'B{r}', title, bold=True, fill=GREY, wrap=True, halign='left')
        put(ws, f'C{r}', text, wrap=True, halign='left')
        ws.row_dimensions[r].height = max(30, 13 * (len(text) // 105 + 1))
        r += 1

    r += 1
    put(ws, f'B{r}', 'Navigate', bold=True, size=13, border=False)
    r += 1
    for sheet, blurb in [
        ('Model Inputs', 'All scenario, company, Thai-tax and forecast controls, the detected-actual status cell and the six-case table (one column per case).'),
        ('Tax Tables', 'Thai personal income tax bands used by the salary-tax formulas.'),
        ('Operating Model', '36-month operating rows with formula-driven 2026 actual detection, 2026 completion and 2027 forecast.'),
        ('Monthly Model', '216-row six-case monthly roll-forward with every intermediate state.'),
        ('Case Summary', 'The 36 app metrics for all six cases over the selected period.'),
        ('Formula Notes', 'Formula dictionary: every formula family, its inputs, effect and edge cases.'),
        ('IncomeStatement', 'Original income statement (UDF formulas translated).'),
        ('PL', 'Original profit & loss detail — the actuals source and the row 107 actual-month sentinel.'),
        ('BS', 'Original balance sheet — retained-earnings openings and capital.'),
    ]:
        put(ws, f'B{r}', sheet, fill=BLUE, halign='left')
        ws[f'B{r}'].hyperlink = Hyperlink(ref=f'B{r}', location=f"'{sheet}'!A1")
        ws[f'B{r}'].font = Font(color=LINK_BLUE, underline='single', bold=True)
        put(ws, f'C{r}', blurb, wrap=True, halign='left')
        r += 1
    ws.freeze_panes = 'A5'
    page_setup(ws, landscape=False, fit_width=False)
    return ws


def _build_model_inputs(wb):
    ws = wb.create_sheet('Model Inputs')
    ws.sheet_properties.tabColor = '2E75B6'
    for col, w in dict(A=16, B=42, C=26, D=95, E=3, F=30, G=19, H=19, I=19,
                       J=19, K=19, L=19).items():
        ws.column_dimensions[col].width = w

    put(ws, 'A1', 'Model Inputs — scenario, company, Thai-tax and forecast controls', bold=True, size=14, border=False)
    put(ws, 'A2', 'Yellow = editable input · Blue = source-linked default or policy assumption · Green = formula output. Every model formula references these cells.', italic=True, border=False)

    put(ws, 'A4', 'Section', bold=True, fill=GREY)
    put(ws, 'B4', 'Input', bold=True, fill=GREY)
    put(ws, 'C4', 'Value', bold=True, fill=GREY)
    put(ws, 'D4', 'Explanation', bold=True, fill=GREY)

    controls = [
        ('Scenario', 'Selected period', '2027 forecast', YELLOW, None,
         'Drives Case Summary: 2025 historical simulation (Jan–Dec 2025) · 2026 actual months (ends at the detected actual month, cell C20) · 2026 full-year estimate · 2027 forecast.'),
        ('Scenario', 'Salary change starts in January', 2026, YELLOW, INT,
         '2025 or 2026. 2026 resets retained earnings / reserve / tax-loss carry to the opening inputs at Jan 2026; 2025 runs one continuous timeline from Jan 2025.'),
        ('Scenario', 'Dividend availability', 'Economic allocation · ignores losses/reserve', YELLOW, None,
         'Economic allocation declares dividends from current positive eligible profit only; the constrained mode also caps by retained earnings and funds the legal reserve first.'),
        ('Company', 'Corporate tax rate', 0.20, YELLOW, PCT,
         'Monthly provision = MAX(0, taxable profit YTD − loss carryforward) × this rate.'),
        ('Company', 'Opening retained earnings (THB)', '=IF($C$6=2025,BS!$Q$73,BS!$D$73)', BLUE, MONEY,
         'Source-linked default: BS!Q73 for a 2025 start, BS!D73 for a 2026 start (mirrors the app). Overwrite with a number to test other openings.'),
        ('Company', 'Remaining legal reserve to fund (THB)', '=BS!$K$71*$B$27', BLUE, MONEY,
         'Default = capital (BS!K71) × reserve-target share below. Used only in constrained mode.'),
        ('Company', 'Verified opening tax loss carryforward (THB)', 0, YELLOW, MONEY,
         'Tax losses reduce the corporate-tax base after opening; book losses do not. Default relief is zero until verified.'),
        ('Thai personal tax', 'Extra annual deductions per executive (THB)', 0, YELLOW, MONEY,
         'Applied to both executives before the Tax Tables bands.'),
        ('Thai personal tax', 'Monthly employee social security (THB)', 0, YELLOW, MONEY,
         'Monthly withholding; also deducted (×12) when computing annual taxable salary.'),
        ('2027 forecast', 'Revenue growth vs estimated 2026', 0.10, YELLOW, PCT,
         'Applied to full-year 2026 estimated revenue.'),
        ('2027 forecast', 'Other net expense growth', 0.05, YELLOW, PCT,
         'Applied to full-year 2026 estimated other net expenses; same seasonal weight as revenue.'),
        ('2027 forecast', '2026 weight in seasonal pattern', 0.50, YELLOW, PCT,
         '2027 monthly weight = (1−blend)×2025 month share + blend×2026 month share of revenue.'),
        ('Display', 'THB per USD · planning rate', 35, YELLOW, MONEY0,
         'Planning FX only — the model itself stays entirely in THB.'),
        ('Forecast payroll', 'Non-executive management (Patcha) · monthly', 12500, YELLOW, MONEY0,
         'Added to the two reference salaries to form forecast management cost for every modeled (non-actual) month.'),
        ('Scenario', 'Constrained dividend flag (derived)', '=IF($C$7="Apply modeled losses and reserve",1,0)', GREEN, INT,
         '1 = cap dividends by retained earnings and fund the legal reserve; 0 = economic allocation.'),
        ('Status', 'Latest detected 2026 actual month',
         ('=IF(COUNTIF(\'Operating Model\'!$B$16:$B$27,"⚠ actual after gap")>0,'
          '"⚠ 2026 actual after gap — a populated month follows a blank month",'
          'IF(COUNTIFS(\'Operating Model\'!$B$16:$B$27,"Actual")=0,'
          '"⚠ no 2026 actual months detected in PL!R:AC",'
          'DATE(2026,COUNTIFS(\'Operating Model\'!$B$16:$B$27,"Actual"),1)))'),
         GREEN, DATEFMT,
         'Formula-driven detection: Operating Model B16:B27 classify each 2026 month from the PL!R:AC row 107 salary sentinel. '
         'This cell is the contiguous-actual period end (used by Case Summary “2026 actual months”) or a visible ⚠ warning when the import is broken.'),
    ]
    r = 5
    for section, label, value, fill, fmt, note in controls:
        put(ws, f'A{r}', section, fill=GREY)
        put(ws, f'B{r}', label, fill=GREY, wrap=True)
        put(ws, f'C{r}', value, fill=fill, fmt=fmt, halign='right', bold=True, wrap=True)
        put(ws, f'D{r}', note, wrap=True)
        ws.row_dimensions[r].height = 30
        r += 1

    put(ws, 'A21', 'Policy & calculation constants — referenced by formulas, never embedded', bold=True, size=12, border=False)
    put(ws, 'A22', 'Constant', bold=True, fill=GREY)
    put(ws, 'B22', 'Value', bold=True, fill=GREY)
    put(ws, 'C22', 'Where it is used', bold=True, fill=GREY, wrap=True)
    ws.merge_cells('C22:D22')
    policy = [
        ('Reference CEO salary (monthly)', 500000, 'Salary-only reference case payroll; scenario management swaps reference payroll for the case salaries.', MONEY0),
        ('Reference COO salary (monthly)', 500000, 'Together the reference payroll of ฿1,000,000/month that forecast management cost and scenario pre-tax profit are built on.', MONEY0),
        ('Reference payroll · both executives (monthly)', '=$B$23+$B$24', 'Operating Model forecast management and Monthly Model scenario pre-tax/management columns.', MONEY0),
        ('Legal-reserve allocation rate', 0.05, 'Constrained mode: share of eligible profit allocated to the legal reserve each month.', PCT),
        ('Reserve target · share of capital', 0.10, 'Default reserve gap = BS!K71 × this share (cell C10).', PCT),
        ('Thai dividend withholding rate', 0.10, '10% final withholding on dividends paid, per executive.', PCT),
        ('Salary expense deduction · share of salary', 0.50, 'Thai taxable-salary deduction for each executive.', PCT),
        ('Salary expense deduction cap (annual)', 100000, 'The 50% salary deduction is capped at this amount.', MONEY0),
        ('Personal allowance (annual)', 60000, 'Thai personal allowance deducted before Tax Tables bands.', MONEY0),
    ]
    r = 23
    for label, value, use, fmt in policy:
        put(ws, f'A{r}', label, fill=GREY)
        put(ws, f'B{r}', value, fill=BLUE if not str(value).startswith('=') else GREEN, fmt=fmt, halign='right', bold=True)
        put(ws, f'C{r}', use, wrap=True)
        put(ws, f'D{r}', '', border=False)
        r += 1

    # ---------------------------------------------------------- case table ---
    # One column per case (G:L) so the Apps Script menu can hide/show cases.
    put(ws, 'F1', 'Six compensation cases (app.py::CASES) — one column per case', bold=True, size=13, border=False)
    put(ws, 'F2', 'Rows 7–10 (salaries and dividend shares) are the editable case inputs (yellow). Rows 11–16 are formula outputs (green) using the policy cells and Tax Tables.', italic=True, border=False)
    put(ws, 'F4', 'Field', bold=True, fill=GREY, wrap=True)
    for i, case in enumerate(CASES):
        col = get_column_letter(7 + i)
        put(ws, f'{col}4', case['label'], bold=True, fill=GREY, wrap=True, halign='center')

    fields = [
        (5, 'Case ID', 'id', GREY, None),
        (6, 'Case', 'label', GREY, None),
        (7, 'CEO monthly salary', 'ceo_salary', YELLOW, MONEY0),
        (8, 'COO monthly salary', 'coo_salary', YELLOW, MONEY0),
        (9, 'CEO dividend share', 'ceo_share', YELLOW, PCT),
        (10, 'COO dividend share', 'coo_share', YELLOW, PCT),
    ]
    for r, label, key, fill, fmt in fields:
        put(ws, f'F{r}', label, bold=True, fill=GREY, wrap=True)
        for i, case in enumerate(CASES):
            col = get_column_letter(7 + i)
            put(ws, f'{col}{r}', case[key], fill=fill, fmt=fmt,
                halign='right' if fmt else 'left')
    for r, label in [(11, 'Combined share'), (12, 'Residual eligible share'),
                     (13, 'CEO annual taxable salary'), (14, 'COO annual taxable salary'),
                     (15, 'CEO annual Thai salary tax'), (16, 'COO annual Thai salary tax')]:
        put(ws, f'F{r}', label, bold=True, fill=GREY, wrap=True)
    for i in range(len(CASES)):
        col = get_column_letter(7 + i)
        put(ws, f'{col}11', f'={col}9+{col}10', fill=GREEN, fmt=PCT, halign='right')
        put(ws, f'{col}12', f'=1-{col}9-{col}10', fill=GREEN, fmt=PCT, halign='right')
        put(ws, f'{col}13', (f'=MAX(0,{col}7*12-MIN({col}7*12*{MI["sed_rate"]},{MI["sed_cap"]})'
                             f'-{MI["personal_allowance"]}-{MI["allowance"]}-{MI["ssc"]}*12)'),
            fill=GREEN, fmt=MONEY, halign='right')
        put(ws, f'{col}14', (f'=MAX(0,{col}8*12-MIN({col}8*12*{MI["sed_rate"]},{MI["sed_cap"]})'
                             f'-{MI["personal_allowance"]}-{MI["allowance"]}-{MI["ssc"]}*12)'),
            fill=GREEN, fmt=MONEY, halign='right')
        put(ws, f'{col}15', (f"=SUMPRODUCT(--({col}13>'Tax Tables'!$B$4:$B$11),({col}13-'Tax Tables'!$B$4:$B$11),"
                             f"'Tax Tables'!$E$4:$E$11)"), fill=GREEN, fmt=MONEY, halign='right')
        put(ws, f'{col}16', (f"=SUMPRODUCT(--({col}14>'Tax Tables'!$B$4:$B$11),({col}14-'Tax Tables'!$B$4:$B$11),"
                             f"'Tax Tables'!$E$4:$E$11)"), fill=GREEN, fmt=MONEY, halign='right')

    put(ws, 'F18', 'Case checks', bold=True, fill=GREY)
    put(ws, 'G18', ('=IF(SUMPRODUCT(--($G$11:$L$11>1))>0,"⚠ Combined dividend share exceeds 100% in at least one case",'
                    'IF(SUMPRODUCT(--($G$7:$L$8<0))>0,"⚠ Negative salary in a case","OK"))'),
        fill=GREEN, halign='left')
    ws.merge_cells('G18:L18')

    dv_period = DataValidation(type='list', allow_blank=False,
                               formula1='"2025 historical simulation,2026 actual months,2026 full-year estimate,2027 forecast"')
    dv_start = DataValidation(type='list', allow_blank=False, formula1='"2026,2025"')
    dv_mode = DataValidation(type='list', allow_blank=False,
                             formula1='"Economic allocation · ignores losses/reserve,Apply modeled losses and reserve"')
    dv_salary = DataValidation(type='decimal', operator='greaterThanOrEqual', formula1='0',
                               allow_blank=False, errorTitle='Invalid salary',
                               error='Salaries must be zero or positive (THB/month).')
    dv_share = DataValidation(type='decimal', operator='between', formula1='0', formula2='1',
                              allow_blank=False, errorTitle='Invalid share',
                              error='Dividend shares must be between 0% and 100%.')
    for dv in (dv_period, dv_start, dv_mode, dv_salary, dv_share):
        ws.add_data_validation(dv)
    dv_period.add('C5')
    dv_start.add('C6')
    dv_mode.add('C7')
    dv_salary.add('G7:L8')
    dv_share.add('G9:L10')
    ws.freeze_panes = 'A5'
    page_setup(ws)
    return ws


def _build_tax_tables(wb):
    ws = wb.create_sheet('Tax Tables')
    ws.sheet_properties.tabColor = '548235'
    for col, w in dict(A=8, B=20, C=20, D=10, E=14, F=95).items():
        ws.column_dimensions[col].width = w
    put(ws, 'A1', 'Thai personal income tax — annual salary bands (model.progressive / thai_salary_tax)', bold=True, size=14, border=False)
    put(ws, 'A2', 'Employment deduction (50% of salary, cap ฿100,000), ฿60,000 personal allowance, extra deductions and social security are subtracted BEFORE these bands. Monthly Model uses annual tax ÷ 12.', italic=True, border=False)
    for col, h in zip('ABCDEF', ['Band', 'Lower bound (THB)', 'Upper bound (THB)', 'Rate', 'Marginal step', 'Notes']):
        put(ws, f'{col}3', h, bold=True, fill=GREY, wrap=True)
    notes = [
        'Tax-free band: first ฿150,000 of taxable salary.',
        'Each band taxes only the slice above its lower bound.',
        'The "Marginal step" column (rate − prior rate) drives the SUMPRODUCT tax formula on Model Inputs.',
        'Last band is open-ended: the upper bound is a sentinel, not a real threshold.',
    ]
    prev_rate = 0.0
    for i, (lower, upper, rate) in enumerate(PIT_BANDS):
        r = 4 + i
        put(ws, f'A{r}', i + 1, fmt=INT, halign='center')
        put(ws, f'B{r}', lower, fmt=MONEY0, halign='right')
        put(ws, f'C{r}', upper, fmt=MONEY0, halign='right')
        put(ws, f'D{r}', rate, fmt=PCT, halign='right')
        put(ws, f'E{r}', rate - prev_rate, fmt=PCT, halign='right')
        note = notes[i] if i < len(notes) else ''
        put(ws, f'F{r}', note, wrap=True)
        prev_rate = rate
    put(ws, 'A13', 'Annual tax formula (used on Model Inputs):', bold=True, border=False)
    put(ws, 'F13', "=SUMPRODUCT(--(taxable>lower bounds),(taxable−lower bounds),marginal steps)", wrap=True, text=True)
    put(ws, 'F14', 'Taxable salary is floored at zero (MAX(0, …)), so deductions can never create negative tax.', wrap=True)
    ws.freeze_panes = 'A4'
    page_setup(ws, landscape=False)
    return ws


def _build_operating_model(wb):
    ws = wb.create_sheet('Operating Model')
    ws.sheet_properties.tabColor = '7F6000'
    widths = dict(A=10, B=14, C=44, D=16, E=16, F=15, G=16, H=13, I=13, J=13, K=60)
    for col, w in widths.items():
        ws.column_dimensions[col].width = w
    put(ws, 'A1', 'Operating Model — 36 months: source actuals, 2026 completion, 2027 forecast (THB)', bold=True, size=14, border=False)
    put(ws, 'A2', 'Each 2026 month self-classifies from the PL!R:AC row 107 salary sentinel: contiguous populated months are Actual, blank months are estimated, a populated month after a blank one is blocked (⚠). '
                  'Estimated months = matching 2025 month × (contiguous 2026 actual YTD ÷ the same months of 2025). 2027 = full-year 2026 × (1+growth) × blended seasonality. '
                  'Other net expenses = revenue − pre-tax − management. Formula key: see the Formula Notes sheet for every formula family used here.', italic=True, border=False)
    headers = ['Date', 'Kind', 'Source', 'Revenue', 'Other net expenses', 'Source management',
               'Source pre-tax profit', 'D&A', 'Interest income', 'Seasonality weight', 'Notes']
    for i, h in enumerate(headers):
        put(ws, f'{get_column_letter(1 + i)}3', h, bold=True, fill=GREY, wrap=True)

    # Detection helpers (rows 42–47). They sum PL / 2025 rows only — never the
    # branching D/E/H cells in rows 16:27 — so no circular reference exists.
    GAP_CNT = 'COUNTIF($B$16:$B$27,"⚠ actual after gap")'
    AC_CNT = 'COUNTIFS($B$16:$B$27,"Actual")'
    ACT_REV = 'SUMIFS(PL!$R$15:$AC$15,PL!$R$107:$AC$107,"<>")'
    ACT_MGMT = 'SUMIFS(PL!$R$107:$AC$107,PL!$R$107:$AC$107,"<>")'
    ACT_PRE = 'SUMIFS(PL!$R$193:$AC$193,PL!$R$107:$AC$107,"<>")'
    ACT_DA = 'SUMIFS(PL!$R$150:$AC$150,PL!$R$107:$AC$107,"<>")'
    DEN_REV = 'SUMIFS($D$4:$D$15,$A$4:$A$15,"<="&DATE(2025,$D$42,1))'
    DEN_EXP = 'SUMIFS($E$4:$E$15,$A$4:$A$15,"<="&DATE(2025,$D$42,1))'

    for p in range(36):  # p=0 → Jan 2025
        r = 4 + p
        year = 2025 + p // 12
        month = p % 12 + 1
        put(ws, f'A{r}', f'=DATE({year},{month},1)', fmt=DATEFMT, fill=GREY, halign='center')
        col25 = get_column_letter(PL_2025_FIRST_COL + month - 1)
        col26 = get_column_letter(PL_2026_FIRST_COL + month - 1)
        if year == 2025:
            kind = 'Actual'
            src = (f'PL!{col25}15 revenue · PL!{col25}107 management · PL!{col25}193 pre-tax '
                   f'· D&A PL!{col25}150 · interest PL!{col25}175')
            put(ws, f'D{r}', f'=PL!{col25}15', fill=GREEN, fmt=MONEY)
            put(ws, f'F{r}', f'=PL!{col25}107', fill=GREEN, fmt=MONEY)
            put(ws, f'G{r}', f'=PL!{col25}193', fill=GREEN, fmt=MONEY)
            put(ws, f'H{r}', f'=IF(PL!{col25}150="",0,PL!{col25}150)', fill=GREEN, fmt=MONEY)
            put(ws, f'I{r}', f'=IF(PL!{col25}175="",0,PL!{col25}175)', fill=GREEN, fmt=MONEY)
            put(ws, f'E{r}', f'=D{r}-G{r}-F{r}', fill=GREEN, fmt=MONEY)
            put(ws, f'J{r}', None, fill=GREY)
            note = 'Imported actual. Other net expenses derived as revenue − pre-tax − management.'
        elif year == 2026:
            # Formula-driven classification from the PL row-107 salary sentinel.
            put(ws, f'B{r}', (f'=IF(COUNTBLANK(PL!$R$107:{col26}$107)>0,'
                              f'IF(PL!{col26}$107="","2026 estimate","⚠ actual after gap"),"Actual")'),
                fill=GREY, halign='center')
            put(ws, f'C{r}', (f'=IF($B{r}="Actual","PL!{col26}15 revenue · PL!{col26}107 management · '
                              f'PL!{col26}193 pre-tax · D&A PL!{col26}150 · interest PL!{col26}175",'
                              f'IF($B{r}="2026 estimate","Detected estimate: 2025 same month × '
                              f'(contiguous 2026 actual YTD ÷ same months of 2025)",'
                              f'"⚠ blocked: PL!{col26}107 is populated after a blank earlier month"))'),
                fill=GREY, wrap=True)
            put(ws, f'D{r}', (f'=IF($B{r}="Actual",PL!{col26}15,IF($B{r}="2026 estimate",'
                              f'IF(OR({GAP_CNT}>0,$D$42=0,$D$45<=0),"⚠ blocked 2026 revenue base — see Model Inputs!C20",'
                              f'D{3 + month}*$D$43/$D$45),"⚠ actual after gap"))'), fill=GREEN, fmt=MONEY)
            put(ws, f'E{r}', (f'=IF($B{r}="Actual",PL!{col26}15-PL!{col26}193-PL!{col26}107,'
                              f'IF($B{r}="2026 estimate",'
                              f'IF(OR({GAP_CNT}>0,$D$42=0,$E$46<=0),"⚠ blocked 2026 other-cost base — see Model Inputs!C20",'
                              f'E{3 + month}*$E$44/$E$46),"⚠ actual after gap"))'), fill=GREEN, fmt=MONEY)
            put(ws, f'F{r}', (f'=IF($B{r}="Actual",PL!{col26}107,IF($B{r}="2026 estimate",'
                              f'{MI_REF("ref_payroll")}+{MI_REF("patcha")},"⚠ actual after gap"))'),
                fill=GREEN, fmt=MONEY)
            put(ws, f'G{r}', (f'=IF($B{r}="Actual",PL!{col26}193,'
                              f'IF(AND(ISNUMBER(D{r}),ISNUMBER(E{r})),D{r}-E{r}-F{r},'
                              f'"⚠ blocked — see this row’s revenue / other-cost cell"))'), fill=GREEN, fmt=MONEY)
            put(ws, f'H{r}', (f'=IF($B{r}="Actual",IF(PL!{col26}150="",0,PL!{col26}150),'
                              f'IF($B{r}="2026 estimate",$H$47,"⚠ actual after gap"))'), fill=GREEN, fmt=MONEY)
            put(ws, f'I{r}', (f'=IF($B{r}="Actual",IF(PL!{col26}175="",0,PL!{col26}175),'
                              f'IF($B{r}="2026 estimate",0,"⚠ actual after gap"))'), fill=GREEN, fmt=MONEY)
            put(ws, f'J{r}', None, fill=GREY)
            put(ws, f'K{r}', (f'=IF($B{r}="Actual","Imported actual, detected from the PL!{col26}107 salary sentinel.",'
                              f'IF($B{r}="2026 estimate","Estimated month: revenue and other net expenses scale the matching 2025 month '
                              f'by (contiguous 2026 actual total ÷ the same months of 2025); management = reference payroll + Patcha; '
                              f'D&A = 2026 actual average; interest = 0.",'
                              f'"⚠ blocked: PL!{col26}107 is populated after a blank earlier month — fill the blank month or clear this one."))'),
                fill=GREY, wrap=True)
            continue
        else:
            kind = '2027 forecast'
            src = 'Scaled 2026 full-year estimate; blended revenue seasonality'
            r25, r26 = 3 + month, 15 + month
            guard = f'OR({GAP_CNT}>0,SUM($D$4:$D$15)<=0,SUM($D$16:$D$27)<=0)'
            put(ws, f'J{r}', (f'=IF({guard},"⚠ fix the 2026 detection warnings first",(1-{MI_REF("blend")})*D{r25}/SUM($D$4:$D$15)'
                             f'+{MI_REF("blend")}*D{r26}/SUM($D$16:$D$27))'), fill=GREEN, fmt=PCT2)
            put(ws, f'D{r}', (f'=IF({guard},"⚠ fix the 2026 detection warnings first",'
                              f'SUM($D$16:$D$27)*(1+{MI_REF("growth")})*J{r})'), fill=GREEN, fmt=MONEY)
            put(ws, f'E{r}', (f'=IF({guard},"⚠ fix the 2026 detection warnings first",'
                              f'SUM($E$16:$E$27)*(1+{MI_REF("cost_growth")})*J{r})'), fill=GREEN, fmt=MONEY)
            put(ws, f'F{r}', f'={MI_REF("ref_payroll")}+{MI_REF("patcha")}', fill=GREEN, fmt=MONEY)
            put(ws, f'G{r}', (f'=IF(AND(ISNUMBER(D{r}),ISNUMBER(E{r})),D{r}-E{r}-F{r},'
                              f'"⚠ blocked — see this row’s revenue / other-cost cell")'), fill=GREEN, fmt=MONEY)
            put(ws, f'H{r}', '=$H$47', fill=GREEN, fmt=MONEY)
            put(ws, f'I{r}', 0, fill=GREEN, fmt=MONEY)
            note = ('Forecast month: weight = (1−blend)×2025 month revenue share + blend×2026 month revenue share; '
                    'revenue = 2026 full-year × (1+growth) × weight; other cost uses its own growth and the same weight.')
        put(ws, f'B{r}', kind, fill=GREY, halign='center')
        put(ws, f'C{r}', src, fill=GREY, wrap=True)
        put(ws, f'K{r}', note, fill=GREY, wrap=True)

    # --------------------------------------------- 2026 detection helpers ---
    put(ws, 'A41', '2026 actual detection — feeds the estimate and 2027 rows (detected from the PL!R:AC row 107 sentinel)',
        bold=True, border=False)
    helpers = [
        (42, 'Contiguous 2026 actual months — COUNTIFS($B$16:$B$27,"Actual")', 'D', f'={AC_CNT}', INT),
        (43, '2026 actual revenue total — SUMIFS over PL!R15:AC15 where the row-107 sentinel is populated', 'D', f'={ACT_REV}', MONEY),
        (44, '2026 actual other net expenses total — actual revenue − management − pre-tax (SUMIFS over PL)', 'E',
            f'={ACT_REV}-{ACT_MGMT}-{ACT_PRE}', MONEY),
        (45, '2025 matching YTD revenue — through DATE(2025,actual months,1)', 'D', f'={DEN_REV}', MONEY),
        (46, '2025 matching YTD other net expenses — through DATE(2025,actual months,1)', 'E', f'={DEN_EXP}', MONEY),
        (47, '2026 actual D&A run rate — AVERAGEIFS-equivalent: SUMIFS ÷ actual months', 'H',
            f'=IF($D$42=0,0,{ACT_DA}/$D$42)', MONEY),
    ]
    for r, label, col, formula, fmt in helpers:
        put(ws, f'C{r}', label, fill=GREY, wrap=True)
        put(ws, f'{col}{r}', formula, fill=GREEN, fmt=fmt, halign='right')

    ws.auto_filter.ref = 'A3:K39'
    ws.freeze_panes = 'D4'
    page_setup(ws)
    # error markers (text in numeric columns) → orange
    ws.conditional_formatting.add('D4:I39', FormulaRule(formula=['NOT(ISNUMBER(D4))'], fill=_fill('FFD966')))
    ws.conditional_formatting.add('J28:J39', FormulaRule(formula=['NOT(ISNUMBER(J28))'], fill=_fill('FFD966')))


MM_HEADERS = [
    ('A', 'Case', None), ('B', 'Date', DATEFMT), ('C', 'Kind', None),
    ('D', 'Revenue', MONEY), ('E', 'Other net expenses', MONEY),
    ('F', 'Source management', MONEY), ('G', 'Source pre-tax profit', MONEY),
    ('H', 'D&A', MONEY), ('I', 'Interest income', MONEY),
    ('J', 'CEO salary', MONEY0), ('K', 'COO salary', MONEY0),
    ('L', 'CEO dividend share', PCT), ('M', 'COO dividend share', PCT),
    ('N', 'Scenario management', MONEY), ('O', 'Scenario pre-tax profit', MONEY),
    ('P', 'Opening tax-loss carry', MONEY), ('Q', 'Taxable profit YTD', MONEY),
    ('R', 'YTD tax liability', MONEY), ('S', 'Corporate tax provision', MONEY),
    ('T', 'After-tax profit', MONEY),
    ('U', 'Opening retained', MONEY), ('V', 'Retained before distributions', MONEY),
    ('W', 'Opening reserve gap', MONEY), ('X', 'Eligible before constraints', MONEY),
    ('Y', 'Eligible before reserve', MONEY), ('Z', 'Reserve allocation', MONEY),
    ('AA', 'Eligible after reserve', MONEY),
    ('AB', 'CEO dividend earned', MONEY), ('AC', 'COO dividend earned', MONEY),
    ('AD', 'Total dividends declared', MONEY),
    ('AE', 'Closing retained', MONEY), ('AF', 'Closing reserve gap', MONEY),
    ('AG', 'CEO dividend paid', MONEY), ('AH', 'COO dividend paid', MONEY),
    ('AI', 'CEO gross salary', MONEY), ('AJ', 'CEO salary tax (month)', MONEY),
    ('AK', 'CEO dividend tax', MONEY), ('AL', 'CEO social security', MONEY),
    ('AM', 'CEO net salary', MONEY), ('AN', 'CEO net dividend', MONEY),
    ('AO', 'CEO take-home', MONEY),
    ('AP', 'COO gross salary', MONEY), ('AQ', 'COO salary tax (month)', MONEY),
    ('AR', 'COO dividend tax', MONEY), ('AS', 'COO social security', MONEY),
    ('AT', 'COO net salary', MONEY), ('AU', 'COO net dividend', MONEY),
    ('AV', 'COO take-home', MONEY),
]


def _build_monthly_model(wb):
    ws = wb.create_sheet('Monthly Model')
    ws.sheet_properties.tabColor = 'BF8F00'
    put(ws, 'A1', 'Monthly Model — six cases × 36 months (Jan 2025 – Dec 2027), mirroring model.simulate / model.personal. '
                  'Every cell is a formula (pale green) — change inputs on Model Inputs only.', bold=True, size=13, border=False)
    for letter, header, _ in MM_HEADERS:
        put(ws, f'{letter}2', header, bold=True, fill=GREY, wrap=True)
        ws.column_dimensions[letter].width = 11 if letter in ('A', 'B') else 13

    ci = {c['id']: i for i, c in enumerate(CASES)}
    for case in CASES:
        base = 3 + ci[case['id']] * 36
        for p in range(36):
            r = base + p
            om = 4 + p
            put(ws, f'A{r}', case['id'], fill=GREY)
            put(ws, f'B{r}', f"='Operating Model'!A{om}", fmt=DATEFMT, fill=GREEN, halign='center')
            put(ws, f'C{r}', f"='Operating Model'!B{om}", fill=GREEN, halign='center')
            for col in 'DEFGHI':
                put(ws, f'{col}{r}', f"='Operating Model'!{col}{om}", fmt=MONEY, fill=GREEN)
            mrow = f"MATCH($A{r},'Model Inputs'!$G$5:$L$5,0)"
            put(ws, f'J{r}', f"=INDEX('Model Inputs'!$G$7:$L$7,{mrow})", fmt=MONEY0, fill=GREEN)
            put(ws, f'K{r}', f"=INDEX('Model Inputs'!$G$8:$L$8,{mrow})", fmt=MONEY0, fill=GREEN)
            put(ws, f'L{r}', f"=INDEX('Model Inputs'!$G$9:$L$9,{mrow})", fmt=PCT, fill=GREEN)
            put(ws, f'M{r}', f"=INDEX('Model Inputs'!$G$10:$L$10,{mrow})", fmt=PCT, fill=GREEN)
            put(ws, f'N{r}', f"=F{r}-{MI_REF('ref_payroll')}+J{r}+K{r}", fmt=MONEY, fill=GREEN)
            put(ws, f'O{r}', f"=G{r}+{MI_REF('ref_payroll')}-J{r}-K{r}", fmt=MONEY, fill=GREEN)
            prev = r - 1
            if p == 0:
                put(ws, f'P{r}', f"={MI_REF('taxloss')}", fmt=MONEY, fill=GREEN)
                put(ws, f'Q{r}', f'=O{r}', fmt=MONEY, fill=GREEN)
                put(ws, f'S{r}', f'=R{r}', fmt=MONEY, fill=GREEN)
                put(ws, f'U{r}', f"=IF({MI_REF('start')}=2025,{MI_REF('opening')},BS!$Q$73)", fmt=MONEY, fill=GREEN)
                put(ws, f'W{r}', f"={MI_REF('reserve')}", fmt=MONEY, fill=GREEN)
                put(ws, f'AG{r}', 0, fmt=MONEY, fill=GREEN)
                put(ws, f'AH{r}', 0, fmt=MONEY, fill=GREEN)
            elif p == 12:
                put(ws, f'P{r}', f"=IF({MI_REF('start')}=2026,{MI_REF('taxloss')},MAX(0,P{prev}-Q{prev}))", fmt=MONEY, fill=GREEN)
                put(ws, f'Q{r}', f'=O{r}', fmt=MONEY, fill=GREEN)
                put(ws, f'S{r}', f'=R{r}', fmt=MONEY, fill=GREEN)
                put(ws, f'U{r}', f"=IF({MI_REF('start')}=2026,{MI_REF('opening')},AE{prev})", fmt=MONEY, fill=GREEN)
                put(ws, f'W{r}', f"=IF({MI_REF('start')}=2026,{MI_REF('reserve')},AF{prev})", fmt=MONEY, fill=GREEN)
                put(ws, f'AG{r}', f"=IF({MI_REF('start')}=2026,0,AB{prev})", fmt=MONEY, fill=GREEN)
                put(ws, f'AH{r}', f"=IF({MI_REF('start')}=2026,0,AC{prev})", fmt=MONEY, fill=GREEN)
            elif p % 12 == 0:  # Jan 2027 (and any later January): continuing year boundary
                put(ws, f'P{r}', f'=MAX(0,P{prev}-Q{prev})', fmt=MONEY, fill=GREEN)
                put(ws, f'Q{r}', f'=O{r}', fmt=MONEY, fill=GREEN)
                put(ws, f'S{r}', f'=R{r}', fmt=MONEY, fill=GREEN)
                put(ws, f'U{r}', f'=AE{prev}', fmt=MONEY, fill=GREEN)
                put(ws, f'W{r}', f'=AF{prev}', fmt=MONEY, fill=GREEN)
                put(ws, f'AG{r}', f'=AB{prev}', fmt=MONEY, fill=GREEN)
                put(ws, f'AH{r}', f'=AC{prev}', fmt=MONEY, fill=GREEN)
            else:
                put(ws, f'P{r}', f'=P{prev}', fmt=MONEY, fill=GREEN)
                put(ws, f'Q{r}', f'=Q{prev}+O{r}', fmt=MONEY, fill=GREEN)
                put(ws, f'S{r}', f'=R{r}-R{prev}', fmt=MONEY, fill=GREEN)
                put(ws, f'U{r}', f'=AE{prev}', fmt=MONEY, fill=GREEN)
                put(ws, f'W{r}', f'=AF{prev}', fmt=MONEY, fill=GREEN)
                put(ws, f'AG{r}', f'=AB{prev}', fmt=MONEY, fill=GREEN)
                put(ws, f'AH{r}', f'=AC{prev}', fmt=MONEY, fill=GREEN)
            put(ws, f'R{r}', f"=MAX(0,Q{r}-P{r})*{MI_REF('cit')}", fmt=MONEY, fill=GREEN)
            put(ws, f'T{r}', f'=O{r}-S{r}', fmt=MONEY, fill=GREEN)
            put(ws, f'V{r}', f'=U{r}+T{r}', fmt=MONEY, fill=GREEN)
            put(ws, f'X{r}', f'=IF(O{r}>0,MAX(0,T{r}),0)', fmt=MONEY, fill=GREEN)
            put(ws, f'Y{r}', f"=IF({MI_REF('constrained')}=1,MIN(X{r},MAX(0,V{r})),X{r})", fmt=MONEY, fill=GREEN)
            put(ws, f'Z{r}', f"=IF({MI_REF('constrained')}=1,MIN(W{r},Y{r}*{MI_REF('reserve_rate')}),0)", fmt=MONEY, fill=GREEN)
            put(ws, f'AA{r}', f'=Y{r}-Z{r}', fmt=MONEY, fill=GREEN)
            put(ws, f'AB{r}', f'=AA{r}*L{r}', fmt=MONEY, fill=GREEN)
            put(ws, f'AC{r}', f'=AA{r}*M{r}', fmt=MONEY, fill=GREEN)
            put(ws, f'AD{r}', f'=AB{r}+AC{r}', fmt=MONEY, fill=GREEN)
            put(ws, f'AE{r}', f'=V{r}-Z{r}-AD{r}', fmt=MONEY, fill=GREEN)
            put(ws, f'AF{r}', f'=W{r}-Z{r}', fmt=MONEY, fill=GREEN)
            put(ws, f'AI{r}', f'=J{r}', fmt=MONEY, fill=GREEN)
            put(ws, f'AJ{r}', f"=INDEX('Model Inputs'!$G$15:$L$15,{mrow})/12", fmt=MONEY, fill=GREEN)
            put(ws, f'AK{r}', f"=AG{r}*{MI_REF('withholding')}", fmt=MONEY, fill=GREEN)
            put(ws, f'AL{r}', f"={MI_REF('ssc')}", fmt=MONEY, fill=GREEN)
            put(ws, f'AM{r}', f'=AI{r}-AJ{r}-AL{r}', fmt=MONEY, fill=GREEN)
            put(ws, f'AN{r}', f'=AG{r}-AK{r}', fmt=MONEY, fill=GREEN)
            put(ws, f'AO{r}', f'=AM{r}+AN{r}', fmt=MONEY, fill=GREEN)
            put(ws, f'AP{r}', f'=K{r}', fmt=MONEY, fill=GREEN)
            put(ws, f'AQ{r}', f"=INDEX('Model Inputs'!$G$16:$L$16,{mrow})/12", fmt=MONEY, fill=GREEN)
            put(ws, f'AR{r}', f"=AH{r}*{MI_REF('withholding')}", fmt=MONEY, fill=GREEN)
            put(ws, f'AS{r}', f"={MI_REF('ssc')}", fmt=MONEY, fill=GREEN)
            put(ws, f'AT{r}', f'=AP{r}-AQ{r}-AS{r}', fmt=MONEY, fill=GREEN)
            put(ws, f'AU{r}', f'=AH{r}-AR{r}', fmt=MONEY, fill=GREEN)
            put(ws, f'AV{r}', f'=AT{r}+AU{r}', fmt=MONEY, fill=GREEN)

    ws.auto_filter.ref = 'A2:AV218'
    ws.freeze_panes = 'D3'
    page_setup(ws, fit_width=False, title_rows='1:2')
    ws.conditional_formatting.add('O3:O218', CellIsRule(operator='lessThan', formula=['0'],
                                                        fill=_fill(LOSS_FILL), font=Font(color=LOSS_FONT)))
    return ws


def _build_case_summary(wb):
    ws = wb.create_sheet('Case Summary')
    ws.sheet_properties.tabColor = 'C55A11'
    for col, w in dict(A=3, B=44, C=64, D=17, E=17, F=17, G=17, H=17, I=17, J=9).items():
        ws.column_dimensions[col].width = w
    put(ws, 'B1', 'Case Summary — the 36 app metrics for all six cases over the selected period (THB)', bold=True, size=14, border=False)
    put(ws, 'B2', 'Period follows the Model Inputs dropdown. Ratios show N/A when their denominator is not positive.', italic=True, border=False)

    put(ws, 'B3', 'Selected period', bold=True, fill=GREY)
    put(ws, 'C3', "='Model Inputs'!$C$5", fill=BLUE)
    put(ws, 'B4', 'Period start', bold=True, fill=GREY)
    put(ws, 'C4', ('=IF($C$3="2025 historical simulation",DATE(2025,1,1),'
                   'IF($C$3="2026 actual months",DATE(2026,1,1),'
                   'IF($C$3="2026 full-year estimate",DATE(2026,1,1),DATE(2027,1,1))))'),
        fmt=DATEFMT, fill=GREEN, halign='center')
    put(ws, 'B5', 'Period end', bold=True, fill=GREY)
    put(ws, 'C5', ('=IF($C$3="2025 historical simulation",DATE(2025,12,1),'
                   "IF($C$3=\"2026 actual months\",'Model Inputs'!$C$20,"
                   'IF($C$3="2026 full-year estimate",DATE(2026,12,1),DATE(2027,12,1))))'),
        fmt=DATEFMT, fill=GREEN, halign='center')
    put(ws, 'D3', 'Note', bold=True, fill=GREY)
    put(ws, 'E3', '“2026 actual months” runs January 2026 through the latest detected actual month (Model Inputs!C20, detected from PL!R:AC); '
                  'the full-year estimate adds the modeled completion months. When C20 is a ⚠ warning it is copied here and every metric below shows N/A.',
        wrap=True, border=False)
    ws.merge_cells('E3:I3')

    for i, case in enumerate(CASES):
        col = get_column_letter(4 + i)
        put(ws, f'{col}7', case['id'], fill=GREY, italic=True, size=9, halign='center')
        put(ws, f'{col}8', case['label'], bold=True, fill=GREY, wrap=True, halign='center')
    put(ws, 'B8', 'Metric', bold=True, fill=GREY)
    put(ws, 'C8', 'Definition · effect', bold=True, fill=GREY)
    put(ws, 'J8', 'Unit', bold=True, fill=GREY, halign='center')

    MMQ = "'Monthly Model'"
    ids = {c['id']: get_column_letter(4 + i) for i, c in enumerate(CASES)}

    def sumifs(col, case_id, date_only=True, op='range'):
        dcol = ids[case_id]
        base = (f"SUMIFS({MMQ}!${col}$3:${col}$218,{MMQ}!$A$3:$A$218,{dcol}$7,"
                f"{MMQ}!$B$3:$B$218,\">=\"&$C$4,{MMQ}!$B$3:$B$218,\"<=\"&$C$5)")
        if op == 'start':
            return (f"SUMIFS({MMQ}!${col}$3:${col}$218,{MMQ}!$A$3:$A$218,{dcol}$7,"
                    f"{MMQ}!$B$3:$B$218,\"=\"&$C$4)")
        if op == 'end':
            return (f"SUMIFS({MMQ}!${col}$3:${col}$218,{MMQ}!$A$3:$A$218,{dcol}$7,"
                    f"{MMQ}!$B$3:$B$218,\"=\"&$C$5)")
        return base

    def countifs(case_id, extra=''):
        dcol = ids[case_id]
        return (f"COUNTIFS({MMQ}!$A$3:$A$218,{dcol}$7,"
                f"{MMQ}!$B$3:$B$218,\">=\"&$C$4,{MMQ}!$B$3:$B$218,\"<=\"&$C$5{extra})")

    DEFS = {
        'Months': ('Modeled months in the selected period; all per-month metrics divide by this.', 'count'),
        'Revenue': ('SUMIFS of Monthly Model revenue (Operating Model link).', 'money'),
        'Other net expenses': ('SUMIFS of other net expenses (revenue − pre-tax − management).', 'money'),
        'Management expense': ('Scenario management: source management − reference payroll + CEO + COO salaries.', 'money'),
        'Executive payroll': ('CEO + COO salaries actually paid in the period (scenario payroll).', 'money'),
        'Payroll saved vs salary-only reference': ('Reference payroll (฿1,000,000/month) × months − executive payroll.', 'money'),
        'Pre-tax profit': ('Scenario pre-tax: source pre-tax + reference payroll − CEO − COO salaries.', 'money'),
        'EBITDA': ('Pre-tax profit + D&A − interest income.', 'money'),
        'Pre-tax margin': ('Pre-tax profit ÷ revenue; N/A unless revenue is positive.', 'percent'),
        'Corporate tax provision': ('Monthly provisions: MAX(0, taxable YTD − loss carry) × CIT, differenced month by month.', 'money'),
        'After-tax profit': ('Pre-tax profit − corporate tax provision.', 'money'),
        'After-tax margin': ('After-tax profit ÷ revenue; N/A unless revenue is positive.', 'percent'),
        'Legal reserve allocation': ('Reserve funded in constrained mode (≤5% of eligible profit, ≤ remaining gap).', 'money'),
        'Dividends declared': ('CEO + COO dividends earned on eligible profit in the period.', 'money'),
        'Effective payout ratio': ('Dividends declared ÷ after-tax profit; N/A unless after-tax profit is positive.', 'percent'),
        'Dividends received': ('Dividends actually paid (prior month’s earned dividend, 10% withheld).', 'money'),
        'Ending dividend payable': ('Last month’s earned dividend — paid the following month.', 'money'),
        'Earnings kept': ('After-tax profit − dividends declared.', 'money'),
        'Change in unappropriated retained earnings': ('After-tax profit − reserve allocation − dividends declared.', 'money'),
        'Opening unappropriated retained earnings': ('Closing retained column at the period’s first month.', 'money'),
        'Closing unappropriated retained earnings': ('Closing retained column at the period’s last month.', 'money'),
        'Loss months': ('Months with negative scenario pre-tax profit.', 'count'),
        'CEO gross salary': ('Monthly CEO salary × months.', 'money'),
        'CEO gross dividends': ('Dividends paid to the CEO in the period (one-month lag).', 'money'),
        'CEO Thai salary tax': ('Annual Thai salary tax ÷ 12, withheld monthly.', 'money'),
        'CEO Thai dividend tax': ('10% final withholding on dividends paid.', 'money'),
        'CEO social security': ('Monthly employee SSC × months.', 'money'),
        'CEO take-home after Thai tax': ('Net salary + net dividends per month, summed.', 'money'),
        'CEO average monthly take-home': ('CEO take-home ÷ months.', 'money'),
        'COO gross salary': ('Monthly COO salary × months.', 'money'),
        'COO gross dividends': ('Dividends paid to the COO in the period (one-month lag).', 'money'),
        'COO Thai salary tax': ('Annual Thai salary tax ÷ 12, withheld monthly.', 'money'),
        'COO Thai dividend tax': ('10% final withholding on dividends paid.', 'money'),
        'COO social security': ('Monthly employee SSC × months.', 'money'),
        'COO take-home after Thai tax': ('Net salary + net dividends per month, summed.', 'money'),
        'COO average monthly take-home': ('COO take-home ÷ months.', 'money'),
    }

    for i, (label, unit) in enumerate(SUMMARY_METRICS):
        r = 9 + i
        put(ws, f'B{r}', label, fill=GREY, wrap=True)
        put(ws, f'C{r}', DEFS[label][0], fill=GREY, wrap=True)
        put(ws, f'J{r}', unit, fill=GREY, halign='center', italic=True, size=9)
        for case in CASES:
            col = ids[case['id']]
            cid = case['id']
            cell = f'{col}{r}'
            months = f'{col}$9'
            months2 = months
            rev, pretax = f'{col}$10', f'{col}$15'
            after = f'{col}$19'
            after2 = after
            declared = f'{col}$22'
            reserve_c = f'{col}$21'
            takehome_ceo, takehome_coo = f'{col}$36', f'{col}$43'
            if label == 'Months':
                f = f'={countifs(cid)}'
            elif label == 'Revenue':
                f = f'={sumifs("D", cid)}'
            elif label == 'Other net expenses':
                f = f'={sumifs("E", cid)}'
            elif label == 'Management expense':
                f = f'={sumifs("N", cid)}'
            elif label == 'Executive payroll':
                f = f'={sumifs("J", cid)}+{sumifs("K", cid)}'
            elif label == 'Payroll saved vs salary-only reference':
                f = f"={MI_REF('ref_payroll')}*{months}-({sumifs('J', cid)}+{sumifs('K', cid)})"
            elif label == 'Pre-tax profit':
                f = f'={sumifs("O", cid)}'
            elif label == 'EBITDA':
                f = f'={pretax}+{sumifs("H", cid)}-{sumifs("I", cid)}'
            elif label == 'Pre-tax margin':
                f = f'=IF({rev}>0,{pretax}/{rev},"N/A")'
            elif label == 'Corporate tax provision':
                f = f'={sumifs("S", cid)}'
            elif label == 'After-tax profit':
                f = f'={sumifs("T", cid)}'
            elif label == 'After-tax margin':
                f = f'=IF({rev}>0,{after}/{rev},"N/A")'
            elif label == 'Legal reserve allocation':
                f = f'={sumifs("Z", cid)}'
            elif label == 'Dividends declared':
                f = f'={sumifs("AD", cid)}'
            elif label == 'Effective payout ratio':
                f = f'=IF({after}>0,{declared}/{after},"N/A")'
            elif label == 'Dividends received':
                f = f'={sumifs("AG", cid)}+{sumifs("AH", cid)}'
            elif label == 'Ending dividend payable':
                f = f'={sumifs("AB", cid, op="end")}+{sumifs("AC", cid, op="end")}'
            elif label == 'Earnings kept':
                f = f'={after}-{declared}'
            elif label == 'Change in unappropriated retained earnings':
                f = f'={after2}-{reserve_c}-{declared}'
            elif label == 'Opening unappropriated retained earnings':
                f = f'={sumifs("U", cid, op="start")}'
            elif label == 'Closing unappropriated retained earnings':
                f = f'={sumifs("AE", cid, op="end")}'
            elif label == 'Loss months':
                f = f'={countifs(cid, extra=",\'Monthly Model\'!$O$3:$O$218,\"<0\"")}'
            elif label == 'CEO gross salary':
                f = f'={sumifs("AI", cid)}'
            elif label == 'CEO gross dividends':
                f = f'={sumifs("AG", cid)}'
            elif label == 'CEO Thai salary tax':
                f = f'={sumifs("AJ", cid)}'
            elif label == 'CEO Thai dividend tax':
                f = f'={sumifs("AK", cid)}'
            elif label == 'CEO social security':
                f = f'={sumifs("AL", cid)}'
            elif label == 'CEO take-home after Thai tax':
                f = f'={sumifs("AO", cid)}'
            elif label == 'CEO average monthly take-home':
                f = f'=IF({months2}=0,"N/A",{takehome_ceo}/{months2})'
            elif label == 'COO gross salary':
                f = f'={sumifs("AP", cid)}'
            elif label == 'COO gross dividends':
                f = f'={sumifs("AH", cid)}'
            elif label == 'COO Thai salary tax':
                f = f'={sumifs("AQ", cid)}'
            elif label == 'COO Thai dividend tax':
                f = f'={sumifs("AR", cid)}'
            elif label == 'COO social security':
                f = f'={sumifs("AS", cid)}'
            elif label == 'COO take-home after Thai tax':
                f = f'={sumifs("AV", cid)}'
            elif label == 'COO average monthly take-home':
                f = f'=IF({months2}=0,"N/A",{takehome_coo}/{months2})'
            fmt = {'money': MONEY, 'percent': PCT, 'count': INT}[unit]
            # A non-date period end (⚠ warning) must never show plausible totals.
            f = f'=IF(NOT(ISNUMBER($C$5)),"N/A",{f[1:]})'
            put(ws, cell, f, fmt=fmt, fill=GREEN, halign='right')

    ws.freeze_panes = 'D9'
    page_setup(ws)
    return ws


def _build_formula_notes(wb):
    ws = wb.create_sheet('Formula Notes')
    ws.sheet_properties.tabColor = '7030A0'
    for col, w in dict(A=30, B=64, C=34, D=40, E=40, F=44).items():
        ws.column_dimensions[col].width = w
    put(ws, 'A1', 'Formula Notes — dictionary of every new formula family and each UDF translation', bold=True, size=14, border=False)
    put(ws, 'A2', 'One row per formula family. Model formulas reference Model Inputs / Tax Tables cells; no constant is embedded in a model formula.', italic=True, border=False)
    for col, h in zip('ABCDEF', ['Sheet / column', 'Formula template', 'Inputs referenced',
                                 'Why it is used', 'Effect on the model', 'Edge cases']):
        put(ws, f'{col}4', h, bold=True, fill=GREY, wrap=True)

    rows = [
        # --- source UDF translations ---
        ('IncomeStatement D/F (was MTD)',
         '=IFERROR(INDEX(PL!$D:$D,MATCH($A9,PL!$A:$A,0)),SUMIFS(PL!$D:$D,PL!$A:$A,$A9))',
         'Row’s report code (col A); PL columns D/F (current/prior month)',
         'Replaces the VBA MTD($D$7) macro lookup with a standard lookup of the row’s code in PL.',
         'Same month-actual value the macro returned; PL’s current month column is pinned to the reported month.',
         'Codes stored as text in IncomeStatement but numeric in PL (41210, 41400, 49980, 53029.01) fall through MATCH to the SUMIFS fallback, which matches numbers-as-text; T-NInc/T-NExp match PL’s T-Ninc/T-Nexp case-insensitively. Unknown codes return 0.'),
        ('IncomeStatement K/M (was YTD_CY_Sum / YTD_LY_Sum)',
         '=IFERROR(INDEX(PL!$K:$K,MATCH($A9,PL!$A:$A,0)),SUMIFS(PL!$K:$K,PL!$A:$A,$A9))',
         'Row’s report code; PL columns K/M (current/prior YTD)',
         'Replaces the VBA YTD macros with the same standard lookup pattern.',
         'Year-to-date subtotals identical to the macro output.',
         'Same text/numeric fallback as the MTD translation.'),
        ('IncomeStatement I/P, COGS M/R, PL I/P (was VarPercent)',
         '=IF(OR(prev=0,prev=""),IF(OR(cur=0,cur=""),0,1),cur/prev-1)',
         'Current and prior cells in the same row',
         'Replaces the VBA VarPercent macro with plain arithmetic.',
         'Both blank/zero → 0; positive current with zero/blank prior → +100%; otherwise cur÷prev−1 (works for negatives).',
         'Blank cells coerce to 0 in comparisons. PL!I158 is frozen to its cached 1: its prior-year cell was updated after the workbook’s last full recalculation, so the cache shows the stale +100% while the ratio rule now yields +11,227%; every other VarPercent cell reproduces its cache exactly.'),
        # --- Operating Model ---
        ('Operating Model B16:B27 — 2026 actual-month detection',
         '=IF(COUNTBLANK(PL!$R$107:AC107)>0,IF(PL!AC107="","2026 estimate","⚠ actual after gap"),"Actual")',
         'PL!R:AC row 107 (Salary - Management) monthly detail cells — the actual-month sentinel',
         'Detect which 2026 months are actual: row 107 is blank in unreported months, while subtotal rows 15/150/193 already contain zero-returning formulas and cannot be used.',
         'Each 2026 row self-classifies; newly pasted contiguous months flip to Actual and automatically change the 2026 completion, the 2027 forecast and the Case Summary period end.',
         'A populated month after a blank one yields ⚠ actual after gap — the import error stays visible instead of being reordered, skipped or silently treated as actual.'),
        ('Operating Model rows 42–47 — detection helpers',
         'D42: =COUNTIFS($B$16:$B$27,"Actual") · D43: =SUMIFS(PL!$R$15:$AC$15,PL!$R$107:$AC$107,"<>") · D45: =SUMIFS($D$4:$D$15,$A$4:$A$15,"<="&DATE(2025,$D$42,1)) · H47: =IF($D$42=0,0,SUMIFS(PL!$R$150:$AC$150,PL!$R$107:$AC$107,"<>")/$D$42)',
         'Kind cells B16:B27; PL!R:AC detail rows 15/107/150/193; 2025 date column A4:A15',
         'Centralize the actual count, the 2026 actual totals, the matching 2025 YTD denominators (ending at DATE(2025,actual_count,1)) and the actual-only D&A run rate.',
         'Estimate and 2027 rows reference these cells; the helpers sum PL and 2025 rows only, so no circular reference with the branching D/E/H cells exists.',
         'E44 (other net expenses total) = actual revenue − management − pre-tax over PL, the same identity as the row-level E column.'),
        ('Operating Model D/F/G/H/I — actual months',
         '=IF($B16="Actual",PL!R15,…) · =IF($B16="Actual",PL!R107,…) · =IF($B16="Actual",PL!R193,…) · =IF($B16="Actual",IF(PL!R150="",0,PL!R150),…)',
         'PL rows 15 (revenue), 107 (Salary - Management), 193 (Pretax Income), 150 (D&A), 175 (Interest income); columns AG:AR (2025), R:AC (2026, gated by the Kind branch)',
         'Import the workbook actuals into the model without retyping them.',
         'Actual months stay live-linked to the original statements; pasting a new month into PL!R:AC flows through automatically.',
         'D&A/interest blanks (unreported months) become 0 via the IF-“” guard, matching model.load_history.'),
        ('Operating Model E — other net expenses',
         '=D4-G4-F4 (2025) · =IF($B16="Actual",PL!R15-PL!R193-PL!R107,…) (2026)',
         'Revenue, source pre-tax, source management of the same row',
         'Back out the residual operating cost the way model.load_history does.',
         'Other net expenses hold benefits and absorbed tax that the compensation scenarios do not change.',
         'The 2026 branch reads PL directly so E never references the G branch (no circular chain).'),
        ('Operating Model D/E — estimated 2026 months',
         '=IF($B20="2026 estimate",IF(OR(COUNTIF($B$16:$B$27,"⚠ actual after gap")>0,$D$42=0,$D$45<=0),"⚠ …",D8*$D$43/$D$45),…)',
         'Matching 2025 month; helper cells D42/D43/D45 (actual count, 2026 actual total, 2025 YTD through DATE(2025,count,1))',
         'Complete 2026 the way model.forecast does: same-month 2025 × (contiguous 2026 actual total ÷ the same months of 2025).',
         'Full-year 2026 becomes the base for the 2027 forecast and seasonality; newly pasted actuals shrink the estimated tail automatically.',
         'A gap, zero actual months or a non-positive 2025 YTD base shows an explicit ⚠ marker instead of a silent plausible zero.'),
        ('Operating Model F/G — forecast management & pre-tax',
         "='Model Inputs'!$B$25+'Model Inputs'!$C$18 · =IF(AND(ISNUMBER(D20),ISNUMBER(E20)),D20-E20-F20,\"⚠ …\")",
         'Reference payroll (B25) and Patcha input (C18)',
         'Forecast months carry management = two reference salaries + Patcha.',
         'Keeps management cost consistent between the estimated 2026 months and 2027.',
         'Reference payroll itself is =B23+B24 (500,000 + 500,000).'),
        ('Operating Model H/I — forecast D&A and interest',
         '=$H$47 · 0',
         'H47: actual-only 2026 D&A run rate (SUMIFS over PL!R150:AC150 ÷ actual months)',
         'model.forecast carries the detected-actual D&A run-rate and assumes no forecast interest income.',
         'EBITDA in Case Summary uses these columns; the same run rate feeds every estimated 2026 and 2027 row.',
         'With no detected actual months H47 is 0.'),
        ('Operating Model J/D/E — 2027 seasonality, revenue, other cost',
         '=IF(OR(COUNTIF($B$16:$B$27,"⚠ actual after gap")>0,SUM($D$4:$D$15)<=0,SUM($D$16:$D$27)<=0),"⚠ …",(1-blend)*D4/SUM($D$4:$D$15)+blend*D16/SUM($D$16:$D$27)) · =SUM($D$16:$D$27)*(1+growth)*J28',
         '2025 and full-2026 monthly revenue; growth, cost-growth and blend inputs',
         'Blend the two years’ normalized revenue seasonality, then scale the completed 2026 year.',
         '2027 months keep the real seasonal shape instead of a flat 1/12 spread.',
         'A 2026 import gap, or non-positive 2025/2026 totals, raises the explicit ⚠ marker in J, D and E.'),
        # --- Model Inputs case table ---
        ('Model Inputs rows 11/12 — share checks',
         '=G9+G10 · =1-G9-G10 (per case column G:L)',
         'Case dividend shares (rows 9–10)',
         'Expose combined and residual eligible-profit shares.',
         'Combined share feeds validation (≤100%); residual is what stays in the company.',
         'Residual goes negative if shares exceed 100% — the G18 check flags it.'),
        ('Model Inputs rows 13/14 — annual taxable salary',
         '=MAX(0,G7*12-MIN(G7*12*$B$29,$B$30)-$B$31-$C$12-$C$13*12)',
         'Monthly salary ×12; 50% salary deduction capped at ฿100,000; ฿60,000 allowance; extra deductions; monthly SSC ×12',
         'model.thai_salary_tax base for each executive.',
         'Higher salaries pay tax on a smaller fraction due to the cap.',
         'MAX(0,…) floors the base; zeros are legitimate.'),
        ('Model Inputs rows 15/16 — annual Thai salary tax',
         "=SUMPRODUCT(--(G13>'Tax Tables'!$B$4:$B$11),(G13-'Tax Tables'!$B$4:$B$11),'Tax Tables'!$E$4:$E$11)",
         'Taxable salary; Tax Tables lower bounds and marginal steps',
         'Progressive tax over the eight Thai bands without nested IFs.',
         'Identical to model.progressive; Monthly Model divides by 12.',
         'Band slices above the income multiply by a zero (income>lower) flag.'),
        ('Model Inputs C20 — latest detected 2026 actual month',
         '=IF(COUNTIF(\'Operating Model\'!$B$16:$B$27,"⚠ actual after gap")>0,"⚠ …",IF(COUNTIFS(\'Operating Model\'!$B$16:$B$27,"Actual")=0,"⚠ …",DATE(2026,COUNTIFS(\'Operating Model\'!$B$16:$B$27,"Actual"),1)))',
         'Operating Model Kind cells B16:B27',
         'Surface the detected actual period: the date of the contiguous-actual count, or a visible warning.',
         'Case Summary C5 copies this cell for the “2026 actual months” period end, so pasting new PL months moves the period automatically.',
         'No actuals or an after-gap marker each produce their own ⚠ text; a broken import can never display plausible zero totals.'),
        # --- Monthly Model ---
        ('Monthly Model J..M — case lookups',
         "=INDEX('Model Inputs'!$G$7:$L$7,MATCH($A3,'Model Inputs'!$G$5:$L$5,0))",
         'Case ID column A; Model Inputs case table',
         'Pull each case’s two salaries and two shares by ID.',
         'Editing a yellow case cell flows to all 36 months of that case.',
         'Case IDs are unique; nothing is embedded in the monthly rows.'),
        ('Monthly Model N/O — scenario management & pre-tax',
         "=F3-'Model Inputs'!$B$25+J3+K3 · =G3+'Model Inputs'!$B$25-J3-K3",
         'Source management/pre-tax (Operating Model), reference payroll, case salaries',
         'Swap the reference ฿1,000,000 payroll for the case salaries.',
         'This is the salary-expense effect: salaries reduce pre-tax profit when earned (before corporate tax), unlike dividends which distribute after-tax profit.',
         'Sums to the same total payroll when salaries equal the reference.'),
        ('Monthly Model P/Q/R/S — corporate tax provision',
         'P: =prior P (Jan: tax-loss input; year boundary: MAX(0, prior carry − prior-year taxable YTD)) · Q: =Q+O (Jan: =O) · R: =MAX(0,Q-P)*CIT · S: =R-R(prior)',
         'Scenario pre-tax, carryforward, corporate tax rate',
         'Reproduce model.simulate’s year-to-date liability with monthly differencing.',
         'Loss months automatically reverse earlier provisions (S<0) because YTD liability falls; January resets YTD and accrued tax.',
         'At a continuing year boundary the carry absorbs the prior year’s taxable profit, floored at 0. When the start year is 2026, January 2026 resets the carry to the verified input instead.'),
        ('Monthly Model U/V — retained earnings',
         'U: first month = IF(start=2025, opening input, BS!Q73); Jan 2026 = IF(start=2026, opening input, prior AE); else =AE(prior) · V: =U+T',
         'Opening retained input, BS!Q73, prior closing retained, after-tax profit',
         'Roll unappropriated retained earnings forward.',
         'With a 2026 start, January 2026 RESETS retained earnings to the selected opening (BS!D73 default) — the 2025 comparison run never contaminates the 2026 timeline. Retained before distributions (V) is what the constrained mode checks.',
         '2025 rows in a 2026-start scenario are an independent comparison simulation.'),
        ('Monthly Model W/X/Y/Z/AA — eligibility & reserve',
         'X: =IF(O>0,MAX(0,T),0) · Y: =IF(constrained=1,MIN(X,MAX(0,V)),X) · Z: =IF(constrained=1,MIN(W,Y*5%),0) · AA: =Y-Z',
         'After-tax profit, pre-tax profit, retained before distributions, reserve gap, reserve rate',
         'Economic mode pays from current positive profit only; constrained mode also caps by non-negative retained earnings and funds the legal reserve (≤5% of eligible, ≤ remaining gap).',
         'Constrained months can declare less than economic months; the reserve gap shrinks as it is funded.',
         'Economic mode leaves Z at 0 and never touches the gap.'),
        ('Monthly Model AB..AF — dividends declared',
         'AB: =AA*L · AC: =AA*M · AD: =AB+AC · AE: =V-Z-AD · AF: =W-Z',
         'Eligible profit after reserve; case shares; retained; reserve',
         'Declare each executive’s share of eligible profit and close retained earnings and the reserve gap.',
         'Only the declared share (not 17% equity) is paid; residual eligible profit stays in the company.',
         'Zero eligible profit → zero declarations even in economic mode.'),
        ('Monthly Model AG/AH — dividends paid (one-month lag)',
         'AG: first month 0; Jan 2026 (start 2026) 0; else =AB(prior)',
         'Prior month’s earned dividend',
         'Pay dividends one month after they are earned, as model.simulate does.',
         'December’s earned dividend remains payable at period end (ending dividend payable metric).',
         'A start-year reset (2026) zeroes January’s payment because the timeline restarts.'),
        ('Monthly Model AJ/AQ — monthly salary tax',
         "=INDEX('Model Inputs'!$G$15:$L$15,MATCH($A3,'Model Inputs'!$G$5:$L$5,0))/12",
         'Annual Thai salary tax from the case table',
         'model.personal withholds 1/12 of the full-year salary tax every month.',
         'Smooths the progressive bands across the year (slightly front-loads vs true monthly basis).',
         'Constant within a case; changes when the yellow salary cells change.'),
        ('Monthly Model AK/AL/AM/AO — dividend tax, SSC, nets, take-home',
         'AK: =AG*10% · AL: =SSC input · AM: =AI-AJ-AL · AN: =AG-AK · AO: =AM+AN',
         'Dividends paid, withholding rate, SSC, salary, tax',
         'Per-executive Thai cash view.',
         'Take-home = net salary + net dividends, per month and summed in Case Summary.',
         'Zero-Salary cases (none by default) would still show dividend flow.'),
        # --- Case Summary ---
        ('Case Summary — period totals',
         "=SUMIFS('Monthly Model'!$D$3:$D$218,'Monthly Model'!$A$3:$A$218,D$7,'Monthly Model'!$B$3:$B$218,\">=\"&$C$4,…)",
         'Monthly Model columns; case IDs; period start/end (derived from the period dropdown via DATE())',
         'Aggregate each metric for the selected period without array formulas.',
         'Changing the dropdown re-baselines every metric; “2026 actual months” ends at Model Inputs!C20 (the detected actual month) so modeled completion months are excluded. Every metric is wrapped in IF(NOT(ISNUMBER($C$5)),"N/A",…) — when C20 carries a ⚠ warning (gap / no actuals) the whole table shows N/A instead of plausible zero totals.',
         'Empty periods return 0; ratios guard their denominators and show N/A.'),
        ('Case Summary — margins & payout',
         '=IF(revenue>0,pretax/revenue,"N/A") · =IF(after_cit>0,declared/after_cit,"N/A")',
         'Same-column period totals',
         'Avoid fake 0% ratios on empty or negative denominators.',
         'Matches model.summarize_case (None when denominator ≤ 0).',
         'N/A cells are text in a percent column — intentional.'),
        ('Case Summary — opening/closing retained, ending payable',
         '=SUMIFS(U …,\"=\"&$C$4) · =SUMIFS(AE …,\"=\"&$C$5) · =SUMIFS(AB …,\"=\"&$C$5)+SUMIFS(AC …,\"=\"&$C$5)',
         'Monthly Model state columns at exact period boundary dates',
         'Read state at the period’s first and last month row.',
         'Opening + retained change reconciles to closing (retained-earnings reconciliation: after-tax − reserve − declared).',
         'One row per case-month guarantees single-row SUMIFS.'),
        ('Case Summary — payroll saved, EBITDA, monthly take-home',
         "=ref_payroll*months-exec payroll · =pretax+SUMIFS(D&A)-SUMIFS(interest) · =IF(months=0,\"N/A\",take_home/months)",
         'Reference payroll, months, payroll totals, D&A, interest, take-home',
         'Mirror model.summarize_case’s derived metrics.',
         'Payroll saved quantifies the salary-expense swap vs the salary-only reference.',
         'Months=0 shows N/A instead of #DIV/0!.'),
    ]
    r = 5
    for row in rows:
        for col, val in zip('ABCDEF', row):
            put(ws, f'{col}{r}', val, fill=GREY if col in 'AC' else None, wrap=True, halign='left', text=True)
        ws.row_dimensions[r].height = max(42, 11 * (max(len(x) for x in row) // 45))
        r += 1
    put(ws, f'A{r + 1}', 'Narrative', bold=True, size=12, border=False)
    narrative = [
        ('Salary expense vs dividend distribution', 'Salaries are employment expense: they reduce pre-tax profit and therefore corporate tax, the same month they are earned. Dividends distribute AFTER-TAX profit and carry 10% Thai withholding for each executive; they never change the corporate-tax base.'),
        ('One-month dividend payment lag', 'Dividends are earned (declared) on the month’s eligible profit but paid the following month. In a December-ending period the last earned dividend is still payable — see “Ending dividend payable”.'),
        ('Tax provision reversals', 'The corporate provision is computed on year-to-date taxable profit, so a loss month reduces YTD liability and the monthly provision (S) goes negative, reversing earlier charges. January resets both YTD and accrued liability.'),
        ('Constrained vs economic availability', 'Economic allocation declares the case shares of any positive after-tax profit. The constrained mode first caps eligible profit by non-negative retained earnings, then allocates the lesser of the remaining reserve gap or 5% of that profit to the legal reserve; only the remainder can be declared.'),
        ('Forecast scaling', 'Each remaining 2026 month = 2025 same month × (contiguous 2026 actual YTD total ÷ the same months of 2025), so newly pasted actual months automatically re-shape the completion. 2027 = full-2026 × (1+growth) × monthly weight, where weight = (1−blend)×2025 month revenue share + blend×2026 month revenue share. Other net expenses reuse the revenue weight with their own growth input.'),
        ('EBITDA', 'EBITDA = scenario pre-tax profit + D&A − interest income. D&A and interest are copied through from Operating Model so no second model is needed.'),
        ('Retained-earnings reconciliation', 'Closing retained = opening retained + after-tax profit − reserve allocation − dividends declared. Case Summary exposes opening, change and closing; any difference would surface immediately.'),
    ]
    r += 2
    for title, text in narrative:
        put(ws, f'A{r}', title, bold=True, fill=GREY, wrap=True)
        put(ws, f'B{r}', text, wrap=True)
        ws.merge_cells(f'B{r}:F{r}')
        ws.row_dimensions[r].height = max(28, 13 * (len(text) // 120 + 1))
        r += 1
    ws.freeze_panes = 'A5'
    page_setup(ws, fit_width=False)
    return ws

# ================================================================= V2 build ==
# Company Focus V2: a director-facing, single-proposal workbook built from the
# same immutable .xlsm. Three presentation sheets (Company Dashboard, Data
# Update Guide, Source Check) plus two hidden engine sheets; every original
# accounting sheet is preserved unchanged after the five V2 sheets. Only
# plain Google Sheets-compatible formulas are used, and every result is
# blocked (N/A) until the Source Check sheet passes.

V2_PERIODS = ['2026 actual YTD', '2026 full-year outlook', '2027 forecast']

# Shared source-format gate for every V2 output cell.
V2_SRC_GATE = "'Source Check'!$B$2<>\"OK\""


def _build_v2_dashboard(wb):
    ws = wb.create_sheet('Company Dashboard')
    ws.sheet_properties.tabColor = '1F4E79'
    ws.sheet_view.showGridLines = False
    for col, w in dict(A=2.5, B=34, C=17, D=17, E=26, F=17, G=42, H=3,
                       I=15, J=2.5).items():
        ws.column_dimensions[col].width = w

    put(ws, 'B2', 'Company Dashboard — executive payment scenario (THB)',
        bold=True, size=16, border=False)
    put(ws, 'B3', 'One editable proposed package against the fixed salary-only baseline '
                  '(THB 500,000 per executive per month, no dividends). Yellow cells are the '
                  'only inputs; every other cell is a formula.', italic=True, border=False)

    put(ws, 'B4', 'Data status', bold=True, fill=GREY)
    put(ws, 'C4', "='Source Check'!$B$2", fill=GREEN, bold=True, halign='center')
    put(ws, 'B5', 'Latest actual month', bold=True, fill=GREY)
    put(ws, 'C5', "='Source Check'!$B$3", fill=GREEN, fmt=DATEFMT, bold=True, halign='center')
    put(ws, 'B6', 'View period', bold=True, fill=GREY)
    put(ws, 'C6', '2026 full-year outlook', fill=BLUE, bold=True, halign='center')

    gate = f'OR({V2_SRC_GATE},$C$14<>"OK",$I$12<>"OK")'
    put(ws, 'F4', (f'=IF({gate},"CHECK INPUT DATA",'
                   f'IF(AND($E$23=0,$E$31=0),"NO CHANGE",'
                   f'IF(AND($E$23>=0,$E$31>=0),"IMPROVES COMPANY",'
                   f'IF(AND($E$23<=0,$E$31<=0),"WEAKENS COMPANY",'
                   f'"MIXED - profitability and retained earnings move in different directions"))))'),
        bold=True, halign='center')
    ws.merge_cells('F4:I4')
    put(ws, 'F5', 'Verdict from the EBITDA and closing retained-earnings change rows.',
        italic=True, size=9, border=False)
    ws.merge_cells('F5:I5')

    put(ws, 'B8', 'Proposed package — edit the yellow cells', bold=True, fill=GREY)
    ws.merge_cells('B8:C8')
    put(ws, 'E8', 'Fixed baseline', bold=True, fill=GREY)
    ws.merge_cells('E8:F8')
    put(ws, 'G8', '2027 forecast drivers — edit the yellow cells', bold=True, fill=GREY)
    ws.merge_cells('G8:I8')

    for r, label, value, fmt in [(9, 'CEO monthly salary', 100000, MONEY0),
                                 (10, 'COO monthly salary', 100000, MONEY0),
                                 (11, 'CEO dividend share', 0.25, PCT),
                                 (12, 'COO dividend share', 0.25, PCT)]:
        put(ws, f'B{r}', label, fill=GREY)
        put(ws, f'C{r}', value, fill=YELLOW, fmt=fmt, bold=True, halign='right')
        put(ws, f'E{r}', label, fill=GREY)
    for r, value, fmt in [(9, 500000, MONEY0), (10, 500000, MONEY0),
                          (11, 0, PCT), (12, 0, PCT)]:
        put(ws, f'F{r}', value, fill=BLUE, fmt=fmt, bold=True, halign='right')
    put(ws, 'B13', 'Combined dividend share', bold=True, fill=GREY)
    put(ws, 'C13', '=$C$11+$C$12', fill=GREEN, fmt=PCT, bold=True, halign='right')
    put(ws, 'E13', 'Combined dividend share', bold=True, fill=GREY)
    put(ws, 'F13', '=$F$11+$F$12', fill=GREEN, fmt=PCT, bold=True, halign='right')
    put(ws, 'B14', 'Payment input check', bold=True, fill=GREY)
    put(ws, 'C14', ('=IF(AND(ISNUMBER($C$9),ISNUMBER($C$10),ISNUMBER($C$11),ISNUMBER($C$12),'
                    '$C$9>=0,$C$10>=0,$C$11>=0,$C$12>=0,$C$13<=1),"OK",'
                    '"BLOCKED - salaries must be zero or positive and dividend shares between '
                    '0% and 100%, combined no more than 100%")'), fill=GREEN, bold=True)

    for r, label, value in [(9, 'Revenue growth vs 2026 outlook', 0.10),
                            (10, 'Other net expense growth', 0.05),
                            (11, '2026 weight in 2027 seasonal pattern', 0.50)]:
        put(ws, f'G{r}', label, fill=GREY)
        put(ws, f'I{r}', value, fill=YELLOW, fmt=PCT, bold=True, halign='right')
    put(ws, 'G12', 'Forecast input check', bold=True, fill=GREY)
    put(ws, 'I12', ('=IF(AND(ISNUMBER($I$9),ISNUMBER($I$10),ISNUMBER($I$11),'
                    '$I$9>=-1,$I$10>=-1,$I$11>=0,$I$11<=1),"OK",'
                    '"BLOCKED - growth inputs must be -100% or higher and the seasonal '
                    'weight between 0% and 100%")'), fill=GREEN, bold=True)

    put(ws, 'B16', 'Comparison for the selected view period', italic=True, border=False)
    for col, h in zip('BCDEF', ['Metric', 'Fixed baseline', 'Proposed package',
                                'Change', 'Change %']):
        put(ws, f'{col}17', h, bold=True, fill=GREY,
            halign='left' if col == 'B' else 'center')

    cc = "'Company Calculation'"
    dt = f"{cc}!$A$4:$A$39"

    def rng(col):
        return f"{cc}!${col}$4:${col}$39"

    def sumifs(col):
        return f"SUMIFS({rng(col)},{dt},\">=\"&{cc}!$D$42,{dt},\"<=\"&{cc}!$D$43)"

    def endcell(col):
        return f"SUMIFS({rng(col)},{dt},\"=\"&{cc}!$D$43)"

    def months():
        return f"COUNTIFS({dt},\">=\"&{cc}!$D$42,{dt},\"<=\"&{cc}!$D$43)"

    def lossmonths(col):
        return (f"COUNTIFS({dt},\">=\"&{cc}!$D$42,{dt},\"<=\"&{cc}!$D$43,"
                f"{rng(col)},\"<0\")")

    # row → (label, number format, change direction, baseline body, proposed body)
    rows = {
        18: ('Revenue', MONEY0, 'neut', sumifs('C'), sumifs('C')),
        19: ('Management expense', MONEY0, 'rev', sumifs('L'), sumifs('X')),
        20: ('Executive payroll', MONEY0, 'rev', sumifs('K'), sumifs('W')),
        21: ('Payroll savings vs baseline', MONEY0, 'fav',
             f"($F$9+$F$10)*{months()}-{sumifs('K')}",
             f"($F$9+$F$10)*{months()}-{sumifs('W')}"),
        22: ('Pre-tax profit', MONEY0, 'fav', sumifs('M'), sumifs('Y')),
        23: ('EBITDA', MONEY0, 'fav',
             f"C22+{sumifs('G')}-{sumifs('H')}",
             f"D22+{sumifs('G')}-{sumifs('H')}"),
        24: ('Pre-tax margin', PCT, 'fav',
             'IF($C$18>0,C22/$C$18,"N/A")', 'IF($D$18>0,D22/$D$18,"N/A")'),
        25: ('Corporate tax provision', MONEY0, 'neut', sumifs('P'), sumifs('AB')),
        26: ('After-tax profit', MONEY0, 'fav', sumifs('Q'), sumifs('AC')),
        27: ('After-tax margin', PCT, 'fav',
             'IF($C$18>0,C26/$C$18,"N/A")', 'IF($D$18>0,D26/$D$18,"N/A")'),
        28: ('Dividends declared', MONEY0, 'rev', sumifs('S'), sumifs('AG')),
        29: ('Effective payout ratio', PCT, 'rev',
             'IF($C$26>0,C28/$C$26,"N/A")', 'IF($D$26>0,D28/$D$26,"N/A")'),
        30: ('Earnings kept', MONEY0, 'fav', 'C26-C28', 'D26-D28'),
        31: ('Closing unappropriated retained earnings', MONEY0, 'fav',
             endcell('T'), endcell('AH')),
        32: ('Loss months', INT, 'rev', lossmonths('M'), lossmonths('Y')),
    }
    for r, (label, fmt, _direction, cbody, dbody) in rows.items():
        put(ws, f'B{r}', label, fill=GREY)
        put(ws, f'C{r}', f'=IF({gate},"N/A",{cbody})', fmt=fmt, fill=GREEN, halign='right')
        put(ws, f'D{r}', f'=IF({gate},"N/A",{dbody})', fmt=fmt, fill=GREEN, halign='right')
        put(ws, f'E{r}', (f'=IF(OR({gate},NOT(ISNUMBER(C{r})),NOT(ISNUMBER(D{r}))),'
                          f'"N/A",D{r}-C{r})'), fmt=fmt, bold=True, halign='right')
        put(ws, f'F{r}', (f'=IF(OR({gate},NOT(ISNUMBER(C{r})),C{r}=0),'
                          f'"N/A",E{r}/C{r})'), fmt=PCT, halign='right')

    dv_period = DataValidation(type='list', allow_blank=False,
                               formula1='"' + ','.join(V2_PERIODS) + '"',
                               errorTitle='Invalid period',
                               error='Choose one of the three view periods.')
    dv_salary = DataValidation(type='decimal', operator='greaterThanOrEqual',
                               formula1='0', allow_blank=False,
                               errorTitle='Invalid salary',
                               error='Salaries must be zero or positive (THB per month).')
    dv_share = DataValidation(type='decimal', operator='between', formula1='0',
                              formula2='1', allow_blank=False,
                              errorTitle='Invalid share',
                              error='Dividend shares must be between 0% and 100%.')
    dv_growth = DataValidation(type='decimal', operator='greaterThanOrEqual',
                               formula1='-1', allow_blank=False,
                               errorTitle='Invalid growth',
                               error='Growth inputs must be -100% or higher.')
    dv_weight = DataValidation(type='decimal', operator='between', formula1='0',
                               formula2='1', allow_blank=False,
                               errorTitle='Invalid weight',
                               error='The seasonal weight must be between 0% and 100%.')
    for dv in (dv_period, dv_salary, dv_share, dv_growth, dv_weight):
        ws.add_data_validation(dv)
    dv_period.add('C6')
    dv_salary.add('C9:C10')
    dv_share.add('C11:C12')
    dv_growth.add('I9:I10')
    dv_weight.add('I11')

    good = dict(fill=_fill(GOOD_FILL), font=Font(color=GOOD_FONT, bold=True))
    bad = dict(fill=_fill(LOSS_FILL), font=Font(color=LOSS_FONT, bold=True))
    for block in ('E21:E24', 'E26:E27', 'E30:E31'):     # higher is favorable
        ws.conditional_formatting.add(block, CellIsRule(
            operator='greaterThan', formula=['0'], **good))
        ws.conditional_formatting.add(block, CellIsRule(
            operator='lessThan', formula=['0'], **bad))
    for block in ('E19:E20', 'E28:E29', 'E32'):         # lower is favorable
        ws.conditional_formatting.add(block, CellIsRule(
            operator='greaterThan', formula=['0'], **bad))
        ws.conditional_formatting.add(block, CellIsRule(
            operator='lessThan', formula=['0'], **good))
    warn = dict(fill=_fill(WARN_FILL), font=Font(color=WARN_FONT, bold=True))
    ws.conditional_formatting.add('C4', FormulaRule(formula=['$C$4<>"OK"'], **warn))
    ws.conditional_formatting.add('C14', FormulaRule(formula=['$C$14<>"OK"'], **warn))
    ws.conditional_formatting.add('I12', FormulaRule(formula=['$I$12<>"OK"'], **warn))
    for text, fill_c, font_c in [
            ('"CHECK INPUT DATA"', WARN_FILL, WARN_FONT),
            ('"NO CHANGE"', GREY, NEUTRAL_FONT),
            ('"IMPROVES COMPANY"', GOOD_FILL, GOOD_FONT),
            ('"WEAKENS COMPANY"', LOSS_FILL, LOSS_FONT),
            ('"MIXED - profitability and retained earnings move in different '
             'directions"', WARN_FILL, WARN_FONT)]:
        ws.conditional_formatting.add('F4', FormulaRule(
            formula=[f'$F$4={text}'], fill=_fill(fill_c),
            font=Font(color=font_c, bold=True)))

    page_setup(ws)
    ws.page_setup.fitToHeight = 1     # director dashboard prints on one page
    return ws


def _build_v2_update_guide(wb):
    ws = wb.create_sheet('Data Update Guide')
    ws.sheet_properties.tabColor = '2E75B6'
    ws.sheet_view.showGridLines = False
    ws.column_dimensions['B'].width = 26
    ws.column_dimensions['C'].width = 110
    put(ws, 'B2', 'Data Update Guide — keeping the Company Focus workbook current',
        bold=True, size=16, border=False)
    put(ws, 'B3', 'Two habits keep the dashboard correct: edit only the yellow input '
                  'cells, and paste new months into the accounting sheets without moving anything.',
        italic=True, border=False)
    rows = [
        ('Edit the payment package',
         'On Company Dashboard, change the four yellow payment cells: proposed CEO monthly '
         'salary (C9), proposed COO monthly salary (C10) and the two dividend shares '
         '(C11, C12). The fixed baseline beside them — THB 500,000 per executive per month, '
         'no dividends — never changes, and the comparison table recalculates immediately.'),
        ('Set the 2027 forecast drivers',
         'The three yellow driver cells set the 2027 outlook: revenue growth versus the 2026 '
         'outlook (I9), other-net-expense growth (I10) and how much of the 2027 seasonal '
         'pattern follows 2026 rather than 2025 (I11). They only affect 2027 months.'),
        ('Choose the view period',
         'Company Dashboard!C6 switches the comparison between 2026 actual YTD, 2026 '
         'full-year outlook and 2027 forecast. The selector changes the display period '
         'only — it is not a financial assumption.'),
        ('Paste each new month',
         'When a month closes, paste its figures into the next empty monthly column of the '
         'PL sheet — revenue row 15, management salary row 107, depreciation row 150, '
         'interest row 175 and pre-tax profit row 193 (2026 months live in PL!R:AC). Never '
         'move rows or columns: the anchors must stay on their rows. After recalculation '
         'the month is an actual and its estimate is gone.'),
        ('Confirm the data status',
         'Before presenting, Company Dashboard!C4 must read OK. Any other value blocks '
         'every dashboard figure to N/A and shows CHECK INPUT DATA in the banner.'),
        ('Read the repair message',
         'Open the Source Check sheet: the failing check and its Action cell name the '
         'exact cell to repair. Fix the accounting sheet, not the dashboard.'),
        ('What the comparison reads',
         'The scenario reads monthly operating data from the PL sheet (2025 in AG:AR, 2026 '
         'in R:AC) and the January 2026 opening unappropriated retained earnings from '
         'BS!D73. The other original sheets and later BS columns are preserved for the '
         'normal monthly refresh but do not drive the payment comparison.'),
        ('Dividend disclosure',
         'Dividends are modeled as percentages of positive eligible after-tax profit '
         'earned in profitable months — not fixed THB amounts. Months outside profit pay '
         'nothing.'),
        ('Approval disclosure',
         'The allocation is illustrative only. Check distributable-profit and legal-reserve '
         'requirements before approving any payment.'),
        ('Hidden working sheets',
         'Operating Model and Company Calculation are hidden engine sheets: unhide them to '
         'inspect the month-level math behind every dashboard figure. Company Dashboard is '
         'the only sheet a director needs.'),
    ]
    r = 5
    for topic, text in rows:
        put(ws, f'B{r}', topic, bold=True, fill=GREY, wrap=True, halign='left')
        put(ws, f'C{r}', text, wrap=True, halign='left')
        ws.row_dimensions[r].height = max(30, 13 * (len(text) // 105 + 1))
        r += 1
    ws.freeze_panes = 'A5'
    page_setup(ws, landscape=False, fit_width=False)
    return ws


def _build_v2_source_check(wb):
    ws = wb.create_sheet('Source Check')
    ws.sheet_properties.tabColor = 'C55A11'
    for col, w in dict(A=30, B=46, C=44, D=64).items():
        ws.column_dimensions[col].width = w
    put(ws, 'B1', 'Source Check — source validation before any scenario number is trusted',
        bold=True, size=14, border=False)
    put(ws, 'A2', 'Overall status', bold=True, fill=GREY)
    put(ws, 'B2', ('=IFERROR(IF(COUNTIF($C$7:$C$17,"OK")=11,"OK",'
                   '"ERROR - source layout/data changed; review Source Check"),'
                   '"ERROR - source layout/data changed; review Source Check")'),
        fill=GREEN, bold=True)
    put(ws, 'A3', 'Latest valid 2026 actual month', bold=True, fill=GREY)
    put(ws, 'B3', ('=IF($B$2="OK",DATE(2026,COUNTIF($C$22:$N$22,"Actual"),1),'
                   '"ERROR - fix the failing checks above")'),
        fill=GREEN, fmt=DATEFMT, bold=True, halign='center')
    put(ws, 'B4', 'Every status below is a live formula reading the PL and BS sheets exactly '
                  'where the scenario reads them. Overall status is OK only when all eleven '
                  'checks pass; the Company Dashboard shows N/A until then.',
        italic=True, border=False)
    ws.merge_cells('B4:D4')

    for col, h in zip('BCD', ['Check', 'Status', 'Action']):
        put(ws, f'{col}6', h, bold=True, fill=GREY)

    months26 = [(m, get_column_letter(PL_2026_FIRST_COL + m - 1)) for m in range(1, 13)]
    hdr = ','.join(f'YEAR(PL!${c}$3)=2026,MONTH(PL!${c}$3)={m}' for m, c in months26)
    checks = [
        ('PL revenue anchor — PL!A15 = T-R002, PL!B15 = Total Revenues (Sales)',
         ('=IFERROR(IF(AND(PL!$A$15="T-R002",PL!$B$15="Total Revenues (Sales)"),"OK",'
          '"FAIL - PL row 15 is not the Total Revenues (Sales) row"),'
          '"FAIL - PL row 15 cannot be read")'),
         'Restore PL!A15 = T-R002 and PL!B15 = Total Revenues (Sales), or move the row '
         'back. Never move PL rows when pasting monthly data.'),
        ('PL management anchor — PL!A107 = 53011.09, PL!B107 = Salary - Management (after trim)',
         ('=IFERROR(IF(AND(PL!$A$107=53011.09,TRIM(PL!$B$107)="Salary - Management"),"OK",'
          '"FAIL - PL row 107 is not the Salary - Management row"),'
          '"FAIL - PL row 107 cannot be read")'),
         'Restore PL!A107 = 53011.09 and PL!B107 = Salary - Management. Row 107 is also '
         'the actual-month sentinel the scenario classifies months by.'),
        ('PL depreciation anchor — PL!A150 = T-E011, PL!B150 = Depreciation and Amortization',
         ('=IFERROR(IF(AND(PL!$A$150="T-E011",PL!$B$150="Depreciation and Amortization"),'
          '"OK","FAIL - PL row 150 is not the Depreciation and Amortization row"),'
          '"FAIL - PL row 150 cannot be read")'),
         'Restore PL!A150 = T-E011 and PL!B150 = Depreciation and Amortization on row 150.'),
        ('PL interest anchor — PL!A175 = 49010, PL!B175 = Interest Income',
         ('=IFERROR(IF(AND(PL!$A$175=49010,PL!$B$175="Interest Income"),"OK",'
          '"FAIL - PL row 175 is not the Interest Income row"),'
          '"FAIL - PL row 175 cannot be read")'),
         'Restore PL!A175 = 49010 and PL!B175 = Interest Income on row 175.'),
        ('PL pre-tax anchor — PL!A193 = T-N003, PL!B193 = Pretax Income',
         ('=IFERROR(IF(AND(PL!$A$193="T-N003",PL!$B$193="Pretax Income"),"OK",'
          '"FAIL - PL row 193 is not the Pretax Income row"),'
          '"FAIL - PL row 193 cannot be read")'),
         'Restore PL!A193 = T-N003 and PL!B193 = Pretax Income on row 193.'),
        ('PL 2026 month headers — PL!R3:AC3 are January to December 2026 in order',
         f'=IFERROR(IF(AND({hdr}),"OK",'
         '"FAIL - PL!R3:AC3 are not January to December 2026 in order"),'
         '"FAIL - PL!R3:AC3 cannot be read")',
         'Restore the month headers in PL!R3:AC3 to January to December 2026, in order, '
         'with the year-total column kept after December.'),
        ('BS retained-earnings anchor — BS!B73 = Retained Earnings - Unappropriated, '
         'BS!D3 = January 2026, BS!D73 numeric',
         ('=IFERROR(IF(AND(BS!$B$73="Retained Earnings - Unappropriated",'
          'YEAR(BS!$D$3)=2026,MONTH(BS!$D$3)=1,ISNUMBER(BS!$D$73)),"OK",'
          '"FAIL - BS!B73, BS!D3 or BS!D73 is not the January 2026 unappropriated '
          'retained-earnings opening"),"FAIL - BS anchor cells cannot be read")'),
         'Restore BS!B73 = Retained Earnings - Unappropriated with the January 2026 '
         'opening value in BS!D73. The comparison reads only this BS cell.'),
        ('At least one 2026 actual month detected in PL!R:AC (row 107 sentinel)',
         ('=IFERROR(IF(COUNTIF($C$22:$N$22,"Actual")>=1,"OK",'
          '"FAIL - no 2026 actual month detected in PL!R:AC row 107"),'
          '"FAIL - the 2026 months cannot be classified")'),
         'Paste at least one reported 2026 month into PL!R:AC (rows 15, 107, 150, 175 '
         'and 193) before presenting the scenario.'),
        ('No actual month after a gap — no populated month follows a blank month',
         ('=IFERROR(IF(COUNTIF($C$22:$N$22,"gap")=0,"OK",'
          '"FAIL - actual month after gap: a populated month follows a blank month"),'
          '"FAIL - the 2026 months cannot be classified")'),
         'Reported months must be contiguous from January 2026: fill the blank month(s) '
         'before the latest reported month, or clear the later month.'),
        ('Every detected actual month has numeric revenue, management and pre-tax values',
         ('=IFERROR(IF(COUNTIF($C$23:$N$23,"FAIL")=0,"OK",'
          '"FAIL - an actual month has a non-numeric revenue, management or pre-tax '
          'value in PL rows 15, 107 or 193"),"FAIL - PL actual values cannot be read")'),
         'Re-paste the affected month as numbers, not text, into PL rows 15, 107 and 193.'),
        ('Every detected actual month has numeric or blank depreciation and interest values',
         ('=IFERROR(IF(COUNTIF($C$24:$N$24,"FAIL")=0,"OK",'
          '"FAIL - an actual month has a text depreciation or interest value in PL rows '
          '150 or 175"),"FAIL - PL optional values cannot be read")'),
         'Leave depreciation (row 150) and interest (row 175) blank for unreported '
         'amounts, or paste numbers — text is not accepted.'),
    ]
    for i, (check, status, action) in enumerate(checks):
        r = 7 + i
        put(ws, f'B{r}', check, fill=GREY, wrap=True)
        put(ws, f'C{r}', status, fill=GREEN, wrap=True)
        put(ws, f'D{r}', action, fill=GREY, wrap=True)
        ws.row_dimensions[r].height = 30

    put(ws, 'B20', 'Month classification helpers — driven by the PL!R:AC row 107 salary '
                   'sentinel (blank months are unreported)', bold=True, border=False)
    for label, r in [('Month number', 21), ('Classification', 22),
                     ('Revenue, management and pre-tax numeric', 23),
                     ('D&A and interest numeric or blank', 24)]:
        put(ws, f'B{r}', label, fill=GREY, wrap=True)
    for m, c26 in months26:
        col = get_column_letter(2 + m)               # C..N on this sheet
        ws.column_dimensions[col].width = 9
        put(ws, f'{col}21', m, fmt=INT, fill=GREY, halign='center')
        put(ws, f'{col}22', (f'=IFERROR(IF(COUNTIF(PL!$R$107:{c26}$107,"<>")={col}$21,'
                             f'"Actual",IF(PL!{c26}$107="","blank","gap")),"FAIL")'),
            fill=GREEN, halign='center')
        put(ws, f'{col}23', (f'=IFERROR(IF({col}$22="Actual",'
                             f'IF(AND(ISNUMBER(PL!{c26}15),ISNUMBER(PL!{c26}107),'
                             f'ISNUMBER(PL!{c26}193)),"OK","FAIL"),"—"),"FAIL")'),
            fill=GREEN, halign='center')
        put(ws, f'{col}24', (f'=IFERROR(IF({col}$22="Actual",'
                             f'IF(AND(OR(PL!{c26}150="",ISNUMBER(PL!{c26}150)),'
                             f'OR(PL!{c26}175="",ISNUMBER(PL!{c26}175))),"OK","FAIL"),'
                             f'"—"),"FAIL")'), fill=GREEN, halign='center')

    ws.freeze_panes = 'A7'
    page_setup(ws)
    return ws


def _build_v2_operating_model(wb):
    ws = wb.create_sheet('Operating Model')
    ws.sheet_properties.tabColor = '7F6000'
    for col, w in dict(A=10, B=14, C=44, D=16, E=16, F=15, G=16, H=13, I=13,
                       J=13, K=60).items():
        ws.column_dimensions[col].width = w
    put(ws, 'A1', 'Operating Model — 36 months: source actuals, 2026 completion, '
                  '2027 forecast (THB)', bold=True, size=14, border=False)
    put(ws, 'A2', 'Contiguous populated PL row 107 months are actuals; blank months are '
                  'estimated as the matching 2025 month scaled by (contiguous 2026 actual '
                  'YTD ÷ the same months of 2025); 2027 applies the Company Dashboard '
                  'growth drivers and the seasonal blend. Every output is blocked (N/A) '
                  'until Source Check passes.', italic=True, border=False)
    for i, h in enumerate(['Date', 'Kind', 'Source', 'Revenue', 'Other net expenses',
                           'Source management', 'Source pre-tax profit', 'D&A',
                           'Interest income', 'Seasonality weight', 'Notes']):
        put(ws, f'{get_column_letter(1 + i)}3', h, bold=True, fill=GREY, wrap=True)

    gate = V2_SRC_GATE
    for p in range(36):                              # p=0 → Jan 2025
        r = 4 + p
        year = 2025 + p // 12
        month = p % 12 + 1
        put(ws, f'A{r}', f'=DATE({year},{month},1)', fmt=DATEFMT, fill=GREY, halign='center')
        col25 = get_column_letter(PL_2025_FIRST_COL + month - 1)
        col26 = get_column_letter(PL_2026_FIRST_COL + month - 1)
        if year == 2025:
            put(ws, f'B{r}', f'=IF({gate},"N/A","Actual")', fill=GREY, halign='center')
            put(ws, f'C{r}', f'PL!{col25}15 revenue · PL!{col25}107 management · '
                             f'PL!{col25}193 pre-tax · D&A PL!{col25}150 · interest PL!{col25}175',
                fill=GREY, wrap=True)
            put(ws, f'D{r}', f'=IF({gate},"N/A",PL!{col25}15)', fill=GREEN, fmt=MONEY)
            put(ws, f'E{r}', f'=IF({gate},"N/A",D{r}-G{r}-F{r})', fill=GREEN, fmt=MONEY)
            put(ws, f'F{r}', f'=IF({gate},"N/A",PL!{col25}107)', fill=GREEN, fmt=MONEY)
            put(ws, f'G{r}', f'=IF({gate},"N/A",PL!{col25}193)', fill=GREEN, fmt=MONEY)
            put(ws, f'H{r}', f'=IF({gate},"N/A",IF(PL!{col25}150="",0,PL!{col25}150))',
                fill=GREEN, fmt=MONEY)
            put(ws, f'I{r}', f'=IF({gate},"N/A",IF(PL!{col25}175="",0,PL!{col25}175))',
                fill=GREEN, fmt=MONEY)
            put(ws, f'J{r}', None, fill=GREY)
            put(ws, f'K{r}', 'Imported actual. Other net expenses derived as '
                             'revenue − pre-tax − management.', fill=GREY, wrap=True)
        elif year == 2026:
            put(ws, f'B{r}', (f'=IF({gate},"N/A",IF(COUNTIF(PL!$R$107:{col26}$107,"<>")={month},'
                              f'"Actual",IF(PL!{col26}$107="","2026 estimate",'
                              f'"⚠ actual after gap")))'), fill=GREY, halign='center')
            put(ws, f'C{r}', (f'=IF($B{r}="Actual","PL!{col26}15 revenue · PL!{col26}107 '
                              f'management · PL!{col26}193 pre-tax · D&A PL!{col26}150 · '
                              f'interest PL!{col26}175",IF($B{r}="2026 estimate",'
                              f'"Estimated: 2025 same month × (contiguous 2026 actual YTD '
                              f'÷ same months of 2025)","Blocked: PL!{col26}107 is '
                              f'populated after a blank month"))'), fill=GREY, wrap=True)
            put(ws, f'D{r}', (f'=IF({gate},"N/A",IF($B{r}="Actual",PL!{col26}15,'
                              f'IF($B{r}="2026 estimate",IF(OR($D$42=0,$D$45<=0),"N/A",'
                              f'D{3 + month}*$D$43/$D$45),"N/A")))'), fill=GREEN, fmt=MONEY)
            put(ws, f'E{r}', (f'=IF({gate},"N/A",IF($B{r}="Actual",'
                              f'PL!{col26}15-PL!{col26}193-PL!{col26}107,'
                              f'IF($B{r}="2026 estimate",IF($E$46<=0,"N/A",'
                              f'E{3 + month}*$E$44/$E$46),"N/A")))'), fill=GREEN, fmt=MONEY)
            put(ws, f'F{r}', (f'=IF({gate},"N/A",IF($B{r}="Actual",PL!{col26}107,'
                              f'IF($B{r}="2026 estimate",1000000+12500,"N/A")))'),
                fill=GREEN, fmt=MONEY)
            put(ws, f'G{r}', (f'=IF({gate},"N/A",IF($B{r}="Actual",PL!{col26}193,'
                              f'IF(AND(ISNUMBER(D{r}),ISNUMBER(E{r}),ISNUMBER(F{r})),'
                              f'D{r}-E{r}-F{r},"N/A")))'), fill=GREEN, fmt=MONEY)
            put(ws, f'H{r}', (f'=IF({gate},"N/A",IF($B{r}="Actual",'
                              f'IF(PL!{col26}150="",0,PL!{col26}150),'
                              f'IF($B{r}="2026 estimate",$H$47,"N/A")))'),
                fill=GREEN, fmt=MONEY)
            put(ws, f'I{r}', (f'=IF({gate},"N/A",IF($B{r}="Actual",'
                              f'IF(PL!{col26}175="",0,PL!{col26}175),'
                              f'IF($B{r}="2026 estimate",0,"N/A")))'),
                fill=GREEN, fmt=MONEY)
            put(ws, f'J{r}', None, fill=GREY)
            put(ws, f'K{r}', (f'=IF($B{r}="Actual","Imported actual, detected from the '
                              f'PL!{col26}107 salary sentinel.",IF($B{r}="2026 estimate",'
                              f'"Estimated month: revenue and other net expenses scale the '
                              f'matching 2025 month; management = 1,000,000 benchmark payroll '
                              f'+ 12,500 non-executive cost; D&A = 2026 actual average; '
                              f'interest = 0.","Blocked: PL!{col26}107 is populated after a '
                              f'blank month."))'), fill=GREY, wrap=True)
            continue
        else:
            r25, r26 = 3 + month, 15 + month
            g27 = 'OR(SUM($D$4:$D$15)<=0,SUM($D$16:$D$27)<=0)'
            put(ws, f'B{r}', f'=IF({gate},"N/A","2027 forecast")', fill=GREY, halign='center')
            put(ws, f'C{r}', 'Scaled 2026 full-year outlook; blended revenue seasonality',
                fill=GREY, wrap=True)
            put(ws, f'J{r}', (f'=IF({gate},"N/A",IF({g27},"N/A",'
                             f"(1-'Company Dashboard'!$I$11)*D{r25}/SUM($D$4:$D$15)"
                             f"+'Company Dashboard'!$I$11*D{r26}/SUM($D$16:$D$27)))"),
                fill=GREEN, fmt=PCT2)
            put(ws, f'D{r}', (f'=IF({gate},"N/A",IF({g27},"N/A",'
                              f"SUM($D$16:$D$27)*(1+'Company Dashboard'!$I$9)*J{r}))"),
                fill=GREEN, fmt=MONEY)
            put(ws, f'E{r}', (f'=IF({gate},"N/A",IF({g27},"N/A",'
                              f"SUM($E$16:$E$27)*(1+'Company Dashboard'!$I$10)*J{r}))"),
                fill=GREEN, fmt=MONEY)
            put(ws, f'F{r}', f'=IF({gate},"N/A",1000000+12500)', fill=GREEN, fmt=MONEY)
            put(ws, f'G{r}', (f'=IF({gate},"N/A",IF(AND(ISNUMBER(D{r}),ISNUMBER(E{r})),'
                              f'D{r}-E{r}-F{r},"N/A"))'), fill=GREEN, fmt=MONEY)
            put(ws, f'H{r}', f'=IF({gate},"N/A",$H$47)', fill=GREEN, fmt=MONEY)
            put(ws, f'I{r}', f'=IF({gate},"N/A",0)', fill=GREEN, fmt=MONEY)
            put(ws, f'K{r}', 'Forecast month: weight = (1−blend)×2025 month revenue share '
                             '+ blend×2026 month revenue share; revenue = 2026 full-year × '
                             '(1+growth) × weight; other cost uses its own growth and the '
                             'same weight.', fill=GREY, wrap=True)

    put(ws, 'A41', '2026 actual detection — feeds the estimate and 2027 rows (from the '
                   'PL!R:AC row 107 sentinel)', bold=True, border=False)
    helpers = [
        (42, 'Contiguous 2026 actual months — COUNTIF($B$16:$B$27,"Actual")', 'D',
         '=COUNTIF($B$16:$B$27,"Actual")', INT),
        (43, '2026 actual revenue total — SUMIFS over PL!R15:AC15 where row 107 is populated',
         'D', '=SUMIFS(PL!$R$15:$AC$15,PL!$R$107:$AC$107,"<>")', MONEY),
        (44, '2026 actual other net expenses total — actual revenue − management − pre-tax',
         'E', ('=D43-SUMIFS(PL!$R$107:$AC$107,PL!$R$107:$AC$107,"<>")'
               '-SUMIFS(PL!$R$193:$AC$193,PL!$R$107:$AC$107,"<>")'), MONEY),
        (45, '2025 matching YTD revenue — through DATE(2025,actual months,1)', 'D',
         '=SUMIFS($D$4:$D$15,$A$4:$A$15,"<="&DATE(2025,$D$42,1))', MONEY),
        (46, '2025 matching YTD other net expenses — through DATE(2025,actual months,1)',
         'E', '=SUMIFS($E$4:$E$15,$A$4:$A$15,"<="&DATE(2025,$D$42,1))', MONEY),
        (47, '2026 actual D&A run rate — SUMIFS ÷ actual months', 'H',
         '=IF($D$42=0,0,SUMIFS(PL!$R$150:$AC$150,PL!$R$107:$AC$107,"<>")/$D$42)', MONEY),
    ]
    for r, label, col, formula, fmt in helpers:
        put(ws, f'C{r}', label, fill=GREY, wrap=True)
        put(ws, f'{col}{r}', formula, fill=GREEN, fmt=fmt, halign='right')

    ws.auto_filter.ref = 'A3:K39'
    ws.freeze_panes = 'D4'
    page_setup(ws, fit_width=False)
    return ws


V2_CC_HEADERS = [
    ('A', 'Date', DATEFMT), ('B', 'Kind', None),
    ('C', 'Revenue', MONEY), ('D', 'Other net expenses', MONEY),
    ('E', 'Source management', MONEY), ('F', 'Source pre-tax profit', MONEY),
    ('G', 'D&A', MONEY), ('H', 'Interest income', MONEY),
    ('I', 'Baseline CEO salary', MONEY0), ('J', 'Baseline COO salary', MONEY0),
    ('K', 'Baseline payroll', MONEY), ('L', 'Baseline management', MONEY),
    ('M', 'Baseline pre-tax profit', MONEY), ('N', 'Baseline tax base YTD', MONEY),
    ('O', 'Baseline tax liability YTD', MONEY), ('P', 'Baseline tax provision', MONEY),
    ('Q', 'Baseline after-tax profit', MONEY), ('R', 'Baseline eligible profit', MONEY),
    ('S', 'Baseline dividends declared', MONEY), ('T', 'Baseline closing retained', MONEY),
    ('U', 'Proposed CEO salary', MONEY0), ('V', 'Proposed COO salary', MONEY0),
    ('W', 'Proposed payroll', MONEY), ('X', 'Proposed management', MONEY),
    ('Y', 'Proposed pre-tax profit', MONEY), ('Z', 'Proposed tax base YTD', MONEY),
    ('AA', 'Proposed tax liability YTD', MONEY), ('AB', 'Proposed tax provision', MONEY),
    ('AC', 'Proposed after-tax profit', MONEY), ('AD', 'Proposed eligible profit', MONEY),
    ('AE', 'Proposed CEO dividend', MONEY), ('AF', 'Proposed COO dividend', MONEY),
    ('AG', 'Proposed dividends declared', MONEY), ('AH', 'Proposed closing retained', MONEY),
]


def _build_v2_company_calculation(wb):
    ws = wb.create_sheet('Company Calculation')
    ws.sheet_properties.tabColor = 'BF8F00'
    put(ws, 'A1', 'Company Calculation — 36 months × two payment tracks '
                  '(fixed baseline vs proposed package, THB)', bold=True, size=13, border=False)
    put(ws, 'A2', 'One row per month. Both tracks swap the THB 1,000,000 benchmark payroll '
                  'for their own two salaries (management − 1,000,000 + salaries; pre-tax '
                  '+ 1,000,000 − salaries), provide 20% corporate tax on year-to-date profit '
                  'with monthly differencing and a January 2026 reset, and declare dividends '
                  'as shares of positive eligible after-tax profit. January 2026 retained '
                  'earnings open at BS!D73. All cells are blocked (N/A) until Source Check '
                  'passes.', italic=True, border=False)
    for letter, header, fmt in V2_CC_HEADERS:
        put(ws, f'{letter}3', header, bold=True, fill=GREY, wrap=True)
        ws.column_dimensions[letter].width = 11 if letter in ('A', 'B') else 13

    gate = V2_SRC_GATE
    dash = "'Company Dashboard'"
    for p in range(36):                              # p=0 → Jan 2025
        r = 4 + p
        om = 4 + p
        prev = r - 1
        jan = p % 12 == 0

        put(ws, f'A{r}', f"='Operating Model'!A{om}", fmt=DATEFMT, fill=GREEN, halign='center')
        put(ws, f'B{r}', f"='Operating Model'!B{om}", fill=GREEN, halign='center')
        for col, src in (('C', 'D'), ('D', 'E'), ('E', 'F'), ('F', 'G'),
                         ('G', 'H'), ('H', 'I')):
            put(ws, f'{col}{r}', f"='Operating Model'!{src}{om}", fmt=MONEY, fill=GREEN)

        # ------------------------------------------------- fixed baseline ---
        put(ws, f'I{r}', f"={dash}!$F$9", fmt=MONEY0, fill=GREEN)
        put(ws, f'J{r}', f"={dash}!$F$10", fmt=MONEY0, fill=GREEN)
        put(ws, f'K{r}', f'=I{r}+J{r}', fmt=MONEY, fill=GREEN)
        put(ws, f'L{r}', f'=IF(OR({gate},NOT(ISNUMBER($E{r}))),"N/A",$E{r}-1000000+$K{r})',
            fmt=MONEY, fill=GREEN)
        put(ws, f'M{r}', f'=IF(OR({gate},NOT(ISNUMBER($F{r}))),"N/A",$F{r}+1000000-$K{r})',
            fmt=MONEY, fill=GREEN)
        put(ws, f'N{r}', (f'=IF(OR({gate},NOT(ISNUMBER($M{r}))),"N/A",$M{r})'
                          if jan else
                          f'=IF(OR({gate},NOT(ISNUMBER($M{r})),NOT(ISNUMBER($N{prev}))),'
                          f'"N/A",$N{prev}+$M{r})'), fmt=MONEY, fill=GREEN)
        put(ws, f'O{r}', f'=IF(OR({gate},NOT(ISNUMBER($N{r}))),"N/A",IF($N{r}>0,$N{r},0)*0.2)',
            fmt=MONEY, fill=GREEN)
        put(ws, f'P{r}', (f'=IF(OR({gate},NOT(ISNUMBER($O{r}))),"N/A",$O{r})'
                          if jan else
                          f'=IF(OR({gate},NOT(ISNUMBER($O{r})),NOT(ISNUMBER($O{prev}))),'
                          f'"N/A",$O{r}-$O{prev})'), fmt=MONEY, fill=GREEN)
        put(ws, f'Q{r}', f'=IF(OR({gate},NOT(ISNUMBER($P{r}))),"N/A",$M{r}-$P{r})',
            fmt=MONEY, fill=GREEN)
        put(ws, f'R{r}', (f'=IF(OR({gate},NOT(ISNUMBER($Q{r}))),"N/A",'
                          f'IF($M{r}>0,IF($Q{r}>0,$Q{r},0),0))'), fmt=MONEY, fill=GREEN)
        put(ws, f'S{r}', (f'=IF(OR({gate},NOT(ISNUMBER($R{r}))),"N/A",'
                          f"$R{r}*({dash}!$F$11+{dash}!$F$12))"), fmt=MONEY, fill=GREEN)
        if p == 0:
            opening = 'BS!$Q$73'
        elif p == 12:
            opening = 'BS!$D$73'
        else:
            opening = None
        if opening:
            put(ws, f'T{r}', (f'=IF(OR({gate},NOT(ISNUMBER($Q{r})),NOT(ISNUMBER($S{r}))),'
                              f'"N/A",{opening}+$Q{r}-$S{r})'), fmt=MONEY, fill=GREEN)
        else:
            put(ws, f'T{r}', (f'=IF(OR({gate},NOT(ISNUMBER($Q{r})),NOT(ISNUMBER($S{r})),'
                              f'NOT(ISNUMBER($T{prev}))),"N/A",$T{prev}+$Q{r}-$S{r})'),
                fmt=MONEY, fill=GREEN)

        # ---------------------------------------------- proposed package ---
        put(ws, f'U{r}', f"={dash}!$C$9", fmt=MONEY0, fill=GREEN)
        put(ws, f'V{r}', f"={dash}!$C$10", fmt=MONEY0, fill=GREEN)
        put(ws, f'W{r}', f'=U{r}+V{r}', fmt=MONEY, fill=GREEN)
        put(ws, f'X{r}', f'=IF(OR({gate},NOT(ISNUMBER($E{r}))),"N/A",$E{r}-1000000+$W{r})',
            fmt=MONEY, fill=GREEN)
        put(ws, f'Y{r}', f'=IF(OR({gate},NOT(ISNUMBER($F{r}))),"N/A",$F{r}+1000000-$W{r})',
            fmt=MONEY, fill=GREEN)
        put(ws, f'Z{r}', (f'=IF(OR({gate},NOT(ISNUMBER($Y{r}))),"N/A",$Y{r})'
                          if jan else
                          f'=IF(OR({gate},NOT(ISNUMBER($Y{r})),NOT(ISNUMBER($Z{prev}))),'
                          f'"N/A",$Z{prev}+$Y{r})'), fmt=MONEY, fill=GREEN)
        put(ws, f'AA{r}', f'=IF(OR({gate},NOT(ISNUMBER($Z{r}))),"N/A",IF($Z{r}>0,$Z{r},0)*0.2)',
            fmt=MONEY, fill=GREEN)
        put(ws, f'AB{r}', (f'=IF(OR({gate},NOT(ISNUMBER($AA{r}))),"N/A",$AA{r})'
                           if jan else
                           f'=IF(OR({gate},NOT(ISNUMBER($AA{r})),NOT(ISNUMBER($AA{prev}))),'
                           f'"N/A",$AA{r}-$AA{prev})'), fmt=MONEY, fill=GREEN)
        put(ws, f'AC{r}', f'=IF(OR({gate},NOT(ISNUMBER($AB{r}))),"N/A",$Y{r}-$AB{r})',
            fmt=MONEY, fill=GREEN)
        put(ws, f'AD{r}', (f'=IF(OR({gate},NOT(ISNUMBER($AC{r}))),"N/A",'
                           f'IF($Y{r}>0,IF($AC{r}>0,$AC{r},0),0))'), fmt=MONEY, fill=GREEN)
        put(ws, f'AE{r}', (f'=IF(OR({gate},NOT(ISNUMBER($AD{r}))),"N/A",'
                           f"$AD{r}*{dash}!$C$11)"), fmt=MONEY, fill=GREEN)
        put(ws, f'AF{r}', (f'=IF(OR({gate},NOT(ISNUMBER($AD{r}))),"N/A",'
                           f"$AD{r}*{dash}!$C$12)"), fmt=MONEY, fill=GREEN)
        put(ws, f'AG{r}', (f'=IF(OR({gate},NOT(ISNUMBER($AE{r})),NOT(ISNUMBER($AF{r}))),"N/A",'
                           f'$AE{r}+$AF{r})'), fmt=MONEY, fill=GREEN)
        if opening:
            put(ws, f'AH{r}', (f'=IF(OR({gate},NOT(ISNUMBER($AC{r})),'
                               f'NOT(ISNUMBER($AG{r}))),"N/A",{opening}+$AC{r}-$AG{r})'),
                fmt=MONEY, fill=GREEN)
        else:
            put(ws, f'AH{r}', (f'=IF(OR({gate},NOT(ISNUMBER($AC{r})),NOT(ISNUMBER($AG{r})),'
                               f'NOT(ISNUMBER($AH{prev}))),"N/A",$AH{prev}+$AC{r}-$AG{r})'),
                fmt=MONEY, fill=GREEN)

    put(ws, 'B41', 'Dashboard period helpers — driven by the Company Dashboard '
                   'view-period selector', bold=True, border=False)
    put(ws, 'C42', 'Period start', fill=GREY)
    put(ws, 'D42', (f"=IF({dash}!$C$6=\"2026 actual YTD\",DATE(2026,1,1),"
                    f"IF({dash}!$C$6=\"2027 forecast\",DATE(2027,1,1),DATE(2026,1,1)))"),
        fill=GREEN, fmt=DATEFMT, halign='center')
    put(ws, 'C43', 'Period end', fill=GREY)
    put(ws, 'D43', (f"=IF({dash}!$C$6=\"2026 actual YTD\",'Source Check'!$B$3,"
                    f"IF({dash}!$C$6=\"2027 forecast\",DATE(2027,12,1),DATE(2026,12,1)))"),
        fill=GREEN, fmt=DATEFMT, halign='center')

    ws.freeze_panes = 'D4'
    page_setup(ws, fit_width=False)
    return ws


def build_company_focus_v2_workbook(source: Path, output: Path) -> None:
    source, output = Path(source), Path(output)
    wb, replaced = convert_source_workbook(source)
    original_sheets = [ws.title for ws in wb.worksheets]

    _build_v2_dashboard(wb)
    _build_v2_update_guide(wb)
    _build_v2_source_check(wb)
    _build_v2_operating_model(wb)
    _build_v2_company_calculation(wb)

    model = [wb[t] for t in V2_MODEL_SHEETS]
    rest = [ws for ws in wb.worksheets if ws.title not in V2_MODEL_SHEETS]
    wb._sheets = model + rest            # deterministic order: dashboard first
    wb.active = 0
    wb['Operating Model'].sheet_state = 'hidden'
    wb['Company Calculation'].sheet_state = 'hidden'
    wb.calculation = CalcProperties(fullCalcOnLoad=True)

    tmp = output.with_name(output.stem + '.tmp.xlsx')
    wb.save(tmp)
    try:
        validate_output(tmp, wb, model_sheets=V2_MODEL_SHEETS)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    os.replace(tmp, output)
    print(f'Converted {replaced} VBA-UDF formulas; sheets: '
          f'{[ws.title for ws in wb.worksheets][:5]} + {original_sheets}')
    print(f'Wrote {output}')



# ================================================================== V3 build ==
# Company Focus V3: the unchanged V2 director workbook plus a CEO/COO personal
# reference comparison on the same Company Dashboard sheet, placed below row
# 800 and excluded from the dashboard print area. The row placement is
# obscurity, not access control — anyone with the workbook can jump to the
# block — and the reference block says so itself. All personal money is
# computed in THB from the same V2 engine cells; the THB/USD selector and the
# editable planning rate convert for display only.

V3_BLOCKED_MSG = ('BLOCKED - choose THB or USD and enter a positive '
                  'THB per USD rate')

V3_PERSONAL_LABELS = [
    'CEO gross salary', 'CEO gross dividends', 'CEO Thai salary tax',
    'CEO Thai dividend tax', 'CEO take-home after Thai tax',
    'CEO average monthly take-home', 'COO gross salary', 'COO gross dividends',
    'COO Thai salary tax', 'COO Thai dividend tax',
    'COO take-home after Thai tax', 'COO average monthly take-home',
]


def _pit_bands_expr(taxable_ref: str) -> str:
    """Progressive PIT band chain on a precomputed taxable-income cell.

    Splitting the chain this way lets long tax formulas reference one small
    helper cell instead of repeating a taxable-income expression ~23 times,
    keeping every written formula far below the Excel 8,192-character
    formula limit.
    """
    def num(x):
        return f'{float(x):.10g}'

    edges = []                       # (band lower edge, cumulative tax, rate)
    cum = 0.0
    for lo, hi, rate in PIT_BANDS:
        edges.append((lo, cum, rate))
        cum += (hi - lo) * rate

    def band(i):
        lo, tax, rate = edges[i]
        return f'{num(tax)}+({taxable_ref}-{num(lo)})*{num(rate)}'

    expr = band(len(edges) - 1)      # top band: amount over 5,000,000 @ 35%
    for i in range(len(edges) - 2, -1, -1):
        expr = f'IF({taxable_ref}<={num(PIT_BANDS[i][1])},{band(i)},{expr})'
    return expr


def _thai_employment_tax_expr(annual_income_ref: str) -> str:
    """Formula expression equal to ``model.thai_salary_tax(ref, 0, 0)`` for a
    direct annual employment-income reference.

    Annual taxable employment income is ``MAX(0, annual - MIN(annual/2,
    100000) - 60000)`` taxed through PIT_BANDS, with the top band open-ended
    (no artificial cap). Built from plain IF/MAX/MIN so Google Sheets and
    Excel agree bit-for-bit; no LET, named ranges, array formulas or visible
    tax table.
    """
    annual = f'({annual_income_ref})'
    return _pit_bands_expr(
        f'MAX(0,{annual}-MIN({annual}*0.5,100000)-60000)')


def _thai_salary_tax_expr(monthly_salary_ref: str) -> str:
    """``_thai_employment_tax_expr`` for a monthly-salary reference (×12)."""
    return _thai_employment_tax_expr(f'{monthly_salary_ref}*12')


def _add_v3_personal_reference(ws) -> None:
    """Row-801 controls, validations, table and print area on the dashboard."""
    put(ws, 'B801', 'CEO/COO Personal Reference', bold=True, size=16, border=False)
    ws.merge_cells('B801:F801')
    put(ws, 'B802', 'Confidential reference only — row placement is not access '
                    'control; anyone with workbook access can jump to this section.',
        bold=True, wrap=True, size=10, fill=WARN_FILL, color=WARN_FONT)
    ws.merge_cells('B802:F802')
    ws.row_dimensions[802].height = 28

    put(ws, 'B803', 'Display currency', bold=True, fill=GREY)
    put(ws, 'C803', 'THB', fill=YELLOW, bold=True, halign='center')
    put(ws, 'B804', 'THB per USD', bold=True, fill=GREY)
    put(ws, 'C804', 35, fill=YELLOW, fmt=MONEY, bold=True, halign='right')
    put(ws, 'B805', 'Reference input check', bold=True, fill=GREY)
    put(ws, 'C805', (f'=IF(AND(OR($C$803="THB",$C$803="USD"),ISNUMBER($C$804),'
                     f'$C$804>0),"OK","{V3_BLOCKED_MSG}")'),
        fill=GREEN, bold=True)
    put(ws, 'B806', 'USD values = THB ÷ planning rate; Thai taxes are calculated '
                    'in THB before display conversion.', italic=True, size=9,
        border=False)
    ws.merge_cells('B806:F806')

    dv_currency = DataValidation(type='list', allow_blank=False,
                                 formula1='"THB,USD"',
                                 errorTitle='Invalid currency',
                                 error='Choose THB or USD.')
    dv_fx = DataValidation(type='decimal', operator='greaterThan', formula1='0',
                           allow_blank=False, errorTitle='Invalid rate',
                           error='The THB per USD planning rate must be positive.')
    for dv in (dv_currency, dv_fx):
        ws.add_data_validation(dv)
    dv_currency.add('C803')
    dv_fx.add('C804')
    ws.conditional_formatting.add('C805', FormulaRule(
        formula=['$C$805<>"OK"'], fill=_fill(WARN_FILL),
        font=Font(color=WARN_FONT, bold=True)))

    put(ws, 'B808', 'Metric', bold=True, fill=GREY)
    for col, h in zip('CDEF', ['Fixed baseline', 'Proposed package',
                               'Change', 'Change %']):
        put(ws, f'{col}808', h, bold=True, fill=GREY, halign='center')

    cc = "'Company Calculation'"
    dt = f'{cc}!$A$4:$A$39'
    d43 = f'{cc}!$D$43'
    months = f'COUNTIFS({dt},">="&{cc}!$D$42,{dt},"<="&{d43})'
    # Dividends are received one month after they are earned and January 2026
    # resets to zero (the modeled period starts there), so the earning window
    # ends one month before the display period ends and starts at Dec 2026 for
    # the 2027 view (Dec 2026 is received in Jan 2027).
    win_lo = 'IF($C$6="2027 forecast",DATE(2026,12,1),DATE(2026,1,1))'
    win_hi = f'DATE(YEAR({d43}),MONTH({d43})-1,1)'

    def window_sum(col):
        return f'SUMIFS({cc}!${col}$4:${col}$39,{dt},">="&{win_lo},{dt},"<="&{win_hi})'

    gate = f'OR({V2_SRC_GATE},$C$14<>"OK",$I$12<>"OK",$C$805<>"OK")'
    fx = 'IF($C$803="USD",$C$804,1)'

    # row → (label, baseline THB body, proposed THB body, convert THB→display)
    rows = {}
    for role, r0, sal_base, sal_prop, share_base, earn_col in (
            ('CEO', 809, '$F$9', '$C$9', '$F$11', 'AE'),
            ('COO', 815, '$F$10', '$C$10', '$F$12', 'AF')):
        rows[r0] = (f'{role} gross salary',
                    f'{sal_base}*{months}', f'{sal_prop}*{months}', True)
        rows[r0 + 1] = (f'{role} gross dividends',
                        f"{window_sum('R')}*{share_base}", window_sum(earn_col),
                        True)
        rows[r0 + 2] = (f'{role} Thai salary tax',
                        f'({_thai_salary_tax_expr(sal_base)})/12*{months}',
                        f'({_thai_salary_tax_expr(sal_prop)})/12*{months}', True)
        rows[r0 + 3] = (f'{role} Thai dividend tax',
                        f'0.1*C{r0 + 1}', f'0.1*D{r0 + 1}', False)
        rows[r0 + 4] = (f'{role} take-home after Thai tax',
                        f'C{r0}+C{r0 + 1}-C{r0 + 2}-C{r0 + 3}',
                        f'D{r0}+D{r0 + 1}-D{r0 + 2}-D{r0 + 3}', False)
        rows[r0 + 5] = (f'{role} average monthly take-home',
                        f'C{r0 + 4}/{months}', f'D{r0 + 4}/{months}', False)
    assert [rows[r][0] for r in sorted(rows)] == V3_PERSONAL_LABELS

    for r, (label, base, prop, convert) in sorted(rows.items()):
        put(ws, f'B{r}', label, fill=GREY)
        wrap_fx = f'({base})/{fx}' if convert else base
        wrap_fx_prop = f'({prop})/{fx}' if convert else prop
        put(ws, f'C{r}', f'=IF({gate},"N/A",{wrap_fx})',
            fmt=MONEY, fill=GREEN, halign='right')
        put(ws, f'D{r}', f'=IF({gate},"N/A",{wrap_fx_prop})',
            fmt=MONEY, fill=GREEN, halign='right')
        put(ws, f'E{r}', (f'=IF(OR({gate},NOT(ISNUMBER(C{r})),'
                          f'NOT(ISNUMBER(D{r}))),"N/A",D{r}-C{r})'),
            fmt=MONEY, bold=True, halign='right')
        put(ws, f'F{r}', (f'=IF(OR({gate},NOT(ISNUMBER(C{r})),C{r}=0),'
                          f'"N/A",E{r}/C{r})'), fmt=PCT, halign='right')

    # keep the director one-pager at rows 2-32 even with the distant block
    ws.print_area = 'B2:I32'


def _build_v3_dashboard(wb):
    """V2 director dashboard plus the distant personal reference block."""
    ws = _build_v2_dashboard(wb)
    _add_v3_personal_reference(ws)
    return ws


def build_company_focus_v3_workbook(source: Path, output: Path) -> None:
    source, output = Path(source), Path(output)
    wb, replaced = convert_source_workbook(source)
    original_sheets = [ws.title for ws in wb.worksheets]

    _build_v3_dashboard(wb)
    _build_v2_update_guide(wb)
    _build_v2_source_check(wb)
    _build_v2_operating_model(wb)
    _build_v2_company_calculation(wb)

    model = [wb[t] for t in V3_MODEL_SHEETS]
    rest = [ws for ws in wb.worksheets if ws.title not in V3_MODEL_SHEETS]
    wb._sheets = model + rest            # deterministic order: dashboard first
    wb.active = 0
    wb['Operating Model'].sheet_state = 'hidden'
    wb['Company Calculation'].sheet_state = 'hidden'
    wb.calculation = CalcProperties(fullCalcOnLoad=True)

    tmp = output.with_name(output.stem + '.tmp.xlsx')
    wb.save(tmp)
    try:
        validate_output(tmp, wb, model_sheets=V3_MODEL_SHEETS)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    os.replace(tmp, output)
    print(f'Converted {replaced} VBA-UDF formulas; sheets: '
          f'{[ws.title for ws in wb.worksheets][:5]} + {original_sheets}')
    print(f'Wrote {output}')


# ================================================================ V3.1 build ==
# Only the new sheet is added: V3's salary/dividend accounting and its
# counterfactual treatment of 2026 actual operating results stay unchanged.
V31_CHART_POINTS = 11
# (variable, first data column, first data row, chart anchor, X-axis title)
V31_CHART_SWEEPS = (
    ('CEO monthly salary', 2, 64, 'B19', 'CEO monthly salary (THB)'),
    ('COO monthly salary', 11, 64, 'K19', 'COO monthly salary (THB)'),
    ('CEO dividend share', 2, 80, 'B40', 'CEO dividend share'),
    ('COO dividend share', 11, 80, 'K40', 'COO dividend share'),
)


def _build_v31_interactive_charts(wb):
    """Plain-formula V3 sensitivities; numeric XY charts, no data tables/macros.

    Each salary point needs its own monthly corporate-tax roll-forward:
    taxing aggregate annual profit would incorrectly change monthly eligible
    dividends and the one-month cash-receipt lag. Helpers live in hidden
    AA:AM columns on this same sheet, so only one worksheet is added.
    """
    ws = wb.create_sheet('Interactive Charts')
    ws.sheet_properties.tabColor = '7030A0'
    ws.sheet_view.showGridLines = False
    ws.column_dimensions['A'].width = 2.5
    for col in range(2, 20):
        ws.column_dimensions[get_column_letter(col)].width = 12
    ws.column_dimensions['J'].width = 3
    ws.column_dimensions.group('AA', 'AM', hidden=True)
    for r in range(1, 95):
        ws.row_dimensions[r].height = 20

    def note(row, text, *, warning=False):
        put(ws, f'B{row}', text, border=False, wrap=True,
            fill=WARN_FILL if warning else None,
            color=WARN_FONT if warning else None, size=10)
        ws.merge_cells(f'B{row}:S{row}')

    put(ws, 'B2', 'V3.1 — interactive compensation sensitivity (THB)',
        bold=True, size=16, border=False)
    ws.merge_cells('B2:S2')
    note(3, 'Edit Company Dashboard C9:C12 for salaries/dividend shares; C6 selects '
            'the period; I9:I11 control the 2027 forecast. Each chart varies only '
            'its X input and holds the other three payment inputs fixed.')
    ws.row_dimensions[3].height = 32
    note(4, 'Personal compensation is visible on this sheet. 2026 actual YTD uses '
            'actual operating results with hypothetical pay, not historical '
            'payroll paid. No spreadsheet result authorizes a dividend.',
         warning=True)
    ws.row_dimensions[4].height = 32

    dash = "'Company Dashboard'"
    controls = [
        (6, 'View period (Dashboard C6)', f'={dash}!$C$6', None,
         'Latest actual month', "='Source Check'!$B$3", DATEFMT),
        (7, 'CEO monthly salary (C9)', f'={dash}!$C$9', MONEY0,
         'Revenue growth (I9)', f'={dash}!$I$9', PCT),
        (8, 'COO monthly salary (C10)', f'={dash}!$C$10', MONEY0,
         'Other expense growth (I10)', f'={dash}!$I$10', PCT),
        (9, 'CEO dividend share (C11)', f'={dash}!$C$11', PCT,
         'Seasonal weight (I11)', f'={dash}!$I$11', PCT),
        (10, 'COO dividend share (C12)', f'={dash}!$C$12', PCT,
         'Salary sweep minimum', 0, MONEY0),
        (11, 'Dividend sweep maximum', '100% minus the other executive share', None,
         'Salary sweep maximum', 600000, MONEY0),
    ]
    for r, label, value, fmt, right_label, right_value, right_fmt in controls:
        for first, last, text in (('B', 'D', label), ('K', 'M', right_label)):
            put(ws, f'{first}{r}', text, fill=GREY, wrap=True, size=9)
            ws.merge_cells(f'{first}{r}:{last}{r}')
        put(ws, f'E{r}', value, fill=BLUE, fmt=fmt, bold=True, size=10)
        ws.merge_cells(f'E{r}:I{r}')
        put(ws, f'N{r}', right_value, fill=YELLOW if r >= 10 else BLUE,
            fmt=right_fmt, bold=True, size=10)
        ws.merge_cells(f'N{r}:S{r}')
    ws.row_dimensions[11].height = 30

    valid_period = ','.join(f'{dash}!$C$6="{p}"' for p in V2_PERIODS)
    put(ws, 'B12', 'Chart input check', bold=True, fill=GREY)
    ws.merge_cells('B12:D12')
    put(ws, 'E12',
        f'=IF(OR({V2_SRC_GATE},{dash}!$C$14<>"OK",{dash}!$I$12<>"OK"),'
        '"BLOCKED - check dashboard/source inputs",'
        f'IF(NOT(OR({valid_period})),"BLOCKED - choose a dashboard view period",'
        'IF(AND(ISNUMBER($N$10),ISNUMBER($N$11),$N$10>=0,$N$11>$N$10),'
        '"OK","BLOCKED - salary sweep needs numeric 0 <= minimum < maximum")))',
        fill=GREEN, bold=True, wrap=True, size=10)
    ws.merge_cells('E12:S12')
    ws.row_dimensions[12].height = 30
    ws.conditional_formatting.add('E12', FormulaRule(
        formula=['$E$12<>"OK"'], fill=_fill(WARN_FILL),
        font=Font(color=WARN_FONT, bold=True)))
    dv = DataValidation(type='decimal', operator='greaterThanOrEqual',
                        formula1='0', allow_blank=False, showErrorMessage=True,
                        errorTitle='Invalid salary range',
                        error='Enter a nonnegative THB salary; maximum must exceed minimum.')
    ws.add_data_validation(dv)
    dv.add('N10:N11')

    # Period and dividend cash timing match V3, independent of its display FX.
    put(ws, 'AA2', "='Company Calculation'!$D$42", fmt=DATEFMT)
    put(ws, 'AB2', "='Company Calculation'!$D$43", fmt=DATEFMT)
    dates = "'Operating Model'!$A$16:$A$39"
    months = f'COUNTIFS({dates},">="&$AA$2,{dates},"<="&$AB$2)'
    put(ws, 'AC2', f'={months}', fmt=INT)
    for col, label in zip(
            ('AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AM'),
            ('Date', 'Pre-tax profit', 'Tax base YTD', 'Tax liability YTD',
             'After-tax profit', 'Eligible profit', 'EBITDA', 'CEO dividends received',
             'COO dividends received', 'CEO annual taxable salary',
             'COO annual taxable salary', 'CEO annual salary PIT', 'COO annual salary PIT')):
        put(ws, f'{col}3', label, bold=True, fill=GREY, wrap=True)

    def case_outputs(case_index, salary_ceo, salary_coo, share_ceo, share_coo):
        """Return (EBITDA, CEO net, COO net) bodies from a monthly V3 replay."""
        first = 4 + case_index * 24
        last = first + 23
        blocked = '$E$12<>"OK"'
        for col, salary in (('AJ', salary_ceo), ('AK', salary_coo)):
            put(ws, f'{col}{first}',
                f'=IF({blocked},NA(),MAX(0,{salary}*12-MIN({salary}*12*0.5,100000)-60000))',
                fmt=MONEY)
        for col, taxable in (('AL', f'$AJ${first}'), ('AM', f'$AK${first}')):
            put(ws, f'{col}{first}', f'=IF({blocked},NA(),{_pit_bands_expr(taxable)})',
                fmt=MONEY)

        for p in range(24):
            r, om, prev = first + p, 16 + p, first + p - 1
            january = p % 12 == 0
            bodies = {
                'AA': f"'Operating Model'!A{om}",
                'AB': f"'Operating Model'!G{om}+1000000-{salary_ceo}-{salary_coo}",
                'AC': f'AB{r}' if january else f'AC{prev}+AB{r}',
                'AD': f'MAX(0,AC{r})*0.2',
                'AE': f'AB{r}-AD{r}' if january else f'AB{r}-AD{r}+AD{prev}',
                'AF': f'IF(AND(AB{r}>0,AE{r}>0),AE{r},0)',
                'AG': f"AB{r}+'Operating Model'!H{om}-'Operating Model'!I{om}",
                # No opening January-2026 payable. January 2027 receives Dec 2026.
                'AH': '0' if p == 0 else f'AF{prev}*{share_ceo}',
                'AI': '0' if p == 0 else f'AF{prev}*{share_coo}',
            }
            for col, body in bodies.items():
                put(ws, f'{col}{r}', f'=IF({blocked},NA(),{body})',
                    fmt=DATEFMT if col == 'AA' else MONEY)

        def selected_sum(col):
            return (f'SUMIFS(${col}${first}:${col}${last},$AA${first}:$AA${last},'
                    f'">="&$AA$2,$AA${first}:$AA${last},"<="&$AB$2)')

        return (
            selected_sum('AG'),
            f'{salary_ceo}*$AC$2-$AL${first}/12*$AC$2+0.9*{selected_sum("AH")}',
            f'{salary_coo}*$AC$2-$AM${first}/12*$AC$2+0.9*{selected_sum("AI")}',
        )

    note(16, 'Y axes: total THB for the selected period, not monthly averages. '
             'Take-home = salary + dividends received - modeled Thai salary PIT '
             '- 10% dividend tax. No US tax, extra allowances or social security.')
    ws.row_dimensions[16].height = 32
    note(17, 'V3 dividend assumptions are preserved: positive monthly eligible '
             'after-tax profit, one-month receipt lag, no accumulated-loss/reserve '
             'gate. These economic illustrations are not legally available dividends.',
         warning=True)
    ws.row_dimensions[17].height = 32

    titles = ['Company EBITDA', 'CEO take-home', 'COO take-home']
    colors = ['1F4E79', '548235', 'C55A11']
    case_index = 0
    for variable, first_col, first_row, anchor, x_title in V31_CHART_SWEEPS:
        xcol = get_column_letter(first_col)
        title_row, header_row = first_row - 2, first_row - 1
        put(ws, f'{xcol}{title_row}', f'{variable} — chart data',
            bold=True, fill=GREY)
        ws.merge_cells(f'{xcol}{title_row}:{get_column_letter(first_col + 7)}{title_row}')
        headers = [x_title, *titles, 'CEO salary / month', 'COO salary / month',
                   'CEO dividend share', 'COO dividend share']
        for offset, header in enumerate(headers):
            put(ws, f'{get_column_letter(first_col + offset)}{header_row}', header,
                fill=GREY, bold=True, wrap=True, size=9)
        ws.row_dimensions[header_row].height = 44
        for point in range(V31_CHART_POINTS):
            r = first_row + point
            fraction = f'{point}/{V31_CHART_POINTS - 1}'
            if variable.endswith('salary'):
                x = f'$N$10+($N$11-$N$10)*{fraction}'
            else:
                other = '$E$10' if variable.startswith('CEO') else '$E$9'
                x = f'(1-{other})*{fraction}'
            put(ws, f'{xcol}{r}', f'=IF($E$12<>"OK",NA(),{x})',
                fmt=MONEY0 if variable.endswith('salary') else PCT, fill=BLUE)
            refs = ['$E$7', '$E$8', '$E$9', '$E$10']
            variable_index = ('CEO monthly salary', 'COO monthly salary',
                              'CEO dividend share', 'COO dividend share').index(variable)
            refs[variable_index] = f'${xcol}${r}'
            assumptions = []
            for offset, ref in enumerate(refs, 4):
                col = get_column_letter(first_col + offset)
                put(ws, f'{col}{r}', f'=IF($E$12<>"OK",NA(),{ref})',
                    fmt=MONEY0 if offset < 6 else PCT, fill=BLUE)
                assumptions.append(f'${col}${r}')
            for offset, body in enumerate(case_outputs(case_index, *assumptions), 1):
                put(ws, f'{get_column_letter(first_col + offset)}{r}',
                    f'=IF($E$12<>"OK",NA(),{body})', fmt=MONEY0, fill=GREEN)
            case_index += 1

        chart = ScatterChart()
        chart.title = f'{variable} sensitivity'
        chart.style = 13
        chart.scatterStyle = 'lineMarker'
        chart.x_axis.title = x_title
        chart.y_axis.title = 'Selected-period total (THB)'
        chart.x_axis.numFmt = '#,##0' if variable.endswith('salary') else '0%'
        chart.y_axis.numFmt = '#,##0'
        chart.x_axis.scaling.min = 0
        chart.legend.position = 'b'
        chart.width, chart.height = 19.0, 12.0
        chart.display_blanks = 'gap'
        chart.visible_cells_only = True
        xvalues = Reference(ws, min_col=first_col, min_row=first_row,
                            max_row=first_row + V31_CHART_POINTS - 1)
        for offset, color in enumerate(colors, 1):
            values = Reference(ws, min_col=first_col + offset, min_row=first_row - 1,
                               max_row=first_row + V31_CHART_POINTS - 1)
            series = Series(values, xvalues, title_from_data=True)
            series.graphicalProperties.line.solidFill = color
            series.graphicalProperties.line.width = 24000
            series.marker.symbol = 'circle'
            series.marker.size = 3
            series.marker.graphicalProperties.solidFill = color
            series.marker.graphicalProperties.line.solidFill = color
            series.smooth = False
            chart.series.append(series)
        ws.add_chart(chart, anchor)

    # A separately labeled current package avoids implying a sampled X point
    # necessarily equals the current dashboard salary or dividend share.
    current = case_outputs(case_index, '$E$7', '$E$8', '$E$9', '$E$10')
    for label_col, value_col, end_col, label, body in zip(
            ('B', 'H', 'N'), ('E', 'K', 'Q'), ('G', 'M', 'S'),
            titles, current):
        put(ws, f'{label_col}14', f'Current {label}', bold=True, fill=GREY,
            wrap=True, size=9)
        ws.merge_cells(f'{label_col}14:{get_column_letter(openpyxl.utils.column_index_from_string(value_col) - 1)}14')
        put(ws, f'{value_col}14', f'=IF($E$12<>"OK","N/A",{body})',
            fmt=MONEY0, bold=True, fill=GREEN)
        ws.merge_cells(f'{value_col}14:{end_col}14')
    ws.row_dimensions[14].height = 32
    note(93, 'Chart source tables above remain visible after Google Sheets import. '
             'Salary sweeps use N10:N11; dividend sweeps stop at 100% minus the '
             'other executive share. Invalid inputs show gaps, not zero results.')
    ws.row_dimensions[93].height = 32
    ws.freeze_panes = 'B19'
    ws.print_area = 'B2:S94'
    page_setup(ws)
    ws.page_setup.fitToHeight = 0
    # Keep chart objects intact when printing: controls/salaries, dividends,
    # then the auditable source tables on separate pages.
    ws.row_breaks.append(Break(id=38))
    ws.row_breaks.append(Break(id=60))
    return ws


def build_company_focus_v31_workbook(source: Path, output: Path) -> None:
    source, output = Path(source), Path(output)
    wb, replaced = convert_source_workbook(source)
    original_sheets = [ws.title for ws in wb.worksheets]
    _build_v3_dashboard(wb)
    _build_v2_update_guide(wb)
    _build_v2_source_check(wb)
    _build_v2_operating_model(wb)
    _build_v2_company_calculation(wb)
    _build_v31_interactive_charts(wb)

    model = [wb[t] for t in V31_MODEL_SHEETS]
    rest = [ws for ws in wb.worksheets if ws.title not in V31_MODEL_SHEETS]
    wb._sheets = model + rest
    wb.active = 0
    wb['Operating Model'].sheet_state = 'hidden'
    wb['Company Calculation'].sheet_state = 'hidden'
    wb.calculation = CalcProperties(fullCalcOnLoad=True)
    tmp = output.with_name(output.stem + '.tmp.xlsx')
    wb.save(tmp)
    try:
        validate_output(tmp, wb, model_sheets=V31_MODEL_SHEETS)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    os.replace(tmp, output)
    print(f'Converted {replaced} VBA-UDF formulas; sheets: '
          f'{[ws.title for ws in wb.worksheets][:6]} + {original_sheets}')
    print(f'Wrote {output}')

# ================================================================== V4 build ==
# Company Focus V4: the V3 workbook rebuilt as a prospective 2027 executive
# incentive proposal plus one reasoning sheet, "V4 Plan", placed after the
# dashboard. The proposal is THB 200,000 monthly base salaries per executive
# (dashboard C9:C10, effective 1 January 2027 only — 2025/2026 history keeps
# the fixed baseline) with quarterly service-award forecast targets
# (V4 Plan C8:D11, default THB 750,000 per executive per quarter) that post
# once each in March/June/September/December 2027 payroll. Awards are
# employment compensation: they reduce management expense, pretax profit,
# EBITDA, tax and retained earnings in the quarter paid, and nothing is
# earned or payable until pre-agreed service KPIs and the actual quarter
# results are certified — weak or uncertified quarters are entered as zero.
# Hypothetical dividends are modeled only as a quarterly, non-authorizing
# sensitivity after modeled loss recovery (entitlement shares and payout
# ratio default to zero). The plan sheet carries the source performance
# trend, the company-first EBITDA comparison against the fixed THB 500,000
# salary baseline, the executive package summary, the CCC s.1200/s.1201/
# s.1202 and Revenue Code s.65 ter(8)/s.65 ter(19) guardrails and the
# implementation checklist. Everything is analysis for planning only — the
# workbook never authorizes any payment.

V4_SCENARIO_DEFAULTS = {'C6': '2027 forecast', 'C9': 200000, 'C10': 200000,
                        'C11': 0, 'C12': 0, 'I13': 0}

V4_PLAN_TITLE = 'V4 Plan — company-first quarterly executive incentive proposal'
V4_PLAN_BLOCKED = ('BLOCKED - quarterly award targets must be numeric and '
                   'zero or positive')
V4_PLAN_GATE = "'V4 Plan'!$C$13<>\"OK\""

# Company Calculation month row (rows 4-39 = Jan 2025..Dec 2027) → the V4
# Plan quarter-award cells posted there. AI:AJ carry the mapped amounts only
# in March/June/September/December 2027 and zero in every other month; the
# builder and the V4 tests share this one mapping.
V4_QUARTER_AWARD_ROWS = {30: ('C8', 'D8'), 33: ('C9', 'D9'),
                         36: ('C10', 'D10'), 39: ('C11', 'D11')}


def _build_v4_plan(wb):
    ws = wb.create_sheet('V4 Plan')
    ws.sheet_properties.tabColor = '7030A0'
    ws.sheet_view.showGridLines = False
    for col, w in dict(A=2.5, B=46, C=21, D=21, E=16, F=16, G=52).items():
        ws.column_dimensions[col].width = w

    dash = "'Company Dashboard'"
    gate = f'OR({V2_SRC_GATE},{dash}!$C$14<>"OK")'
    cc = "'Company Calculation'"
    dt = f'{cc}!$A$4:$A$39'

    def rng(col):
        return f'{cc}!${col}$4:${col}$39'

    def wsum(col, lo, hi):
        """SUMIFS over the engine rows; lo/hi are (year, month) tuples or a
        full DATE()/cell expression string."""
        lo = f'DATE({lo[0]},{lo[1]},1)' if isinstance(lo, tuple) else lo
        hi = f'DATE({hi[0]},{hi[1]},1)' if isinstance(hi, tuple) else hi
        return f'SUMIFS({rng(col)},{dt},">="&{lo},{dt},"<="&{hi})'

    def s27(col):
        return wsum(col, (2027, 1), (2027, 12))

    def text(r, value, *, size=10):
        put(ws, f'B{r}', value, italic=True, size=size, wrap=True,
            border=False)
        ws.merge_cells(f'B{r}:G{r}')
        ws.row_dimensions[r].height = 13.5 * max(1, -(-len(value) // 130)) + 4

    def section(r, title):
        put(ws, f'B{r}', title, bold=True, size=12, fill=GREY)
        ws.merge_cells(f'B{r}:G{r}')

    def note(r, value, first='D'):
        put(ws, f'{first}{r}', value, italic=True, size=9, wrap=True,
            border=False)
        ws.merge_cells(f'{first}{r}:G{r}')
        ws.row_dimensions[r].height = max(
            ws.row_dimensions[r].height or 0,
            12 * max(1, -(-len(value) // 85)) + 3)

    def val(r, label, formula, *, fmt=MONEY0, note_text=None, bold=False):
        put(ws, f'B{r}', label, fill=GREY, wrap=True)
        put(ws, f'C{r}', f'=IF({gate},"N/A",{formula})', fill=GREEN, fmt=fmt,
            bold=bold, halign='right')
        if note_text:
            note(r, note_text)

    put(ws, 'B1', V4_PLAN_TITLE, bold=True, size=14, border=False)
    ws.merge_cells('B1:G1')
    text(3, 'A prospective 2027 executive incentive proposal built on the '
            'source workbook\'s 2025 results and the January–August 2026 '
            'recovery (section 2): measurable service performance, '
            'quarterly certification, company affordability and legal '
            'classification. It takes effect on 1 January 2027 — no 2025 '
            'or 2026 compensation is rewritten. All money is THB (the '
            'row-801 THB/USD selector does not apply here). Analysis for '
            'planning only — not legal or tax advice; confirm every '
            'statutory point with Thai counsel and the company auditor '
            'before acting.')
    text(4, 'Each quarterly amount is a forecast target, not an earned '
            'payment: it stays a forecast until the pre-agreed service '
            'KPIs, the actual quarter results, positive pre-award EBITDA, '
            'cash affordability and the required approvals are certified. '
            'Actual weak or uncertified quarters are entered as zero — the '
            'workbook does not create an award merely because a forecast '
            'target exists, and awards are never a percentage of accounting '
            'profit, after-tax profit or dividends.')

    # --------------------------- 1 · quarterly service-award proposal ----
    section(6, '1 · Quarterly service-award proposal (2027)')
    for col, h in (('B', 'Quarter'), ('C', 'CEO forecast award'),
                   ('D', 'COO forecast award'), ('E', 'Fixed-baseline EBITDA'),
                   ('F', 'Proposed EBITDA after award'),
                   ('G', 'Status / notes')):
        put(ws, f'{col}7', h, bold=True, fill=GREY, wrap=True,
            halign='left' if col == 'B' else 'center')
    quarters = [(8, 'Q1 — paid March 2027', 1, 3),
                (9, 'Q2 — paid June 2027', 4, 6),
                (10, 'Q3 — paid September 2027', 7, 9),
                (11, 'Q4 — paid December 2027', 10, 12)]
    for r, label, m0, m1 in quarters:
        put(ws, f'B{r}', label, fill=GREY, wrap=True)
        for col in 'CD':
            put(ws, f'{col}{r}', 750000, fill=YELLOW, fmt=MONEY0, bold=True,
                halign='right')
        for col, eng in (('E', 'M'), ('F', 'Y')):
            put(ws, f'{col}{r}',
                f'=IF({gate},"N/A",{wsum(eng, (2027, m0), (2027, m1))}'
                f'+{wsum("G", (2027, m0), (2027, m1))}'
                f'-{wsum("H", (2027, m0), (2027, m1))})',
                fill=GREEN, fmt=MONEY0, halign='right')
        put(ws, f'G{r}',
            f'=IF({gate},"N/A",IF($E{r}<=0,'
            f'"NO AWARD RECOMMENDED — FORECAST EBITDA NOT POSITIVE",'
            f'IF($F{r}>=$E{r},'
            f'"FORECAST EBITDA ABOVE BASELINE — CERTIFICATION STILL '
            f'REQUIRED","FORECAST EBITDA NOT ABOVE BASELINE")))',
            fill=GREEN, bold=True, size=9, wrap=True)
        ws.row_dimensions[r].height = 30
    put(ws, 'B12', 'Annual total', fill=GREY, wrap=True)
    for col in 'CDEF':
        put(ws, f'{col}12', f'=IF({gate},"N/A",SUM({col}8:{col}11))',
            fill=GREEN, fmt=MONEY0, bold=True, halign='right')
    put(ws, 'G12', 'EBITDA = pre-tax profit + D&A − interest, per quarter',
        italic=True, size=9, wrap=True, border=False)
    put(ws, 'B13', 'Input status', bold=True, fill=GREY)
    put(ws, 'C13', ('=IF(AND(ISNUMBER($C$8),ISNUMBER($D$8),ISNUMBER($C$9),'
                    'ISNUMBER($D$9),ISNUMBER($C$10),ISNUMBER($D$10),'
                    'ISNUMBER($C$11),ISNUMBER($D$11),'
                    '$C$8>=0,$D$8>=0,$C$9>=0,$D$9>=0,$C$10>=0,$D$10>=0,'
                    '$C$11>=0,$D$11>=0),"OK",'
                    f'"{V4_PLAN_BLOCKED}")'),
        fill=GREEN, bold=True, wrap=True)
    ws.merge_cells('C13:G13')
    ws.row_dimensions[13].height = 28
    ws.conditional_formatting.add('C13', FormulaRule(
        formula=['$C$13<>"OK"'], fill=_fill(WARN_FILL),
        font=Font(color=WARN_FONT, bold=True)))
    dv_award = DataValidation(
        type='decimal', operator='greaterThanOrEqual', formula1='0',
        allow_blank=False, errorTitle='Invalid award target',
        error='Quarterly award targets must be numeric and zero or '
              'positive (THB).')
    ws.add_data_validation(dv_award)
    dv_award.add('C8:D11')
    text(14, 'Forecast affordability is not entitlement: the status column '
             'is an affordability indicator — the quarter\'s forecast '
             'EBITDA against the fixed-baseline track — never an automatic '
             'contractual right to payment.')

    # ------------------------------------------- 2 · source trend ---------
    section(15, '2 · Source performance context')
    for col, h in (('B', 'Period'), ('C', 'Revenue'), ('D', 'Pre-tax profit'),
                   ('E', 'EBITDA')):
        put(ws, f'{col}16', h, bold=True, fill=GREY,
            halign='left' if col == 'B' else 'center')
    note(16, 'Engine basis — every figure is a live SUMIFS over the '
             'source-linked Company Calculation rows (revenue C, pre-tax '
             'F, D&A G, interest H); EBITDA = pre-tax profit + D&A − '
             'interest. The January–August windows follow the latest '
             'actual month (Source Check B3) and lengthen automatically as '
             'new months are pasted.')
    for r, label, win in (
            (17, '2025 full-year actual', ((2025, 1), (2025, 12))),
            (18, '2025 January–August actual',
             ((2025, 1), "DATE(2025,MONTH('Source Check'!$B$3),1)")),
            (19, '2026 January–August actual',
             ((2026, 1), "'Source Check'!$B$3"))):
        put(ws, f'B{r}', label, fill=GREY, wrap=True)
        put(ws, f'C{r}', f'=IF({gate},"N/A",{wsum("C", *win)})', fill=GREEN,
            fmt=MONEY, halign='right')
        put(ws, f'D{r}', f'=IF({gate},"N/A",{wsum("F", *win)})', fill=GREEN,
            fmt=MONEY, halign='right')
        put(ws, f'E{r}', f'=IF({gate},"N/A",D{r}+{wsum("G", *win)}'
                         f'-{wsum("H", *win)})', fill=GREEN, fmt=MONEY,
            halign='right')
    put(ws, 'B20', 'Year-on-year change (January–August)', fill=GREY,
        wrap=True)
    for col in 'CDE':
        put(ws, f'{col}20', f'=IF({gate},"N/A",{col}19-{col}18)', fill=GREEN,
            fmt=MONEY, bold=True, halign='right')

    # --------------------------- 3 · 2027 company impact ------------------
    section(22, '3 · 2027 company impact vs fixed THB 500k salary baseline')
    text(23, 'Both tracks run identical operating forecasts — the same '
             'revenue, other costs and benchmark payroll — so only '
             'compensation differs. Forecast revenue growth is never '
             'counted again as an award-created benefit, and awards stay '
             'in compensation expense: no EBITDA improvement is '
             'manufactured by excluding earned awards.')
    val(24, 'Baseline executive payroll (fixed THB 500,000 salaries)',
        s27('K'),
        note_text='fixed baseline: dashboard F9:F10 — no awards, no dividends')
    val(25, 'Proposed base-salary payroll', f'{s27("U")}+{s27("V")}',
        note_text='dashboard C9:C10 from the 1 January 2027 effective date')
    val(26, 'Proposed service awards (four certified quarters)',
        f'{s27("AI")}+{s27("AJ")}',
        note_text='posted once each in March/June/September/December 2027')
    val(27, 'Proposed total executive payroll', 'C25+C26')
    val(28, 'Compensation savings vs baseline', 'C24-C27', bold=True)
    val(29, 'Baseline 2027 EBITDA', f'{s27("M")}+{s27("G")}-{s27("H")}')
    val(30, 'Proposed 2027 EBITDA after awards',
        f'{s27("Y")}+{s27("G")}-{s27("H")}')
    val(31, 'EBITDA delta (proposed − baseline)', 'C30-C29', bold=True,
        note_text='awards reduce EBITDA in the quarter they are paid')
    val(32, 'Baseline 2027 pre-tax profit', s27('M'))
    val(33, 'Proposed 2027 pre-tax profit', s27('Y'))
    val(34, 'Pre-tax delta (proposed − baseline)', 'C33-C32')
    val(35, 'Baseline 2027 after-tax profit', s27('Q'))
    val(36, 'Proposed 2027 after-tax profit', s27('AC'))
    val(37, 'After-tax delta (proposed − baseline)', 'C36-C35', bold=True,
        note_text='20% corporate tax provision on year-to-date profit')
    put(ws, 'B38', 'Company status (annual EBITDA delta)', fill=GREY,
        wrap=True)
    put(ws, 'C38', f'=IF({gate},"N/A",IF($C$31>0,"COMPANY EBITDA BETTER",'
                   f'IF($C$31=0,"COMPANY EBITDA NEUTRAL",'
                   f'"COMPANY EBITDA LOWER")))',
        fill=GREEN, bold=True, halign='right', size=10)
    note(38, 'THB 900,000 per executive per quarter reaches the '
             'salary-benchmark personal net only by reducing this EBITDA '
             'delta to zero.')

    # ---------------------------- 4 · executive package summary ----------
    section(40, '4 · 2027 executive package summary')
    for col, h in (('B', 'Component'), ('C', 'CEO'), ('D', 'COO')):
        put(ws, f'{col}41', h, bold=True, fill=GREY,
            halign='left' if col == 'B' else 'center')
    put(ws, 'H41', 'Engine helpers — taxable income and annual PIT, THB '
                   '(outside the print area)', italic=True, size=9,
        border=False)
    put(ws, 'B42', 'Annual base salary', fill=GREY, wrap=True)
    for col, dcell in (('C', '$C$9'), ('D', '$C$10')):
        put(ws, f'{col}42', f'=IF({gate},"N/A",{dash}!{dcell}*12)',
            fill=GREEN, fmt=MONEY, halign='right')
    note(42, 'dashboard C9:C10 × 12; effective 1 January 2027', first='E')
    award_rows = [(43, 'Q1 service award (March 2027)', 'C8', 'D8'),
                  (44, 'Q2 service award (June 2027)', 'C9', 'D9'),
                  (45, 'Q3 service award (September 2027)', 'C10', 'D10'),
                  (46, 'Q4 service award (December 2027)', 'C11', 'D11')]
    for r, label, ccell, dcell in award_rows:
        put(ws, f'B{r}', label, fill=GREY, wrap=True)
        for col, cell in (('C', ccell), ('D', dcell)):
            ref = f'${cell[0]}${cell[1:]}'
            put(ws, f'{col}{r}', f'=IF({gate},"N/A",{ref})', fill=GREEN,
                fmt=MONEY, halign='right')
    put(ws, 'B47', 'Total service awards', fill=GREY, wrap=True)
    for col in 'CD':
        put(ws, f'{col}47', f'=IF({gate},"N/A",SUM({col}43:{col}46))',
            fill=GREEN, fmt=MONEY, halign='right')
    put(ws, 'B48', 'Annual gross employment income', fill=GREY, wrap=True)
    for col in 'CD':
        put(ws, f'{col}48', f'=IF({gate},"N/A",{col}42+{col}47)',
            fill=GREEN, fmt=MONEY, bold=True, halign='right')
    note(48, 'employment income — service awards are compensation, not '
             'dividends', first='E')
    put(ws, 'B49', 'Thai employment PIT', fill=GREY, wrap=True)
    for col, pit in (('C', '$I$42'), ('D', '$I$43')):
        put(ws, f'{col}49', f'=IF({gate},"N/A",{pit})', fill=GREEN,
            fmt=MONEY, halign='right')
    note(49, 'progressive Thai PIT (50% expense deduction capped at THB '
             '100,000, THB 60,000 allowance); computed in THB', first='E')
    put(ws, 'B50', 'Annual net employment income', fill=GREY, wrap=True)
    for col in 'CD':
        put(ws, f'{col}50', f'=IF({gate},"N/A",{col}48-{col}49)',
            fill=GREEN, fmt=MONEY, bold=True, halign='right')
    put(ws, 'B51', 'Average monthly gross', fill=GREY, wrap=True)
    for col in 'CD':
        put(ws, f'{col}51', f'=IF({gate},"N/A",{col}48/12)', fill=GREEN,
            fmt=MONEY, halign='right')
    put(ws, 'B52', 'Average monthly net', fill=GREY, wrap=True)
    for col in 'CD':
        put(ws, f'{col}52', f'=IF({gate},"N/A",{col}50/12)', fill=GREEN,
            fmt=MONEY, halign='right')
    for hcell, src in (('H42', 'C48'), ('H43', 'D48')):
        put(ws, hcell, f'=IF({gate},"N/A",MAX(0,{src}-MIN({src}*0.5,100000)'
                       f'-60000))', fmt=MONEY, fill=GREEN, halign='right')
    for icell, taxable in (('I42', '$H$42'), ('I43', '$H$43')):
        put(ws, icell, f'=IF({gate},"N/A",{_pit_bands_expr(taxable)})',
            fmt=MONEY, fill=GREEN, halign='right')

    # ------------------- 5 · hypothetical dividend sensitivity -----------
    section(55, '5 · Hypothetical quarterly dividend sensitivity')
    text(56, 'Dividends are modeled only as a quarterly, non-authorizing '
             'sensitivity after modeled loss recovery: at each 2027 '
             'quarter end the engine\'s hypothetical modeled surplus '
             'before reserve/legal review is MAX(0, prior closing retained '
             'earnings + current after-tax profit), the modeled pool is '
             'that surplus × the payout ratio, illustrative executive '
             'receipts are the pool × the assumed entitlement shares, and '
             'the full pool — not only the two executives\' receipts — '
             'leaves retained earnings. The source does not identify the '
             'statutory-reserve balance, share rights or later retained '
             'balance, so a positive modeled amount still requires current '
             'accounts, uncovered-loss recovery, reserve appropriation, '
             'approvals, actual share/class rights and a cash review.')
    put(ws, 'B57', 'Opening unappropriated retained earnings (January 2026)',
        fill=GREY, wrap=True)
    put(ws, 'C57', '=BS!$D$73', fill=BLUE, fmt=MONEY, bold=True,
        halign='right')
    note(57, 'live source balance (BS!D73)')
    val(58, 'Projected December 2026 closing retained earnings',
        f'{cc}!$T$27',
        note_text='identical on both tracks — the proposal starts '
                  '1 January 2027')
    val(59, 'Projected December 2027 closing retained earnings (proposed '
            'track)', f'{cc}!$AH$39',
        note_text='hypothetical modeled surplus before reserve/legal review')
    val(60, 'Hypothetical payout ratio of modeled surplus',
        f'{dash}!$I$13', fmt=PCT,
        note_text='dashboard I13 (blue, zero by default)')
    put(ws, 'B61', 'Hypothetical CEO / COO entitlement shares', fill=GREY,
        wrap=True)
    put(ws, 'C61', f'=IF({gate},"N/A",{dash}!$C$11)', fill=GREEN, fmt=PCT,
        halign='right')
    put(ws, 'D61', f'=IF({gate},"N/A",{dash}!$C$12)', fill=GREEN, fmt=PCT,
        halign='right')
    note(61, 'dashboard C11:C12 (blue, zero by default); allocation '
             'assumptions only — actual rights follow the share register '
             '(s.1200)', first='E')
    val(62, 'Modeled full distribution pool, 2027', s27('AG'),
        note_text='hypothetical modeled surplus before reserve/legal '
                  'review; never distributable profit or an approval')
    put(ws, 'B63', 'Illustrative CEO / COO receipts from the modeled pool',
        fill=GREY, wrap=True)
    put(ws, 'C63', f'=IF({gate},"N/A",{s27("AE")})', fill=GREEN, fmt=MONEY,
        halign='right')
    put(ws, 'D63', f'=IF({gate},"N/A",{s27("AF")})', fill=GREEN, fmt=MONEY,
        halign='right')
    note(63, 'received one month after declaration in the personal '
             'reference; a December 2027 declaration is January 2028 cash',
         first='E')
    put(ws, 'B64', 'Dividend sensitivity status', fill=GREY, wrap=True)
    put(ws, 'C64', f'=IF({gate},"N/A",IF($C$62>0,'
                   f'"MODELED SENSITIVITY ONLY - NOT AN AUTHORIZATION: '
                   f'requires current accounts, uncovered-loss recovery '
                   f'(s.1201), the s.1202 reserve appropriation, required '
                   f'approvals, actual share/class rights (s.1200) and a '
                   f'cash review",'
                   f'"NO DIVIDEND MODELED - modeled retained earnings do '
                   f'not yet support a distribution; a profitable month, '
                   f'positive cash, a positive annual forecast, an entered '
                   f'percentage or a spreadsheet status never authorizes '
                   f'one"))',
        fill=GREEN, bold=True, wrap=True, size=9)
    ws.merge_cells('C64:G64')
    ws.row_dimensions[64].height = 54

    # ------------------------------------------- 6 · legal guardrails ----
    section(66, '6 · Legal and tax guardrails')
    text(67, 'Share rights — CCC s.1200: distributions follow the amounts '
             'paid on shares unless preference-share rights provide '
             'otherwise. The share register and the articles, not '
             'dashboard percentages, fix who may receive what.')
    text(68, 'Distribution gates — CCC s.1201: a dividend may be declared '
             'only out of profit and only where no loss remains uncovered; '
             'a distribution contrary to these limits can be reclaimed '
             'from recipients and exposes directors.')
    text(69, 'Legal reserve — CCC s.1202: appropriate at least 5% of the '
             'distribution to the reserve until it reaches 10% of '
             'registered capital or the higher articles threshold; the '
             'reserve need not be complete before a first lawful dividend.')
    text(70, 'Deduction guardrails — Revenue Code s.65 ter(8) disallows as '
             'a company expense the part of a shareholder\'s salary paid '
             'in excess of an appropriate amount; whether an examiner also '
             'treats the excess as a dividend is an assessment position, '
             'not the section\'s text. s.65 ter(19) disallows expenses '
             'payable from profits after the accounting period — a '
             'deduction restriction, not a bar on service-contingent pay. '
             'Award entries here are model inputs; tax treatment follows '
             'the actual contract and documentation — confirm both with '
             'Thai tax counsel.')
    text(71, 'Design evidence only — Revenue Department ruling กค 0706/3899 '
             '(8 May 2006) accepted director remuneration computed from '
             'monthly sales rather than year-end profits; it evidences '
             'that sales-based service remuneration can be accepted on '
             'its facts, not a universal safe harbor.')
    text(72, 'No relabelling — employment awards and ownership dividends '
             'are separate legal categories and cannot be relabelled '
             'interchangeably. Awards under this proposal are employment '
             'compensation, stay in payroll expense and are payroll-'
             'withheld; dividends follow the shareholder process below.')
    text(73, 'No spreadsheet authorization — a profitable month, positive '
             'cash, a positive annual forecast, an entered percentage or a '
             'workbook status never authorizes a dividend.')
    text(74, 'Primary sources — Revenue Code (English) '
             'https://www.rd.go.th/english/37764.html · Thai pages '
             'https://www.rd.go.th/31480.html · DBD company-law comparison '
             'https://www.dbd.go.th/en/data-storage/attachment/'
             'cb39845a33e46980d6cd911d.pdf')
    text(75, 'Narrow cautions — obtain employment-law advice before '
             'changing an existing salary or relying on any severance '
             'effect; verify current social-security treatment separately; '
             'capital reduction is a separate corporate action that '
             'creates neither cash nor profit.')

    # --------------------------------- 7 · implementation checklist ------
    section(77, '7 · Implementation checklist')
    text(78, 'C1 · Execute a written prospective service-award agreement '
             'effective 1 January 2027, before the period begins — the '
             'workbook is not the contract.')
    text(79, 'C2 · Agree measurable service/operating KPIs before each '
             'quarter — genuine services and operations, never a '
             'percentage of accounting profit, after-tax profit or '
             'dividends.')
    text(80, 'C3 · Certify each quarter against the KPIs and the actual '
             'quarter results before any award is payable; enter zero for '
             'a failed, weak or unapproved quarter and pay the certified '
             'amount once, through quarter-end payroll, with withholding.')
    text(81, 'C4 · Review deduction treatment with the accountant and tax '
             'adviser in each period an award is paid.')
    text(82, 'C5 · Run a current-account and cash review before each '
             'quarterly payout.')
    text(83, 'C6 · Run shareholder distributions as a separate process: '
             'share register and class rights (s.1200), profit and '
             'uncovered-loss gates (s.1201), reserve appropriation '
             '(s.1202), required approvals and cash.')
    text(84, 'C7 · Employment-law review before changing any existing '
             'salary contract; planning only — not legal or tax advice; '
             'confirm the CCC, Revenue Code and share-register points with '
             'Thai counsel and the company auditor before acting.')

    page_setup(ws)
    ws.print_area = 'B1:G84'
    return ws


def _augment_v4_personal_reference(ws) -> None:
    """V4 only: employment-income labels and quarterly-award-aware formulas.

    The proposed column sums the proposed base salaries (Company
    Calculation U:V — the fixed baseline through December 2026, the
    dashboard proposal from January 2027) plus every mapped service award
    inside the selected display period, and Thai PIT as the annual salary
    PIT allocated over the selected months plus the incremental annual PIT
    ``tax(salary + included awards) - tax(salary)``. The V3 baseline column
    is untouched, so both 2026 views show the baseline salary track. The
    taxable incomes and annual PIT chains are precomputed in helper cells
    at G/H (rows 809-817, outside the B2:I32 print area) so no written
    formula approaches the Excel 8,192-character limit.
    """
    cc = "'Company Calculation'"
    dt = f'{cc}!$A$4:$A$39'
    months = f'COUNTIFS({dt},">="&{cc}!$D$42,{dt},"<="&{cc}!$D$43)'
    gate = f'OR({V2_SRC_GATE},$C$14<>"OK",$I$12<>"OK",$C$805<>"OK")'
    fx = 'IF($C$803="USD",$C$804,1)'

    def window_sum(col):
        return (f'SUMIFS({cc}!${col}$4:${col}$39,{dt},">="&{cc}!$D$42,'
                f'{dt},"<="&{cc}!$D$43)')

    put(ws, 'B806', 'USD values = THB ÷ planning rate; Thai taxes are '
                    'calculated in THB before display conversion. Dividends '
                    'apply the illustrative 10% dividend withholding/'
                    'final-election assumption; residence, eligibility, '
                    'inclusion and dividend-credit treatment require '
                    'individual review.',
        italic=True, size=9, border=False)
    put(ws, 'G808', 'Engine helpers — annual THB (outside the print area)',
        italic=True, size=9, border=False)

    for role, r0, sal_prop, sal_base, sal_col, award_col in (
            ('CEO', 809, '$C$9', '$F$9', 'U', 'AI'),
            ('COO', 815, '$C$10', '$F$10', 'V', 'AJ')):
        ws[f'B{r0}'] = f'{role} gross employment income'
        ws[f'B{r0 + 2}'] = f'{role} Thai employment PIT'
        award = window_sum(award_col)
        # annual proposed salary: dashboard proposal inside 2027 windows,
        # fixed baseline (F9/F10) inside 2025/2026 windows
        annual_sal = (f'IF({cc}!$D$42>=DATE(2027,1,1),'
                      f'{sal_prop},{sal_base})')
        salary_taxable, with_award_taxable = f'$G${r0}', f'$H${r0}'
        salary_tax, with_award_tax = f'$G${r0 + 2}', f'$H${r0 + 2}'
        annual = f'({annual_sal}*12)'
        with_award = f'({annual_sal}*12+{award})'
        put(ws, f'G{r0}',
            f'=MAX(0,{annual}-MIN({annual}*0.5,100000)-60000)',
            fmt=MONEY, fill=GREEN, halign='right')
        put(ws, f'H{r0}',
            f'=MAX(0,{with_award}-MIN({with_award}*0.5,100000)-60000)',
            fmt=MONEY, fill=GREEN, halign='right')
        put(ws, f'G{r0 + 2}', f'={_pit_bands_expr(salary_taxable)}',
            fmt=MONEY, fill=GREEN, halign='right')
        put(ws, f'H{r0 + 2}', f'={_pit_bands_expr(with_award_taxable)}',
            fmt=MONEY, fill=GREEN, halign='right')
        put(ws, f'D{r0}',
            f'=IF({gate},"N/A",({window_sum(sal_col)}+{award})/{fx})',
            fmt=MONEY, fill=GREEN, halign='right')
        put(ws, f'D{r0 + 2}',
            f'=IF({gate},"N/A",(({salary_tax}/12*{months})'
            f'+IF({award}>0,{with_award_tax}-{salary_tax},0))/{fx})',
            fmt=MONEY, fill=GREEN, halign='right')



def _augment_v4_company_calculation(ws) -> None:
    """V4 only: 2027 effective date, quarter-end service awards in AI:AJ,
    award-aware proposed W:Y and hypothetical pre-reserve dividends AD:AH.

    Rows 4-39 are Jan 2025..Dec 2027. U:V carry the fixed baseline salaries
    through December 2026 (row 27) and the dashboard proposal only from
    January 2027, so no 2025/2026 history is rewritten and no fictitious
    retained-earnings recovery is created before the effective date. AI:AJ
    read the mapped V4 Plan award cells (March/June/September/December 2027
    = rows 30/33/36/39) and are zero in every other month; W:Y add them to
    the proposed track exactly once per payment quarter. AD is the
    hypothetical modeled surplus — MAX(0, prior closing retained + current
    after-tax profit) — at 2027 quarter ends only; AE:AF split the modeled
    pool (AD × payout ratio) by the assumed entitlement shares, AG is the
    full pool and AH subtracts the full pool rather than only the two
    executives' receipts, correcting the inherited engine's conflation of
    executive percentages with the company's total distribution.
    """
    dash = "'Company Dashboard'"
    gate, plan_gate = V2_SRC_GATE, V4_PLAN_GATE
    for letter, header in (
            ('AD', 'Proposed modeled surplus (hypothetical, pre-reserve)'),
            ('AE', 'Proposed CEO illustrative receipt (hypothetical)'),
            ('AF', 'Proposed COO illustrative receipt (hypothetical)'),
            ('AG', 'Proposed modeled distribution pool (hypothetical)'),
            ('AI', 'Proposed CEO service award'),
            ('AJ', 'Proposed COO service award')):
        put(ws, f'{letter}3', header, bold=True, fill=GREY, wrap=True)
        ws.column_dimensions[letter].width = 13
    openings = {4: 'BS!$Q$73', 16: 'BS!$D$73'}
    for r in range(4, 40):
        prev = r - 1
        # proposal effective 1 January 2027: baseline salaries before it
        put(ws, f'U{r}', f'={dash}!$F$9' if r <= 27 else f'={dash}!$C$9',
            fmt=MONEY0, fill=GREEN)
        put(ws, f'V{r}', f'={dash}!$F$10' if r <= 27 else f'={dash}!$C$10',
            fmt=MONEY0, fill=GREEN)
        if r in V4_QUARTER_AWARD_ROWS:
            ceo_cell, coo_cell = V4_QUARTER_AWARD_ROWS[r]
            put(ws, f'AI{r}', f"=IF({plan_gate},\"N/A\",'V4 Plan'!"
                              f'${ceo_cell[0]}${ceo_cell[1:]})',
                fmt=MONEY, fill=GREEN)
            put(ws, f'AJ{r}', f"=IF({plan_gate},\"N/A\",'V4 Plan'!"
                              f'${coo_cell[0]}${coo_cell[1:]})',
                fmt=MONEY, fill=GREEN)
        else:
            put(ws, f'AI{r}', f'=IF({plan_gate},"N/A",0)', fmt=MONEY,
                fill=GREEN)
            put(ws, f'AJ{r}', f'=IF({plan_gate},"N/A",0)', fmt=MONEY,
                fill=GREEN)
        put(ws, f'W{r}', (f'=IF(OR({gate},{plan_gate},NOT(ISNUMBER($U{r})),'
                          f'NOT(ISNUMBER($V{r})),NOT(ISNUMBER($AI{r})),'
                          f'NOT(ISNUMBER($AJ{r}))),"N/A",'
                          f'$U{r}+$V{r}+$AI{r}+$AJ{r})'),
            fmt=MONEY, fill=GREEN)
        put(ws, f'X{r}', (f'=IF(OR({gate},{plan_gate},NOT(ISNUMBER($E{r})),'
                          f'NOT(ISNUMBER($W{r}))),"N/A",$E{r}-1000000+$W{r})'),
            fmt=MONEY, fill=GREEN)
        put(ws, f'Y{r}', (f'=IF(OR({gate},{plan_gate},NOT(ISNUMBER($F{r})),'
                          f'NOT(ISNUMBER($W{r}))),"N/A",$F{r}+1000000-$W{r})'),
            fmt=MONEY, fill=GREEN)
        # hypothetical pre-reserve dividend sensitivity (2027 quarter ends)
        if r in V4_QUARTER_AWARD_ROWS:
            put(ws, f'AD{r}', (f'=IF(OR({gate},NOT(ISNUMBER($AC{r})),'
                               f'NOT(ISNUMBER($AH{prev}))),"N/A",'
                               f'MAX(0,$AH{prev}+$AC{r}))'),
                fmt=MONEY, fill=GREEN)
        else:
            put(ws, f'AD{r}', f'=IF({gate},"N/A",0)', fmt=MONEY, fill=GREEN)
        put(ws, f'AE{r}', (f'=IF(OR({gate},NOT(ISNUMBER($AD{r}))),"N/A",'
                           f'$AD{r}*{dash}!$C$11)'), fmt=MONEY, fill=GREEN)
        put(ws, f'AF{r}', (f'=IF(OR({gate},NOT(ISNUMBER($AD{r}))),"N/A",'
                           f'$AD{r}*{dash}!$C$12)'), fmt=MONEY, fill=GREEN)
        put(ws, f'AG{r}', (f'=IF(OR({gate},NOT(ISNUMBER($AD{r}))),"N/A",'
                           f'$AD{r}*{dash}!$I$13)'), fmt=MONEY, fill=GREEN)
        if r in openings:
            put(ws, f'AH{r}', (f'=IF(OR({gate},NOT(ISNUMBER($AC{r})),'
                               f'NOT(ISNUMBER($AG{r}))),"N/A",'
                               f'{openings[r]}+$AC{r}-$AG{r})'),
                fmt=MONEY, fill=GREEN)
        else:
            put(ws, f'AH{r}', (f'=IF(OR({gate},NOT(ISNUMBER($AC{r})),'
                               f'NOT(ISNUMBER($AG{r})),'
                               f'NOT(ISNUMBER($AH{prev}))),"N/A",'
                               f'$AH{prev}+$AC{r}-$AG{r})'),
                fmt=MONEY, fill=GREEN)



def _build_v4_update_guide(wb):
    """V2 guide with the V4 proposal controls and dividend disclosure."""
    ws = _build_v2_update_guide(wb)
    rows = {
        5: ('Edit the proposal and award controls',
            'Four control groups drive V4: the proposed monthly base '
            'salaries on Company Dashboard C9:C10 (default THB 200,000 '
            'each, effective 1 January 2027, yellow), the hypothetical '
            'dividend-entitlement shares on C11:C12 and the payout ratio '
            'on I13 (blue, zero by default, analysis only), and the '
            'quarterly service-award targets on V4 Plan C8:D11 (yellow; '
            'THB 750,000 per executive per quarter as forecast targets). '
            'Awards post once at each 2027 quarter end — March, June, '
            'September and December payroll — so enter each quarter\'s '
            'certified amount in its own row and zero for a failed, weak '
            'or unapproved quarter. The fixed baseline beside the salaries '
            '(THB 500,000 each, no dividends) never changes, and every '
            'figure recalculates immediately.'),
        12: ('Dividend disclosure',
             'C11:C12 model hypothetical entitlement shares of a declared '
             'pool and I13 a hypothetical payout ratio of modeled surplus '
             '— sensitivity analysis only, never an authorization. Real '
             'distributions follow the share register and class rights '
             '(CCC s.1200), the s.1201 profit and uncovered-loss gates, '
             'the s.1202 reserve appropriation, the required approvals and '
             'available cash; entering a percentage creates no entitlement. '
             'Employment awards and ownership dividends are separate '
             'payments and cannot be relabelled interchangeably.'),
    }
    for r, (topic, body) in rows.items():
        put(ws, f'B{r}', topic, bold=True, fill=GREY, wrap=True, halign='left')
        put(ws, f'C{r}', body, wrap=True, halign='left')
        ws.row_dimensions[r].height = max(30, 13 * (len(body) // 105 + 1))
    return ws



def _build_v4_dashboard(wb):
    """V3 dashboard opened on the prospective 2027 proposal: THB 200,000
    base salaries, hypothetical entitlement shares and payout ratio zero."""
    ws = _build_v3_dashboard(wb)
    for coord, value in V4_SCENARIO_DEFAULTS.items():
        ws[coord] = value
    put(ws, 'B3', 'Prospective 2027 executive incentive proposal: THB '
                  '200,000 monthly base salaries per executive plus '
                  'quarterly certified service-award targets (see the V4 '
                  'Plan sheet), compared with the fixed THB 500,000 '
                  'salary-only baseline. C11:C12 are hypothetical '
                  'entitlement shares of a declared pool and I13 a '
                  'hypothetical payout ratio of modeled surplus — analysis '
                  'only; share-register rights and dividend-law gates '
                  'control any real distribution.',
        italic=True, border=False)
    put(ws, 'B11', 'CEO hypothetical entitlement share of declared pool',
        fill=GREY)
    put(ws, 'B12', 'COO hypothetical entitlement share of declared pool',
        fill=GREY)
    for r in (11, 12):
        put(ws, f'C{r}', V4_SCENARIO_DEFAULTS[f'C{r}'], fill=BLUE, fmt=PCT,
            bold=True, halign='right')
    put(ws, 'G13', 'Hypothetical payout ratio of modeled surplus',
        fill=GREY)
    put(ws, 'I13', V4_SCENARIO_DEFAULTS['I13'], fill=BLUE, fmt=PCT,
        bold=True, halign='right')
    put(ws, 'B14', 'Payment input check', bold=True, fill=GREY)
    put(ws, 'C14', ('=IF(AND(ISNUMBER($C$9),ISNUMBER($C$10),ISNUMBER($C$11),'
                    'ISNUMBER($C$12),ISNUMBER($I$13),$C$9>=0,$C$10>=0,'
                    '$C$11>=0,$C$11<=1,$C$12>=0,$C$12<=1,$I$13>=0,'
                    '$I$13<=1,$C$13<=1),IF(\'V4 Plan\'!$C$13="OK","OK",'
                    '\'V4 Plan\'!$C$13),'
                    '"BLOCKED - salaries must be zero or positive, dividend '
                    'shares and the payout ratio between 0% and 100%, CEO '
                    'plus COO shares no more than 100%")'),
        fill=GREEN, bold=True)
    dv_payout = DataValidation(
        type='decimal', operator='between', formula1='0', formula2='1',
        allow_blank=False, errorTitle='Invalid payout ratio',
        error='The payout ratio must be between 0% and 100%.')
    ws.add_data_validation(dv_payout)
    dv_payout.add('I13')
    _augment_v4_personal_reference(ws)
    return ws


def build_company_focus_v4_workbook(source: Path, output: Path) -> None:
    source, output = Path(source), Path(output)
    wb, replaced = convert_source_workbook(source)
    original_sheets = [ws.title for ws in wb.worksheets]

    _build_v4_dashboard(wb)
    _build_v4_plan(wb)
    _build_v4_update_guide(wb)
    _build_v2_source_check(wb)
    _build_v2_operating_model(wb)
    _build_v2_company_calculation(wb)
    _augment_v4_company_calculation(wb['Company Calculation'])

    model = [wb[t] for t in V4_MODEL_SHEETS]
    rest = [ws for ws in wb.worksheets if ws.title not in V4_MODEL_SHEETS]
    wb._sheets = model + rest            # dashboard first, reasoning second
    wb.active = 0
    wb['Operating Model'].sheet_state = 'hidden'
    wb['Company Calculation'].sheet_state = 'hidden'
    wb.calculation = CalcProperties(fullCalcOnLoad=True)

    tmp = output.with_name(output.stem + '.tmp.xlsx')
    wb.save(tmp)
    try:
        validate_output(tmp, wb, model_sheets=V4_MODEL_SHEETS)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    os.replace(tmp, output)
    print(f'Converted {replaced} VBA-UDF formulas; sheets: '
          f'{[ws.title for ws in wb.worksheets][:6]} + {original_sheets}')
    print(f'Wrote {output}')

# =============================================================== validation ==
def validate_output(path: Path, wb, model_sheets=MODEL_SHEETS) -> None:
    udf = re.compile(r'\b(' + '|'.join(UDF_NAMES) + r')\s*\(', re.I)
    problems = []
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                v = cell.value
                if isinstance(v, ArrayFormula):
                    problems.append(f'{ws.title}!{cell.coordinate}: array formula remains')
                    continue
                if isinstance(v, str) and v.startswith('='):
                    if udf.search(v):
                        problems.append(f'{ws.title}!{cell.coordinate}: UDF reference remains: {v[:60]}')
                    if '_xlfn.' in v:
                        problems.append(f'{ws.title}!{cell.coordinate}: _xlfn function: {v[:60]}')
                    if re.search(r'\[[^\]]*\.xl\w*\]|\[\d+\]', v):
                        problems.append(f'{ws.title}!{cell.coordinate}: external workbook reference: {v[:60]}')
    if problems:
        raise ValueError('Formula scan failed:\n' + '\n'.join(problems[:20]))

    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        for bad in ('xl/vbaProject.bin',):
            if bad in names:
                raise ValueError(f'{bad} present in output package')
        if any(n.startswith('xl/activeX/') for n in names):
            raise ValueError('ActiveX controls present in output package')
        if any('externalLink' in n for n in names):
            raise ValueError('external links present in output package')
        ct = z.read('[Content_Types].xml').decode()
        if 'macroEnabled' in ct:
            raise ValueError('output package declares macroEnabled content type')
        if 'spreadsheetml.sheet.main+xml' not in ct and 'sheet.main+xml' not in ct:
            raise ValueError('output package is not a plain xlsx workbook')

    order = [ws.title for ws in wb.worksheets]
    if order[:len(model_sheets)] != model_sheets:
        raise ValueError(f'unexpected sheet order: {order}')


# ==================================================================== build ==
def build_google_sheets_workbook(source: Path, output: Path) -> None:
    source, output = Path(source), Path(output)
    wb, replaced = convert_source_workbook(source)
    original_sheets = [ws.title for ws in wb.worksheets]

    _build_model_guide(wb)
    _build_model_inputs(wb)
    _build_tax_tables(wb)
    _build_operating_model(wb)
    _build_monthly_model(wb)
    _build_case_summary(wb)
    _build_formula_notes(wb)

    model = [wb[t] for t in MODEL_SHEETS]
    rest = [ws for ws in wb.worksheets if ws.title not in MODEL_SHEETS]
    wb._sheets = model + rest            # deterministic order: model first
    wb.active = 0
    wb.calculation = CalcProperties(fullCalcOnLoad=True)

    tmp = output.with_name(output.stem + '.tmp.xlsx')
    wb.save(tmp)
    try:
        validate_output(tmp, wb)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    os.replace(tmp, output)
    print(f'Converted {replaced} VBA-UDF formulas; sheets: '
          f'{[ws.title for ws in wb.worksheets][:7]} + {original_sheets}')
    print(f'Wrote {output}')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--source', type=Path, default=DEFAULT_SOURCE,
                    help='source .xlsm workbook (default: %(default)s)')
    ap.add_argument('--output', type=Path, default=None,
                    help='output .xlsx workbook (default: the Google Sheets Model '
                         'filename; with --company-v2: the Company Focus V2 '
                         'filename; with --company-v3: the Company Focus V3 '
                         'filename; with --company-v3-1: the Company Focus V3.1 '
                         'filename; with --company-v4: the Company Focus V4 '
                         'filename)')
    company = ap.add_mutually_exclusive_group()
    company.add_argument('--company-v2', action='store_true',
                         help='build the Company Focus V2 director workbook '
                              '(one editable proposal vs the fixed salary-only '
                              'baseline)')
    company.add_argument('--company-v3', action='store_true',
                         help='build the Company Focus V3 workbook (the V2 '
                              'director dashboard plus the CEO/COO personal '
                              'reference below row 800 of the Company '
                              'Dashboard sheet)')
    company.add_argument('--company-v3-1', action='store_true',
                         help='build the Company Focus V3.1 workbook (unchanged '
                              'V3 plus interactive salary/dividend sensitivity charts)')
    company.add_argument('--company-v4', action='store_true',
                         help='build the Company Focus V4 workbook (V3 '
                              'opened on the prospective 2027 proposal: '
                              'THB 200,000 base salaries, quarterly '
                              'certified service awards and hypothetical '
                              'dividends at zero)')
    args = ap.parse_args(argv)
    if args.company_v2:
        build_company_focus_v2_workbook(args.source,
                                        args.output or DEFAULT_V2_OUTPUT)
    elif args.company_v3:
        build_company_focus_v3_workbook(args.source,
                                        args.output or DEFAULT_V3_OUTPUT)
    elif args.company_v3_1:
        build_company_focus_v31_workbook(args.source,
                                         args.output or DEFAULT_V31_OUTPUT)
    elif args.company_v4:
        build_company_focus_v4_workbook(args.source,
                                        args.output or DEFAULT_V4_OUTPUT)
    else:
        build_google_sheets_workbook(args.source, args.output or DEFAULT_OUTPUT)
    return 0


if __name__ == '__main__':
    sys.exit(main())
