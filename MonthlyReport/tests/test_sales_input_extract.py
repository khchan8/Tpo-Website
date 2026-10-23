"""Behavior tests for tools/extract-sales-input.py (standard library unittest).

Fixtures are synthetic presentation workbooks built with the pinned openpyxl
dependency in temporary directories; the private sales workbook is never used.
"""

import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location(
    'extract_sales_input', ROOT / 'tools' / 'extract-sales-input.py')
extractor = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(extractor)

import openpyxl  # noqa: E402  (after the extractor's own import guard)

NAMES = ['May-24', 'Jun-24', 'Jul-24', 'Aug-24', 'Sep-24', 'Oct-24']
DATES = [datetime(2024, month, 1) for month in range(5, 11)]


def build_presentation(path, *, mana=None, overall_delta=None, count_override=None,
                       drop_quarter=False, text_amount=False, count_fraction=False,
                       skip_month_for=None):
    """Create a synthetic sales presentation export matching the validated layout."""
    mana = [100.005, None, 250.5, 0, 300, 125.25] if mana is None else mana
    customers = {
        'Mana': ('Mana Cannabis', list(mana)),
        'Auntie Aloha': ('Auntie Aloha', [50, 60, 70, 80, 90, 100]),
        'Fuzzies': ('Fuzzies', [None, 10, 20, 30, 40, 50]),
        'Tyson': ('Tyson', [5, 6, 7, 8, 9, 10]),
        'Private Label': ('Private Label', [1, 2, 3, 4, 5, 6]),
    }
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for sheet, (label, values) in customers.items():
        ws = wb.create_sheet(sheet)
        ws.append(['Month', label])
        if skip_month_for is not None and skip_month_for[0] == sheet:
            rows = [(date, values[index]) for index, date in enumerate(DATES)
                    if index != skip_month_for[1]]
        else:
            rows = list(zip(DATES, values))
        for date, value in rows:
            if sheet == 'Mana' and text_amount and date == DATES[0]:
                ws.append([date, 'N/A'])
            else:
                ws.append([date, value])
        ws.cell(1, 5, 'Quarter')
        ws.cell(1, 6, label)
        quarters = {}
        for date, value in rows:
            quarter = f'Q{(date.month - 1) // 3 + 1} {date.year}'
            entry = quarters.setdefault(quarter, [0, False])
            if value is not None:
                entry[0] += value
                entry[1] = True
        row = 2
        for quarter, (total, seen) in quarters.items():
            ws.cell(row, 5, quarter)
            if seen:
                ws.cell(row, 6, total + 1000 if drop_quarter and quarter == 'Q3 2024' else total)
            row += 1

    overall = wb.create_sheet('Overall Sales')
    overall.append(['Month', 'Overall Sales'])
    totals = []
    for index, date in enumerate(DATES):
        total = sum((customers[name][1][index] or 0) for name in customers)
        if overall_delta is not None and index == 2:
            total += overall_delta
        totals.append(total)
        overall.append([date, total])

    counts = wb.create_sheet('CustomerCount'.replace('CustomerCount', 'Customer Count'))
    counts.append(['Month', 'Customer Count'])
    for index, date in enumerate(DATES):
        value = 3 + index
        if count_override is not None and index == 1:
            value = count_override
        if count_fraction and index == 1:
            value = 3.5
        counts.append([date, value])
    wb.save(path)
    return path


class SalesExtractorTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='tpo-sales-test-'))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def source(self, name='presentation.xlsx', **kwargs):
        return build_presentation(self.tmp / name, **kwargs)

    def extract(self, **kwargs):
        return extractor.extract_sales_inputs(self.source(**kwargs))

    def assert_error(self, pattern, **kwargs):
        with self.assertRaises(extractor.SalesInputError) as caught:
            self.extract(**kwargs)
        self.assertRegex(str(caught.exception), pattern)
        return str(caught.exception)


class TestExtraction(SalesExtractorTestCase):
    def test_happy_path_builds_reconciled_pack(self):
        pack = self.extract()
        self.assertEqual(pack['schema'], 'tpo-sales-actuals-v1')
        self.assertEqual(pack['source']['reportMonth'], '2024-10')
        self.assertEqual([c['key'] for c in pack['customers']],
                         ['mana', 'auntie-aloha', 'fuzzies', 'tyson', 'private-label'])
        self.assertEqual(len(pack['months']), 6)
        may, june = pack['months'][0], pack['months'][1]
        # Mana 100.005 THB rounds HALF_UP to 10001 satang; blank Fuzzies stays absent.
        self.assertEqual(may['revenueCents'], {'mana': 10001, 'auntie-aloha': 5000,
                                               'tyson': 500, 'private-label': 100})
        self.assertEqual(june['revenueCents'].get('fuzzies'), 1000)
        self.assertEqual(june['count'], 4)
        self.assertTrue(all(month['reconciled'] for month in pack['months']))
        self.assertEqual(may['overallCents'],
                         may['revenueCents']['mana'] + 5000 + 500 + 100)

    def test_overall_mismatch_flags_month_without_failing_pack(self):
        pack = self.extract(overall_delta=1.0)  # Jul-24 overall off by one baht
        july = pack['months'][2]
        self.assertFalse(july['reconciled'])
        self.assertTrue(pack['months'][1]['reconciled'])

    def test_missing_sheet_and_bad_anchor_are_blocking(self):
        path = self.source()
        wb = openpyxl.load_workbook(path)
        wb.remove(wb['Tyson'])
        wb.save(path)
        with self.assertRaises(extractor.SalesInputError) as caught:
            extractor.extract_sales_inputs(path)
        self.assertIn('Tyson: required sheet is missing', str(caught.exception))
        path = self.source()
        wb = openpyxl.load_workbook(path)
        wb['Mana']['B1'] = 'Wrong Label'
        wb.save(path)
        with self.assertRaises(extractor.SalesInputError) as caught:
            extractor.extract_sales_inputs(path)
        self.assertIn("Mana!B1: anchor is 'Wrong Label'", str(caught.exception))

    def test_grid_gap_between_sheets_is_blocking(self):
        self.assert_error(r'Tyson: month grid differs from Overall Sales',
                          skip_month_for=('Tyson', 2))

    def test_quarter_rollup_mismatch_is_blocking(self):
        self.assert_error(r'Mana: quarter Q3 2024 rollup', drop_quarter=True)

    def test_text_amount_is_blocking(self):
        self.assert_error(r'Mana!B2.*is not a numeric sales amount', text_amount=True)

    def test_fractional_customer_count_is_blocking(self):
        self.assert_error(r'Customer Count!B\[2024-06\].*not a whole number',
                          count_fraction=True)


class TestReviewWorkbook(SalesExtractorTestCase):
    def test_review_roundtrip_and_source_immutability(self):
        source = self.source(name='=Sales_Review.xlsx')
        digest_before = source.read_bytes()
        pack = extractor.extract_sales_inputs(source)
        output = self.tmp / 'review.xlsx'
        extractor.write_review_workbook(pack, output)
        self.assertEqual(source.read_bytes(), digest_before)
        review = openpyxl.load_workbook(output)
        self.assertEqual(review.sheetnames,
                         ['CustomerRevenueMonthly', 'Customer Count', 'Source Map'])
        rows = list(review['CustomerRevenueMonthly'].iter_rows(values_only=True))
        self.assertEqual(rows[0], ('Customer', 'Month', 'Revenue'))
        self.assertEqual((rows[1][0], rows[1][1], round(rows[1][2] * 100)),
                         ('Mana', 'May-24', 10001))
        counts = list(review['Customer Count'].iter_rows(values_only=True))
        self.assertEqual(counts[1][1], 3)
        source_map = review['Source Map']
        self.assertIn('Review copy only', source_map['A1'].value)
        self.assertEqual(source_map['B3'].value, pack['source']['filename'])
        self.assertEqual(source_map['B5'].value, '2024-10')


class TestCommandLine(SalesExtractorTestCase):
    def run_main(self, *args):
        return extractor.main(list(args))

    def test_dragged_workbook_writes_same_named_outputs_beside_source(self):
        source = self.source(name='TPO Sep 2026 Sales Data for Presentation.xlsx')
        self.assertEqual(self.run_main(str(source)), 0)
        pack = json.loads(source.with_suffix('.json').read_text())
        self.assertEqual(pack['schema'], 'tpo-sales-actuals-v1')
        self.assertTrue(source.with_suffix('.xlsx').exists())

    def test_dragged_xlsx_source_writes_review_suffixed_copy(self):
        source = self.source(name='book.xlsx')
        self.assertEqual(self.run_main(str(source)), 0)
        self.assertTrue(source.with_suffix('.review.xlsx').exists())
        self.assertTrue(source.with_suffix('.json').exists())

    def test_refuses_overwrite_and_multiple_workbooks(self):
        source = self.source()
        source.with_suffix('.json').write_text('old')
        self.assertEqual(self.run_main(str(source)), 2)
        self.assertEqual(source.with_suffix('.json').read_text(), 'old')
        self.assertEqual(self.run_main(str(self.source(name='b.xlsx')),
                                       str(self.source(name='c.xlsx'))), 2)

    def test_no_workbook_guides_to_drag_and_drop(self):
        self.assertEqual(self.run_main(), 2)


if __name__ == '__main__':
    unittest.main()
