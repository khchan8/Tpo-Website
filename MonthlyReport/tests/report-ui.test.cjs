const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),C=require('../js/report-core');

// Minimal DOM fixture: option selection follows attribute presence, as in HTML.
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.events={};this._value='';}
  setAttribute(k,v){this.attrs[k]=String(v);if(k==='value')this.value=String(v);}
  append(...nodes){this.children.push(...nodes);}
  appendChild(n){this.append(n);return n;}
  replaceChildren(...nodes){this.children=nodes;}
  addEventListener(k,fn){this.events[k]=fn;}
  get value(){return this.tag==='select'?(this.children.find(c=>c.value===this._value)||this.children.filter(c=>'selected' in c.attrs).at(-1)||this.children[0])?.value||'':this._value;}
  set value(v){this._value=String(v);}
}
function flatten(node){return [node,...node.children.flatMap(flatten)];}
function settingsUI(storage=new Map(),fail=false){
  const window={TPOCore:C,TPO_CONFIG:{SHEET_ID:'fixture'},dispatchEvent(){}};
  const ctx=vm.createContext({window,document:{createElement:t=>new Element(t)},Event:class{},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{if(fail)throw Error('blocked');storage.set(k,v);}}});
  vm.runInContext(fs.readFileSync('js/settings.js','utf8'),ctx);
  const panel=window.TPO_SETTINGS_UI.panel({settings:C.settings.normalize({}),fullAnalysis:{monthly:[],customers:[]}}),nodes=flatten(panel);
  return {storage,ui:window.TPO_SETTINGS_UI,byLabel:label=>nodes.find(n=>n.attrs['aria-label']===label),click:label=>nodes.find(n=>n.textContent===label).events.click()};
}
test('multiple preset saves preserve entries, refresh choices, and apply immediately',()=>{
  const rt=settingsUI();rt.byLabel('Preset name').value='First';rt.click('Save preset');
  rt.byLabel('Amount display').value='millions';rt.byLabel('Preset name').value='Second';rt.click('Save preset');
  const saved=JSON.parse([...rt.storage.values()][0]);assert.deepEqual(saved.map(p=>p.name),['First','Second']);
  assert.equal(rt.byLabel('Saved preset').value,'1');rt.click('Apply preset');assert.equal(rt.ui.effective({}).money,'millions');
  rt.byLabel('Saved preset').value='0';rt.click('Apply preset');assert.equal(rt.ui.effective({}).money,'auto');
  rt.byLabel('Preset name').value='First';rt.click('Save preset');
  assert.equal(JSON.parse(rt.storage.get('tpo:settings:v1:fixture:presets')).length,2);
});
test('preset save preserves intervening saves from another Setup panel',()=>{
  const storage=new Map(),a=settingsUI(storage),b=settingsUI(storage);
  a.byLabel('Preset name').value='A';a.click('Save preset');b.byLabel('Preset name').value='B';b.click('Save preset');
  assert.deepEqual(JSON.parse([...storage.values()][0]).map(p=>p.name),['A','B']);
});
test('failed preset persistence does not add an unsaved dropdown option',()=>{
  const rt=settingsUI(new Map(),true);rt.byLabel('Preset name').value='Unsaved';rt.click('Save preset');
  assert.equal(rt.byLabel('Saved preset').children.length,3);assert.equal(rt.storage.size,0);
});
test('dashboard selects Active Customers, falls back to first usable metric, and permits an empty dashboard',()=>{
  const window={TPO_CONFIG:{},TPO_DATA:{trim:v=>String(v??'').trim(),num:v=>v==null?null:Number(v)},TPO_COMPUTE:{fmtPct:String,fmtMoneyFull:String}};
  const ctx=vm.createContext({window,document:{createElement:t=>new Element(t),createTextNode:text=>Object.assign(new Element('#text'),{textContent:text})},requestAnimationFrame(){}});
  vm.runInContext(fs.readFileSync('js/views.js','utf8'),ctx);
  for(const [metrics,expected] of [[[{label:'Active Customers',values:[3]},{label:'Inventory Turns',values:[2]}],'Active Customers'],[[{label:'Missing',values:[null]},{label:'Revenue',values:[100]},{label:'Inventory Turns',values:[2]}],'Revenue'],[[],'']]){
    const root=window.TPO_VIEWS.dashboard({data:{content:{},monthly:[],dashboard:{periods:['Q1 2026'],metrics}}});
    const select=flatten(root).find(n=>n.attrs['data-role']==='metric');assert.equal(select.value,expected);
    assert.equal(select.children.filter(n=>'selected' in n.attrs).length,expected?1:0);
  }
});
test('financial charts plot monthly and quarterly revenue, gross profit and EBIT from the same analysis',()=>{
  class Element {
    constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.events={};this.className='';this.textContent='';this._value='';}
    get isConnected(){return true;}
    setAttribute(k,v){this.attrs[k]=String(v);if(k==='value')this.value=String(v);}
    append(...nodes){this.children.push(...nodes);}
    appendChild(n){this.append(n);return n;}
    replaceChildren(...nodes){this.children=nodes;}
    addEventListener(k,fn){this.events[k]=fn;}
    get classList(){const self=this;return{toggle(){},add(){},remove(){},contains:()=>false};}
    getAttribute(k){return this.attrs[k]??null;}
    querySelector(sel){return this._all().find(n=>sel.startsWith('[')&&n.attrs[sel.slice(1,-1)]!==undefined)||null;}
    querySelectorAll(sel){return this._all().filter(n=>sel.startsWith('[')&&n.attrs[sel.slice(1,-1)]!==undefined);}
    _all(){return[this,...this.children.flatMap(n=>n._all?n._all():[n])];}
    get value(){return this._value;} set value(v){this._value=String(v);}
  }
  const options=[];
  const window={TPOCore:C,TPO_CONFIG:{SHEET_ID:'fixture'},TPO_CHART_SETTINGS:{},
    echarts:{init:()=>({setOption:o=>options.push(JSON.parse(JSON.stringify(o))),on(){},resize(){},dispose(){}})}};
  const ctx=vm.createContext({window,echarts:window.echarts,console,setTimeout,clearTimeout,
    document:{createElement:t=>new Element(t),createTextNode:t=>Object.assign(new Element('#text'),{textContent:t})},
    requestAnimationFrame:fn=>{fn();return 0;},ResizeObserver:class{observe(){}disconnect(){}}});
  for(const f of ['js/compute.js','js/data.js','js/views.js'])
    vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
  const fin=['Month','Revenue','COGS','Gross Profit','SG&A','EBIT','Net Income','Quarter'];
  const row=(m,rev)=>{const cogs=rev*.4,gp=rev-cogs,sga=rev*.2,ebit=gp-sga;return[m,rev,cogs,gp,sga,ebit,ebit-10,''];};
  const map={MonthlyFinancials:[fin,...[600,610,620,700,710,720,800,810].map((v,i)=>row(['Oct-26','Nov-26','Dec-26','Jan-27','Feb-27','Mar-27','Apr-27','May-27'][i],v))],
    Assumptions:[['Customer','Margin'],['Mana',.7]],
    CustomerRevenueMonthly:[['Customer','Month','Revenue']],CustomerCount:[['Month','Customer Count']],
    '1. Working Capital':[['Reporting Month','Cash Balance','Accounts Receivable','Inventory Value','Accounts Payable','Net Working Capital']],
    Commentary:[['View','Commentary','Status']],Glossary:[]};
  const data=window.TPO_DATA.shape(map);
  window.TPO_VIEWS.financials({data,settings:C.settings.normalize({})});
  assert.match(options.map(o=>o.xAxis.data[0]).join('|'),/Oct-26/); // monthly chart built
  const quarterly=options.filter(o=>/^Q\d \d{4}$/.test(o.xAxis.data[0]));
  assert.equal(quarterly.length,1,'exactly one quarterly chart');
  const q=quarterly[0];
  assert.deepEqual(q.legend.data,['Revenue','Gross Profit','EBIT']);
  assert.deepEqual(q.series.map(s=>s.name),['Revenue','Gross Profit','EBIT']);
  assert.deepEqual(q.series.map(s=>s.type),['bar','line','line']);
  const byQuarter=data.quarterly.quarters;
  assert.deepEqual(q.xAxis.data,byQuarter.map(x=>x.quarter));
  for(const [series,key] of [[0,'revenue'],[1,'gp'],[2,'ebit']])
    assert.deepEqual(q.series[series].data,byQuarter.map(x=>x[key]));
  assert.ok(byQuarter.every(x=>Number.isFinite(x.ebit)),'fixture covers EBIT in every quarter');
  assert.ok(flatten(window.TPO_VIEWS.financials({data,settings:C.settings.normalize({})})).some(n=>n.textContent==='Quarterly revenue, gross profit & EBIT'));
});
