// Runs the shipped cost.js over cases read from stdin (JSON) and writes the answers
// to stdout (JSON), so reference_check.py can compare them with its own.
//
// Each case: { inputs, change?, threshold?, mistakes?, models?, date }.

const path = require('node:path');
const C = require(process.env.COST_JS ? path.resolve(process.env.COST_JS) : '../cost.js');
const { MODELS } = require('../prices.js');

let text = '';
process.stdin.on('data', d => { text += d; });
process.stdin.on('end', () => {
  const cases = JSON.parse(text);
  const out = cases.map(c => {
    const models = Object.fromEntries((c.models || MODELS).map(m => [m.id, m]));
    const w = C.workflow(c.inputs, models, c.date);
    const r = { per1000: w.per1000, perMonth: w.perMonth, review: w.review, out: w.routing.out };
    if (c.change) {
      const b = C.breakEven(c.inputs, models, c.date, c.change);
      r.breakEven = { delta: b.delta, point: b.point, points: b.points, shareNeeded: b.shareNeeded };
    }
    if (c.threshold) r.threshold = C.reviewThreshold(w.review, c.threshold.mistakeCost, c.threshold.catchRate).chance;
    if (c.mistakes) {
      const m = C.mistakes({ ...c.mistakes, out: w.routing.out, toPerson: c.inputs.toPerson, review: w.review });
      r.mistakes = { rate: m.reaching.rate, low: m.reaching.low, high: m.reaching.high, perCaught: m.perCaught };
    }
    return r;
  });
  process.stdout.write(JSON.stringify(out));
});
