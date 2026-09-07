/* =========================================================
   compute.js — deterministic math layer (no LLM, no DOM).
   Synthesizer-not-calculator iron law lives here.
   ========================================================= */
(function () {
  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  let LOW_SEASON = new Set(["Jun","Jul","Aug","Sep","Oct"]);

  function setLowSeason(monthsArray) {
    if (Array.isArray(monthsArray)) {
      LOW_SEASON = new Set(monthsArray);
    }
  }

  /** Parse "May-26" → {mon:5, yr:2026, idx: <months since anchor>} */
  function parseMonth(label) {
    const p=window.TPOCore.month(label);
    return p ? {mon:p.month-1,yr:p.year,key:p.display} : null;
  }
  function isLowSeason(label) {
    const p = parseMonth(label); return p ? LOW_SEASON.has(MONTH_NAMES[p.mon]) : false;
  }
  function quarterOf(label) {
    const p = parseMonth(label); if (!p) return null;
    return `Q${Math.floor(p.mon / 3) + 1} ${p.yr}`;
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return "—";
    const abs = Math.abs(n);
    let s;
    if (abs >= 1e6) s = "฿" + (n / 1e6).toFixed(2) + "M";
    else if (abs >= 1e3) s = "฿" + (n / 1e3).toFixed(1) + "K";
    else s = "฿" + Math.round(n).toLocaleString();
    return s;
  }
  function fmtMoneyFull(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return "—";
    return "฿" + Math.round(n).toLocaleString();
  }
  function fmtPct(n, digits = 1) {
    if (n === null || n === undefined || !Number.isFinite(n)) return "—";
    return (n * 100).toFixed(digits) + "%";
  }
  function fmtPctDelta(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return "—";
    const sign = n >= 0 ? "+" : "";
    return sign + (n * 100).toFixed(1) + "%";
  }

  /** Group monthly rows by quarter → quarter totals. */
  function rollupQuarterly(monthly) {
    const groups=new Map();
    monthly.forEach(r=>{const q=quarterOf(r.month);if(!q)return;const a=groups.get(q)||[];a.push(r);groups.set(q,a);});
    return Array.from(groups,([quarter,rows])=>{
      const r={quarter,months:rows.map(m=>m.month),complete:rows.length===3};
      window.TPOCore.metrics.forEach(k=>r[k]=window.TPOCore.sum(rows.map(m=>m[k])));return r;
    }).sort((a,b)=>window.TPOCore.quarter(a.quarter).key-window.TPOCore.quarter(b.quarter).key);
  }
  /** Roll-up customer revenue → per-customer quarterly totals + GP. */
  function rollupCustomerQuarterly(customerRevenue, marginByName) {
    const out = {}; // slug -> [{quarter, revenue, gp}]
    const parse = (q) => {
      const m = /^Q([1-4])\s+(\d{4})$/.exec(String(q || ""));
      return m ? { y: +m[2], q: +m[1] } : { y: 9999, q: 9 };
    };
    for (const slug in customerRevenue) {
      const c = customerRevenue[slug];
      const margin = marginByName[c.name] ?? null;
      const byQ = {};
      for (const p of c.series) {
        const q = quarterOf(p.month); if (!q) continue;
        const slot = byQ[q] || (byQ[q] = { quarter: q, revenue: 0 });
        slot.revenue += p.revenue;
      }
      const series = Object.values(byQ)
        .sort((a, b) => {
          const A = parse(a.quarter), B = parse(b.quarter);
          return A.y - B.y || A.q - B.q;
        })
        .map(s => ({
          ...s,
          gp: margin !== null ? s.revenue * margin : null,
        }));
      out[slug] = { ...c, margin, quarterly: series };
    }
    return out;
  }

  /** Concentration: each customer's share of total revenue (latest month). */
  function concentrationLatest(customerRevenue, monthly) {
    if (!monthly.length) return { latest: null, items: [] };
    const latest = monthly[monthly.length - 1].month;
    const items = [];
    let total = 0;
    for (const slug in customerRevenue) {
      const c = customerRevenue[slug];
      const pt = c.series.find(p => p.month === latest);
      if (pt && pt.revenue !== null) { items.push({ slug: c.slug, name: c.name, revenue: pt.revenue }); total += pt.revenue; }
    }
    items.sort((a, b) => b.revenue - a.revenue);
    items.forEach(i => { i.share = total > 0 ? i.revenue / total : 0; });
    return { latest, total, items };
  }

  /** NWC series from the shaped Working Capital object.
   *  workingCapital = { months:[], series:[{key:'cash',values:[]}, ...] }.
   *  If the sheet provides an NWC column we use it; otherwise recompute
   *  Cash + AR + Inventory − AP. */
  function nwcSeries(workingCapital) {
    const wc = workingCapital || { months: [], series: [] };
    const get = (key) => (wc.series.find(s => s.key === key) || {}).values || [];
    const cash = get("cash"), ar = get("ar"), inv = get("inventory"),
          ap = get("ap"), nwcRow = get("nwc");
    return (wc.months || []).map((mo, idx) => {
      const c = cash[idx] ?? null;
      const a = ar[idx] ?? null;
      const i = inv[idx] ?? null;
      const p = ap[idx] ?? null;
      const provided = nwcRow[idx];
      const nwc = window.TPOCore.sum([c,a,i,p===null?null:-p]);
      return { month: mo, cash: c, ar: a, inventory: i, ap: p, nwc };
    });
  }

  /** Q2 2026 cordon: is the current period a partial quarter? */
  function quarterCordon(monthly, currentQuarterLabel) {
    const inQ = monthly.filter(m => (m.quarter || quarterOf(m.month)) === currentQuarterLabel);
    const monthCount = inQ.length;
    const isPartial = monthCount > 0 && monthCount < 3;
    const latestMonth = inQ.length ? inQ[inQ.length - 1].month : null;
    return { quarter: currentQuarterLabel, monthCount, isPartial, latestMonth };
  }

  /** Reconciliation: sum customer revenue vs P&L revenue per month. */
  function reconciliation(customerRevenueTotalByMonth, monthly) {
    const flags = [];
    for (const m of monthly) {
      const sumCust = customerRevenueTotalByMonth[m.month] ?? null;
      const pnl = m.revenue ?? null;
      if (sumCust===null || pnl===null) continue;
      const diff    = sumCust - pnl;
      // Allow tiny rounding tolerance
      if (Math.abs(diff) > Math.max(1, pnl * 0.005)) {
        flags.push({ month: m.month, sumCustomer: sumCust, pnl, diff, ratio: pnl ? sumCust / pnl : null });
      }
    }
    return flags;
  }

  /** Find a specific dashboard value by label substring. */
  function dashboardLookup(dashboard, labelPart) {
    const lc = labelPart.toLowerCase();
    return dashboard.items.find(i => i.label.toLowerCase().includes(lc)) || null;
  }

  /** Financial Performance comparison: Q1 25 vs Q1 26, plus Q2 26 partial. */
  function financialComparison(monthly, quarterly) {
    const byQ = rollupQuarterly(monthly);
    const find = (q) => byQ.find(x => x.quarter === q) || null;
    const q1_25 = find("Q1 2025");
    const q1_26 = find("Q1 2026");
    const q2_26 = find("Q2 2026");
    const q2_25 = find("Q2 2025");
    const delta = (a, b) => (a && b && b.revenue) ? (a.revenue - b.revenue) / b.revenue : null;
    return {
      byQuarter: byQ,
      q1_25, q1_26, q2_26, q2_25,
      deltaQ1YoY: delta(q1_26, q1_25),
      deltaQ2YoY: q2_26 && q2_25 && q2_25.revenue ? (q2_26.revenue - q2_25.revenue) / q2_25.revenue : null,
      q2_26Months: q2_26 ? q2_26.months : [],
    };
  }

  /** Peak / trough customer counts (for "92 → 32" storyline). */
  function customerCountStoryline(customerCount) {
    if (!customerCount.length) return { peak: null, trough: null, delta: null };
    const peak   = customerCount.reduce((a, b) => (a.count > b.count ? a : b));
    const trough = customerCount.reduce((a, b) => (a.count < b.count ? a : b));
    return {
      peak, trough,
      delta: peak.count && trough.count ? (trough.count - peak.count) / peak.count : null,
    };
  }

  /** EBITDA proxy from a quarterly row (EBIT is provided; EBITDA ≈ EBIT in this dataset). */
  function ebitda(quarter) {
    return quarter ? quarter.ebit : null;
  }

  /** Render flag for Q2-partial bars: which month indices in a series are partial (not full Q). */
  function partialMonthIndices(monthsInQuarter) {
    return monthsInQuarter.length < 3 ? monthsInQuarter.map((_, i) => i) : [];
  }

  window.TPO_COMPUTE = {
    parseMonth, isLowSeason, setLowSeason, quarterOf,
    fmtMoney, fmtMoneyFull, fmtPct, fmtPctDelta,
    rollupQuarterly, rollupCustomerQuarterly,
    concentrationLatest, nwcSeries,
    quarterCordon, reconciliation,
    dashboardLookup, financialComparison,
    customerCountStoryline, ebitda,
    partialMonthIndices,
  };
})();