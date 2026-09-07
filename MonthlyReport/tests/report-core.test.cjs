const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../js/report-core');
const headers=['Month','Total Revenue','COGS','Gross Profit','SG&A','EBIT','Net Income','Quarter'];
const row=(month,n=100)=>[month,n,n*.2,n*.8,n*.3,n*.5,n*.4,C.month(month).quarter];
const source=raw=>[{name:'MonthlyFinancials',raw}];
test('actual dates, serial dates and month names normalize to the same period',()=>{
  const serial=(Date.UTC(2026,6,27)-Date.UTC(1899,11,30))/86400000;
  for(const v of ['Jul-26','July-26','27-Jul-26','2026-07-27T00:00:00',new Date('2026-07-27Z'),serial])assert.equal(C.month(v).label,'2026-07');
  assert.equal(C.month('07/08/26'),null);assert.equal(C.month('2026-13'),null);
});
test('future placeholders do not advance as-of; explicit zero does',()=>{
  const rows=[headers,row('Jul-26'),['Aug-27','','','','','','','Q3 2027'],['Sep-27','','','','','','','Q3 2027']];
  assert.equal(C.analyze(source(rows)).latest.month,'Jul-26');
  rows.push(row('Oct-27',0));assert.equal(C.analyze(source(rows)).latest.month,'Oct-27');
});
test('header lookup permits reordering, fails closed on missing metrics',()=>{
  const rows=[headers,row('Jul-26')].map(r=>[r[7],r[0],...r.slice(1,7)]);
  assert.equal(C.analyze(source(rows)).latest.revenue,100);
  rows[0][2]='Unknown';const a=C.analyze(source(rows));assert.equal(a.latest,null);assert.ok(a.issues.some(i=>i.level==='error'&&i.cell==='1:1'));
});
test('duplicates quarantine both rows, invalid numbers never partially parse',()=>{
  const a=C.analyze(source([headers,row('Jul-26'),row('Jul-26',200),row('Jun-26')]));
  assert.equal(a.monthly.length,1);assert.ok(a.issues.some(i=>i.message.includes('rows 2, 3')));
  for(const s of ['100oops','1,23','50 baht','#REF!'])assert.equal(C.number(s),null);
  assert.equal(C.number('฿2,691,940.00 '),2691940);assert.equal(C.number('(1,000.50)'),-1000.5);assert.equal(C.number('65%'),.65);
});
test('missing GP propagates into quarterly totals; rounding tolerance allows one baht',()=>{
  const r=row('Jul-26');r[3]='';const a=C.analyze(source([headers,r]));assert.equal(a.quarterly[0].gp,null);
  r[3]=81;assert.equal(C.analyze(source([headers,r])).monthly[0].gp,81);
  r[3]=90;assert.equal(C.analyze(source([headers,r])).monthly[0].gp,null);
});
test('NWC cannot use formula total when inventory and AP are blank',()=>{
  const s={name:'1. Working Capital',raw:[['Reporting Month','Cash Balance','Accounts Receivable','Inventory Value','Accounts Payable','Net Working Capital'],['July-26',100,40,'','',140]]};
  assert.equal(C.analyze([s]).wc[0].nwc,null);s.raw[1][3]=0;s.raw[1][4]=0;assert.equal(C.analyze([s]).wc[0].nwc,140);
});
test('matched months, not full prior quarter, are compared',()=>{
  const a=C.analyze(source([headers,row('Jul-25',10),row('Aug-25',20),row('Sep-25',30),row('Jul-26',40)]));
  assert.equal(a.forward[0].revenue,10);assert.equal(a.forward[1].revenue,40);assert.equal(a.quarterly.at(-1).complete,false);
});
test('pending expense-only months wait for revenue and risk follows matched EBIT',()=>{
  const pending=['Aug-26','',20,'',30,'','','Q3 2026'];
  const a=C.analyze(source([headers,row('Jul-25'),row('Jul-26'),pending]));
  assert.equal(a.latest.month,'Jul-26');assert.equal(a.monthly.length,2);
  assert.equal(C.riskStatus(-10,-100).level,'high');
  assert.equal(C.riskStatus(100,50).level,'low');
  assert.equal(C.riskStatus(50,100).level,'moderate');
  assert.equal(C.riskStatus(0,0).status,'Stable / Monitor');
  assert.equal(C.riskStatus(null,100).level,'unknown');
});
test('model rejects invalid primary inputs and retains actual zero',()=>{
  const a=C.analyze(source([headers,row('Jul-26',0)]));
  const matrix=new Map(C.modelRows(a));assert.equal(matrix.get('quarter|Q3 2026|revenue'),0);
  assert.equal(matrix.get('meta|latest-month'),'Jul-26');
  assert.throws(()=>C.modelRows(C.analyze(source([headers,row('Jul-26'),row('Jul-26')]))),/Duplicate/);
});
test('dashboard cross-check tolerates serialization rounding while detecting wrong figures',()=>{
  const data=source([headers,row('Jul-26')]).concat([
    {name:'CustomerCount',raw:[['Month','Customer Count'],['Jul-26',3]]},
    {name:'3. Strategic Dashboard',raw:[['Strategic Metric','Q3 2026'],['Revenue per Customer',33.33333333]]}
  ]);
  assert.ok(!C.analyze(data).issues.some(i=>i.sheet==='3. Strategic Dashboard'));
  data.at(-1).raw[1][1]=34;assert.ok(C.analyze(data).issues.some(i=>i.sheet==='3. Strategic Dashboard'));
});
test('audit-log error strings do not contaminate current data validation',()=>{
  const data=source([headers,row('Jul-26')]).concat([{name:'Repair Backup',raw:[['Old value'],['#VALUE!']]}]);
  assert.ok(!C.analyze(data).issues.some(i=>i.sheet==='Repair Backup'));
});
test('Apps Script and website share identical core source',()=>{
  assert.equal(fs.readFileSync('js/report-core.js','utf8'),fs.readFileSync('js/report-core.js','utf8'));
  assert.ok(fs.readFileSync('apps-script/Code.gs','utf8').startsWith(fs.readFileSync('js/report-core.js','utf8')));
});
test('website shaper preserves unavailable NWC and ignores future rows',()=>{
  const window={TPOCore:C};const ctx=vm.createContext({window,AbortController,URL,console,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync('js/data.js','utf8'),ctx);vm.runInContext(fs.readFileSync('js/compute.js','utf8'),ctx);
  const data=window.TPO_DATA.shape({MonthlyFinancials:[headers,row('Jul-26'),['Aug-27']],Assumptions:[['Customer','Margin'],['Mana',.7]],'1. Working Capital':[['Reporting Month','Cash Balance','Accounts Receivable','Inventory Value','Accounts Payable','Net Working Capital'],['Jul-26',100,50,'','',150]]});
  assert.equal(data.monthly.at(-1).month,'Jul-26');assert.equal(window.TPO_COMPUTE.nwcSeries(data.workingCapital)[0].nwc,null);
});

