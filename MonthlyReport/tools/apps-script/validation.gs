/** Data safety, formatting, and explicit recalculation tools. */
function safeSources_(sources, a) {
  const moneyHeaders=['Total Revenue','COGS','Gross Profit','SG&A','EBIT','Net Income'];
  const rows={
    MonthlyFinancials:[['Month'].concat(moneyHeaders,['Quarter'])].concat(a.monthly.map(r=>[r.month].concat(TPOCore.metrics.map(k=>r[k]),[r.quarter]))),
    'Quarterly Financials':[['Quarter'].concat(moneyHeaders)].concat(a.quarterly.map(r=>[r.quarter].concat(TPOCore.metrics.map(k=>r[k])))),
    CustomerRevenueMonthly:[['Customer','Month','Revenue']].concat(a.cm.map(r=>[r.customer,r.period.display,r.values[0]])),
    CustomerRevenueQuarterly:[['Customer','Quarter','Revenue']].concat(a.cq.map(r=>[r.customer,r.period.label,r.values[0]])),
    CustomerCount:[['Month','Customer Count']].concat(a.counts.map(r=>[r.period.display,r.values[0]])),
    '1. Working Capital':[['Reporting Month','Cash Balance','Accounts Receivable','Inventory Value','Accounts Payable','Net Working Capital']].concat(a.wc.map(r=>[r.month,r.cash,r.ar,r.inventory,r.ap,r.nwc])),
    '2. Customer Economics':[['Customer Brand','Quarter','Gross Revenue','Revenue Concentration','Estimated Contribution','Contribution Margin']].concat(a.econ.map(r=>[r.name,r.quarter,r.revenue,r.concentration,r.gp,r.margin])),
    '3. Strategic Dashboard':[['Strategic Metric'].concat(a.dashboard.periods)].concat(a.dashboard.metrics.map(r=>[r.label].concat(r.values))),
    '4. Forward-Looking Risk':[['Reporting Period'].concat(moneyHeaders,['Risk Status','Coverage'])].concat(a.forward.map(r=>[r.label].concat(TPOCore.metrics.map(k=>r[k]),[r.riskStatus,r.coverage]))),
    'Dashboard Inputs': a.tables['Dashboard Inputs']||[]
  };
  rows.Assumptions=[['Customer','Contribution Margin','','Parameter','Value']];
  const parameters=Object.entries(a.params).filter(([k])=>!(/cordon|reporting period/i.test(k)));
  parameters.push(['Reporting period (as-of)',a.latest?a.latest.month:'Unavailable']);
  for(let i=0;i<Math.max(a.customers.length,parameters.length);i++)rows.Assumptions.push([
    a.customers[i]?a.customers[i].name:'',a.customers[i]?a.customers[i].margin:'','',parameters[i]?parameters[i][0]:'',parameters[i]?parameters[i][1]:'']);
  return sources.map(s=>({name:s.name,missing:!!s.missing,raw:rows[s.name]||[],display:rows[s.name]||[]}));
}

function writeValidation_(a) {
  const ss=SpreadsheetApp.getActiveSpreadsheet(), sh=sheet_('Data Validation')||ss.insertSheet('Data Validation');
  const entries=a.issues.map(i=>[i.level.toUpperCase(),i.sheet,i.cell,i.message]);
  const rows=[['Severity','Sheet','Cell / range','Finding'],['INFO','Report','',
    'Checked '+stamp_()+' · '+TPO.build+' · Latest financial data: '+(a.latest?a.latest.month:'Unavailable')]]
    .concat(entries.length?entries:[['OK','','','No data issues detected.']]);
  const tz=timezoneInfo_();
  rows.splice(2,0,[tz.type==='string'&&tz.value.trim()?'INFO':'WARNING','Spreadsheet settings','Time zone',
    'Reported timezone: '+JSON.stringify(tz.value)+'; effective timezone: '+spreadsheetTimezone_(ss)+
    (tz.value===''?' (explicit TPO.timezone fallback; Google returned an empty setting).':'')]);
  ensureSize_(sh,rows.length,4);
  sh.getDataRange().clearContent(); plainText_(sh.getRange(1,1,rows.length,4),rows);
  sh.setFrozenRows(1); sh.setColumnWidth(1,100);sh.setColumnWidth(2,210);sh.setColumnWidth(3,115);sh.setColumnWidth(4,760);
  sh.getRange(1,1,1,4).setBackground('#0B1F3A').setFontColor('#ffffff').setFontWeight('bold');
  sh.getRange(2,1,rows.length-1,4).setWrap(true).setVerticalAlignment('top');
  return sh;
}
function menuValidateData() {
  uiAction_('Validate data',()=>locked_(()=>{
    const sh=writeValidation_(analyzeReportSources_(readSources_()));SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sh);
  }));
}

function formatPlan_(sources,a) {
  const plan=[];
  const numeric={MonthlyFinancials:[1,2,3,4,5,6], 'Quarterly Financials':[1,2,3,4,5,6],
    CustomerRevenueMonthly:[2],CustomerRevenueQuarterly:[2],CustomerCount:[1],
    '1. Working Capital':[1,2,3,4,5],'2. Customer Economics':[2,3,4,5], '4. Forward-Looking Risk':[1,2,3,4,5,6]};
  sources.forEach(s=>{
    const map=a.maps[s.name];
    if(!numeric[s.name]||!map||map.some(c=>c<0))return;
    const periodCol=s.name==='CustomerRevenueMonthly'?1:['MonthlyFinancials','CustomerCount','1. Working Capital'].includes(s.name)?0:null;
    if(periodCol!==null)(s.raw||[]).slice(1).forEach((row,i)=>{
      const actual=map[periodCol],v=row[actual],formula=s.formulas&&(s.formulas[i+1]||[])[actual],p=TPOCore.month(v);
      if(p&&!formula)plan.push({sheet:s.name,row:i+2,col:actual+1,value:p.display,text:true,reason:'Store reporting month as explicit text before applying formats'});
    });
    (s.raw||[]).slice(1).forEach((row,i)=>numeric[s.name].forEach(c=>{
      const actual=map[c],v=row[actual],formula=s.formulas&&s.formulas[i+1]&&s.formulas[i+1][actual];
      const percent=s.name==='2. Customer Economics'&&(c===3||c===5);
      const n=TPOCore.number(v);
      if(!formula && typeof v==='string' && v.trim() && n!==null && (percent || !/%/.test(v)))
        plan.push({sheet:s.name,row:i+2,col:actual+1,value:n,reason:'Convert unambiguous numeric text; preserve amount'});
    }));
  });return plan;
}
function backupAndWrite_(plan,label) {
  if(!plan.length)return;
  // Snapshot exact formulas/values before the first mutation; retain an audit trail.
  const ss=SpreadsheetApp.getActiveSpreadsheet(), sh=sheet_('Repair Backup')||ss.insertSheet('Repair Backup');
  const snapshots=new Map();
  plan.forEach(p=>{const s=snapshots.get(p.sheet)||{rows:0,cols:0};s.rows=Math.max(s.rows,p.row);s.cols=Math.max(s.cols,p.col);snapshots.set(p.sheet,s);});
  snapshots.forEach((s,name)=>{const range=sheet_(name).getRange(1,1,s.rows,s.cols);s.values=range.getValues();s.formulas=range.getFormulas();s.formats=range.getNumberFormats();});
  const previous=plan.map(p=>{const s=snapshots.get(p.sheet);return {p,formula:s.formulas[p.row-1][p.col-1],value:s.values[p.row-1][p.col-1],format:s.formats[p.row-1][p.col-1]};});
  const run=new Date().toISOString(), start=Math.max(2,sh.getLastRow()+1);
  ensureSize_(sh,start+previous.length,8);
  plainText_(sh.getRange(1,1,1,8),[['Run UTC','Action','Sheet','Cell','Previous value / formula','New value / formula','Reason','Previous number format']]);
  plainText_(sh.getRange(start,1,previous.length,8),previous.map(x=>[run,label,x.p.sheet,columnName_(x.p.col)+x.p.row,
    x.formula||String(x.value),String(x.p.value),x.p.reason||label,x.format]));
  sh.setFrozenRows(1); SpreadsheetApp.flush();
  let written=0;
  try {
    previous.forEach(x=>context_('Write repair',{sheet:x.p.sheet,cell:columnName_(x.p.col)+x.p.row},()=>{
      // Count before writing so even a write that throws after submission is restored.
      written++; const r=sheet_(x.p.sheet).getRange(x.p.row,x.p.col);
      if(x.p.text)r.setNumberFormat('@');
      if(x.p.formula)r.setFormula(x.p.value);
      else if(typeof x.p.value==='number')r.setValue(x.p.value);
      else plainText_(r,[[x.p.value==null?'':String(x.p.value)]]);
    }));SpreadsheetApp.flush();
  } catch(e) {
    const failures=[];
    previous.slice(0,written).reverse().forEach(x=>{try{
      const r=sheet_(x.p.sheet).getRange(x.p.row,x.p.col);
      if(x.formula)r.setFormula(x.formula);else if(typeof x.value==='string')plainText_(r,[[x.value]]);else r.setValue(x.value);
      r.setNumberFormat(x.format);
    }catch(rollback){failures.push(x.p.sheet+'!'+columnName_(x.p.col)+x.p.row+': '+rollback.message);}});
    if(failures.length)e.message+='\nRollback incomplete; restore from Repair Backup: '+failures.join('; ');
    throw e;
  }
}
function applyFormats_(sources,a) {
  const money='#,##0.00;[Red](#,##0.00);0.00';
  sources.forEach(s=>{
    const sh=sheet_(s.name);if(!sh||!s.raw.length)return;
    const width=Math.min(sh.getLastColumn(),s.name==='Assumptions'?5:8);
    sh.setFrozenRows(1);
    sh.getRange(1,1,1,width).setFontWeight('bold').setBackground('#0B1F3A').setFontColor('#ffffff').setWrap(true);
    sh.setColumnWidth(1,200);
    const map=a.maps[s.name]; if(!map||map.some(c=>c<0)||sh.getLastRow()<2)return;
    const nr=sh.getLastRow()-1;
    const numeric={MonthlyFinancials:[1,2,3,4,5,6],'Quarterly Financials':[1,2,3,4,5,6],CustomerRevenueMonthly:[2],CustomerRevenueQuarterly:[2],CustomerCount:[1],
      '1. Working Capital':[1,2,3,4,5],'2. Customer Economics':[2,3,4,5],'4. Forward-Looking Risk':[1,2,3,4,5,6]};
    (numeric[s.name]||[]).forEach(c=>{
      const pct=s.name==='2. Customer Economics'&&(c===3||c===5);
      sh.getRange(2,map[c]+1,nr,1).setNumberFormat(pct?'0.0%':s.name==='CustomerCount'?'0':money);
      sh.setColumnWidth(map[c]+1,165);
    });
    const dateCol=s.name==='CustomerRevenueMonthly'?1:['MonthlyFinancials','CustomerCount','1. Working Capital'].includes(s.name)?0:null;
    // Literal month labels have already been protected before other formatting.
    if(dateCol!==null) {
      const original=sheet_(s.name).getRange(2,map[dateCol]+1,nr,1).getFormulas();
      if(original.every(r=>!r[0]))sh.getRange(2,map[dateCol]+1,nr,1).setNumberFormat('@');
      else original.forEach((r,i)=>sh.getRange(i+2,map[dateCol]+1).setNumberFormat(r[0]?'mmm-yy':'@'));
    }
  });
  const as=sheet_('Assumptions');if(as&&as.getLastRow()>1)as.getRange(2,2,as.getLastRow()-1,1).setNumberFormat('0.0%');
  const db=sheet_('3. Strategic Dashboard');
  if(db&&db.getLastColumn()>1)(a.tables['3. Strategic Dashboard']||[]).slice(1).forEach((r,i)=>{
    const label=String(r[0]).toLowerCase(),fmt=/retention|concentration/.test(label)?'0.0%':/turns/.test(label)?'0.0"x"':/revenue|ebit|cash/.test(label)?money:'0';
    db.getRange(i+2,2,1,db.getLastColumn()-1).setNumberFormat(fmt);
  });
  const inputs=sheet_('Dashboard Inputs');
  if(inputs&&inputs.getLastRow()>1){inputs.setColumnWidth(2,270);(a.tables['Dashboard Inputs']||[]).slice(1).forEach((r,i)=>inputs.getRange(i+2,3).setNumberFormat(/retention/i.test(r[1])?'0.0%':/turns/i.test(r[1])?'0.0"x"':'#,##0.00'));}
  const risk=sheet_('4. Forward-Looking Risk');if(risk){risk.setColumnWidth(1,370);risk.getDataRange().setWrap(true);}
}
function menuFormatVerify() {
  uiAction_('Format & verify all sheets',()=>locked_(()=>{
    let sources=readSources_(),a=TPOCore.analyze(sources);
    backupAndWrite_(formatPlan_(sources,a),'Normalize numeric text');
    repairTimezone_(SpreadsheetApp.getActiveSpreadsheet());
    applyFormats_(sources,a);setup_();SpreadsheetApp.flush();
    const sh=writeValidation_(analyzeReportSources_(readSources_()));SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sh);
  }));
}

/** Range-fed custom function: Sheets recalculates when any raw argument changes.
 * No dependent output sheets are read, so the model cannot reference itself.
 * @customfunction
 */
function TPO_REPORT_MODEL(financials, assumptions, monthlyCustomers, quarterlyCustomers, counts, workingCapital, dashboardInputs, lowSeason, activeRule, currency, timezone, reportSettings) {
  const tz=typeof timezone==='string'&&timezone.trim()?timezone:TPO.timezone;
  const normalize=rows=>(Array.isArray(rows)?rows:[]).map(row=>row.map(v=>v instanceof Date?Utilities.formatDate(v,tz,'yyyy-MM-dd'):v));
  const as=normalize(assumptions).map(r=>r.slice(0,2));
  [['Low season',lowSeason],['Active Customers rule',activeRule],['Currency',currency]].forEach(([k,v],i)=>{
    if(!as[i+1])as[i+1]=[];as[i+1][3]=k;as[i+1][4]=Array.isArray(v)?v[0][0]:v;
  });
  const names=['MonthlyFinancials','CustomerRevenueMonthly','CustomerRevenueQuarterly','CustomerCount','1. Working Capital','Dashboard Inputs'];
  const values=[financials,monthlyCustomers,quarterlyCustomers,counts,workingCapital,dashboardInputs];
  const sources=names.map((name,i)=>({name,raw:normalize(values[i])}));sources.push({name:'Assumptions',raw:as});
  return TPOCore.modelRows(TPOCore.analyze(TPOReportSettings.filterSources(sources,TPOReportSettings.normalize(reportSettings))));
}
function calculatedMetric_(label) {
  return /activecustomers|revenuepercustomer|cashbalance|^ebit|concentration/.test(TPOCore.metricKey(label));
}
function modelLookup_(keyExpression) {
  // MATCH does not suppress a model error; a missing key returns blank, a real zero survives.
  return '=IF(\'Report Model\'!$A$1<>"TPO_REPORT_MODEL_V4",NA(),LET(k,'+keyExpression+',e,SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(k,"~","~~"),"*","~*"),"?","~?"),IF(COUNTIF(\'Report Model\'!$A:$A,e)=1,LET(v,INDEX(\'Report Model\'!$B:$B,MATCH(e,\'Report Model\'!$A:$A,0)),IF(ISNUMBER(v),v,IF(LEN(v),v,""))),"")))';
}
function repairPlan_(sources,a,next) {
  const plan=[], byName=Object.fromEntries(sources.map(s=>[s.name,{...s,raw:(s.raw||[]).map(r=>r.slice()),formulas:(s.formulas||[]).map(r=>r.slice())}]));
  const literal=v=>'"'+String(v).replace(/"/g,'""')+'"';
  function table(name,header) {
    if(!byName[name])byName[name]={name,raw:[],formulas:[]};
    if(!byName[name].raw.length)header.forEach((v,c)=>add(name,1,c+1,v));
    return byName[name];
  }
  function add(sheet,row,col,value,reason,formula,text) {
    const s=byName[sheet]||(byName[sheet]={name:sheet,raw:[],formulas:[]});
    if(!s.raw[row-1])s.raw[row-1]=[];if(!s.formulas[row-1])s.formulas[row-1]=[];
    if((formula?s.formulas[row-1][col-1]:s.raw[row-1][col-1])!==value) {
      plan.push({sheet,row,col,value,reason:reason||'Dynamic keyed calculation',formula:!!formula,text:!!text});
      s.raw[row-1][col-1]=value;s.formulas[row-1][col-1]=formula?value:'';
    }
  }
  function mapFor(name) {
    const map=a.maps[name];if(!map||map.some(c=>c<0))throw new Error(name+': restore the required headers before repair.');return map;
  }
  function keyedRows(name,key) {
    const found=new Map();byName[name].raw.slice(1).forEach((r,i)=>{
      const k=key(r);if(!k)return;if(found.has(k))throw new Error(name+': duplicate slot '+k+' at rows '+found.get(k)+' and '+(i+2)+'. Resolve before scaffolding.');found.set(k,i+2);
    });return found;
  }
  function slot(name,index,key,values) {
    if(index.has(key))return index.get(key);const row=byName[name].raw.length+1;
    values.forEach(([col,value,text])=>add(name,row,col,value,'New input slot; raw amounts left blank',false,text));index.set(key,row);return row;
  }
  const mf=mapFor('MonthlyFinancials'),wc=mapFor('1. Working Capital'),qf=mapFor('Quarterly Financials'),ce=mapFor('2. Customer Economics');
  const crm=mapFor('CustomerRevenueMonthly'),crq=mapFor('CustomerRevenueQuarterly'),cc=mapFor('CustomerCount');
  const periodKey=(r,map,c=0)=>{const p=TPOCore.month(r[map[c]]);return p?p.label:null;};
  const customerQuarter=(r,map)=>{const q=TPOCore.quarter(r[map[1]]);return q&&r[map[0]]?q.label+'|'+String(r[map[0]]).trim().toLowerCase():null;};
  const mi=keyedRows('MonthlyFinancials',r=>periodKey(r,mf)),wi=keyedRows('1. Working Capital',r=>periodKey(r,wc)),ci=keyedRows('CustomerCount',r=>periodKey(r,cc));
  const cmi=keyedRows('CustomerRevenueMonthly',r=>periodKey(r,crm,1)&&r[crm[0]]?periodKey(r,crm,1)+'|'+String(r[crm[0]]).trim().toLowerCase():null);
  const cqi=keyedRows('CustomerRevenueQuarterly',r=>customerQuarter(r,crq));
  if(next) {
    const row=slot('MonthlyFinancials',mi,next.label,[[mf[0]+1,next.display,true],[mf[7]+1,next.quarter]]);
    [[3,[1,2],'-'],[5,[3,4],'-']].forEach(([target,cols,op])=>{
      const old=byName.MonthlyFinancials.raw[row-1][mf[target]],existing=byName.MonthlyFinancials.formulas[row-1]?.[mf[target]];
      if((old==null||old==='')&&!existing){const refs=cols.map(c=>TPOCore.col(mf[c])+row);add('MonthlyFinancials',row,mf[target]+1,'=IF(COUNT('+refs.join(',')+')=2,'+refs.join(op)+',"")','Blank-safe monthly formula',true);}
    });
    slot('1. Working Capital',wi,next.label,[[wc[0]+1,next.display,true]]);slot('CustomerCount',ci,next.label,[[cc[0]+1,next.display,true]]);
    a.customers.forEach(c=>slot('CustomerRevenueMonthly',cmi,next.label+'|'+c.name.toLowerCase(),[[crm[0]+1,c.name],[crm[1]+1,next.display,true]]));
  }
  // Repair current quarter too, even when the workbook was never rolled over.
  const quarters=new Set(a.quarterly.map(q=>q.quarter));if(next)quarters.add(next.quarter);
  const qi=keyedRows('Quarterly Financials',r=>TPOCore.quarter(r[qf[0]])?.label);
  quarters.forEach(q=>slot('Quarterly Financials',qi,q,[[qf[0]+1,q]]));
  const seedQuarters=new Set([a.latest&&a.latest.quarter,next&&next.quarter].filter(Boolean));
  seedQuarters.forEach(q=>a.customers.forEach(c=>slot('CustomerRevenueQuarterly',cqi,q+'|'+c.name.toLowerCase(),[[crq[0]+1,c.name],[crq[1]+1,q]])));
  // Separate manual dashboard inputs before converting display cells to formulas.
  const legacy=table('3. Strategic Dashboard',['Strategic Metric']),hadInputs=!!byName['Dashboard Inputs']?.raw.length;
  const inputs=table('Dashboard Inputs',['Quarter','Metric','Value']);
  if(hadInputs&&inputs.raw[0].slice(0,3).join('|')!=='Quarter|Metric|Value')throw new Error('Dashboard Inputs has unrelated content. Expected Quarter | Metric | Value.');
  const di=keyedRows('Dashboard Inputs',r=>TPOCore.quarter(r[0])&&r[1]?TPOCore.quarter(r[0]).label+'|'+TPOCore.metricKey(r[1]):null);
  if(!hadInputs)legacy.raw.slice(1).forEach(r=>{
    if(!r[0]||calculatedMetric_(r[0]))return;
    legacy.raw[0].slice(1).forEach((q,j)=>{if(TPOCore.quarter(q))slot('Dashboard Inputs',di,q+'|'+TPOCore.metricKey(r[0]),[[1,q],[2,r[0]],[3,TPOCore.number(r[j+1])??'']]);});
  });
  const manualLabels=new Set(TPOCore.dashboardLabels.filter(l=>!calculatedMetric_(l)));
  inputs.raw.slice(1).forEach(r=>{if(r[1])manualLabels.add(r[1]);});
  seedQuarters.forEach(q=>manualLabels.forEach(l=>slot('Dashboard Inputs',di,q+'|'+TPOCore.metricKey(l),[[1,q],[2,l],[3,'']])));
  // Quarter totals reference a key; new actual months enter the shared range model automatically.
  qi.forEach((row,q)=>TPOCore.metrics.forEach((k,i)=>add('Quarterly Financials',row,qf[i+1]+1,modelLookup_('"quarter|"&'+TPOCore.col(qf[0])+row+'&"|'+k+'"'),null,true)));
  wi.forEach(row=>{const refs=[1,2,3,4].map(c=>TPOCore.col(wc[c])+row);add('1. Working Capital',row,wc[5]+1,'=IF(COUNT('+refs.join(',')+')=4,'+refs[0]+'+'+refs[1]+'+'+refs[2]+'-'+refs[3]+',"")','Require all working-capital components',true);});
  mi.forEach(row=>{const p=TPOCore.month(byName.MonthlyFinancials.raw[row-1][mf[0]]);add('MonthlyFinancials',row,mf[7]+1,p.quarter,'Quarter derived from month');});
  // A legacy Total Portfolio row must retain its original quarter as later rows are added.
  const oldCEQuarters=Array.from(new Set(byName['2. Customer Economics'].raw.slice(1).map(r=>TPOCore.quarter(r[ce[1]])?.label).filter(Boolean)));
  byName['2. Customer Economics'].raw.slice(1).forEach((r,i)=>{
    if(/^total/i.test(String(r[ce[0]]))&&!TPOCore.quarter(r[ce[1]])){
      if(oldCEQuarters.length!==1)throw new Error('Customer Economics total row '+(i+2)+' needs an explicit quarter.');
      add('2. Customer Economics',i+2,ce[1]+1,oldCEQuarters[0],'Keep portfolio total scoped to its original quarter');
    }
  });
  const cei=keyedRows('2. Customer Economics',r=>customerQuarter(r,ce));
  byName.CustomerRevenueQuarterly.raw.slice(1).forEach(r=>{
    const key=customerQuarter(r,crq);if(key)slot('2. Customer Economics',cei,key,[[ce[0]+1,r[crq[0]]],[ce[1]+1,TPOCore.quarter(r[crq[1]]).label]]);
  });
  add('2. Customer Economics',1,ce[4]+1,'Estimated Contribution');
  cei.forEach(row=>{
    const r=byName['2. Customer Economics'].raw[row-1],total=/^total/i.test(String(r[ce[0]])),q=TPOCore.col(ce[1])+row,name=TPOCore.col(ce[0])+row;
    const prefix=total?'"portfolio|"&'+q:'"customer|"&'+q+'&"|"&LOWER(TRIM('+name+'))';
    ['revenue','concentration','gp','margin'].forEach((key,i)=>{
      const formula=total&&key==='margin'?'=IFERROR('+TPOCore.col(ce[4])+row+'/'+TPOCore.col(ce[2])+row+',"")':modelLookup_(prefix+'&"|'+key+'"');
      add('2. Customer Economics',row,ce[i+2]+1,formula,null,true);
    });
  });
  // Preserve existing quarter positions, append missing columns, and bind every cell to its header.
  const headers=legacy.raw[0],dbQuarters=new Set();headers.slice(1).forEach(q=>{if(TPOCore.quarter(q)){if(dbQuarters.has(q))throw new Error('Strategic Dashboard has duplicate quarter '+q);dbQuarters.add(q);}});
  quarters.forEach(q=>{if(!dbQuarters.has(q)){let col=headers.findIndex((v,i)=>i>0&&!v);if(col<0)col=headers.length;add(legacy.name,1,col+1,q);dbQuarters.add(q);}});
  if(headers.slice(1).some(q=>q&&!TPOCore.quarter(q)))throw new Error('Strategic Dashboard has a non-quarter column header. Use Q1 2026 style headers.');
  Array.from(dbQuarters).sort((x,y)=>TPOCore.quarter(x).key-TPOCore.quarter(y).key).forEach((q,j)=>add(legacy.name,1,j+2,q,'Keep quarter columns chronological'));
  const labels=new Map();legacy.raw.slice(1).forEach((r,i)=>{if(r[0]){const key=TPOCore.metricKey(r[0]);if(labels.has(key))throw new Error('Strategic Dashboard duplicate metric '+r[0]);labels.set(key,i+2);}});
  TPOCore.dashboardLabels.forEach(l=>{const key=TPOCore.metricKey(l);if(!labels.has(key)){const row=legacy.raw.length+1;add(legacy.name,row,1,l);labels.set(key,row);}else if(key==='ebit')add(legacy.name,labels.get(key),1,l);});
  labels.forEach((row,key)=>headers.slice(1).forEach((q,j)=>{if(TPOCore.quarter(q))add(legacy.name,row,j+2,modelLookup_('"dashboard|"&'+TPOCore.col(j+1)+'$1&"|'+key+'"'),null,true);}));
  const fr=mapFor('4. Forward-Looking Risk'),fraw=byName['4. Forward-Looking Risk'].raw;
  let coverageCol=fraw[0].findIndex(v=>String(v).toLowerCase()==='coverage');if(coverageCol<0){coverageCol=fraw[0].length;add('4. Forward-Looking Risk',1,coverageCol+1,'Coverage');}
  ['prior','current'].forEach((period,i)=>{
    ['label',...TPOCore.metrics,'riskStatus'].forEach((key,j)=>add('4. Forward-Looking Risk',i+2,fr[j]+1,modelLookup_(literal('forward|'+period+'|'+key)),null,true));
    add('4. Forward-Looking Risk',i+2,coverageCol+1,modelLookup_(literal('forward|'+period+'|coverage')),null,true);
  });
  const assumptions=byName.Assumptions;
  assumptions.raw.slice(1).forEach((r,i)=>{
    const row=i+2,label=String(r[3]||'');
    if(/reporting period/i.test(label))add('Assumptions',row,5,modelLookup_('"meta|latest-month"'),null,true);
    if(/cordon|quarter coverage/i.test(label)){add('Assumptions',row,4,'Quarter coverage');add('Assumptions',row,5,modelLookup_('"meta|coverage"'),null,true);}
    if(/Q[1-4]\s+\d{4}/i.test(label)&&/customer revenue total|P&L Total Revenue/i.test(label)) {
      const prefix=/P&L/i.test(label)?'quarter':'portfolio';
      add('Assumptions',row,5,modelLookup_('"'+prefix+'|"&UPPER(REGEXEXTRACT(D'+row+',"(?i)Q[1-4]\\s+[0-9]{4}"))&"|revenue"'),null,true);
    }
    if(/gap/i.test(label)&&row>=4)add('Assumptions',row,5,'=IF(COUNT(E'+(row-2)+':E'+(row-1)+')=2,E'+(row-2)+'-E'+(row-1)+',"")','Blank-safe reconciliation gap',true);
  });
  const range=name=>{
    const s=byName[name],sh=sheet_(name),rows=Math.max(1000,sh?sh.getMaxRows():1000,s.raw.length+100),width=Math.max(...s.raw.map(r=>r.length));
    return "'"+name.replace(/'/g,"''")+"'!A1:"+TPOCore.col(width-1)+rows;
  };
  const parameter=(name,fallback)=>{const i=assumptions.raw.findIndex(r=>String(r[3]||'').toLowerCase()===name.toLowerCase());return i<0?literal(fallback):'Assumptions!E'+(i+1);};
  const args=[range('MonthlyFinancials'),"Assumptions!A1:B"+Math.max(1000,sheet_('Assumptions').getMaxRows(),assumptions.raw.length+100),range('CustomerRevenueMonthly'),range('CustomerRevenueQuarterly'),range('CustomerCount'),range('1. Working Capital'),range('Dashboard Inputs'),parameter('Low season',''),parameter('Active Customers rule','count at first month of the quarter'),parameter('Currency','THB'),literal(TPO.timezone)];
  args.push(sheet_('Report Settings')?"'Report Settings'!B2":'""');
  add('Report Model',1,1,'=TPO_REPORT_MODEL('+args.join(',')+')','One range-fed shared calculation engine',true);
  return Array.from(new Map(plan.map(p=>[p.sheet+'|'+p.row+'|'+p.col,p])).values());
}
function repairAndScaffold_(nextMonth) {
  const sources=readSources_(),a=TPOCore.analyze(sources),derived=['Quarterly Financials','2. Customer Economics','3. Strategic Dashboard','4. Forward-Looking Risk'];
  // Derived formula failures are repairable; primary-input errors must be resolved first.
  const blocking=a.issues.filter(i=>i.level==='error'&&!derived.includes(i.sheet)&&!(i.sheet==='Assumptions'&&/^E\d+$/.test(i.cell)));
  if(blocking.length){writeValidation_(a);throw new Error('Resolve Data Validation first: '+blocking[0].sheet+'!'+blocking[0].cell+' '+blocking[0].message);}
  if(!a.latest)throw new Error('Enter at least one valid actual month before preparing slots or calculations.');
  const next=nextMonth?TPOCore.month(new Date(Date.UTC(a.latest.period.year,a.latest.period.month,1))):null;
  const helper=sheet_('Report Model');
  if(helper&&helper.getLastRow()&& !/^=TPO_REPORT_MODEL\(/.test(helper.getRange(1,1).getFormulas()[0][0]))throw new Error('Report Model contains unrelated content. Rename that sheet before setup.');
  const plan=repairPlan_(sources,a,next),ss=SpreadsheetApp.getActiveSpreadsheet();
  const sizes=new Map();plan.forEach(p=>{const size=sizes.get(p.sheet)||[0,0];size[0]=Math.max(size[0],p.row);size[1]=Math.max(size[1],p.col);sizes.set(p.sheet,size);});
  // Reserve model inputs and spill capacity before any cell changes.
  sizes.forEach((size,name)=>{const sh=sheet_(name)||ss.insertSheet(name);ensureSize_(sh,Math.max(1000,size[0]+100),Math.max(2,size[1]));});
  ensureSize_(sheet_('Report Model'),Math.max(2000,a.cq.length*4+a.quarterly.length*20+1000),2);
  // The range builder includes 100 spare rows, including unchanged source tables.
  ['MonthlyFinancials','Assumptions','CustomerRevenueMonthly','CustomerRevenueQuarterly','CustomerCount','1. Working Capital','Dashboard Inputs'].forEach(name=>{const sh=sheet_(name);ensureSize_(sh,Math.max(1000,sh.getLastRow()+100),Math.max(2,sh.getLastColumn()));});
  backupAndWrite_(plan,next?'Prepare '+next.display+' slots':'Install dynamic calculations');
  SpreadsheetApp.flush();repairTimezone_(ss);
  const updated=readSources_(),checked=analyzeReportSources_(updated);applyFormats_(updated,checked);
  ss.setActiveSheet(writeValidation_(checked));
  return next?next.display:null;
}
function menuRepairCalculated() {uiAction_('Repair calculated sheets',()=>locked_(()=>repairAndScaffold_(false)));}
function menuPrepareNextMonthSlots() {
  uiAction_('Prepare Next Month Slots',()=>locked_(()=>{
    const next=repairAndScaffold_(true),message='Prepared '+next+' input slots. Fill raw amounts; leave unknown values blank. Repeating this action preserves existing inputs.';
    // Editor runs may lack a bound UI even though spreadsheet writes succeed.
    console.info(message);try{SpreadsheetApp.getActiveSpreadsheet().toast(message,'TPO',10);}catch(notificationError){console.info('Setup completed; notification unavailable: '+notificationError.message);}
  }));
}
