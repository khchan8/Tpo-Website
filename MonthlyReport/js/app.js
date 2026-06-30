/* =========================================================
   app.js — router, nav, boot.
   ========================================================= */
(function () {
  const C = window.TPO_CONFIG;
  const D = window.TPO_DATA;
  const K = window.TPO_COMPUTE;
  const V = window.TPO_VIEWS;

  const state = { data: null, error: null };

  /* ---------- nav ---------- */
  function primaryNav(state) {
    const nav = document.getElementById("primary-nav");
    nav.innerHTML = "";
    const links = [
      ["Overview", "#/"],
      ["Dashboard", "#/dashboard"],
      ["Seasonality", "#/seasonality"],
      ["Customers", "#/customers"],            // special: opens first customer
      ["Financials", "#/financials"],
      ["Working Capital", "#/working-capital"],
      ["Forward-looking", "#/forward-looking"],
      ["Glossary", "#/about"],
    ];
    for (const [label, href] of links) {
      const a = document.createElement("a");
      a.href = href; a.textContent = label;
      a.addEventListener("click", () => setActiveLink());
      nav.appendChild(a);
    }
    setActiveLink();

    // Health chip logic moved to Glossary view.
    // Ensure it is hidden from the primary nav.
    const chip = document.getElementById("health-chip");
    if (chip) {
      chip.innerHTML = "";
      chip.classList.add("hidden");
    }

    // As-of
    const asof = document.getElementById("as-of");
    if (state.data?.monthly?.length) {
      const last = state.data.monthly[state.data.monthly.length - 1];
      asof.textContent = `As of ${last.month}`;
    } else {
      asof.textContent = "";
    }
  }
  function setActiveLink() {
    const cur = (location.hash || "#/").replace(/^#/, "");
    document.querySelectorAll("#primary-nav a").forEach(a => {
      const href = a.getAttribute("href").replace(/^#/, "");
      a.classList.toggle("active", href === cur || (href === "/customers" && cur.startsWith("/customers/")));
    });
  }

  /* ---------- router ---------- */
  function parseHash() {
    const h = (location.hash || "#/").replace(/^#/, "");
    const parts = h.split("/").filter(Boolean);
    if (parts.length === 0) return { name: "overview" };
    if (parts[0] === "customers" && parts.length >= 2) return { name: "customer", slug: parts[1] };
    if (parts[0] === "customers") {
      // no slug → first customer
      const first = state.data?.assumptions?.customers?.[0]?.slug;
      if (first) location.replace("#/customers/" + first);
      return { name: "overview" };
    }
    return { name: parts[0] };
  }

  function mount(node) {
    // Free ECharts instances from the outgoing view before we wipe the DOM,
    // so we never leak instances or carry spillover across views.
    if (window.TPO_VIEWS && typeof window.TPO_VIEWS.disposeAllCharts === "function") {
      window.TPO_VIEWS.disposeAllCharts();
    }
    const view = document.getElementById("view");
    view.innerHTML = "";
    view.appendChild(node);
  }

  function render() {
    if (state.error) { mount(V.empty(state.error.code)); return; }
    if (!state.data) { mount(V.loading()); return; }
    const route = parseHash();
    if (route.name === "customer") {
      // Mount the view FIRST (mount() clears #view), then prepend the
      // subnav. The old order (subnav then mount) let mount()'s innerHTML
      // reset wipe the just-built subnav — so only the default customer
      // (Mana) was ever visible and there was no way to switch.
      mount(V.customer(state, route.slug));
      renderCustomerSubnav(route.slug);
    } else if (V[route.name]) {
      clearCustomerSubnav();
      mount(V[route.name](state));
    } else {
      mount(V.overview(state));
    }
    setActiveLink();
  }

  function renderCustomerSubnav(activeSlug) {
    let sub = document.getElementById("sub-nav");
    if (!sub) {
      sub = document.createElement("div");
      sub.id = "sub-nav";
      sub.className = "";
      const view = document.getElementById("view");
      view.prepend(sub);
    }
    sub.innerHTML = "";
    for (const c of state.data.assumptions.customers) {
      const a = document.createElement("a");
      a.href = "#/customers/" + c.slug;
      a.textContent = c.name;
      if (c.slug === activeSlug) a.classList.add("active");
      sub.appendChild(a);
    }
  }
  function clearCustomerSubnav() {
    const sub = document.getElementById("sub-nav");
    if (sub) sub.remove();
  }

  /* ---------- boot ---------- */
  function applyContent(state) {
    const content = (key, fallback) => state.data?.content?.[key] || fallback;
    const companyName = content("company.name", C.COMPANY);
    const reportTitle = content("report.title", C.REPORT_TITLE);
    const currency = state.data?.assumptions?.params?.Currency || content("currency", C.CURRENCY);
    const footerNoteTpl = content("footer.note", "Reported in {currency}");
    const footerNote = footerNoteTpl.replace("{currency}", currency);

    const pt = document.getElementById("page-title"); if (pt) pt.textContent = `${companyName} — ${reportTitle}`;
    const hb = document.getElementById("header-brand"); if (hb) hb.textContent = companyName;
    const ht = document.getElementById("header-title"); if (ht) ht.textContent = reportTitle;
    const fn = document.getElementById("footer-note"); if (fn) fn.textContent = footerNote;
  }

  async function boot() {
    primaryNav(state);
    try {
      state.data = await D.load();
      applyContent(state);
      primaryNav(state);
      render();
    } catch (e) {
      console.error("[TPO] boot failed:", e);
      state.error = e;
      mount(V.empty(e.code));
    }
  }

  window.addEventListener("hashchange", render);

  // Re-fit charts on any viewport change — foldable unfold/flip, rotation,
  // and browser-chrome show/hide. Some foldable webviews update the layout
  // viewport on unfold WITHOUT triggering a CSS reflow, leaving the page
  // laid out at the old (cover-screen) width with a blank strip on one side.
  // The offsetWidth read forces such a stale layout to recompute, and we
  // re-read the viewport width so any layout that depends on it (e.g. the
  // responsive grids) picks up the new size.
  function refitViewport() {
    document.querySelectorAll("[_echarts_instance_]").forEach(n => {
      const inst = echarts.getInstanceByDom(n);
      if (inst) inst.resize();
    });
    // force a stale layout to reflow at the new viewport width
    void document.documentElement.offsetWidth;
  }
  let refitTimer = null;
  function scheduleRefit() {
    clearTimeout(refitTimer);
    refitTimer = setTimeout(refitViewport, 120);
  }
  window.addEventListener("resize", scheduleRefit);
  window.addEventListener("orientationchange", scheduleRefit);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleRefit);
  }
  // ---- TEMPORARY foldable-layout diagnostic (remove once fixed) ----
  // Invisible to normal visitors; only loads with ?debug=1 in the URL.
  // Reports what the page actually computes so we can see why content
  // doesn't fill the unfolded screen.
  if (new URLSearchParams(location.search).get("debug") !== null) {
    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed", left: "6px", bottom: "6px", zIndex: 99999,
      background: "rgba(11,31,58,0.94)", color: "#fff",
      font: "11px/1.5 ui-monospace, Menlo, Consolas, monospace",
      padding: "7px 9px", borderRadius: "6px", maxWidth: "94vw",
      pointerEvents: "none", whiteSpace: "pre", boxShadow: "0 4px 16px rgba(0,0,0,.3)",
    });
    document.body.appendChild(box);
    const tick = () => {
      const de = document.documentElement;
      const v = document.getElementById("view");
      const hd = document.querySelector("header > div");
      const vr = v ? v.getBoundingClientRect() : {};
      const hr = hd ? hd.getBoundingClientRect() : {};
      const vv = window.visualViewport || {};
      const msg =
        "doc.clientWidth  = " + de.clientWidth + "\n" +
        "doc.scrollWidth  = " + de.scrollWidth + "   <-- >innerWidth = overflow\n" +
        "window.innerWidth= " + window.innerWidth + "\n" +
        "screen.width     = " + window.screen.width + "\n" +
        "visualViewport.w = " + Math.round(vv.width || 0) +
        "  scale=" + (vv.scale || 1).toFixed(2) +
        "  left=" + Math.round(vv.offsetLeft || 0) + "\n" +
        "devicePixelRatio = " + window.devicePixelRatio + "\n" +
        "#view rect       = w " + Math.round(vr.width || 0) +
        "  left " + Math.round(vr.left || 0) + "\n" +
        "header rect      = w " + Math.round(hr.width || 0) +
        "  left " + Math.round(hr.left || 0);
      box.textContent = msg;
      try { console.log("[TPO-debug]\n" + msg); } catch (_) {}
    };
    setInterval(tick, 600);
    window.addEventListener("load", tick);
    window.addEventListener("resize", tick);
    window.addEventListener("scroll", tick, true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", tick);
      window.visualViewport.addEventListener("scroll", tick);
    }
    tick();
  }

  boot();
})();