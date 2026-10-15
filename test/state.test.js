// The page's fields, presets and links. The first tests tie the page's example to
// METHOD.md: the figures the page shows for the "News tagging" preset must be the
// figures worked out by hand there.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const C = require(process.env.COST_JS ? path.resolve(process.env.COST_JS) : '../cost.js');
const S = require('../state.js');
const { MODELS } = require('../prices.js');

const TODAY = '2026-10-15';
const IDS = MODELS.map(m => m.id);

function run(state) {
  const models = S.effectiveModels(MODELS, state.prices);
  const r = S.toInputs(state, models, C.validate);
  return { ...r, models, w: r.problems.length ? null : C.workflow(r.inputs, models, TODAY) };
}

// ---- the presets ----

test('the News tagging preset gives METHOD.md\'s worked example', () => {
  const { w, change, models, review, test: t, precision, problems } = run(S.fromPreset('news'));
  assert.deepEqual(problems, []);
  assert.equal(C.money(w.per1000.model), '$9.21');
  assert.equal(C.money(w.per1000.people), '$1,434');
  assert.equal(C.money(w.per1000.total), '$1,443');
  assert.equal(C.percent(w.share.model, 2), '0.64%');
  assert.equal(C.money(w.perMonth.total), '$14,433');
  assert.equal(C.percent(w.manual.saving), '67.6%');

  const b = C.breakEven(run(S.fromPreset('news')).inputs, models, TODAY, change);
  assert.equal(C.money(b.delta), '$36.85');
  assert.equal(C.count(b.points, 2), '1.38');
  assert.equal(C.percent(b.shareNeeded), '52.2%');

  assert.equal(C.percent(C.reviewThreshold(w.review, review.mistakeCost, review.catchRate).chance), '5.4%');
  const m = C.mistakes({ out: w.routing.out, toPerson: 0.536, ...t, precision, catchRate: review.catchRate, review: w.review, mistakeCost: review.mistakeCost });
  assert.equal(C.money(m.perCaught), '$6.08');
  assert.equal(C.count(m.reaching.rate), '26');
  assert.equal(C.money(m.cost.rate), '$1,300');
  assert.equal(C.money(w.per1000.total + m.cost.rate), '$2,743');
});

test('the Support triage preset: the model is 0.2% of $46.74', () => {
  // 900 x (0.4 x $0.10 + 0.6 x $0.01) + 60 x $0.50 = 71.4 per million tokens: $0.0714 per 1,000.
  // 0.04 x 2 / 60 x $35 = $0.04667 per ticket: $46.67 per 1,000.
  const { w, problems } = run(S.fromPreset('support'));
  assert.deepEqual(problems, []);
  assert.ok(Math.abs(w.per1000.model - 0.0714) < 1e-12);
  assert.equal(C.money(w.per1000.people), '$46.67');
  assert.equal(C.money(w.per1000.total), '$46.74');
  assert.equal(C.percent(w.share.model), '0.2%');
});

test('the Research agent preset: the model is a third of $2,611', () => {
  // Per call 15,000 x (0.3 x $10 + 0.7 x $0.25) + 1,200 x $50 = 107,625 per million tokens;
  // 8 calls: $0.861 per report. People 0.10 x 12 / 60 x $75 = $1.50. Fixed $500 / 2,000 = $0.25.
  const { w, problems } = run(S.fromPreset('agent'));
  assert.deepEqual(problems, []);
  assert.equal(C.money(w.per1000.model), '$861');
  assert.equal(C.money(w.per1000.people), '$1,500');
  assert.equal(C.money(w.per1000.fixed), '$250');
  assert.equal(C.money(w.per1000.total), '$2,611');
  assert.equal(C.percent(w.share.model), '33.0%');
});

test('every preset uses models that are in the price table', () => {
  for (const [name, p] of Object.entries(S.PRESETS)) {
    for (const s of p.state.steps) assert.ok(IDS.includes(s.model), name + ' ' + s.model);
    assert.ok(IDS.includes(p.state.altModel), name + ' ' + p.state.altModel);
  }
});

// ---- text to numbers ----

test('numbers as people type them', () => {
  const cases = [
    ['1,000', 1000], ['$53.51', 53.51], ['53.6%', 53.6], [' 3 ', 3], ['.5', 0.5], ['5.', 5], ['1e3', 1000],
    ['', null], [null, null], ['abc', NaN], ['--1', NaN], ['1.2.3', NaN], ['12abc', NaN], [7, 7],
  ];
  for (const [text, want] of cases) assert.deepEqual(S.parseNumber(text), want, JSON.stringify(text));
});

test('optional fields left blank are skipped, not zero', () => {
  const s = { ...S.fromPreset('news'), manual: '', altInput: '', altToPerson: '', tested: '', wrong: '', precision: '', mistakeCost: '' };
  const r = run(s);
  assert.deepEqual(r.problems, []);
  assert.equal(r.inputs.manualMinutes, null);
  assert.equal(r.change.input, 2567.75);        // blank: the current step's tokens
  assert.equal(r.change.toPerson, null);
  assert.equal(r.test, null);
  assert.equal(r.precision, null);
  assert.equal(r.review.mistakeCost, null);
});

test('problems in the extra questions are reported with their fields', () => {
  const s = { ...S.fromPreset('news'), altToPerson: '95', altOutput: '-3', tested: '19.5', catchRate: '', mistakeCost: 'lots', precision: '120' };
  assert.deepEqual(run(s).problems.map(p => p.field).sort(), ['altOutput', 'altToPerson', 'catchRate', 'mistakeCost', 'precision', 'tested']);
  const wrong = { ...S.fromPreset('news'), wrong: '200' };
  assert.deepEqual(run(wrong).problems.map(p => p.field), ['wrong']);
});

// ---- the price table ----

test('an edited price replaces the published one and drops its tiers and scheduled changes', () => {
  const s = S.fromPreset('news');
  s.prices.edited['gemini-4-argon'] = { input: '1', cached: '0.1', output: '4' };
  const models = S.effectiveModels(MODELS, s.prices);
  assert.equal(models['gemini-4-argon'].input, 1);
  assert.deepEqual(models['gemini-4-argon'].changes, []);
  assert.equal(C.priceOn(models['gemini-4-argon'], '2027-01-01').input, 1);
  assert.equal(models['claude-sonnet-5'].edited, undefined);
});

test('an added model can be used, and a bad price in it is reported', () => {
  const s = S.fromPreset('news');
  s.prices.added.push({ id: 'added-1', name: 'Our fine-tune', input: '1', cached: '0.1', output: '3' });
  s.steps[0].model = 'added-1';
  const ok = run(s);
  assert.deepEqual(ok.problems, []);
  assert.ok(Math.abs(ok.w.per1000.model - (2567.75 * 1 + 407.58 * 3) / 1000) < 1e-12);
  s.prices.added[0].output = 'free';
  assert.deepEqual(run(s).problems.map(p => p.field), ['prices']);
});

// ---- the link ----

test('a link brings back exactly what was on the page', () => {
  const s = S.fromPreset('support');
  s.steps.push({ model: 'gpt-6-luna', input: '1,200', output: '80', calls: '0.5', cached: '' });
  s.batch = true;
  s.altToPerson = '3.5';
  s.prices.edited['gpt-6-luna'] = { input: '0.09', cached: '0.009', output: '0.45' };
  s.prices.added.push({ id: 'added-1', name: 'Ours, v2 (fine-tuned; 50% off)', input: '1', cached: '0.1', output: '3' });
  const back = S.decode(S.encode(s), S.PRESETS.news.state, IDS);
  assert.deepEqual(back, s);
});

test('a link is untrusted: odd and hostile content is cleaned up or ignored', () => {
  const base = S.PRESETS.news.state;
  const hostile = '#n=' + encodeURIComponent('<img src=x onerror=alert(1)>') +
    '&h=' + '9'.repeat(500) +
    '&s=' + ['no-such-model,1,1,1,0', 'claude-haiku-5-5,10,5,1,0'].join(';') +
    '&am=evil' +
    '&pa=' + ['added-1,' + encodeURIComponent('<script>alert(1)</script>') + ',1,0.1,2', 'claude-sonnet-5,hijack,0,0,0', 'added-x,bad id,1,1,1'].join(';') +
    '&pe=not-a-model,1,1,1' +
    '&q=%E0%A4%A' +            // a broken escape sequence
    '&zz=ignored';
  const s = S.decode(hostile, base, IDS);
  assert.equal(s.records.length, 24);                         // shortened; validation then reports it
  assert.equal(s.toPerson, '9'.repeat(24));
  assert.deepEqual(s.steps.map(x => x.model), ['claude-haiku-5-5']);   // the unknown model's step is dropped
  assert.equal(s.altModel, base.altModel);                    // unknown model: back to the preset's
  assert.deepEqual(s.prices.added.map(a => a.id), ['added-1']);         // only well-formed new ids
  assert.equal(s.prices.added[0].name, '<script>alert(1)</script>');   // kept as text; the page only ever uses textContent
  assert.deepEqual(s.prices.edited, {});
  assert.equal(s.precision, '');
  assert.equal(s.zz, undefined);
});

test('a link with too many steps keeps the first eight', () => {
  const steps = Array.from({ length: 20 }, () => 'claude-sonnet-5,1,1,1,0').join(';');
  assert.equal(S.decode('#s=' + steps, S.PRESETS.news.state, IDS).steps.length, S.MAX_STEPS);
});

test('an empty or missing link gives the preset', () => {
  const base = S.PRESETS.news.state;
  for (const hash of ['', '#', undefined, '#garbage']) {
    const s = S.decode(hash, base, IDS);
    assert.deepEqual(s, { ...JSON.parse(JSON.stringify(base)), prices: { edited: {}, added: [] } });
  }
});
