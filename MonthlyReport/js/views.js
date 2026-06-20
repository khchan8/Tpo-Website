/* =========================================================
   views.js — render functions for every SPA view.
   Each view returns an HTMLElement (or a DocumentFragment)
   to be mounted by the router. No business logic here —
   only layout + ECharts options + commentary display.
   ========================================================= */
(function () {
  const C = window.TPO_CONFIG;
  const D = window.TPO_DATA;
  const K = window.TPO_COMPUTE;

  /* ---------- helpers ---------- */
  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) e.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return e;
  }
  function section(eyebrow, title, subtitle) {
    const head = el("div", { class: "mb-6" },
      eyebrow ? el("div", { class: "text-xs uppercase tracking-widest text-sea font-semibold mb-1" }, eyebrow) : null,
      el("h1", { class: "font-serif text-3xl md:text-4xl text-ink leading-tight" }, title),
      subtitle ? el("p", { class: "text-mute mt-2 max-w-3xl" }, subtitle) : null,
      el("div", { class: "heading-rule mt-4" }),
    );
    return el("div", { class: "mb-8" }, head);
  }
  function kpiTile(label, value, sub, variant = "") {
    const cls = "kpi " + (variant ? `kpi-${variant}` : "");
    return el("div", { class: cls },
      el("div", { class: "kpi-bar" }),
      el("div", { class: "kpi-label" }, label),
      el("div", { class: "kpi-value" }, value),
      sub ? el("div", { class: "kpi-sub" }, sub) : null,
    );
  }
  function briefingCard(viewKey, commentary, fallback) {
    const text = commentary?.[viewKey];
    const body = text && text.trim()
      ? text
      : (fallback || "Commentary pending — click “Generate Commentary” in the Google Sheet menu.");
    return el("div", { class: "briefing" },
      el("h3", {}, "Briefing"),
      el("div", {}, body),
    );
  }
  function warnBanner(text) {
    return el("div", { class: "note-warn mb-6" },
      el("span", { class: "font-semibold" }, "Data note"),
      el("span", {}, text),
    );
  }
  function chartHost(height = 320) {
    const d = el("div", { style: `width:100%;height:${height}px;` });
    return d;
  }
  function ensureChart(host, opt) {
    const inst = echarts.init(host);
    inst.setOption(opt);
    return inst;
  }
  function sawtoothDivider() {
    return el("div", { class: "sawtooth my-8" });
  }
  function lowSeasonMarkArea(series) {
    // Add low-season markArea to the LAST series in the chart (ECharts quirk)
    const low = [];
    let open = null;
    series.forEach((label, i) => {
      const inLow = K.isLowSeason(label);
      if (inLow && open === null) open = label;
      if (!inLow && open !== null) { low.push([{ xAxis: open }, { xAxis: series[i - 1] }]); open = null; }
    });
    if (open !== null) low.push([{ xAxis: open }, { xAxis: series[series.length - 1] }]);
    return low.map(([a, b]) => [{ xAxis: a.xAxis }, { xAxis: b.xAxis }]);
  }

  /* ---------- ECharts shared theme ---------- */
  const ECHART_THEME = {
    color: ["#115E67","#1A8A96","#C9A24B","#0B1F3A","#5B6B7E","#7FB7A6","#A14B2A"],
    textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: "#0B1F3A" },
    grid: { left: 50, right: 24, top: 36, bottom: 40 },
    legend: { textStyle: { color: "#5B6B7E" }, top: 4 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#fff",
      borderColor: "#D9D2C0",
      textStyle: { color: "#0B1F3A" },
      valueFormatter: v => K.fmtMoneyFull(v),
    },
    xAxis: {
      axisLine: { lineStyle: { color: "#D9D2C0" } },
      axisLabel: { color: "#5B6B7E", fontSize: 11 },
    },
    yAxis: {
      axisLine: { show: false },
      axisLabel: { color: "#5B6B7E", fontSize: 11, formatter: v => K.fmtMoney(v) },
      splitLine: { lineStyle: { color: "#EEEAE0" } },
    },
  };

  /* =========================================================
     VIEWS
     ========================================================= */

  // ---- Overview ----
  function viewOverview(state) {
    const { data } = state;
    const monthly = data.monthly;
    const last    = monthly[monthly.length - 1];
    const prev    = monthly[monthly.length - 2] || last;
    const storyline = K.customerCountStoryline(data.customerCount);
    const concentration = K.concentrationLatest(data.customerRevenue, monthly);
    const quarterly = K.rollupQuarterly(monthly);
    const currentQ  = last?.quarter || K.quarterOf(last?.month);
    const cordon    = K.quarterCordon(monthly, currentQ);
    const recon     = K.reconciliation(data.customerRevenueTotalByMonth, monthly);
    const reconLatest = recon.filter(r => r.month === last?.month);

    // KPI tiles (Strategic Dashboard mirror)
    const ytdRev = monthly.filter(m => m.month && K.parseMonth(m.month)?.yr === K.parseMonth(last.month)?.yr)
                           .reduce((s, m) => s + (m.revenue || 0), 0);
    const ytdGP  = monthly.filter(m => m.month && K.parseMonth(m.month)?.yr === K.parseMonth(last.month)?.yr)
                           .reduce((s, m) => s + (m.gp || 0), 0);
    const margin = ytdRev ? ytdGP / ytdRev : null;

    const kpis = el("div", { class: "grid grid-cols-2 md:grid-cols-4 gap-4 mb-8" },
      kpiTile("Latest month revenue", K.fmtMoneyFull(last?.revenue), last?.month || ""),
      kpiTile("YTD revenue", K.fmtMoney(ytdRev), `${K.parseMonth(last.month)?.yr || ""} YTD`),
      kpiTile("YTD gross margin", K.fmtPct(margin), "GP / Revenue"),
      kpiTile("Active customers (latest)", concentration.total ? `${concentration.items.length}` : "—",
              concentration.latest ? `as of ${concentration.latest}` : ""),
    );

    // Revenue trend chart (sawtooth with low-season band)
    const months = monthly.map(m => m.month);
    const rev    = monthly.map(m => m.revenue);
    const trendChart = chartHost(320);
    const trendOpt = {
      ...ECHART_THEME,
      legend: { ...ECHART_THEME.legend, data: ["Revenue"] },
      xAxis: { ...ECHART_THEME.xAxis, type: "category", data: months },
      yAxis: { ...ECHART_THEME.yAxis, type: "value" },
      series: [{
        name: "Revenue", type: "line", smooth: false, symbol: "circle", symbolSize: 5,
        lineStyle: { color: "#115E67", width: 2 },
        itemStyle: { color: "#115E67" },
        areaStyle: { color: "rgba(17,94,103,0.08)" },
        data: rev,
        markArea: {
          silent: true,
          itemStyle: { color: "rgba(201,162,75,0.10)" },
          label: { show: false },
          data: lowSeasonMarkArea(months),
        },
      }],
    };

    // Concentration donut
    const donutChart = chartHost(260);
    const donutOpt = {
      ...ECHART_THEME,
      tooltip: { ...ECHART_THEME.tooltip, trigger: "item", valueFormatter: v => K.fmtMoneyFull(v) },
      legend: { ...ECHART_THEME.legend, bottom: 0 },
      series: [{
        type: "pie", radius: ["50%", "75%"], center: ["50%", "45%"],
        itemStyle: { borderColor: "#fff", borderWidth: 2 },
        label: { formatter: "{b}\n{d}%", color: "#0B1F3A", fontSize: 11 },
        data: concentration.items.map(i => ({ name: i.name, value: i.revenue })),
      }],
    };

    const layout = el("div", {},
      section("Strategic Dashboard", "Overview", "Top-line performance and customer mix at a glance."),
      recon.length ? warnBanner(`Customer-level revenue and P&L revenue disagree on ${recon.length} month(s) — e.g. ${reconLatest[0]?.month || ""}: Σ customer ${K.fmtMoneyFull(reconLatest[0]?.sumCustomer)} vs P&L ${K.fmtMoneyFull(reconLatest[0]?.pnl)}. Site continues with a WARN indicator; reconcile in the sheet.`) : null,
      kpis,
      el("div", { class: "grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8" },
        el("div", { class: "lg:col-span-2 bg-white border border-rule rounded-md p-5 shadow-brief" },
          el("div", { class: "flex items-center justify-between mb-2" },
            el("h2", { class: "font-serif text-xl text-ink" }, "Monthly revenue — sawtooth & low season"),
            el("div", { class: "flex items-center gap-2" },
              el("span", { class: "chip chip-partial" }, cordon.isPartial ? `${cordon.quarter} — ${cordon.monthCount} months` : "Full quarter"),
            ),
          ),
          trendChart,
        ),
        el("div", { class: "bg-white border border-rule rounded-md p-5 shadow-brief" },
          el("h2", { class: "font-serif text-xl text-ink mb-2" }, "Customer mix"),
          el("div", { class: "text-xs text-mute mb-2" }, `Latest month · ${concentration.latest}`),
          donutChart,
        ),
      ),
      sawtoothDivider(),
      el("div", { class: "grid grid-cols-1 md:grid-cols-2 gap-6 mb-8" },
        el("div", {},
          el("div", { class: "bg-white border border-rule rounded-md p-5 shadow-brief" },
            el("h2", { class: "font-serif text-xl text-ink mb-3" }, "Customer count — peak & trough"),
            el("p", { class: "text-sm text-mute mb-4" }, "The seasonal contraction — from peak to trough — anchors the turnaround storyline."),
            el("div", { class: "grid grid-cols-3 gap-3" },
              kpiTile("Peak",    storyline.peak   ? `${storyline.peak.count}`   : "—", storyline.peak?.month   || ""),
              kpiTile("Trough",  storyline.trough ? `${storyline.trough.count}` : "—", storyline.trough?.month || ""),
              kpiTile("Δ",       K.fmtPctDelta(storyline.delta), "trough vs peak"),
            ),
          ),
        ),
        briefingCard("overview", data.commentary,
          "Q2 2026 is a partial quarter — figures shown are Through May only and must not be annualized."),
      ),
    );

    // Mount + init charts
    queueMicrotask(() => {
      ensureChart(trendChart, trendOpt);
      ensureChart(donutChart, donutOpt);
    });

    return layout;
  }

  // ---- Seasonality ----
  function viewSeasonality(state) {
    const { data } = state;
    const monthly = data.monthly;
    const months  = monthly.map(m => m.month);
    const rev     = monthly.map(m => m.revenue);
    const gp      = monthly.map(m => m.gp);
    const ct      = data.customerCount;

    const chart = chartHost(360);
    const opt = {
      ...ECHART_THEME,
      legend: { ...ECHART_THEME.legend, data: ["Revenue","Gross Profit"] },
      xAxis: { ...ECHART_THEME.xAxis, type: "category", data: months },
      yAxis: { ...ECHART_THEME.yAxis, type: "value" },
      series: [
        { name: "Revenue",     type: "bar",  stack: null, itemStyle: { color: "#115E67" }, data: rev,
          markArea: { silent: true, itemStyle: { color: "rgba(201,162,75,0.10)" }, label: { show: false },
            data: lowSeasonMarkArea(months) } },
        { name: "Gross Profit", type: "line", smooth: true, itemStyle: { color: "#C9A24B" }, lineStyle: { color: "#C9A24B", width: 2 }, data: gp },
      ],
    };

    const ctChart = chartHost(260);
    const ctOpt = {
      ...ECHART_THEME,
      legend: { ...ECHART_THEME.legend, data: ["Active customers"] },
      xAxis: { ...ECHART_THEME.xAxis, type: "category", data: ct.map(c => c.month) },
      yAxis: { ...ECHART_THEME.yAxis, type: "value", axisLabel: { ...ECHART_THEME.yAxis.axisLabel, formatter: v => v } },
      series: [{ name: "Active customers", type: "line", smooth: true, step: false,
        itemStyle: { color: "#1A8A96" }, lineStyle: { color: "#1A8A96", width: 2 }, data: ct.map(c => c.count),
        markArea: { silent: true, itemStyle: { color: "rgba(201,162,75,0.10)" }, label: { show: false },
          data: lowSeasonMarkArea(ct.map(c => c.month)) } }],
    };

    const layout = el("div", {},
      section("Seasonality", "Revenue Seasonality",
        "The business is structurally seasonal — Jun through Oct is the low season. Charts use a frosted band so the contraction is impossible to miss."),
      el("div", { class: "bg-white border border-rule rounded-md p-5 shadow-brief mb-6" },
        el("h2", { class: "font-serif text-xl text-ink mb-3" }, "Monthly revenue & gross profit"),
        chart,
      ),
      el("div", { class: "bg-white border border-rule rounded-md p-5 shadow-brief mb-8" },
        el("h2", { class: "font-serif text-xl text-ink mb-3" }, "Active customers"),
        ctChart,
      ),
      briefingCard("seasonality", data.commentary),
    );
    queueMicrotask(() => { ensureChart(chart, opt); ensureChart(ctChart, ctOpt); });
    return layout;
  }

  // ---- Working Capital ----
  function viewWorkingCapital(state) {
    const { data } = state;
    const wc = K.nwcSeries(data.workingCapital);
    const months = wc.map(w => w.month);
    const nwcChart = chartHost(320);
    const nwcOpt = {
      ...ECHART_THEME,
      legend: { ...ECHART_THEME.legend, data: ["Cash","AR","Inventory","AP","Net Working Capital"] },
      xAxis: { ...ECHART_THEME.xAxis, type: "category", data: months },
      yAxis: { ...ECHART_THEME.yAxis, type: "value" },
      series: [
        { name: "Cash",       type: "line", smooth: true, itemStyle: { color: "#115E67" }, data: wc.map(w => w.cash) },
        { name: "AR",         type: "line", smooth: true, itemStyle: { color: "#1A8A96" }, data: wc.map(w => w.ar) },
        { name: "Inventory",  type: "line", smooth: true, itemStyle: { color: "#7FB7A6" }, data: wc.map(w => w.inventory) },
        { name: "AP",         type: "line", smooth: true, itemStyle: { color: "#A14B2A" }, data: wc.map(w => w.ap) },
        { name: "Net Working Capital", type: "bar", itemStyle: { color: "#0B1F3A" },
          data: wc.map(w => w.nwc) },
      ],
    };

    const latest = wc[wc.length - 1];
    const kpis = el("div", { class: "grid grid-cols-2 md:grid-cols-5 gap-4 mb-6" },
      kpiTile("Cash",       K.fmtMoneyFull(latest.cash),       latest.month),
      kpiTile("AR",         K.fmtMoneyFull(latest.ar),         latest.month),
      kpiTile("Inventory",  K.fmtMoneyFull(latest.inventory),  latest.month),
      kpiTile("AP",         K.fmtMoneyFull(latest.ap),         latest.month, "warn"),
      kpiTile("NWC",        K.fmtMoneyFull(latest.nwc),        "Cash + AR + Inv − AP"),
    );

    // Board table (echo of the sheet)
    const tbl = el("table", { class: "board-table" },
      el("thead", {}, el("tr", {}, data.workingCapital.months.map(m => el("th", {}, m)))),
      el("tbody", {}, data.workingCapital.rows.map(r =>
        el("tr", { class: r.label.toLowerCase().includes("net working capital") ? "subtotal" : "" },
          el("td", {}, r.label),
          ...r.values.map(v => el("td", {}, v === null ? "—" : K.fmtMoneyFull(v))),
        )
      )),
    );

    const layout = el("div", {},
      section("Liquidity", "Working Capital", "Cash, receivables, inventory and payables — and the resulting Net Working Capital."),
      kpis,
      el("div", { class: "bg-white border border-rule rounded-md p-5 shadow-brief mb-8" },
        el("h2", { class: "font-serif text-xl text-ink mb-3" }, "Working capital components"),
        nwcChart,
      ),
      el("div", { class: "mb-8" },
        el("h2", { class: "font-serif text-xl text-ink mb-3" }, "Board table"),
        tbl,
      ),
      briefingCard("working-capital", data.commentary),
    );
    queueMicrotask(() => ensureChart(nwcChart, nwcOpt));
    return layout;
  }

  // ---- Financial Performance ----
  function viewFinancials(state) {
    const { data } = state;
    const fc = K.financialComparison(data.monthly, data.quarterly);
    const { byQuarter, q1_25, q1_26, q2_26, q2_25, deltaQ1YoY, deltaQ2YoY, q2_26Months } = fc;
    const cordon = K.quarterCordon(data.monthly, q2_26?.quarter);

    const kpis = el("div", { class: "grid grid-cols-2 md:grid-cols-4 gap-4 mb-6" },
      kpiTile("Q1 2025 revenue", K.fmtMoneyFull(q1_25?.revenue), "Baseline"),
      kpiTile("Q1 2026 revenue", K.fmtMoneyFull(q1_26?.revenue), "Year-over-year", deltaQ1YoY >= 0 ? "" : "warn"),
      kpiTile("Δ Q1 YoY", K.fmtPctDelta(deltaQ1YoY), "Q1'26 vs Q1'25"),
      kpiTile("Q2 2026 (partial)", K.fmtMoneyFull(q2_26?.revenue),
              cordon.isPartial ? `${cordon.monthCount} months through ${cordon.latestMonth}` : "Full quarter",
              cordon.isPartial ? "warn" : ""),
    );

    // Comparison chart
    const quarters = byQuarter.map(q => q.quarter);
    const rev = byQuarter.map(q => q.revenue);
    const isPartial = quarters.map(q => q === q2_26?.quarter && (q2_26Months?.length || 0) < 3);
    const chart = chartHost(340);
    const opt = {
      ...ECHART_THEME,
      legend: { ...ECHART_THEME.legend, data: ["Quarterly revenue"] },
      xAxis: { ...ECHART_THEME.xAxis, type: "category", data: quarters },
      yAxis: { ...ECHART_THEME.yAxis, type: "value" },
      series: [{
        name: "Quarterly revenue", type: "bar",
        itemStyle: {
          color: (params) => isPartial[params.dataIndex] ? "#C9A24B" : "#115E67",
          borderColor: "#fff", borderWidth: 1,
        },
        data: rev,
        label: {
          show: true, position: "top", color: "#0B1F3A", fontSize: 11,
          formatter: (p) => isPartial[p.dataIndex] ? `${K.fmtMoney(p.value)} *` : K.fmtMoney(p.value),
        },
      }],
    };

    // Quarter detail table
    const tbl = el("table", { class: "board-table" },
      el("thead", {}, el("tr", {},
        el("th", {}, "Quarter"),
        ...["Revenue","COGS","GP","SG&A","EBIT","Net Income"].map(h => el("th", {}, h)),
      )),
      el("tbody", {}, byQuarter.map(q => {
        const partial = q === q2_26?.quarter && (q2_26Months?.length || 0) < 3;
        return el("tr", { class: partial ? "partial" : "" },
          el("td", {}, q.quarter + (partial ? " *" : "")),
          el("td", {}, K.fmtMoneyFull(q.revenue)),
          el("td", {}, K.fmtMoneyFull(q.cogs)),
          el("td", {}, K.fmtMoneyFull(q.gp)),
          el("td", {}, K.fmtMoneyFull(q.sga)),
          el("td", {}, K.fmtMoneyFull(q.ebit)),
          el("td", {}, K.fmtMoneyFull(q.netIncome)),
        );
      })),
    );

    const layout = el("div", {},
      section("Financial Performance", "Quarterly performance",
        "Q1 2025 vs Q1 2026 is the primary comparison. Q2 2026 is shown as a partial period and is never annualized."),
      cordon.isPartial ? warnBanner(`Q2 2026 covers ${cordon.monthCount} months only (through ${cordon.latestMonth}). Treat Q2 2026 figures as a partial read; do not extrapolate.`) : null,
      kpis,
      el("div", { class: "bg-white border border-rule rounded-md p-5 shadow-brief mb-8" },
        el("h2", { class: "font-serif text-xl text-ink mb-3" }, "Quarterly revenue (Q1'25 → Q2'26)"),
        el("div", { class: "text-xs text-mute mb-3" }, "Amber bar = partial quarter (Q2 2026, Through May)."),
        chart,
      ),
      el("div", { class: "mb-8" },
        el("h2", { class: "font-serif text-xl text-ink mb-3" }, "Quarterly P&L"),
        tbl,
      ),
      briefingCard("financial-performance", data.commentary),
    );
    queueMicrotask(() => ensureChart(chart, opt));
    return layout;
  }

  // ---- Forward Looking ----
  function viewForwardLooking(state) {
    const { data } = state;
    const monthly = data.monthly;
    const last = monthly[monthly.length - 1];
    const isJuneMonth = last && K.parseMonth(last.month)?.mon === 5; // May=4, June=5
    const nextMonthIsLow = last && (() => {
      const p = K.parseMonth(last.month); if (!p) return false;
      let m = p.mon + 1, y = p.yr; if (m > 12) { m = 1; y++; }
      return ["Jun","Jul","Aug","Sep","Oct"].includes(["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]);
    })();

    const cards = el("div", { class: "grid grid-cols-1 md:grid-cols-2 gap-4 mb-8" },
      ...data.forwardLooking.items.map(item => {
        const status = item.status.toLowerCase();
        const variant = status.includes("high") || status.includes("critical") || status.includes("amber") ? "risk"
                      : status.includes("watch") || status.includes("monitor") ? "warn"
                      : "";
        return el("div", { class: `kpi ${variant ? "kpi-" + variant : ""}` },
          el("div", { class: "kpi-bar" }),
          el("div", { class: "kpi-label" }, item.label),
          el("div", { class: "kpi-value text-lg" }, item.status || "—"),
          item.mitigation ? el("div", { class: "kpi-sub mt-2" }, item.mitigation) : null,
        );
      }),
    );

    const layout = el("div", {},
      section("Forward-looking", "Risk & Outlook",
        "Risk register from the sheet, plus a banner for the seasonal inflection."),
      (nextMonthIsLow && last) ? warnBanner(`June risk: the report ends in ${last.month}, and the next reporting month enters the low season (Jun–Oct). Expect a step-down in revenue and active customers.`) : null,
      cards,
      sawtoothDivider(),
      briefingCard("forward-looking", data.commentary),
    );
    return layout;
  }

  // ---- Customer (data-driven) ----
  function viewCustomer(state, slug) {
    const { data } = state;
    const customers = data.assumptions.customers;
    const c = customers.find(c => c.slug === slug);
    if (!c) {
      return el("div", { class: "state" },
        el("h2", {}, "Customer not found"),
        el("p", { class: "mt-2" }, `No customer matches “${slug}”. Check the Assumptions tab in the sheet.`),
        el("p", { class: "mt-4 text-sm" }, el("a", { href: "#/", class: "text-sea underline" }, "← Back to overview")),
      );
    }
    const series = data.customerRevenue[c.slug]?.series || [];
    const marginByName = Object.fromEntries(customers.map(cu => [cu.name, cu.margin]));
    const rolled = K.rollupCustomerQuarterly({ [c.slug]: { name: c.name, slug: c.slug, series } }, marginByName)[c.slug];
    const concentration = K.concentrationLatest(data.customerRevenue, data.monthly);
    const myShare = concentration.items.find(i => i.slug === c.slug);

    const months = series.map(s => s.month);
    const rev    = series.map(s => s.revenue);
    const gp     = series.map(s => s.margin !== null ? s.revenue * s.margin : null);

    // M-to-M chart
    const mmChart = chartHost(300);
    const mmOpt = {
      ...ECHART_THEME,
      legend: { ...ECHART_THEME.legend, data: ["Revenue","Gross Profit (est.)"] },
      xAxis: { ...ECHART_THEME.xAxis, type: "category", data: months },
      yAxis: { ...ECHART_THEME.yAxis, type: "value" },
      series: [
        { name: "Revenue", type: "bar", itemStyle: { color: "#115E67" }, data: rev,
          markArea: { silent: true, itemStyle: { color: "rgba(201,162,75,0.10)" }, label: { show: false },
            data: lowSeasonMarkArea(months) } },
        { name: "Gross Profit (est.)", type: "line", smooth: true, itemStyle: { color: "#C9A24B" }, data: gp },
      ],
    };

    // Q-to-Q chart
    const qQs = rolled.quarterly;
    const qqChart = chartHost(260);
    const qqOpt = {
      ...ECHART_THEME,
      legend: { ...ECHART_THEME.legend, data: ["Quarterly revenue","Quarterly GP (est.)"] },
      xAxis: { ...ECHART_THEME.xAxis, type: "category", data: qQs.map(q => q.quarter) },
      yAxis: { ...ECHART_THEME.yAxis, type: "value" },
      series: [
        { name: "Quarterly revenue", type: "bar", itemStyle: { color: "#1A8A96" }, data: qQs.map(q => q.revenue) },
        { name: "Quarterly GP (est.)", type: "line", smooth: true, itemStyle: { color: "#C9A24B" }, data: qQs.map(q => q.gp) },
      ],
    };

    // KPI tiles
    const ytd = months.filter(m => K.parseMonth(m)?.yr === K.parseMonth(months[months.length-1])?.yr)
                      .reduce((s, m, _, arr) => s + (series.find(x => x.month === m)?.revenue || 0), 0);
    const lastQ = qQs[qQs.length - 1];
    const prevQ = qQs[qQs.length - 2];
    const kpis = el("div", { class: "grid grid-cols-2 md:grid-cols-4 gap-4 mb-6" },
      kpiTile("Latest month revenue", K.fmtMoneyFull(rev[rev.length-1]), months[months.length-1]),
      kpiTile("YTD revenue", K.fmtMoney(ytd), `${K.parseMonth(months[months.length-1])?.yr || ""}`),
      kpiTile("Mix share (latest)", K.fmtPct(myShare?.share), concentration.latest ? `as of ${concentration.latest}` : ""),
      kpiTile("Contribution margin", K.fmtPct(c.margin), "From Assumptions tab"),
    );

    const layout = el("div", {},
      section("Customer", c.name,
        `Monthly and quarterly performance · contribution margin ${K.fmtPct(c.margin)}`),
      kpis,
      el("div", { class: "grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8" },
        el("div", { class: "bg-white border border-rule rounded-md p-5 shadow-brief" },
          el("h2", { class: "font-serif text-xl text-ink mb-3" }, "Month-to-month"),
          mmChart,
        ),
        el("div", { class: "bg-white border border-rule rounded-md p-5 shadow-brief" },
          el("h2", { class: "font-serif text-xl text-ink mb-3" }, "Quarter-to-quarter"),
          qqChart,
        ),
      ),
      lastQ ? el("div", { class: "bg-white border border-rule rounded-md p-5 shadow-brief mb-8" },
        el("h2", { class: "font-serif text-xl text-ink mb-3" }, `Latest quarter: ${lastQ.quarter}`),
        el("div", { class: "grid grid-cols-3 gap-3" },
          kpiTile("Quarter revenue", K.fmtMoneyFull(lastQ.revenue), lastQ.quarter),
          kpiTile("Quarter GP (est.)", K.fmtMoneyFull(lastQ.gp), `margin ${K.fmtPct(c.margin)}`),
          prevQ ? kpiTile("Δ vs prior Q", K.fmtPctDelta((lastQ.revenue - prevQ.revenue) / (prevQ.revenue || 1)), `${prevQ.quarter} → ${lastQ.quarter}`) : kpiTile("Prior Q", "—", ""),
        ),
      ) : null,
      briefingCard(c.slug, data.commentary,
        "Customer-level commentary pending — generate via the Google Sheet menu."),
    );
    queueMicrotask(() => { ensureChart(mmChart, mmOpt); ensureChart(qqChart, qqOpt); });
    return layout;
  }

  // ---- About / Glossary ----
  function viewAbout() {
    const items = [
      ["Low season (Jun – Oct)", "The seasonal trough — outside this window, revenue and active customers step up materially."],
      ["Q2 2026 cordon",         "Through May only — never label as a complete quarter, never annualize or extrapolate."],
      ["Active customers",       "Count at the first month of the quarter (documented in the Assumptions tab)."],
      ["Net Working Capital",    "Cash + Accounts Receivable + Inventory − Accounts Payable."],
      ["Contribution margin",    "Per-customer gross margin assumption used to estimate gross profit."],
      ["WARN (data note)",       "When Σ customer revenue diverges from the P&L total by > 0.5%, a non-blocking note + chip surface so the board knows."],
      ["Turnaround storyline",   "Q1 2025 trough → Q1 2026 recovery, framed by the swing in active customers."],
    ];
    return el("div", {},
      section("Glossary", "About this report",
        "The terms used in this report and how the numbers are calculated."),
      el("div", { class: "bg-white border border-rule rounded-md divide-y divide-rule" },
        ...items.map(([term, def]) =>
          el("div", { class: "p-5" },
            el("div", { class: "font-serif text-lg text-ink mb-1" }, term),
            el("div", { class: "text-sm text-mute" }, def),
          )
        ),
      ),
      el("div", { class: "mt-8 text-sm text-mute" },
        "TPO Wellness · Monthly Performance · ", "Source: live Google Sheet.",
      ),
    );
  }

  // ---- Empty state ----
  function viewEmpty(reason) {
    const msgs = {
      CONFIG_MISSING: {
        title: "Setup not finished",
        body:  "Open ",
        link:  "config.js",
        tail:  " and paste your Google Sheet ID and the read-only Sheets API key. Then reload this page.",
      },
      SHEET_UNREACHABLE: {
        title: "Report not available",
        body:  "The site couldn't read the Google Sheet. If you haven't shared the sheet yet, open it in Google Sheets and choose Share → ",
        link:  "Anyone with the link → Viewer",
        tail:  ". Otherwise, double-check the Sheet ID and API key in config.js.",
      },
    };
    const m = msgs[reason] || msgs.SHEET_UNREACHABLE;
    return el("div", { class: "state" },
      el("h2", {}, m.title),
      el("p", { class: "mt-3" }, m.body, el("code", {}, m.link), m.tail),
    );
  }

  // ---- Loading ----
  function viewLoading() {
    return el("div", { class: "state" },
      el("h2", {}, "Loading the report"),
      el("p", { class: "mt-3" }, "Reading the Google Sheet…"),
    );
  }

  window.TPO_VIEWS = {
    overview: viewOverview,
    seasonality: viewSeasonality,
    "working-capital": viewWorkingCapital,
    financials: viewFinancials,
    "forward-looking": viewForwardLooking,
    customer: viewCustomer,
    about: viewAbout,
    empty: viewEmpty,
    loading: viewLoading,
  };
})();