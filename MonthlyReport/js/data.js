/* Live read-only Sheets data. Same normalization as Apps Script. */
(function () {
  'use strict';
  const core=window.TPOCore, trim=v=>String(v??'').trim();
  const slugify=s=>trim(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const num=core.number, int=v=>{const n=num(v);return Number.isInteger(n)?n:null;};
  const pct=v=>{const n=num(v);return n!==null&&n>=0&&n<=1?n:null;};
  async function fetchTab(name) {
    const c=window.TPO_CONFIG, controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),20000);
    try {
      const range=encodeURIComponent("'"+name.replace(/'/g,"''")+"'"+(['LLM-Input','LLM Output'].includes(name)?'!A1:B7':''));
      const response=await fetch(`${c.SHEETS_ENDPOINT}/${c.SHEET_ID}/values/${range}?key=${encodeURIComponent(c.API_KEY)}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,{signal:controller.signal});
      if(!response.ok){const e=new Error('Unable to read '+name+' (HTTP '+response.status+').');e.code=response.status;throw e;}
      return (await response.json()).values||[];
    } finally {clearTimeout(timeout);}
  }
  function shape(map,errors=[],override) {
    const sources=Object.entries(map).map(([name,raw])=>({name,raw}));let shared;
    try{shared=core.settings.fromSources(sources);}catch(e){shared=core.settings.normalize({});errors=errors.concat([{sheet:'Report Settings',message:e.message}]);}
    const settings=core.settings.normalize(override||shared),a=core.analyze(core.settings.filterSources(sources,settings)),latest=a.latest;
    const customerRevenue=Object.create(null), customerRevenueQuarterly=Object.create(null), totals=Object.create(null);
    const customers=a.customers.map(c=>({...c,slug:slugify(c.name)}));
    a.cm.filter(r=>!latest||r.period.key<=latest.period.key).forEach(r=>{
      const slug=slugify(r.customer), margin=customers.find(c=>c.slug===slug)?.margin??null;
      (customerRevenue[slug]??={name:r.customer,slug,series:[]}).series.push({month:r.period.display,revenue:r.values[0],margin});
    });
    Object.values(customerRevenue).forEach(c=>c.series.forEach(r=>{
      if(!(r.month in totals))totals[r.month]=[];totals[r.month].push(r.revenue);
    }));Object.keys(totals).forEach(k=>totals[k]=core.sum(totals[k]));
    a.cq.filter(r=>!latest||r.period.key<=core.quarter(latest.quarter).key).forEach(r=>{
      const slug=slugify(r.customer);
      (customerRevenueQuarterly[slug]??={name:r.customer,slug,quarterly:[]}).quarterly.push({quarter:r.period.label,revenue:r.values[0]});
    });
    const wc=a.wc.filter(r=>!latest||r.period.key<=latest.period.key), labels=['Cash','AR','Inventory','AP','Net Working Capital'];
    const commentary=Object.create(null), commentaryStatus=Object.create(null);
    (map.Commentary||[]).slice(1).forEach(r=>{if(trim(r[0])){commentary[trim(r[0])]=trim(r[1]);commentaryStatus[trim(r[0])]=trim(r[2]);}});
    const content=Object.create(null);(map.Content||[]).slice(1).forEach(r=>{if(trim(r[0]))content[trim(r[0])]=trim(r[1]);});
    window.TPO_COMPUTE?.setLowSeason(a.lowSeason.map(m=>core.months[m-1]));
    const issues=a.issues.concat(errors.map(e=>({level:'warning',sheet:e.sheet,cell:'',message:e.message})));
    const seen=new Set();customers.forEach(c=>{if(!c.slug||seen.has(c.slug))issues.push({level:'error',sheet:'Assumptions',cell:'A:B',message:'Conflicting website customer identifier: '+c.name});seen.add(c.slug);});
    return {assumptions:{customers,params:a.params}, monthly:a.monthly,quarterly:{quarters:a.quarterly},
      customerRevenue,customerRevenueQuarterly,customerRevenueTotalByMonth:totals,
      customerCount:a.counts.filter(r=>!latest||r.period.key<=latest.period.key).map(r=>({month:r.period.display,count:r.values[0]})),
      workingCapital:{months:wc.map(r=>r.month),series:['cash','ar','inventory','ap','nwc'].map((key,i)=>({key,label:labels[i],values:wc.map(r=>r[key])})),
        tableHeaders:['Reporting Month',...labels],tableRows:wc.map(r=>({label:r.month,values:[r.cash,r.ar,r.inventory,r.ap,r.nwc]}))},
      customerEcon:{customers:a.econ,total:null},dashboard:a.dashboard,
      forwardLooking:{periods:a.forward,headers:[],lineNames:core.metrics},commentary,commentaryStatus,commentaryThinking:{},
      glossary:(map.Glossary||[]).slice(1).filter(r=>trim(r[0])).map(r=>({term:trim(r[0]),definition:trim(r[1])})),
      content,_issues:issues,_errors:errors.map(e=>e.message),_errorDetails:errors,_rawMap:map,_sharedSettings:shared,_settings:settings,_loadedAt:new Date(),_analysis:a,_fingerprint:core.fingerprint(a)};
  }
  async function load() {
    const c=window.TPO_CONFIG;
    if(!c.SHEET_ID||!c.API_KEY||c.SHEET_ID.startsWith('PUT_')||c.API_KEY.startsWith('PUT_')){
      const e=new Error('Configure the Google Sheet connection in config.js.');e.code='CONFIG_MISSING';throw e;
    }
    const tabs=Array.from(new Set((c.TABS||Object.keys(core.defs).concat(['Assumptions','Commentary','Glossary'])).concat(['Dashboard Inputs','Report Settings','LLM-Input','LLM Output'])));
    const optional=new Set(['Dashboard Inputs','Report Settings','LLM-Input','LLM Output','Content','Glossary']),primary=tabs.filter(n=>!optional.has(n)),map={},errors=[];
    const batch=async()=>{const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),20000);try{
      const url=new URL(c.SHEETS_ENDPOINT+'/'+c.SHEET_ID+'/values:batchGet',location.href);url.searchParams.set('key',c.API_KEY);url.searchParams.set('valueRenderOption','UNFORMATTED_VALUE');url.searchParams.set('dateTimeRenderOption','SERIAL_NUMBER');primary.forEach(n=>url.searchParams.append('ranges',"'"+n.replace(/'/g,"''")+"'"));
      const r=await fetch(url,{signal:ctrl.signal});if(!r.ok)throw new Error('Batch read unavailable');const data=await r.json();if(!Array.isArray(data.valueRanges)||data.valueRanges.length!==primary.length)throw new Error('Incomplete batch response');data.valueRanges.forEach((v,i)=>map[primary[i]]=v.values||[]);
    }finally{clearTimeout(timer);}};
    try{await batch();}catch(e){/* Keep individual fallbacks for missing source sheets. */}
    const remaining=tabs.filter(n=>!(n in map)),results=await Promise.allSettled(remaining.map(fetchTab));
    results.forEach((r,i)=>{const name=remaining[i];if(r.status==='fulfilled')map[name]=r.value;else if(!(optional.has(name)&&r.reason.code===400))errors.push({sheet:name,message:r.reason.message});});
    if(!map.MonthlyFinancials||!map.Assumptions){const e=new Error(errors[0]?.message||'Required sheets unavailable.');e.code='SHEET_UNREACHABLE';throw e;}
    return shape(map,errors);
  }
  window.TPO_DATA={load,shape,num,int,pct,trim,slugify};
})();
