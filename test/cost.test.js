// Every expected number below was worked out by hand before the code was written
// (METHOD.md section 7 shows the working), then checked with exact decimal
// arithmetic in audit/reference_check.py. Where a number comes from outside this
// project (a measured run, a published table), the test says where.
//
// COST_JS lets audit/mutants.js run these same tests against deliberately broken
// copies of cost.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const C = require(process.env.COST_JS ? path.resolve(process.env.COST_JS) : '../cost.js');
const { MODELS } = require('../prices.js');

const models = Object.fromEntries(MODELS.map(m => [m.id, m]));
const TODAY = '2026-10-15';

// Equal to within a billionth of the expected size (floating-point rounding only).
function close(actual, expected, what) {
  const tol = 1e-9 * Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tol, (what || 'value') + ': expected ' + expected + ', got ' + actual);
}

// The page's worked example (METHOD.md section 7). Token counts measured in n8n
// execution 49 of the metadata enrichment workflow: 61,626 input and 9,782 output
// tokens over 24 articles. Routing measured on the Golden 500 (run 70): 268 of 500 to
// an editor, 33 suppressed as duplicates.
const RUN49 = { input: 61626 / 24, output: 9782 / 24, calls: 1, cached: 0 };
function example(over = {}) {
  return {
    records: 10000,
    steps: [{ model: 'claude-sonnet-5', ...RUN49 }],
    batch: false,
    toPerson: 268 / 500,
    stopped: 33 / 500,
    minutes: 3,
    hourly: 53.51,
    fixed: 0,
    manualMinutes: null,
    ...over,
  };
}

// ---- model cost ----

test('reproduces the $13.82 per 1,000 that n8n execution 49 reported', () => {
  // The workflow priced its tokens at $3 in / $15 out per million. Same tokens, same
  // prices, same answer: 331,608 / 24,000,000 = $0.013817 per article.
  const price = { input: 3, cached: 0.3, output: 15, long: null };
  const { perRecord } = C.stepCost(RUN49, price, false);
  close(perRecord, 0.013817, 'per article');
  assert.equal(C.money(perRecord * 1000), '$13.82');
});

test('at Claude Sonnet 5\'s price today the same run costs $9.21 per 1,000', () => {
  // 2,567.75 x $2 + 407.5833 x $10 = 9,211.33 per million tokens.
  const { perRecord } = C.stepCost(RUN49, C.priceOn(models['claude-sonnet-5'], TODAY), false);
  close(perRecord * 1000, 9.2113333333333333);
  assert.equal(C.money(perRecord * 1000), '$9.21');
});

test('cached input is billed at the cache price', () => {
  // 80% cached on Sonnet 5: input rate 0.2 x $2 + 0.8 x $0.20 = $0.56 per million.
  // 2,567.75 x 0.56 + 407.5833 x 10 = 5,513.77 per million.
  const step = { ...RUN49, cached: 0.8 };
  const { perRecord } = C.stepCost(step, C.priceOn(models['claude-sonnet-5'], TODAY), false);
  close(perRecord * 1000, 5.5137733333333333);
});

test('batch processing halves the model cost', () => {
  const { perRecord } = C.stepCost(RUN49, C.priceOn(models['claude-sonnet-5'], TODAY), true);
  close(perRecord * 1000, 4.6056666666666667);
});

test('calls per record scale the cost: a loop, a step few records reach, a call per batch', () => {
  const price = C.priceOn(models['claude-sonnet-5'], TODAY);
  const once = C.stepCost(RUN49, price, false).perRecord;
  close(C.stepCost({ ...RUN49, calls: 3 }, price, false).perRecord, 3 * once);
  close(C.stepCost({ ...RUN49, calls: 0.6 }, price, false).perRecord, 0.6 * once);
  close(C.stepCost({ ...RUN49, calls: 1 / 24 }, price, false).perRecord, once / 24);
  assert.equal(C.stepCost({ ...RUN49, calls: 0 }, price, false).perRecord, 0);
});

test('a prompt over the long-context threshold pays the higher price for every token', () => {
  // Claude Haiku 5.5: over 100,000 tokens, $0.50 / $2.50 instead of $0.10 / $0.50.
  const price = C.priceOn(models['claude-haiku-5-5'], TODAY);
  const over = C.stepCost({ input: 120000, output: 1000, calls: 1, cached: 0 }, price, false);
  close(over.perRecord, 0.0625);          // (120,000 x 0.50 + 1,000 x 2.50) / 1,000,000
  assert.equal(over.long, true);
  // Exactly 100,000 is not over the threshold.
  const at = C.stepCost({ input: 100000, output: 1000, calls: 1, cached: 0 }, price, false);
  close(at.perRecord, 0.0105);            // (100,000 x 0.10 + 1,000 x 0.50) / 1,000,000
  assert.equal(at.long, false);
  // Cache reads use the long-context cache price: 120,000 x (0.5 x 0.50 + 0.5 x 0.05) + 1,000 x 2.50.
  const cached = C.stepCost({ input: 120000, output: 1000, calls: 1, cached: 0.5 }, price, false);
  close(cached.perRecord, 0.0355);
});

// ---- prices over time ----

test('a scheduled price change applies from its date, not before', () => {
  // gemini-4-argon: $2 / $10 through November 30, 2026; $4 / $20 from December 1.
  const before = C.priceOn(models['gemini-4-argon'], '2026-11-30');
  const after = C.priceOn(models['gemini-4-argon'], '2026-12-01');
  assert.deepEqual([before.input, before.cached, before.output, before.from], [2, 0.10, 10, null]);
  assert.deepEqual([after.input, after.cached, after.output, after.from], [4, 0.20, 20, '2026-12-01']);
  assert.equal(C.nextChange(models['gemini-4-argon'], '2026-11-30').from, '2026-12-01');
  assert.equal(C.nextChange(models['gemini-4-argon'], '2026-12-01'), null);
  assert.equal(C.nextChange(models['claude-sonnet-5'], TODAY), null);
});

test('later changes override earlier ones', () => {
  const m = { input: 1, cached: 0.1, output: 5, changes: [{ from: '2027-01-01', input: 2 }, { from: '2027-06-01', output: 9 }] };
  const p = C.priceOn(m, '2027-07-01');
  assert.deepEqual([p.input, p.cached, p.output, p.from], [2, 0.1, 9, '2027-06-01']);
});

test('days between two dates', () => {
  assert.equal(C.daysBetween('2026-10-15', '2027-01-13'), 90);
  assert.equal(C.daysBetween('2026-10-15', '2026-10-15'), 0);
  assert.equal(C.daysBetween('2026-03-01', '2026-03-31'), 30);   // across a daylight-saving change
});

test('tokenizers: same family, different family, unknown', () => {
  assert.equal(C.sameTokenizer(models['claude-sonnet-5'], models['claude-fable-5-1']), true);
  assert.equal(C.sameTokenizer(models['claude-sonnet-5'], models['claude-sonnet-4-6']), false);
  assert.equal(C.sameTokenizer(models['gpt-6-astra'], models['gpt-6-luna']), false);   // OpenAI doesn't say
  assert.equal(C.sameTokenizer(models['gpt-6-astra'], models['gpt-6-astra']), true);
});

// ---- the whole workflow ----

test('the worked example: $1,443 per 1,000 articles, the model 0.64% of it', () => {
  const w = C.workflow(example(), models, TODAY);
  close(w.review, 2.6755, 'one review');                    // 3 / 60 x $53.51
  close(w.per1000.model, 9.2113333333333333, 'model');
  close(w.per1000.people, 1434.068, 'people');              // 0.536 x 2.6755 x 1,000
  close(w.per1000.fixed, 0, 'fixed');
  close(w.per1000.total, 1443.2793333333333, 'total');
  close(w.share.model, 0.0063822249238886074, 'model share');
  close(w.perMonth.total, 14432.793333333333, 'per month');
  close(w.routing.out, 0.398, 'went out without review');   // 199 of 500
  assert.equal(C.money(w.per1000.total), '$1,443');
  assert.equal(C.percent(w.share.model, 2), '0.64%');
});

test('fixed monthly costs are spread over the month\'s records', () => {
  const w = C.workflow(example({ fixed: 50 }), models, TODAY);   // $50 over 10,000 records
  close(w.per1000.fixed, 5);
  close(w.per1000.total, 1448.2793333333333);
  const bigger = C.workflow(example({ fixed: 50, records: 100000 }), models, TODAY);
  close(bigger.per1000.fixed, 0.5);
});

test('compared with doing it by hand', () => {
  // 5 minutes per article by hand: 1,000 x 5 / 60 x $53.51 = $4,459.17.
  const w = C.workflow(example({ manualMinutes: 5 }), models, TODAY);
  close(w.manual.per1000, 4459.1666666666667);
  close(w.manual.saving, 0.67633429265557840);
  assert.equal(C.workflow(example(), models, TODAY).manual, null);
  assert.equal(C.workflow(example({ manualMinutes: 0 }), models, TODAY).manual.saving, null);
});

test('steps add up', () => {
  const triage = { model: 'claude-haiku-5-5', input: 1000, output: 20, calls: 1, cached: 0 };   // $0.00011 per record
  const two = example({ steps: [triage, { model: 'claude-sonnet-5', ...RUN49, calls: 0.6 }] });
  const w = C.workflow(two, models, TODAY);
  close(w.steps[0].perRecord, 0.00011);
  close(w.steps[1].perRecord, 0.6 * 0.0092113333333333333);
  close(w.perRecord.model, 0.00011 + 0.6 * 0.0092113333333333333);
});

test('nothing to pay: no share split, no division by zero', () => {
  const w = C.workflow(example({ toPerson: 0, steps: [{ ...example().steps[0], calls: 0 }] }), models, TODAY);
  assert.equal(w.per1000.total, 0);
  assert.equal(w.share, null);
});

// ---- would a better model pay for itself? ----

test('Claude Fable 5.1 pays for itself at 1.38 points fewer reviews', () => {
  const b = C.breakEven(example(), models, TODAY, { step: 0, model: 'claude-fable-5-1', input: RUN49.input, output: RUN49.output, toPerson: null });
  close(b.modelNext, 46.056666666666667, 'Fable 5.1 per 1,000');
  close(b.delta, 36.845333333333333, 'difference');
  close(b.point, 26.755, 'one point');                      // 1,000 x 0.01 x $2.6755
  close(b.points, 1.3771382296144023, 'break-even points');
  close(b.shareNeeded, 0.536 - 0.013771382296144023, 'share needed');
  assert.equal(b.verdict, 'pays-if-fewer');
  assert.equal(b.sameTokenizer, true);
  assert.equal(b.measured, undefined);
});

test('Claude Haiku 5.5 stays cheaper only up to 0.33 points more reviews', () => {
  const b = C.breakEven(example(), models, TODAY, { step: 0, model: 'claude-haiku-5-5', input: RUN49.input, output: RUN49.output, toPerson: null });
  close(b.delta, -8.7507666666666667);
  close(b.points, -0.32707032953342054);
  close(b.shareNeeded, 0.53927070329533421);
  assert.equal(b.verdict, 'cheaper-unless-more');
});

test('a model at the same price breaks even at zero', () => {
  const b = C.breakEven(example(), models, TODAY, { step: 0, model: 'claude-sonnet-5-5', input: RUN49.input, output: RUN49.output, toPerson: null });
  assert.equal(b.delta, 0);
  assert.equal(b.points, 0);
  assert.equal(b.verdict, 'same');
});

test('more output tokens for a model that thinks: triple them and the break-even is 2.9 points', () => {
  const b = C.breakEven(example(), models, TODAY, { step: 0, model: 'claude-fable-5-1', input: RUN49.input, output: 3 * RUN49.output, toPerson: null });
  // 2,567.75 x $10 + 1,222.75 x $50 = $86.815 per 1,000; minus $9.2113 = $77.6037; / $26.755.
  close(b.points, 2.9005294960443533);
});

test('switching tokenizer families is flagged', () => {
  const b = C.breakEven(example(), models, TODAY, { step: 0, model: 'claude-sonnet-4-6', input: RUN49.input, output: RUN49.output, toPerson: null });
  assert.equal(b.sameTokenizer, false);
});

test('never: the new model would need to send fewer than no records to a person', () => {
  // Fable 5.1 needs 1.38 points fewer sent to a person. At 1% sent to a person
  // there is only 1 point to cut.
  const b = C.breakEven(example({ toPerson: 0.01 }), models, TODAY, { step: 0, model: 'claude-fable-5-1', input: RUN49.input, output: RUN49.output, toPerson: null });
  assert.equal(b.verdict, 'never');
});

test('always: the cheaper model stays cheaper even if every record went to a person', () => {
  // Haiku saves $8.75 per 1,000, 0.33 points; at 99.9% sent to a person there is
  // only 0.1 point of room left, so it can never lose.
  const b = C.breakEven(example({ toPerson: 0.999, stopped: 0 }), models, TODAY, { step: 0, model: 'claude-haiku-5-5', input: RUN49.input, output: RUN49.output, toPerson: null });
  assert.equal(b.verdict, 'always');
});

test('free reviews: only the model price matters', () => {
  const up = C.breakEven(example({ minutes: 0 }), models, TODAY, { step: 0, model: 'claude-fable-5-1', input: RUN49.input, output: RUN49.output, toPerson: null });
  assert.equal(up.points, null);
  assert.equal(up.verdict, 'never');
  const down = C.breakEven(example({ minutes: 0 }), models, TODAY, { step: 0, model: 'claude-haiku-5-5', input: RUN49.input, output: RUN49.output, toPerson: null });
  assert.equal(down.verdict, 'always');
});

test('a measured share for the new model gives both totals', () => {
  // Fable 5.1 sending 45% to a person: 46.0567 + 450 x 2.6755 = 1,250.03 per 1,000.
  const b = C.breakEven(example(), models, TODAY, { step: 0, model: 'claude-fable-5-1', input: RUN49.input, output: RUN49.output, toPerson: 0.45 });
  close(b.measured.now, 1443.2793333333333);
  close(b.measured.next, 1250.0316666666667);
  close(b.measured.difference, 1250.0316666666667 - 1443.2793333333333);
});

// ---- when is a review worth it? ----

test('the review threshold is the review cost over the mistake it prevents (Chow, 1970)', () => {
  close(C.reviewThreshold(2.6755, 50, 1).chance, 0.05351);
  close(C.reviewThreshold(2.6755, 50, 0.9).chance, 0.059455555555555556);
  assert.equal(C.reviewThreshold(2.6755, 50, 1).never, false);
});

test('when a mistake costs less than a review, reviewing never pays', () => {
  assert.equal(C.reviewThreshold(2.6755, 2, 1).never, true);
  assert.equal(C.reviewThreshold(2.6755, 2.6755, 1).never, true);   // exactly equal: no gain
  assert.equal(C.reviewThreshold(2.6755, 0, 1).never, true);
  assert.equal(C.reviewThreshold(2.6755, 50, 0).never, true);       // reviewers who catch nothing
});

test('Wilson ranges match Newcombe (1998), Table I', () => {
  // [wrong, tested, published low, published high], printed to 4 places.
  for (const [k, n, low, high] of [[81, 263, 0.2553, 0.3662], [15, 148, 0.0624, 0.1605], [0, 20, 0, 0.1611], [1, 29, 0.0061, 0.1718]]) {
    const r = C.wilson(k, n);
    assert.ok(Math.abs(r.low - low) <= 0.00005, k + '/' + n + ' low ' + r.low);
    assert.ok(Math.abs(r.high - high) <= 0.00005, k + '/' + n + ' high ' + r.high);
  }
});

test('Wilson range for the example\'s 13 silent errors in 199 matches workflow-eval-harness', () => {
  // The harness reports 6.5% (likely 3.9-10.9%) for run 70.
  const r = C.wilson(13, 199);
  assert.equal(C.percent(r.rate), '6.5%');
  assert.equal(C.percent(r.low), '3.9%');
  assert.equal(C.percent(r.high), '10.9%');
});

test('Wilson rejects counts that are not counts', () => {
  assert.throws(() => C.wilson(1, 0), RangeError);
  assert.throws(() => C.wilson(5, 4), RangeError);
  assert.throws(() => C.wilson(-1, 4), RangeError);
  assert.throws(() => C.wilson(1.5, 4), RangeError);
});

test('mistakes reaching customers: 26 per 1,000, likely 15.4 to 43.2', () => {
  const m = C.mistakes({ out: 0.398, toPerson: 0.536, wrong: 13, tested: 199, precision: 0.44, catchRate: 1, review: 2.6755, mistakeCost: 50 });
  close(m.reaching.rate, 26);                               // 398 x 13 / 199
  close(m.reaching.low, 398 * C.wilson(13, 199).low);
  assert.equal(C.count(m.reaching.low), '15.4');
  assert.equal(C.count(m.reaching.high), '43.2');
  close(m.cost.rate, 1300);
  assert.equal(C.money(m.cost.low), '$768');
  assert.equal(C.money(m.cost.high), '$2,160');
  close(m.perCaught, 6.0806818181818182);                   // $2.6755 / 0.44
});

test('mistakes reviewers miss also reach customers', () => {
  // Reviewers catch 90%: 0.536 x 0.44 x 0.10 = 0.023584 more per article.
  const m = C.mistakes({ out: 0.398, toPerson: 0.536, wrong: 13, tested: 199, precision: 0.44, catchRate: 0.9, review: 2.6755, mistakeCost: null });
  close(m.reaching.rate, 26 + 23.584);
  close(m.perCaught, 2.6755 / (0.44 * 0.9));
  assert.equal(m.cost, null);
});

test('a queue that catches nothing has no cost per catch', () => {
  const m = C.mistakes({ out: 0.4, toPerson: 0.5, wrong: 0, tested: 50, precision: 0, catchRate: 1, review: 2, mistakeCost: null });
  assert.equal(m.perCaught, Infinity);
  assert.equal(m.reaching.rate, 0);
  assert.ok(m.reaching.high > 0, 'zero mistakes in 50 still allows some');
});

// ---- checking inputs ----

test('the example inputs are valid', () => {
  assert.deepEqual(C.validate(example(), models), []);
});

test('shares that add to exactly 100% are allowed despite floating point', () => {
  assert.deepEqual(C.validate(example({ toPerson: 0.7, stopped: 0.3 }), models), []);
  // Typed on the page as 0.71% and 99.29%, these add to 1.0000000000000002 in floating
  // point. (Found by audit/mutants.js: without this case, rejecting them went unnoticed.)
  assert.ok(0.71 / 100 + 99.29 / 100 > 1);
  assert.deepEqual(C.validate(example({ toPerson: 0.71 / 100, stopped: 99.29 / 100 }), models), []);
  // A real excess is still caught.
  assert.deepEqual(C.validate(example({ toPerson: 0.7101, stopped: 0.29 }), models).map(p => p.field), ['stopped']);
});

test('every bad input is reported, with the field it belongs to', () => {
  const bad = example({
    records: 0, toPerson: 0.8, stopped: 0.3, minutes: -1, hourly: NaN, fixed: 'ten', manualMinutes: -5,
    steps: [{ model: 'no-such-model', input: -1, output: Infinity, calls: -0.5, cached: 1.2 }],
  });
  const fields = C.validate(bad, models).map(p => p.field).sort();
  assert.deepEqual(fields, [
    'fixed', 'hourly', 'manualMinutes', 'minutes', 'records',
    'steps.0.cached', 'steps.0.calls', 'steps.0.input', 'steps.0.model', 'steps.0.output',
    'stopped',
  ]);
});

test('a workflow needs a model step', () => {
  assert.deepEqual(C.validate(example({ steps: [] }), models).map(p => p.field), ['steps']);
});

// ---- display ----

test('money is shown to the precision it deserves', () => {
  const cases = [
    [13.817, '$13.82'], [1443.2793, '$1,443'], [14432.79, '$14,433'], [173193.52, '$173,194'],
    [0.0092113, '$0.0092'], [0.00046057, '$0.00046'], [4.6e-7, '$0.00000046'],
    [99.49, '$99.49'], [99.5, '$100'], [0.01, '$0.01'], [0.00999, '$0.01'], [0.005, '$0.0050'], [0.004999, '$0.0050'],
    [0, '$0'], [-8.7508, '−$8.75'], [-1300, '−$1,300'],
    [50, '$50'], [13.8, '$13.80'], [2.999, '$3'],          // a round amount drops its ".00"
    [Infinity, 'unlimited'], [NaN, '—'],
  ];
  for (const [x, shown] of cases) assert.equal(C.money(x), shown, String(x));
});

test('percentages never round a real share to zero', () => {
  assert.equal(C.percent(0.0063822), '0.6%');
  assert.equal(C.percent(0.0063822, 2), '0.64%');
  assert.equal(C.percent(0.0003), 'under 0.1%');
  assert.equal(C.percent(0.0003, 2), '0.03%');
  assert.equal(C.percent(0), '0.0%');
  assert.equal(C.percent(-0.0033), '−0.3%');
  assert.equal(C.percent(1), '100.0%');
  assert.equal(C.percent(0.99993), 'over 99.9%');      // the people share when the model is a sliver
  assert.equal(C.percent(0.9994), '99.9%');
  assert.equal(C.percent(1.675), '167.5%');
  assert.equal(C.percent(NaN), '—');
});

test('counts', () => {
  // Whole numbers keep their zeros. (The first version stripped them: 10,000 showed as
  // "1". Found by looking at the page, so it has a test now.)
  assert.equal(C.count(10000, 0), '10,000');
  assert.equal(C.count(100), '100');
  assert.equal(C.count(2.5, 2), '2.5');
  assert.equal(C.count(26), '26');
  assert.equal(C.count(15.351), '15.4');
  assert.equal(C.count(1234.56), '1,234.6');
  assert.equal(C.count(-0.327, 2), '−0.33');
  assert.equal(C.count(2567.75, 0), '2,568');
  assert.equal(C.count(Infinity), '—');
});
