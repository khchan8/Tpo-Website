/** Sales presentation import: pack parsing, read-only planning, preview/apply RPCs and dialog.
 * Writes only approved months into CustomerRevenueMonthly and Customer Count through the existing
 * backupAndWrite_ audit/rollback path. Never touches financial, working-capital, assumption or LLM state.
 * Source customers must already exist in Assumptions; the importer never creates customers.
 * Shared math, tab reading, hashing, selection validation, RPC orchestration and the dialog
 * live in import-common.gs. */

var SALES_PACK_SCHEMA = 'tpo-sales-actuals-v1';
var SALES_IMPORT_TABS = ['CustomerRevenueMonthly', 'CustomerCount'];
var SALES_MAX_MONTHS = 36;

/** Canonical field order per destination tab, aligned with TPOCore.defs aliases. */
var SALES_TAB_FIELDS = {
  'CustomerRevenueMonthly': ['customer', 'month', 'revenue'],
  'CustomerCount': ['month', 'count']
};

function parseSalesActualsPack_(text) {
  if (typeof text !== 'string' || !text.length) throw new Error('The import pack is empty.');
  if (text.length > TPO.maxPrompt)
    throw new Error('The import pack is too large (' + text.length + ' characters; limit ' + TPO.maxPrompt + ').');
  var pack = JSON.parse(text);
  if (!pack || typeof pack !== 'object' || Array.isArray(pack))
    throw new Error('The import pack must be a JSON object.');
  var keys = Object.keys(pack);
  if (keys.length !== 4 || ['schema', 'source', 'customers', 'months'].some(k => keys.indexOf(k) < 0))
    throw new Error('The import pack must contain exactly schema, source, customers and months — no extra tables.');
  if (pack.schema !== SALES_PACK_SCHEMA)
    throw new Error('Unsupported pack schema ' + JSON.stringify(pack.schema) + '; expected ' + SALES_PACK_SCHEMA + '.');
  var source = pack.source;
  if (!source || typeof source !== 'object' || Array.isArray(source))
    throw new Error('The pack source must be an object.');
  var sourceKeys = Object.keys(source);
  if (sourceKeys.length !== 3 ||
    ['filename', 'sha256', 'reportMonth'].some(k => sourceKeys.indexOf(k) < 0))
    throw new Error('The pack source must contain exactly filename, sha256 and reportMonth.');
  if (typeof source.filename !== 'string' || !source.filename.trim() || source.filename.length > 200)
    throw new Error('The pack source filename must be a nonempty string.');
  if (typeof source.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(source.sha256))
    throw new Error('The pack source sha256 must be 64 lowercase hexadecimal characters.');
  if (typeof source.reportMonth !== 'string' || !ACTUALS_MONTH_KEY_RE.test(source.reportMonth))
    throw new Error('The pack source reportMonth must be a valid YYYY-MM.');
  if (!Array.isArray(pack.customers) || !pack.customers.length || pack.customers.length > 8)
    throw new Error('The pack must contain 1–8 customers.');
  var customerKeys = new Set(), customerNames = new Set();
  pack.customers.forEach(function (customer, index) {
    if (!customer || typeof customer !== 'object' || Array.isArray(customer))
      throw new Error('Pack customer ' + (index + 1) + ' must be an object.');
    var customerFields = Object.keys(customer);
    if (customerFields.length !== 5 ||
      ['key', 'sheet', 'label', 'name', 'sourceRef'].some(k => customerFields.indexOf(k) < 0))
      throw new Error('Pack customer ' + (index + 1) + ' must contain exactly key, sheet, label, name and sourceRef.');
    ['sheet', 'label', 'name', 'sourceRef'].forEach(function (field) {
      if (typeof customer[field] !== 'string' || !customer[field].trim() || customer[field].length > 100)
        throw new Error('Pack customer ' + (index + 1) + ' ' + field + ' must be a nonempty string.');
    });
    if (typeof customer.key !== 'string' || !/^[a-z0-9-]{1,40}$/.test(customer.key))
      throw new Error('Pack customer ' + (index + 1) + ' key must be lowercase letters, digits or dashes.');
    if (customerKeys.has(customer.key)) throw new Error('Duplicate pack customer key: ' + customer.key + '.');
    customerKeys.add(customer.key);
    if (customerNames.has(customerKey_(customer.name)))
      throw new Error('Duplicate pack customer name: ' + customer.name + '.');
    customerNames.add(customerKey_(customer.name));
  });
  if (!Array.isArray(pack.months) || !pack.months.length || pack.months.length > SALES_MAX_MONTHS)
    throw new Error('The pack must contain 1–' + SALES_MAX_MONTHS + ' months.');
  var seen = {};
  pack.months.forEach(function (record, index) {
    if (!record || typeof record !== 'object' || Array.isArray(record))
      throw new Error('Pack month ' + (index + 1) + ' must be an object.');
    var monthFields = Object.keys(record);
    if (monthFields.length !== 5 ||
      ['month', 'revenueCents', 'count', 'overallCents', 'reconciled'].some(k => monthFields.indexOf(k) < 0))
      throw new Error('Pack month ' + (index + 1) + ' must contain exactly month, revenueCents, count, overallCents and reconciled.');
    if (typeof record.month !== 'string' || !ACTUALS_MONTH_KEY_RE.test(record.month))
      throw new Error('Pack month ' + (index + 1) + ' has an invalid month key ' + JSON.stringify(record.month) + '.');
    if (seen[record.month]) throw new Error('Duplicate pack month ' + record.month + '.');
    seen[record.month] = true;
    if (!record.revenueCents || typeof record.revenueCents !== 'object' || Array.isArray(record.revenueCents))
      throw new Error('Pack month ' + record.month + ' revenueCents must be an object.');
    var total = 0;
    Object.keys(record.revenueCents).forEach(function (key) {
      if (!customerKeys.has(key))
        throw new Error('Pack month ' + record.month + ' revenueCents names unknown customer key ' + JSON.stringify(key) + '.');
      var cents = record.revenueCents[key];
      if (typeof cents !== 'number' || !Number.isSafeInteger(cents))
        throw new Error('Pack month ' + record.month + ' revenueCents.' + key + ' must be a safe integer number of satang.');
      total += cents;
    });
    if (record.count !== null && (typeof record.count !== 'number' || !Number.isSafeInteger(record.count) || record.count < 0))
      throw new Error('Pack month ' + record.month + ' count must be null or a nonnegative integer.');
    if (typeof record.overallCents !== 'number' || !Number.isSafeInteger(record.overallCents))
      throw new Error('Pack month ' + record.month + ' overallCents must be a safe integer number of satang.');
    if (typeof record.reconciled !== 'boolean')
      throw new Error('Pack month ' + record.month + ' reconciled must be true or false.');
    if (record.reconciled && Math.abs(total - record.overallCents) > 1)
      throw new Error('Pack month ' + record.month + ' is marked reconciled but its customers sum to ' +
        total + ' satang against overall ' + record.overallCents + '.');
  });
  var sorted = pack.months.map(m => m.month).sort();
  if (sorted.some((key, index) => index && monthlyPackPeriod_(key).key - monthlyPackPeriod_(sorted[index - 1]).key !== 1))
    throw new Error('The pack month range must be contiguous; rebuild the presentation tables before extracting.');
  if (sorted[sorted.length - 1] !== source.reportMonth)
    throw new Error('The last pack month must equal the pack reporting month ' + source.reportMonth + '.');
  return pack;
}

/** Read only the two destination tabs plus the Assumptions customer list in one pass. */
function readSalesImportTargets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var timezone = context_('Read sales import targets', { function: 'readSalesImportTargets_' },
    () => spreadsheetTimezone_(ss));
  var opts = { label: 'The sales import', tabs: SALES_IMPORT_TABS, limitLabel: 'Sales import target tabs',
    cells: 0,
    rowKey: function (rowValues, map, sheetRow, name) {
      if (name !== 'CustomerRevenueMonthly') return '';
      var customer = rowValues[map.customer];
      if (!hasValue_(customer) || typeof customer !== 'string' || !customer.trim())
        throw new Error(name + '!' + columnName_(map.customer + 1) + sheetRow +
          ': missing customer name in a nonempty row.');
      return customerKey_(customer.trim());
    },
    describeKey: function (key) { return 'entry for ' + key.replace('|', ' '); } };
  var sheets = {};
  SALES_IMPORT_TABS.forEach(function (name) {
    sheets[name] = readActualsTab_(ss, timezone, name, SALES_TAB_FIELDS[name], opts);
  });
  var assumptions = ss.getSheetByName('Assumptions');
  if (!assumptions) throw new Error('The sales import requires the "Assumptions" tab with the customer list.');
  var customers = [];
  var assumptionRows = Math.max(0, assumptions.getLastRow() - 1);
  if (assumptionRows > 0)
    assumptions.getRange(2, 1, assumptionRows, 1).getValues().forEach(function (row) {
      var name = row[0];
      if (hasValue_(name) && typeof name === 'string' && name.trim()) customers.push(name.trim());
    });
  if (!customers.length)
    throw new Error('Assumptions lists no customers; add them before importing sales data.');
  return { timezone: timezone, sheets: sheets, customers: customers };
}

function salesPreviewHash_(text, targets) {
  return actualsPreviewHash_(text, targets, SALES_IMPORT_TABS);
}

/** Map each pack customer to an existing Assumptions customer: exact name, or a unique
 * prefix in either direction (Mana Cannabis → Mana). Unknown or ambiguous names stop the import. */
function resolveSalesCustomers_(pack, targets) {
  var resolved = new Map();
  pack.customers.forEach(function (customer) {
    var exact = targets.customers.find(name => customerKey_(name) === customerKey_(customer.name));
    var match = exact || null;
    if (!match) {
      var packNorm = normalize_(customer.name);
      var candidates = targets.customers.filter(function (name) {
        var target = normalize_(name);
        return target.indexOf(packNorm) === 0 || packNorm.indexOf(target) === 0;
      });
      if (candidates.length === 1) match = candidates[0];
      if (!match)
        throw new Error('Source customer "' + customer.name + '" (' + customer.label + ') does not match any ' +
          'customer in Assumptions. Add it first via TPO → 1. Enter monthly data → Add customer…');
      if (candidates.length > 1)
        throw new Error('Source customer "' + customer.name + '" ambiguously matches several Assumptions ' +
          'customers (' + candidates.join(', ') + '). Rename one of them first.');
    }
    resolved.set(customer.key, { name: match });
  });
  return resolved;
}

/** Pure planner: preview records with per-month conflicts/changes; with a validated selection,
 * also the exact backupAndWrite_ plan (selected months only, appends allocated chronologically). */
function salesActualsPlan_(pack, targets, selectedMonths) {
  var resolved = resolveSalesCustomers_(pack, targets);
  var revenue = targets.sheets['CustomerRevenueMonthly'], counts = targets.sheets['CustomerCount'];
  var destinationLatest = null;
  revenue.rows.forEach(function (slot) {
    if (hasValue_(slot.values.revenue) || slot.formulas.revenue) {
      var key = monthlyPackPeriod_(slot.monthKey).key;
      if (destinationLatest === null || key > destinationLatest) destinationLatest = key;
    }
  });
  var byMonth = new Map(pack.months.map(record => [record.month, record]));
  var latestPackKey = monthlyPackPeriod_(pack.months[pack.months.length - 1].month).key;
  var records = pack.months.slice().sort((a, b) => a.month < b.month ? -1 : 1)
    .map(function (record) {
      var conflicts = [], changes = [];
      var five = Object.keys(record.revenueCents)
        .reduce((total, key) => total + record.revenueCents[key], 0);
      if (!record.reconciled)
        conflicts.push({ sheet: 'Source workbook', cell: 'Overall Sales ' + record.month,
          message: 'five-customer total ' + (five / 100).toLocaleString('en-US') +
            ' THB disagrees with the overall ' + (record.overallCents / 100).toLocaleString('en-US') +
            ' THB. Fix the presentation tabs and re-extract.' });
      pack.customers.forEach(function (customer) {
        var proposed = record.revenueCents[customer.key];
        if (proposed === undefined) return;
        var name = resolved.get(customer.key).name;
        var slot = revenue.rows.get(customerKey_(name) + '|' + record.month);
        var cell = slot ? 'C' + slot.row : 'New row';
        if (slot && slot.formulas.revenue) {
          conflicts.push({ sheet: 'CustomerRevenueMonthly', cell: cell,
            message: 'contains a formula (' + slot.formulas.revenue + '); the importer never overwrites a formula.' });
          return;
        }
        var parsed = slot ? monthlyValueToCents_(slot.values.revenue) : { cents: null };
        if (parsed.error) {
          conflicts.push({ sheet: 'CustomerRevenueMonthly', cell: cell, message: 'existing value is ' + parsed.error + '.' });
          return;
        }
        if (parsed.cents === proposed) return;
        var diff = monthlyActualsDiff_(parsed.cents, proposed);
        if (diff.overflow || (diff.deltaCents !== null && !Number.isSafeInteger(diff.deltaCents))) {
          conflicts.push({ sheet: 'CustomerRevenueMonthly', cell: cell,
            message: 'the amount difference is outside the safe-integer range.' });
          return;
        }
        changes.push({ sheet: 'CustomerRevenueMonthly', cell: cell, field: name + ' revenue', kind: 'input',
          previousCents: parsed.cents, proposedCents: proposed,
          deltaCents: diff.deltaCents, deltaPercent: diff.deltaPercent,
          sourceRefs: [customer.sheet + ' · ' + customer.label] });
      });
      if (record.count !== null) {
        var slot = counts.rows.get(record.month);
        var cell = slot ? 'B' + slot.row : 'New row';
        if (slot && slot.formulas.count) {
          conflicts.push({ sheet: 'CustomerCount', cell: cell,
            message: 'contains a formula (' + slot.formulas.count + '); the importer never overwrites a formula.' });
        } else {
          var parsed = slot ? monthlyValueToCents_(slot.values.count) : { cents: null };
          if (parsed.error)
            conflicts.push({ sheet: 'CustomerCount', cell: cell, message: 'existing value is ' + parsed.error + '.' });
          else if (parsed.cents !== null && parsed.cents % 100 !== 0)
            conflicts.push({ sheet: 'CustomerCount', cell: cell, message: 'existing value is not a whole customer count.' });
          else if (parsed.cents !== record.count * 100) {
            changes.push({ sheet: 'CustomerCount', cell: cell, field: 'CustomerCount', kind: 'input',
              previousCents: parsed.cents, proposedCents: record.count * 100,
              deltaCents: parsed.cents === null ? null : record.count * 100 - parsed.cents,
              deltaPercent: null,
              sourceRefs: ['Customer Count sheet · ' + record.month] });
          }
        }
      }
      var period = monthlyPackPeriod_(record.month);
      var status = conflicts.length ? 'blocked' : changes.length ? 'changed' : 'unchanged';
      return { month: record.month, label: TPOCore.month(record.month + '-01').display,
        status: status, defaultSelected: false, conflicts: conflicts, changes: changes,
        historical: period.key < latestPackKey };
    });
  var latestSource = records[records.length - 1];
  if (latestSource && latestSource.status === 'changed' &&
    (destinationLatest === null || monthlyPackPeriod_(latestSource.month).key >= destinationLatest))
    latestSource.defaultSelected = true;
  var plan = [];
  if (selectedMonths !== null && selectedMonths !== undefined) {
    var chosen = validateActualsSelection_(selectedMonths, records, byMonth);
    var nextRow = actualsAppendRows_(targets, SALES_IMPORT_TABS);
    var provenance = pack.source.filename + ' (SHA-256 ' + pack.source.sha256 + ')';
    Array.from(chosen).sort().forEach(function (key) {
      var record = byMonth.get(key);
      var monthPeriod = TPOCore.month(key + '-01');
      pack.customers.forEach(function (customer) {
        var proposed = record.revenueCents[customer.key];
        if (proposed === undefined) return;
        var name = resolved.get(customer.key).name;
        var slot = revenue.rows.get(customerKey_(name) + '|' + key);
        var row = slot ? slot.row : nextRow['CustomerRevenueMonthly']++;
        if (!slot) {
          plan.push({ sheet: 'CustomerRevenueMonthly', row: row, col: revenue.map.customer + 1,
            value: name, reason: 'New customer month from ' + provenance });
          plan.push({ sheet: 'CustomerRevenueMonthly', row: row, col: revenue.map.month + 1,
            value: monthPeriod.display, text: true,
            reason: 'New month row from ' + provenance });
        }
        if (slot && slot.formulas.revenue) return;  // blocked above; never overwrite a formula
        if (slot && monthlyValueToCents_(slot.values.revenue).cents === proposed) return;
        plan.push({ sheet: 'CustomerRevenueMonthly', row: row, col: revenue.map.revenue + 1,
          value: proposed / 100,
          reason: 'Import sales actuals from ' + provenance + ' · ' + customer.sheet });
      });
      if (record.count !== null) {
        var slot = counts.rows.get(key);
        var row = slot ? slot.row : nextRow['CustomerCount']++;
        if (!slot)
          plan.push({ sheet: 'CustomerCount', row: row, col: counts.map.month + 1,
            value: monthPeriod.display, text: true,
            reason: 'New month row from ' + provenance });
        if (!slot || (!slot.formulas.count && monthlyValueToCents_(slot.values.count).cents !== record.count * 100))
          plan.push({ sheet: 'CustomerCount', row: row, col: counts.map.count + 1,
            value: record.count,
            reason: 'Import customer count from ' + provenance });
      }
    });
    plan = finalizeActualsPlan_(plan);
  }
  var summary = { revenueChanges: 0, countChanges: 0, newValues: 0, historicalMonths: 0, unchanged: 0 };
  records.forEach(function (record) {
    if (record.status === 'unchanged') summary.unchanged++;
    if (record.historical && (record.status === 'changed' || record.status === 'blocked')) summary.historicalMonths++;
    record.changes.forEach(function (change) {
      if (change.previousCents === null) summary.newValues++;
      else if (change.sheet === 'CustomerCount') summary.countChanges++;
      else summary.revenueChanges++;
    });
  });
  return { months: records, summary: summary, plan: plan };
}

function previewSalesActualsImport(text) {
  return runActualsPreview_('Preview sales import', parseSalesActualsPack_,
    readSalesImportTargets_, salesActualsPlan_, salesPreviewHash_, text);
}

function applySalesActualsImport(text, selectedMonths, previewHash) {
  return runActualsApply_('Apply sales import', parseSalesActualsPack_,
    readSalesImportTargets_, salesActualsPlan_, salesPreviewHash_,
    'Sales inputs changed after preview. Preview again; nothing was imported.',
    'Import sales actuals', text, selectedMonths, previewHash);
}

function menuImportSalesActuals() {
  uiAction_('Import sales data', () => actualsImportDialog_({
    heading: 'Import sales data',
    intro: 'Choose the JSON pack produced by <b>tools/extract-sales-input.py</b> from the sales presentation workbook. The importer fills CustomerRevenueMonthly and Customer Count inputs — customers must already exist in Assumptions; financial, working-capital and assumption data stay separate inputs.',
    previewRpc: 'previewSalesActualsImport',
    applyRpc: 'applySalesActualsImport',
    editWarning: 'CustomerRevenueMonthly or Customer Count',
    summaryJs: "'Revenue changes: ' + s.revenueChanges + ' · Count updates: ' + s.countChanges + ' · New values: ' + s.newValues",
    changedTest: "m.status === 'changed'",
    kindJs: 'change.kind',
    newStatus: false
  }));
}
