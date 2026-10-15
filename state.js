// What the page's fields hold, and how it becomes numbers cost.js can use.
//
// The page keeps every field as the text typed into it (so a half-typed "53." isn't
// rewritten under the cursor), and this module turns that text into the inputs of
// cost.js. It also holds the presets and reads and writes the "copy a link" URL.
// Runs in the browser (as window.CostState) and in Node, so the tests can check that
// the page's example gives the figures METHOD.md works out by hand.

(function (root) {
  'use strict';

  const MAX_STEPS = 8;
  const MAX_ADDED = 12;
  const MAX_TEXT = 24;     // longest number a field keeps from a link
  const MAX_NAME = 60;     // longest model name

  // ---- presets ----

  const PRESETS = {
    news: {
      label: 'News tagging (measured)',
      note: 'A real workflow: the metadata enrichment agent. Measured: tokens per article (n8n execution 49), routing, silent errors and review precision (Golden 500, run 70). Assumed: 3 minutes per review, 5 minutes to tag one by hand, $50 per mistake, 10,000 articles a month. The hourly cost is an editor\'s median wage, $37.46 (BLS, May 2025), divided by 0.70.',
      state: {
        records: '10000',
        steps: [{ model: 'claude-sonnet-5', input: '2567.75', output: '407.58', calls: '1', cached: '0' }],
        batch: false,
        toPerson: '53.6', stopped: '6.6', minutes: '3', hourly: '53.51', fixed: '0', manual: '5',
        altStep: '0', altModel: 'claude-fable-5-1', altInput: '', altOutput: '', altToPerson: '',
        mistakeCost: '50', catchRate: '100', tested: '199', wrong: '13', precision: '44',
      },
    },
    support: {
      label: 'Support triage',
      note: 'Illustrative numbers, not measured: a high-volume ticket classifier on a small model with a cached system prompt, sending 4% of tickets to an agent.',
      state: {
        records: '200000',
        steps: [{ model: 'claude-haiku-5-5', input: '900', output: '60', calls: '1', cached: '60' }],
        batch: false,
        toPerson: '4', stopped: '0', minutes: '2', hourly: '35', fixed: '0', manual: '3',
        altStep: '0', altModel: 'claude-sonnet-5-5', altInput: '', altOutput: '', altToPerson: '',
        mistakeCost: '15', catchRate: '95', tested: '400', wrong: '9', precision: '30',
      },
    },
    agent: {
      label: 'Research agent',
      note: 'Illustrative numbers, not measured: an agent that loops 8 model calls per report on the most capable model, with 10% of reports checked by an analyst and a $500 monthly platform fee.',
      state: {
        records: '2000',
        steps: [{ model: 'claude-fable-5-1', input: '15000', output: '1200', calls: '8', cached: '70' }],
        batch: false,
        toPerson: '10', stopped: '0', minutes: '12', hourly: '75', fixed: '500', manual: '',
        altStep: '0', altModel: 'claude-opus-5-5', altInput: '', altOutput: '', altToPerson: '',
        mistakeCost: '400', catchRate: '90', tested: '60', wrong: '4', precision: '50',
      },
    },
  };
  const DEFAULT_PRESET = 'news';

  function clone(state) {
    return JSON.parse(JSON.stringify(state));
  }

  // A fresh state: a preset's fields, and no edited prices.
  function fromPreset(name) {
    return { ...clone(PRESETS[name].state), prices: { edited: {}, added: [] } };
  }

  // ---- the price table, with the user's edits ----

  // models: the published table (prices.js). Returns { id: model } with edited prices
  // applied and added models included. An edited model keeps only the edited prices:
  // its long-context tier and scheduled changes are dropped, because those were
  // published for the published price.
  function effectiveModels(models, prices) {
    const out = {};
    for (const m of models) {
      const e = prices && prices.edited[m.id];
      out[m.id] = e ? { ...m, ...numbers(e), long: null, changes: [], edited: true } : m;
    }
    for (const a of (prices && prices.added) || []) {
      out[a.id] = { id: a.id, name: a.name, provider: 'Added', tokenizer: null, long: null, changes: [], added: true, ...numbers(a) };
    }
    return out;
  }

  function numbers(p) {
    return { input: parseNumber(p.input), cached: parseNumber(p.cached), output: parseNumber(p.output) };
  }

  // ---- text to numbers ----

  // The number typed in a field: commas, spaces, $ and % allowed; '' means not given
  // (null); anything else that isn't a number is NaN, which validation reports.
  function parseNumber(text) {
    if (typeof text === 'number') return text;
    if (text == null) return null;
    const t = String(text).replace(/[\s,$%]/g, '');
    if (t === '') return null;
    return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : NaN;
  }

  // The state as cost.js inputs, plus the extra questions' inputs and every problem
  // found. Percentages become fractions here and nowhere else.
  //   models: effectiveModels(...)
  //   validate: cost.js's validate
  function toInputs(state, models, validate) {
    const n = parseNumber;
    const pct = t => { const x = n(t); return x == null ? null : x / 100; };
    const inputs = {
      records: n(state.records),
      steps: state.steps.map(s => ({ model: s.model, input: n(s.input), output: n(s.output), calls: n(s.calls), cached: pct(s.cached) })),
      batch: !!state.batch,
      toPerson: pct(state.toPerson),
      stopped: pct(state.stopped) ?? 0,
      minutes: n(state.minutes),
      hourly: n(state.hourly),
      fixed: n(state.fixed) ?? 0,
      manualMinutes: n(state.manual),
    };
    const problems = validate(inputs, models);
    const bad = (field, message) => problems.push({ field, message });
    const num = x => typeof x === 'number' && Number.isFinite(x);

    // Would a better model pay for itself?
    const step = Number(state.altStep);
    let change = null;
    if (Number.isInteger(step) && step >= 0 && step < inputs.steps.length && models[state.altModel]) {
      const now = inputs.steps[step];
      change = {
        step,
        model: state.altModel,
        input: n(state.altInput) ?? now.input,
        output: n(state.altOutput) ?? now.output,
        toPerson: pct(state.altToPerson),
      };
      if (!num(change.input) || change.input < 0) bad('altInput', 'The new model\'s input tokens must be a number, 0 or more.');
      if (!num(change.output) || change.output < 0) bad('altOutput', 'The new model\'s output tokens must be a number, 0 or more.');
      if (change.toPerson != null && (!num(change.toPerson) || change.toPerson < 0 || change.toPerson + inputs.stopped > 1 + 1e-9)) {
        bad('altToPerson', 'The new model\'s share sent to a person must be from 0% to ' + Math.round((1 - inputs.stopped) * 1000) / 10 + '%.');
      }
    } else {
      bad('altModel', 'Choose a model to compare.');
    }

    // When is a review worth it?
    const review = { mistakeCost: n(state.mistakeCost), catchRate: pct(state.catchRate) };
    if (review.mistakeCost != null && (!num(review.mistakeCost) || review.mistakeCost < 0)) bad('mistakeCost', 'The cost of a mistake must be a number, 0 or more.');
    if (review.catchRate == null || !num(review.catchRate) || review.catchRate < 0 || review.catchRate > 1) bad('catchRate', 'Reviewers catch must be from 0% to 100%.');

    let test = null;
    const tested = n(state.tested), wrong = n(state.wrong), precision = pct(state.precision);
    if (tested != null || wrong != null) {
      if (!Number.isInteger(tested) || tested < 1) bad('tested', 'Records tested must be a whole number, 1 or more.');
      else if (!Number.isInteger(wrong) || wrong < 0 || wrong > tested) bad('wrong', 'Wrong must be a whole number from 0 to ' + tested + '.');
      else test = { tested, wrong };
    }
    if (precision != null && (!num(precision) || precision < 0 || precision > 1)) bad('precision', 'Review precision must be from 0% to 100%.');

    // Prices typed into the price table.
    const used = new Set(inputs.steps.map(s => s.model).concat(change ? [change.model] : []));
    for (const id of used) {
      const m = models[id];
      if (m && !['input', 'cached', 'output'].every(k => num(m[k]) && m[k] >= 0)) bad('prices', m.name + ': every price must be a number, 0 or more.');
    }

    return { inputs, change, review, test, precision, problems };
  }

  // ---- the link ----
  // A hash like #n=10000&s=claude-sonnet-5,2567.75,407.58,1,0&h=53.6...
  // Every part is URI-encoded, so ',' ';' '&' '=' inside a value never split it.

  const FIELDS = {
    n: 'records', h: 'toPerson', x: 'stopped', t: 'minutes', w: 'hourly', f: 'fixed', m: 'manual',
    as: 'altStep', am: 'altModel', ai: 'altInput', ao: 'altOutput', ah: 'altToPerson',
    e: 'mistakeCost', k: 'catchRate', st: 'tested', sw: 'wrong', q: 'precision',
  };
  const STEP_FIELDS = ['model', 'input', 'output', 'calls', 'cached'];
  const enc = encodeURIComponent;

  function encode(state) {
    const parts = [];
    for (const [key, field] of Object.entries(FIELDS)) parts.push(key + '=' + enc(state[field] ?? ''));
    parts.push('s=' + state.steps.map(s => STEP_FIELDS.map(f => enc(s[f] ?? '')).join(',')).join(';'));
    if (state.batch) parts.push('b=1');
    const edited = Object.entries(state.prices.edited).map(([id, p]) => [id, p.input, p.cached, p.output].map(v => enc(v ?? '')).join(','));
    if (edited.length) parts.push('pe=' + edited.join(';'));
    const added = state.prices.added.map(a => [a.id, a.name, a.input, a.cached, a.output].map(v => enc(v ?? '')).join(','));
    if (added.length) parts.push('pa=' + added.join(';'));
    return '#' + parts.join('&');
  }

  // Reads a hash written by encode() over a preset's state. Links are untrusted:
  // anything unknown is ignored, text is shortened, model ids must match the table or
  // an added model, and nothing here is ever put into the page as HTML.
  function decode(hash, base, publishedIds) {
    const state = { ...clone(base), prices: { edited: {}, added: [] } };
    const text = h => { try { return decodeURIComponent(h); } catch (e) { return ''; } };
    const short = (s, max) => String(s).slice(0, max || MAX_TEXT);
    const params = {};
    for (const part of String(hash || '').replace(/^#/, '').split('&')) {
      const at = part.indexOf('=');
      if (at > 0) params[part.slice(0, at)] = part.slice(at + 1);
    }

    const known = new Set(publishedIds);
    if (params.pa) {
      for (const row of params.pa.split(';').slice(0, MAX_ADDED)) {
        const [id, name, input, cached, output] = row.split(',').map(text);
        if (/^added-\d{1,3}$/.test(id) && !known.has(id)) {
          state.prices.added.push({ id, name: short(name, MAX_NAME) || 'Added model', input: short(input), cached: short(cached), output: short(output) });
          known.add(id);
        }
      }
    }
    if (params.pe) {
      for (const row of params.pe.split(';').slice(0, publishedIds.length)) {
        const [id, input, cached, output] = row.split(',').map(text);
        if (publishedIds.includes(id)) state.prices.edited[id] = { input: short(input), cached: short(cached), output: short(output) };
      }
    }
    for (const [key, field] of Object.entries(FIELDS)) {
      if (key in params) state[field] = short(text(params[key]));
    }
    if (!known.has(state.altModel)) state.altModel = base.altModel;
    if (params.s) {
      const steps = params.s.split(';').slice(0, MAX_STEPS).map(row => {
        const v = row.split(',').map(text);
        const step = {};
        STEP_FIELDS.forEach((f, i) => { step[f] = short(v[i] ?? ''); });
        return step;
      }).filter(s => known.has(s.model));
      if (steps.length) state.steps = steps;
    }
    state.batch = params.b === '1';
    return state;
  }

  const api = { PRESETS, DEFAULT_PRESET, MAX_STEPS, MAX_ADDED, fromPreset, effectiveModels, parseNumber, toInputs, encode, decode };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CostState = api;
})(typeof self !== 'undefined' ? self : this);
