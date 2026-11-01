/* Integration for the existing marketing page, not a replacement application. */
(function () {
  'use strict';

  function init() {
    if (!window.ScrollCraft) return;

    const cards = Array.from(document.querySelectorAll('#portfolioGrid .portfolio-item'));
    cards.forEach(function (card, index) {
      const group = index < 4 ? 'core' : index < 7 ? 'performance' : 'botanical';
      const withinGroup = index < 4 ? index : index < 7 ? index - 4 : index - 7;
      card.dataset.tpoWave = group;
      card.setAttribute('data-sc-in', '');
      card.style.setProperty('--tpo-wave-delay', (withinGroup % 3) * 60 + 'ms');
    });

    const craft = ScrollCraft.mount(document.body);
    if (window.TPOBatchJourney) window.TPOBatchJourney.init();
    document.documentElement.classList.add('tpo-scroll-ready');

    let layoutFrame = 0;
    function refreshLayout() {
      if (layoutFrame) return;
      layoutFrame = requestAnimationFrame(function () {
        layoutFrame = 0;
        craft.layout();
        if (window.TPOBatchJourney) window.TPOBatchJourney.refresh();
      });
    }
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', refreshLayout);
    window.addEventListener('resize', refreshLayout, { passive: true });

    const filters = Array.from(document.querySelectorAll('#portfolio-flters li'));
    function updateWaves() {
      document.querySelectorAll('[data-tpo-wave-heading]').forEach(function (heading) {
        const visible = cards.some(function (card) {
          return card.dataset.tpoWave === heading.dataset.tpoWaveHeading && card.style.display !== 'none';
        });
        heading.hidden = !visible;
      });
      filters.forEach(function (filter) {
        filter.setAttribute('aria-pressed', String(filter.classList.contains('filter-active')));
      });
      refreshLayout();
    }
    filters.forEach(function (filter) {
      filter.tabIndex = 0;
      filter.setAttribute('role', 'button');
      filter.addEventListener('click', updateWaves);
      filter.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          filter.click();
        }
      });
    });
    updateWaves();

    // Catalog disclosure, form tabs, lazy images and modals can all change page
    // geometry without a window resize. Remeasure the engine, not the content.
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(refreshLayout);
      ['formulationCatalog', 'quote-booking', 'hero', 'about'].forEach(function (id) {
        const element = document.getElementById(id);
        if (element) observer.observe(element);
      });
    }
    document.querySelectorAll('img').forEach(function (image) {
      if (!image.complete) image.addEventListener('load', refreshLayout, { once: true });
    });
    document.addEventListener('shown.bs.modal', refreshLayout);
    document.addEventListener('hidden.bs.modal', refreshLayout);
    window.addEventListener('load', refreshLayout, { once: true });
  }

  if (document.readyState === 'complete') init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
