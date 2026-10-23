/** Sales presentation import: pack parsing, read-only planning, preview/apply RPCs and dialog.
 * Writes only approved months into CustomerRevenueMonthly and Customer Count through the existing
 * backupAndWrite_ audit/rollback path. Never touches financial, working-capital, assumption or LLM state.
 * Source customers must already exist in Assumptions; the importer never creates customers. */

var SALES_PACK_SCHEMA = 'tpo-sales-actuals-v1';
var SALES_IMPORT_TABS = ['CustomerRevenueMonthly', 'CustomerCount'];
var SALES_MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
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
  if (typeof source.reportMonth !== 'string' || !SALES_MONTH_KEY_RE.test(source.reportMonth))
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
    if (typeof record.month !== 'string' || !SALES_MONTH_KEY_RE.test(record.month))
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
  var cells = 0, sheets = {};
  SALES_IMPORT_TABS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) throw new Error('The sales import requires both "' + SALES_IMPORT_TABS.join('" and "') +
      '" tabs. "' + name + '" is missing; tabs are never created or guessed.');
    var rows = sh.getLastRow(), cols = sh.getLastColumn();
    cells += rows * cols;
    if (cells > TPO.maxSourceCells)
      throw new Error('Sales import target tabs exceed ' + TPO.maxSourceCells + ' cells; no data was truncated.');
    var values = [], formulas = [];
    if (rows) {
      var range = sh.getRange(1, 1, rows, cols);
      values = range.getValues();
      formulas = range.getFormulas();
    }
    var aliases = TPOCore.defs[name];
    var canonical = SALES_TAB_FIELDS[name];
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
    var rowMap = new Map();
    for (var index = 1; index < rows; index++) {
      var sheetRow = index + 1;
      var nonempty = values[index].some(hasValue_) || formulas[index].some(f => String(f || ''));
      var monthCell = values[index][map.month];
      if (monthCell instanceof Date)
        monthCell = formatDateChecked_(monthCell, timezone, 'yyyy-MM-dd',
          { sheet: name, cell: columnName_(map.month + 1) + sheetRow });
      var period = TPOCore.month(monthCell);
      if (!period) {
        if (nonempty) throw new Error(name + '!' + columnName_(map.month + 1) + sheetRow +
          ': unrecognized or missing month in a nonempty row. Use labels such as Sep-26; the importer never guesses keys.');
        continue;
      }
      var rowKey = name === 'CustomerRevenueMonthly'
        ? (function () {
            var customer = values[index][map.customer];
            if (!hasValue_(customer) || typeof customer !== 'string' || !customer.trim())
              throw new Error(name + '!A' + sheetRow + ': missing customer name in a nonempty row.');
            return customerKey_(customer.trim()) + '|' + period.label;
          })()
        : period.label;
      if (rowMap.has(rowKey))
        throw new Error(name + ' has duplicate entry for ' + rowKey.replace('|', ' ') +
          ' in rows ' + rowMap.get(rowKey).row + ' and ' + sheetRow + '. Resolve it before importing.');
      var slot = { row: sheetRow, label: period.display, monthKey: period.label, values: {}, formulas: {} };
      canonical.forEach(function (field) {
        slot.values[field] = values[index][map[field]];
        slot.formulas[field] = String(formulas[index][map[field]] || '');
      });
      rowMap.set(rowKey, slot);
    }
    sheets[name] = { name: name, id: sh.getSheetId(), headers: headers, map: map, canonical: canonical,
      rows: rowMap, lastUsedRow: rows, lastCol: cols, values: values, formulas: formulas };
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

/** Deterministic hashable state of both tabs, captured from the read used for planning. */
function salesTargetState_(targets) {
  return SALES_IMPORT_TABS.map(function (name) {
    var target = targets.sheets[name];
    return { name: name, id: target.id, headers: target.headers,
      values: target.values, formulas: target.formulas };
  });
}

function salesPreviewHash_(text, targets) {
  return digest_(JSON.stringify([digest_(text), salesTargetState_(targets)]));
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
            var diff = { deltaCents: parsed.cents === null ? null : record.count * 100 - parsed.cents,
              deltaPercent: null };
            changes.push({ sheet: 'CustomerCount', cell: cell, field: 'CustomerCount', kind: 'input',
              previousCents: parsed.cents, proposedCents: record.count * 100,
              deltaCents: diff.deltaCents, deltaPercent: null,
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
    if (!Array.isArray(selectedMonths) || !selectedMonths.length)
      throw new Error('Select at least one month to apply.');
    var chosen = new Set();
    selectedMonths.forEach(function (key) {
      if (typeof key !== 'string' || !SALES_MONTH_KEY_RE.test(key))
        throw new Error('Invalid month key in the selection: ' + JSON.stringify(key) + '.');
      if (chosen.has(key)) throw new Error('Duplicate month in the selection: ' + key + '.');
      chosen.add(key);
      if (!byMonth.get(key)) throw new Error('Month ' + key + ' is not in the import pack.');
      var preview = records.find(r => r.month === key);
      if (preview.conflicts.length)
        throw new Error('Month ' + key + ' is blocked: ' + preview.conflicts[0].sheet + ' ' +
          preview.conflicts[0].cell + ' ' + preview.conflicts[0].message);
    });
    var nextRow = {};
    SALES_IMPORT_TABS.forEach(tab => nextRow[tab] = targets.sheets[tab].lastUsedRow + 1);
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
    var deduped = new Map();
    plan.forEach(entry => deduped.set(entry.sheet + '|' + entry.row + '|' + entry.col, entry));
    plan = Array.from(deduped.values()).sort((a, b) => a.sheet === b.sheet
      ? (a.row - b.row) || (a.col - b.col) : (a.sheet < b.sheet ? -1 : 1));
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
  return serverAction_('Preview sales import', () => locked_(() => {
    const pack = parseSalesActualsPack_(text);
    const targets = readSalesImportTargets_();
    const planned = salesActualsPlan_(pack, targets, null);
    return { previewHash: salesPreviewHash_(text, targets),
      source: pack.source, summary: planned.summary, months: planned.months };
  }));
}

function applySalesActualsImport(text, selectedMonths, previewHash) {
  return serverAction_('Apply sales import', () => locked_(() => {
    const pack = parseSalesActualsPack_(text);
    const targets = readSalesImportTargets_();
    const planned = salesActualsPlan_(pack, targets, selectedMonths);
    // Stale check: the hash covers pack text plus both tabs' IDs, headers, values and formulas.
    if (typeof previewHash !== 'string' || !previewHash.length ||
      previewHash !== salesPreviewHash_(text, targets))
      throw new Error('Sales inputs changed after preview. Preview again; nothing was imported.');
    const recheck = readSalesImportTargets_();
    if (salesPreviewHash_(text, recheck) !== previewHash)
      throw new Error('Sales inputs changed after preview. Preview again; nothing was imported.');
    const plan = planned.plan;
    const applied = selectedMonths.slice().sort();
    if (!plan.length)
      return { months: applied, changes: 0, already: true, warnings: [] };
    const sizes = {};
    plan.forEach(p => { sizes[p.sheet] = Math.max(sizes[p.sheet] || 0, p.row); });
    Object.keys(sizes).forEach(name =>
      ensureSize_(sheet_(name), sizes[name], targets.sheets[name].lastCol));
    backupAndWrite_(plan, 'Import sales actuals');
    return { months: applied, changes: plan.length, already: false, warnings: [] };
  }));
}

function menuImportSalesActuals() {
  uiAction_('Import sales data', () => {
    const body = '<h2>Import sales data</h2>' +
      '<p>Choose the JSON pack produced by <b>tools/extract-sales-input.py</b> from the sales presentation workbook. The importer fills CustomerRevenueMonthly and Customer Count inputs — customers must already exist in Assumptions; financial, working-capital and assumption data stay separate inputs.</p>' +
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
          applyBtn.disabled = true;
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
          summary.appendChild(document.createTextNode('Revenue changes: ' + s.revenueChanges +
            ' · Count updates: ' + s.countChanges + ' · New values: ' + s.newValues +
            ' · Unselected historical corrections: '));
          const historicalCount = document.createElement('span');
          historicalCount.id = 'historical-count';
          summary.appendChild(historicalCount);
          summary.appendChild(document.createTextNode(' · Unchanged months: ' + s.unchanged +
            ' · Pack: ' + result.source.filename + ' · report ' + result.source.reportMonth +
            ' · Difference (%) is the change versus the absolute previous value.'));
          const hasDifferences = result.months.some(m => m.status === 'changed');
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
          band.appendChild(bandCell);
          table.appendChild(band);
          monthRecord.changes.forEach(function (change) {
            const row = document.createElement('tr');
            cellText(row, monthRecord.label);
            cellText(row, change.sheet);
            cellText(row, change.cell);
            cellText(row, change.field);
            cellText(row, change.kind);
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
            }).previewSalesActualsImport(text);
          }).catch(function (error) {
            invalidatePreview(); setBusy(false); status.className = 'error'; status.textContent = String(error);
          });
        });
        selectAllBtn.addEventListener('click', function () {
          if (state.busy || !state.hash) return;
          monthBoxes().forEach(box => { if (!box.disabled) box.checked = true; });
          refreshApply();
        });
        applyBtn.addEventListener('click', function () {
          const selected = (state.records || []).filter(m => monthCell(m.month) && monthCell(m.month).checked)
            .map(m => m.month);
          if (!selected.length) {
            status.className = 'error'; status.textContent = 'Select at least one month to apply.';
            return;
          }
          setBusy(true, 'Applying ' + selected.length + ' month(s)… Do not edit CustomerRevenueMonthly or Customer Count while applying.');
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
          }).applySalesActualsImport(state.text, selected, state.hash);
        });
      })();
    `;
    dialog_('TPO · Import sales data', body, script, 700);
  });
}
