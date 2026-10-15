// The price table is data a person edits by hand, so these tests check it is well
// formed, and that the claims METHOD.md makes about it are still true. Changing a price
// in a way that breaks one of those claims fails here, so the docs can't quietly go stale.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MODELS, CHECKED, SOURCES } = require('../prices.js');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = s => DATE.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const isPrice = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;

test('ids are unique', () => {
  const ids = MODELS.map(m => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every model has a name, a provider, a source and a date', () => {
  assert.ok(isDate(CHECKED), 'CHECKED is a real date');
  for (const m of MODELS) {
    assert.ok(typeof m.name === 'string' && m.name.length > 0, m.id + ' name');
    assert.ok(m.provider in SOURCES, m.id + ' provider');
    assert.ok(m.source.startsWith('https://'), m.id + ' source');
    assert.ok(isDate(m.checked), m.id + ' checked');
    assert.ok(m.tokenizer === null || typeof m.tokenizer === 'string', m.id + ' tokenizer');
  }
});

test('every price is a number, zero or more, and cached input never costs more than input', () => {
  for (const m of MODELS) {
    const sets = [m, ...(m.long ? [m.long] : []), ...(m.changes || [])];
    for (const p of sets) {
      for (const k of ['input', 'cached', 'output']) if (k in p) assert.ok(isPrice(p[k]), m.id + ' ' + k);
      if ('input' in p && 'cached' in p) assert.ok(p.cached <= p.input, m.id + ' cached <= input');
    }
  }
});

test('long-context tiers have a threshold and cost at least the standard price', () => {
  for (const m of MODELS.filter(x => x.long)) {
    assert.ok(Number.isInteger(m.long.above) && m.long.above > 0, m.id + ' threshold');
    for (const k of ['input', 'cached', 'output']) assert.ok(m.long[k] >= m[k], m.id + ' long ' + k);
  }
});

test('scheduled changes have real dates, in order', () => {
  for (const m of MODELS.filter(x => x.changes)) {
    const dates = m.changes.map(c => c.from);
    for (const d of dates) assert.ok(isDate(d), m.id + ' ' + d);
    assert.deepEqual([...dates].sort(), dates, m.id + ' in order');
    assert.equal(new Set(dates).size, dates.length, m.id + ' no duplicate dates');
  }
});

test('METHOD.md: output costs 5 to 8.3 times input for every model, at standard prices', () => {
  for (const m of MODELS) {
    const ratio = m.output / m.input;
    assert.ok(ratio >= 5 && ratio < 8.35, m.id + ' ratio ' + ratio);
  }
});

test('METHOD.md: cached input costs 2.5% to 10% of input for every model', () => {
  for (const m of MODELS) {
    const ratio = m.cached / m.input;
    assert.ok(ratio >= 0.025 - 1e-12 && ratio <= 0.10 + 1e-12, m.id + ' ratio ' + ratio);
  }
});

test('the models the worked example and its tests use are in the table', () => {
  for (const id of ['claude-sonnet-5', 'claude-fable-5-1', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-sonnet-4-6', 'gemini-4-argon']) {
    assert.ok(MODELS.some(m => m.id === id), id);
  }
});
