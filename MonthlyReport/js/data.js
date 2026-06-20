/* =========================================================
   data.js — live Google Sheets reader + shaper.
   - batchGet all tabs in one HTTP call
   - shape into typed structures for the compute + view layer
   - handle graceful empty-state when sheet is unshared
   ========================================================= */
(function () {
  const C = window.TPO_CONFIG;
  const ENDPOINT = C.SHEETS_ENDPOINT;

  /** ---------- low-level fetch ---------- */
  async function fetchTab(tabName) {
    const range = encodeURIComponent(`'${tabName}'`);
    const url = `${ENDPOINT}/${C.SHEET_ID}/values/${range}?key=${C.API_KEY}`;
    const r = await fetch(url);
    if (r.status === 400 || r.status === 403 || r.status === 404) {
      // Sheet likely unshared or key invalid
      const body = await r.json().catch(() => ({}));
      const err  = new Error(body?.error?.message || `Sheet returned ${r.status}`);
      err.code = r.status;
      throw err;
    }
    if (!r.ok) throw new Error(`Sheets API error ${r.status}`);
    const json = await r.json();
    return json.values || [];
  }

  /** ---------- type coercers ---------- */
  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return v;
    // Strip commas, currency, spaces, parentheses (negatives)
    const s = String(v).replace(/[฿,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }
  function int(v) {
    const n = num(v); return n === null ? null : Math.round(n);
  }
  function pct(v) {
    // Sheet may store 0.7 (fraction) or 70% — accept both
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "string" && v.endsWith("%")) return num(v.slice(0, -1)) / 100;
    const n = num(v); return n === null ? null : (n > 1.5 ? n / 100 : n);
  }
  function trim(v) { return (v ?? "").toString().trim(); }
  function slugify(s) { return s.toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

  /** ---------- per-tab shapers ---------- */

  // Assumptions: rows of {customer, margin} + {key, value} params in cols D-E
  function shapeAssumptions(rows) {
    const customers = [];
    const params = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const cust = trim(r[0]);
      const mar  = pct(r[1]);
      if (cust && mar !== null) {
        customers.push({ name: cust, slug: slugify(cust), margin: mar });
      }
      const k = trim(r[3]); const v = trim(r[4]);
      if (k) params[k] = v;
    }
    return { customers, params };
  }

  // MonthlyFinancials ACTUAL layout (verified against the sheet):
  //   A Month | B Total Revenue | C COGS | D Gross Profit | E SG&A | F EBIT | G Net Income | H Quarter
  // (Quarter is in column H, NOT B — the previous version read the wrong columns,
  //  showing COGS as Revenue everywhere. Quarter may be blank; compute.js derives
  //  it from the month label when it is.)
  function shapeMonthly(rows) {
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const month = trim(r[0]); if (!month) continue;
      out.push({
        month,
        revenue:   num(r[1]),
        cogs:      num(r[2]),
        gp:        num(r[3]),
        sga:       num(r[4]),
        ebit:      num(r[5]),
        netIncome: num(r[6]),
        quarter:   (r && r[7] instanceof Date) ? "" : trim(r[7]),
      });
    }
    return out;
  }

  // CustomerRevenueMonthly: Customer, Month, Revenue
  function shapeCustomerRevenue(rows) {
    const byCustomer = {}; // slug -> [{month, revenue}]
    const totalsByMonth = {}; // month -> total
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const cust = trim(r[0]); const month = trim(r[1]);
      const rev = num(r[2]); if (!cust || !month || rev === null) continue;
      const slug = slugify(cust);
      (byCustomer[slug] = byCustomer[slug] || { name: cust, slug, series: [] })
        .series.push({ month, revenue: rev });
      totalsByMonth[month] = (totalsByMonth[month] || 0) + rev;
    }
    return { byCustomer, totalsByMonth };
  }

  // CustomerRevenueQuarterly: Customer, Quarter, Revenue (long format).
  // Returns { slug -> { name, slug, quarterly: [{quarter, revenue}] } },
  // each customer's quarters sorted chronologically. Revenue may be null
  // (early quarters without sales) — the chart shows those as gaps.
  function shapeCustomerRevenueQuarterly(rows) {
    const byCustomer = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const cust = trim(r[0]); const q = trim(r[1]); const rev = num(r[2]);
      if (!cust || !q) continue;
      const slug = slugify(cust);
      (byCustomer[slug] = byCustomer[slug] || { name: cust, slug, quarterly: [] })
        .quarterly.push({ quarter: q, revenue: rev });
    }
    const parse = (q) => { const m = /^Q([1-4])\s+(\d{4})$/.exec(q || ""); return m ? { y: +m[2], q: +m[1] } : { y: 9999, q: 9 }; };
    for (const slug in byCustomer) {
      byCustomer[slug].quarterly.sort((a, b) => { const A = parse(a.quarter), B = parse(b.quarter); return A.y - B.y || A.q - B.q; });
    }
    return byCustomer;
  }

  // CustomerCount: Month, count
  function shapeCustomerCount(rows) {
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const month = trim(r[0]); const c = int(r[1]);
      if (!month || c === null) continue;
      out.push({ month, count: c });
    }
    return out;
  }

  // Quarterly Financials — supports TWO layouts (auto-detected):
  //   LONG (preferred, consistent with MonthlyFinancials):
  //       Quarter | Total Revenue | COGS | Gross Profit | SG&A | EBIT | Net Income
  //       Q1 2025 | ...   (header row has "Quarter" in column A; data below)
  //   WIDE (legacy/board matrix):
  //       [title row] then  Line | Q1 2025 | Q2 2025 | …   (line items as rows)
  // Returns { quarters: [{quarter, revenue, cogs, gp, sga, ebit, netIncome}] }
  // sorted chronologically. Works before AND after the user transposes their sheet.
  function shapeQuarterlyBoard(rows) {
    const empty = { quarters: [] };
    if (!rows || !rows.length) return empty;
    const parseQ = (q) => { const m = /^Q([1-4])\s+(\d{4})$/.exec(trim(q)); return m ? { y: +m[2], q: +m[1] } : { y: 9999, q: 9 }; };
    const sortQ = (a, b) => { const A = parseQ(a.quarter), B = parseQ(b.quarter); return A.y - B.y || A.q - B.q; };
    const isQ = (q) => /^Q[1-4]\s+\d{4}/.test(trim(q));

    // detect LONG: a row in the first 4 whose col A == "Quarter"
    let longHeader = -1;
    for (let i = 0; i < Math.min(rows.length, 4); i++) {
      if (trim(rows[i][0]).toLowerCase() === "quarter") { longHeader = i; break; }
    }
    if (longHeader >= 0) {
      const out = [];
      for (let i = longHeader + 1; i < rows.length; i++) {
        const r = rows[i]; const q = trim(r[0]);
        if (!isQ(q)) continue;
        out.push({
          quarter: q,
          revenue: num(r[1]), cogs: num(r[2]), gp: num(r[3]),
          sga: num(r[4]), ebit: num(r[5]), netIncome: num(r[6]),
        });
      }
      out.sort(sortQ);
      return { quarters: out };
    }

    // WIDE (legacy): header row whose col A == "Line"
    let wideHeader = -1;
    for (let i = 0; i < Math.min(rows.length, 4); i++) {
      if (trim(rows[i][0]).toLowerCase() === "line") { wideHeader = i; break; }
    }
    if (wideHeader < 0) return empty;
    const hdr = rows[wideHeader];
    const qLabels = hdr.slice(1).map(trim).filter(isQ);
    // map line-item label (lowercased) -> the row
    const lineRow = {};
    for (let i = wideHeader + 1; i < rows.length; i++) {
      const lbl = trim(rows[i][0]).toLowerCase();
      if (lbl) lineRow[lbl] = rows[i];
    }
    const colFor = (qLabel) => { for (let c = 1; c < hdr.length; c++) if (trim(hdr[c]) === qLabel) return c; return -1; };
    const getv = (label, qLabel) => {
      const r = lineRow[label]; if (!r) return null;
      const c = colFor(qLabel); return c < 0 ? null : num(r[c]);
    };
    const out = qLabels.map(q => ({
      quarter: q,
      revenue:   getv("total revenue", q),
      cogs:      getv("cogs", q),
      gp:        getv("gross profit", q),
      sga:       getv("sg&a", q),
      ebit:      getv("ebit", q),
      netIncome: getv("net income", q),
    }));
    out.sort(sortQ);
    return { quarters: out };
  }

  // "1. Working Capital" — header IS row 0 (no title row), data from row 1.
  //   Returns: months[], named component series[], plus explicit table headers
  //   and rows so the board-table echo renders a correct "Reporting Month"
  //   column. Drops the "<add month>" placeholder.
  function shapeWorkingCapitalBoard(rows) {
    const empty = { months: [], series: [], tableHeaders: [], tableRows: [] };
    if (!rows.length) return empty;
    const headers = (rows[0] || []).map(trim);
    const compDefs = [
      { key: "cash",      label: "Cash",                col: 1 },
      { key: "ar",        label: "AR",                  col: 2 },
      { key: "inventory", label: "Inventory",           col: 3 },
      { key: "ap",        label: "AP",                  col: 4 },
      { key: "nwc",       label: "Net Working Capital", col: 5 },
    ];
    const months = [];
    const series = compDefs.map(d => ({ key: d.key, name: d.label, values: [] }));
    const tableRows = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const label = trim(r[0]);
      if (!label) continue;
      if (/add\s*month/i.test(label)) continue; // placeholder, not real data
      const vals = compDefs.map(d => num(r[d.col]));
      // skip a row that is entirely empty
      if (vals.every(v => v === null || v === undefined)) continue;
      months.push(label);
      compDefs.forEach((d, idx) => series[idx].values.push(vals[idx]));
      tableRows.push({ label, values: vals });
    }
    return { months, series, tableHeaders: headers, tableRows };
  }

  // "2. Customer Economics" — header IS row 0, data from row 1.
  //   Returns per-customer records {name, quarter, revenue, concentration, gp, margin}
  //   plus the Total Portfolio row separated out. Primary source for Customers views.
  function shapeCustomerEconBoard(rows) {
    if (!rows.length) return { headers: [], customers: [], total: null };
    const headers = (rows[0] || []).map(trim);
    const customers = [];
    let total = null;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = trim(r[0]); if (!name) continue;
      const rec = {
        name,
        quarter: trim(r[1]),
        revenue: num(r[2]),
        concentration: pct(r[3]),
        gp: num(r[4]),
        margin: pct(r[5]),
      };
      if (/total/i.test(name)) total = rec;
      else customers.push(rec);
    }
    return { headers, customers, total };
  }

  // "3. Strategic Dashboard" — header IS row 0, data from row 1.
  //   Returns periods[] (column headers) + metric rows {label, values:[per period]}.
  //   Values are kept raw (the sheet stores formatted strings like "76", "85.00%",
  //   "฿95,136") so the KPI matrix table can show them verbatim; charting code
  //   parses them with num()/pct() as needed.
  function shapeDashboardBoard(rows) {
    if (!rows.length) return { periods: [], metrics: [] };
    const headers = (rows[0] || []).map(trim);
    const periods = headers.slice(1).filter(Boolean);
    const metrics = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const label = trim(r[0]); if (!label) continue;
      const values = periods.map((_, p) => (r[p + 1] === undefined ? null : r[p + 1]));
      metrics.push({ label, values });
    }
    return { periods, metrics };
  }

  // "4. Forward-Looking Risk" — header IS row 0, data from row 1.
  //   Real shape: Reporting Period | Revenue | COGS | Gross Profit | SG&A | Net Income | Risk Status
  //   Returns periods[] each {label, revenue, cogs, gp, sga, netIncome, riskStatus}.
  function shapeForwardLookingBoard(rows) {
    if (!rows.length) return { headers: [], lineNames: [], periods: [] };
    const headers = (rows[0] || []).map(trim);
    const lineNames = headers.slice(1, headers.length - 1); // Revenue … Net Income
    const periods = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const label = trim(r[0]); if (!label) continue;
      periods.push({
        label,
        revenue:   num(r[1]),
        cogs:      num(r[2]),
        gp:        num(r[3]),
        sga:       num(r[4]),
        netIncome: num(r[5]),
        riskStatus: trim(r[6]),
      });
    }
    return { headers, lineNames, periods };
  }

  // Commentary: View | Text | Status | Started | Error | Attempts | Thinking Info
  // - `out`     : { view → commentary }  (the text shown on the board)
  // - `thinking`: { view → thinking }    (reasoning trace, for debug views)
  function shapeCommentary(rows) {
    const out = {};
    const thinking = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const view = trim(r[0]); const text = trim(r[1]);
      if (!view) continue;
      if (text) out[view] = text;
      const t = trim(r[6]);
      if (t) thinking[view] = t;
    }
    return { out, thinking };
  }

  /** ---------- public load() ---------- */
  async function load() {
    const cfg = window.TPO_CONFIG;
    if (!cfg.SHEET_ID || cfg.SHEET_ID.startsWith("PUT_") ||
        !cfg.API_KEY  || cfg.API_KEY.startsWith("PUT_")) {
      const e = new Error("Config not filled in.");
      e.code = "CONFIG_MISSING";
      throw e;
    }

    // Fetch all tabs in parallel; skip ones that 404 individually
    const results = await Promise.allSettled(
      cfg.TABS.map(t => fetchTab(t).then(rows => [t, rows]))
    );

    const map = {};
    const errors = [];
    for (const r of results) {
      if (r.status === "fulfilled") map[r.value[0]] = r.value[1];
      else errors.push(r.reason?.message || String(r.reason));
    }

    // Top-level fatal: if Assumptions + MonthlyFinancials both failed,
    // treat as "sheet unreachable" so the empty-state can render.
    if (!map.Assumptions || !map.MonthlyFinancials) {
      const e = new Error(errors[0] || "Sheet is unreachable.");
      e.code = "SHEET_UNREACHABLE";
      e.detail = errors.join(" · ");
      throw e;
    }

    const assumptions = shapeAssumptions(map.Assumptions || []);
    const monthly     = shapeMonthly(map["MonthlyFinancials"] || []);
    const customerRev = shapeCustomerRevenue(map["CustomerRevenueMonthly"] || []);
    const customerRevQ = shapeCustomerRevenueQuarterly(map["CustomerRevenueQuarterly"] || []);
    const customerCt  = shapeCustomerCount(map["CustomerCount"] || []);
    const quarterly   = shapeQuarterlyBoard(map["Quarterly Financials"] || []);
    const workingCap  = shapeWorkingCapitalBoard(map["1. Working Capital"] || []);
    const customerEcon= shapeCustomerEconBoard(map["2. Customer Economics"] || []);
    const dashboard   = shapeDashboardBoard(map["3. Strategic Dashboard"] || []);
    const forwardLook = shapeForwardLookingBoard(map["4. Forward-Looking Risk"] || []);
    const commentaryShape = shapeCommentary(map.Commentary || []);
    const commentary          = commentaryShape.out;
    const commentaryThinking  = commentaryShape.thinking;

    return {
      assumptions,
      monthly,
      customerRevenue: customerRev.byCustomer,
      customerRevenueTotalByMonth: customerRev.totalsByMonth,
      customerRevenueQuarterly: customerRevQ,
      customerCount: customerCt,
      quarterly,
      workingCapital: workingCap,
      customerEcon: customerEcon,
      dashboard,
      forwardLooking: forwardLook,
      commentary,
      commentaryThinking,
      _errors: errors,        // non-fatal tab fetch failures
      _loadedAt: new Date(),
    };
  }

  window.TPO_DATA = { load, num, int, pct, trim, slugify };
})();