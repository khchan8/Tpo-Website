/** Monthly accounting-actuals import: pack parsing, read-only planning, preview/apply RPCs and dialog.
 * Writes only approved months into MonthlyFinancials and 1. Working Capital through the existing
 * backupAndWrite_ audit/rollback path. Never touches customer, operational, assumption or LLM state.
 * Shared math, tab reading, hashing, selection validation, RPC orchestration and the dialog
 * live in import-common.gs. */

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
var MONTHLY_TAB_FIELDS = {
  'MonthlyFinancials': ['month', 'revenue', 'cogs', 'gp', 'sga', 'ebit', 'netIncome', 'quarter'],
  '1. Working Capital': ['month', 'cash', 'ar', 'inventory', 'ap', 'nwc']
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

/** Read only the two destination tabs: headers, values, formulas and IDs in one pass. */
function readMonthlyImportTargets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var timezone = context_('Read import targets', { function: 'readMonthlyImportTargets_' },
    () => spreadsheetTimezone_(ss));
  var opts = { label: 'The import', tabs: MONTHLY_IMPORT_TABS, limitLabel: 'Import target tabs',
    cells: 0, rowKey: function () { return ''; }, describeKey: function (key) { return 'month ' + key; } };
  var sheets = {};
  MONTHLY_IMPORT_TABS.forEach(function (name) {
    sheets[name] = readActualsTab_(ss, timezone, name, MONTHLY_TAB_FIELDS[name], opts);
  });
  return { timezone: timezone, sheets: sheets };
}

function monthlyPreviewHash_(text, targets) {
  return actualsPreviewHash_(text, targets, MONTHLY_IMPORT_TABS);
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
    var chosen = validateActualsSelection_(selectedMonths, records, monthsByKey);
    var byKey = new Map(records.map(r => [r.month, r]));
    var nextRow = actualsAppendRows_(targets, MONTHLY_IMPORT_TABS);
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
    plan = finalizeActualsPlan_(plan);
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
  return runActualsPreview_('Preview monthly actuals import', parseMonthlyActualsPack_,
    readMonthlyImportTargets_, monthlyActualsPlan_, monthlyPreviewHash_, text);
}

function applyMonthlyActualsImport(text, selectedMonths, previewHash) {
  return runActualsApply_('Apply monthly actuals import', parseMonthlyActualsPack_,
    readMonthlyImportTargets_, monthlyActualsPlan_, monthlyPreviewHash_,
    'Monthly inputs changed after preview. Preview again; nothing was imported.',
    'Import accounting actuals', text, selectedMonths, previewHash);
}

function menuImportMonthlyActuals() {
  uiAction_('Import accounting actuals', () => actualsImportDialog_({
    heading: 'Import accounting actuals',
    intro: 'Choose the JSON pack produced by <b>tools/extract-monthly-input.py</b>. The JSON pack is the import source; the XLSX review copy is for reading only. The importer fills MonthlyFinancials and 1. Working Capital inputs — customer, operational and assumption data stay separate manual inputs.',
    previewRpc: 'previewMonthlyActualsImport',
    applyRpc: 'applyMonthlyActualsImport',
    editWarning: 'MonthlyFinancials or 1. Working Capital',
    summaryJs: "'Changed existing values: ' + s.changedExisting + ' · New values: ' + s.newValues",
    changedTest: "m.status === 'changed' || m.status === 'new'",
    kindJs: "change.kind === 'calculated' ? (change.formulaRefresh ? 'calculated · formula refresh' : 'calculated') : 'input'",
    newStatus: true
  }));
}
