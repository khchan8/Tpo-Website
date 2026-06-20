/* =========================================================
   app.js — router, nav, boot.
   ========================================================= */
(function () {
  const C  = window.TPO_CONFIG;
  const D  = window.TPO_DATA;
  const K  = window.TPO_COMPUTE;
  const V  = window.TPO_VIEWS;

  const state = { data: null, error: null };

  /* ---------- nav ---------- */
  function primaryNav(state) {
    const nav = document.getElementById("primary-nav");
    nav.innerHTML = "";
    const links = [
      ["Overview",         "#/"],
      ["Dashboard",        "#/dashboard"],
      ["Seasonality",      "#/seasonality"],
      ["Customers",        "#/customers"],            // special: opens first customer
      ["Financials",       "#/financials"],
      ["Working Capital",  "#/working-capital"],
      ["Forward-looking",  "#/forward-looking"],
      ["Glossary",         "#/about"],
    ];
    for (const [label, href] of links) {
      const a = document.createElement("a");
      a.href = href; a.textContent = label;
      a.addEventListener("click", () => setActiveLink());
      nav.appendChild(a);
    }
    setActiveLink();

    // Health chip (WARN if reconciliation gap)
    const chip = document.getElementById("health-chip");
    chip.innerHTML = "";
    if (state.data) {
      const recon = K.reconciliation(state.data.customerRevenueTotalByMonth, state.data.monthly);
      if (recon.length) {
        const c = document.createElement("span");
        c.className = "chip chip-warn";
        c.textContent = `Data note · ${recon.length} gap${recon.length>1?"s":""}`;
        chip.appendChild(c);
        chip.classList.remove("hidden");
      } else {
        const c = document.createElement("span");
        c.className = "chip chip-ok";
        c.textContent = "Data healthy";
        chip.appendChild(c);
        chip.classList.remove("hidden");
      }
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
  async function boot() {
    primaryNav(state);
    try {
      state.data = await D.load();
      primaryNav(state);
      render();
    } catch (e) {
      console.error("[TPO] boot failed:", e);
      state.error = e;
      mount(V.empty(e.code));
    }
  }

  window.addEventListener("hashchange", render);
  window.addEventListener("resize", () => {
    // ECharts resize on view change
    document.querySelectorAll("[_echarts_instance_]").forEach(n => {
      const inst = echarts.getInstanceByDom(n);
      if (inst) inst.resize();
    });
  });
  boot();
})();