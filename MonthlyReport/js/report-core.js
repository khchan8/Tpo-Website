/* Shared, deterministic Google Sheets normalization. No network or services. */
var TPOCore = (function () {
  'use strict';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const metrics = ['revenue','cogs','gp','sga','ebit','netIncome'];
  const trim = v => String(v == null ? '' : v).trim();
  const norm = v => trim(v).toLowerCase().replace(/[^a-z0-9]/g, '');
  const blank = v => v == null || trim(v) === '';
  function number(v) {
    if (blank(v)) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    let s = trim(v), pct = /%$/.test(s);
    s = s.replace(/%$/, '').trim().replace(/^฿\s*/, '').replace(/^\((.*)\)$/, '-$1');
    if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$|^[+-]?\.\d+$/.test(s)) return null;
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) ? n / (pct ? 100 : 1) : null;
  }
  function month(v) {
    let y, m, s = trim(v), a;
    if (Object.prototype.toString.call(v) === '[object Date]' && Number.isFinite(v.getTime())) {
      y = v.getUTCFullYear(); m = v.getUTCMonth() + 1;
    } else if (typeof v === 'number' && v > 20000 && v < 110000) {
      return month(new Date(Date.UTC(1899,11,30) + Math.floor(v) * 86400000));
    } else if ((a = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?(?:[T ].*)?$/.exec(s))) {
      y = +a[1]; m = +a[2];
    } else if ((a = /^(?:\d{1,2}[- /])?([A-Za-z]{3,9})[- /](\d{2}|\d{4})$/.exec(s))) {
      m = months.findIndex(n => n.toLowerCase() === a[1].slice(0,3).toLowerCase()) + 1;
      y = +a[2]; if (y < 100) y += 2000;
    } else return null; // Ambiguous numeric dates are deliberately rejected.
    if (m < 1 || m > 12 || y < 1900 || y > 2200) return null;
    return { year:y, month:m, key:y*12+m-1, label:y+'-'+String(m).padStart(2,'0'),
      display:months[m-1]+'-'+String(y).slice(-2), quarter:'Q'+Math.ceil(m/3)+' '+y };
  }
  function quarter(v) {
    const m = /^Q([1-4])\s+(\d{4})$/i.exec(trim(v));
    return m ? { year:+m[2], q:+m[1], key:+m[2]*4 + +m[1]-1, label:'Q'+m[1]+' '+m[2] } : null;
  }
  const sum = a => a.length && a.every(Number.isFinite) ? a.reduce((x,y)=>x+y,0) : null;
  const ratio = (a,b) => Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a/b : null;
  const col = n => { let s=''; for(n++;n;n=Math.floor((n-1)/26)) s=String.fromCharCode(65+(n-1)%26)+s; return s; };
  const dashboardLabels=['Active Customers','New Accounts Opened','Customer Retention Rate','Revenue per Customer','Top 5 Revenue Concentration','EBIT (EBITDA proxy; D&A unavailable)','Cash Balance','Inventory Turns'];
  function metricKey(label) { const key=norm(label); return key.startsWith('ebit')?'ebit':key; }
  function riskStatus(current, prior) {
    if(!Number.isFinite(current))return {status:'Unavailable / Missing EBIT',level:'unknown'};
    if(current<0)return {status:'Operating Loss / High Risk',level:'high'};
    if(!Number.isFinite(prior))return {status:'Operating Profit / Baseline Unavailable',level:'unknown'};
    if(current>prior)return {status:'Improving / On Track',level:'low'};
    if(current===prior)return {status:'Stable / Monitor',level:'moderate'};
    return {status:'Contracting / Moderate Risk',level:'moderate'};
  }
  const defs = {
    MonthlyFinancials: [['month'],['totalrevenue','revenue'],['cogs'],['grossprofit'],['sga'],['ebit'],['netincome'],['quarter']],
    'Quarterly Financials': [['quarter'],['totalrevenue','revenue'],['cogs'],['grossprofit'],['sga'],['ebit'],['netincome']],
    CustomerRevenueMonthly: [['customer','customerbrand'],['month'],['revenue','grossrevenue']],
    CustomerRevenueQuarterly: [['customer','customerbrand'],['quarter'],['revenue','grossrevenue']],
    CustomerCount: [['month'],['customercount','activecustomers']],
    '1. Working Capital': [['reportingmonth','month'],['cashbalance','cash'],['accountsreceivable','ar'],['inventoryvalue','inventory'],['accountspayable','ap'],['networkingcapital','nwc']],
    '2. Customer Economics': [['customerbrand','customer'],['quarter'],['grossrevenue','revenue'],['concentration','revenueconcentration'],['grossprofit','estimatedcontribution'],['contributionmargin']],
    '4. Forward-Looking Risk': [['reportingperiod'],['revenue','totalrevenue'],['cogs'],['grossprofit'],['sga'],['ebit'],['netincome'],['riskstatus']]
  };
  function analyze(sources) {
    const sourceMap = Object.fromEntries(sources.map(s=>[s.name,s]));
    const issues=[], maps={}, tables={};
    function issue(level,sheet,cell,message) { issues.push({level,sheet,cell,message}); }
    function table(name) {
      const src=sourceMap[name], raw=src && src.raw || [];
      if (!raw.length) { issue('warning',name,'A1','Missing or empty sheet; dependent data unavailable.'); return []; }
      const d=defs[name];
      if (!d) { tables[name]=raw.map(r=>r.slice()); return tables[name]; }
      const hdr=raw[0].map(norm), indices=d.map(aliases=>hdr.findIndex(h=>aliases.includes(h)));
      maps[name]=indices;
      if(indices.some(i=>i<0) || new Set(indices).size!==indices.length) {
        issue('error',name,'1:1','Header mismatch. Expected: '+d.map(a=>a[0]).join(', ')+'. Sheet excluded.'); tables[name]=[]; return [];
      }
      const result=raw.map(r=>indices.map(c=>r[c] == null ? '' : r[c])); tables[name]=result;
      return result;
    }
    sources.forEach(s=>{
      if(!defs[s.name]&&!['Assumptions','Dashboard Inputs','3. Strategic Dashboard'].includes(s.name))return;
      (s.raw||[]).forEach((r,i)=>r.forEach((v,j)=>{
        if (/^#(?:REF!|VALUE!|DIV\/0!|N\/A|NAME\?|NUM!|ERROR!|SPILL!)/.test(trim(v))) issue('error',s.name,col(j)+(i+1),'Formula error: '+v);
      }));
    });
    Object.keys(defs).forEach(table);
    ['Assumptions','3. Strategic Dashboard','Dashboard Inputs','Glossary','README','Commentary','Content'].forEach(n=>{
      if(sourceMap[n]) table(n);
    });
    const cell = (name,row,c)=>col((maps[name]||[])[c] == null ? c : maps[name][c])+row;
    function numeric(name,row,c,v,kind) {
      if(blank(v)) return null;
      const n=number(v), valid=n!==null && !(kind==='count' && (!Number.isInteger(n)||n<0)) && !(kind==='percent' && (n<0||n>1)) && !(kind!=='percent' && /%/.test(trim(v)));
      if(!valid) { issue('error',name,cell(name,row,c),'Invalid '+(kind||'number')+': '+v+'. Value excluded.'); return null; }
      return n;
    }
    function records(name,periodCol,numericCols,customerCol,kind) {
      const rows=tables[name]||[], out=[], grouped=new Map();
      rows.slice(1).forEach((r,i)=>{
        const row=i+2;
        if(numericCols.every(c=>blank(r[c]))) {
          if(r.some(v=>!blank(v))) issue('info',name,cell(name,row,periodCol),'Blank data row ignored; period does not advance.'); return;
        }
        const p=(kind==='quarter'?quarter:month)(r[periodCol]);
        if(!p) { issue('error',name,cell(name,row,periodCol),'Unrecognized period; row excluded. Use Jan-26 or Q1 2026.'); return; }
        const customer=customerCol==null ? '' : trim(r[customerCol]);
        if(customerCol!=null && !customer) {issue('error',name,cell(name,row,customerCol),'Missing customer; row excluded.');return;}
        const values=numericCols.map(c=>numeric(name,row,c,r[c],name==='CustomerCount'?'count':'number'));
        const rec={period:p,row,customer,values}, key=customer.toLowerCase()+'|'+p.key;
        const group=grouped.get(key)||[]; group.push(rec); grouped.set(key,group);
      });
      grouped.forEach(group=>{
        if(group.length>1) { group.forEach(r=>issue('error',name,cell(name,r.row,periodCol),'Duplicate '+r.customer+' '+(r.period.display||r.period.label)+' in rows '+group.map(x=>x.row).join(', ')+'. All conflicting rows excluded.')); return; }
        out.push(group[0]);
      });
      return out.sort((a,b)=>a.period.key-b.period.key);
    }
    let monthly=records('MonthlyFinancials',0,[1,2,3,4,5,6]).map(r=>{
      const q=tables.MonthlyFinancials[r.row-1][7];
      if(!blank(q) && (!quarter(q)||quarter(q).label!==r.period.quarter)) {
        issue('error','MonthlyFinancials',cell('MonthlyFinancials',r.row,7),'Quarter disagrees with month; row excluded. Check whether a month-year label was parsed as month-day.');return null;
      }
      const obj={period:r.period,row:r.row,month:r.period.display,quarter:r.period.quarter};
      metrics.forEach((k,i)=>obj[k]=r.values[i]);
      if(r.values.some(v=>v===null)) issue('warning','MonthlyFinancials',cell('MonthlyFinancials',r.row,1),'Incomplete monthly data; affected totals remain unavailable.');
      [[obj.revenue,obj.cogs,obj.gp,'Gross profit must equal revenue minus COGS',3], [obj.gp,obj.sga,obj.ebit,'EBIT must equal gross profit minus SG&A',5]].forEach(a=>{
        if(a.slice(0,3).every(Number.isFinite)&&Math.abs(a[0]-a[1]-a[2])>2) { issue('error','MonthlyFinancials',cell('MonthlyFinancials',r.row,a[4]),a[3]+'. Affected result excluded.'); obj[a[4]===3?'gp':'ebit']=null; }
      });
      return obj;
    }).filter(r=>r&&metrics.some(k=>r[k]!==null));
    const latest=monthly.filter(r=>r.revenue!==null).slice(-1)[0]||null, groups=new Map();
    monthly.filter(r=>!latest||r.period.key>latest.period.key).forEach(r=>issue('warning','MonthlyFinancials',cell('MonthlyFinancials',r.row,1),'Revenue is missing; this pending month does not advance reporting. Enter an actual revenue amount, including zero when appropriate.'));
    monthly=monthly.filter(r=>latest&&r.period.key<=latest.period.key);
    monthly.forEach(r=>{const a=groups.get(r.quarter)||[]; a.push(r);groups.set(r.quarter,a);});
    const quarterly=Array.from(groups,([quarter,rows])=>{
      const q={quarter,months:rows.map(r=>r.month),complete:rows.length===3};
      metrics.forEach(k=>q[k]=sum(rows.map(r=>r[k]))); return q;
    });
    const suppliedQ=records('Quarterly Financials',0,[1,2,3,4,5,6],null,'quarter');
    suppliedQ.forEach(r=>{const calc=quarterly.find(q=>q.quarter===r.period.label); if(!calc)return;
      metrics.forEach((k,i)=>{if(r.values[i]!==calc[k] && !(Number.isFinite(r.values[i])&&Number.isFinite(calc[k])&&Math.abs(r.values[i]-calc[k])<=6))issue('warning','Quarterly Financials',cell('Quarterly Financials',r.row,i+1),'Does not reconcile with monthly '+k+'; monthly rollup used.');});
    });
    const cm=records('CustomerRevenueMonthly',1,[2],0), cq=records('CustomerRevenueQuarterly',1,[2],0,'quarter');
    const counts=records('CustomerCount',0,[1]).filter(r=>r.values[0]!==null);
    const wc=records('1. Working Capital',0,[1,2,3,4,5]).map(r=>{
      const [cash,ar,inventory,ap,reported]=r.values, nwc=sum([cash,ar,inventory,ap===null?null:-ap]);
      if(nwc===null)issue('warning','1. Working Capital',cell('1. Working Capital',r.row,5),'NWC unavailable: cash, AR, inventory and AP must all be supplied. Blank is not zero.');
      else if(reported===null || Math.abs(nwc-reported)>2)issue('warning','1. Working Capital',cell('1. Working Capital',r.row,5),'NWC differs from cash + AR + inventory − AP; calculated total used.');
      return {period:r.period,row:r.row,month:r.period.display,cash,ar,inventory,ap,nwc};
    });
    const assumptions=tables.Assumptions||[], customers=[], params={};
    assumptions.slice(1).forEach((r,i)=>{
      if(!blank(r[0])&&!/^total$/i.test(trim(r[0]))) customers.push({name:trim(r[0]),margin:numeric('Assumptions',i+2,1,r[1],'percent')});
      if(/^(Currency|Reporting period\s*\(as-of\)|Active Customers rule|Low season|.*cordon)$/i.test(trim(r[3]))) params[trim(r[3])]=trim(r[4]);
    });
    const seenCustomers=new Set(); customers.forEach(c=>{const key=c.name.toLowerCase(); if(seenCustomers.has(key))issue('error','Assumptions','A:B','Duplicate customer '+c.name);seenCustomers.add(key);});
    let lowSeason=[];
    const ls=trim(params['Low season']).split(/\s*[-–—]\s*/);
    if(ls.length===2){const start=months.findIndex(x=>x.toLowerCase()===ls[0].slice(0,3).toLowerCase()),end=months.findIndex(x=>x.toLowerCase()===ls[1].slice(0,3).toLowerCase());if(start>=0&&end>=0){for(let i=start;;i=(i+1)%12){lowSeason.push(i+1);if(i===end)break;}}}
    if(!lowSeason.length)issue('warning','Assumptions','D:E','Low season missing or invalid; season classification unavailable.');
    if(latest){const asof=Object.entries(params).find(([k])=>/reporting period/i.test(k));if(asof&&month(asof[1])?.key!==latest.period.key)issue('warning','Assumptions','D:E','As-of is stale; latest populated financial month '+latest.month+' used.');}
    function reconcile(name,records,period,expected) {
      const a=records.filter(r=>r.period.key===period.key), actual=sum(a.map(r=>r.values[0]));
      const missing=customers.filter(c=>!a.some(r=>r.customer.toLowerCase()===c.name.toLowerCase()));
      if(missing.length||actual===null||expected===null||Math.abs(actual-expected)>Math.max(2,a.length))issue('warning',name,'A:C','Revenue coverage/reconciliation for '+(period.display||period.label)+': customer total '+actual+', P&L '+expected+(missing.length?'; missing/conflicting '+missing.map(c=>c.name).join(', '):'')+'. Shares of listed customers are not company-wide concentration.');
    }
    monthly.forEach(m=>reconcile('CustomerRevenueMonthly',cm,m.period,m.revenue));
    quarterly.forEach(q=>reconcile('CustomerRevenueQuarterly',cq,quarter(q.quarter),q.revenue));
    const econ=cq.map(r=>{
      const rev=r.values[0],cust=customers.find(c=>c.name.toLowerCase()===r.customer.toLowerCase()),base=quarterly.find(x=>x.quarter===r.period.label),margin=cust?cust.margin:null;
      return {name:r.customer,quarter:r.period.label,revenue:rev,concentration:ratio(rev,base&&base.revenue),gp:rev!==null&&margin!==null?rev*margin:null,margin};
    });
    (tables['2. Customer Economics']||[]).slice(1).forEach((r,i)=>{
      if(blank(r[0])||/^total/i.test(trim(r[0])))return;
      const canonical=econ.find(c=>c.name.toLowerCase()===trim(r[0]).toLowerCase()&&c.quarter===trim(r[1]));
      if(!canonical&&!blank(r[2]))issue('warning','2. Customer Economics',cell('2. Customer Economics',i+2,2),'No unique matching customer-quarter in CustomerRevenueQuarterly; standalone value is not used.');
      if(canonical&&number(r[2])!==canonical.revenue)issue('warning','2. Customer Economics',cell('2. Customer Economics',i+2,2),'Revenue differs from CustomerRevenueQuarterly; ledger value used.');
      if(canonical&&number(r[3])!==null&&canonical.concentration!==null&&Math.abs(number(r[3])-canonical.concentration)>0.0001)issue('warning','2. Customer Economics',cell('2. Customer Economics',i+2,3),'Concentration must divide matching-quarter revenue, not EBIT.');
    });
    const dashboardRaw=tables['3. Strategic Dashboard']||[], inputRows=tables['Dashboard Inputs'], manual=new Map(), labels=new Map(dashboardLabels.map(l=>[metricKey(l),l]));
    dashboardRaw.slice(1).filter(r=>!blank(r[0])).forEach(r=>{if(!labels.has(metricKey(r[0])))labels.set(metricKey(r[0]),trim(r[0]));});
    if(inputRows) {
      if(norm((inputRows[0]||[])[0])!=='quarter'||norm((inputRows[0]||[])[1])!=='metric'||norm((inputRows[0]||[])[2])!=='value')issue('error','Dashboard Inputs','A1:C1','Expected Quarter | Metric | Value.');
      inputRows.slice(1).forEach((r,i)=>{
        if(r.every(blank))return;const q=quarter(r[0]),key=metricKey(r[1]);
        if(!q||!key){issue('error','Dashboard Inputs','A'+(i+2),'Invalid quarter or metric.');return;}
        const id=q.label+'|'+key;
        if(manual.has(id)){issue('error','Dashboard Inputs','A'+(i+2),'Duplicate quarter/metric. Values excluded.');manual.set(id,null);return;}
        const kind=/retention/.test(key)?'percent':/accounts|customers/.test(key)?'count':'number';
        manual.set(id,numeric('Dashboard Inputs',i+2,2,r[2],kind));
        if(!labels.has(key))labels.set(key,trim(r[1]));
      });
    } else dashboardRaw.slice(1).forEach(r=>(dashboardRaw[0]||[]).slice(1).forEach((q,j)=>{if(quarter(q))manual.set(trim(q)+'|'+metricKey(r[0]),number(r[j+1]));}));
    const dashboard={periods:Array.from(new Set(quarterly.map(q=>q.quarter).concat((dashboardRaw[0]||[]).slice(1).filter(v=>quarter(v)).map(trim))))
      .filter(q=>latest&&quarter(q).key<=quarter(latest.quarter).key).sort((a,b)=>quarter(a).key-quarter(b).key),metrics:[]};
    labels.forEach((label,key)=>{
      const legacyRow=dashboardRaw.findIndex(r=>metricKey(r[0])===key),values=dashboard.periods.map(q=>{
        const legacyCol=(dashboardRaw[0]||[]).findIndex(v=>trim(v)===q),legacy=legacyRow>0&&legacyCol>0?number(dashboardRaw[legacyRow][legacyCol]):null;
        const qp=quarter(q), fin=quarterly.find(x=>x.quarter===q), start=qp.year*12+(qp.q-1)*3, count=counts.find(x=>x.period.key===start), balance=wc.find(x=>x.period.key===start+2);
        let value=manual.get(q+'|'+key)??null, calculated=false;
        if(key.includes('activecustomers')){value=count?count.values[0]:null;calculated=true;}
        if(key.includes('revenuepercustomer')){value=ratio(fin&&fin.revenue,count&&count.values[0]);calculated=true;}
        if(key.startsWith('ebit')){value=fin?fin.ebit:null;calculated=true;}
        if(key.includes('cashbalance')){value=balance?balance.cash:null;calculated=true;}
        if(key.includes('concentration')) {
          const rows=cq.filter(r=>r.period.label===q), total=sum(rows.map(r=>r.values[0]));
          const covered=customers.length>0&&customers.every(c=>rows.some(r=>r.customer.toLowerCase()===c.name.toLowerCase()));
          value=covered&&Number.isFinite(total)&&Number.isFinite(fin&&fin.revenue)&&Math.abs(total-fin.revenue)<=Math.max(2,rows.length)
            ?ratio(sum(rows.map(r=>r.values[0]).sort((a,b)=>b-a).slice(0,5)),fin.revenue):null;
          calculated=true;
        }
        const same=value===legacy||(Number.isFinite(value)&&Number.isFinite(legacy)&&Math.abs(value-legacy)<=Math.max(1e-8,Math.abs(value)*1e-9));
        if(legacyRow>0&&legacyCol>0&&calculated && !same)issue('warning','3. Strategic Dashboard',col(legacyCol)+(legacyRow+1),'Stale or unverified '+label+' for '+q+'; canonical calculation used, or unavailable.');
        if(!calculated && /retention/.test(key) && value!==null && (value<0||value>1)){issue('error','3. Strategic Dashboard','A:Z','Retention must be a fraction or percentage.');value=null;}
        return value;
      }); dashboard.metrics.push({label,values});
    });
    const current=latest?monthly.filter(r=>r.quarter===latest.quarter):[], previous=current.map(r=>monthly.find(p=>p.period.key===r.period.key-12));
    const forward=[];
    if(latest){[[previous, 'Prior year'],[current,'Current year']].forEach(([rows,label])=>{
      const item={label:label+' — matched months '+current.map(r=>months[r.period.month-1]).join(', ')+' '+(label==='Prior year'?latest.period.year-1:latest.period.year),coverage:current.length+'/3 quarter months; '+(current.length===3?'full quarter coverage.':'incomplete quarter. Never annualize.')};
      metrics.forEach(k=>item[k]=sum(rows.map(r=>r?r[k]:null)));forward.push(item);
    });forward[0].riskStatus='Historical Baseline';forward[0].riskLevel='baseline';const risk=riskStatus(forward[1].ebit,forward[0].ebit);forward[1].riskStatus=risk.status;forward[1].riskLevel=risk.level;}
    if((tables['4. Forward-Looking Risk']||[]).length>1)issue('info','4. Forward-Looking Risk','A:H','Reporting uses latest-quarter matched-month comparison, not supplied narrative or full-vs-partial totals.');
    return {monthly,quarterly,latest,cm,cq,counts,wc,customers,params,lowSeason,econ,dashboard,forward,issues,tables,maps};
  }
  // Non-security checksum for detecting stale commentary across the two runtimes.
  function fingerprint(a) {
    const config=[a.params.Currency||'THB',a.params['Low season']||'',a.params['Active Customers rule']||'count at first month of the quarter'];
    const text=JSON.stringify([a.monthly,a.quarterly,a.cm,a.cq,a.counts,a.wc,a.customers,config,a.lowSeason,a.econ,a.dashboard,a.forward]);
    let h=2166136261, g=5381;
    for(let i=0;i<text.length;i++){h=Math.imul(h^text.charCodeAt(i),16777619);g=Math.imul(g,33)^text.charCodeAt(i);}
    return (h>>>0).toString(16).padStart(8,'0')+(g>>>0).toString(16).padStart(8,'0');
  }
  function modelRows(a) {
    const errors=a.issues.filter(i=>i.level==='error');
    if(errors.length)throw new Error(errors[0].sheet+'!'+errors[0].cell+': '+errors[0].message);
    const rows=[['TPO_REPORT_MODEL_V4','Value']], add=(key,value)=>rows.push([key,value==null?'':value]);
    add('meta|latest-month',a.latest&&a.latest.month);
    add('meta|coverage',a.latest?a.latest.quarter+' through '+a.latest.month+'; never annualize':'No actual financial data');
    a.quarterly.forEach(q=>metrics.forEach(k=>add('quarter|'+q.quarter+'|'+k,q[k])));
    a.econ.forEach(c=>['revenue','concentration','gp','margin'].forEach(k=>add('customer|'+c.quarter+'|'+c.name.toLowerCase()+'|'+k,c[k])));
    const quarters=new Set(a.cq.map(c=>c.period.label));
    quarters.forEach(q=>{
      const customers=a.econ.filter(c=>c.quarter===q),total=sum(customers.map(c=>c.revenue)),fin=a.quarterly.find(r=>r.quarter===q);
      add('portfolio|'+q+'|revenue',total);add('portfolio|'+q+'|concentration',ratio(total,fin&&fin.revenue));
      add('portfolio|'+q+'|gp',sum(customers.map(c=>c.gp)));
    });
    a.dashboard.metrics.forEach(m=>a.dashboard.periods.forEach((q,i)=>add('dashboard|'+q+'|'+metricKey(m.label),m.values[i])));
    a.forward.forEach((f,i)=>['label',...metrics,'riskStatus','coverage','riskLevel'].forEach(k=>add('forward|'+(i?'current':'prior')+'|'+k,f[k])));
    return rows;
  }
  return {months,metrics,number,month,quarter,sum,ratio,analyze,defs,col,fingerprint,metricKey,dashboardLabels,riskStatus,modelRows};
})();
/** Shared presentation contract. Financial inputs are never removed by visibility rules. */
var TPOReportSettings=(function(){
  const sections=[['overview','Overview','overview'],['dashboard','Dashboard','strategic-dashboard'],['seasonality','Seasonality','seasonality'],['customers','Customers',null],['financials','Financials','financial-performance'],['working-capital','Working Capital','working-capital'],['forward-looking','Forward-looking','forward-looking'],['about','Glossary',null]].map(([id,label,view],order)=>({id,label,view,order}));
  const slug=s=>String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  function normalize(value){
    if(value==null||value==='')value={};if(typeof value==='string')value=JSON.parse(value);
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Report settings must be an object.');
    if(value.version!=null&&value.version!==1)throw new Error('Unsupported report settings version.');
    const choice=(v,list,fallback)=>{if(v==null)return fallback;if(!list.includes(v))throw new Error('Unsupported setting: '+v);return v;};
    const row=(r={},label='',order=0)=>{
      if(!r||typeof r!=='object'||Array.isArray(r))throw new Error('Invalid section setting.');
      const out={mode:choice(r.mode,['show','hide','auto'],'show'),label:String(r.label??label).trim().slice(0,70),order:Number(r.order??order),commentary:r.commentary??true,export:r.export??true};
      if(!Number.isFinite(out.order)||typeof out.commentary!=='boolean'||typeof out.export!=='boolean')throw new Error('Order must be numeric; commentary/export must be true or false.');return out;
    };
    const tabs=Object.fromEntries(sections.map(s=>[s.id,row(value.tabs?.[s.id],s.label,s.order)])),customers={};
    Object.entries(value.customers||{}).forEach(([id,r],i)=>{if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)||['__proto__','constructor','prototype'].includes(id))throw new Error('Invalid customer identifier.');customers[id]=row(r,id,i);});
    const cutoff=value.cutoff||'latest';if(cutoff!=='latest'&&(!/^\d{4}-(0[1-9]|1[0-2])$/.test(cutoff)||!TPOCore.month(cutoff)))throw new Error('Reporting cut-off must be latest or YYYY-MM.');
    const decimals=value.decimals??0;if(!Number.isInteger(decimals)||decimals<0||decimals>2)throw new Error('Decimals must be 0, 1 or 2.');
    return {version:1,cutoff,tabs,customers,home:choice(value.home,sections.map(s=>s.id),'overview'),monthlyRange:choice(value.monthlyRange,['all','12m','6m','ytd'],'all'),quarterlyRange:choice(value.quarterlyRange,['all','4q','8q'],'all'),money:choice(value.money,['auto','full','thousands','millions'],'auto'),decimals,density:choice(value.density,['comfortable','compact'],'comfortable')};
  }
  function fromSources(sources){const s=sources.find(s=>s.name==='Report Settings');if(!s?.raw?.length)return normalize({});if(s.raw[0][0]!=='Setting'||s.raw[0][1]!=='Value'||s.raw[1]?.[0]!=='Configuration')throw new Error('Report Settings: expected Setting | Value, then Configuration in A2.');return normalize(s.raw[1][1]);}
  function filterSources(sources,settings){
    const cutoff=TPOCore.month(settings.cutoff);if(!cutoff)return sources;
    // A later completed quarterly ledger cannot represent an earlier partial-quarter cut-off.
    const excludeCurrentQuarter=cutoff.month%3!==0&&TPOCore.analyze(sources).monthly.some(r=>r.period.key>cutoff.key&&r.quarter===cutoff.quarter);
    return sources.map(s=>{
      const def=TPOCore.defs[s.name],raw=s.raw||[];if(!def||!raw.length)return s;
      const period=def.findIndex(a=>a.includes('month')||a.includes('quarter'));if(period<0)return s;
      const norm=v=>String(v).toLowerCase().replace(/[^a-z0-9]/g,''),col=raw[0].findIndex(h=>def[period].includes(norm(h)));
      const quarter=def[period].includes('quarter'),limit=quarter?TPOCore.quarter(cutoff.quarter).key:cutoff.key;
      return {...s,raw:raw.map((r,i)=>{const p=(quarter?TPOCore.quarter:TPOCore.month)(r[col]);return i&&p&&(p.key>limit||(quarter&&excludeCurrentQuarter&&p.key===limit))?r.map(()=>''):r;})};
    });
  }
  function available(id,a){if(!a)return false;return ({overview:!!a.latest,financials:!!a.monthly.length,dashboard:!!a.dashboard.periods.length,seasonality:!!a.monthly.length,customers:a.cm.concat(a.cq).some(r=>r.values.some(Number.isFinite)),'working-capital':a.wc.some(r=>[r.cash,r.ar,r.inventory,r.ap,r.nwc].some(Number.isFinite)),'forward-looking':!!a.forward.length,about:true})[id]||false;}
  function customerList(settings,a){return (a?.customers||[]).map((c,i)=>({...c,slug:slug(c.name),...rowSetting(settings,slug(c.name),c.name,i)})).filter(c=>c.mode!=='hide'&&(c.mode!=='auto'||a.cm.concat(a.cq).some(r=>slug(r.customer)===c.slug&&r.values.some(Number.isFinite)))).sort((a,b)=>a.order-b.order);}
  function rowSetting(settings,id,name,i){return settings.customers[id]||{mode:'show',label:name,order:i,commentary:true,export:true};}
  function visible(settings,a){return sections.map(s=>({...s,...settings.tabs[s.id]})).filter(s=>s.mode!=='hide'&&(s.mode!=='auto'||available(s.id,a))&&(s.id!=='customers'||customerList(settings,a).length)).sort((a,b)=>a.order-b.order);}
  function commentaryViews(settings,a){const ids=sections.filter(s=>s.view&&settings.tabs[s.id].commentary).map(s=>s.view);a.customers.forEach((c,i)=>{if(rowSetting(settings,slug(c.name),c.name,i).commentary)ids.push(slug(c.name));});return ids.sort();}
  return {sections,normalize,fromSources,filterSources,available,visible,customerList,rowSetting,commentaryViews,slug};
})();
TPOCore.settings=TPOReportSettings;
if(typeof module==='object' && module.exports)module.exports=TPOCore;
