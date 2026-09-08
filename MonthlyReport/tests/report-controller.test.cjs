const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),C=require('../js/report-core');
class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.attrs={};this.textContent='';this.classList={toggle(){return false;},remove(){}};}
  append(...nodes){this.children.push(...nodes);}prepend(...nodes){this.children.unshift(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}addEventListener(){}focus(){}remove(){}querySelectorAll(){return [];}get hash(){return this.href?.slice(this.href.indexOf('#'))||'';}
}
async function runtime(settings={},hash='#/setup'){
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},location={hash,href:'https://example.test/report/'+hash},downloads=[];
  const document={body:new Element(),createElement:t=>new Element(t),getElementById:get,addEventListener(){},querySelectorAll:q=>q==='#primary-nav a'?get('primary-nav').children:[]};
  const window={TPOCore:C,TPO_CONFIG:{SHEET_ID:'fixture',COMPANY:'TPO',CURRENCY:'THB'},addEventListener(){},print(){},TPO_SETTINGS_UI:{effective:()=>C.settings.normalize(settings),download:(name,text,type)=>downloads.push({name,text,type})}};
  const ctx=vm.createContext({window,document,location,history:{replaceState:(_,__,hash)=>location.hash=hash},URL,AbortController,setTimeout,clearTimeout,console,Intl});
  vm.runInContext(fs.readFileSync('js/data.js','utf8'),ctx);vm.runInContext(fs.readFileSync('js/compute.js','utf8'),ctx);
  const map={MonthlyFinancials:[['Month','Revenue','COGS','Gross Profit','SG&A','EBIT','Net Income','Quarter'],['Jul-26',100,20,80,30,50,40,'Q3 2026']],Assumptions:[['Customer','Margin'],['Mana',.7]],CustomerRevenueMonthly:[['Customer','Month','Revenue'],['Mana','Jul-26',100]]};
  const shaped=window.TPO_DATA.shape(map);window.TPO_DATA.load=async()=>shaped;window.TPO_VIEWS={disposeAllCharts(){}};['setup','loading','customer',...C.settings.sections.map(s=>s.id)].forEach(id=>window.TPO_VIEWS[id]=()=>new Element(id));
  vm.runInContext(fs.readFileSync('js/app.js','utf8'),ctx);await new Promise(setImmediate);return {app:window.TPO_APP,downloads,location,nodes,map};
}
test('controller redirects hidden direct links and always exposes Setup',async()=>{const rt=await runtime({tabs:{financials:{mode:'hide'}}},'#/financials');assert.equal(rt.location.hash,'#/overview');assert.ok(rt.nodes.get('primary-nav').children.some(a=>a.href==='#/setup'));assert.ok(!rt.nodes.get('primary-nav').children.some(a=>a.href==='#/financials'));});
test('controller handles all hidden pages without redirect loops',async()=>{const rt=await runtime({tabs:Object.fromEntries(C.settings.sections.map(s=>[s.id,{mode:'hide'}]))},'#/financials');assert.equal(rt.location.hash,'#/setup');assert.equal(rt.nodes.get('primary-nav').children.length,1);});
test('snapshot round trip validates captured data and rejects altered values',async()=>{const rt=await runtime();rt.app.saveSnapshot();const snapshot=JSON.parse(rt.downloads[0].text);assert.equal(snapshot.engine,'tpo-v5');assert.ok(!JSON.stringify(snapshot).includes('API_KEY'));assert.doesNotThrow(()=>rt.app.openSnapshot(snapshot));snapshot.sources.MonthlyFinancials[1][1]=101;assert.throws(()=>rt.app.openSnapshot(snapshot),/validation failed/);assert.doesNotThrow(()=>rt.app.returnLive());});
test('CSV respects customer visibility and explicit export selection',async()=>{const tabs=Object.fromEntries(C.settings.sections.map(s=>[s.id,{export:s.id==='customers'}]));const rt=await runtime({tabs,customers:{mana:{mode:'hide'}}});rt.app.exportCSV();assert.ok(!rt.downloads[0].text.includes('Mana'));});
