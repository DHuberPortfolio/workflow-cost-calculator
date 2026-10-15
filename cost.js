// The math behind the calculator. No dependencies; runs in the browser (as
// window.WorkflowCost) and in Node (require('./cost.js')), so the code the page uses
// is the code the tests check. METHOD.md explains every formula; the section numbers
// below point to it.
//
// Units: shares are fractions (0.536 means 53.6%), money is US dollars, prices are
// dollars per million tokens, dates are 'YYYY-MM-DD' strings. Nothing is rounded
// here: rounding happens once, for display, in the format functions at the end.

(function (root) {
  'use strict';

  const MILLION = 1e6;
  const BATCH_DISCOUNT = 0.5;   // Anthropic, OpenAI and Google all take 50% off batch work
  const Z = 1.96;               // 95%, the same value as error-rate-calculator and workflow-eval-harness
  const EPSILON = 1e-9;         // slack for shares typed as percentages that add to exactly 100

  // ---- prices (METHOD.md section 10) ----

  // The prices in effect on `date`: the standard ones, overridden in turn by each
  // scheduled change whose date has come. ISO dates compare correctly as strings.
  function priceOn(model, date) {
    const price = { input: model.input, cached: model.cached, output: model.output, long: model.long || null, from: null };
    for (const change of model.changes || []) {
      if (change.from > date) break;
      for (const key of ['input', 'cached', 'output', 'long']) if (key in change) price[key] = change[key];
      price.from = change.from;
    }
    return price;
  }

  // The first scheduled change after `date`, or null.
  function nextChange(model, date) {
    return (model.changes || []).find(c => c.from > date) || null;
  }

  // True when two models are known to count tokens the same way.
  function sameTokenizer(a, b) {
    return a.id === b.id || (a.tokenizer != null && a.tokenizer === b.tokenizer);
  }

  // Whole days from `from` to `to` (both 'YYYY-MM-DD').
  function daysBetween(from, to) {
    return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
  }

  // ---- model cost (section 2) ----

  // The model cost of one step, per record. step: { input, output, calls, cached }
  // with input and output in tokens per call, calls per record, and cached the share
  // of the input read from the cache.
  function stepCost(step, price, batch) {
    const long = price.long !== null && step.input > price.long.above;
    const rate = long ? price.long : price;
    const inputRate = (1 - step.cached) * rate.input + step.cached * rate.cached;
    const perCall = (step.input * inputRate + step.output * rate.output) / MILLION;
    return { perRecord: step.calls * perCall * (batch ? 1 - BATCH_DISCOUNT : 1), long };
  }

  // ---- the whole workflow (sections 3 and 4) ----

  // inputs: {
  //   records     records per month
  //   steps       [{ model, input, output, calls, cached }], model being an id in `models`
  //   batch       true when the work runs through a batch API
  //   toPerson    share sent to a person
  //   stopped     share blocked or suppressed as a duplicate
  //   minutes     minutes per review
  //   hourly      what an hour of a reviewer's time costs
  //   fixed       fixed costs per month
  //   manualMinutes  optional: minutes to do one record by hand, or null
  // }
  // models: { id: model } from prices.js, plus any the user added.
  function workflow(inputs, models, date) {
    const steps = inputs.steps.map(s => {
      const model = models[s.model];
      const price = priceOn(model, date);
      return { ...stepCost(s, price, inputs.batch), model: s.model, price };
    });
    const review = inputs.minutes / 60 * inputs.hourly;
    const perRecord = {
      model: steps.reduce((sum, s) => sum + s.perRecord, 0),
      people: inputs.toPerson * review,
      fixed: inputs.fixed / inputs.records,
    };
    perRecord.total = perRecord.model + perRecord.people + perRecord.fixed;

    const scale = k => ({ model: perRecord.model * k, people: perRecord.people * k, fixed: perRecord.fixed * k, total: perRecord.total * k });
    const per1000 = scale(1000);
    const t = perRecord.total;
    const share = t > 0 ? { model: perRecord.model / t, people: perRecord.people / t, fixed: perRecord.fixed / t } : null;

    let manual = null;
    if (inputs.manualMinutes != null) {
      const byHand = 1000 * inputs.manualMinutes / 60 * inputs.hourly;
      manual = { per1000: byHand, saving: byHand > 0 ? 1 - per1000.total / byHand : null };
    }

    return {
      steps, review, perRecord, per1000, share, manual,
      perMonth: scale(inputs.records),
      routing: { toPerson: inputs.toPerson, stopped: inputs.stopped, out: Math.max(0, 1 - inputs.toPerson - inputs.stopped) },
    };
  }

  // ---- would a better model pay for itself? (section 5) ----

  // change: { step, model, input, output, toPerson } - which step gets which model, its
  // token counts per call, and optionally its measured share sent to a person (null if
  // not measured). Calls per record and the cached share stay as they are.
  function breakEven(inputs, models, date, change) {
    const now = workflow(inputs, models, date);
    const step = inputs.steps[change.step];
    const newStep = { ...step, model: change.model, input: change.input, output: change.output };
    const nextInputs = { ...inputs, steps: inputs.steps.map((s, i) => (i === change.step ? newStep : s)) };
    const next = workflow(nextInputs, models, date);

    const delta = next.per1000.model - now.per1000.model;   // change in model cost per 1,000
    const point = 1000 * 0.01 * now.review;                  // one point of share sent to a person, per 1,000
    const out = {
      modelNow: now.per1000.model,
      modelNext: next.per1000.model,
      delta,
      point,
      points: null,      // break-even, in percentage points fewer sent to a person (negative: more)
      shareNeeded: null, // the share sent to a person at break-even
      verdict: null,
      sameTokenizer: sameTokenizer(models[step.model], models[change.model]),
      long: next.steps[change.step].long,
    };

    if (point === 0) {
      // Reviews cost nothing, so only the model price matters.
      out.verdict = delta > 0 ? 'never' : delta < 0 ? 'always' : 'same';
    } else if (delta === 0) {
      out.points = 0;
      out.shareNeeded = inputs.toPerson;
      out.verdict = 'same';
    } else {
      out.points = delta / point;
      out.shareNeeded = inputs.toPerson - out.points / 100;
      const maxShare = 1 - inputs.stopped;
      if (out.shareNeeded < 0) out.verdict = 'never';                 // would need fewer than none
      else if (out.shareNeeded > maxShare + EPSILON) out.verdict = 'always'; // cheaper even if everything went to a person
      else out.verdict = delta > 0 ? 'pays-if-fewer' : 'cheaper-unless-more';
    }

    if (change.toPerson != null) {
      const measured = workflow({ ...nextInputs, toPerson: change.toPerson }, models, date);
      out.measured = { now: now.per1000.total, next: measured.per1000.total, difference: measured.per1000.total - now.per1000.total };
    }
    return out;
  }

  // ---- when is a review worth it? (section 6) ----

  // Send a record to a person when its chance of being wrong is above the returned
  // `chance`. review: the cost of one review; mistakeCost: the cost of one mistake that
  // reaches a customer; catchRate: the share of mistakes reviewers catch.
  function reviewThreshold(review, mistakeCost, catchRate) {
    const saved = catchRate * mistakeCost;        // what catching a sure mistake is worth
    if (saved <= 0) return { chance: Infinity, never: true };
    const chance = review / saved;
    return { chance, never: chance >= 1 };
  }

  // The 95% Wilson score interval for `wrong` mistakes in `tested` records.
  function wilson(wrong, tested) {
    if (!Number.isInteger(tested) || tested < 1) throw new RangeError('tested must be a whole number of at least 1');
    if (!Number.isInteger(wrong) || wrong < 0 || wrong > tested) throw new RangeError('wrong must be a whole number from 0 to tested');
    const p = wrong / tested;
    const z2 = Z * Z;
    const denom = 1 + z2 / tested;
    const center = (p + z2 / (2 * tested)) / denom;
    const half = Z * Math.sqrt(p * (1 - p) / tested + z2 / (4 * tested * tested)) / denom;
    return { rate: p, low: Math.max(0, center - half), high: Math.min(1, center + half) };
  }

  // What the review queue buys, and what still gets through.
  // m: { out, toPerson, wrong, tested, precision, catchRate, review, mistakeCost }
  //   out        share that went out without review
  //   wrong, tested  silent errors: mistakes among records that went out without review, in a test
  //   precision  review precision: share of records sent to a person that needed one
  //   mistakeCost  cost of one mistake that reaches a customer, or null if not given
  function mistakes(m) {
    const range = wilson(m.wrong, m.tested);
    const missed = m.toPerson * m.precision * (1 - m.catchRate);   // mistakes reviewers were shown and missed
    const reaching = s => 1000 * (m.out * s + missed);
    const caught = m.precision * m.catchRate;
    const out = {
      silent: range,
      reaching: { rate: reaching(range.rate), low: reaching(range.low), high: reaching(range.high) },
      perCaught: caught > 0 ? m.review / caught : Infinity,
      cost: null,
    };
    if (m.mistakeCost != null) {
      out.cost = { rate: out.reaching.rate * m.mistakeCost, low: out.reaching.low * m.mistakeCost, high: out.reaching.high * m.mistakeCost };
    }
    return out;
  }

  // ---- checking inputs ----

  // Problems with the inputs, as [{ field, message }]; empty when the inputs are usable.
  // Messages talk in the page's terms (percentages), because the page shows them.
  function validate(inputs, models) {
    const problems = [];
    const bad = (field, message) => problems.push({ field, message });
    const num = x => typeof x === 'number' && Number.isFinite(x);
    const atLeast0 = (field, x, what) => { if (!num(x) || x < 0) bad(field, what + ' must be a number, 0 or more.'); };
    const share = (field, x, what) => { if (!num(x) || x < 0 || x > 1) bad(field, what + ' must be from 0% to 100%.'); };

    if (!num(inputs.records) || inputs.records <= 0) bad('records', 'Records per month must be more than 0.');
    if (!Array.isArray(inputs.steps) || inputs.steps.length === 0) bad('steps', 'Add at least one model step.');
    else inputs.steps.forEach((s, i) => {
      const where = 'steps.' + i + '.';
      if (!models[s.model]) bad(where + 'model', 'Choose a model.');
      atLeast0(where + 'input', s.input, 'Input tokens');
      atLeast0(where + 'output', s.output, 'Output tokens');
      atLeast0(where + 'calls', s.calls, 'Calls per record');
      share(where + 'cached', s.cached, 'Cached input');
    });
    share('toPerson', inputs.toPerson, 'Sent to a person');
    share('stopped', inputs.stopped, 'Blocked or suppressed');
    if (num(inputs.toPerson) && num(inputs.stopped) && inputs.toPerson + inputs.stopped > 1 + EPSILON) {
      bad('stopped', 'Sent to a person and blocked or suppressed add up to more than 100%.');
    }
    atLeast0('minutes', inputs.minutes, 'Minutes per review');
    atLeast0('hourly', inputs.hourly, 'Hourly cost');
    atLeast0('fixed', inputs.fixed, 'Fixed costs');
    if (inputs.manualMinutes != null) atLeast0('manualMinutes', inputs.manualMinutes, 'Minutes by hand');
    return problems;
  }

  // ---- display ----

  // Thousands separators without relying on the browser's locale.
  function group(digits) {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // Money to the precision it deserves: whole dollars from $100 (cents on $1,443
  // would claim a precision the inputs don't have), cents from 1 cent, and two
  // significant figures below that so a per-record cost never shows as $0.00.
  function money(x) {
    if (!Number.isFinite(x)) return x > 0 ? 'unlimited' : '—';
    const sign = x < 0 ? '−' : '';
    const a = Math.abs(x);
    if (a === 0) return '$0';
    const cents = () => sign + '$' + group((Math.round(a * 100) / 100).toFixed(2).replace(/\.00$/, ''));
    if (Math.round(a) >= 100) return sign + '$' + group(String(Math.round(a)));
    if (a >= 0.01) return cents();
    const small = a.toFixed(Math.min(1 - Math.floor(Math.log10(a)), 20));   // two significant figures
    return Number(small) >= 0.01 ? cents() : sign + '$' + small;           // 0.00999 rounds up to a cent
  }

  // A share as a percentage with `digits` decimals. A share above zero but too small to
  // show says so instead of rounding to 0%, and one just short of all of it says so
  // instead of rounding to 100%.
  function percent(x, digits = 1) {
    if (!Number.isFinite(x)) return '—';
    const p = x * 100;
    const step = Math.pow(10, -digits);
    if (p > 0 && p < step / 2) return 'under ' + step.toFixed(digits) + '%';
    if (p < 100 && p >= 100 - step / 2) return 'over ' + (100 - step).toFixed(digits) + '%';
    const s = p.toFixed(digits);
    return (s.startsWith('-') ? '−' + s.slice(1) : s) + '%';
  }

  // A count with separators and up to `digits` decimals.
  function count(x, digits = 1) {
    if (!Number.isFinite(x)) return '—';
    const fixed = Math.abs(x).toFixed(digits).replace(/\.(\d*?)0+$/, (_, d) => (d ? '.' + d : ''));
    const [whole, frac] = fixed.split('.');
    return (x < 0 ? '−' : '') + group(whole) + (frac ? '.' + frac : '');
  }

  const api = {
    BATCH_DISCOUNT, Z,
    priceOn, nextChange, sameTokenizer, daysBetween,
    stepCost, workflow, breakEven, reviewThreshold, wilson, mistakes, validate,
    money, percent, count,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkflowCost = api;
})(typeof self !== 'undefined' ? self : this);
