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

  // MonthlyFinancials: Month, Quarter, Revenue, COGS, GP, SG&A, EBIT, Net Income
  function shapeMonthly(rows) {
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const month = trim(r[0]); if (!month) continue;
      // Sheets can hand back Date objects for the Quarter cell if it was
      // mis-typed as a date — coerce to string defensively.
      const quarterRaw = r[1];
      const quarter = (quarterRaw instanceof Date)
        ? ""  // let compute.js derive it from the month label
        : trim(quarterRaw);
      out.push({
        month,
        quarter,
        revenue: num(r[2]),
        cogs:    num(r[3]),
        gp:      num(r[4]),
        sga:     num(r[5]),
        ebit:    num(r[6]),
        netIncome: num(r[7]),
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

  // Quarterly Financials (board table, precomputed in Sheets):
  //   Title row, header row, then 6 line-items × 5 quarters.
  //   Rows are labeled like "Total Revenue", "Gross Profit", etc.
  function shapeQuarterlyBoard(rows) {
    if (!rows.length) return { quarters: [], lines: [] };
    // First row is the big title (e.g. "Quarterly Financials (THB)")
    // Second row is the header: Line Item | Q1 2025 | Q2 2025 | ... | Q2 2026
    const header = rows[1] || rows[0];
    const quarters = header.slice(1).map(trim).filter(Boolean);
    const lines = [];
    for (let i = 2; i < rows.length; i++) {
      const r = rows[i];
      const label = trim(r[0]); if (!label) continue;
      const vals = [];
      for (let q = 0; q < quarters.length; q++) vals.push(num(r[q + 1]));
      lines.push({ label, values: vals });
    }
    return { quarters, lines };
  }

  // "1. Working Capital" board table:
  //   Row1 title, Row2 header (Reporting Month | Cash | AR | Inv | AP | NWC),
  //   then 6 month rows. (NWC is computed in the sheet: B+C+D-E.)
  function shapeWorkingCapitalBoard(rows) {
    if (!rows.length) return { months: [], rows: [] };
    const header = rows[1] || rows[0];
    const months = header.slice(1).map(trim).filter(Boolean);
    const dataRows = [];
    for (let i = 2; i < rows.length; i++) {
      const r = rows[i];
      const label = trim(r[0]); if (!label) continue;
      const vals = [];
      for (let m = 0; m < months.length; m++) vals.push(num(r[m + 1]));
      dataRows.push({ label, values: vals });
    }
    return { months, rows: dataRows };
  }

  // "2. Customer Economics" board table:
  //   Row1 title, Row2 sub-title, Row3 header (Customer | Revenue | GP | Margin | Mix),
  //   then 5 customer rows + a Total row.
  function shapeCustomerEconBoard(rows) {
    if (!rows.length) return { customers: [], totals: null };
    const header = rows[2] || rows[1] || rows[0];
    const customerNames = header.slice(1).map(trim).filter(Boolean);
    const matrix = {}; // label -> [vals...]
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      const label = trim(r[0]); if (!label) continue;
      const vals = [];
      for (let c = 0; c < customerNames.length; c++) vals.push(r[c + 1]);
      matrix[label] = vals;
    }
    return { customers: customerNames, matrix };
  }

  // "3. Strategic Dashboard" — single-column KPI stack
  //   Row1 title, Row2 subtitle, Row3 header (KPI | Value), then N KPI rows.
  function shapeDashboardBoard(rows) {
    if (!rows.length) return { items: [] };
    const items = [];
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      const label = trim(r[0]); if (!label) continue;
      items.push({ label, value: trim(r[1]), note: trim(r[2] || "") });
    }
    return { items };
  }

  // "4. Forward-Looking Risk" — 2-column risk rows
  //   Row1 title, Row2 subtitle, Row3 header (Risk | Status | Mitigation),
  //   then N risk rows.
  function shapeForwardLookingBoard(rows) {
    if (!rows.length) return { items: [] };
    const items = [];
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i];
      const label = trim(r[0]); if (!label) continue;
      items.push({ label, status: trim(r[1] || ""), mitigation: trim(r[2] || "") });
    }
    return { items };
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