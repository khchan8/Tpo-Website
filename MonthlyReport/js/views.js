/* =========================================================
   views.js — render functions for every SPA view.  (v1.4)
   - chartCard(): chart container + per-chart range selector,
     with deferred ECharts init (double rAF + resize + ResizeObserver)
     so charts paint at the right size on FIRST view (no spillover).
   - boardTable(): correct board-echo tables.
   - disposeAllCharts(): frees ECharts instances on view change.
   ========================================================= */
(function () {
  const C = window.TPO_CONFIG;
  const D = window.TPO_DATA;
  const K = window.TPO_COMPUTE;
  const num  = D.num;
  const pct  = D.pct;
  const trim = D.trim;
  const slugify = D.slugify;

  /* ---------- element helpers ---------- */
  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined) continue;
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
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
  function content(data, key, fallback) {
    return data?.content?.[key] || fallback;
  }

  function briefingCard(viewKey, data, fallback) {
    const text = data?.commentary?.[viewKey];
    const defFallback = content(data, "briefing.fallback", "Commentary pending — click “Generate Commentary” in the Google Sheet menu.");
    const body = text && text.trim()
      ? text
      : (fallback || defFallback);
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
  function sawtoothDivider() { return el("div", { class: "sawtooth my-8" }); }

  function lowSeasonMarkArea(series) {
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

  /* ---------- chart lifecycle (kills first-paint spillover) ---------- */
  const chartRegistry_ = []; // {instance, ro}
  function disposeAllCharts() {
    chartRegistry_.forEach(c => {
      try { c.ro && c.ro.disconnect(); } catch (_) {}
      try { c.instance && c.instance.dispose(); } catch (_) {}
    });
    chartRegistry_.length = 0;
  }

  /* ---------- range selector ---------- */
  const RANGE_PRESETS = {
    monthly:   [["all", "All"], ["12m", "12M"], ["6m", "6M"], ["ytd", "YTD"]],
    quarterly: [["all", "All"], ["4q", "Last 4Q"], ["8q", "Last 8Q"]],
    none:      [],
  };
  function rangeControl_(rangeKey) {
    const wrap = el("div", { class: "range-control", "data-range-control": "" });
    RANGE_PRESETS[rangeKey].forEach(([key, label], i) => {
      wrap.appendChild(el("button", {
        class: "range-btn" + (i === 0 ? " active" : ""),
        type: "button", "data-range": key,
      }, label));
    });
    return wrap;
  }
  // Slice {labels, series} by the active range preset.
  function sliceByRange_(data, range, rangeKey) {
    if (!data || rangeKey === "none" || range === "all") return data;
    const labels = data.labels || [];
    const n = labels.length;
    let from = 0;
    if (rangeKey === "monthly") {
      if (range === "12m") from = Math.max(0, n - 12);
      else if (range === "6m") from = Math.max(0, n - 6);
      else if (range === "ytd") {
        const lastYr = K.parseMonth(labels[n - 1])?.yr;
        if (lastYr != null) {
          for (let i = 0; i < n; i++) {
            if (K.parseMonth(labels[i])?.yr === lastYr) { from = i; break; }
          }
        }
      }
    } else if (rangeKey === "quarterly") {
      if (range === "4q") from = Math.max(0, n - 4);
      else if (range === "8q") from = Math.max(0, n - 8);
    }
    if (from === 0) return data;
    return {
      labels: labels.slice(from),
      series: data.series.map(s => ({ ...s, values: (s.values || []).slice(from) })),
    };
  }

  /* ---------- chartCard (container + range control + safe init) ---------- */
  // data = { labels:[], series:[{name, values:[]}] }
  // buildOption(slicedData) -> ECharts option
  function chartCard({ title, subtitle, rangeKey = "none", height = 320, data, buildOption, onClick }) {
    const header = el("div", { class: "chart-card-head" },
      el("div", {},
        el("h2", { class: "font-serif text-xl text-ink" }, title),
        subtitle ? el("div", { class: "text-xs text-mute mt-1" }, subtitle) : null,
      ),
      rangeKey !== "none" ? rangeControl_(rangeKey) : null,
    );
    // Body uses flex-grow + min-height so that in a grid row, sibling cards
    // stretch to the same height and their chart baselines line up. ECharts
    // is kept fitted by the ResizeObserver.
    const body = el("div", { style: `width:100%;flex:1 1 auto;min-height:${height}px;` });
    const card = el("div", { class: "bg-white border border-rule rounded-md p-5 shadow-brief flex flex-col" },
      header, body);

    let instance = null, ro = null, currentRange = "all";

    function render() {
      if (!instance) return;                 // not yet inited; deferred rAF will call this
      const sliced = sliceByRange_(data, currentRange, rangeKey);
      instance.setOption(buildOption(sliced), true);
    }
    if (rangeKey !== "none") {
      const control = header.querySelector("[data-range-control]");
      control.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-range]");
        if (!btn) return;
        currentRange = btn.getAttribute("data-range");
        control.querySelectorAll("[data-range]").forEach(b =>
          b.classList.toggle("active", b === btn));
        render();
      });
    }
    // Defer init until the grid has laid the container out (double rAF), then
    // fit + observe. This is what prevents the 0-width spillover on first paint.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!body.isConnected) return;        // host removed before init (e.g. metric switch)
      instance = echarts.init(body);
      let resizeTimeout;
      ro = new ResizeObserver(() => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => { try { instance.resize(); } catch (_) {} }, 100);
      });
      ro.observe(body);
      chartRegistry_.push({ instance, ro });
      if (typeof onClick === "function") {
        instance.on("click", (p) => { try { onClick(p); } catch (_) {} });
      }
      render();
      setTimeout(() => { try { instance.resize(); } catch (_) {} }, 60); // settle after fonts
    }));
    return card;
  }

  /* ---------- boardTable ---------- */
  // headers:[string]  rows:[{cells:[string|number], variant?}]
  function boardTable(headers, rows) {
    return el("table", { class: "board-table" },
      el("thead", {}, el("tr", {}, headers.map(h => el("th", {}, h)))),
      el("tbody", {}, rows.map(r =>
        el("tr", { class: r.variant || "" },
          r.cells.map(c => el("td", {}, (c === null || c === undefined || c === "") ? "—" : String(c)))
        )
      )),
    );
  }

  /* ---------- ECharts shared theme ---------- */
  const ECHART_THEME = {
    color: ["#115E67","#1A8A96","#C9A24B","#0B1F3A","#5B6B7E","#7FB7A6","#A14B2A"],
    textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: "#0B1F3A" },
    grid: { left: 50, right: 24, top: 36, bottom: 40 },
    legend: { textStyle: { color: "#5B6B7E" }, top: 4 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#fff", borderColor: "#D9D2C0",
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

  // =========================================================
  //  VIEWS
  // =========================================================

  // ---- Overview ----
  function viewOverview(state) {
    const { data } = state;
    const monthly = data.monthly;
    const last    = monthly[monthly.length - 1];
    const storyline = K.customerCountStoryline(data.customerCount);
    const concentration = K.concentrationLatest(data.customerRevenue, monthly);
    const currentQ  = last?.quarter || K.quarterOf(last?.month);
    const cordon    = K.quarterCordon(monthly, currentQ);
    const recon     = K.reconciliation(data.customerRevenueTotalByMonth, monthly);
    const reconLatest = recon.filter(r => r.month === last?.month);

    const yr = K.parseMonth(last.month)?.yr;
    const ytd = monthly.filter(m => K.parseMonth(m.month)?.yr === yr).reduce((s, m) => s + (m.revenue || 0), 0);
    const ytdGP = monthly.filter(m => K.parseMonth(m.month)?.yr === yr).reduce((s, m) => s + (m.gp || 0), 0);
    const margin = ytd ? ytdGP / ytd : null;

    // Active customers: prefer the CustomerCount tab (reliable); fall back to mix length.
    const lastCount = data.customerCount.length ? data.customerCount[data.customerCount.length - 1] : null;

    // Customer mix: prefer latest-month concentration; fall back to Customer
    // Economics (all 5 customers) when the monthly series is sparse.
    let mixItems = concentration.items;
    let mixSource = `Latest month · ${concentration.latest || ""}`;
    if (!mixItems.length && data.customerEcon && data.customerEcon.customers.length) {
      mixItems = data.customerEcon.customers.map(c => ({ name: c.name, revenue: c.revenue }));
      mixSource = "Q1 2026 · Customer Economics";
    }

    const kpis = el("div", { class: "grid grid-cols-2 md:grid-cols-4 gap-4 mb-8" },
      kpiTile("Latest month revenue", K.fmtMoneyFull(last?.revenue), last?.month || ""),
      kpiTile("YTD revenue", K.fmtMoney(ytd), `${yr || ""} YTD`),
      kpiTile("YTD gross margin", K.fmtPct(margin), "GP / Revenue"),
      kpiTile("Active customers (latest)", lastCount ? `${lastCount.count}` : "—",
              lastCount?.month || ""),
    );

    const trendCard = chartCard({
      title: "Monthly revenue — sawtooth & low season",
      subtitle: cordon.isPartial ? `${cordon.quarter} — ${cordon.monthCount} months (partial)` : "Full quarter",
      rangeKey: "monthly", height: 320,
      data: { labels: monthly.map(m => m.month), series: [{ name: "Revenue", values: monthly.map(m => m.revenue) }] },
      buildOption: (s) => ({
        ...ECHART_THEME,
        legend: { ...ECHART_THEME.legend, data: ["Revenue"] },
        xAxis: { ...ECHART_THEME.xAxis, type: "category", data: s.labels },
        yAxis: { ...ECHART_THEME.yAxis, type: "value" },
        series: [{
          name: "Revenue", type: "line", smooth: false, symbol: "circle", symbolSize: 5,
          lineStyle: { color: "#115E67", width: 2 }, itemStyle: { color: "#115E67" },
          areaStyle: { color: "rgba(17,94,103,0.08)" },
          data: s.series[0].values,
          markArea: { silent: true, itemStyle: { color: "rgba(201,162,75,0.10)" }, label: { show: false },
            data: lowSeasonMarkArea(s.labels) },
        }],
      }),
    });

    // Donut (snapshot — no range control, but still goes through chartCard for safe sizing).
    // Clicking a customer slice/label jumps to that customer's page.
    const donutCard = chartCard({
      title: "Customer mix",
      subtitle: mixSource + " · click a segment to drill in",
      rangeKey: "none", height: 320,
      data: { labels: mixItems.map(i => i.name),
              series: [{ name: "Revenue", values: mixItems.map(i => i.revenue) }] },
      onClick: (p) => {
        if (p && p.name) {
          const slug = slugify(p.name);
          if (slug) location.hash = "#/customers/" + slug;
        }
      },
      buildOption: () => ({
        ...ECHART_THEME,
        tooltip: { ...ECHART_THEME.tooltip, trigger: "item", valueFormatter: v => K.fmtMoneyFull(v) },
        legend: { ...ECHART_THEME.legend, bottom: 0 },
        series: [{
          type: "pie", radius: ["50%", "75%"], center: ["50%", "45%"],
          cursor: "pointer",
          itemStyle: { borderColor: "#fff", borderWidth: 2 },
          label: { formatter: "{b}\n{d}%", color: "#0B1F3A", fontSize: 11 },
          emphasis: { scale: true, scaleSize: 6 },
          data: mixItems.map(i => ({ name: i.name, value: i.revenue })),
        }],
      }),
    });

    const layout = el("div", {},
      section("Strategic Dashboard", "Overview", content(data, "overview.subtitle", "Top-line performance and customer mix at a glance.")),
      recon.length ? warnBanner(`Customer-level revenue and P&L revenue disagree on ${recon.length} month(s) — e.g. ${reconLatest[0]?.month || ""}: Σ customer ${K.fmtMoneyFull(reconLatest[0]?.sumCustomer)} vs P&L ${K.fmtMoneyFull(reconLatest[0]?.pnl)}. The site continues with a note; reconcile in the sheet.`) : null,
      kpis,
      el("div", { class: "grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8" },
        el("div", { class: "lg:col-span-2" }, trendCard),
        el("div", {}, donutCard),
      ),
      sawtoothDivider(),
      el("div", { class: "grid grid-cols-1 md:grid-cols-2 gap-6 mb-8" },
        el("div", { class: "bg-white border border-rule rounded-md p-5 shadow-brief" },
          el("h2", { class: "font-serif text-xl text-ink mb-3" }, "Customer count — peak & trough"),
          el("p", { class: "text-sm text-mute mb-4" }, "The seasonal contraction — from peak to trough — anchors the turnaround storyline."),
          el("div", { class: "grid grid-cols-3 gap-3" },
            kpiTile("Peak",   storyline.peak   ? `${storyline.peak.count}`   : "—", storyline.peak?.month   || ""),
            kpiTile("Trough", storyline.trough ? `${storyline.trough.count}` : "—", storyline.trough?.month || ""),
            kpiTile("Δ",      K.fmtPctDelta(storyline.delta), "trough vs peak"),
          ),
        ),
        briefingCard("overview", data,
          (cordon && cordon.isPartial) ? `${cordon.quarter} covers ${cordon.monthCount} month(s) only (through ${cordon.latestMonth}) and must not be annualized.` : undefined),
      ),
    );
    return layout;
  }

  // ---- Strategic Dashboard (NEW) ----
  function viewDashboard(state) {
    const { data } = state;
    const dash = data.dashboard || { periods: [], metrics: [] };
    const periods = dash.periods;

    // KPI matrix table (metrics × periods)
    const headers = ["Strategic Metric", ...periods];
    const rows = dash.metrics.map(m => ({
      cells: [m.label, ...m.values.map(v => fmtDashCell_(v))],
      variant: "",
    }));

    // Pick a metric to chart across periods. Default to Active Customers.
    function numericMetric(m) {
      const vals = m.values.map(v => num(v));
      return { label: m.label, vals, sample: m.values.find(v => v !== null && v !== undefined && v !== "") };
    }
    const chartable = dash.metrics.map(numericMetric).filter(m => m.vals.some(v => v !== null));
    let defaultMetric = chartable.find(m => /active customer/i.test(m.label)) || chartable[0];

    const metricSelect = el("select", { class: "dash-select", "data-role": "metric" },
      ...chartable.map(m => el("option", { value: m.label, selected: defaultMetric && m.label === defaultMetric.label }, m.label))
    );

    function detectKind(sample) {
      const s = String(sample == null ? "" : sample);
      if (s.includes("%")) return "pct";
      if (s.includes("฿")) return "money";
      return "count";
    }
    function chartFor(metric) {
      const kind = detectKind(metric.sample);
      return chartCard({
        title: metric.label + " — across periods",
        rangeKey: "none", height: 300,
        data: { labels: periods, series: [{ name: metric.label, values: metric.vals }] },
        buildOption: (s) => {
          const yFmt = kind === "pct" ? (v => K.fmtPct(v))
                     : kind === "money" ? (v => K.fmtMoney(v))
                     : (v => v);
          return {
            ...ECHART_THEME,
            legend: { show: false },
            tooltip: { ...ECHART_THEME.tooltip, valueFormatter: v => yFmt(v) },
            xAxis: { ...ECHART_THEME.xAxis, type: "category", data: s.labels },
            yAxis: { ...ECHART_THEME.yAxis, type: "value", axisLabel: { ...ECHART_THEME.yAxis.axisLabel, formatter: v => yFmt(v) } },
            series: [{
              type: "bar", itemStyle: { color: "#115E67", borderRadius: [4, 4, 0, 0] },
              label: { show: true, position: "top", color: "#0B1F3A", fontSize: 11, formatter: p => kind === "count" ? p.value : yFmt(p.value) },
              data: s.series[0].values,
            }],
          };
        },
      });
    }

    const chartHolder = el("div", { class: "mt-4", "data-role": "chart-holder" });
    function paintChart() {
      chartHolder.innerHTML = "";
      disposeHolderCharts_(chartHolder);
      const m = chartable.find(x => x.label === metricSelect.value) || defaultMetric;
      if (m) chartHolder.appendChild(chartFor(m));
    }
    metricSelect.addEventListener("change", paintChart);

    const layout = el("div", {},
      section("Strategic Dashboard", "Strategic Dashboard",
        content(data, "dashboard.subtitle", "The headline KPI matrix across four reference periods. Q2 2026 is shown Through May only.")),
      el("div", { class: "mb-8" },
        el("h2", { class: "font-serif text-xl text-ink mb-3" }, "KPI matrix"),
        boardTable(headers, rows),
      ),
      el("div", { class: "bg-white border border-rule rounded-md p-5 shadow-brief mb-8" },
        el("div", { class: "flex items-center justify-between gap-3 flex-wrap" },
          el("h2", { class: "font-serif text-xl text-ink" }, "Metric across periods"),
          metricSelect,
        ),
        chartHolder,
      ),
      briefingCard("strategic-dashboard", data,
        "Strategic dashboard commentary pending — generate via the Google Sheet menu (View: strategic-dashboard)."),
    );
    // paint after mount
    requestAnimationFrame(() => requestAnimationFrame(paintChart));
    return layout;
  }

  // dispose only the charts whose DOM is inside a given holder (used by dashboard repaint)
  function disposeHolderCharts_(holder) {
    for (let i = chartRegistry_.length - 1; i >= 0; i--) {
      const c = chartRegistry_[i];
      if (c.instance && holder.contains(c.instance.getDom())) {
        try { c.ro && c.ro.disconnect(); } catch (_) {}
        try { c.instance.dispose(); } catch (_) {}
        chartRegistry_.splice(i, 1);
      }
    }
  }

  // ---- Seasonality ----
  function viewSeasonality(state) {
    const { data } = state;
    const monthly = data.monthly;
    const ct = data.customerCount;

    const revCard = chartCard({
      title: "Monthly revenue & gross profit", rangeKey: "monthly", height: 360,
      data: { labels: monthly.map(m => m.month),
              series: [{ name: "Revenue", values: monthly.map(m => m.revenue) },
                       { name: "Gross Profit", values: monthly.map(m => m.gp) }] },
      buildOption: (s) => ({
        ...ECHART_THEME,
        legend: { ...ECHART_THEME.legend, data: ["Revenue", "Gross Profit"] },
        xAxis: { ...ECHART_THEME.xAxis, type: "category", data: s.labels },
        yAxis: { ...ECHART_THEME.yAxis, type: "value" },
        series: [
          { name: "Revenue", type: "bar", itemStyle: { color: "#115E67" }, data: s.series[0].values,
            markArea: { silent: true, itemStyle: { color: "rgba(201,162,75,0.10)" }, label: { show: false }, data: lowSeasonMarkArea(s.labels) } },
          { name: "Gross Profit", type: "line", smooth: true, itemStyle: { color: "#C9A24B" }, lineStyle: { color: "#C9A24B", width: 2 }, data: s.series[1].values },
        ],
      }),
    });

    const ctCard = chartCard({
      title: "Active customers", rangeKey: "monthly", height: 260,
      data: { labels: ct.map(c => c.month), series: [{ name: "Active customers", values: ct.map(c => c.count) }] },
      buildOption: (s) => ({
        ...ECHART_THEME,
        legend: { ...ECHART_THEME.legend, data: ["Active customers"] },
        xAxis: { ...ECHART_THEME.xAxis, type: "category", data: s.labels },
        yAxis: { ...ECHART_THEME.yAxis, type: "value", axisLabel: { ...ECHART_THEME.yAxis.axisLabel, formatter: v => v } },
        series: [{ name: "Active customers", type: "line", smooth: true, itemStyle: { color: "#1A8A96" }, lineStyle: { color: "#1A8A96", width: 2 },
          data: s.series[0].values,
          markArea: { silent: true, itemStyle: { color: "rgba(201,162,75,0.10)" }, label: { show: false }, data: lowSeasonMarkArea(s.labels) } }],
      }),
    });

    return el("div", {},
      section("Seasonality", "Revenue Seasonality",
        content(data, "seasonality.subtitle", "The business is structurally seasonal — Jun through Oct is the low season. Frosted bands mark the contraction.")),
      el("div", { class: "mb-6" }, revCard),
      el("div", { class: "mb-8" }, ctCard),
      briefingCard("seasonality", data),
    );
  }

  // ---- Working Capital ----
  function viewWorkingCapital(state) {
    const { data } = state;
    const wc = K.nwcSeries(data.workingCapital);
    const months = wc.map(w => w.month);

    const nwcCard = chartCard({
      title: "Working capital components", rangeKey: "monthly", height: 320,
      data: { labels: months, series: [
        { name: "Cash",      values: wc.map(w => w.cash) },
        { name: "AR",        values: wc.map(w => w.ar) },
        { name: "Inventory", values: wc.map(w => w.inventory) },
        { name: "AP",        values: wc.map(w => w.ap) },
        { name: "Net Working Capital", values: wc.map(w => w.nwc) },
      ] },
      buildOption: (s) => ({
        ...ECHART_THEME,
        legend: { ...ECHART_THEME.legend, data: ["Cash", "AR", "Inventory", "AP", "Net Working Capital"] },
        xAxis: { ...ECHART_THEME.xAxis, type: "category", data: s.labels },
        yAxis: { ...ECHART_THEME.yAxis, type: "value" },
        series: [
          { name: "Cash",      type: "line", smooth: true, itemStyle: { color: "#115E67" }, data: s.series[0].values },
          { name: "AR",        type: "line", smooth: true, itemStyle: { color: "#1A8A96" }, data: s.series[1].values },
          { name: "Inventory", type: "line", smooth: true, itemStyle: { color: "#7FB7A6" }, data: s.series[2].values },
          { name: "AP",        type: "line", smooth: true, itemStyle: { color: "#A14B2A" }, data: s.series[3].values },
          { name: "Net Working Capital", type: "bar", itemStyle: { color: "#0B1F3A" }, data: s.series[4].values },
        ],
      }),
    });

    const latest = wc[wc.length - 1] || {};
    const kpis = el("div", { class: "grid grid-cols-2 md:grid-cols-5 gap-4 mb-6" },
      kpiTile("Cash",      K.fmtMoneyFull(latest.cash),      latest.month || ""),
      kpiTile("AR",        K.fmtMoneyFull(latest.ar),        latest.month || ""),
      kpiTile("Inventory", K.fmtMoneyFull(latest.inventory), latest.month || ""),
      kpiTile("AP",        K.fmtMoneyFull(latest.ap),        latest.month || "", "warn"),
      kpiTile("NWC",       K.fmtMoneyFull(latest.nwc),       "Cash + AR + Inv − AP"),
    );

    // Board table echo — correct "Reporting Month" first column header.
    const headers = (data.workingCapital.tableHeaders && data.workingCapital.tableHeaders.length)
      ? data.workingCapital.tableHeaders
      : ["Reporting Month", "Cash Balance", "AR", "Inventory Value", "AP", "Net Working Capital"];
    const rows = (data.workingCapital.tableRows || []).map(r => ({
      cells: [r.label, ...r.values.map(v => K.fmtMoneyFull(v))],
      variant: "subtotal",
    }));

    return el("div", {},
      section("Liquidity", "Working Capital", content(data, "workingcapital.subtitle", "Cash, receivables, inventory and payables — and the resulting Net Working Capital.")),
      kpis,
      el("div", { class: "mb-8" }, nwcCard),
      el("div", { class: "mb-8" },
        el("h2", { class: "font-serif text-xl text-ink mb-3" }, "Board table"),
        boardTable(headers, rows),
      ),
      briefingCard("working-capital", data),
    );
  }

  // ---- Financials (monthly + quarterly) ----
  function viewFinancials(state) {
    const { data } = state;
    const monthly = data.monthly;
    const quarters = (data.quarterly && data.quarterly.quarters) || [];
    const last = monthly[monthly.length - 1];
    const latestMonth = last ? last.month : null;

    // Partial-quarter flag is driven by how many months of the current quarter
    // exist in MonthlyFinancials (so it auto-clears when June is added).
    const cordon = latestMonth ? K.quarterCordon(monthly, K.quarterOf(latestMonth)) : null;
    const partialQuarter = (cordon && cordon.isPartial) ? cordon.quarter : null;
    const isPartialQ = (q) => !!q && q === partialQuarter;

    // KPIs (monthly + quarterly)
    const yr = latestMonth ? K.parseMonth(latestMonth).yr : null;
    const ytdRev = monthly.filter(m => K.parseMonth(m.month).yr === yr).reduce((s, m) => s + (m.revenue || 0), 0);
    const ytdGP  = monthly.filter(m => K.parseMonth(m.month).yr === yr).reduce((s, m) => s + (m.gp || 0), 0);
    const ytdMargin = ytdRev ? ytdGP / ytdRev : null;
    const lastQ = quarters[quarters.length - 1];
    const prevQ = quarters[quarters.length - 2];
    const qoq = (lastQ && prevQ && prevQ.revenue) ? (lastQ.revenue - prevQ.revenue) / prevQ.revenue : null;

    const kpis = el("div", { class: "grid grid-cols-2 md:grid-cols-4 gap-4 mb-6" },
      kpiTile("Latest month revenue", K.fmtMoneyFull(last ? last.revenue : null), latestMonth || ""),
      kpiTile("YTD gross margin", K.fmtPct(ytdMargin), (yr != null ? yr + " YTD" : "")),
      kpiTile("Latest quarter revenue", K.fmtMoneyFull(lastQ ? lastQ.revenue : null), lastQ ? lastQ.quarter : ""),
      kpiTile("Δ QoQ", K.fmtPctDelta(qoq), (prevQ && lastQ) ? `${prevQ.quarter} → ${lastQ.quarter}` : ""),
    );

    // ---- Monthly performance ----
    const months = monthly.map(m => m.month);
    const monthlyChart = chartCard({
      title: "Monthly revenue, gross profit & EBIT", rangeKey: "monthly", height: 340,
      data: { labels: months, series: [
        { name: "Revenue",      values: monthly.map(m => m.revenue) },
        { name: "Gross Profit", values: monthly.map(m => m.gp) },
        { name: "EBIT",         values: monthly.map(m => m.ebit) },
      ] },
      buildOption: (s) => ({
        ...ECHART_THEME,
        legend: { ...ECHART_THEME.legend, data: ["Revenue", "Gross Profit", "EBIT"] },
        xAxis: { ...ECHART_THEME.xAxis, type: "category", data: s.labels },
        yAxis: { ...ECHART_THEME.yAxis, type: "value" },
        series: [
          { name: "Revenue", type: "bar", itemStyle: { color: "#115E67" }, data: s.series[0].values,
            markArea: { silent: true, itemStyle: { color: "rgba(201,162,75,0.10)" }, label: { show: false }, data: lowSeasonMarkArea(s.labels) } },
          { name: "Gross Profit", type: "line", smooth: true, itemStyle: { color: "#C9A24B" }, lineStyle: { color: "#C9A24B", width: 2 }, data: s.series[1].values },
          { name: "EBIT", type: "line", smooth: true, itemStyle: { color: "#A14B2A" }, lineStyle: { color: "#A14B2A", width: 2 }, data: s.series[2].values },
        ],
      }),
    });

    const monthlyHeaders = ["Month", "Revenue", "COGS", "GP", "SG&A", "EBIT", "Net Income"];
    const monthlyRows = monthly.map(m => ({
      cells: [m.month, K.fmtMoneyFull(m.revenue), K.fmtMoneyFull(m.cogs), K.fmtMoneyFull(m.gp),
              K.fmtMoneyFull(m.sga), K.fmtMoneyFull(m.ebit), K.fmtMoneyFull(m.netIncome)],
    }));

    // ---- Quarterly performance (read from the Quarterly Financials tab) ----
    const quarterlyChart = chartCard({
      title: "Quarterly revenue (from Quarterly Financials tab)",
      subtitle: partialQuarter ? `Amber = ${partialQuarter} (partial, ${cordon.monthCount} of 3 months)` : "",
      rangeKey: "quarterly", height: 340,
      data: { labels: quarters.map(q => q.quarter), series: [
        { name: "Revenue", values: quarters.map(q => q.revenue) },
        { name: "Gross Profit", values: quarters.map(q => q.gp) },
      ] },
      buildOption: (s) => ({
        ...ECHART_THEME,
        legend: { ...ECHART_THEME.legend, data: ["Revenue", "Gross Profit"] },
        xAxis: { ...ECHART_THEME.xAxis, type: "category", data: s.labels },
        yAxis: { ...ECHART_THEME.yAxis, type: "value" },
        series: [
          { name: "Revenue", type: "bar",
            itemStyle: { color: (p) => isPartialQ(s.labels[p.dataIndex]) ? "#C9A24B" : "#115E67", borderColor: "#fff", borderWidth: 1 },
            data: s.series[0].values,
            label: { show: true, position: "top", color: "#0B1F3A", fontSize: 11,
                     formatter: (p) => isPartialQ(s.labels[p.dataIndex]) ? `${K.fmtMoney(p.value)} *` : K.fmtMoney(p.value) } },
          { name: "Gross Profit", type: "line", smooth: true, itemStyle: { color: "#C9A24B" }, data: s.series[1].values },
        ],
      }),
    });

    const qHeaders = ["Quarter", "Revenue", "COGS", "GP", "SG&A", "EBIT", "Net Income"];
    const qRows = quarters.map(q => {
      const partial = isPartialQ(q.quarter);
      return {
        cells: [q.quarter + (partial ? " *" : ""), K.fmtMoneyFull(q.revenue), K.fmtMoneyFull(q.cogs),
                K.fmtMoneyFull(q.gp), K.fmtMoneyFull(q.sga), K.fmtMoneyFull(q.ebit), K.fmtMoneyFull(q.netIncome)],
        variant: partial ? "partial" : "",
      };
    });

    return el("div", {},
      section("Financial Performance", "Monthly & quarterly P&L",
        content(data, "financials.subtitle", "Monthly figures come from MonthlyFinancials; quarterly figures come from the Quarterly Financials tab. Q2 2026 is partial (Apr & May) and is never annualized.")),
      (cordon && cordon.isPartial)
        ? warnBanner(`Q2 2026 covers ${cordon.monthCount} months only (through ${cordon.latestMonth}). Treat as a partial read; do not extrapolate.`)
        : null,
      kpis,
      el("h2", { class: "font-serif text-2xl text-ink mb-3" }, "Monthly performance"),
      el("div", { class: "mb-6" }, monthlyChart),
      el("div", { class: "mb-10" },
        el("h3", { class: "font-serif text-xl text-ink mb-3" }, "Monthly P&L"),
        boardTable(monthlyHeaders, monthlyRows),
      ),
      sawtoothDivider(),
      el("h2", { class: "font-serif text-2xl text-ink mb-3" }, "Quarterly performance"),
      el("div", { class: "mb-6" }, quarterlyChart),
      el("div", { class: "mb-8" },
        el("h3", { class: "font-serif text-xl text-ink mb-3" }, "Quarterly P&L"),
        boardTable(qHeaders, qRows),
      ),
      briefingCard("financial-performance", data),
    );
  }

  // ---- Forward-Looking (redesign) ----
  function viewForwardLooking(state) {
    const { data } = state;
    const fl = data.forwardLooking || { lineNames: [], periods: [] };
    const periods = fl.periods || [];
    const monthly = data.monthly;
    const last = monthly[monthly.length - 1];

    // Comparison table: rows = P&L lines, columns = periods (+ Δ when 2 periods)
    const lines = [
      { label: "Revenue",      get: p => p.revenue },
      { label: "COGS",         get: p => p.cogs },
      { label: "Gross Profit", get: p => p.gp },
      { label: "SG&A",         get: p => p.sga },
      { label: "Net Income",   get: p => p.netIncome },
    ];
    const twoP = periods.length === 2;
    const headers = ["Line", ...periods.map(p => p.label), ...(twoP ? ["Δ"] : [])];
    const rows = lines.map(ln => {
      const cells = [ln.label, ...periods.map(p => K.fmtMoneyFull(ln.get(p)))];
      if (twoP) {
        const a = ln.get(periods[0]), b = ln.get(periods[1]);
        const d = (a && b) ? K.fmtPctDelta((b - a) / Math.abs(a || 1)) : "—";
        cells.push(d);
      }
      return { cells, variant: ln.label === "Gross Profit" ? "subtotal" : "" };
    });

    // Risk-status chips per period
    const riskCards = periods.filter(p => p.riskStatus).map(p => {
      const high = /high|critical|amber|incomplete/i.test(p.riskStatus);
      return kpiTile(p.label, p.riskStatus, "Risk status", high ? "risk" : "warn");
    });

    const layout = el("div", {},
      section("Forward-looking", "Risk & Outlook",
        content(data, "forwardlooking.subtitle", "Q2 2025 (full) vs Q2 2026 (Apr & May, partial) with the board's risk read.")),
      (nextMonthIsLow_(last)) ? warnBanner(`Seasonal inflection: the report ends in ${last?.month}, and the next reporting month enters the low season (Jun–Oct). Expect a step-down in revenue and active customers.`) : null,
      riskCards.length ? el("div", { class: "grid grid-cols-1 md:grid-cols-2 gap-4 mb-8" }, ...riskCards) : null,
      el("div", { class: "mb-8" },
        el("h2", { class: "font-serif text-xl text-ink mb-3" }, "Forward-looking P&L comparison"),
        boardTable(headers, rows),
      ),
      briefingCard("forward-looking", data),
    );
    return layout;
  }
  function nextMonthIsLow_(last) {
    if (!last) return false;
    const p = K.parseMonth(last.month); if (!p) return false;
    let m = p.mon + 1, y = p.yr; if (m > 12) { m = 1; y++; }
    return ["Jun", "Jul", "Aug", "Sep", "Oct"].includes(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]);
  }

  // ---- Customers (data-driven; quarterly from Customer Economics) ----
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

    // Quarterly revenue trend from CustomerRevenueQuarterly (all quarters, all customers).
    const crq = data.customerRevenueQuarterly || {};
    const myQ = (crq[c.slug] && crq[c.slug].quarterly) || [];      // [{quarter, revenue}]
    const myQValued = myQ.filter(p => p.revenue !== null && p.revenue !== undefined);
    const latestPt = myQValued.length ? myQValued[myQValued.length - 1] : null;

    // Mix share in the latest quarter (across all customers with a value that quarter).
    let mixShare = null;
    if (latestPt) {
      let total = 0;
      for (const sl in crq) {
        const pt = (crq[sl].quarterly || []).find(p => p.quarter === latestPt.quarter);
        if (pt && pt.revenue !== null && pt.revenue !== undefined) total += pt.revenue;
      }
      mixShare = total ? latestPt.revenue / total : null;
    }
    const latestGpEst = (latestPt && latestPt.revenue != null && c.margin != null) ? latestPt.revenue * c.margin : null;

    // Monthly detail from CustomerRevenueMonthly (where present).
    const monthlySeries = (data.customerRevenue[c.slug]?.series || []).filter(s => s.revenue !== null && s.revenue !== undefined);

    const kpis = el("div", { class: "grid grid-cols-2 md:grid-cols-4 gap-4 mb-6" },
      kpiTile("Quarter revenue",     latestPt ? K.fmtMoneyFull(latestPt.revenue) : "—", latestPt?.quarter || ""),
      kpiTile("Gross profit (est.)", latestGpEst !== null ? K.fmtMoneyFull(latestGpEst) : "—", "Revenue × margin"),
      kpiTile("Contribution margin", K.fmtPct(c.margin), "From Assumptions tab"),
      kpiTile("Mix share (latest)",  K.fmtPct(mixShare), latestPt?.quarter || ""),
    );

    // Q-to-Q chart — full multi-quarter trend from CustomerRevenueQuarterly.
    // A quarter is "partial" ONLY while the current quarter is incomplete
    // (< 3 months present in MonthlyFinancials). This is data-driven, so the
    // moment June is added the latest month becomes Jun (= end of Q2) and the
    // bar automatically turns back to its normal colour — no code change needed.
    const latestMonth = data.monthly.length ? data.monthly[data.monthly.length - 1].month : null;
    const cordon = latestMonth ? K.quarterCordon(data.monthly, K.quarterOf(latestMonth)) : null;
    const partialQuarter = (cordon && cordon.isPartial) ? cordon.quarter : null;
    const partialMonthCount = cordon ? cordon.monthCount : 0;
    const isPartialQ = (q) => !!q && q === partialQuarter;
    const qqCard = chartCard({
      title: "Quarter-to-quarter",
      subtitle: "Source: CustomerRevenueQuarterly" +
        (isPartialQ(latestPt?.quarter) ? ` · ${latestPt.quarter} partial (${partialMonthCount} of 3 months)` : ""),
      rangeKey: "quarterly", height: 300,
      data: { labels: myQ.map(p => p.quarter),
              series: [{ name: "Quarterly revenue",   values: myQ.map(p => p.revenue) },
                       { name: "Quarterly GP (est.)", values: myQ.map(p => (p.revenue != null && c.margin != null) ? p.revenue * c.margin : null) }] },
      buildOption: (s) => ({
        ...ECHART_THEME,
        legend: { ...ECHART_THEME.legend, data: ["Quarterly revenue", "Quarterly GP (est.)"] },
        xAxis: { ...ECHART_THEME.xAxis, type: "category", data: s.labels },
        yAxis: { ...ECHART_THEME.yAxis, type: "value" },
        series: [
          { name: "Quarterly revenue", type: "bar",
            itemStyle: { color: (p) => isPartialQ(s.labels[p.dataIndex]) ? "#C9A24B" : "#1A8A96" },
            data: s.series[0].values },
          { name: "Quarterly GP (est.)", type: "line", smooth: true, itemStyle: { color: "#C9A24B" }, data: s.series[1].values },
        ],
      }),
    });

    // M-to-M chart (only where monthly data exists)
    let monthBlock;
    if (monthlySeries.length) {
      monthBlock = chartCard({
        title: "Month-to-month", subtitle: "Source: CustomerRevenueMonthly (where entered)",
        rangeKey: "monthly", height: 300,
        data: { labels: monthlySeries.map(s => s.month),
                series: [{ name: "Revenue", values: monthlySeries.map(s => s.revenue) },
                         { name: "Gross Profit (est.)", values: monthlySeries.map(s => s.margin !== null ? s.revenue * s.margin : null) }] },
        buildOption: (s) => ({
          ...ECHART_THEME,
          legend: { ...ECHART_THEME.legend, data: ["Revenue", "Gross Profit (est.)"] },
          xAxis: { ...ECHART_THEME.xAxis, type: "category", data: s.labels },
          yAxis: { ...ECHART_THEME.yAxis, type: "value" },
          series: [
            { name: "Revenue", type: "bar", itemStyle: { color: "#115E67" }, data: s.series[0].values,
              markArea: { silent: true, itemStyle: { color: "rgba(201,162,75,0.10)" }, label: { show: false }, data: lowSeasonMarkArea(s.labels) } },
            { name: "Gross Profit (est.)", type: "line", smooth: true, itemStyle: { color: "#C9A24B" }, data: s.series[1].values },
          ],
        }),
      });
    } else {
      monthBlock = el("div", { class: "bg-white border border-dashed border-rule rounded-md p-5" },
        el("h2", { class: "font-serif text-xl text-ink mb-2" }, "Month-to-month"),
        el("p", { class: "text-sm text-mute" }, "Monthly detail is not entered for this customer in the CustomerRevenueMonthly tab. Quarterly figures above come from the Customer Economics tab."),
      );
    }

    return el("div", {},
      section("Customer", c.name,
        `Quarterly performance · contribution margin ${K.fmtPct(c.margin)}`),
      kpis,
      el("div", { class: "grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8" }, qqCard, monthBlock),
      briefingCard(c.slug, data,
        "Customer-level commentary pending — generate via the Google Sheet menu."),
    );
  }
  function cmpQuarter_(a, b) {
    const pa = /^Q([1-4])\s+(\d{4})$/.exec(a || ""), pb = /^Q([1-4])\s+(\d{4})$/.exec(b || "");
    const A = pa ? { y: +pa[2], q: +pa[1] } : { y: 9999, q: 9 };
    const B = pb ? { y: +pb[2], q: +pb[1] } : { y: 9999, q: 9 };
    return A.y - B.y || A.q - B.q;
  }

  // ---- Dashboard cell formatter (keep sheet's formatting verbatim) ----
  function fmtDashCell_(v) {
    if (v === null || v === undefined || v === "") return "—";
    return trim(v);
  }

  // ---- About / Glossary ----
  function viewAbout(state) {
    const data = state.data || {};
    const items = (data.glossary && data.glossary.length) ? data.glossary.map(g => [g.term, g.definition]) : [
      ["Low season (Jun – Oct)", "The seasonal trough — outside this window, revenue and active customers step up materially."],
      ["Q2 2026 cordon",         "Through May only — never label as a complete quarter, never annualize or extrapolate."],
      ["Active customers",       "Count at the first month of the quarter (documented in the Assumptions tab)."],
      ["Net Working Capital",    "Cash + Accounts Receivable + Inventory − Accounts Payable."],
      ["Contribution margin",    "Per-customer gross margin assumption used to estimate gross profit."],
      ["Data note (WARN)",       "When Σ customer revenue diverges from the P&L total by > 0.5%, a non-blocking note + chip surface so the board knows."],
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
    dashboard: viewDashboard,
    seasonality: viewSeasonality,
    "working-capital": viewWorkingCapital,
    financials: viewFinancials,
    "forward-looking": viewForwardLooking,
    customer: viewCustomer,
    about: viewAbout,
    empty: viewEmpty,
    loading: viewLoading,
    disposeAllCharts,
  };
})();
