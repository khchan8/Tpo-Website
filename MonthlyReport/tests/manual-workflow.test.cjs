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
  constructor(name, values = [], cols = 26) {
    this.name = name; this.maxRows = Math.max(100, values.length); this.maxCols = Math.max(cols, ...values.map(r => r.length));
    this.cells = new Map(); this.writes = []; this.failOnce = null;
    values.forEach((row, r) => row.forEach((v, c) => this.cells.set(`${r + 1},${c + 1}`, { value: v, formula: '', rich: null })));
  }
  cell(r, c) { return this.cells.get(`${r},${c}`) || { value: '', formula: '', rich: null }; }
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
  setNumberFormat() { return this; }
  getNumberFormat() { return 'General'; }
  getNumberFormats() { return this.map(()=>'General'); }
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
    CustomerRevenueMonthly: [['Customer', 'Month', 'Revenue'], ['Acme Corp', 'Feb-27', 150], ['Beta', 'Feb-27', 50]],
    CustomerRevenueQuarterly: [['Customer', 'Quarter', 'Revenue'], ['Acme Corp', 'Q1 2027', 240], ['Beta', 'Q1 2027', 60], ['Acme Corp', 'Q2 2027', '']],
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
  const sheets = new Map(Object.entries(data).map(([name, rows]) => [name, new Sheet(name, rows, name === 'Commentary' ? 3 : 26)]));
  const properties = new Map(); let html = ''; let locked = false; let flushFail = false;
  const ss = {
    getSheetByName: n => sheets.get(n) || null,
    insertSheet: n => { const sh = new Sheet(n); sheets.set(n, sh); return sh; },
    getSpreadsheetTimeZone: () => 'Asia/Bangkok', setActiveSheet: sh => sh
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
      setProperties: values => Object.entries(values).forEach(([k, v]) => { assert.ok(Buffer.byteLength(v) < 9000); properties.set(k, v); }),
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
  return { ctx, sheets, ss, properties, getHtml: () => html, flushFail: () => { flushFail = true; } };
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
  assert.equal(overview.customerMix.customers[0].sharePercent, 75);
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
  rt.ctx.savePastedLLMOutput(text, response.batch_id);
  assert.equal(rt.ctx.readOutput_(rt.ctx.readState_()), text);
  rt.ctx.import_();
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
test('adding a customer preserves the three-column schema and seeds chronological quarter rows', () => {
  const rt = runtime(); rt.ctx.prepare_();
  rt.ctx.processAddCustomer({ name: 'New Customer', margin: '25%', seed: true });
  const sh = rt.sheets.get('Assumptions'); assert.equal(sh.getRange(sh.getLastRow(), 2).getValues()[0][0], .25);
  assert.equal(rt.sheets.get('Commentary').getMaxColumns(), 3);
  const rows = rt.sheets.get('CustomerRevenueQuarterly').getDataRange().getValues().filter(r => r[0] === 'New Customer');
  assert.deepEqual(rows.map(r => r[1]), ['Q1 2027', 'Q2 2027']);
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
  rt.ctx.menuPasteLLMOutput(); new vm.Script(rt.getHtml().match(/<script>([\s\S]*)<\/script>/)[1]);
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
  assert.throws(()=>rt.ctx.backupAndWrite_([{sheet:sh.name,row:2,col:3,value:1},{sheet:sh.name,row:3,col:3,value:2}],'Test'),/simulated/);
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
  const get=()=>new Map(rt.ctx.TPO_REPORT_MODEL(data.MonthlyFinancials,data.Assumptions,data.CustomerRevenueMonthly,data.CustomerRevenueQuarterly,data.CustomerCount,data['1. Working Capital'],inputs,'May–October','count at first month of the quarter','THB','Asia/Bangkok'));
  let model=get();assert.equal(model.get('quarter|Q1 2027|revenue'),300);
  assert.equal(model.get('dashboard|Q1 2027|activecustomers'),10);
  assert.equal(model.get('dashboard|Q1 2027|customerretentionrate'),.8);
  assert.equal(model.get('customer|Q1 2027|acme corp|gp'),108);
  data.Assumptions[1][1]=.5;data.CustomerCount[1][1]=20;
  model=get();assert.equal(model.get('customer|Q1 2027|acme corp|gp'),120);
  assert.equal(model.get('dashboard|Q1 2027|revenuepercustomer'),15);
  assert.equal(model.get('dashboard|Q1 2027|cashbalance'),''); // no quarter-end balance
  assert.ok(!model.has('quarter|Q2 2027|revenue')); // blank future ledger slot
});
test('monthly scaffolding reuses placeholders, leaves raw inputs blank, and uses keyed formulas',()=>{
  const rt=runtime(),sources=rt.ctx.readSources_(),a=rt.ctx.TPOCore.analyze(sources),next=rt.ctx.TPOCore.month('Mar-27');
  const plan=rt.ctx.repairPlan_(sources,a,next);
  assert.ok(!plan.some(p=>p.sheet==='MonthlyFinancials'&&p.col===1)); // already present
  assert.match(plan.find(p=>p.sheet==='MonthlyFinancials'&&p.row===6&&p.col===4).value,/COUNT\(B6,C6\)=2/);
  assert.ok(!plan.some(p=>p.sheet==='MonthlyFinancials'&&[2,3,5,7].includes(p.col)));
  assert.equal(plan.filter(p=>p.sheet==='CustomerRevenueMonthly'&&p.value==='Mar-27').length,2);
  assert.ok(plan.filter(p=>p.sheet==='CustomerRevenueMonthly'&&p.value==='Mar-27').every(p=>p.text));
  assert.ok(plan.some(p=>p.sheet==='Dashboard Inputs'&&p.value===300)); // preserve manual metric
  const anchor=plan.find(p=>p.sheet==='Report Model').value;
  for(const forbidden of ['Quarterly Financials','2. Customer Economics','3. Strategic Dashboard','4. Forward-Looking Risk'])assert.ok(!anchor.includes("'"+forbidden+"'!"));
  const qFormula=plan.find(p=>p.sheet==='Quarterly Financials'&&p.col===2).value;
  assert.match(qFormula,/MATCH\(/);assert.match(qFormula,/A2/);assert.ok(!qFormula.includes('Q1 2027'));
});
test('quarter and year rollover append missing sections without copying past totals',()=>{
  for(const [from,next,quarter] of [['Sep-27','Oct-27','Q4 2027'],['Dec-27','Jan-28','Q1 2028']]){
    const data=fixture();data.MonthlyFinancials.push([from,0,0,0,0,0,0,require('../js/report-core').month(from).quarter]);
    const rt=runtime(data),sources=rt.ctx.readSources_(),a=rt.ctx.TPOCore.analyze(sources),plan=rt.ctx.repairPlan_(sources,a,rt.ctx.TPOCore.month(next));
    for(const name of ['MonthlyFinancials','CustomerCount','1. Working Capital'])assert.ok(plan.some(p=>p.sheet===name&&p.value===next&&p.text));
    for(const name of ['Quarterly Financials','CustomerRevenueQuarterly','2. Customer Economics','3. Strategic Dashboard'])assert.ok(plan.some(p=>p.sheet===name&&p.value===quarter));
    assert.ok(!plan.some(p=>p.sheet==='CustomerRevenueQuarterly'&&p.col===3&&p.value!==''));
  }
});
test('repair planning is idempotent and blocks duplicate empty slots',()=>{
  const rt=runtime(),sources=rt.ctx.readSources_(),a=rt.ctx.TPOCore.analyze(sources),next=rt.ctx.TPOCore.month('Mar-27'),plan=rt.ctx.repairPlan_(sources,a,next);
  plan.forEach(p=>{let sh=rt.sheets.get(p.sheet);if(!sh){sh=rt.ss.insertSheet(p.sheet);}rt.ctx.ensureSize_(sh,p.row,p.col);const r=sh.getRange(p.row,p.col);p.formula?r.setFormula(p.value):r.setValue(p.value);});
  const second=rt.ctx.repairPlan_(rt.ctx.readSources_(),a,next);
  assert.equal(second.filter(p=>p.sheet!=='Report Model').length,0);
  const sh=rt.sheets.get('MonthlyFinancials');sh.getRange(sh.getLastRow()+1,1).setValue('Mar-27');
  assert.throws(()=>rt.ctx.repairPlan_(rt.ctx.readSources_(),a,next),/duplicate slot/);
});
test('range-fed model respects Bangkok month boundary for real dates',()=>{
  const data=fixture(),rt=runtime();data.MonthlyFinancials.push([new Date('2027-03-31T18:00:00Z'),0,0,0,0,0,0,'Q2 2027']);
  const model=new Map(rt.ctx.TPO_REPORT_MODEL(data.MonthlyFinancials,data.Assumptions,data.CustomerRevenueMonthly,data.CustomerRevenueQuarterly,data.CustomerCount,data['1. Working Capital'],[['Quarter','Metric','Value']],'May–October','','THB','Asia/Bangkok'));
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
  const model=new Map(rt.ctx.TPO_REPORT_MODEL(data.MonthlyFinancials,data.Assumptions,data.CustomerRevenueMonthly,data.CustomerRevenueQuarterly,data.CustomerCount,data['1. Working Capital'],[['Quarter','Metric','Value']],'May–October','','THB','Asia/Bangkok',JSON.stringify(settings)));
  assert.equal(model.get('quarter|Q1 2027|revenue'),100);assert.equal(model.get('meta|latest-month'),'Jan-27');assert.ok(!model.has('customer|Q1 2027|acme corp|revenue'));
});
test('shared settings dialog scripts compile and unrelated sheet contents are protected',()=>{
  const rt=runtime();rt.ctx.menuReportSettings();const html=rt.getHtml();assert.match(html,/Shared report settings/);for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new vm.Script(m[1]));
  rt.sheets.get('Report Settings').getRange(1,1).setValue('Other content');assert.throws(()=>rt.ctx.ensureReportSettings_(),/expected/);
});
module.exports = { runtime, fixture, sampleResponse };
