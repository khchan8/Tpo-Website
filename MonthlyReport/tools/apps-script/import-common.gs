/** Shared machinery for the two actuals importers (accounting and sales): exact satang math,
 * destination-tab reading, preview hashing, selection validation, plan finalization, RPC
 * orchestration and the parameterized preview/apply dialog. Pack parsing, per-month planning
 * and provenance stay in the importer modules. */

var ACTUALS_MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthlyPackPeriod_(key) {
  var parts = /^(\d{4})-(\d{2})$/.exec(key);
  return { year: Number(parts[1]), month: Number(parts[2]), key: Number(parts[1]) * 12 + Number(parts[2]) - 1 };
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

function monthlyActualsDiff_(oldCents, newCents) {
  if (oldCents === null || oldCents === undefined)
    return { deltaCents: null, deltaPercent: null };
  var deltaCents = safeCentsSum_([newCents, -oldCents]);
  if (deltaCents === null)
    return { deltaCents: null, deltaPercent: null, overflow: true };
  return { deltaCents: deltaCents, deltaPercent: oldCents === 0 ? null : 100 * deltaCents / Math.abs(oldCents) };
}

/** Read one destination tab: headers, alias-mapped columns and per-row slots in one pass.
 * opts: { label, tabs, limitLabel, rowKey(values, map, sheetRow, name), describeKey(key) }.
 * opts.cells is a shared running cell counter across the importer's tabs. */
function readActualsTab_(ss, timezone, name, canonical, opts) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error(opts.label + ' requires both "' + opts.tabs.join('" and "') +
    '" tabs. "' + name + '" is missing; tabs are never created or guessed.');
  var rows = sh.getLastRow(), cols = sh.getLastColumn();
  opts.cells += rows * cols;
  if (opts.cells > TPO.maxSourceCells)
    throw new Error(opts.limitLabel + ' exceed ' + TPO.maxSourceCells + ' cells; no data was truncated.');
  var values = [], formulas = [];
  if (rows) {
    var range = sh.getRange(1, 1, rows, cols);
    values = range.getValues();
    formulas = range.getFormulas();
  }
  var aliases = TPOCore.defs[name];
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
    var prefix = opts.rowKey(values[index], map, sheetRow, name);
    var rowKey = prefix ? prefix + '|' + period.label : period.label;
    if (rowMap.has(rowKey))
      throw new Error(name + ' has duplicate ' + opts.describeKey(rowKey) + ' in rows ' +
        rowMap.get(rowKey).row + ' and ' + sheetRow + '. Resolve it before importing.');
    var slot = { row: sheetRow, label: period.display, monthKey: period.label, values: {}, formulas: {} };
    canonical.forEach(function (field) {
      slot.values[field] = values[index][map[field]];
      slot.formulas[field] = String(formulas[index][map[field]] || '');
    });
    rowMap.set(rowKey, slot);
  }
  return { name: name, id: sh.getSheetId(), headers: headers, map: map, canonical: canonical,
    rows: rowMap, lastUsedRow: rows, lastCol: cols, values: values, formulas: formulas };
}

/** Deterministic hashable state of the destination tabs, captured from the read used for planning. */
function actualsTabState_(targets, tabs) {
  return tabs.map(function (name) {
    var target = targets.sheets[name];
    return { name: name, id: target.id, headers: target.headers,
      values: target.values, formulas: target.formulas };
  });
}

function actualsPreviewHash_(text, targets, tabs) {
  return digest_(JSON.stringify([digest_(text), actualsTabState_(targets, tabs)]));
}

/** Shared selection validation: shape, canonical keys, uniqueness, pack membership, blocked months. */
function validateActualsSelection_(selectedMonths, records, monthsByKey) {
  if (!Array.isArray(selectedMonths) || !selectedMonths.length)
    throw new Error('Select at least one month to apply.');
  var chosen = new Set();
  selectedMonths.forEach(function (key) {
    if (typeof key !== 'string' || !ACTUALS_MONTH_KEY_RE.test(key))
      throw new Error('Invalid month key in the selection: ' + JSON.stringify(key) + '.');
    if (chosen.has(key)) throw new Error('Duplicate month in the selection: ' + key + '.');
    chosen.add(key);
    if (!monthsByKey.get(key)) throw new Error('Month ' + key + ' is not in the import pack.');
    var preview = records.find(r => r.month === key);
    if (preview.conflicts.length)
      throw new Error('Month ' + key + ' is blocked: ' + preview.conflicts[0].sheet + ' ' +
        preview.conflicts[0].cell + ' ' + preview.conflicts[0].message);
  });
  return chosen;
}

/** Append-row counters per destination tab, starting after the last used row. */
function actualsAppendRows_(targets, tabs) {
  var nextRow = {};
  tabs.forEach(tab => nextRow[tab] = targets.sheets[tab].lastUsedRow + 1);
  return nextRow;
}

/** Deduplicate by sheet|row|col and order writes sheet → row → column for stable backups. */
function finalizeActualsPlan_(plan) {
  var deduped = new Map();
  plan.forEach(entry => deduped.set(entry.sheet + '|' + entry.row + '|' + entry.col, entry));
  return Array.from(deduped.values()).sort((a, b) => a.sheet === b.sheet
    ? (a.row - b.row) || (a.col - b.col) : (a.sheet < b.sheet ? -1 : 1));
}

function runActualsPreview_(action, parseFn, readTargets, planFn, hashFn, text) {
  return serverAction_(action, () => locked_(() => {
    const pack = parseFn(text);
    const targets = readTargets();
    const planned = planFn(pack, targets, null);
    return { previewHash: hashFn(text, targets),
      source: pack.source, summary: planned.summary, months: planned.months };
  }));
}

function runActualsApply_(action, parseFn, readTargets, planFn, hashFn, staleMessage, backupLabel,
  text, selectedMonths, previewHash) {
  return serverAction_(action, () => locked_(() => {
    const pack = parseFn(text);
    const targets = readTargets();
    const planned = planFn(pack, targets, selectedMonths);
    // Stale check: the hash covers pack text plus every destination tab's ID, headers, values and formulas.
    if (typeof previewHash !== 'string' || !previewHash.length ||
      previewHash !== hashFn(text, targets))
      throw new Error(staleMessage);
    // Immediate recheck of the exact tab state right before the first source mutation.
    const recheck = readTargets();
    if (hashFn(text, recheck) !== previewHash)
      throw new Error(staleMessage);
    const plan = planned.plan;
    const applied = selectedMonths.slice().sort();
    if (!plan.length)
      return { months: applied, changes: 0, already: true, warnings: [] };
    const sizes = {};
    plan.forEach(p => { sizes[p.sheet] = Math.max(sizes[p.sheet] || 0, p.row); });
    Object.keys(sizes).forEach(name =>
      ensureSize_(sheet_(name), sizes[name], targets.sheets[name].lastCol));
    backupAndWrite_(plan, backupLabel);
    return { months: applied, changes: plan.length, already: false, warnings: [] };
  }));
}

/** Shared preview/apply dialog. opts: { heading, intro, previewRpc, applyRpc, editWarning,
 * summaryJs, changedTest, kindJs, newStatus }. summaryJs/kindJs are client-side expressions
 * over s/change; changedTest is a client-side predicate over m. */
function actualsImportDialog_(opts) {
  const body = '<h2>' + opts.heading + '</h2>' +
    '<p>' + opts.intro + '</p>' +
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
        summary.appendChild(document.createTextNode(${opts.summaryJs} + ' · Unselected historical corrections: '));
        const historicalCount = document.createElement('span');
        historicalCount.id = 'historical-count';
        summary.appendChild(historicalCount);
        summary.appendChild(document.createTextNode(' · Unchanged months: ' + s.unchanged +
          ' · Pack: ' + result.source.filename + ' · report ' + result.source.reportMonth +
          ' · Difference (%) is the change versus the absolute previous value.'));
        const hasDifferences = result.months.some(m => ${opts.changedTest});
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
        ${opts.newStatus ? `if (monthRecord.status === 'new') {
          const note = document.createElement('div');
          note.className = 'meta'; note.style.marginLeft = '24px';
          note.textContent = 'New period metadata (month label and quarter) is written with the month; it is not a monetary difference.';
          bandCell.appendChild(note);
        }` : ''}
        band.appendChild(bandCell);
        table.appendChild(band);
        monthRecord.changes.forEach(function (change) {
          const row = document.createElement('tr');
          cellText(row, monthRecord.label);
          cellText(row, change.sheet);
          cellText(row, change.cell);
          cellText(row, change.field);
          cellText(row, ${opts.kindJs});
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
          }).${opts.previewRpc}(text);
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
        setBusy(true, 'Applying ' + selected.length + ' month(s)… Do not edit ${opts.editWarning} while applying.');
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
        }).${opts.applyRpc}(state.text, selected, state.hash);
      });
    })();
  `;
  dialog_('TPO · ' + opts.heading, body, script, 700);
}
