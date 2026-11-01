/* Page-local batch exhibit. ScrollCraft owns geometry and --sc-p; no idle loop. */
(function (global) {
  'use strict';
  let initialized = false;
  let refresh = function () {};

  global.TPOBatchJourney = {
    init: function () {
      if (initialized) return;
      const act = document.getElementById('batchJourney');
      if (!act) return;
      initialized = true;
      const small = matchMedia('(max-width: 860px)');
      const reduced = matchMedia('(prefers-reduced-motion: reduce)');
      const steps = Array.from(act.querySelectorAll('[data-batch-step]'));
      const cells = Array.from(act.querySelectorAll('.tpo-batch-ck'));
      const panels = Array.from(act.querySelectorAll('[data-batch-panel]'));
      let frame = 0;
      let lastProgress = -1;
      let lastMode = '';
      const clamp = function (v) { return Math.min(1, Math.max(0, v)); };
      const smooth = function (v) { v = clamp(v); return v * v * (3 - 2 * v); };

      function paint() {
        frame = 0;
        const mode = small.matches || reduced.matches ? 'flow' : 'pin';
        const p = mode === 'flow' ? 1 : clamp(parseFloat(getComputedStyle(act).getPropertyValue('--sc-p')) || 0);
        if (mode === lastMode && p === lastProgress) return;
        lastMode = mode;
        lastProgress = p;
        const stage = Math.min(4, Math.floor(p * 5));
        act.dataset.mode = mode;
        act.dataset.stage = String(stage);
        const wipes = [1];
        const checkpoints = [];
        for (let i = 0; i < 5; i++) {
          const state = p >= i / 5 + 0.16 ? 'past' : i === stage ? 'active' : 'future';
          if (mode === 'flow') {
            steps[i].removeAttribute('data-state');
            steps[i].removeAttribute('aria-current');
          } else {
            steps[i].dataset.state = i < stage ? 'past' : i === stage ? 'active' : 'future';
            if (i === stage) steps[i].setAttribute('aria-current', 'step');
            else steps[i].removeAttribute('aria-current');
          }
          cells[i].dataset.state = state;
          checkpoints.push(state);
          if (i > 0) {
            const wipe = mode === 'flow' ? 1 : smooth((p - (i / 5 - 0.06)) / 0.14);
            wipes.push(wipe);
            act.style.setProperty('--tpo-w' + (i + 1), wipe.toFixed(4));
          }
          panels[i].style.visibility = mode === 'flow' || wipes[i] > 0 ? 'visible' : 'hidden';
        }
        // These describe painted wipes, trace scale and seal, not a synthetic
        // scroll counter. Only the actual resolved ending is a deliberate hold.
        const seal = clamp((p - 0.965) / 0.03);
        act.dataset.scVerifyState = 'mode=' + mode + ';trace=' + p.toFixed(3) +
          ';stage=' + stage + ';wipe=' + wipes.map(w => w.toFixed(2)).join(',') +
          ';checks=' + checkpoints.join(',') + ';seal=' + seal.toFixed(2);
        act.dataset.scVerifyHold = String(mode === 'flow' || p === 1);
      }
      refresh = function () {
        if (!frame) frame = requestAnimationFrame(paint);
      };
      act.classList.add('tpo-batch--live');
      paint();
      // Registered after mount: the engine publishes progress before this read.
      addEventListener('scroll', refresh, { passive: true });
      addEventListener('resize', refresh, { passive: true });
      small.addEventListener('change', refresh);
      reduced.addEventListener('change', refresh);
    },
    refresh: function () { refresh(); }
  };
})(window);
