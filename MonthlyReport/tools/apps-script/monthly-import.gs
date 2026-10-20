/** Monthly accounting-actuals import: pack parsing, read-only planning, preview/apply RPCs and dialog.
 * Writes only approved months into MonthlyFinancials and 1. Working Capital through the existing
 * backupAndWrite_ audit/rollback path. Never touches customer, operational, assumption or LLM state. */

var MONTHLY_IMPORT_TABS = ['MonthlyFinancials', '1. Working Capital'];
var MONTHLY_IMPORT_RAW = {
  'MonthlyFinancials': [['revenue', 'revenueCents'], ['cogs', 'cogsCents'], ['sga', 'sgaCents'],
    ['netIncome', 'netIncomeCents']],
  '1. Working Capital': [['cash', 'cashCents'], ['ar', 'arCents'], ['inventory', 'inventoryCents'],
    ['ap', 'apCents']]
};
// Derived cells: formulaInputs are the cells the spreadsheet formula references (legacy included);
// provenance lists the underlying raw import fields disclosed as source cells.
var MONTHLY_IMPORT_DERIVED = {
  'MonthlyFinancials': [
    { field: 'gp', formulaInputs: ['revenue', 'cogs'], provenance: ['revenue', 'cogs'] },
    { field: 'ebit', formulaInputs: ['gp', 'sga'], provenance: ['revenue', 'cogs', 'sga'] }
  ],
  '1. Working Capital': [
    { field: 'nwc', formulaInputs: ['cash', 'ar', 'inventory', 'ap'],
      provenance: ['cash', 'ar', 'inventory', 'ap'] }
  ]
};
var MONTHLY_PACK_SCHEMA = 'tpo-monthly-actuals-v1';
var MONTHLY_REF_KEYS = ['revenueCents', 'cogsCents', 'sgaCents', 'netIncomeCents', 'cashCents',
  'arCents', 'inventoryCents', 'apCents'];

function parseMonthlyActualsPack_(text) {
  if (typeof text !== 'string' || !text.length) throw new Error('The import pack is empty.');
  if (text.length > TPO.maxPrompt)
    throw new Error('The import pack is too large (' + text.length + ' characters; limit ' + TPO.maxPrompt + ').');
  var pack;
  try { pack = JSON.parse(text); }
  catch (e) { throw new Error('The import pack is not valid JSON: ' + e.message); }
  if (!pack || typeof pack !== 'object' || Array.isArray(pack))
    throw new Error('The import pack must be exactly one JSON object.');
  var top = Object.keys(pack);
  if (top.length !== 3 || top.indexOf('schema') < 0 || top.indexOf('source') < 0 || top.indexOf('months') < 0)
    throw new Error('The import pack must contain exactly schema, source and months — no extra tables.');
  if (pack.schema !== MONTHLY_PACK_SCHEMA)
    throw new Error('Unsupported pack schema ' + JSON.stringify(pack.schema) + '; expected ' + MONTHLY_PACK_SCHEMA + '.');
  var source = pack.source;
  if (!source || typeof source !== 'object' || Array.isArray(source))
    throw new Error('The pack source must be an object.');
  var sourceKeys = Object.keys(source);
  if (sourceKeys.length !== 3 || sourceKeys.indexOf('filename') < 0 || sourceKeys.indexOf('sha256') < 0 ||
    sourceKeys.indexOf('reportMonth') < 0)
    throw new Error('The pack source must contain exactly filename, sha256 and reportMonth.');
  if (typeof source.filename !== 'string' || !source.filename.trim() || /[\/\\\n]/.test(source.filename))
    throw new Error('The pack source filename must be a nonempty basename without path separators.');
  if (typeof source.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(source.sha256))
    throw new Error('The pack source sha256 must be 64 lowercase hexadecimal characters.');
  if (typeof source.reportMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(source.reportMonth))
    throw new Error('The pack source reportMonth must be a valid YYYY-MM.');
  if (!Array.isArray(pack.months) || pack.months.length < 1 || pack.months.length > 24)
    throw new Error('The pack must contain 1–24 months.');
  var report = monthlyPackPeriod_(source.reportMonth);
  var seen = {};
  pack.months.forEach(function (record, index) {
    if (!record || typeof record !== 'object' || Array.isArray(record))
      throw new Error('Pack month ' + (index + 1) + ' must be an object.');
    var keys = Object.keys(record);
    if (keys.length !== 5 || keys.indexOf('month') < 0 || keys.indexOf('financials') < 0 ||
      keys.indexOf('workingCapital') < 0 || keys.indexOf('checks') < 0 || keys.indexOf('sourceRefs') < 0)
      throw new Error('Pack month ' + (index + 1) + ' must contain exactly month, financials, workingCapital, checks and sourceRefs.');
    if (typeof record.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(record.month))
      throw new Error('Pack month ' + (index + 1) + ' has an invalid month key ' + JSON.stringify(record.month) + '.');
    if (seen[record.month]) throw new Error('Duplicate pack month ' + record.month + '.');
    seen[record.month] = true;
    var period = monthlyPackPeriod_(record.month);
    if (period.key > report.key)
      throw new Error('Pack month ' + record.month + ' is beyond the pack reporting month ' + source.reportMonth + '.');
    if (period.year !== report.year && period.year !== report.year - 1)
      throw new Error('Pack month ' + record.month + ' is outside the prior/current years implied by ' + source.reportMonth + '.');
    var groups = [['financials', ['revenueCents', 'cogsCents', 'sgaCents', 'netIncomeCents']],
      ['workingCapital', ['cashCents', 'arCents', 'inventoryCents', 'apCents']],
      ['checks', ['grossProfitCents', 'ebitCents']]];
    groups.forEach(function (group) {
      var value = record[group[0]];
      var valueKeys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
      if (!value || valueKeys.length !== group[1].length || group[1].some(k => valueKeys.indexOf(k) < 0))
        throw new Error('Pack month ' + record.month + ' ' + group[0] + ' must contain exactly ' + group[1].join(', ') + '.');
      group[1].forEach(function (key) {
        if (typeof value[key] !== 'number' || !Number.isSafeInteger(value[key]))
          throw new Error('Pack month ' + record.month + ' ' + group[0] + '.' + key + ' must be a safe integer number of satang.');
      });
    });
    var f = record.financials, w = record.workingCapital, c = record.checks;
    var gpSafe = safeCentsSum_([f.revenueCents, -f.cogsCents]);
    var ebitSafe = safeCentsSum_([f.revenueCents, -f.cogsCents, -f.sgaCents]);
    var nwcSafe = safeCentsSum_([w.cashCents, w.arCents, w.inventoryCents, -w.apCents]);
    if (gpSafe === null || ebitSafe === null || nwcSafe === null)
      throw new Error('Pack month ' + record.month + ' produces derived amounts outside the safe-integer range.');
    [['gross profit', c.grossProfitCents, gpSafe],
      ['EBIT', c.ebitCents, safeCentsSum_([c.grossProfitCents, -f.sgaCents])]].forEach(function (identity) {
      if (identity[2] === null || Math.abs(identity[1] - identity[2]) > 1)
        throw new Error('Pack month ' + record.month + ' ' + identity[0] +
          ' does not reconcile with its inputs (' + identity[1] + ' vs ' + identity[2] + ' satang).');
    });
    var refs = record.sourceRefs;
    if (!refs || typeof refs !== 'object' || Array.isArray(refs))
      throw new Error('Pack month ' + record.month + ' sourceRefs must be an object.');
    var refKeys = Object.keys(refs);
    if (refKeys.length !== MONTHLY_REF_KEYS.length || MONTHLY_REF_KEYS.some(k => refKeys.indexOf(k) < 0))
      throw new Error('Pack month ' + record.month + ' sourceRefs must contain exactly the eight field arrays.');
    MONTHLY_REF_KEYS.forEach(function (key) {
      var list = refs[key];
      if (!Array.isArray(list) || !list.length || list.some(r => typeof r !== 'string' || !/^[A-Za-z][A-Za-z0-9 ]*![A-Z]{1,3}[0-9]+$/.test(r)))
        throw new Error('Pack month ' + record.month + ' sourceRefs.' + key + ' must be a nonempty array of sheet!cell references.');
    });
  });
  return pack;
}

function monthlyPackPeriod_(key) {
  var parts = /^(\d{4})-(\d{2})$/.exec(key);
  return { year: Number(parts[1]), month: Number(parts[2]), key: Number(parts[1]) * 12 + Number(parts[2]) - 1 };
}

/** Normalize an existing target cell to integer satang. Blank is not zero; percentages,
 * unrecognized text, dates and non-finite or out-of-range numbers are blocking, not guesses. */
function monthlyValueToCents_(value) {
  if (value === '' || value === null || value === undefined) return { cents: null };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { cents: null, error: 'a non-finite number' };
    if (Math.abs(value) >= 1e15) return { cents: null, error: 'outside the supported numeric range' };
    return monthlyDecimalCents_(String(value));
  }
  if (typeof value === 'string') {
    var text = value.trim();
    if (!text) return { cents: null };
    if (/%/.test(text)) return { cents: null, error: 'a percentage, not a THB amount' };
    if (TPOCore.number(text) === null)
      return { cents: null, error: 'not a recognized THB amount' };
    text = text.replace(/^฿\s*/, '').replace(/^\((.*)\)$/, '-$1').replace(/,/g, '');
    return monthlyDecimalCents_(text);
  }
  return { cents: null, error: 'an unsupported cell type (' + (value instanceof Date ? 'date' : typeof value) + ')' };
}

/** Exact safe integer addition/subtraction. Uses BigInt to prevent intermediate overflow or cancellation drift. */
function safeCentsSum_(parts) {
  var total = BigInt(0); // Constructor form: Apps Script's parser rejects BigInt literals.
  for (var i = 0; i < parts.length; i++) {
    var v = parts[i];
    if (v === null || v === undefined) return null;
    total += BigInt(v);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER))
    return null;
  return Number(total);
}

/** Strict decimal-string HALF_UP conversion to integer satang with bounded exponent expansion. */
function monthlyDecimalCents_(text) {
  var match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match || (!match[2] && !match[3])) return { cents: null, error: 'not a plain decimal number' };
  var exponent = Number(match[4] || 0);
  if (Math.abs(exponent) > 500) return { cents: null, error: 'an unsupported exponent' };
  var whole = match[2] || '';
  var fraction = match[3] || '';
  if (whole.length + fraction.length > 1000) return { cents: null, error: 'outside the supported numeric range' };
  var digits = whole + fraction;
  var point = whole.length + exponent;
  if (point < 1) {
    var pad = 1 - point;
    for (var i = 0; i < pad; i++) digits = '0' + digits;
    point = 1;
  } else if (point > digits.length) {
    var padEnd = point - digits.length;
    for (var j = 0; j < padEnd; j++) digits += '0';
  }
  var centPoint = point + 2;
  while (digits.length < centPoint) digits += '0';
  var intPartStr = digits.slice(0, centPoint).replace(/^0+/, '') || '0';
  if (intPartStr.length > 16) return { cents: null, error: 'outside the safe-integer range' };
  var cents = Number(intPartStr);
  if (!Number.isSafeInteger(cents)) return { cents: null, error: 'outside the safe-integer range' };
  if (digits.length > centPoint && Number(digits[centPoint]) >= 5) {
    cents += 1;
  }
  if (!Number.isSafeInteger(cents)) return { cents: null, error: 'outside the safe-integer range' };
  return { cents: cents === 0 ? 0 : (match[1] === '-' ? -cents : cents) };
}

function monthlyActualsDiff_(oldCents, newCents) {
  if (oldCents === null || oldCents === undefined)
    return { deltaCents: null, deltaPercent: null };
  var deltaCents = safeCentsSum_([newCents, -oldCents]);
  if (deltaCents === null)
    return { deltaCents: null, deltaPercent: null, overflow: true };
  return { deltaCents: deltaCents, deltaPercent: oldCents === 0 ? null : 100 * deltaCents / Math.abs(oldCents) };
}

/** Read only the two destination tabs: headers, values, formulas and IDs in one pass. */
function readMonthlyImportTargets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var timezone = context_('Read import targets', { function: 'readMonthlyImportTargets_' },
    () => spreadsheetTimezone_(ss));
  var cells = 0, sheets = {};
  MONTHLY_IMPORT_TABS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) throw new Error('The import requires both "' + MONTHLY_IMPORT_TABS.join('" and "') +
      '" tabs. "' + name + '" is missing; tabs are never created or guessed.');
    var rows = sh.getLastRow(), cols = sh.getLastColumn();
    cells += rows * cols;
    if (cells > TPO.maxSourceCells)
      throw new Error('Import target tabs exceed ' + TPO.maxSourceCells + ' cells; no data was truncated.');
    var values = [], formulas = [];
    if (rows) {
      var range = sh.getRange(1, 1, rows, cols);
      values = range.getValues();
      formulas = range.getFormulas();
    }
    var aliases = TPOCore.defs[name];
    var canonical = name === 'MonthlyFinancials'
      ? ['month', 'revenue', 'cogs', 'gp', 'sga', 'ebit', 'netIncome', 'quarter']
      : ['month', 'cash', 'ar', 'inventory', 'ap', 'nwc'];
    var headers = rows ? values[0] : [];
    var normalized = headers.map(normalize_);
    var map = {};
    canonical.forEach(function (field, index) {
      var matches = [];
      normalized.forEach(function (header, col) {
        if (aliases[index].indexOf(header) >= 0) matches.push(col);
      });
      if (matches.length !== 1)
        throw new Error(name + ' needs exactly one ' + aliases[index][0] + ' column' +
          (matches.length ? ' (found ' + matches.length + ')' : ' (missing)') + '.');
      map[field] = matches[0];
    });
    var monthRows = new Map();
    for (var index = 1; index < rows; index++) {
      var sheetRow = index + 1;
      var nonempty = values[index].some(hasValue_) || formulas[index].some(f => String(f || ''));
      var cellValue = values[index][map.month];
      if (cellValue instanceof Date)
        cellValue = formatDateChecked_(cellValue, timezone, 'yyyy-MM-dd',
          { sheet: name, cell: columnName_(map.month + 1) + sheetRow });
      var period = TPOCore.month(cellValue);
      if (!period) {
        if (nonempty) throw new Error(name + '!' + columnName_(map.month + 1) + sheetRow +
          ': unrecognized or missing month in a nonempty row. Use labels such as Sep-26; the importer never guesses keys.');
        continue;
      }
      if (monthRows.has(period.label))
        throw new Error(name + ' has duplicate month ' + period.label + ' in rows ' +
          monthRows.get(period.label).row + ' and ' + sheetRow + '. Resolve it before importing.');
      var slot = { row: sheetRow, label: period.display, monthKey: period.label, quarter: period.quarter, values: {}, formulas: {} };
      canonical.forEach(function (field) {
        slot.values[field] = values[index][map[field]];
        slot.formulas[field] = String(formulas[index][map[field]] || '');
      });
      monthRows.set(period.label, slot);
    }
    sheets[name] = { name: name, id: sh.getSheetId(), headers: headers, map: map, canonical: canonical,
      rows: monthRows, lastUsedRow: rows, lastCol: cols, values: values, formulas: formulas };
  });
  return { timezone: timezone, sheets: sheets };
}

/** Deterministic hashable state of the two tabs, captured from the read used for planning. */
function monthlyTargetState_(targets) {
  return MONTHLY_IMPORT_TABS.map(function (name) {
    var target = targets.sheets[name];
    return { name: name, id: target.id, headers: target.headers,
      values: target.values, formulas: target.formulas };
  });
}

function monthlyPreviewHash_(text, targets) {
  return digest_(JSON.stringify([digest_(text), monthlyTargetState_(targets)]));
}

function monthlyDerivedFormula_(tab, spec, row, map) {
  var refs = spec.formulaInputs.map(f => TPOCore.col(map[f]) + row);
  if (spec.field === 'nwc')
    return '=IF(COUNT(' + refs.join(',') + ')=4,' + refs[0] + '+' + refs[1] + '+' + refs[2] + '-' + refs[3] + ',"")';
  return '=IF(COUNT(' + refs.join(',') + ')=2,' + refs[0] + '-' + refs[1] + ',"")';
}

/** Both recognized forms (blank-safe canonical and legacy direct arithmetic), whitespace/case-insensitive. */
function monthlyRecognizedFormulas_(tab, spec, row, map) {
  var refs = spec.formulaInputs.map(f => TPOCore.col(map[f]) + row);
  var legacy = spec.field === 'nwc'
    ? '=' + refs[0] + '+' + refs[1] + '+' + refs[2] + '-' + refs[3]
    : '=' + refs[0] + '-' + refs[1];
  return [monthlyDerivedFormula_(tab, spec, row, map), legacy]
    .map(f => f.replace(/\s+/g, '').toUpperCase());
}

/** Derived amounts are projected from the imported raw satang values, never from pack check fields. */
function monthlyProposedCents_(spec, record) {
  var f = record.financials, w = record.workingCapital;
  if (spec.field === 'gp') return safeCentsSum_([f.revenueCents, -f.cogsCents]);
  if (spec.field === 'ebit') return safeCentsSum_([f.revenueCents, -f.cogsCents, -f.sgaCents]);
  return safeCentsSum_([w.cashCents, w.arCents, w.inventoryCents, -w.apCents]);
}

function monthlyRawPopulated_(slot, tab) {
  if (!slot) return false;
  return MONTHLY_IMPORT_RAW[tab].some(function (pair) {
    return hasValue_(slot.values[pair[0]]) || slot.formulas[pair[0]];
  });
}

/** Pure planner: preview records with per-month conflicts/changes; with a validated selection,
 * also the exact backupAndWrite_ plan (selected months only, appends allocated chronologically). */
function monthlyActualsPlan_(pack, targets, selectedMonths) {
  var monthsByKey = new Map(pack.months.map(m => [m.month, m]));
  var mf = targets.sheets['MonthlyFinancials'], wc = targets.sheets['1. Working Capital'];
  var destinationLatest = null;
  mf.rows.forEach(function (slot, label) {
    var parsed = monthlyValueToCents_(slot.values.revenue);
    if (parsed.cents !== null) {
      var period = TPOCore.month(label);
      if (!destinationLatest || period.key > destinationLatest.key) destinationLatest = period;
    }
  });
  var sortedMonths = pack.months.slice().sort((a, b) => a.month < b.month ? -1 : a.month > b.month ? 1 : 0);
  var latestSourceMonthRecord = sortedMonths[sortedMonths.length - 1];
  var latestSourceKey = latestSourceMonthRecord ? monthlyPackPeriod_(latestSourceMonthRecord.month).key : null;
  var records = sortedMonths
    .map(function (record) {
      var period = monthlyPackPeriod_(record.month);
      var slotMF = mf.rows.get(record.month), slotWC = wc.rows.get(record.month);
      var conflicts = [], changes = [];
      var isNew = !monthlyRawPopulated_(slotMF, 'MonthlyFinancials') &&
        !monthlyRawPopulated_(slotWC, '1. Working Capital');
      var seenChange = false;
      MONTHLY_IMPORT_TABS.forEach(function (tab) {
        var target = targets.sheets[tab], slot = tab === 'MonthlyFinancials' ? slotMF : slotWC;
        MONTHLY_IMPORT_RAW[tab].forEach(function (pair) {
          var field = pair[0], centsKey = pair[1],
            proposed = (tab === 'MonthlyFinancials' ? record.financials : record.workingCapital)[centsKey];
          var existing = null, cell = 'New row';
          if (slot) {
            cell = columnName_(target.map[field] + 1) + slot.row;
            if (slot.formulas[field]) {
              conflicts.push({ sheet: tab, cell: cell,
                message: 'contains a formula (' + slot.formulas[field] + '); the importer never overwrites a raw-input formula.' });
              return;
            }
            var parsed = monthlyValueToCents_(slot.values[field]);
            if (parsed.error) {
              conflicts.push({ sheet: tab, cell: cell, message: 'existing value is ' + parsed.error + '.' });
              return;
            }
            existing = parsed.cents;
          }
          if (existing !== null && existing === proposed) return;
          var diff = monthlyActualsDiff_(existing, proposed);
          if (diff.overflow || (diff.deltaCents !== null && !Number.isSafeInteger(diff.deltaCents))) {
            conflicts.push({ sheet: tab, cell: cell, message: 'the amount difference is outside the safe-integer range.' });
            return;
          }
          seenChange = true;
          changes.push({ sheet: tab, cell: cell, field: centsKey, kind: 'input',
            previousCents: existing, proposedCents: proposed, deltaCents: diff.deltaCents,
            deltaPercent: diff.deltaPercent, sourceRefs: record.sourceRefs[centsKey], formulaRefresh: false });
        });
        MONTHLY_IMPORT_DERIVED[tab].forEach(function (spec) {
          var proposed = monthlyProposedCents_(spec, record);
          var existing = null, cell = 'New row', hasFormula = false, recognized = true;
          if (slot) {
            cell = columnName_(target.map[spec.field] + 1) + slot.row;
            var formula = slot.formulas[spec.field];
            if (formula) {
              hasFormula = true;
              var known = monthlyRecognizedFormulas_(tab, spec, slot.row, target.map);
              if (known.indexOf(formula.replace(/\s+/g, '').toUpperCase()) < 0) {
                conflicts.push({ sheet: tab, cell: cell,
                  message: 'contains a custom formula (' + formula + '); its result cannot be predicted, so the month is blocked.' });
                recognized = false;
              }
            }
            var parsed = monthlyValueToCents_(slot.values[spec.field]);
            if (parsed.error) {
              conflicts.push({ sheet: tab, cell: cell, message: 'existing calculated value is ' + parsed.error + '.' });
              recognized = false;
            } else existing = parsed.cents;
          }
          if (!recognized) return;
          if (proposed === null) {
            conflicts.push({ sheet: tab, cell: cell, message: 'the calculated ' + spec.field.toUpperCase() + ' value is outside the safe-integer range.' });
            return;
          }
          // Recognized formulas (canonical or legacy) are preserved; only literals/blanks convert.
          if (hasFormula && existing === proposed) return;
          var diff = monthlyActualsDiff_(existing, proposed);
          if (diff.overflow || (diff.deltaCents !== null && !Number.isSafeInteger(diff.deltaCents))) {
            conflicts.push({ sheet: tab, cell: cell, message: 'the calculated difference is outside the safe-integer range.' });
            return;
          }
          seenChange = true;
          var refs = [];
          spec.provenance.forEach(function (inputField) {
            var centsKey = MONTHLY_IMPORT_RAW[tab].find(p => p[0] === inputField)[1];
            refs = refs.concat(record.sourceRefs[centsKey]);
          });
          changes.push({ sheet: tab, cell: cell, field: spec.field, kind: 'calculated',
            previousCents: existing, proposedCents: proposed, deltaCents: diff.deltaCents,
            deltaPercent: diff.deltaPercent, sourceRefs: refs, formulaRefresh: !hasFormula });
        });
        if (tab === 'MonthlyFinancials' && slot) {
          var quarterPeriod = TPOCore.month(slot.monthKey || record.month + '-01');
          if (hasValue_(slot.values.quarter)) {
            var existingQ = TPOCore.quarter(slot.values.quarter);
            if (!existingQ || existingQ.label !== quarterPeriod.quarter)
              conflicts.push({ sheet: tab, cell: columnName_(target.map.quarter + 1) + slot.row,
                message: 'existing quarter "' + String(slot.values.quarter).trim() + '" disagrees with the month.' });
          } else if (slot.formulas.quarter) {
            conflicts.push({ sheet: tab, cell: columnName_(target.map.quarter + 1) + slot.row,
              message: 'quarter formula has an empty or unverified result; cannot verify agreement with the month.' });
          }
        }
      });
      var status = conflicts.length ? 'blocked' : isNew ? 'new' : seenChange ? 'changed' : 'unchanged';
      return { month: record.month, label: TPOCore.month(record.month + '-01').display,
        status: status, defaultSelected: false, conflicts: conflicts, changes: changes,
        packMonth: record,
        historical: latestSourceKey !== null ? period.key < latestSourceKey : false };
    });
  var latestSource = records[records.length - 1];
  if (latestSource && (latestSource.status === 'changed' || latestSource.status === 'new') &&
    (!destinationLatest || monthlyPackPeriod_(latestSource.month).key >= destinationLatest.key))
    latestSource.defaultSelected = true;
  var plan = [];
  if (selectedMonths !== null && selectedMonths !== undefined) {
    if (!Array.isArray(selectedMonths) || !selectedMonths.length)
      throw new Error('Select at least one month to apply.');
    var chosen = new Set();
    selectedMonths.forEach(function (key) {
      if (typeof key !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(key))
        throw new Error('Invalid month key in the selection: ' + JSON.stringify(key) + '.');
      if (chosen.has(key)) throw new Error('Duplicate month in the selection: ' + key + '.');
      chosen.add(key);
      if (!monthsByKey.get(key)) throw new Error('Month ' + key + ' is not in the import pack.');
      var preview = records.find(r => r.month === key);
      if (preview.conflicts.length)
        throw new Error('Month ' + key + ' is blocked: ' + preview.conflicts[0].sheet + ' ' +
          preview.conflicts[0].cell + ' ' + preview.conflicts[0].message);
    });
    var byKey = new Map(records.map(r => [r.month, r]));
    var nextRow = {};
    MONTHLY_IMPORT_TABS.forEach(tab => nextRow[tab] = targets.sheets[tab].lastUsedRow + 1);
    Array.from(chosen).sort().forEach(function (key) {
      var record = byKey.get(key), source = pack.source;
      var provenance = source.filename + ' (SHA-256 ' + source.sha256 + ')';
      MONTHLY_IMPORT_TABS.forEach(function (tab) {
        var target = targets.sheets[tab], slot = target.rows.get(key);
        var row = slot ? slot.row : nextRow[tab]++;
        var monthPeriod = TPOCore.month(key + '-01');
        if (!slot) {
          plan.push({ sheet: tab, row: row, col: target.map.month + 1, value: monthPeriod.display,
            text: true, reason: 'New month row from ' + provenance });
          if (tab === 'MonthlyFinancials')
            plan.push({ sheet: tab, row: row, col: target.map.quarter + 1, value: monthPeriod.quarter,
              reason: 'Quarter derived from month ' + key });
        } else if (tab === 'MonthlyFinancials' && record.changes.length > 0 && !hasValue_(slot.values.quarter) && !slot.formulas.quarter) {
          plan.push({ sheet: tab, row: row, col: target.map.quarter + 1, value: monthPeriod.quarter,
            reason: 'Quarter derived from month ' + key });
        }
        MONTHLY_IMPORT_RAW[tab].forEach(function (pair) {
          var field = pair[0], centsKey = pair[1];
          var proposed = (tab === 'MonthlyFinancials' ? record.packMonth.financials : record.packMonth.workingCapital)[centsKey];
          if (slot) {
            if (slot.formulas[field]) return;  // blocked above; never overwrite a raw-input formula
            var parsed = monthlyValueToCents_(slot.values[field]);
            if (parsed.cents === proposed) return;
          }
          plan.push({ sheet: tab, row: row, col: target.map[field] + 1, value: proposed / 100,
            reason: 'Import actuals from ' + provenance + ' · ' + record.packMonth.sourceRefs[centsKey].join(', ') });
        });
        MONTHLY_IMPORT_DERIVED[tab].forEach(function (spec) {
          // Preserve recognized existing formulas (canonical or legacy); convert only literals/blanks/new rows.
          if (slot && slot.formulas[spec.field]) return;
          plan.push({ sheet: tab, row: row, col: target.map[spec.field] + 1,
            value: monthlyDerivedFormula_(tab, spec, row, target.map), formula: true,
            reason: 'Refresh blank-safe ' + spec.field.toUpperCase() + ' formula from imported inputs' });
        });
      });
    });
    var deduped = new Map();
    plan.forEach(entry => deduped.set(entry.sheet + '|' + entry.row + '|' + entry.col, entry));
    plan = Array.from(deduped.values()).sort((a, b) => a.sheet === b.sheet
      ? (a.row - b.row) || (a.col - b.col) : (a.sheet < b.sheet ? -1 : 1));
  }
  var summary = { changedExisting: 0, newValues: 0, historicalMonths: 0, unchanged: 0 };
  records.forEach(function (record) {
    if (record.status === 'unchanged') summary.unchanged++;
    if (record.historical && (record.status === 'changed' || record.status === 'blocked')) summary.historicalMonths++;
    record.changes.forEach(function (change) {
      if (change.previousCents === null) summary.newValues++;
      else summary.changedExisting++;
    });
    delete record.packMonth;
  });
  return { months: records, summary: summary, plan: plan };
}

function previewMonthlyActualsImport(text) {
  return serverAction_('Preview monthly actuals import', () => locked_(() => {
    const pack = parseMonthlyActualsPack_(text);
    const targets = readMonthlyImportTargets_();
    const planned = monthlyActualsPlan_(pack, targets, null);
    return { previewHash: monthlyPreviewHash_(text, targets),
      source: pack.source, summary: planned.summary, months: planned.months };
  }));
}

function applyMonthlyActualsImport(text, selectedMonths, previewHash) {
  return serverAction_('Apply monthly actuals import', () => locked_(() => {
    const pack = parseMonthlyActualsPack_(text);
    const targets = readMonthlyImportTargets_();
    const planned = monthlyActualsPlan_(pack, targets, selectedMonths);
    // Stale check: the hash covers pack text plus both tabs' IDs, headers, values and formulas.
    if (typeof previewHash !== 'string' || !previewHash.length ||
      previewHash !== monthlyPreviewHash_(text, targets))
      throw new Error('Monthly inputs changed after preview. Preview again; nothing was imported.');
    // Immediate recheck of the exact tab state right before the first source mutation.
    const recheck = readMonthlyImportTargets_();
    if (monthlyPreviewHash_(text, recheck) !== previewHash)
      throw new Error('Monthly inputs changed after preview. Preview again; nothing was imported.');
    const plan = planned.plan;
    const applied = selectedMonths.slice().sort();
    if (!plan.length)
      return { months: applied, changes: 0, already: true, warnings: [] };
    const sizes = {};
    plan.forEach(p => { sizes[p.sheet] = Math.max(sizes[p.sheet] || 0, p.row); });
    Object.keys(sizes).forEach(name =>
      ensureSize_(sheet_(name), sizes[name], targets.sheets[name].lastCol));
    backupAndWrite_(plan, 'Import accounting actuals');
    return { months: applied, changes: plan.length, already: false, warnings: [] };
  }));
}

function menuImportMonthlyActuals() {
  uiAction_('Import accounting actuals', () => {
    const body = '<h2>Import accounting actuals</h2>' +
      '<p>Choose the JSON pack produced by <b>tools/extract-monthly-input.py</b>. The JSON pack is the import source; the XLSX review copy is for reading only. The importer fills MonthlyFinancials and 1. Working Capital inputs — customer, operational and assumption data stay separate manual inputs.</p>' +
      '<label for="file">JSON import pack</label><input id="file" type="file" accept=".json,application/json">' +
      '<button id="preview" disabled>Preview differences</button>' +
      '<button id="apply" disabled>Apply selected months</button>' +
      '<button id="select-all" class="secondary" disabled>Select all months</button>' +
      '<button id="close" class="secondary" onclick="google.script.host.close()">Close</button>' +
      '<div id="summary" class="meta"></div>' +
      '<div id="months" style="overflow:auto;max-height:330px;margin-top:8px;border:1px solid #ccd4d5;border-radius:6px;background:white"></div>' +
      '<div id="status" role="status"></div>';
    const script = `
      (function () {
        const file = document.getElementById('file'), previewBtn = document.getElementById('preview'),
          applyBtn = document.getElementById('apply'), months = document.getElementById('months'),
          selectAllBtn = document.getElementById('select-all'),
          summary = document.getElementById('summary'), status = document.getElementById('status');
        const state = { text: null, hash: null, records: null, busy: false };
        const monthCell = key => document.querySelector('input[data-month="' + key + '"]');
        const monthBoxes = () => Array.from(document.querySelectorAll('input[data-month]'));
        function setBusy(busy, label) {
          state.busy = busy;
          [file, previewBtn, applyBtn, selectAllBtn].forEach(control => control.disabled = busy ||
            (control === previewBtn && !state.text) || control === applyBtn || control === selectAllBtn);
          if (busy) monthBoxes().forEach(box => box.disabled = true);
          if (busy) { status.className = ''; status.textContent = label; }
          else { file.disabled = false; previewBtn.disabled = !state.text; refreshApply(); }
        }
        function refreshApply() {
          const boxes = monthBoxes();
          const selected = new Set(boxes.filter(box => box.checked).map(box => box.dataset.month));
          const historicalCount = document.getElementById('historical-count');
          if (historicalCount) historicalCount.textContent = (state.records || []).filter(record =>
            record.historical && (record.status === 'changed' || record.status === 'blocked') &&
            !selected.has(record.month)).length;
          selectAllBtn.disabled = state.busy || !state.hash ||
            !boxes.some(box => !box.disabled && !box.checked);
          if (state.busy) { applyBtn.disabled = true; return; }
          const ok = state.hash && monthBoxes().some(box => box.checked && !box.disabled);
          applyBtn.disabled = !ok;
        }
        function invalidatePreview() {
          state.hash = null;
          monthBoxes().forEach(box => { box.checked = false; });
          refreshApply();
        }
        function thb(cents) {
          if (cents === null || cents === undefined) return 'New value';
          return (cents < 0 ? '−' : '') + Math.abs(cents / 100).toLocaleString('en-US',
            { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        function pct(change) {
          if (change.previousCents === null || change.previousCents === undefined) return 'New value';
          if (change.previousCents === 0) return 'N/A (previous value is zero)';
          const value = change.deltaPercent;
          if (value === null || value === undefined || !isFinite(value)) return 'N/A';
          const sign = value < 0 ? '−' : '+', magnitude = Math.abs(value);
          if (magnitude > 0 && magnitude < 0.0001) return sign + '<0.0001%';
          return sign + magnitude.toFixed(4) + '%';
        }
        function cellText(parent, text) { const td = document.createElement('td'); td.textContent = text; parent.appendChild(td); return td; }
        function render(result) {
          months.textContent = ''; summary.textContent = '';
          const s = result.summary;
          summary.appendChild(document.createTextNode('Changed existing values: ' + s.changedExisting +
            ' · New values: ' + s.newValues + ' · Unselected historical corrections: '));
          const historicalCount = document.createElement('span');
          historicalCount.id = 'historical-count';
          summary.appendChild(historicalCount);
          summary.appendChild(document.createTextNode(' · Unchanged months: ' + s.unchanged +
            ' · Pack: ' + result.source.filename + ' · report ' + result.source.reportMonth +
            ' · Difference (%) is the change versus the absolute previous value.'));
          const hasDifferences = result.months.some(m => m.status === 'changed' || m.status === 'new');
          if (!hasDifferences) {
            status.className = '';
            status.textContent = result.months.some(m => m.status === 'blocked')
              ? 'No importable changes: every month is either unchanged or blocked (see conflicts below).'
              : 'No changes to import.';
            result.months.filter(m => m.status === 'blocked').forEach(renderMonthBlock);
            refreshApply();
            return;
          }
          const table = document.createElement('table');
          table.style.fontSize = '12px'; table.style.borderCollapse = 'collapse'; table.style.width = '100%';
          const head = document.createElement('tr');
          ['Month', 'Sheet', 'Cell', 'Field', 'Kind', 'Previous (THB)', 'Proposed (THB)',
            'Difference (THB)', 'Difference (%)', 'Source cells'].forEach(title => {
            const th = document.createElement('th'); th.textContent = title; head.appendChild(th);
          });
          table.appendChild(head);
          result.months.forEach(function (monthRecord) { renderMonth(table, monthRecord); });
          months.appendChild(table);
          refreshApply();
        }
        function renderMonthBlock(monthRecord) {
          const block = document.createElement('div');
          block.style.padding = '6px 10px'; block.style.borderBottom = '1px solid #e5e9e8';
          const title = document.createElement('b');
          title.textContent = monthRecord.label + ' — ' + monthRecord.status;
          block.appendChild(title);
          monthRecord.conflicts.forEach(function (conflict) {
            const note = document.createElement('div');
            note.style.color = '#a32929'; note.style.marginLeft = '12px';
            note.textContent = 'Blocked: ' + conflict.sheet + ' ' + conflict.cell + ' — ' + conflict.message;
            block.appendChild(note);
          });
          months.appendChild(block);
        }
        function renderMonth(table, monthRecord) {
          const band = document.createElement('tr');
          const bandCell = document.createElement('td');
          bandCell.colSpan = 10; bandCell.style.background = '#eef2f1';
          const box = document.createElement('input');
          box.type = 'checkbox'; box.dataset.month = monthRecord.month;
          box.style.width = 'auto'; box.style.margin = '0 8px 0 4px'; box.style.verticalAlign = 'middle';
          box.checked = !!monthRecord.defaultSelected;
          box.disabled = monthRecord.status === 'blocked';
          box.addEventListener('change', refreshApply);
          bandCell.appendChild(box);
          const label = document.createElement('b');
          label.textContent = monthRecord.label + ' — ' + monthRecord.status +
            (monthRecord.changes.length ? ' · ' + monthRecord.changes.length + ' change(s)' : '');
          bandCell.appendChild(label);
          monthRecord.conflicts.forEach(function (conflict) {
            const note = document.createElement('div');
            note.style.color = '#a32929'; note.style.marginLeft = '24px';
            note.textContent = 'Blocked: ' + conflict.sheet + ' ' + conflict.cell + ' — ' + conflict.message;
            bandCell.appendChild(note);
          });
          if (monthRecord.status === 'new') {
            const note = document.createElement('div');
            note.className = 'meta'; note.style.marginLeft = '24px';
            note.textContent = 'New period metadata (month label and quarter) is written with the month; it is not a monetary difference.';
            bandCell.appendChild(note);
          }
          band.appendChild(bandCell);
          table.appendChild(band);
          monthRecord.changes.forEach(function (change) {
            const row = document.createElement('tr');
            cellText(row, monthRecord.label);
            cellText(row, change.sheet);
            cellText(row, change.cell);
            cellText(row, change.field);
            cellText(row, change.kind === 'calculated' ? (change.formulaRefresh ? 'calculated · formula refresh' : 'calculated') : 'input');
            cellText(row, thb(change.previousCents));
            cellText(row, thb(change.proposedCents));
            cellText(row, change.deltaCents === null || change.deltaCents === undefined ? 'New value' :
              (change.deltaCents < 0 ? '−' : '+') + Math.abs(change.deltaCents / 100).toLocaleString('en-US',
                { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
            cellText(row, pct(change));
            cellText(row, change.sourceRefs.join(', '));
            table.appendChild(row);
          });
        }
        selectAllBtn.addEventListener('click', function () {
          if (state.busy || !state.hash) return;
          monthBoxes().forEach(box => { if (!box.disabled) box.checked = true; });
          refreshApply();
        });
        file.addEventListener('change', function () {
          state.text = null; state.hash = null; state.records = null;
          months.textContent = ''; summary.textContent = '';
          applyBtn.disabled = true; selectAllBtn.disabled = true; previewBtn.disabled = !file.files.length;
          status.className = '';
          status.textContent = file.files.length ? 'Ready to preview ' + file.files[0].name + '.' : '';
        });
        previewBtn.addEventListener('click', function () {
          const chosen = file.files[0];
          if (!chosen) return;
          setBusy(true, 'Previewing differences…');
          chosen.text().then(function (text) {
            state.text = text;
            google.script.run.withSuccessHandler(function (result) {
              state.hash = result.previewHash; state.records = result.months;
              status.className = ''; status.textContent = '';
              render(result); setBusy(false);
              monthBoxes().forEach(box => box.disabled =
                (state.records.find(m => m.month === box.dataset.month) || {}).status === 'blocked');
              refreshApply();
            }).withFailureHandler(function (error) {
              invalidatePreview(); setBusy(false); status.className = 'error';
              status.textContent = error.message || String(error);
            }).previewMonthlyActualsImport(text);
          }).catch(function (error) {
            invalidatePreview(); setBusy(false); status.className = 'error'; status.textContent = String(error);
          });
        });
        applyBtn.addEventListener('click', function () {
          const selected = (state.records || []).filter(m => monthCell(m.month) && monthCell(m.month).checked)
            .map(m => m.month);
          if (!selected.length) {
            status.className = 'error'; status.textContent = 'Select at least one month to apply.';
            return;
          }
          setBusy(true, 'Applying ' + selected.length + ' month(s)… Do not edit MonthlyFinancials or 1. Working Capital while applying.');
          google.script.run.withSuccessHandler(function (result) {
            state.busy = false;
            state.hash = null;
            applyBtn.disabled = true; previewBtn.disabled = false; file.disabled = false;
            selectAllBtn.disabled = true;
            monthBoxes().forEach(box => box.disabled = true);
            status.className = '';
            status.textContent = (result.already ? 'No writes were needed; the selected months already match the pack. '
              : 'Imported ' + result.changes + ' backed-up cell write(s) across ' + result.months.length +
              ' month(s). Previous values and formulas are recorded in the Repair Backup sheet. ') +
              'Run TPO → 2. Check & calculate, review Data Validation, then prepare a fresh AI prompt.';
          }).withFailureHandler(function (error) {
            invalidatePreview(); setBusy(false);
            monthBoxes().forEach(box => box.disabled = false);
            status.className = 'error';
            status.textContent = (error.message || String(error)) + ' Preview again before applying.';
          }).applyMonthlyActualsImport(state.text, selected, state.hash);
        });
      })();
    `;
    dialog_('TPO · Import accounting actuals', body, script, 700);
  });
}
