const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const sourceCode = fs.readFileSync(require('node:path').join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

class RichText {
  constructor(text) { this.text = text; }
  getText() { return this.text; }
}
class Sheet {
  constructor(name, values = [], cols = 26, sheetId = 0) {
    this._name = name; this.sheetId = sheetId;
    this.maxRows = Math.max(100, values.length); this.maxCols = Math.max(cols, ...values.map(r => r.length));
    this.cells = new Map(); this.formats = new Map(); this.writes = []; this.failOnce = null;
    values.forEach((row, r) => row.forEach((v, c) => this.cells.set(`${r + 1},${c + 1}`, { value: v, formula: '', rich: null })));
  }
  getSheetId() { return this.sheetId; }
  getName() { return this._name; }
  // Real Apps Script Sheet objects have no .name member; product code must use getName().
  get name() { throw new Error('Sheet.name is not part of the Apps Script API; use getName()'); }
  cell(r, c) { return this.cells.get(`${r},${c}`) || { value: '', formula: '', rich: null }; }
  format(r, c) { return this.formats.get(`${r},${c}`) || 'General'; }
  setFormat(r, c, fmt) { this.formats.set(`${r},${c}`, fmt); }
  put(r, c, data) {
    if (this.failOnce && this.failOnce(r, c)) { this.failOnce = null; throw new Error('simulated Sheets write failure'); }
    this.writes.push([r, c]); this.cells.set(`${r},${c}`, data);
  }
  getLastRow() { return Math.max(0, ...[...this.cells].filter(([, v]) => v.value !== '' || v.formula).map(([k]) => +k.split(',')[0])); }
  getLastColumn() { return Math.max(0, ...[...this.cells].filter(([, v]) => v.value !== '' || v.formula).map(([k]) => +k.split(',')[1])); }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_row, n) { this.maxRows += n; return this; }
  insertColumnsAfter(_col, n) { this.maxCols += n; return this; }
  setFrozenRows() { return this; }
  setColumnWidth() { return this; }
  setRowHeights() { return this; }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(r, c, nr = 1, nc = 1) {
    if (typeof r === 'string') {
      const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(r);
      if (!m) throw new Error('unsupported A1 range: ' + r);
      const col = s => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
      r = +m[2]; c = col(m[1]); nr = m[4] ? +m[4] - r + 1 : 1; nc = m[3] ? col(m[3]) - c + 1 : 1;
    }
    if (r < 1 || c < 1 || nr < 1 || nc < 1 || r + nr - 1 > this.maxRows || c + nc - 1 > this.maxCols) throw new Error('range outside sheet');
    return new Range(this, r, c, nr, nc);
  }
}
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  map(fn) { return Array.from({ length: this.nr }, (_, r) => Array.from({ length: this.nc }, (_, c) => fn(this.sh.cell(this.r + r, this.c + c), r, c))); }
  getValues() { return this.map(cell => cell.value); }
  getDisplayValues() { return this.map(cell => cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : String(cell.value)); }
  getDisplayValue() { return this.getDisplayValues()[0][0]; }
  getFormulas() { return this.map(cell => cell.formula); }
  getRichTextValues() { return this.map(cell => cell.rich); }
  write(values, rich) {
    assert.equal(values.length, this.nr);
    values.forEach((row, r) => {
      assert.equal(row.length, this.nc);
      row.forEach((v, c) => {
        const value = rich ? v.text : v;
        if (typeof value === 'string' && value.length > 50000) throw new Error('cell exceeds 50000 characters');
        this.sh.put(this.r + r, this.c + c, { value, formula: !rich && typeof v === 'string' && v.startsWith('=') ? v : '', rich: rich ? v : null });
      });
    });
    return this;
  }
  setValues(v) { return this.write(v, false); }
  setValue(v) { return this.setValues([[v]]); }
  setFormula(v) { return this.setValue(v); }
  setRichTextValues(v) { return this.write(v, true); }
  setRichTextValue(v) { return this.setRichTextValues([[v]]); }
  clearContent() { this.map((_, r, c) => this.sh.put(this.r + r, this.c + c, { value: '', formula: '', rich: null })); return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setWrap() { return this; }
  setVerticalAlignment() { return this; }
  setNumberFormat(fmt) { this.map((_, r, c) => this.sh.setFormat(this.r + r, this.c + c, fmt)); return this; }
  setNumberFormats(fmts) { fmts.forEach((row, r) => row.forEach((fmt, c) => this.sh.setFormat(this.r + r, this.c + c, fmt))); return this; }
  getNumberFormat() { return this.sh.format(this.r, this.c); }
  getNumberFormats() { return this.map((_, r, c) => this.sh.format(this.r + r, this.c + c)); }
  activate() { return this; }
}

function fixture() {
  const financial = (month, quarter, amount) => [month, amount, amount * .6, amount * .4, amount * .1, amount * .3, amount * .2, quarter];
  return {
    Assumptions: [['Customer', 'Margin'], ['Acme Corp', .45], ['Beta', '30%']],
    MonthlyFinancials: [['Month', 'Revenue', 'COGS', 'Gross Profit', 'SG&A', 'EBIT', 'Net Income', 'Quarter'],
      financial('Feb-27', 'Q1 2027', 200), financial('Jan-26', 'Q1 2026', 50),
      financial('Jan-27', 'Q1 2027', 100), financial('Feb-26', 'Q1 2026', 100),
      ['Mar-27', '', '', '', '', '', '', 'Q1 2027']],
    CustomerRevenueMonthly: [['Customer', 'Month', 'Revenue'],
      ['Acme Corp', 'Jan-27', 100], ['Acme Corp', 'Feb-27', 140],
      ['Beta', 'Jan-27', 25], ['Beta', 'Feb-27', 35]],
    CustomerRevenueQuarterly: [['Customer', 'Quarter', 'Revenue'],
      ['Acme Corp', 'Q1 2027', 240], ['Beta', 'Q1 2027', 60], ['Acme Corp', 'Q2 2027', '']],
    CustomerCount: [['Month', 'Customer Count'], ['Jan-27', 10], ['Feb-27', 15], ['Feb-26', 50]],
    'Quarterly Financials': [['Quarter','Revenue','COGS','Gross Profit','SG&A','EBIT','Net Income'], ['Q1 2027',300,180,120,30,90,60]],
    '1. Working Capital': [['Reporting Month','Cash Balance','Accounts Receivable','Inventory Value','Accounts Payable','Net Working Capital'],
      ['Jan-27',100,40,10,30,120],['Feb-27',200,50,20,40,230]],
    '2. Customer Economics': [['Customer Brand','Quarter','Gross Revenue','Revenue Concentration','Gross Profit','Contribution Margin'], ['Acme Corp','Q1 2027',240,.8,108,.45]],
    '3. Strategic Dashboard': [['Strategic Metric', 'Q1 2027'], ['Revenue', 300]],
    '4. Forward-Looking Risk': [['Reporting Period','Revenue','COGS','Gross Profit','SG&A','EBIT','Net Income','Risk Status']],
    Commentary: [['View', 'Commentary', 'Status'], ['beta', 'Old beta', 'Old status'], ['overview', 'Old overview', 'Old status'],
      ['custom-note', 'Unrelated text', 'Keep'], ['acme-corp', 'Old acme', 'Old status']]
  };
}
function runtime(data = fixture()) {
  let nextId = 2102000;
  const sheets = new Map(Object.entries(data).map(([name, rows]) => [name, new Sheet(name, rows, name === 'Commentary' ? 3 : 26, nextId++)]));
  const properties = new Map(); let html = ''; let locked = false; let flushFail = false; let propsRemaining = -1; let selected = null;
  const ss = {
    getSheetByName: n => sheets.get(n) || null,
    insertSheet: n => { const sh = new Sheet(n, [], 26, nextId++); sheets.set(n, sh); return sh; },
    getSpreadsheetTimeZone: () => 'Asia/Bangkok',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/fixture/edit',
    setActiveSheet: sh => { selected = sh; return sh; }
  };
  const ctx = vm.createContext({ console, Date, Map, Set,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      newRichTextValue: () => ({ text: '', setText(text) { this.text = text; return this; }, build() { return new RichText(this.text); } }),
      flush: () => { if (flushFail) { flushFail = false; throw new Error('flush failure'); } },
      getUi: () => ({ showModalDialog: obj => { html = obj.html; }, alert() {}, ButtonSet: { OK: 'OK' } })
    },
    PropertiesService: { getDocumentProperties: () => ({
      getProperty: k => properties.has(k) ? properties.get(k) : null,
      setProperties: values => {
        if (propsRemaining > 0) propsRemaining--;
        else if (propsRemaining === 0) { propsRemaining = -1; throw new Error('simulated property store failure'); }
        Object.entries(values).forEach(([k, v]) => { assert.ok(Buffer.byteLength(v) < 9000); properties.set(k, v); });
      },
      deleteProperty: k => properties.delete(k)
    }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, pattern) => pattern === 'yyyy-MM-dd' ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) : '2027-03-01 10:00',
      computeDigest: (_algo, text) => [...crypto.createHash('sha256').update(text).digest()],
      DigestAlgorithm: { SHA_256: 'SHA256' }, Charset: { UTF_8: 'UTF8' }
    },
    LockService: { getDocumentLock: () => ({ tryLock: () => { if (locked) return false; locked = true; return true; }, releaseLock: () => { locked = false; } }) },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {} },
    HtmlService: { createHtmlOutput: html => ({ html, setWidth() { return this; }, setHeight() { return this; } }) }
  });
  vm.runInContext(sourceCode, ctx);
  ctx.PropertiesService.getUserProperties = ctx.PropertiesService.getDocumentProperties;
  return { ctx, sheets, ss, properties, getHtml: () => html, flushFail: () => { flushFail = true; },
    failProps: (succeedFirst = 0) => { propsRemaining = succeedFirst; }, getSelected: () => selected };
}
function sampleResponse(rt) {
  const state = rt.ctx.readState_();
  return { schema_version: 'tpo-commentary-v1', batch_id: state.batch,
    commentaries: [...state.views].reverse().map(view => ({ view, commentary:
      `Revenue of THB 200 anchors the latest available reporting period for ${view}. The supplied figures support a cautious reading of current performance, while the partial quarter limits comparisons with a complete reporting period. Management should review the stated customer mix and available balances before interpreting this snapshot as a sustained operating trend.` })) };
}
function pasteGrid(rt, text) {
  const sh = rt.sheets.get('LLM Output');
  if (sh.getLastRow() >= 8) sh.getRange(8, 1, sh.getLastRow() - 7, sh.getMaxColumns()).clearContent();
  const rows = text.split('\n').map(line => [line]);
  rt.ctx.ensureSize_(sh, 7 + rows.length, 2); sh.getRange(8, 1, rows.length, 1).setValues(rows);
}
const values = sh => JSON.stringify(sh.getDataRange().getValues());

test('latest period sorts dates, excludes headers/totals/empty future rows and matches prior-year months', () => {
  const { ctx } = runtime(); const result = ctx.buildAnalysis_(ctx.readSources_());
  assert.equal(result.period, '2027-02'); assert.equal(result.tasks.length, 8);
  const overview = result.tasks.find(t => t.view === 'overview').summary;
  assert.equal(overview.yearToDateRevenue, 300); assert.equal(overview.grossMarginPercent, 40);
  assert.equal(overview.customerMix.customers[0].sharePercent, 80);
  const finance = result.tasks.find(t => t.view === 'financial-performance').summary;
  assert.equal(finance.latestQuarter.revenue, 300); assert.equal(finance.latestQuarter.complete, false);
  assert.equal(finance.comparison.priorYearRevenueForMatchingMonths, 150);
  assert.equal(finance.comparison.revenueChangePercent, 100);
  assert.equal(result.tasks.find(t => t.view === 'working-capital').summary.calculatedNetWorkingCapital, 230);
  assert.equal(result.tasks.find(t => t.view === 'acme-corp').summary.estimatedContribution, 108);
  assert.equal(result.tasks.find(t => t.view === 'seasonality').summary.peakCustomerCount, 15);
});
test('date values respect spreadsheet timezone and support month labels and zero actuals', () => {
  const data = fixture(); data.MonthlyFinancials.push([new Date('2027-03-31T18:00:00Z'), 0, 0, 0, 0, 0, 0, 'Q2 2027']);
  const { ctx } = runtime(data); assert.equal(ctx.buildAnalysis_(ctx.readSources_()).period, '2027-04');
  ['Jan-27', 'January 2027', '2027-01-31', '31-Jan-2027', '31-Jan-27'].forEach(v => assert.equal(ctx.month_(v).label, '2027-01'));
});
test('missing metrics are unavailable, duplicate months and conflicting quarters are rejected', () => {
  const rt = runtime(); const table = rt.ctx.source_(rt.ctx.readSources_(), 'MonthlyFinancials');
  table.raw[1][3] = ''; const warnings = [];
  const rows = rt.ctx.monthlyRecords_(table, warnings);
  assert.equal(rt.ctx.quarterlySummary_(rows).at(-1).gp, null); assert.ok(warnings.length);
  table.raw.push(table.raw[1]); assert.ok(!rt.ctx.monthlyRecords_(table, []).some(r=>r.period.label==='2027-02'));
  table.raw.pop(); table.raw[1][7] = 'Q4 2026'; const quarterWarnings=[]; rt.ctx.monthlyRecords_(table, quarterWarnings); assert.ok(quarterWarnings.some(w=>/disagrees/.test(w)));
  assert.equal(rt.ctx.number_('45%'), .45); assert.equal(rt.ctx.number_(''), null);
  assert.equal(rt.ctx.number_('#N/A'), null); assert.equal(rt.ctx.number_('(1,250)'), -1250);
});
test('customer collisions with another customer or built-in view fail before export', () => {
  const rt = runtime();
  assert.throws(() => rt.ctx.customers_({ raw: [['Name', 'Margin'], ['A B', .4], ['A-B', .5]] }), /conflicting/);
  assert.throws(() => rt.ctx.customers_({ raw: [['Name', 'Margin'], ['Overview', .4]] }), /conflicting/);
  assert.throws(() => rt.ctx.customers_({ raw: [['Name', 'Margin'], ['Acme', 45]] }), /margin/);
});
test('export contains every source table and reassembles long Unicode chunks exactly', () => {
  const data = fixture(); data['3. Strategic Dashboard'].push(['Wellness 🌿 '.repeat(7000), '']);
  const rt = runtime(data); const result = rt.ctx.prepare_();
  for (const key of Object.keys(data).filter(k => k !== 'Commentary')) assert.ok(result.text.includes('"sheet": "' + key + '"'));
  assert.equal(rt.ctx.preparedInput_().text, result.text);
  assert.ok(rt.sheets.get('LLM-Input').getLastRow() > 8);
  assert.equal(rt.sheets.get('Commentary').getMaxColumns(), 3);
  const text = 'x'.repeat(29999) + '🌿' + 'z'.repeat(30000);
  const parts = rt.ctx.splitText_(text, 30000); assert.equal(parts.join(''), text);
  assert.ok(parts.every(s => s.length <= 30000 && !/[\uD800-\uDBFF]$/.test(s)));
});
test('grid-pasted JSON imports by identifier despite reordered response and preserves unrelated rows', () => {
  const rt = runtime(); rt.ctx.prepare_(); const sh = rt.sheets.get('Commentary'); sh.writes = [];
  sh.getRange(4, 2).setFormula('="Unrelated formula"'); sh.writes = [];
  const response = sampleResponse(rt); pasteGrid(rt, JSON.stringify(response, null, 2));
  const result = rt.ctx.import_(); assert.equal(result.count, 8);
  assert.equal(sh.getRange(2, 2).getDisplayValue(), response.commentaries.find(r => r.view === 'beta').commentary);
  assert.equal(sh.getRange(3, 2).getDisplayValue(), response.commentaries.find(r => r.view === 'overview').commentary);
  assert.equal(sh.getRange(4, 2).getFormulas()[0][0], '="Unrelated formula"');
  assert.ok(sh.writes.every(([r, c]) => c <= 3 && r !== 4));
  assert.equal(sh.getMaxColumns(), 3);
  sh.writes = []; assert.equal(rt.ctx.import_().already, true); assert.equal(sh.writes.length, 0);
});
test('fenced JSON and dialog-saved split responses import successfully as literal text', () => {
  const rt = runtime(); rt.ctx.prepare_(); const response = sampleResponse(rt);
  response.commentaries[0].commentary = '=SUM(1,2) ' + 'literal text '.repeat(900);
  response.commentaries[1].commentary += ' length '.repeat(1800);
  response.commentaries[2].commentary += ' extra '.repeat(1800);
  const text = '```json\n' + JSON.stringify(response, null, 2) + '\n```';
  assert.ok(text.length > 30000);
  rt.ctx.importPastedLLMOutput(text, response.batch_id);
  assert.equal(rt.ctx.readOutput_(rt.ctx.readState_()), text);
  const row = rt.ctx.readCommentary_().find(r => r.view === response.commentaries[0].view).row;
  assert.equal(rt.sheets.get('Commentary').getRange(row, 2).getFormulas()[0][0], '');
  assert.equal(rt.sheets.get('Commentary').getRange(row, 2).getDisplayValue(), response.commentaries[0].commentary.trim());
});
test('invalid, incomplete, duplicate and stale batches leave Commentary untouched', () => {
  const rt = runtime(); rt.ctx.prepare_(); const original = values(rt.sheets.get('Commentary'));
  const valid = sampleResponse(rt);
  const cases = [
    ['{broken', /valid JSON/],
    [JSON.stringify({ ...valid, batch_id: 'old' }), /another batch/],
    [JSON.stringify({ ...valid, commentaries: valid.commentaries.slice(1) }), /incomplete/],
    [JSON.stringify({ ...valid, commentaries: [...valid.commentaries, valid.commentaries[0]] }), /Duplicate/],
    [JSON.stringify({ ...valid, commentaries: [{ view: 'unknown', commentary: 'x' }] }), /Unknown/],
    [JSON.stringify({ ...valid, commentaries: valid.commentaries.map(r => ({ ...r, commentary: '' })) }), /Empty/],
    [JSON.stringify({ ...valid, schema_version: 'wrong' }), /schema_version/]
  ];
  cases.forEach(([text, error]) => {
    pasteGrid(rt, text); assert.throws(() => rt.ctx.import_(), error); assert.equal(values(rt.sheets.get('Commentary')), original);
  });
});
test('quarterly output edits preserve a prepared batch, but monthly revenue edits invalidate it', () => {
  const rt=runtime();rt.ctx.prepare_();
  const response=sampleResponse(rt);
  rt.sheets.get('CustomerRevenueQuarterly').getRange(2,3).setValue(999999);
  pasteGrid(rt,JSON.stringify(response));
  rt.ctx.import_();
  const row=rt.ctx.readCommentary_().find(r=>r.view==='acme-corp').row;
  assert.equal(rt.sheets.get('Commentary').getRange(row,2).getDisplayValue(),response.commentaries.find(r=>r.view==='acme-corp').commentary);
  rt.ctx.prepare_();pasteGrid(rt,JSON.stringify(sampleResponse(rt)));
  const before=values(rt.sheets.get('Commentary'));
  rt.sheets.get('CustomerRevenueMonthly').getRange(2,3).setValue(101);
  assert.throws(()=>rt.ctx.import_(),/Source data changed/);
  assert.equal(values(rt.sheets.get('Commentary')),before);
});
test('source edits after preparing a batch are rejected, and editing input is detected', () => {
  const rt = runtime(); rt.ctx.prepare_(); const response = sampleResponse(rt);
  pasteGrid(rt, JSON.stringify(response));
  rt.sheets.get('MonthlyFinancials').getRange(2, 3).setValue(999);
  assert.throws(() => rt.ctx.import_(), /Source data changed/);
  rt.sheets.get('LLM-Input').getRange(8, 1).setValue('edited');
  assert.throws(() => rt.ctx.preparedInput_(), /was edited/);
});
test('duplicate Commentary identifiers and spreadsheet formulas in output are rejected', () => {
  const rt = runtime(); rt.ctx.prepare_();
  rt.sheets.get('LLM Output').getRange(8, 1).setFormula('=1+2');
  assert.throws(() => rt.ctx.import_(), /spreadsheet formula/);
  rt.sheets.get('Commentary').getRange(4, 1).setValue('overview');
  assert.throws(() => rt.ctx.prepare_(), /Duplicate View identifier/);
});
test('failed import rolls back all changed rows and removes newly appended identifiers', () => {
  const rt = runtime(); rt.ctx.prepare_(); const sh = rt.sheets.get('Commentary'); const original = values(sh);
  pasteGrid(rt, JSON.stringify(sampleResponse(rt), null, 2));
  sh.failOnce = (r, c) => r === 5 && c === 2;
  assert.throws(() => rt.ctx.import_(), /Original commentary was restored/);
  assert.equal(values(sh), original);
});
test('adding a customer preserves the three-column schema and seeds existing months and quarters', () => {
  const rt = runtime(); rt.ctx.prepare_();
  rt.ctx.processAddCustomer({ name: 'New Customer', margin: '25%', seed: true });
  const sh = rt.sheets.get('Assumptions'); assert.equal(sh.getRange(sh.getLastRow(), 2).getValues()[0][0], .25);
  assert.equal(rt.sheets.get('Commentary').getMaxColumns(), 3);
  const monthlyRows = rt.sheets.get('CustomerRevenueMonthly').getDataRange().getValues().filter(r => r[0] === 'New Customer');
  assert.deepEqual(monthlyRows.map(r => r[1]).sort(), ['Feb-27', 'Jan-27']);
  assert.ok(monthlyRows.every(r => r[2] === ''));
  const cqRows = rt.sheets.get('CustomerRevenueQuarterly').getDataRange().getValues().filter(r => r[0] === 'New Customer');
  assert.deepEqual(cqRows.map(r => r[1]).sort(), ['Q1 2027', 'Q2 2027']);
  assert.throws(() => rt.ctx.processAddCustomer({ name: 'New Customer', margin: '.2', seed: true }), /already exists/);
  assert.throws(() => rt.ctx.processAddCustomer({ name: 'Bad', margin: '45', seed: false }), /margin/);
});
test('setup protects pre-existing exchange sheets with unrelated content', () => {
  const data = fixture(); data['LLM-Input'] = [['Existing user content']];
  const rt = runtime(data); assert.throws(() => rt.ctx.prepare_(), /contains other content/);
  assert.equal(rt.sheets.get('LLM-Input').getRange('A1').getDisplayValue(), 'Existing user content');
});
test('dialog HTML escapes source text and all inline scripts compile', async () => {
  const rt = runtime(); const prepared = rt.ctx.prepare_();
  rt.ctx.showCopy_({ ...prepared, text: '</textarea><script>throw 1</script>& 🌿' });
  const html = rt.getHtml(); assert.ok(html.includes('&lt;/textarea&gt;')); assert.equal((html.match(/<script>/g) || []).length, 1);
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const elements = { payload: { value: prepared.text, focus() {}, select() {}, setSelectionRange() {} }, status: {}, copy: {} };
  const browser = vm.createContext({ document: { getElementById: id => elements[id], execCommand: () => false }, navigator: {} });
  vm.runInContext(script, browser); await elements.copy.onclick(); assert.match(elements.status.textContent, /Ctrl\+C/);
  browser.navigator.clipboard = { writeText: async text => assert.equal(text, prepared.text) };
  await elements.copy.onclick(); assert.match(elements.status.textContent, /^Copied/);
  rt.ctx.menuPasteAndImportLLMOutput(); new vm.Script(rt.getHtml().match(/<script>([\s\S]*)<\/script>/)[1]);
  rt.ctx.menuAddCustomer(); new vm.Script(rt.getHtml().match(/<script>([\s\S]*)<\/script>/)[1]);
});

test('a response in a single cell imports when every target row already exists', () => {
  const rt = runtime(); rt.ctx.prepare_();
  pasteGrid(rt, JSON.stringify(sampleResponse(rt)));
  rt.ctx.import_();
  const lastRow = rt.sheets.get('Commentary').getLastRow();
  rt.ctx.prepare_();
  const response = sampleResponse(rt);
  response.commentaries[0].commentary += ' Management should review this.';
  pasteGrid(rt, JSON.stringify(response));
  assert.equal(rt.ctx.import_().count, 8);
  assert.equal(rt.sheets.get('Commentary').getLastRow(), lastRow);
});

test('locks are released even if flushing the spreadsheet fails', () => {
  const rt = runtime(); rt.flushFail();
  assert.throws(() => rt.ctx.locked_(() => 'first'), /flush failure/);
  assert.equal(rt.ctx.locked_(() => 'second'), 'second');
});

test('timezone errors include action, actual type and saved stack trace', () => {
  const rt=runtime();rt.ss.getSpreadsheetTimeZone=()=>null;
  rt.ctx.uiAction_('Timezone regression',()=>rt.ctx.readSources_());
  assert.match(rt.getHtml(),/Timezone regression/);assert.match(rt.getHtml(),/returned null/);
  assert.match(rt.getHtml(),/spreadsheetTimezone_/);assert.ok(rt.properties.has('TPO_LAST_ERROR_COUNT'));
});

test('empty Google timezone uses explicit Bangkok fallback even if settings do not persist', () => {
  const rt=runtime();rt.ss.getSpreadsheetTimeZone=()=>'';
  let saved;rt.ss.setSpreadsheetTimeZone=v=>{saved=v;};
  assert.equal(rt.ctx.spreadsheetTimezone_(rt.ss),'Asia/Bangkok');
  assert.equal(rt.ctx.repairTimezone_(rt.ss),'Asia/Bangkok');assert.equal(saved,'Asia/Bangkok');
  assert.doesNotThrow(()=>rt.ctx.prepare_());
  assert.match(values(rt.sheets.get('Data Validation')),/explicit TPO.timezone fallback/);
});

test('numeric formatting plan preserves formulas and blanks and backs up changed text', () => {
  const rt=runtime();const sh=rt.sheets.get('CustomerRevenueQuarterly');
  sh.getRange(2,3).setValue('฿240.00');sh.getRange(3,3).setFormula('=60');
  const sources=rt.ctx.readSources_(),a=rt.ctx.TPOCore.analyze(sources),plan=rt.ctx.formatPlan_(sources,a);
  assert.equal(plan.filter(p=>p.sheet==='CustomerRevenueQuarterly').length,1);
  rt.ctx.backupAndWrite_(plan,'Test normalization');assert.equal(sh.getRange(2,3).getValues()[0][0],240);
  assert.equal(sh.getRange(3,3).getFormulas()[0][0],'=60');assert.equal(sh.getRange(4,3).getValues()[0][0],'');
  assert.ok(rt.sheets.has('Repair Backup'));
});

test('repair failure rolls back earlier writes and preserves backup', () => {
  const rt=runtime();const sh=rt.sheets.get('CustomerRevenueQuarterly');const before=values(sh);
  sh.failOnce=(r,c)=>r===3&&c===3;
  assert.throws(()=>rt.ctx.backupAndWrite_([{sheet:sh.getName(),row:2,col:3,value:1},{sheet:sh.getName(),row:3,col:3,value:2}],'Test'),/simulated/);
  assert.equal(values(sh),before);assert.ok(rt.sheets.has('Repair Backup'));
});

test('formatting explicitly protects month-year text and leaves future placeholders empty',()=>{
  const rt=runtime(),sources=rt.ctx.readSources_(),a=rt.ctx.TPOCore.analyze(sources),plan=rt.ctx.formatPlan_(sources,a);
  const jan=plan.find(p=>p.sheet==='MonthlyFinancials'&&p.value==='Jan-26');assert.ok(jan.text);
  const future=plan.find(p=>p.sheet==='MonthlyFinancials'&&p.value==='Mar-27');assert.ok(future.text);
  assert.ok(!plan.some(p=>p.sheet==='MonthlyFinancials'&&p.row===6&&p.col>1));
});

test('conflicting month and quarter stop AI export before creating input',()=>{
  const rt=runtime();rt.sheets.get('MonthlyFinancials').getRange(2,8).setValue('Q4 2026');
  assert.throws(()=>rt.ctx.prepare_(),/data error/);assert.ok(!rt.sheets.has('LLM-Input'));
  assert.match(values(rt.sheets.get('Data Validation')),/Quarter disagrees/);
});

test('range-fed model matches shared core and recalculates edited raw inputs',()=>{
  const rt=runtime(),data=fixture(),inputs=[['Quarter','Metric','Value'],['Q1 2027','Customer Retention Rate',.8]];
  const get=()=>new Map(rt.ctx.TPO_REPORT_MODEL(data.MonthlyFinancials,data.Assumptions,data.CustomerRevenueMonthly,data.CustomerCount,data['1. Working Capital'],inputs,'May–October','count at first month of the quarter','THB','Asia/Bangkok'));
  let model=get();assert.equal(model.get('quarter|Q1 2027|revenue'),300);
  assert.equal(model.get('dashboard|Q1 2027|activecustomers'),10);
  assert.equal(model.get('dashboard|Q1 2027|customerretentionrate'),.8);
  assert.equal(model.get('customer|Q1 2027|acme corp|gp'),108);
  data.Assumptions[1][1]=.5;data.CustomerCount[1][1]=20;
  model=get();assert.equal(model.get('customer|Q1 2027|acme corp|gp'),120);
  assert.equal(model.get('dashboard|Q1 2027|revenuepercustomer'),15);
  // Partial-quarter cash now uses the latest financial month (Feb-27) and
  // records the explicit date; the dated metadata string lives alongside the
  // numeric balance so consumers can render "as of Feb-27".
  assert.equal(model.get('dashboard|Q1 2027|cashbalance'),200); // latest financial month cash
  assert.equal(model.get('dashboard|Q1 2027|cashbalanceasof'),'Feb-27'); // explicit as-of month
  assert.ok(!model.has('quarter|Q2 2027|revenue')); // blank future ledger slot
});
test('monthly scaffolding reuses placeholders, leaves raw inputs blank, and uses keyed formulas',()=>{
  const rt=runtime(),sources=rt.ctx.readSources_(),a=rt.ctx.TPOCore.analyze(sources),next=rt.ctx.TPOCore.month('Mar-27');
  const plan=rt.ctx.repairPlan_(sources,a,next);
  assert.ok(!plan.some(p=>p.sheet==='MonthlyFinancials'&&p.col===1)); // already present
  assert.ok(!plan.some(p=>p.sheet==='MonthlyFinancials'&&[2,3,5,7].includes(p.col)));
  assert.equal(plan.filter(p=>p.sheet==='CustomerRevenueMonthly'&&p.value==='Mar-27').length,2);
  assert.ok(plan.filter(p=>p.sheet==='CustomerRevenueMonthly'&&p.value==='Mar-27').every(p=>p.text));
  assert.ok(plan.some(p=>p.sheet==='Dashboard Inputs'&&p.value===300)); // preserve manual metric
});
test('quarter and year rollover append missing sections without copying past totals',()=>{
  for(const [from,next,quarter] of [['Sep-27','Oct-27','Q4 2027'],['Dec-27','Jan-28','Q1 2028']]){
    const data=fixture();data.MonthlyFinancials.push([from,0,0,0,0,0,0,require('../js/report-core').month(from).quarter]);
    const rt=runtime(data),sources=rt.ctx.readSources_(),a=rt.ctx.TPOCore.analyze(sources),plan=rt.ctx.repairPlan_(sources,a,rt.ctx.TPOCore.month(next));
    for(const name of ['MonthlyFinancials','CustomerCount','1. Working Capital'])assert.ok(plan.some(p=>p.sheet===name&&p.value===next&&p.text));
    for(const name of ['Quarterly Financials','CustomerRevenueQuarterly','2. Customer Economics','3. Strategic Dashboard'])assert.ok(plan.some(p=>p.sheet===name&&p.value===quarter));
  }
});
test('quarterly migration backs up old totals, preserves manual inputs, and is idempotent',()=>{
  const data=fixture();
  data['Dashboard Inputs']=[['Quarter','Metric','Value','Examples Value'],['Q1 2027','New Accounts Opened','',27],['Q1 2027','Customer Retention Rate','',.94]];
  const rt=runtime(data),monthlyBefore=values(rt.sheets.get('CustomerRevenueMonthly')),manualBefore=values(rt.sheets.get('Dashboard Inputs'));
  const sources=rt.ctx.readSources_(),a=rt.ctx.TPOCore.analyze(sources),plan=rt.ctx.repairPlan_(sources,a,null);
  plan.forEach(p=>{const sh=rt.sheets.get(p.sheet)||rt.ss.insertSheet(p.sheet);rt.ctx.ensureSize_(sh,p.row,p.col);});
  rt.ctx.backupAndWrite_(plan,'Quarterly migration');
  assert.equal(values(rt.sheets.get('CustomerRevenueMonthly')),monthlyBefore);
  assert.equal(values(rt.sheets.get('Dashboard Inputs')),manualBefore);
  const backup=rt.sheets.get('Repair Backup').getDataRange().getValues();
  assert.equal(backup.find(r=>r[2]==='CustomerRevenueQuarterly'&&r[3]==='C2')[4],'240');
  assert.equal(backup.find(r=>r[2]==='CustomerRevenueQuarterly'&&r[3]==='C3')[4],'60');
  assert.deepEqual(Array.from(rt.ctx.repairPlan_(rt.ctx.readSources_(),a,null)).filter(p=>p.sheet==='CustomerRevenueQuarterly'),[]);
});
test('repair planning is idempotent and blocks duplicate empty slots',()=>{
  const rt=runtime(),sources=rt.ctx.readSources_(),a=rt.ctx.TPOCore.analyze(sources),next=rt.ctx.TPOCore.month('Mar-27'),plan=rt.ctx.repairPlan_(sources,a,next);
  plan.forEach(p=>{let sh=rt.sheets.get(p.sheet);if(!sh){sh=rt.ss.insertSheet(p.sheet);}rt.ctx.ensureSize_(sh,p.row,p.col);const r=sh.getRange(p.row,p.col);p.formula?r.setFormula(p.value):r.setValue(p.value);});
  const second=rt.ctx.repairPlan_(rt.ctx.readSources_(),a,next);
  assert.equal(second.filter(p=>p.sheet!=='Report Model').length,0);
  const sh=rt.sheets.get('MonthlyFinancials');sh.getRange(sh.getLastRow()+1,1).setValue('Mar-27');
  assert.throws(()=>rt.ctx.repairPlan_(rt.ctx.readSources_(),a,next),/duplicate slot/);
});

test('aligned input tabs roll together and blank future rows never advance a tab',()=>{
  const rt=runtime(); // fixture: all four input tabs carry Feb-27 data; MonthlyFinancials also holds an empty Mar-27 row
  const sources=rt.ctx.readSources_(),a=rt.ctx.TPOCore.analyze(sources);
  assert.deepEqual(Array.from(rt.ctx.nextScaffoldMonths_(sources,a),m=>m.display),['Mar-27']);
});

test('prepare next month slots aligns lagging customer tabs instead of rolling forward',()=>{
  // Sales tabs lag one month behind imported financials: exactly the misalignment the user hit.
  const data=fixture();
  data.CustomerRevenueMonthly=data.CustomerRevenueMonthly.filter(r=>r[1]!=='Feb-27');
  data.CustomerCount=data.CustomerCount.filter(r=>r[0]!=='Feb-27');
  const rt=runtime(data),sources=rt.ctx.readSources_(),a=rt.ctx.TPOCore.analyze(sources);
  const months=rt.ctx.nextScaffoldMonths_(sources,a);
  assert.deepEqual(Array.from(months,m=>m.display),['Feb-27']);
  const plan=rt.ctx.repairPlan_(sources,a,months);
  const newSlot=p=>p.reason==='New input slot; raw amounts left blank';
  assert.ok(!plan.some(p=>newSlot(p)&&['MonthlyFinancials','1. Working Capital'].includes(p.sheet)),'leaders must not receive rows');
  assert.equal(plan.filter(p=>newSlot(p)&&p.sheet==='CustomerCount'&&p.value==='Feb-27').length,1);
  assert.equal(plan.filter(p=>newSlot(p)&&p.sheet==='CustomerRevenueMonthly'&&p.value==='Feb-27').length,2);
  assert.ok(!plan.some(p=>newSlot(p)&&p.value==='Mar-27'),'no month beyond the furthest actual may be created');
});

test('prepare next month slots run creates only catch-up rows and reports them',()=>{
  const data=fixture();
  data.CustomerRevenueMonthly=data.CustomerRevenueMonthly.filter(r=>r[1]!=='Feb-27');
  data.CustomerCount=data.CustomerCount.filter(r=>r[0]!=='Feb-27');
  const rt=runtime(data);
  const summary=rt.ctx.repairAndScaffold_(true);
  assert.match(summary,/Prepared new input slots: /);
  assert.match(summary,/CustomerRevenueMonthly Feb-27/);
  assert.match(summary,/CustomerCount Feb-27/);
  const crm=rt.sheets.get('CustomerRevenueMonthly').getDataRange().getValues();
  assert.equal(crm.filter(r=>r[1]==='Feb-27').length,2);
  assert.ok(!crm.some(r=>r[1]==='Mar-27'));
  const cc=rt.sheets.get('CustomerCount').getDataRange().getValues();
  assert.equal(cc.filter(r=>r[0]==='Feb-27').length,1);
  assert.ok(!cc.some(r=>r[0]==='Mar-27'));
  const backup=rt.sheets.get('Repair Backup').getDataRange().getValues();
  assert.ok(backup.some(r=>r.some(c=>String(c).includes('Prepare Feb-27 slots'))));
});
test('inventory input removal preserves manual formulas rather than freezing their cached values',()=>{
  const data=fixture(),cached=data.MonthlyFinancials[1][1],formula='=MonthlyFinancials!B2';
  data['Dashboard Inputs']=[['Quarter','Metric','Value'],['Q1 2027','Inventory Turns',4.2],['Q1 2027','Manual target',cached]];
  const rt=runtime(data),sh=rt.sheets.get('Dashboard Inputs');
  sh.put(3,3,{value:cached,formula,rich:null});
  const sources=rt.ctx.readSources_(),a=rt.ctx.TPOCore.analyze(sources);
  const plan=rt.ctx.repairPlan_(sources,a,null).filter(p=>p.sheet==='Dashboard Inputs');
  rt.ctx.backupAndWrite_(plan,'Remove manual inventory inputs');
  assert.equal(sh.getRange(3,3).getFormulas()[0][0],formula);
  assert.ok(!sh.getDataRange().getValues().slice(1).some(r=>r[1]==='Inventory Turns'));
});
test('all obsolete inventory inputs are cleared while other manual data survives repeated repair',()=>{
  const data=fixture();
  data['Dashboard Inputs']=[
    ['Quarter','Metric','Value'],
    ['Q1 2026','Inventory Turns',4.5],
    ['Q1 2026','Inventory Turns',2.1],
    ['','Inventory Turns',9],
    ['Q1 2026','Customer Retention Rate',.8],
    ['Q1 2026','New Accounts Opened',3],
    ['Q1 2027','Inventory Turns',''],
    ['Q1 2027','Inventory Period','Jan-26 – Feb-26 · QTD'],
    ['Q1 2027','Customer Retention Rate',.9],
    ['Q1 2027','New Accounts Opened',5]
  ];
  const manual=data['Dashboard Inputs'].filter(r=>r[0]==='Quarter'||/Retention|Accounts/.test(r[1]));
  const rt=runtime(data),sh=rt.sheets.get('Dashboard Inputs');
  sh.put(7,3,{value:'',formula:'=IF(FALSE,4.2,"")',rich:null});
  const sources=rt.ctx.readSources_(),a=rt.ctx.TPOCore.analyze(sources),next=rt.ctx.TPOCore.month('Mar-27');
  const plan=rt.ctx.repairPlan_(sources,a,next).filter(p=>p.sheet==='Dashboard Inputs');
  rt.ctx.backupAndWrite_(plan,'Remove manual inventory inputs');
  assert.deepEqual(sh.getDataRange().getValues().filter(r=>r.some(v=>v!==''&&v!=null)),manual);
  for(const row of [2,3,4,7,8]){
    assert.deepEqual(sh.getRange(row,1,1,3).getValues(),[['','','']]);
    assert.deepEqual(sh.getRange(row,1,1,3).getFormulas(),[['','','']]);
  }
  const second=rt.ctx.repairPlan_(rt.ctx.readSources_(),a,next).filter(p=>p.sheet==='Dashboard Inputs');
  assert.equal(second.length,0);
});
test('Inventory Turns removal plan rolls back to original sheet state on write failure',()=>{
  const data=fixture();
  const before=[
    ['Quarter','Metric','Value'],
    ['Q1 2026','Inventory Turns',4.5],
    ['Q1 2026','Customer Retention Rate',.8],
    ['Q1 2026','New Accounts Opened',3],
    ['Q1 2027','Inventory Turns',4.2],
    ['Q1 2027','Customer Retention Rate',.9],
    ['Q1 2027','New Accounts Opened',5]
  ];
  data['Dashboard Inputs']=before.map(r=>r.slice());
  const rt=runtime(data);
  const sources=rt.ctx.readSources_(),a=rt.ctx.TPOCore.analyze(sources),next=rt.ctx.TPOCore.month('Mar-27');
  const plan=rt.ctx.repairPlan_(sources,a,next).filter(p=>p.sheet==='Dashboard Inputs');
  const sh=rt.sheets.get('Dashboard Inputs');
  const snapshot=values(sh);
  // Fail after earlier writes, not before the first mutation.
  sh.failOnce=(r,c)=>r===plan[3].row&&c===plan[3].col;
  assert.throws(()=>rt.ctx.backupAndWrite_(plan,'Remove manual inventory inputs'),/simulated/);
  assert.equal(values(sh),snapshot);
  assert.ok(rt.sheets.has('Repair Backup'));
});
test('range-fed model respects Bangkok month boundary for real dates',()=>{
  const data=fixture(),rt=runtime();data.MonthlyFinancials.push([new Date('2027-03-31T18:00:00Z'),0,0,0,0,0,0,'Q2 2027']);
  const model=new Map(rt.ctx.TPO_REPORT_MODEL(data.MonthlyFinancials,data.Assumptions,data.CustomerRevenueMonthly,data.CustomerCount,data['1. Working Capital'],[['Quarter','Metric','Value']],'May–October','','THB','Asia/Bangkok'));
  assert.equal(model.get('meta|latest-month'),'Apr-27');assert.equal(model.get('quarter|Q2 2027|revenue'),0);
});

test('shared display changes preserve AI batch while scope changes invalidate it',()=>{
  const rt=runtime();rt.ctx.ensureReportSettings_();rt.ctx.prepare_();const initial=rt.ctx.sourceHash_(rt.ctx.readSources_()),sh=rt.sheets.get('Report Settings');
  const settings=rt.ctx.TPOReportSettings.normalize({money:'millions',tabs:{financials:{mode:'hide',label:'Financial overview'}}});sh.getRange(2,2).setValue(JSON.stringify(settings));
  assert.equal(rt.ctx.sourceHash_(rt.ctx.readSources_()),initial);
  settings.tabs.financials.commentary=false;sh.getRange(2,2).setValue(JSON.stringify(settings));assert.notEqual(rt.ctx.sourceHash_(rt.ctx.readSources_()),initial);
  const analysis=rt.ctx.buildAnalysis_(rt.ctx.readSources_());assert.ok(!analysis.tasks.some(t=>t.view==='financial-performance'));assert.equal(analysis.tasks.length,7);
});
test('Apps Script and website use the same historical cutoff and model totals',()=>{
  const data=fixture(),rt=runtime(data);rt.ctx.ensureReportSettings_();const settings=rt.ctx.TPOReportSettings.normalize({cutoff:'2027-01'});rt.sheets.get('Report Settings').getRange(2,2).setValue(JSON.stringify(settings));
  const analysis=rt.ctx.buildAnalysis_(rt.ctx.readSources_());assert.equal(analysis.period,'2027-01');assert.equal(analysis.validation.quarterly.at(-1).revenue,100);
  const model=new Map(rt.ctx.TPO_REPORT_MODEL(data.MonthlyFinancials,data.Assumptions,data.CustomerRevenueMonthly,data.CustomerCount,data['1. Working Capital'],[['Quarter','Metric','Value']],'May–October','','THB','Asia/Bangkok',JSON.stringify(settings)));
  assert.equal(model.get('quarter|Q1 2027|revenue'),100);assert.equal(model.get('meta|latest-month'),'Jan-27');
  assert.equal(model.get('customer|Q1 2027|acme corp|revenue'),100);
});
test('shared settings dialog scripts compile and unrelated sheet contents are protected',()=>{
  const rt=runtime();rt.ctx.menuReportSettings();const html=rt.getHtml();assert.match(html,/Shared report settings/);for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new vm.Script(m[1]));
  rt.sheets.get('Report Settings').getRange(1,1).setValue('Other content');assert.throws(()=>rt.ctx.ensureReportSettings_(),/expected/);
});
module.exports = { runtime, fixture, sampleResponse };
function legacyAssumptionsFixture(extra) {
  const data = fixture();
  data.Assumptions = [
    ['Customer', 'Contribution Margin', '', 'Parameter', 'Value'],
    ['Acme Corp', .45, '', 'Currency', 'THB'],
    ['Beta', '30%', '', 'Reporting period (as-of)', 'Feb-27'],
    ['', '', '', 'RECONCILIATION CHECK', ''],
    ['', '', '', 'Customer revenue total (Q1 2027)', '=IF(COUNT(E6:E7)=2,1,"")'],
    ['', '', '', extra && extra.mismatch ? 'P&L Total Revenue (Q2 2027)' : 'P&L Total Revenue (Q1 2027)', '=2'],
    ['', '', '', 'Gap (resolve before ingest)', '=IF(COUNT(E6:E7)=2,E6-E7,"")'],
    ['', '', '', 'Custom param', 'keep me']];
  return data;
}
test('cleanup clears only the recognized legacy Assumptions block and never regenerates it', () => {
  const rt = runtime(legacyAssumptionsFixture());
  const before = rt.ctx.TPOCore.analyze(rt.ctx.readSources_());
  const result = rt.ctx.cleanupWorkbook_();
  assert.equal(result.changes, 7); // E of the heading row is already blank and stays untouched
  assert.equal(result.sourcesCleared, true);
  assert.equal(JSON.stringify(result.notices), JSON.stringify([]));
  const sh = rt.sheets.get('Assumptions');
  for (let row = 4; row <= 7; row++) for (let col = 4; col <= 5; col++) {
    assert.equal(sh.getRange(row, col).getValues()[0][0], '');
    assert.equal(sh.getRange(row, col).getFormulas()[0][0], '');
  }
  assert.equal(sh.getRange(2, 1).getValues()[0][0], 'Acme Corp');
  assert.equal(sh.getRange(2, 5).getValues()[0][0], 'THB');
  assert.equal(sh.getRange(3, 5).getValues()[0][0], 'Feb-27');
  assert.equal(sh.getRange(8, 4).getValues()[0][0], 'Custom param');
  assert.equal(sh.getRange(8, 5).getValues()[0][0], 'keep me');
  const backup = rt.sheets.get('Repair Backup').getDataRange().getValues();
  assert.equal(backup.find(r => r[2] === 'Assumptions' && r[3] === 'D4')[4], 'RECONCILIATION CHECK');
  assert.ok(/COUNT\(E6:E7\)/.test(backup.find(r => r[2] === 'Assumptions' && r[3] === 'E5')[4]));
  assert.ok(/E6-E7/.test(backup.find(r => r[2] === 'Assumptions' && r[3] === 'E7')[4]));
  const after = rt.ctx.TPOCore.analyze(rt.ctx.readSources_());
  assert.equal(JSON.stringify(after.issues), JSON.stringify(before.issues));
  assert.equal(rt.ctx.TPOCore.fingerprint(after), rt.ctx.TPOCore.fingerprint(before));
  assert.equal(JSON.stringify(rt.ctx.TPOCore.modelRows(after)), JSON.stringify(rt.ctx.TPOCore.modelRows(before)));
  rt.ctx.repairAndScaffold_(false);
  for (let row = 4; row <= 7; row++) for (let col = 4; col <= 5; col++) {
    assert.equal(sh.getRange(row, col).getValues()[0][0], '', 'regenerated at row ' + row);
    assert.equal(sh.getRange(row, col).getFormulas()[0][0], '', 'formula regenerated at row ' + row);
  }
  assert.equal(sh.getRange(8, 4).getValues()[0][0], 'Custom param');
});
test('mismatched or partial reconciliation blocks stay intact with a notice', () => {
  const rt = runtime(legacyAssumptionsFixture({ mismatch: true }));
  const before = values(rt.sheets.get('Assumptions'));
  const result = rt.ctx.cleanupWorkbook_();
  assert.equal(result.changes, 0);
  assert.equal(JSON.stringify(result.notices), JSON.stringify(['Assumptions reconciliation block at D4:E7 does not match the legacy template; left unchanged.']));
  assert.equal(values(rt.sheets.get('Assumptions')), before);
  assert.ok(!rt.sheets.has('Repair Backup'));
  const partial = legacyAssumptionsFixture();
  partial.Assumptions[6][3] = 'Something else';
  const rt2 = runtime(partial);
  const result2 = rt2.ctx.cleanupWorkbook_();
  assert.equal(result2.changes, 0);
  assert.equal(JSON.stringify(result2.notices), JSON.stringify(['Assumptions reconciliation block at D4:E7 does not match the legacy template; left unchanged.']));
});
function capturedGuideFixture() {
  const data = legacyAssumptionsFixture();
  data.README = [
    ['TPO Wellness — Monthly Input Template'],
    ['Single source of truth. Collect in Google Sheets (Apps Script), download .xlsx into pipeline/inputs/, run validate_input.py, then build_sources.py.'],
    ['LEGEND'],
    ['Yellow cells', 'INPUT — you type this (raw data, balance sheet, dashboard inputs).'],
    ['White cells', 'FORMULA/DERIVED — auto-computed.'],
    ['Blank', 'no data yet.'],
    [], ['HOW TO USE'],
    ['1.', 'Fill raw-data tabs.'],
    ['2.', 'Board tables auto-compute.'],
    ['3.', 'Check Assumptions reconciliation cell.'],
    ['4.', 'Import to Google Sheets.'],
    ['5.', 'python pipeline/validate_input.py -> build_sources.py'],
    [], ['DATA SOURCES (seeded)'],
    ['MonthlyFinancials', 'from xlsx Jan-25..May-26.'],
    ['CustomerRevenueMonthly', 'from xlsx May-24..May-26.'],
    [], ['NotebookLM reads final integers.']];
  data.Glossary = [
    ['Term', 'Definition'],
    ['Low season (Jun – Oct)', 'The seasonal trough.'],
    ['Q2 2026 cordon', 'Through May only.'],
    ['Active customers', 'Count at the first month of the quarter.'],
    ['Net Working Capital', 'Cash + AR + inventory − AP.'],
    ['Contribution margin', 'Per-customer gross margin assumption.'],
    ['Data note (WARN)', 'Divergence > 0.5% note.'],
    ['Turnaround storyline', 'Q1 2025 trough → Q1 2026 recovery.'],
    ['Company Name', 'TPO Wellness']];
  data.Commentary = [['View', 'Commentary', 'Status', 'Old Commentary'],
    ['beta', 'Old beta', 'Old status', ''], ['overview', 'Old overview', 'Old status', ''],
    ['custom-note', 'Unrelated text', 'Keep', ''], ['acme-corp', 'Old acme', 'Old status', '']];
  return data;
}
test('cleanup refreshes captured README/Glossary and clears the empty archive header, then stays idempotent', () => {
  const rt = runtime(capturedGuideFixture());
  const commentaryBefore = JSON.stringify(rt.sheets.get('Commentary').getDataRange().getValues().map(r => r.slice(0, 3)));
  const result = rt.ctx.cleanupWorkbook_();
  assert.ok(result.changes > 20);
  const readme = rt.sheets.get('README');
  assert.equal(readme.getRange('A1').getDisplayValue(), 'TPO — Monthly workflow');
  const readmeText = JSON.stringify(readme.getDataRange().getValues());
  for (const stale of ['validate_input.py', 'pipeline/inputs/', 'NotebookLM', 'Q1 2026', 'reconciliation cell'])
    assert.ok(!readmeText.includes(stale), stale + ' still present');
  assert.ok(readmeText.includes('TPO → 2. Check & calculate'));
  const glossary = rt.sheets.get('Glossary');
  assert.equal(glossary.getRange('A2').getDisplayValue(), 'Low season');
  assert.ok(glossary.getRange('B2').getDisplayValue().includes('configured in Assumptions'));
  assert.equal(glossary.getRange('A3').getDisplayValue(), 'Quarter coverage');
  assert.ok(glossary.getRange('B3').getDisplayValue().includes('do not annualize'));
  assert.ok(glossary.getRange('B6').getDisplayValue().includes('not audited gross profit'));
  assert.equal(glossary.getRange('A7').getDisplayValue(), 'Data quality notes');
  assert.ok(glossary.getRange('B7').getDisplayValue().includes('do not fill unknowns'));
  const glossaryText = JSON.stringify(glossary.getDataRange().getValues());
  assert.ok(!glossaryText.includes('Turnaround storyline'));
  assert.ok(!glossaryText.includes('0.5%'));
  assert.equal(glossary.getRange('A4').getDisplayValue(), 'Active customers');
  assert.equal(glossary.getRange('A9').getDisplayValue(), 'Company Name');
  assert.equal(glossary.getRange('B9').getDisplayValue(), 'TPO Wellness');
  assert.equal(rt.sheets.get('Commentary').getRange('D1').getDisplayValue(), '');
  assert.equal(JSON.stringify(rt.sheets.get('Commentary').getDataRange().getValues().map(r => r.slice(0, 3))), commentaryBefore);
  const backupRows = rt.sheets.get('Repair Backup').getLastRow();
  const second = rt.ctx.cleanupWorkbook_();
  assert.equal(second.changes, 0);
  assert.equal(JSON.stringify(second.notices), JSON.stringify([]));
  assert.equal(rt.sheets.get('Repair Backup').getLastRow(), backupRows);
});
test('custom README, foreign glossary headers and populated archives are preserved with notices', () => {
  const custom = capturedGuideFixture();
  custom.README[0][0] = 'My own notes';
  custom.Glossary[0] = ['Glossar', 'Bedeutung'];
  custom.Commentary[1][3] = 'kept archive text';
  const rt = runtime(custom);
  const before = [values(rt.sheets.get('README')), values(rt.sheets.get('Glossary')), values(rt.sheets.get('Commentary'))];
  const result = rt.ctx.cleanupWorkbook_();
  assert.equal(result.changes, 7); // only the Assumptions block
  assert.equal(JSON.stringify(result.notices), JSON.stringify(['README contains custom content; left unchanged.',
    'Glossary headers are not Term | Definition; left unchanged.',
    'Commentary column D contains archived content; left unchanged.']));
  assert.equal(values(rt.sheets.get('README')), before[0]);
  assert.equal(values(rt.sheets.get('Glossary')), before[1]);
  assert.equal(values(rt.sheets.get('Commentary')), before[2]);
});
test('cleanup failure rolls every earlier changed cell back and keeps backup evidence', () => {
  const rt = runtime(capturedGuideFixture());
  const names = ['Assumptions', 'README', 'Glossary', 'Commentary'];
  const before = Object.fromEntries(names.map(n => [n, JSON.stringify({
    values: rt.sheets.get(n).getDataRange().getValues(), formulas: rt.sheets.get(n).getDataRange().getFormulas() })]));
  rt.sheets.get('README').failOnce = (r, c) => r === 9 && c === 1; // after Assumptions + early README writes
  assert.throws(() => rt.ctx.cleanupWorkbook_(), /simulated/);
  names.forEach(n => {
    const sh = rt.sheets.get(n);
    assert.equal(JSON.stringify({ values: sh.getDataRange().getValues(), formulas: sh.getDataRange().getFormulas() }), before[n], n + ' not restored');
  });
  const backup = rt.sheets.get('Repair Backup').getDataRange().getValues();
  assert.ok(backup.some(r => r[2] === 'Assumptions' && r[3] === 'E7' && /E6-E7/.test(r[4])));
});
test('combined response import updates Commentary, stores literal JSON, selects Commentary, and repeats without rewriting', () => {
  const rt = runtime(); rt.ctx.prepare_();
  const sh = rt.sheets.get('Commentary');
  sh.getRange(4, 2).setFormula('="Unrelated formula"'); sh.writes = [];
  const response = sampleResponse(rt);
  const text = JSON.stringify(response, null, 2);
  const result = rt.ctx.importPastedLLMOutput(text, response.batch_id);
  assert.equal(result.count, 8); assert.equal(result.already, false);
  assert.equal(rt.getSelected().getName(), 'Commentary');
  assert.equal(rt.ctx.readOutput_(rt.ctx.readState_()), text);
  assert.equal(sh.getRange(2, 2).getDisplayValue(), response.commentaries.find(r => r.view === 'beta').commentary);
  assert.equal(sh.getRange(4, 2).getFormulas()[0][0], '="Unrelated formula"');
  assert.ok(sh.writes.every(([r, c]) => c <= 3 && r !== 4));
  const state = rt.ctx.readState_();
  assert.ok(state.importedHash); assert.ok(state.importedAt);
  assert.match(rt.sheets.get('LLM Output').getRange('B5').getDisplayValue(), /^Imported 8 sections/);
  sh.writes = [];
  const again = rt.ctx.importPastedLLMOutput(text, response.batch_id);
  assert.equal(again.already, true);
  assert.equal(sh.writes.length, 0);
});
test('invalid, wrong-batch and stale responses leave output, Commentary and manifest unchanged', () => {
  const rt = runtime(); rt.ctx.prepare_();
  const valid = sampleResponse(rt);
  const outputBefore = values(rt.sheets.get('LLM Output'));
  const commentaryBefore = values(rt.sheets.get('Commentary'));
  const manifestBefore = rt.properties.get('TPO_MANUAL_V1_0');
  const cases = [
    ['{broken', valid.batch_id, /valid JSON/],
    [JSON.stringify({ ...valid, batch_id: 'old' }), valid.batch_id, /another batch/],
    [JSON.stringify(valid), 'other-batch', /newer input was prepared/],
    [JSON.stringify({ ...valid, commentaries: valid.commentaries.slice(1) }), valid.batch_id, /incomplete/]];
  cases.forEach(([text, batch, error]) => {
    assert.throws(() => rt.ctx.importPastedLLMOutput(text, batch), error);
    assert.equal(values(rt.sheets.get('LLM Output')), outputBefore);
    assert.equal(values(rt.sheets.get('Commentary')), commentaryBefore);
    assert.equal(rt.properties.get('TPO_MANUAL_V1_0'), manifestBefore);
  });
  rt.sheets.get('MonthlyFinancials').getRange(2, 3).setValue(999);
  assert.throws(() => rt.ctx.importPastedLLMOutput(JSON.stringify(valid), valid.batch_id), /Source data changed/);
  assert.equal(values(rt.sheets.get('Commentary')), commentaryBefore);
  assert.equal(rt.properties.get('TPO_MANUAL_V1_0'), manifestBefore);
});
test('combined action restores output, manifest and Commentary after late failures', () => {
  const scenarios = [
    rt => { rt.sheets.get('LLM Output').failOnce = (r, c) => r >= 8 && c === 1; return /simulated/; },
    rt => { rt.sheets.get('Commentary').failOnce = (r, c) => r === 5 && c === 2; return /Original commentary was restored/; },
    rt => { rt.failProps(1); return /Import failed/; },
    rt => { rt.sheets.get('LLM Output').failOnce = (r, c) => r === 5 && c === 2; return /Import failed/; }];
  scenarios.forEach(setup => {
    const rt = runtime(); rt.ctx.prepare_();
    const response = sampleResponse(rt);
    const before = [values(rt.sheets.get('LLM Output')), values(rt.sheets.get('Commentary')), JSON.stringify(rt.ctx.readState_())];
    const pattern = setup(rt);
    assert.throws(() => rt.ctx.importPastedLLMOutput(JSON.stringify(response, null, 2), response.batch_id), pattern);
    assert.equal(values(rt.sheets.get('LLM Output')), before[0]);
    assert.equal(values(rt.sheets.get('Commentary')), before[1]);
    assert.equal(JSON.stringify(rt.ctx.readState_()), before[2]);
  });
});

function sampleImportPack(months = null) {
  const mList = months || [
    {
      month: '2027-01',
      financials: { revenueCents: 10000, cogsCents: 6000, sgaCents: 1000, netIncomeCents: 2000 },
      workingCapital: { cashCents: 10000, arCents: 4000, inventoryCents: 1000, apCents: 3000 },
      checks: { grossProfitCents: 4000, ebitCents: 3000 },
      sourceRefs: {
        revenueCents: ['PL!R15'], cogsCents: ['PL!R63'], sgaCents: ['PL!R170'], netIncomeCents: ['PL!R197'],
        cashCents: ['BS!D5', 'BS!D6', 'BS!D7', 'BS!D8'], arCents: ['BS!D9'],
        inventoryCents: ['BS!D12', 'BS!D13', 'BS!D14'],
        apCents: ['BS!D48', 'BS!D49', 'BS!D50', 'BS!D51', 'BS!D52', 'BS!D55', 'BS!D56', 'BS!D57', 'BS!D58', 'BS!D59', 'BS!D60', 'BS!D61', 'BS!D62', 'BS!D63', 'BS!D64', 'BS!D65', 'BS!D66']
      }
    },
    {
      month: '2027-02',
      financials: { revenueCents: 20000, cogsCents: 12000, sgaCents: 2000, netIncomeCents: 4000 },
      workingCapital: { cashCents: 20000, arCents: 5000, inventoryCents: 2000, apCents: 4000 },
      checks: { grossProfitCents: 8000, ebitCents: 6000 },
      sourceRefs: {
        revenueCents: ['PL!S15'], cogsCents: ['PL!S63'], sgaCents: ['PL!S170'], netIncomeCents: ['PL!S197'],
        cashCents: ['BS!E5', 'BS!E6', 'BS!E7', 'BS!E8'], arCents: ['BS!E9'],
        inventoryCents: ['BS!E12', 'BS!E13', 'BS!E14'],
        apCents: ['BS!E48', 'BS!E49', 'BS!E50', 'BS!E51', 'BS!E52', 'BS!E55', 'BS!E56', 'BS!E57', 'BS!E58', 'BS!E59', 'BS!E60', 'BS!E61', 'BS!E62', 'BS!E63', 'BS!E64', 'BS!E65', 'BS!E66']
      }
    },
    {
      month: '2027-03',
      financials: { revenueCents: 30000, cogsCents: 18000, sgaCents: 3000, netIncomeCents: 6000 },
      workingCapital: { cashCents: 30000, arCents: 6000, inventoryCents: 3000, apCents: 5000 },
      checks: { grossProfitCents: 12000, ebitCents: 9000 },
      sourceRefs: {
        revenueCents: ['PL!T15'], cogsCents: ['PL!T63'], sgaCents: ['PL!T170'], netIncomeCents: ['PL!T197'],
        cashCents: ['BS!F5', 'BS!F6', 'BS!F7', 'BS!F8'], arCents: ['BS!F9'],
        inventoryCents: ['BS!F12', 'BS!F13', 'BS!F14'],
        apCents: ['BS!F48', 'BS!F49', 'BS!F50', 'BS!F51', 'BS!F52', 'BS!F55', 'BS!F56', 'BS!F57', 'BS!F58', 'BS!F59', 'BS!F60', 'BS!F61', 'BS!F62', 'BS!F63', 'BS!F64', 'BS!F65', 'BS!F66']
      }
    }
  ];
  return {
    schema: 'tpo-monthly-actuals-v1',
    source: {
      filename: 'synthetic-actuals-export.xlsx',
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      reportMonth: mList.length ? mList[mList.length - 1].month : '2027-03'
    },
    months: mList
  };
}
function snapshotTabRange(sh, nr = Math.max(1, sh.getLastRow()), nc = Math.max(1, sh.getLastColumn())) {
  const r = sh.getRange(1, 1, nr, nc);
  return {
    values: r.getValues(),
    formulas: r.getFormulas(),
    formats: r.getNumberFormats()
  };
}
function snapshotAllNonDiag(rt) {
  const sheets = {};
  for (const [name, sh] of rt.sheets.entries()) {
    sheets[name] = snapshotTabRange(sh);
  }
  const props = {};
  for (const [k, v] of rt.properties.entries()) {
    if (!/error|action|stack/i.test(k)) props[k] = v;
  }
  return { sheets, props };
}

test('monthly import preview leaves input sheets, formulas, backup and LLM state untouched and calculates differences', () => {
  const data = fixture();
  // 1. One satang change: target Jan-27 revenue is 100.00 THB (10000 cents), pack proposed is 10001 cents (+1 satang)
  // 2. Sub-0.0001% change: target Jan-27 cash in 1. Working Capital is 100,000,000.00 THB (10,000,000,000 cents), pack proposed is 10,000,000,001 cents
  data['1. Working Capital'][1][1] = 100000000;
  // 3. Negative baseline: target Feb-27 Net Income is -100.00 THB (-10000 cents), pack proposed is -5000 cents (-50.00 THB)
  data.MonthlyFinancials[1][6] = -100;
  // 4. Zero baseline: target Feb-27 SG&A is 0.00 THB (0 cents), pack proposed is 2000 cents (20.00 THB)
  data.MonthlyFinancials[1][4] = 0;
  // 5. Blank baseline: Mar-27 Revenue is blank in fixture

  const pack = sampleImportPack([
    {
      month: '2027-01',
      financials: { revenueCents: 10001, cogsCents: 6000, sgaCents: 1000, netIncomeCents: 2000 },
      workingCapital: { cashCents: 10000000001, arCents: 4000, inventoryCents: 1000, apCents: 3000 },
      checks: { grossProfitCents: 4001, ebitCents: 3001 },
      sourceRefs: {
        revenueCents: ['PL!R15'], cogsCents: ['PL!R63'], sgaCents: ['PL!R170'], netIncomeCents: ['PL!R197'],
        cashCents: ['BS!D5', 'BS!D6', 'BS!D7', 'BS!D8'], arCents: ['BS!D9'],
        inventoryCents: ['BS!D12', 'BS!D13', 'BS!D14'],
        apCents: ['BS!D48', 'BS!D49', 'BS!D50', 'BS!D51', 'BS!D52', 'BS!D55', 'BS!D56', 'BS!D57', 'BS!D58', 'BS!D59', 'BS!D60', 'BS!D61', 'BS!D62', 'BS!D63', 'BS!D64', 'BS!D65', 'BS!D66']
      }
    },
    {
      month: '2027-02',
      financials: { revenueCents: 20000, cogsCents: 12000, sgaCents: 2000, netIncomeCents: -5000 },
      workingCapital: { cashCents: 20000, arCents: 5000, inventoryCents: 2000, apCents: 4000 },
      checks: { grossProfitCents: 8000, ebitCents: 6000 },
      sourceRefs: {
        revenueCents: ['PL!S15'], cogsCents: ['PL!S63'], sgaCents: ['PL!S170'], netIncomeCents: ['PL!S197'],
        cashCents: ['BS!E5', 'BS!E6', 'BS!E7', 'BS!E8'], arCents: ['BS!E9'],
        inventoryCents: ['BS!E12', 'BS!E13', 'BS!E14'],
        apCents: ['BS!E48', 'BS!E49', 'BS!E50', 'BS!E51', 'BS!E52', 'BS!E55', 'BS!E56', 'BS!E57', 'BS!E58', 'BS!E59', 'BS!E60', 'BS!E61', 'BS!E62', 'BS!E63', 'BS!E64', 'BS!E65', 'BS!E66']
      }
    },
    {
      month: '2027-03',
      financials: { revenueCents: 30000, cogsCents: 18000, sgaCents: 3000, netIncomeCents: 6000 },
      workingCapital: { cashCents: 30000, arCents: 6000, inventoryCents: 3000, apCents: 5000 },
      checks: { grossProfitCents: 12000, ebitCents: 9000 },
      sourceRefs: {
        revenueCents: ['PL!T15'], cogsCents: ['PL!T63'], sgaCents: ['PL!T170'], netIncomeCents: ['PL!T197'],
        cashCents: ['BS!F5', 'BS!F6', 'BS!F7', 'BS!F8'], arCents: ['BS!F9'],
        inventoryCents: ['BS!F12', 'BS!F13', 'BS!F14'],
        apCents: ['BS!F48', 'BS!F49', 'BS!F50', 'BS!F51', 'BS!F52', 'BS!F55', 'BS!F56', 'BS!F57', 'BS!F58', 'BS!F59', 'BS!F60', 'BS!F61', 'BS!F62', 'BS!F63', 'BS!F64', 'BS!F65', 'BS!F66']
      }
    }
  ]);
  const text = JSON.stringify(pack);
  const rt = runtime(data);

  // Snapshot before preview
  const beforePreview = snapshotAllNonDiag(rt);

  const preview = rt.ctx.previewMonthlyActualsImport(text);
  assert.ok(preview.previewHash);
  assert.equal(preview.source.filename, 'synthetic-actuals-export.xlsx');
  assert.equal(preview.months.length, 3);

  // Preview leaves values, formulas, formats, backup and manifest untouched
  assert.deepEqual(snapshotAllNonDiag(rt), beforePreview);

  // Assert structured change outputs:
  // 1. ONE satang: Jan-27 revenue (10000 -> 10001)
  const m1 = preview.months.find(m => m.month === '2027-01');
  const oneSatangChange = m1.changes.find(c => c.field === 'revenueCents');
  assert.equal(oneSatangChange.previousCents, 10000);
  assert.equal(oneSatangChange.proposedCents, 10001);
  assert.equal(oneSatangChange.deltaCents, 1);
  assert.equal(oneSatangChange.deltaPercent, 0.01);

  // 2. Sub-0.0001% change: Jan-27 cash (10000000000 -> 10000000001)
  const subPercentChange = m1.changes.find(c => c.field === 'cashCents');
  assert.equal(subPercentChange.previousCents, 10000000000);
  assert.equal(subPercentChange.proposedCents, 10000000001);
  assert.equal(subPercentChange.deltaCents, 1);
  assert.ok(subPercentChange.deltaPercent > 0 && subPercentChange.deltaPercent < 0.0001,
    'deltaPercent ' + subPercentChange.deltaPercent + ' must be between 0 and 0.0001%');

  // 3. Negative baseline: Feb-27 net income (-10000 -> -5000)
  const m2 = preview.months.find(m => m.month === '2027-02');
  const negChange = m2.changes.find(c => c.field === 'netIncomeCents');
  assert.equal(negChange.previousCents, -10000);
  assert.equal(negChange.proposedCents, -5000);
  assert.equal(negChange.deltaCents, 5000);
  assert.equal(negChange.deltaPercent, 50);

  // 4. Zero baseline: Feb-27 SG&A (0 -> 2000)
  const zeroChange = m2.changes.find(c => c.field === 'sgaCents');
  assert.equal(zeroChange.previousCents, 0);
  assert.equal(zeroChange.proposedCents, 2000);
  assert.equal(zeroChange.deltaCents, 2000);
  assert.equal(zeroChange.deltaPercent, null, 'Previous value zero must yield null deltaPercent');

  // 5. Blank baseline: Mar-27 revenue (blank -> 30000)
  const m3 = preview.months.find(m => m.month === '2027-03');
  const blankChange = m3.changes.find(c => c.field === 'revenueCents');
  assert.equal(blankChange.previousCents, null);
  assert.equal(blankChange.proposedCents, 30000);
  assert.equal(blankChange.deltaCents, null);
  assert.equal(blankChange.deltaPercent, null);

  // Pre-apply snapshot of separate inputs, Commentary, LLM exchange sheets, and manifest
  const unrelatedSheets = ['Assumptions', 'CustomerRevenueMonthly', 'CustomerRevenueQuarterly',
    'CustomerCount', 'Dashboard Inputs', 'Report Settings', 'Commentary', 'LLM-Input', 'LLM Output'];
  const snapshotUnrelated = () => Object.fromEntries(
    unrelatedSheets.map(n => [n, rt.sheets.get(n) ? snapshotTabRange(rt.sheets.get(n)) : null])
  );
  const unrelatedBefore = snapshotUnrelated();
  const manifestBefore = rt.properties.get('TPO_MANUAL_V1_0');

  // Apply selected month
  const applyRes = rt.ctx.applyMonthlyActualsImport(text, ['2027-01'], preview.previewHash);
  assert.equal(applyRes.already, false);

  // Post-apply assertions: separate inputs, Commentary, LLM exchange sheets, and manifest remain UNCHANGED
  const unrelatedAfter = snapshotUnrelated();
  for (const sheetName of unrelatedSheets) {
    assert.deepEqual(unrelatedAfter[sheetName], unrelatedBefore[sheetName],
      sheetName + ' values, formulas, and formats must be identical after apply');
  }
  assert.equal(rt.properties.get('TPO_MANUAL_V1_0'), manifestBefore, 'Manifest must be identical after apply');
});



test('monthlyDecimalCents_ boundary conversions, exponent limits and leading zero preservation', () => {
  const rt = runtime();
  const fn = rt.ctx.monthlyDecimalCents_;
  assert.equal(fn('0.01').cents, 1);
  assert.equal(fn('0.005').cents, 1);
  assert.equal(fn('0.0049').cents, 0);
  assert.equal(fn('-0.01').cents, -1);
  assert.equal(fn('.5').cents, 50);
  assert.equal(fn('.05').cents, 5);
  assert.equal(fn('1e-2').cents, 1);
  assert.equal(fn('1.5e1').cents, 1500);
  assert.equal(fn('0').cents, 0);
  assert.equal(fn('1000000.00').cents, 100000000);
  assert.ok(fn('1e501').error);
  assert.ok(fn('1'.repeat(1001)).error);
  assert.equal(fn('not-a-number').cents, null);
  const extremeDiff = rt.ctx.monthlyActualsDiff_(-9007199254740991, 9007199254740991);
  assert.equal(extremeDiff.overflow, true);
  assert.equal(extremeDiff.deltaCents, null);
});

test('monthly import reordered headers, blank slot, append resolution without duplicates', () => {
  const data = fixture();
  data.MonthlyFinancials[0] = ['Quarter', 'Revenue', 'COGS', 'Gross Profit', 'SG&A', 'EBIT', 'Net Income', 'Month'];
  for (let i = 1; i < data.MonthlyFinancials.length; i++) {
    const r = data.MonthlyFinancials[i];
    data.MonthlyFinancials[i] = [r[7], r[1], r[2], r[3], r[4], r[5], r[6], r[0]];
  }
  const rt = runtime(data);
  const pack = sampleImportPack([
    {
      month: '2027-03',
      financials: { revenueCents: 30000, cogsCents: 18000, sgaCents: 3000, netIncomeCents: 6000 },
      workingCapital: { cashCents: 30000, arCents: 6000, inventoryCents: 3000, apCents: 5000 },
      checks: { grossProfitCents: 12000, ebitCents: 9000 },
      sourceRefs: {
        revenueCents: ['PL!T15'], cogsCents: ['PL!T63'], sgaCents: ['PL!T170'], netIncomeCents: ['PL!T197'],
        cashCents: ['BS!F5', 'BS!F6', 'BS!F7', 'BS!F8'], arCents: ['BS!F9'],
        inventoryCents: ['BS!F12', 'BS!F13', 'BS!F14'],
        apCents: ['BS!F48', 'BS!F49', 'BS!F50', 'BS!F51', 'BS!F52', 'BS!F55', 'BS!F56', 'BS!F57', 'BS!F58', 'BS!F59', 'BS!F60', 'BS!F61', 'BS!F62', 'BS!F63', 'BS!F64', 'BS!F65', 'BS!F66']
      }
    },
    {
      month: '2027-04',
      financials: { revenueCents: 40000, cogsCents: 24000, sgaCents: 4000, netIncomeCents: 8000 },
      workingCapital: { cashCents: 40000, arCents: 8000, inventoryCents: 4000, apCents: 6000 },
      checks: { grossProfitCents: 16000, ebitCents: 12000 },
      sourceRefs: {
        revenueCents: ['PL!U15'], cogsCents: ['PL!U63'], sgaCents: ['PL!U170'], netIncomeCents: ['PL!U197'],
        cashCents: ['BS!G5', 'BS!G6', 'BS!G7', 'BS!G8'], arCents: ['BS!G9'],
        inventoryCents: ['BS!G12', 'BS!G13', 'BS!G14'],
        apCents: ['BS!G48', 'BS!G49', 'BS!G50', 'BS!G51', 'BS!G52', 'BS!G55', 'BS!G56', 'BS!G57', 'BS!G58', 'BS!G59', 'BS!G60', 'BS!G61', 'BS!G62', 'BS!G63', 'BS!G64', 'BS!G65', 'BS!G66']
      }
    }
  ]);
  const text = JSON.stringify(pack);
  const prev = rt.ctx.previewMonthlyActualsImport(text);
  const res = rt.ctx.applyMonthlyActualsImport(text, ['2027-03', '2027-04'], prev.previewHash);
  assert.equal(res.already, false);
  assert.ok(res.changes > 0);

  const mf = rt.sheets.get('MonthlyFinancials');
  assert.equal(mf.getRange(6, 8).getDisplayValue(), 'Mar-27');
  assert.equal(mf.getRange(6, 2).getValues()[0][0], 300);
  assert.equal(mf.getRange(7, 8).getDisplayValue(), 'Apr-27');
  assert.equal(mf.getRange(7, 2).getValues()[0][0], 400);
});

test('monthly import entire older pack has no default selection, and single new month reserves no history rows', () => {
  const rt = runtime();
  // Older pack: all months prior to destination latest (Feb-27)
  const olderPack = sampleImportPack([
    {
      month: '2026-01',
      financials: { revenueCents: 10000, cogsCents: 6000, sgaCents: 1000, netIncomeCents: 2000 },
      workingCapital: { cashCents: 10000, arCents: 4000, inventoryCents: 1000, apCents: 3000 },
      checks: { grossProfitCents: 4000, ebitCents: 3000 },
      sourceRefs: {
        revenueCents: ['PL!R15'], cogsCents: ['PL!R63'], sgaCents: ['PL!R170'], netIncomeCents: ['PL!R197'],
        cashCents: ['BS!D5', 'BS!D6', 'BS!D7', 'BS!D8'], arCents: ['BS!D9'],
        inventoryCents: ['BS!D12', 'BS!D13', 'BS!D14'],
        apCents: ['BS!D48', 'BS!D49', 'BS!D50', 'BS!D51', 'BS!D52', 'BS!D55', 'BS!D56', 'BS!D57', 'BS!D58', 'BS!D59', 'BS!D60', 'BS!D61', 'BS!D62', 'BS!D63', 'BS!D64', 'BS!D65', 'BS!D66']
      }
    },
    {
      month: '2026-02',
      financials: { revenueCents: 20000, cogsCents: 12000, sgaCents: 2000, netIncomeCents: 4000 },
      workingCapital: { cashCents: 20000, arCents: 5000, inventoryCents: 2000, apCents: 4000 },
      checks: { grossProfitCents: 8000, ebitCents: 6000 },
      sourceRefs: {
        revenueCents: ['PL!S15'], cogsCents: ['PL!S63'], sgaCents: ['PL!S170'], netIncomeCents: ['PL!S197'],
        cashCents: ['BS!E5', 'BS!E6', 'BS!E7', 'BS!E8'], arCents: ['BS!E9'],
        inventoryCents: ['BS!E12', 'BS!E13', 'BS!E14'],
        apCents: ['BS!E48', 'BS!E49', 'BS!E50', 'BS!E51', 'BS!E52', 'BS!E55', 'BS!E56', 'BS!E57', 'BS!E58', 'BS!E59', 'BS!E60', 'BS!E61', 'BS!E62', 'BS!E63', 'BS!E64', 'BS!E65', 'BS!E66']
      }
    }
  ]);
  const prevOlder = rt.ctx.previewMonthlyActualsImport(JSON.stringify(olderPack));
  assert.ok(prevOlder.months.every(m => m.defaultSelected === false));

  // Destination with HEADER ONLY in both MonthlyFinancials and 1. Working Capital:
  // Pack has Jan-27, Feb-27, Mar-27.
  // Applying ONLY Mar-27 must create row 2 as Mar-27 in both tabs, with no Jan/Feb rows and no blank reserved rows.
  const emptyData = fixture();
  emptyData.MonthlyFinancials = [emptyData.MonthlyFinancials[0]]; // header only
  emptyData['1. Working Capital'] = [emptyData['1. Working Capital'][0]]; // header only
  const rtEmpty = runtime(emptyData);
  const mfEmpty = rtEmpty.sheets.get('MonthlyFinancials');
  const wcEmpty = rtEmpty.sheets.get('1. Working Capital');
  assert.equal(mfEmpty.getLastRow(), 1, 'MonthlyFinancials starts header only');
  assert.equal(wcEmpty.getLastRow(), 1, '1. Working Capital starts header only');

  const packJanFebMar = sampleImportPack();
  const textPack = JSON.stringify(packJanFebMar);
  const prevEmpty = rtEmpty.ctx.previewMonthlyActualsImport(textPack);
  assert.equal(prevEmpty.months.length, 3);

  const res = rtEmpty.ctx.applyMonthlyActualsImport(textPack, ['2027-03'], prevEmpty.previewHash);
  assert.equal(res.already, false);
  assert.equal(res.changes, 14);

  // Exact header + Mar row 2 in both destinations; no Jan, no Feb, no blank reserved rows
  assert.equal(mfEmpty.getLastRow(), 2, 'MonthlyFinancials must have exactly header + Mar row 2');
  assert.equal(wcEmpty.getLastRow(), 2, '1. Working Capital must have exactly header + Mar row 2');
  assert.deepEqual(mfEmpty.getRange(1, 1, 1, 8).getValues()[0], fixture().MonthlyFinancials[0]);
  assert.equal(mfEmpty.getRange(2, 1).getDisplayValue(), 'Mar-27');
  assert.deepEqual(wcEmpty.getRange(1, 1, 1, 6).getValues()[0], fixture()['1. Working Capital'][0]);
  assert.equal(wcEmpty.getRange(2, 1).getDisplayValue(), 'Mar-27');
});

test('monthly import selected recognized legacy formulas and canonical formulas preserved, literals converted', () => {
  const data = fixture();
  // Row 4: Jan-27 with literal GP and EBIT
  data.MonthlyFinancials[3][3] = 40;
  data.MonthlyFinancials[3][5] = 30;
  const rt = runtime(data);
  const mf = rt.sheets.get('MonthlyFinancials');
  // Row 2: Feb-27 with recognized legacy direct arithmetic formula
  mf.put(2, 4, { value: 80, formula: '=B2-C2', rich: null });
  mf.put(2, 6, { value: 60, formula: '=D2-E2', rich: null });
  // Row 6: Mar-27 with canonical blank-safe formula and agreeing cached quarter formula
  mf.put(6, 4, { value: 120, formula: '=IF(COUNT(B6,C6)=2,B6-C6,"")', rich: null });
  mf.put(6, 6, { value: 90, formula: '=IF(COUNT(D6,E6)=2,D6-E6,"")', rich: null });
  mf.put(6, 8, { value: 'Q1 2027', formula: '="Q1 2027"', rich: null });

  const pack = sampleImportPack();
  const text = JSON.stringify(pack);
  const prev = rt.ctx.previewMonthlyActualsImport(text);

  // Select and apply ALL three months:
  const res = rt.ctx.applyMonthlyActualsImport(text, ['2027-01', '2027-02', '2027-03'], prev.previewHash);
  assert.equal(res.already, false);

  // Jan-27: literal converted to canonical formula
  assert.ok(mf.getRange(4, 4).getFormulas()[0][0].includes('IF(COUNT('));
  assert.ok(mf.getRange(4, 6).getFormulas()[0][0].includes('IF(COUNT('));

  // Feb-27: recognized legacy direct arithmetic formula PRESERVED on selected apply!
  assert.equal(mf.getRange(2, 4).getFormulas()[0][0], '=B2-C2');
  assert.equal(mf.getRange(2, 6).getFormulas()[0][0], '=D2-E2');

  // Mar-27: canonical formula PRESERVED, agreeing quarter formula PRESERVED
  assert.equal(mf.getRange(6, 4).getFormulas()[0][0], '=IF(COUNT(B6,C6)=2,B6-C6,"")');
  assert.equal(mf.getRange(6, 6).getFormulas()[0][0], '=IF(COUNT(D6,E6)=2,D6-E6,"")');
  assert.equal(mf.getRange(6, 8).getFormulas()[0][0], '="Q1 2027"');

  // Raw values were updated
  assert.equal(mf.getRange(2, 2).getValues()[0][0], 200);
  assert.equal(mf.getRange(4, 2).getValues()[0][0], 100);
  assert.equal(mf.getRange(6, 2).getValues()[0][0], 300);
});

test('monthly import independently absent rows resolve correctly without duplicates', () => {
  const data = fixture();
  // Capture initial keys
  const initialMFKeys = data.MonthlyFinancials.slice(1).map(r => r[0]);
  // Remove Jan-27 row from Working Capital
  data['1. Working Capital'] = data['1. Working Capital'].filter(r => r[0] !== 'Jan-27');
  const initialWCKeys = data['1. Working Capital'].slice(1).map(r => r[0]);

  // Assert actual initial keys
  assert.ok(initialMFKeys.includes('Jan-27'), 'Jan-27 must be present in MonthlyFinancials initial keys');
  assert.ok(!initialWCKeys.includes('Jan-27'), 'Jan-27 must be absent from Working Capital initial keys');
  assert.equal(new Set(initialMFKeys).size, initialMFKeys.length, 'No duplicate initial keys in MonthlyFinancials');
  assert.equal(new Set(initialWCKeys).size, initialWCKeys.length, 'No duplicate initial keys in Working Capital');

  const rt = runtime(data);
  const pack = sampleImportPack([
    {
      month: '2027-01',
      financials: { revenueCents: 10000, cogsCents: 6000, sgaCents: 1000, netIncomeCents: 2000 },
      workingCapital: { cashCents: 10000, arCents: 4000, inventoryCents: 1000, apCents: 3000 },
      checks: { grossProfitCents: 4000, ebitCents: 3000 },
      sourceRefs: {
        revenueCents: ['PL!R15'], cogsCents: ['PL!R63'], sgaCents: ['PL!R170'], netIncomeCents: ['PL!R197'],
        cashCents: ['BS!D5', 'BS!D6', 'BS!D7', 'BS!D8'], arCents: ['BS!D9'],
        inventoryCents: ['BS!D12', 'BS!D13', 'BS!D14'],
        apCents: ['BS!D48', 'BS!D49', 'BS!D50', 'BS!D51', 'BS!D52', 'BS!D55', 'BS!D56', 'BS!D57', 'BS!D58', 'BS!D59', 'BS!D60', 'BS!D61', 'BS!D62', 'BS!D63', 'BS!D64', 'BS!D65', 'BS!D66']
      }
    }
  ]);
  const text = JSON.stringify(pack);
  const prev = rt.ctx.previewMonthlyActualsImport(text);
  const res = rt.ctx.applyMonthlyActualsImport(text, ['2027-01'], prev.previewHash);
  assert.equal(res.already, false);

  const mf = rt.sheets.get('MonthlyFinancials');
  const wc = rt.sheets.get('1. Working Capital');

  const finalMFKeys = Array.from({ length: mf.getLastRow() - 1 }, (_, i) => mf.getRange(i + 2, 1).getDisplayValue());
  const finalWCKeys = Array.from({ length: wc.getLastRow() - 1 }, (_, i) => wc.getRange(i + 2, 1).getDisplayValue());

  // Assert no duplicates in final keys
  assert.equal(new Set(finalMFKeys).size, finalMFKeys.length, 'No duplicate month keys in MonthlyFinancials');
  assert.equal(new Set(finalWCKeys).size, finalWCKeys.length, 'No duplicate month keys in Working Capital');

  // Assert key counts and presence
  assert.equal(finalMFKeys.length, initialMFKeys.length, 'MonthlyFinancials updated in-place without appending duplicate row');
  assert.equal(finalWCKeys.length, initialWCKeys.length + 1, 'Working Capital appended exactly one new row for absent Jan-27');
  assert.ok(finalWCKeys.includes('Jan-27'), 'Working Capital now has Jan-27');
  assert.equal(wc.getRange(3, 1).getDisplayValue(), 'Jan-27');
  assert.equal(wc.getRange(3, 2).getValues()[0][0], 100);

  // Also test the inverse: absent in MF, present in WC
  const data2 = fixture();
  data2.MonthlyFinancials = data2.MonthlyFinancials.filter(r => r[0] !== 'Jan-27');
  const initialMFKeys2 = data2.MonthlyFinancials.slice(1).map(r => r[0]);
  const initialWCKeys2 = data2['1. Working Capital'].slice(1).map(r => r[0]);
  assert.ok(!initialMFKeys2.includes('Jan-27'));
  assert.ok(initialWCKeys2.includes('Jan-27'));
  assert.equal(new Set(initialMFKeys2).size, initialMFKeys2.length);
  assert.equal(new Set(initialWCKeys2).size, initialWCKeys2.length);

  const rt2 = runtime(data2);
  const prev2 = rt2.ctx.previewMonthlyActualsImport(text);
  const res2 = rt2.ctx.applyMonthlyActualsImport(text, ['2027-01'], prev2.previewHash);
  assert.equal(res2.already, false);

  const mf2 = rt2.sheets.get('MonthlyFinancials');
  const wc2 = rt2.sheets.get('1. Working Capital');
  const finalMFKeys2 = Array.from({ length: mf2.getLastRow() - 1 }, (_, i) => mf2.getRange(i + 2, 1).getDisplayValue());
  const finalWCKeys2 = Array.from({ length: wc2.getLastRow() - 1 }, (_, i) => wc2.getRange(i + 2, 1).getDisplayValue());

  assert.equal(new Set(finalMFKeys2).size, finalMFKeys2.length, 'No duplicates in inverse MonthlyFinancials');
  assert.equal(new Set(finalWCKeys2).size, finalWCKeys2.length, 'No duplicates in inverse Working Capital');
  assert.equal(finalMFKeys2.length, initialMFKeys2.length + 1);
  assert.equal(finalWCKeys2.length, initialWCKeys2.length);
  assert.ok(finalMFKeys2.includes('Jan-27'));
});

test('monthly import schema, integer, selection and target structure validation fail pre-mutation', () => {
  const rt = runtime();
  const validPack = sampleImportPack();
  const textValid = JSON.stringify(validPack);

  // 1. Bad schema name
  const snap1 = snapshotAllNonDiag(rt);
  assert.throws(() => rt.ctx.previewMonthlyActualsImport(JSON.stringify({ ...validPack, schema: 'other-schema' })), /schema/);
  assert.deepEqual(snapshotAllNonDiag(rt), snap1, 'State unchanged on bad schema');

  // 2. Missing sourceRefs
  const badRefs = sampleImportPack();
  delete badRefs.months[0].sourceRefs;
  const snap2 = snapshotAllNonDiag(rt);
  assert.throws(() => rt.ctx.previewMonthlyActualsImport(JSON.stringify(badRefs)), /sourceRefs/);
  assert.deepEqual(snapshotAllNonDiag(rt), snap2, 'State unchanged on missing sourceRefs');

  // 3. Unsafe integer satang in pack
  const unsafePack = sampleImportPack();
  unsafePack.months[0].financials.revenueCents = 9007199254740999;
  const snap3 = snapshotAllNonDiag(rt);
  assert.throws(() => rt.ctx.previewMonthlyActualsImport(JSON.stringify(unsafePack)), /safe integer/);
  assert.deepEqual(snapshotAllNonDiag(rt), snap3, 'State unchanged on unsafe integer in pack');

  // 4. Type coercion guard: single-element array for source.sha256
  const arrayShaPack = sampleImportPack();
  arrayShaPack.source.sha256 = ['a'.repeat(64)];
  const snapSha = snapshotAllNonDiag(rt);
  assert.throws(() => rt.ctx.previewMonthlyActualsImport(JSON.stringify(arrayShaPack)), /sha256/);
  assert.deepEqual(snapshotAllNonDiag(rt), snapSha, 'State unchanged on array sha256');

  // 5. Type coercion guard: single-element array for source.reportMonth
  const arrayReportPack = sampleImportPack();
  arrayReportPack.source.reportMonth = ['2027-03'];
  const snapReport = snapshotAllNonDiag(rt);
  assert.throws(() => rt.ctx.previewMonthlyActualsImport(JSON.stringify(arrayReportPack)), /reportMonth/);
  assert.deepEqual(snapshotAllNonDiag(rt), snapReport, 'State unchanged on array reportMonth');

  // 6. Type coercion guard: single-element array for record.month
  const arrayMonthPack = sampleImportPack();
  arrayMonthPack.months[0].month = ['2027-01'];
  const snapMonth = snapshotAllNonDiag(rt);
  assert.throws(() => rt.ctx.previewMonthlyActualsImport(JSON.stringify(arrayMonthPack)), /invalid month key/);
  assert.deepEqual(snapshotAllNonDiag(rt), snapMonth, 'State unchanged on array record month');

  // 7. Safe raw integers yield unsafe GP -> reject pre-mutation
  const unsafeGPPack = sampleImportPack();
  unsafeGPPack.months[0].financials.revenueCents = Number.MAX_SAFE_INTEGER;
  unsafeGPPack.months[0].financials.cogsCents = -100;
  const snapGP = snapshotAllNonDiag(rt);
  assert.throws(() => rt.ctx.previewMonthlyActualsImport(JSON.stringify(unsafeGPPack)), /derived amounts outside the safe-integer/);
  assert.deepEqual(snapshotAllNonDiag(rt), snapGP, 'State unchanged on unsafe derived GP');

  // 8. Safe raw integers yield unsafe NWC -> reject pre-mutation
  const unsafeNWCPack = sampleImportPack();
  unsafeNWCPack.months[0].workingCapital.cashCents = Number.MAX_SAFE_INTEGER;
  unsafeNWCPack.months[0].workingCapital.arCents = 10000;
  const snapNWC = snapshotAllNonDiag(rt);
  assert.throws(() => rt.ctx.previewMonthlyActualsImport(JSON.stringify(unsafeNWCPack)), /derived amounts outside the safe-integer/);
  assert.deepEqual(snapshotAllNonDiag(rt), snapNWC, 'State unchanged on unsafe derived NWC');

  // 9. Target negative MAXSAFE cents vs proposed positive MAXSAFE on Net Income independent range
  // -> month blocked in preview and selected apply rejected before writes
  const rtMax = runtime();
  const mfMax = rtMax.sheets.get('MonthlyFinancials');
  // Row 2 (Feb-27) Net Income set to -Number.MAX_SAFE_INTEGER / 100 THB (-MAX_SAFE_INTEGER satang)
  mfMax.getRange(2, 7).setValue(-Number.MAX_SAFE_INTEGER / 100);
  const maxPack = sampleImportPack();
  // Proposed Feb-27 Net Income is positive MAX_SAFE_INTEGER satang
  maxPack.months.find(m => m.month === '2027-02').financials.netIncomeCents = Number.MAX_SAFE_INTEGER;
  const snapMax = snapshotAllNonDiag(rtMax);
  const prevMax = rtMax.ctx.previewMonthlyActualsImport(JSON.stringify(maxPack));
  const febMax = prevMax.months.find(m => m.month === '2027-02');
  assert.equal(febMax.status, 'blocked');
  assert.ok(febMax.conflicts.some(c => c.message.includes('outside the safe-integer range')));
  // Applying blocked month rejects before any writes
  assert.throws(() => rtMax.ctx.applyMonthlyActualsImport(JSON.stringify(maxPack), ['2027-02'], prevMax.previewHash), /blocked/);
  assert.deepEqual(snapshotAllNonDiag(rtMax), snapMax, 'Target state completely untouched after blocked apply rejection');

  // 10. Invalid apply selection
  const prev = rt.ctx.previewMonthlyActualsImport(textValid);
  const snapSel = snapshotAllNonDiag(rt);
  assert.throws(() => rt.ctx.applyMonthlyActualsImport(textValid, [], prev.previewHash), /Select at least one/);
  assert.throws(() => rt.ctx.applyMonthlyActualsImport(textValid, ['2027-01', '2027-01'], prev.previewHash), /Duplicate/);
  assert.throws(() => rt.ctx.applyMonthlyActualsImport(textValid, ['2029-12'], prev.previewHash), /not in the import pack/);
  assert.deepEqual(snapshotAllNonDiag(rt), snapSel, 'State unchanged on invalid selection');

  // 11. Nonempty row with invalid month key in target tab
  const dataBadMonth = fixture();
  dataBadMonth.MonthlyFinancials[1][0] = 'BadMonth';
  const rtBadMonth = runtime(dataBadMonth);
  const snapBM = snapshotAllNonDiag(rtBadMonth);
  assert.throws(() => rtBadMonth.ctx.previewMonthlyActualsImport(textValid), /unrecognized or missing month/);
  assert.deepEqual(snapshotAllNonDiag(rtBadMonth), snapBM, 'State unchanged on unrecognized month in target');

  // 12. Duplicate month keys in destination tab
  const dataDupMonth = fixture();
  dataDupMonth.MonthlyFinancials[1][0] = 'Jan-27';
  dataDupMonth.MonthlyFinancials[3][0] = 'Jan-27';
  const rtDupMonth = runtime(dataDupMonth);
  const snapDM = snapshotAllNonDiag(rtDupMonth);
  assert.throws(() => rtDupMonth.ctx.previewMonthlyActualsImport(textValid), /duplicate month/);
  assert.deepEqual(snapshotAllNonDiag(rtDupMonth), snapDM, 'State unchanged on duplicate month in target');
});

test('monthly import conflicts: raw formula, custom derived formula, disagreeing/empty quarter, duplicate headers fail pre-mutation', () => {
  const pack = sampleImportPack();

  // Raw formula conflict
  const rt1 = runtime();
  rt1.sheets.get('MonthlyFinancials').getRange(2, 2).setFormula('=SUM(A1:A2)');
  const prev1 = rt1.ctx.previewMonthlyActualsImport(JSON.stringify(pack));
  const feb1 = prev1.months.find(m => m.month === '2027-02');
  assert.equal(feb1.status, 'blocked');
  assert.ok(feb1.conflicts.some(c => c.message.includes('raw-input formula')));

  // Blocked month cannot be applied, but applying another valid month succeeds:
  assert.throws(() => rt1.ctx.applyMonthlyActualsImport(JSON.stringify(pack), ['2027-02'], prev1.previewHash), /blocked/);
  const res1 = rt1.ctx.applyMonthlyActualsImport(JSON.stringify(pack), ['2027-03'], prev1.previewHash);
  assert.equal(res1.already, false);

  // Custom formula conflict
  const rt2 = runtime();
  rt2.sheets.get('MonthlyFinancials').getRange(2, 4).setFormula('=B2*0.5');
  const prev2 = rt2.ctx.previewMonthlyActualsImport(JSON.stringify(pack));
  const feb2 = prev2.months.find(m => m.month === '2027-02');
  assert.equal(feb2.status, 'blocked');
  assert.ok(feb2.conflicts.some(c => c.message.includes('custom formula')));

  // Disagreeing quarter literal conflict
  const data3 = fixture();
  data3.MonthlyFinancials[1][7] = 'Q2 2027';
  const rt3 = runtime(data3);
  const prev3 = rt3.ctx.previewMonthlyActualsImport(JSON.stringify(pack));
  const feb3 = prev3.months.find(m => m.month === '2027-02');
  assert.equal(feb3.status, 'blocked');
  assert.ok(feb3.conflicts.some(c => c.message.includes('existing quarter')));

  // Agreeing cached quarter formula is preserved
  const rt4 = runtime();
  rt4.sheets.get('MonthlyFinancials').put(2, 8, { value: 'Q1 2027', formula: '="Q1 2027"', rich: null });
  const prev4 = rt4.ctx.previewMonthlyActualsImport(JSON.stringify(pack));
  assert.ok(!prev4.months.find(m => m.month === '2027-02').conflicts.some(c => c.cell === 'H2'));

  // Lowercase agreeing quarter (q1 2027) normalizes via TPOCore.quarter and is preserved
  rt4.sheets.get('MonthlyFinancials').getRange(2, 8).setValue('q1 2027');
  const prev4d = rt4.ctx.previewMonthlyActualsImport(JSON.stringify(pack));
  assert.ok(!prev4d.months.find(m => m.month === '2027-02').conflicts.some(c => c.cell === 'H2'));
  // Disagreeing cached quarter formula is blocked
  rt4.sheets.get('MonthlyFinancials').put(2, 8, { value: 'Q3 2027', formula: '="Q3 2027"', rich: null });
  const prev4b = rt4.ctx.previewMonthlyActualsImport(JSON.stringify(pack));
  assert.ok(prev4b.months.find(m => m.month === '2027-02').conflicts.some(c => c.cell === 'H2' && c.message.includes('disagrees')));

  // Empty cached quarter formula is blocked
  rt4.sheets.get('MonthlyFinancials').put(2, 8, { value: '', formula: '="Q1 2027"', rich: null });
  const prev4c = rt4.ctx.previewMonthlyActualsImport(JSON.stringify(pack));
  assert.ok(prev4c.months.find(m => m.month === '2027-02').conflicts.some(c => c.cell === 'H2' && c.message.includes('empty or unverified')));
});

test('monthly import rollback in each destination tab restores prior values, formulas and formats, and flush failure releases lock', () => {
  const pack = sampleImportPack();
  const text = JSON.stringify(pack);

  // 1. Failure in 1. Working Capital (planned and written FIRST, because '1. Working Capital' < 'MonthlyFinancials')
  // Earlier writes in 1. Working Capital (row 4 cols 1..2) occur before col 3 fails
  const rt1 = runtime();
  const mf1 = rt1.sheets.get('MonthlyFinancials');
  const wc1 = rt1.sheets.get('1. Working Capital');
  // Set explicit non-General number formats before import to prove format preservation
  wc1.getRange(2, 2, 2, 5).setNumberFormat('#,##0.00');
  mf1.getRange(2, 2, 4, 6).setNumberFormat('#,##0.00');
  const mfSnap1 = snapshotTabRange(mf1, 6, 8);
  const wcSnap1 = snapshotTabRange(wc1, 4, 6);

  const prev1 = rt1.ctx.previewMonthlyActualsImport(text);
  // Injected write failure after earlier writes (col 1 and col 2) in 1. Working Capital
  wc1.failOnce = (r, c) => r === 4 && c === 3;
  assert.throws(() => rt1.ctx.applyMonthlyActualsImport(text, ['2027-03'], prev1.previewHash), /simulated/);

  // Assert exact values, formulas, and formats restored for BOTH destination ranges
  assert.deepEqual(snapshotTabRange(mf1, 6, 8), mfSnap1, 'MonthlyFinancials prior values, formulas, formats restored');
  assert.deepEqual(snapshotTabRange(wc1, 4, 6), wcSnap1, '1. Working Capital prior values, formulas, formats restored');
  assert.ok(rt1.sheets.get('Repair Backup').getLastRow() > 1, 'Repair Backup audit trail preserved');

  // Verify lock release: subsequent valid apply succeeds
  const prev1b = rt1.ctx.previewMonthlyActualsImport(text);
  const res1 = rt1.ctx.applyMonthlyActualsImport(text, ['2027-03'], prev1b.previewHash);
  assert.equal(res1.already, false);

  // 2. Failure in MonthlyFinancials (written SECOND, after all 1. Working Capital writes succeed)
  const rt2 = runtime();
  const mf2 = rt2.sheets.get('MonthlyFinancials');
  const wc2 = rt2.sheets.get('1. Working Capital');
  wc2.getRange(2, 2, 2, 5).setNumberFormat('#,##0.00');
  mf2.getRange(2, 2, 4, 6).setNumberFormat('#,##0.00');
  const mfSnap2 = snapshotTabRange(mf2, 6, 8);
  const wcSnap2 = snapshotTabRange(wc2, 4, 6);

  const prev2 = rt2.ctx.previewMonthlyActualsImport(text);
  // Injected write failure in MonthlyFinancials row 6 col 3 (after all WC writes and after MF col 1 and 2 writes)
  mf2.failOnce = (r, c) => r === 6 && c === 3;
  assert.throws(() => rt2.ctx.applyMonthlyActualsImport(text, ['2027-03'], prev2.previewHash), /simulated/);

  assert.deepEqual(snapshotTabRange(mf2, 6, 8), mfSnap2, 'MonthlyFinancials prior values, formulas, formats restored');
  assert.deepEqual(snapshotTabRange(wc2, 4, 6), wcSnap2, '1. Working Capital prior values, formulas, formats restored');
  assert.ok(rt2.sheets.get('Repair Backup').getLastRow() > 1);

  // Valid apply after failure proves lock release
  const prev2b = rt2.ctx.previewMonthlyActualsImport(text);
  const res2 = rt2.ctx.applyMonthlyActualsImport(text, ['2027-03'], prev2b.previewHash);
  assert.equal(res2.already, false);

  // 3. Post-source-write flush failure: arm existing rt.flushFail ONCE after last successful planned cell write
  const rt3 = runtime();
  const mf3 = rt3.sheets.get('MonthlyFinancials');
  const wc3 = rt3.sheets.get('1. Working Capital');
  wc3.getRange(2, 2, 2, 5).setNumberFormat('#,##0.00');
  mf3.getRange(2, 2, 4, 6).setNumberFormat('#,##0.00');
  const mfSnap3 = snapshotTabRange(mf3, 6, 8);
  const wcSnap3 = snapshotTabRange(wc3, 4, 6);

  const prev3 = rt3.ctx.previewMonthlyActualsImport(text);
  // Narrow test hook: hook mf3.put to arm rt3.flushFail() after the very last planned cell write (r=6, c=7 in MonthlyFinancials)
  const origPut3 = mf3.put.bind(mf3);
  let armed = false;
  mf3.put = function (r, c, data) {
    origPut3(r, c, data);
    if (!armed && r === 6 && c === 7) {
      armed = true;
      rt3.flushFail();
    }
  };

  assert.throws(() => rt3.ctx.applyMonthlyActualsImport(text, ['2027-03'], prev3.previewHash), /flush failure/);

  // Assert rollback restored both destinations' values, formulas, and formats
  assert.deepEqual(snapshotTabRange(mf3, 6, 8), mfSnap3, 'MF values, formulas, formats restored on flush failure');
  assert.deepEqual(snapshotTabRange(wc3, 4, 6), wcSnap3, 'WC values, formulas, formats restored on flush failure');
  assert.ok(rt3.sheets.get('Repair Backup').getLastRow() > 1);

  // Valid apply after failure proves lock release
  const prev3b = rt3.ctx.previewMonthlyActualsImport(text);
  const res3 = rt3.ctx.applyMonthlyActualsImport(text, ['2027-03'], prev3b.previewHash);
  assert.equal(res3.already, false);

  // 4. Rollback restoration failure using existing failOnce + narrow hook:
  // Forward write failure triggers, and during rollback restoration, another failure occurs.
  // Requires ORIGINAL write error and 'Rollback incomplete; restore from Repair Backup' diagnostic evidence, never false success.
  const rt4 = runtime();
  const mf4 = rt4.sheets.get('MonthlyFinancials');
  const wc4 = rt4.sheets.get('1. Working Capital');
  const prev4 = rt4.ctx.previewMonthlyActualsImport(text);
  let rollbackFailed = false;
  const origPut4 = wc4.put.bind(wc4);
  wc4.put = function (r, c, data) {
    if (rollbackFailed && r === 4 && c === 2) {
      throw new Error('simulated rollback restoration failure');
    }
    origPut4(r, c, data);
  };
  wc4.failOnce = (r, c) => {
    if (r === 4 && c === 3) {
      rollbackFailed = true;
      return true;
    }
    return false;
  };

  assert.throws(
    () => rt4.ctx.applyMonthlyActualsImport(text, ['2027-03'], prev4.previewHash),
    err => {
      assert.ok(err.message.includes('simulated Sheets write failure'), 'Error must contain ORIGINAL write error');
      assert.ok(err.message.includes('Rollback incomplete; restore from Repair Backup'), 'Error must report Rollback incomplete diagnostic');
      return true;
    }
  );
  // Ensure Repair Backup audit trail exists
  assert.ok(rt4.sheets.get('Repair Backup').getLastRow() > 1, 'Repair Backup contains rollback recovery evidence');

  // Lock release verified by subsequent locked action
  assert.equal(rt4.ctx.locked_(() => 'unlocked'), 'unlocked');
});

test('monthly import fresh preview identical reimport produces zero writes and no added backup rows, old pre-apply hash rejected', () => {
  const rt = runtime();
  const pack = sampleImportPack();
  const text = JSON.stringify(pack);
  const prev = rt.ctx.previewMonthlyActualsImport(text);
  const oldHash = prev.previewHash;

  const res1 = rt.ctx.applyMonthlyActualsImport(text, ['2027-03'], oldHash);
  assert.equal(res1.already, false);
  const backupRowsAfterApply = rt.sheets.get('Repair Backup').getLastRow();

  // Update cached formula values so next read reads them
  const mf = rt.sheets.get('MonthlyFinancials');
  mf.put(6, 4, { value: 120, formula: mf.getRange(6, 4).getFormulas()[0][0], rich: null });
  mf.put(6, 6, { value: 90, formula: mf.getRange(6, 6).getFormulas()[0][0], rich: null });
  const wc = rt.sheets.get('1. Working Capital');
  wc.put(4, 6, { value: 340, formula: wc.getRange(4, 6).getFormulas()[0][0], rich: null });

  // Pre-apply hash rejected
  assert.throws(() => rt.ctx.applyMonthlyActualsImport(text, ['2027-03'], oldHash), /Monthly inputs changed after preview/);

  // Fresh preview and zero-write apply
  const prev2 = rt.ctx.previewMonthlyActualsImport(text);
  const res2 = rt.ctx.applyMonthlyActualsImport(text, ['2027-03'], prev2.previewHash);
  assert.equal(res2.already, true);
  assert.equal(res2.changes, 0);
  assert.equal(rt.sheets.get('Repair Backup').getLastRow(), backupRowsAfterApply);
});

test('monthly import projected identities match TPOCore.analyze numeric source', () => {
  const rt = runtime();
  const pack = sampleImportPack();
  const prev = rt.ctx.previewMonthlyActualsImport(JSON.stringify(pack));
  rt.ctx.applyMonthlyActualsImport(JSON.stringify(pack), ['2027-03'], prev.previewHash);

  // Supply cached formulas for TPOCore.analyze
  const mf = rt.sheets.get('MonthlyFinancials');
  mf.put(6, 4, { value: 120, formula: mf.getRange(6, 4).getFormulas()[0][0], rich: null });
  mf.put(6, 6, { value: 90, formula: mf.getRange(6, 6).getFormulas()[0][0], rich: null });
  const wc = rt.sheets.get('1. Working Capital');
  wc.put(4, 6, { value: 340, formula: wc.getRange(4, 6).getFormulas()[0][0], rich: null });

  const sources = rt.ctx.readSources_();
  const analyzed = rt.ctx.TPOCore.analyze(sources);
  assert.ok(analyzed);
  assert.equal(analyzed.latest.period.display, 'Mar-27');
  assert.equal(analyzed.latest.gp, 120);
  assert.equal(analyzed.latest.ebit, 90);
  assert.equal(analyzed.wc.find(r => r.period.display === 'Mar-27').nwc, 340);
});

test('monthly import blank Quarter with unchanged amounts produces zero writes and remains blank', () => {
  const data = fixture();
  data.MonthlyFinancials[1] = ['Feb-27', 200, 120, 80, 20, 60, 40, ''];
  data['1. Working Capital'][2] = ['Feb-27', 200, 50, 20, 40, 230];
  const rt = runtime(data);
  const mf = rt.sheets.get('MonthlyFinancials');
  mf.put(2, 4, { value: 80, formula: '=IF(COUNT(B2,C2)=2,B2-C2,"")', rich: null });
  mf.put(2, 6, { value: 60, formula: '=IF(COUNT(D2,E2)=2,D2-E2,"")', rich: null });
  const wc = rt.sheets.get('1. Working Capital');
  wc.put(3, 6, { value: 230, formula: '=IF(COUNT(B3,C3,D3,E3)=4,B3+C3+D3-E3,"")', rich: null });

  const pack = sampleImportPack();
  const text = JSON.stringify(pack);
  const prev = rt.ctx.previewMonthlyActualsImport(text);
  const feb = prev.months.find(m => m.month === '2027-02');
  assert.equal(feb.status, 'unchanged');
  assert.equal(feb.changes.length, 0);

  const res = rt.ctx.applyMonthlyActualsImport(text, ['2027-02'], prev.previewHash);
  assert.equal(res.already, true);
  assert.equal(res.changes, 0);
  assert.equal(mf.getRange(2, 8).getDisplayValue(), '');
});

test('monthly import blank Quarter is populated when another disclosed change writes month', () => {
  const data = fixture();
  // Feb-27 in MonthlyFinancials has blank Quarter
  data.MonthlyFinancials[1] = ['Feb-27', 200, 120, 80, 20, 60, 40, ''];
  data['1. Working Capital'][2] = ['Feb-27', 200, 50, 20, 40, 230];
  const rt = runtime(data);
  const mf = rt.sheets.get('MonthlyFinancials');
  mf.put(2, 4, { value: 80, formula: '=IF(COUNT(B2,C2)=2,B2-C2,"")', rich: null });
  mf.put(2, 6, { value: 60, formula: '=IF(COUNT(D2,E2)=2,D2-E2,"")', rich: null });
  const wc = rt.sheets.get('1. Working Capital');
  wc.put(3, 6, { value: 230, formula: '=IF(COUNT(B3,C3,D3,E3)=4,B3+C3+D3-E3,"")', rich: null });

  // Pack has revised Revenue (20100 cents = 201.00 THB vs 200.00) -> disclosed change!
  const pack = sampleImportPack([
    {
      month: '2027-02',
      financials: { revenueCents: 20100, cogsCents: 12000, sgaCents: 2000, netIncomeCents: 4000 },
      workingCapital: { cashCents: 20000, arCents: 5000, inventoryCents: 2000, apCents: 4000 },
      checks: { grossProfitCents: 8100, ebitCents: 6100 },
      sourceRefs: {
        revenueCents: ['PL!S15'], cogsCents: ['PL!S63'], sgaCents: ['PL!S170'], netIncomeCents: ['PL!S197'],
        cashCents: ['BS!E5', 'BS!E6', 'BS!E7', 'BS!E8'], arCents: ['BS!E9'],
        inventoryCents: ['BS!E12', 'BS!E13', 'BS!E14'],
        apCents: ['BS!E48', 'BS!E49', 'BS!E50', 'BS!E51', 'BS!E52', 'BS!E55', 'BS!E56', 'BS!E57', 'BS!E58', 'BS!E59', 'BS!E60', 'BS!E61', 'BS!E62', 'BS!E63', 'BS!E64', 'BS!E65', 'BS!E66']
      }
    }
  ]);
  const text = JSON.stringify(pack);
  const prev = rt.ctx.previewMonthlyActualsImport(text);
  const feb = prev.months.find(m => m.month === '2027-02');
  assert.equal(feb.status, 'changed');
  assert.ok(feb.changes.length > 0);
  // Quarter is not in changes array (no monetary pseudochange)
  assert.ok(!feb.changes.some(c => c.field === 'quarter' || c.field === 'quarterCents'));

  const res = rt.ctx.applyMonthlyActualsImport(text, ['2027-02'], prev.previewHash);
  assert.equal(res.already, false);
  // Disclosed revenue change caused month write, populating previously blank quarter
  assert.equal(mf.getRange(2, 8).getDisplayValue(), 'Q1 2027');
  assert.equal(mf.getRange(2, 2).getValues()[0][0], 201);
});

test('monthly import semantically agreeing lowercase quarter literal and formula cached values preserve exact content', () => {
  const data = fixture();
  // Row 2: Feb-27 with lowercase quarter literal 'q1 2027'
  data.MonthlyFinancials[1] = ['Feb-27', 200, 120, 80, 20, 60, 40, 'q1 2027'];
  data['1. Working Capital'][2] = ['Feb-27', 200, 50, 20, 40, 230];
  const rt = runtime(data);
  const mf = rt.sheets.get('MonthlyFinancials');
  mf.put(2, 4, { value: 80, formula: '=IF(COUNT(B2,C2)=2,B2-C2,"")', rich: null });
  mf.put(2, 6, { value: 60, formula: '=IF(COUNT(D2,E2)=2,D2-E2,"")', rich: null });
  // Row 4: Jan-27 with agreeing quarter formula and cached 'q1 2027'
  mf.put(4, 8, { value: 'q1 2027', formula: '="Q1 2027"', rich: null });
  mf.put(4, 4, { value: 40, formula: '=IF(COUNT(B4,C4)=2,B4-C4,"")', rich: null });
  mf.put(4, 6, { value: 30, formula: '=IF(COUNT(D4,E4)=2,D4-E4,"")', rich: null });
  const wc = rt.sheets.get('1. Working Capital');
  wc.put(3, 6, { value: 230, formula: '=IF(COUNT(B3,C3,D3,E3)=4,B3+C3+D3-E3,"")', rich: null });

  const pack = sampleImportPack([
    {
      month: '2027-01',
      financials: { revenueCents: 10100, cogsCents: 6000, sgaCents: 1000, netIncomeCents: 2000 },
      workingCapital: { cashCents: 10000, arCents: 4000, inventoryCents: 1000, apCents: 3000 },
      checks: { grossProfitCents: 4100, ebitCents: 3100 },
      sourceRefs: {
        revenueCents: ['PL!R15'], cogsCents: ['PL!R63'], sgaCents: ['PL!R170'], netIncomeCents: ['PL!R197'],
        cashCents: ['BS!D5', 'BS!D6', 'BS!D7', 'BS!D8'], arCents: ['BS!D9'],
        inventoryCents: ['BS!D12', 'BS!D13', 'BS!D14'],
        apCents: ['BS!D48', 'BS!D49', 'BS!D50', 'BS!D51', 'BS!D52', 'BS!D55', 'BS!D56', 'BS!D57', 'BS!D58', 'BS!D59', 'BS!D60', 'BS!D61', 'BS!D62', 'BS!D63', 'BS!D64', 'BS!D65', 'BS!D66']
      }
    },
    {
      month: '2027-02',
      financials: { revenueCents: 20100, cogsCents: 12000, sgaCents: 2000, netIncomeCents: 4000 },
      workingCapital: { cashCents: 20000, arCents: 5000, inventoryCents: 2000, apCents: 4000 },
      checks: { grossProfitCents: 8100, ebitCents: 6100 },
      sourceRefs: {
        revenueCents: ['PL!S15'], cogsCents: ['PL!S63'], sgaCents: ['PL!S170'], netIncomeCents: ['PL!S197'],
        cashCents: ['BS!E5', 'BS!E6', 'BS!E7', 'BS!E8'], arCents: ['BS!E9'],
        inventoryCents: ['BS!E12', 'BS!E13', 'BS!E14'],
        apCents: ['BS!E48', 'BS!E49', 'BS!E50', 'BS!E51', 'BS!E52', 'BS!E55', 'BS!E56', 'BS!E57', 'BS!E58', 'BS!E59', 'BS!E60', 'BS!E61', 'BS!E62', 'BS!E63', 'BS!E64', 'BS!E65', 'BS!E66']
      }
    }
  ]);
  const text = JSON.stringify(pack);
  const prev = rt.ctx.previewMonthlyActualsImport(text);
  assert.ok(!prev.months[0].conflicts.length);
  assert.ok(!prev.months[1].conflicts.length);
  // No monetary pseudochange for quarter metadata
  assert.ok(!prev.months[0].changes.some(c => c.field === 'quarter'));
  assert.ok(!prev.months[1].changes.some(c => c.field === 'quarter'));

  const res = rt.ctx.applyMonthlyActualsImport(text, ['2027-01', '2027-02'], prev.previewHash);
  assert.equal(res.already, false);

  // Feb-27: Lowercase literal 'q1 2027' was preserved exact, not rewritten to 'Q1 2027'
  assert.equal(mf.getRange(2, 8).getDisplayValue(), 'q1 2027');
  assert.equal(mf.getRange(2, 8).getFormulas()[0][0], '');

  // Jan-27: Formula and cached value were preserved
  assert.equal(mf.getRange(4, 8).getFormulas()[0][0], '="Q1 2027"');
  assert.equal(mf.getRange(4, 8).getDisplayValue(), 'q1 2027');

  // Disagreeing cached quarter formula is blocked in preview
  mf.put(2, 8, { value: 'Q3 2027', formula: '="Q3 2027"', rich: null });
  const prevDisagree = rt.ctx.previewMonthlyActualsImport(text);
  assert.ok(prevDisagree.months.find(m => m.month === '2027-02').conflicts.some(c => c.cell === 'H2' && c.message.includes('disagrees')));

  // Empty cached quarter formula is blocked in preview
  mf.put(2, 8, { value: '', formula: '="Q1 2027"', rich: null });
  const prevEmpty = rt.ctx.previewMonthlyActualsImport(text);
  assert.ok(prevEmpty.months.find(m => m.month === '2027-02').conflicts.some(c => c.cell === 'H2' && c.message.includes('empty or unverified')));
});

function sampleSalesPack(months = null) {
  const mList = months || [
    { month: '2027-01', revenueCents: { acme: 10000, beta: 2500 }, count: 10,
      overallCents: 12500, reconciled: true },
    { month: '2027-02', revenueCents: { acme: 15000, beta: 3500 }, count: 15,
      overallCents: 18500, reconciled: true },
    { month: '2027-03', revenueCents: { acme: 30000, beta: 5000 }, count: null,
      overallCents: 35000, reconciled: true }
  ];
  return {
    schema: 'tpo-sales-actuals-v1',
    source: {
      filename: 'TPO Sep 2026 Sales Data for Presentation.xlsx',
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      reportMonth: mList[mList.length - 1].month
    },
    customers: [
      { key: 'acme', sheet: 'Acme', label: 'Acme Corporation', name: 'Acme Corp', sourceRef: 'Acme!A2:B30' },
      { key: 'beta', sheet: 'Beta', label: 'Beta', name: 'Beta', sourceRef: 'Beta!A2:B30' }
    ],
    months: mList
  };
}

test('sales import pack validation rejects malformed packs before any read', () => {
  const rt = runtime();
  const bad = (mutate, pattern) => {
    const pack = sampleSalesPack();
    mutate(pack);
    assert.throws(() => rt.ctx.previewSalesActualsImport(JSON.stringify(pack)), pattern);
  };
  bad(p => { p.schema = 'other'; }, /Unsupported pack schema/);
  bad(p => { p.extra = 1; }, /exactly schema, source, customers and months/);
  bad(p => { p.months[0].revenueCents.ghost = 100; }, /unknown customer key/);
  bad(p => { p.months[1].revenueCents.acme += 5000; }, /reconciled/);
  bad(p => { p.months.splice(1, 1); }, /contiguous/);
  bad(p => { p.months[2].month = '2027-05'; }, /contiguous/);
  bad(p => { p.customers.push({ key: 'x', sheet: 'S', label: 'L', name: 'Acme Corp', sourceRef: 'S!A:B' }); }, /Duplicate pack customer name/);
  bad(p => { p.months[0].count = 1.5; }, /count must be null or a nonnegative integer/);
});

test('sales import preview discloses differences and leaves every sheet untouched', () => {
  const rt = runtime();
  const text = JSON.stringify(sampleSalesPack());
  const snap = snapshotAllNonDiag(rt);
  const prev = rt.ctx.previewSalesActualsImport(text);
  assert.equal(prev.source.reportMonth, '2027-03');
  const byMonth = new Map(prev.months.map(m => [m.month, m]));
  assert.equal(byMonth.get('2027-01').status, 'unchanged');
  const february = byMonth.get('2027-02');
  assert.equal(february.status, 'changed');
  assert.deepEqual(Array.from(february.changes, c => [c.sheet, c.cell, c.field, c.previousCents, c.proposedCents]),
    [['CustomerRevenueMonthly', 'C3', 'Acme Corp revenue', 14000, 15000]]);
  const march = byMonth.get('2027-03');
  assert.equal(march.status, 'changed');
  assert.equal(march.changes.length, 2);
  assert.ok(march.changes.every(c => c.cell === 'New row'));
  assert.equal(march.defaultSelected, true);
  assert.equal(february.historical, true);
  assert.equal(march.historical, false);
  assert.deepEqual({ ...prev.summary }, { revenueChanges: 1, countChanges: 0, newValues: 2,
    historicalMonths: 1, unchanged: 1 });
  assert.deepEqual(snapshotAllNonDiag(rt), snap, 'Preview must not mutate any sheet');
});

test('sales import apply writes revenue and counts with backup and chronological appends', () => {
  const rt = runtime();
  const text = JSON.stringify(sampleSalesPack());
  const prev = rt.ctx.previewSalesActualsImport(text);
  const result = rt.ctx.applySalesActualsImport(text, ['2027-02', '2027-03'], prev.previewHash);
  assert.equal(result.already, false);
  assert.deepEqual(Array.from(result.months), ['2027-02', '2027-03']);
  const crm = rt.sheets.get('CustomerRevenueMonthly');
  const rows = crm.getDataRange().getValues();
  assert.equal(rows[2][2], 150); // Feb Acme revised
  assert.deepEqual([rows[5][0], rows[5][1], rows[5][2]], ['Acme Corp', 'Mar-27', 300]);
  assert.deepEqual([rows[6][0], rows[6][1], rows[6][2]], ['Beta', 'Mar-27', 50]);
  const backup = rt.sheets.get('Repair Backup');
  const backupText = JSON.stringify(backup.getDataRange().getValues());
  assert.match(backupText, /Import sales actuals/);
  assert.match(backupText, /CustomerRevenueMonthly/);
  assert.match(backupText, /Acme Corp/);
  // Re-preview after apply: nothing left to change
  const after = rt.ctx.previewSalesActualsImport(text);
  assert.ok(after.months.every(m => m.status === 'unchanged'));
});

test('sales import blocks unreconciled months and destination formulas', () => {
  const rt = runtime();
  const pack = sampleSalesPack();
  pack.months[0].reconciled = false; // Jan: five-customer total no longer matches Overall
  const text = JSON.stringify(pack);
  const prev = rt.ctx.previewSalesActualsImport(text);
  const january = prev.months.find(m => m.month === '2027-01');
  assert.equal(january.status, 'blocked');
  assert.ok(january.conflicts.some(c => c.message.includes('disagrees with the overall')));
  assert.throws(() => rt.ctx.applySalesActualsImport(text, ['2027-01'], prev.previewHash), /is blocked/);

  const rt2 = runtime();
  rt2.sheets.get('CustomerRevenueMonthly').put(3, 3, { value: 140, formula: '=140', rich: null });
  const prev2 = rt2.ctx.previewSalesActualsImport(JSON.stringify(sampleSalesPack()));
  assert.equal(prev2.months.find(m => m.month === '2027-02').status, 'blocked');
  assert.ok(prev2.months.find(m => m.month === '2027-02').conflicts.some(c => c.cell === 'C3' && c.message.includes('formula')));
});

test('sales import rejects unknown customers and stale previews', () => {
  const rt = runtime();
  const ghost = sampleSalesPack();
  ghost.customers[1] = { key: 'beta', sheet: 'Ghost', label: 'Ghost label', name: 'Ghost Customer', sourceRef: 'Ghost!A2:B30' };
  assert.throws(() => rt.ctx.previewSalesActualsImport(JSON.stringify(ghost)), /does not match any customer/);

  const text = JSON.stringify(sampleSalesPack());
  const prev = rt.ctx.previewSalesActualsImport(text);
  rt.sheets.get('CustomerRevenueMonthly').getRange(2, 3).setValue(999);
  assert.throws(() => rt.ctx.applySalesActualsImport(text, ['2027-02'], prev.previewHash), /changed after preview/);
});

test('sales import dialog script compiles', () => {
  const rt = runtime();
  rt.ctx.menuImportSalesActuals();
  new vm.Script(rt.getHtml().match(/<script>([\s\S]*)<\/script>/)[1]);
  assert.match(rt.getHtml(), /Import sales data/);
});
