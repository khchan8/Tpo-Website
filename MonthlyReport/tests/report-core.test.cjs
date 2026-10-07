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
test('website shaper preserves unavailable NWC and ignores future rows',()=>{
  const window={TPOCore:C};const ctx=vm.createContext({window,AbortController,URL,console,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync('js/data.js','utf8'),ctx);vm.runInContext(fs.readFileSync('js/compute.js','utf8'),ctx);
  const data=window.TPO_DATA.shape({MonthlyFinancials:[headers,row('Jul-26'),['Aug-27']],Assumptions:[['Customer','Margin'],['Mana',.7]],'1. Working Capital':[['Reporting Month','Cash Balance','Accounts Receivable','Inventory Value','Accounts Payable','Net Working Capital'],['Jul-26',100,50,'','',150]]});
  assert.equal(data.monthly.at(-1).month,'Jul-26');assert.equal(window.TPO_COMPUTE.nwcSeries(data.workingCapital)[0].nwc,null);
});


test('dashboard uses dated current-month cash and calculated period inventory turns, never manual ratios',()=>{
  const wcHeader=['Reporting Month','Cash Balance','Accounts Receivable','Inventory Value','Accounts Payable','Net Working Capital'];
  const s=source([headers,...['Apr-26','May-26','Jun-26','Jul-26','Aug-26'].map(m=>row(m))]).concat([
    {name:'1. Working Capital',raw:[wcHeader,['Mar-26',50,0,100,0,150],['Jun-26',90,0,200,0,290],['Jul-26',100,0,210,0,310],['Aug-26',120,0,300,0,420],['Sep-26',999,0,900,0,1899]]},
    {name:'Dashboard Inputs',raw:[['Quarter','Metric','Value'],['Q2 2026','Inventory Turns',1.8],['Q3 2026','Inventory Turns',9]]}
  ]);
  const model=new Map(C.modelRows(C.analyze(s)));
  assert.equal(model.get('dashboard|Q2 2026|cashbalance'),90);
  assert.equal(model.get('dashboard|Q2 2026|cashbalanceasof'),'Jun-26');
  assert.equal(model.get('dashboard|Q3 2026|cashbalance'),120);
  assert.equal(model.get('dashboard|Q3 2026|cashbalanceasof'),'Aug-26');
  assert.equal(model.get('dashboard|Q2 2026|inventoryturns'),60/150);
  assert.equal(model.get('dashboard|Q3 2026|inventoryturns'),40/250);
  s[1].raw[1][3]='';
  assert.equal(new Map(C.modelRows(C.analyze(s))).get('dashboard|Q2 2026|inventoryturns'),'');
});

test('inventory turns require contiguous COGS months and exact opening/closing stocks; cash never carries forward',()=>{
  const wcHeader=['Reporting Month','Cash Balance','Accounts Receivable','Inventory Value','Accounts Payable','Net Working Capital'];
  const stocks=[wcHeader,['Jun-26',100,0,100,0,200],['Jul-26',120,0,100,0,220],['Aug-26','',0,100,0,''],['Sep-26',150,0,100,0,250]];
  const sources=source([headers,row('Jul-26'),row('Aug-26')]).concat([{name:'1. Working Capital',raw:stocks}]);
  let model=new Map(C.modelRows(C.analyze(sources)));
  assert.equal(model.get('dashboard|Q3 2026|cashbalance'),'');
  assert.equal(model.get('dashboard|Q3 2026|cashbalanceasof'),'');
  assert.equal(model.get('dashboard|Q3 2026|inventoryturns'),.4);
  sources[0].raw=[headers,row('Jul-26'),row('Sep-26')];
  model=new Map(C.modelRows(C.analyze(sources)));
  assert.equal(model.get('dashboard|Q3 2026|inventoryturns'),'');
  sources[0].raw=[headers,row('Jul-26'),row('Aug-26')];
  stocks[1][3]='';
  assert.equal(new Map(C.modelRows(C.analyze(sources))).get('dashboard|Q3 2026|inventoryturns'),'');
});

test('inventory turnover preserves zero COGS but rejects zero average stock and negative period costs',()=>{
  const financial=(cost)=>['Jul-26',100,cost,100-cost,30,70-cost,40,'Q3 2026'];
  const stocks=[['Reporting Month','Cash Balance','Accounts Receivable','Inventory Value','Accounts Payable','Net Working Capital'],['Jun-26',100,0,100,0,200],['Jul-26',100,0,100,0,200]];
  const sources=source([headers,financial(0)]).concat([{name:'1. Working Capital',raw:stocks}]);
  const turn=()=>new Map(C.modelRows(C.analyze(sources))).get('dashboard|Q3 2026|inventoryturns');
  assert.equal(turn(),0);
  stocks[1][3]=stocks[2][3]=0;assert.equal(turn(),'');
  stocks[1][3]=stocks[2][3]=100;sources[0].raw[1]=financial(-10);assert.equal(turn(),'');
});

// --- Customer-quarterly derivation (CQ is derived from the monthly ledger; cached CQ sheet is ignored) ---
const cqHdr=['Customer','Month','Revenue'];
const cqRow=(c,m,r)=>[c,m,r];
test('derived CQ sums all three calendar months for a closed historical quarter',()=>{
  const data=source([headers,row('Apr-25',200),row('May-25',300),row('Jun-25',400)]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Mana','Apr-25',50),cqRow('Mana','May-25',60),cqRow('Mana','Jun-25',70)]},
    {name:'Assumptions',raw:[['Customer','Margin'],['Mana',.7]]}
  ]);
  const a=C.analyze(data);
  assert.equal(a.cq.find(r=>r.customer==='Mana'&&r.period.label==='Q2 2025').values[0],180);
  const matrix=new Map(C.modelRows(a));
  assert.equal(matrix.get('customer|Q2 2025|mana|revenue'),180);
});
test('derived CQ uses August QTD — covered calendar months only, no annualisation',()=>{
  const data=source([headers,row('Jul-26',100),row('Aug-26',200)]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Mana','Jul-26',40),cqRow('Mana','Aug-26',50)]},
    {name:'Assumptions',raw:[['Customer','Margin'],['Mana',.7]]}
  ]);
  const a=C.analyze(data);
  const rec=a.cq.find(r=>r.customer==='Mana'&&r.period.label==='Q3 2026');
  assert.equal(rec.values[0],90);
});
test('changing a monthly figure changes derived quarter revenue and concentration',()=>{
  const before=C.analyze(source([headers,row('Jul-26',100),row('Aug-26',200)]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Mana','Jul-26',40),cqRow('Mana','Aug-26',50)]},
    {name:'Assumptions',raw:[['Customer','Margin'],['Mana',.7]]}
  ]));
  const after=C.analyze(source([headers,row('Jul-26',100),row('Aug-26',200)]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Mana','Jul-26',80),cqRow('Mana','Aug-26',50)]},
    {name:'Assumptions',raw:[['Customer','Margin'],['Mana',.7]]}
  ]));
  assert.notEqual(before.cq[0].values[0],after.cq[0].values[0]);
  assert.equal(before.cq[0].values[0],90);assert.equal(after.cq[0].values[0],130);
  assert.equal(before.econ[0].concentration,90/300);
  assert.equal(after.econ[0].concentration,130/300);
  assert.equal(after.econ[0].gp,91);
});
test('cached CQ literal cannot override the monthly-derived value',()=>{
  const sources=source([headers,row('Jul-26',100),row('Aug-26',200)]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Mana','Jul-26',40),cqRow('Mana','Aug-26',50)]},
    {name:'CustomerRevenueQuarterly',raw:[['Customer','Quarter','Revenue'],['Mana','Q3 2026',99999]]},
    {name:'Assumptions',raw:[['Customer','Margin'],['Mana',.7]]}
  ]);
  const a=C.analyze(sources);
  assert.equal(a.cq.find(r=>r.customer==='Mana'&&r.period.label==='Q3 2026').values[0],90);
});
test('calculation fingerprint is independent of cached quarterly totals',()=>{
  const base=source([headers,row('Jul-26',100),row('Aug-26',200)]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Mana','Jul-26',40),cqRow('Mana','Aug-26',50)]},
    {name:'Assumptions',raw:[['Customer','Margin'],['Mana',.7]]}
  ]);
  const cached=base.concat([{name:'CustomerRevenueQuarterly',raw:[['Customer','Quarter','Revenue'],['Mana','Q3 2026',99999]]}]);
  const a=C.analyze(base),b=C.analyze(cached);
  assert.equal(C.fingerprint(a),C.fingerprint(b));
});
test('explicit monthly zero is preserved as a real quarter contribution',()=>{
  const data=source([headers,row('Jul-26',100),row('Aug-26',200)]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Mana','Jul-26',0),cqRow('Mana','Aug-26',50)]},
    {name:'Assumptions',raw:[['Customer','Margin'],['Mana',.7]]}
  ]);
  assert.equal(C.analyze(data).cq.find(r=>r.customer==='Mana'&&r.period.label==='Q3 2026').values[0],50);
});
test('blank historical month fails the closed quarter to null without zero-fill',()=>{
  const data=source([headers,row('Apr-25',200),row('May-25',300),row('Jun-25',400)]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Mana','Apr-25',50),cqRow('Mana','Jun-25',70)]},
    {name:'Assumptions',raw:[['Customer','Margin'],['Mana',.7]]}
  ]);
  assert.equal(C.analyze(data).cq.find(r=>r.customer==='Mana'&&r.period.label==='Q2 2025').values[0],null);
});
test('duplicate monthly rows for the same month are quarantined and the quarter stays null',()=>{
  const data=source([headers,row('Jul-26',100),row('Aug-26',200)]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Mana','Jul-26',10),cqRow('Mana','Jul-26',20),cqRow('Mana','Aug-26',50)]},
    {name:'Assumptions',raw:[['Customer','Margin'],['Mana',.7]]}
  ]);
  const a=C.analyze(data);
  assert.equal(a.cq.find(r=>r.customer==='Mana'&&r.period.label==='Q3 2026').values[0],null);
  assert.ok(a.issues.some(i=>i.level==='error'&&i.sheet==='CustomerRevenueMonthly'));
});
test('invalid monthly string fails the quarter to null without partial parse',()=>{
  const data=source([headers,row('Jul-26',100),row('Aug-26',200)]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Mana','Jul-26','abc'),cqRow('Mana','Aug-26',50)]},
    {name:'Assumptions',raw:[['Customer','Margin'],['Mana',.7]]}
  ]);
  assert.equal(C.analyze(data).cq.find(r=>r.customer==='Mana'&&r.period.label==='Q3 2026').values[0],null);
});
test('mixed labels/case in monthly rows collapse to one customer identity',()=>{
  const data=source([headers,row('Jul-26',100),row('Aug-26',200)]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Auntie Aloha','Jul-26',40),cqRow('auntie aloha','Aug-26',50)]},
    {name:'Assumptions',raw:[['Customer','Margin'],['Auntie Aloha',.65]]}
  ]);
  const a=C.analyze(data);
  assert.equal(a.cq.length,1);
  assert.equal(a.cq[0].customer,'Auntie Aloha');
  assert.equal(a.cq[0].values[0],90);
});
test('future months do not advance CQ beyond the financial as-of',()=>{
  const data=source([headers,row('Jul-26',100),row('Aug-26',200),['Sep-27','','','','','','','Q3 2027']]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Mana','Jul-26',40),cqRow('Mana','Aug-26',50),cqRow('Mana','Sep-27',0)]},
    {name:'Assumptions',raw:[['Customer','Margin'],['Mana',.7]]}
  ]);
  const a=C.analyze(data);
  assert.equal(a.latest.month,'Aug-26');
  assert.equal(a.cq.find(r=>r.customer==='Mana'&&r.period.label==='Q3 2026').values[0],90);
  assert.ok(!a.cq.some(r=>r.period.label==='Q3 2027'));
});
test('a future-only monthly customer cannot change the current portfolio',()=>{
  const data=source([headers,row('Jul-26',100),row('Aug-26',200)]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Mana','Jul-26',40),cqRow('Mana','Aug-26',50),cqRow('Future Account','Sep-26',500)]},
    {name:'Assumptions',raw:[['Customer','Margin'],['Mana',.7]]}
  ]);
  const a=C.analyze(data);
  assert.deepEqual(a.customers.map(c=>c.name),['Mana']);
  assert.deepEqual(a.cq.map(r=>[r.customer,r.period.label,r.values[0]]),[['Mana','Q3 2026',90]]);
  assert.equal(new Map(C.modelRows(a)).get('portfolio|Q3 2026|revenue'),90);
});
test('quarterly customer figures stay unavailable without a financial reporting month',()=>{
  const data=source([headers]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Mana','Jan-26',10),cqRow('Mana','Feb-26',20),cqRow('Mana','Mar-26',30)]},
    {name:'Assumptions',raw:[['Customer','Margin'],['Mana',.7]]}
  ]);
  const a=C.analyze(data);
  assert.equal(a.latest,null);
  assert.deepEqual(a.cq,[]);
  assert.equal(new Map(C.modelRows(a)).get('meta|latest-month'),'');
});
test('December to January rollover closes the old quarter and starts a new QTD',()=>{
  const data=source([headers,row('Oct-26',100),row('Nov-26',200),row('Dec-26',300),row('Jan-27',400)]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Mana','Oct-26',40),cqRow('Mana','Nov-26',50),cqRow('Mana','Dec-26',60),cqRow('Mana','Jan-27',70)]},
    {name:'Assumptions',raw:[['Customer','Margin'],['Mana',.7]]}
  ]);
  const a=C.analyze(data);
  assert.equal(a.cq.find(r=>r.period.label==='Q4 2026').values[0],150);
  assert.equal(a.cq.find(r=>r.period.label==='Q1 2027').values[0],70);
});
test('historical settings cutoff blanks covered months and the partial quarter uses only covered calendar months',()=>{
  const data=source([headers,row('Apr-26',100),row('May-26',200),row('Jun-26',300),row('Jul-26',400)]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Mana','Apr-26',40),cqRow('Mana','May-26',50),cqRow('Mana','Jun-26',60),cqRow('Mana','Jul-26',70)]},
    {name:'Assumptions',raw:[['Customer','Margin'],['Mana',.7]]}
  ]);
  const filtered=C.settings.filterSources(data,C.settings.normalize({cutoff:'2026-05'}));
  const a=C.analyze(filtered);
  assert.equal(a.latest.month,'May-26');
  const q2=a.cq.find(r=>r.customer==='Mana'&&r.period.label==='Q2 2026');
  // Q2 2026 QTD through May = Apr (40) + May (50) = 90; Jun and Jul are past the as-of and not required.
  assert.equal(q2.values[0],90);
  assert.ok(!a.cq.some(r=>r.customer==='Mana'&&r.period.label==='Q3 2026'));
});
test('historical placeholder rows surface as null CQ records for the named quarter',()=>{
  const data=source([headers,row('Apr-24',100),row('May-24',120),row('Jun-24',140)]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Mana','May-24',null),cqRow('Mana','Jun-24',null)]},
    {name:'Assumptions',raw:[['Customer','Margin'],['Mana',.7]]}
  ]);
  const a=C.analyze(data);
  const rec=a.cq.find(r=>r.customer==='Mana'&&r.period.label==='Q2 2024');
  assert.ok(rec);
  assert.equal(rec.values[0],null);
});
test('monthly-only customers without Assumptions margin use null margin and still derive',()=>{
  const data=source([headers,row('Jul-26',100),row('Aug-26',200)]).concat([
    {name:'CustomerRevenueMonthly',raw:[cqHdr,cqRow('Newco','Jul-26',10),cqRow('Newco','Aug-26',20)]}
  ]);
  const a=C.analyze(data);
  const cust=a.customers.find(c=>c.name==='Newco');
  assert.equal(cust.margin,null);
  assert.equal(a.cq.find(r=>r.customer==='Newco'&&r.period.label==='Q3 2026').values[0],30);
  assert.equal(a.econ.find(e=>e.name==='Newco').gp,null);
});
test('source monthly records are not mutated by CQ derivation',()=>{
  const cm=[cqHdr,cqRow('Mana','Jul-26',40),cqRow('Mana','Aug-26',50)];
  const snapshot=cm.map(r=>r.slice());
  const data=source([headers,row('Jul-26',100),row('Aug-26',200)]).concat([
    {name:'CustomerRevenueMonthly',raw:cm},
    {name:'Assumptions',raw:[['Customer','Margin'],['Mana',.7]]}
  ]);
  C.analyze(data);
  assert.deepEqual(cm,snapshot);
});
