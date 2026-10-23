#!/usr/bin/env python3
"""Read-only sales-data extractor for the TPO presentation workbook.

Reads the per-customer monthly sheets (``Mana``, ``Auntie Aloha``, ``Fuzzies``,
``Tyson``, ``Private Label``), ``Overall Sales`` and ``Customer Count`` tabs of
the sales presentation export without modifying it and produces:

* ``<prefix>.json`` — a narrow ``tpo-sales-actuals-v1`` import pack with
  integer-satang revenue per customer, monthly customer counts and provenance;
* ``<prefix>.xlsx`` — a three-sheet human review copy (CustomerRevenueMonthly,
  Customer Count, Source Map).

Dragging the workbook onto this script file (Windows drag-and-drop, or a Linux
``.desktop`` launcher) passes it as the first argument; without
``--output-prefix``, the outputs are written beside the source using the
workbook's own name (a ``.xlsx`` source gets a ``<name>.review.xlsx`` review
copy so the source is never overwritten).

The source workbook is never written, recalculated or macro-executed.  Public
API: ``extract_sales_inputs(source) -> dict``, ``write_review_workbook(pack,
output) -> None`` and ``main(argv) -> int``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import uuid
import warnings
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

warnings.filterwarnings('ignore', message='Data Validation extension is not supported')


def _pause_if_drop_launched() -> None:
    """Hold open a console Windows created just for this process.

    Explorer-launched drag-and-drop (and double-click) attaches exactly one
    process to the fresh console; shells and test runners attach themselves as
    well, so interactive runs never pause. No-op on other platforms and on
    windowless runs.
    """
    if os.name != 'nt':
        return
    try:
        import ctypes
        attached = ctypes.windll.kernel32.GetConsoleProcessList(None, 0)
        if attached != 1:
            return
        input('\nPress Enter to close...')
    except (AttributeError, EOFError, OSError, ValueError):
        pass  # windowless run or closed stdin: nothing to hold open


try:
    import openpyxl
    from openpyxl.styles import Alignment, Font, PatternFill
except ImportError as exc:  # pragma: no cover - environment guard
    print('openpyxl is required. Install tools/requirements-monthly-input.txt into an '
          'isolated environment, never system pip, e.g.:\n'
          '  python3 -m venv /tmp/tpo-monthly-import-venv\n'
          '  /tmp/tpo-monthly-import-venv/bin/python -m pip install -r '
          'tools/requirements-monthly-input.txt', file=sys.stderr)
    _pause_if_drop_launched()
    raise SystemExit(1) from exc

SCHEMA = 'tpo-sales-actuals-v1'
MAX_MONTHS = 36
CENT = Decimal('0.01')
TOLERANCE_CENTS = 1  # one satang, matching Excel float-vs-Decimal summation drift

# Sheet tab -> (column-B anchor label, canonical pack key, destination customer name).
SALES_SHEETS = [
    ('Mana', 'Mana Cannabis', 'mana', 'Mana'),
    ('Auntie Aloha', 'Auntie Aloha', 'auntie-aloha', 'Auntie Aloha'),
    ('Fuzzies', 'Fuzzies', 'fuzzies', 'Fuzzies'),
    ('Tyson', 'Tyson', 'tyson', 'Tyson'),
    ('Private Label', 'Private Label', 'private-label', 'Private Label'),
]
OVERALL_SHEET = 'Overall Sales'
COUNT_SHEET = 'Customer Count'

QUARTER_RE = re.compile(r'^Q([1-4]) (\d{4})$')


class SalesInputError(Exception):
    """Validation failure; the message pinpoints the offending source cell(s)."""


def _sheet_rows(wb, name: str):
    """Stream one sheet as a list of value tuples; only that sheet is parsed."""
    if name not in wb.sheetnames:
        raise SalesInputError(
            f'{name}: required sheet is missing. The supported source is the TPO '
            'sales presentation export with per-customer, Overall Sales and '
            'Customer Count tabs.')
    rows = [tuple(row) for row in wb[name].iter_rows(values_only=True)]
    if not rows:
        raise SalesInputError(f'{name}: sheet is empty.')
    return rows


def _pad(row: tuple, col: int):
    return row[col] if col < len(row) else None


def _anchor(rows, name: str, row: int, col: int, expected: str):
    """1-based row/col anchor check with an actionable cell reference."""
    value = _pad(rows[row - 1], col - 1)
    actual = '' if value is None else str(value).strip()
    if actual != expected:
        raise SalesInputError(
            f'{name}!{chr(64 + col)}{row}: anchor is {actual!r}; expected '
            f'{expected!r}. A shifted or unsupported layout stops extraction.')


def _amount(value, cell: str):
    """Return THB Decimal for a numeric-or-blank cell; text is blocking."""
    if value is None or value == '':
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return Decimal(text)
        except Exception:
            raise SalesInputError(f'{cell}: {value!r} is not a numeric sales amount.')
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SalesInputError(f'{cell}: {type(value).__name__} value is not a sales amount.')
    if isinstance(value, float) and (value != value or value in (float('inf'), float('-inf'))):
        raise SalesInputError(f'{cell}: non-finite sales amount.')
    return Decimal(str(value))


def _to_cents(amount: Decimal, cell: str) -> int:
    cents = int((amount.quantize(CENT, rounding=ROUND_HALF_UP) * 100).to_integral_value())
    if abs(cents) > 9007199254740991:
        raise SalesInputError(f'{cell}: amount is outside the supported numeric range.')
    return cents


def _month_key(day: datetime) -> str:
    return f'{day.year:04d}-{day.month:02d}'


def _month_label(key: str) -> str:
    year, month = key.split('-')
    names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return f'{names[int(month) - 1]}-{year[2:]}'


def _month_seq(key: str) -> int:
    year, month = key.split('-')
    return int(year) * 12 + int(month)


def _read_monthly_column(rows, name: str, label: str):
    """Read {month-key: amount Decimal} from a Month|Label sheet (cols A/B)."""
    _anchor(rows, name, 1, 1, 'Month')
    _anchor(rows, name, 1, 2, label)
    out = {}
    for index in range(1, len(rows)):
        day, value = _pad(rows[index], 0), _pad(rows[index], 1)
        if day is None and value is None:
            continue
        if not isinstance(day, datetime):
            raise SalesInputError(
                f'{name}!A{index + 1}: expected a date-typed month, found {day!r}. '
                'The importer never guesses month keys.')
        if day.day != 1:
            raise SalesInputError(
                f'{name}!A{index + 1}: month must start on the first day of its month.')
        key = _month_key(day)
        if key in out:
            raise SalesInputError(f'{name}!A{index + 1}: duplicate month {key}.')
        out[key] = _amount(value, f'{name}!B{index + 1}')
    if not out:
        raise SalesInputError(f'{name}: no monthly rows found.')
    return out


def _check_quarters(rows, name: str, label: str, monthly: dict):
    """Verify the sheet's Quarter|Label rollup block matches the monthly column."""
    _anchor(rows, name, 1, 5, 'Quarter')
    _anchor(rows, name, 1, 6, label)
    quarters = {}
    for index in range(1, len(rows)):
        quarter_label, value = _pad(rows[index], 4), _pad(rows[index], 5)
        if quarter_label is None and value is None:
            continue
        match = QUARTER_RE.match(str(quarter_label or '').strip())
        if not match:
            raise SalesInputError(
                f"{name}!E{index + 1}: quarter label {quarter_label!r} is not 'Q# YYYY'.")
        if quarter_label in quarters:
            raise SalesInputError(f'{name}!E{index + 1}: duplicate quarter {quarter_label}.')
        quarters[quarter_label] = _amount(value, f'{name}!F{index + 1}')
    sums = {}
    for key, amount in monthly.items():
        year, month = key.split('-')
        quarter = f'Q{(int(month) - 1) // 3 + 1} {year}'
        sums[quarter] = sums.get(quarter, Decimal('0')) + (amount or Decimal('0'))
    for quarter, cell_sum in sums.items():
        total = quarters.get(quarter)
        if total is None and _to_cents(cell_sum, quarter) == 0:
            continue  # blank rollup over blank months is a consistent zero
        if total is None:
            raise SalesInputError(
                f'{name}: quarter {quarter} is missing from the rollup block.')
        if abs(_to_cents(cell_sum, quarter) - _to_cents(total, quarter)) > TOLERANCE_CENTS:
            raise SalesInputError(
                f'{name}: quarter {quarter} rollup is {total} but its months sum '
                f'to {cell_sum}. Rebuild the presentation tables before extracting.')


def _overall_mismatches(overall: dict, per_customer: dict) -> dict:
    """Months whose five-customer total disagrees with Overall Sales (kept per-month
    so the importer can block exactly those months instead of failing the pack)."""
    bad = {}
    for key in overall:
        five = sum((per_customer[sheet].get(key) or Decimal('0')) for sheet, *_ in SALES_SHEETS)
        overall_cents = _to_cents(overall[key] or Decimal('0'), f'Overall Sales!B[{key}]')
        if abs(_to_cents(five, key) - overall_cents) > TOLERANCE_CENTS:
            bad[key] = (five, overall[key])
    return bad

def extract_sales_inputs(source: Path) -> dict:
    """Validate the sales presentation export read-only and build the import pack."""
    source = Path(source)
    if not source.is_file():
        raise SalesInputError(f'{source}: source workbook not found.')
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    wb = openpyxl.load_workbook(source, data_only=True, read_only=True)
    try:
        per_customer, packs = {}, {}
        for sheet, label, key, name in SALES_SHEETS:
            rows = _sheet_rows(wb, sheet)
            monthly = _read_monthly_column(rows, sheet, label)
            _check_quarters(rows, sheet, label, monthly)
            per_customer[sheet] = monthly
            packs[key] = {'key': key, 'sheet': sheet, 'label': label, 'name': name,
                          'sourceRef': f'{sheet}!A2:B{len(rows)}'}
        grid = _read_monthly_column(_sheet_rows(wb, OVERALL_SHEET), OVERALL_SHEET, OVERALL_SHEET)
        mismatches = _overall_mismatches(grid, per_customer)
        counts = _read_monthly_column(_sheet_rows(wb, COUNT_SHEET), COUNT_SHEET, COUNT_SHEET)

        # One identical, contiguous month grid across every sheet.
        base = list(grid)
        for sheet in per_customer:
            if list(per_customer[sheet]) != base:
                raise SalesInputError(
                    f'{sheet}: month grid differs from {OVERALL_SHEET}. The importer '
                    'requires one identical contiguous month range on every tab.')
        if list(counts) != base:
            raise SalesInputError(
                f'{COUNT_SHEET}: month grid differs from {OVERALL_SHEET}.')
        if len(base) > MAX_MONTHS:
            raise SalesInputError(
                f'{OVERALL_SHEET}: {len(base)} months exceeds the {MAX_MONTHS}-month limit.')
        if any(b - a != 1 for a, b in zip(map(_month_seq, base), map(_month_seq, base[1:]))):
            raise SalesInputError(
                f'{OVERALL_SHEET}: month grid has a gap. The importer requires '
                'contiguous months; rebuild the presentation tables.')

        months = []
        for key in base:
            revenue = {}
            for sheet, label, ckey, name in SALES_SHEETS:
                amount = per_customer[sheet].get(key)
                if amount is not None:
                    revenue[ckey] = _to_cents(amount, f'{sheet}!B[{key}]')
            count = counts.get(key)
            if count is not None:
                count_cents = _to_cents(count, f'{COUNT_SHEET}!B[{key}]')
                if count_cents < 0 or count_cents % 100 != 0:
                    raise SalesInputError(
                        f'{COUNT_SHEET}!B[{key}]: customer count {count} is not a whole '
                        'number of customers.')
                months.append({'month': key, 'revenueCents': revenue, 'count': count_cents // 100,
                               'overallCents': _to_cents(grid[key] or Decimal('0'), f'Overall Sales!B[{key}]'),
                               'reconciled': key not in mismatches})
            else:
                months.append({'month': key, 'revenueCents': revenue, 'count': None,
                               'overallCents': _to_cents(grid[key] or Decimal('0'), f'Overall Sales!B[{key}]'),
                               'reconciled': key not in mismatches})
        return {
            'schema': SCHEMA,
            'source': {'filename': source.name, 'sha256': digest, 'reportMonth': base[-1]},
            'customers': [packs[key] for _, _, key, _ in SALES_SHEETS],
            'months': months,
        }
    finally:
        wb.close()


def _text_cell(ws, ref: str, value: str):
    cell = ws[ref]
    cell.value = value
    cell.number_format = '@'


def _style_header(ws, row: int, width: int):
    for col in range(1, width + 1):
        cell = ws.cell(row, col)
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = PatternFill('solid', fgColor='115E67')
        cell.alignment = Alignment(horizontal='center')
    ws.freeze_panes = f'A{row + 1}'


def _money_cell(ws, row: int, col: int, cents):
    cell = ws.cell(row, col, cents / 100 if cents is not None else None)
    cell.number_format = '#,##0.00;[Red](#,##0.00);0.00'
    cell.alignment = Alignment(horizontal='right')


def write_review_workbook(pack: dict, output: Path) -> None:
    """Write the three-sheet review copy (never an import source)."""
    wb = openpyxl.Workbook()
    revenue = wb.active
    revenue.title = 'CustomerRevenueMonthly'
    revenue.append(['Customer', 'Month', 'Revenue'])
    _style_header(revenue, 1, 3)
    for record in pack['months']:
        for customer in pack['customers']:
            cents = record['revenueCents'].get(customer['key'])
            if cents is None:
                continue
            revenue.append([customer['name'], _month_label(record['month']), cents / 100])
            _money_cell(revenue, revenue.max_row, 3, cents)
    counts = wb.create_sheet('Customer Count')
    counts.append(['Month', 'Customer Count'])
    _style_header(counts, 1, 2)
    for record in pack['months']:
        counts.append([_month_label(record['month']),
                       record['count'] if record['count'] is not None else None])
    source_map = wb.create_sheet('Source Map')
    _text_cell(source_map, 'A1', 'Review copy only. Import the JSON pack; do not paste '
                                 'over calculated columns.')
    _text_cell(source_map, 'A3', 'Source workbook')
    _text_cell(source_map, 'B3', pack['source']['filename'])
    _text_cell(source_map, 'A4', 'SHA-256')
    _text_cell(source_map, 'B4', pack['source']['sha256'])
    _text_cell(source_map, 'A5', 'Report month')
    _text_cell(source_map, 'B5', pack['source']['reportMonth'])
    source_map['A7'] = 'Customer'
    source_map['B7'] = 'Source label'
    source_map['C7'] = 'Source column'
    for offset, customer in enumerate(pack['customers']):
        source_map.cell(8 + offset, 1, customer['name'])
        _text_cell(source_map, f'B{8 + offset}', customer['label'])
        _text_cell(source_map, f'C{8 + offset}', customer['sourceRef'])
    wb.save(output)


def _run(argv) -> int:
    parser = argparse.ArgumentParser(
        description='Extract a read-only sales JSON pack and XLSX review copy from '
                    'the TPO sales presentation workbook. Drag the workbook onto '
                    'this script to write <workbook>.json and <workbook>.xlsx beside it.')
    parser.add_argument('dropped', nargs='*', metavar='workbook',
                        help='sales presentation .xlsm/.xlsx export, e.g. dropped '
                             'onto this script (never modified)')
    parser.add_argument('--source',
                        help='sales presentation export (never modified); '
                             'alternative to the positional workbook')
    parser.add_argument('--output-prefix',
                        help='output path without extension; writes <prefix>.json and '
                             '<prefix>.xlsx (default: the workbook\'s own name beside '
                             'the source)')
    args = parser.parse_args(argv)
    given = list(args.dropped) + ([args.source] if args.source else [])
    if not given:
        print('error: no workbook given. Drag the sales export onto this script, or '
              'pass it as the first argument or via --source.', file=sys.stderr)
        return 2
    if len(given) > 1:
        names = ', '.join(given)
        print(f'error: drop or pass exactly one workbook (got {len(given)}: '
              f'{names}).', file=sys.stderr)
        return 2
    source = Path(given[0])
    resolved_source = source.resolve()
    prefix = Path(args.output_prefix) if args.output_prefix else \
        resolved_source.parent / resolved_source.stem
    outputs = [Path(f'{prefix}.json'), Path(f'{prefix}.xlsx')]
    if not args.output_prefix and outputs[1].resolve(strict=False) == resolved_source:
        outputs[1] = Path(f'{prefix}.review.xlsx')  # .xlsx source: never self-overwrite
    try:
        if not source.is_file():
            raise SalesInputError(f'{source}: source workbook not found.')
        for out in outputs:
            if out.exists():
                raise SalesInputError(
                    f'{out}: output already exists; refusing to overwrite.')
        for out in outputs:
            if out.resolve(strict=False) == resolved_source:
                raise SalesInputError(
                    f'{out}: output must not resolve to the source workbook.')
        parent = prefix.parent if str(prefix.parent) else Path('.')
        if not parent.is_dir():
            raise SalesInputError(f'{parent}: output directory does not exist.')
        pack = extract_sales_inputs(source)
        unique_id = f'{os.getpid()}_{uuid.uuid4().hex}'
        temp_paths = [parent / f'{prefix.name}.{unique_id}{suffix}.tmp' for suffix in ('.json', '.xlsx')]
        try:
            temp_paths[0].write_text(json.dumps(pack, indent=2) + '\n', encoding='utf-8')
            write_review_workbook(pack, temp_paths[1])
            os.replace(temp_paths[0], outputs[0])
            os.replace(temp_paths[1], outputs[1])
        except BaseException:
            for temp in temp_paths:
                try:
                    temp.unlink()
                except FileNotFoundError:
                    pass
            raise
    except SalesInputError as error:
        print(f'error: {error}', file=sys.stderr)
        return 2
    counted = sum(1 for record in pack['months'] if record['count'] is not None)
    print(f"Extracted {len(pack['months'])} sales months "
          f"({pack['months'][0]['month']}..{pack['source']['reportMonth']}) with "
          f"{counted} customer counts from {pack['source']['filename']}.")
    print(f"Wrote {outputs[0]} and {outputs[1]}.")
    return 0


def main(argv=None) -> int:
    """CLI entry point; a drag-launched console is held open so output stays readable."""
    rc = _run(argv)
    _pause_if_drop_launched()
    return rc


if __name__ == '__main__':
    sys.exit(main())
