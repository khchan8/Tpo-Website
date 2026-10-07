const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../js/report-core');

function loadCompute() {
  const window = { TPOCore: C };
  const ctx = vm.createContext({ window, console, Intl });
  vm.runInContext(fs.readFileSync('js/compute.js', 'utf8'), ctx);
  return window.TPO_COMPUTE;
}

// Aug-26 / Jul-26 51 / Aug-25 35 → +9 / +17.6%  and  +25 / +71.4%
test('exact-month MoM and YoY against Aug-26 fixture', () => {
  const K = loadCompute();
  const rows = [
    { month: 'Aug-25', count: 35 },
    { month: 'Jul-26', count: 51 },
    { month: 'Aug-26', count: 60 },
  ];
  const m = K.customerCountMomentum(rows, 'Aug-26');
  assert.equal(m.asOfMonth, 'Aug-26');
  assert.equal(m.current.count, 60);
  assert.equal(m.previous.month, 'Jul-26');
  assert.equal(m.previous.count, 51);
  assert.equal(m.priorYear.month, 'Aug-25');
  assert.equal(m.priorYear.count, 35);
  assert.equal(m.mom.delta, 9);
  assert.ok(Math.abs(m.mom.pct - 9 / 51) < 1e-12);
  assert.equal(m.yoy.delta, 25);
  assert.ok(Math.abs(m.yoy.pct - 25 / 35) < 1e-12);
  assert.equal(m.rolling12.length, 12);
  assert.equal(m.rolling12.at(-1).month, 'Aug-26');
  assert.equal(m.rolling12.at(-1).count, 60);
  assert.equal(m.rolling12.at(-2).month, 'Jul-26');
  assert.equal(m.rolling12.at(-2).count, 51);
  assert.equal(m.rolling12.at(-12).month, 'Sep-25');
  assert.equal(m.rolling12.at(-12).count, null);
});

test('missing adjacent and prior-year months do not borrow other rows', () => {
  const K = loadCompute();
  const rows = [
    { month: 'May-25', count: 10 },
    { month: 'Jun-25', count: 20 },
    { month: 'Aug-26', count: 60 },   // gap: Jul-26 absent, Aug-25 absent
  ];
  const m = K.customerCountMomentum(rows, 'Aug-26');
  assert.equal(m.current.count, 60);
  assert.equal(m.previous.month, 'Jul-26');
  assert.equal(m.previous.count, null);             // not nearest: must stay null
  assert.equal(m.mom.delta, null);
  assert.equal(m.mom.pct, null);
  assert.equal(m.priorYear.month, 'Aug-25');
  assert.equal(m.priorYear.count, null);
  assert.equal(m.yoy.delta, null);
  assert.equal(m.yoy.pct, null);
  // rolling12: Sep-25 → Aug-26, all nulls except Aug-26 and only Jun-25 / May-25 outside window
  assert.equal(m.rolling12.length, 12);
  assert.equal(m.rolling12.at(-1).count, 60);
  for (let i = 0; i < m.rolling12.length - 1; i++) {
    assert.equal(m.rolling12[i].count, null);
  }
});

test('current zero is a real count; zero baseline produces null percent (no infinite growth)', () => {
  const K = loadCompute();
  const rows1 = [
    { month: 'Jul-26', count: 5 },
    { month: 'Aug-26', count: 0 },
  ];
  const m1 = K.customerCountMomentum(rows1, 'Aug-26');
  assert.equal(m1.current.count, 0);
  assert.equal(m1.mom.delta, -5);
  assert.equal(m1.mom.pct, -1);                     // baseline 5 nonzero → finite -100%

  const rows2 = [
    { month: 'Jul-26', count: 0 },
    { month: 'Aug-26', count: 3 },
  ];
  const m2 = K.customerCountMomentum(rows2, 'Aug-26');
  assert.equal(m2.mom.delta, 3);
  assert.equal(m2.mom.pct, null);                   // baseline 0 → null (not Infinity)

  const rows3 = [
    { month: 'Jul-26', count: 0 },
    { month: 'Aug-26', count: 0 },
  ];
  const m3 = K.customerCountMomentum(rows3, 'Aug-26');
  assert.equal(m3.mom.delta, 0);
  assert.equal(m3.mom.pct, null);
});

test('future and unparseable rows cannot advance the selected as-of month', () => {
  const K = loadCompute();
  const rows = [
    { month: 'Jun-26', count: 30 },
    { month: 'Jul-26', count: 51 },
    { month: 'Aug-26', count: 60 },
    { month: 'Sep-26', count: 99 },                 // future relative to Aug-26
    { month: 'not-a-month', count: 123 },           // unparseable
  ];
  const m = K.customerCountMomentum(rows, 'Aug-26');
  assert.equal(m.asOfMonth, 'Aug-26');
  assert.equal(m.current.count, 60);
  assert.equal(m.previous.count, 51);
  assert.equal(m.priorYear.count, null);             // Aug-25 absent in fixture
  // rolling12 must not include Sep-26 even though it has a count
  assert.ok(!m.rolling12.some(r => r.month === 'Sep-26'));
  assert.equal(m.rolling12.at(-1).month, 'Aug-26');
});


test('empty input yields nulls; asOfMonth with no matching row leaves current.count null', () => {
  const K = loadCompute();
  const empty = K.customerCountMomentum([], 'Aug-26');
  assert.equal(empty.asOfMonth, 'Aug-26');
  assert.equal(empty.current.count, null);
  assert.equal(JSON.stringify(empty.previous), '{"month":"Jul-26","count":null}');
  assert.equal(JSON.stringify(empty.priorYear), '{"month":"Aug-25","count":null}');
  assert.equal(empty.mom.delta, null);
  assert.equal(empty.mom.pct, null);
  assert.equal(empty.rolling12.length, 12);

  const only = K.customerCountMomentum([{ month: 'Jul-26', count: 51 }], 'Aug-26');
  assert.equal(only.current.count, null);
  assert.equal(only.previous.month, 'Jul-26');
  assert.equal(only.previous.count, 51);             // previous row exists in data
  assert.equal(only.mom.delta, null);
  assert.equal(only.rolling12.length, 12);
});

test('rolling12 calendar months span year boundaries and stay in order', () => {
  const K = loadCompute();
  const rows = [
    { month: 'Dec-25', count: 12 },
    { month: 'Jan-26', count: 15 },
    { month: 'Feb-26', count: 17 },
    { month: 'Mar-26', count: 21 },
  ];
  const m = K.customerCountMomentum(rows, 'Mar-26');
  assert.equal(JSON.stringify(m.rolling12.map(r => r.month)),
    '["Apr-25","May-25","Jun-25","Jul-25","Aug-25","Sep-25","Oct-25","Nov-25","Dec-25","Jan-26","Feb-26","Mar-26"]');
  assert.equal(m.rolling12.at(8).count, 12);         // Dec-25
  assert.equal(m.rolling12.at(9).count, 15);
  assert.equal(m.rolling12.at(11).count, 21);
});


test('non-finite counts remain gaps rather than corrupting customer changes or chart values', () => {
  const K = loadCompute();
  for (const invalid of [null, NaN, Infinity, -Infinity]) {
    const m = K.customerCountMomentum([{ month: 'Jul-26', count: invalid }, { month: 'Aug-26', count: 60 }], 'Aug-26');
    assert.equal(m.previous.count, null);
    assert.equal(m.mom.delta, null);
    assert.equal(m.mom.pct, null);
    const missing = K.customerCountMomentum([{ month: 'Jul-26', count: 51 }, { month: 'Aug-26', count: invalid }], 'Aug-26');
    assert.equal(missing.current.count, null);
    assert.equal(missing.rolling12.at(-1).count, null);
    assert.equal(missing.mom.delta, null);
  }
});