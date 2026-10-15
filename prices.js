// The default price table. Every price is in US dollars per million tokens, at the
// provider's standard (non-batch) rate, copied from the provider's own pricing page
// on the date in `checked`. Nothing here was filled in from memory.
//
// Runs in the browser (as window.ModelPrices) and in Node (require('./prices.js')).
//
// Fields:
//   input, cached, output  standard prices. `cached` is the cache-read price.
//   long                   a higher price for every token of a request whose prompt is
//                          over `above` tokens (cache reads included), when the provider
//                          has one.
//   changes                published future prices: from that date on, the listed
//                          fields replace the ones above. Kept in date order.
//   tokenizer              models with the same value count tokens the same way. null
//                          means the provider doesn't say, so the page treats it as
//                          different from every other model.
//
// To update: change the numbers, the `checked` date and, if a page moved, the source.
// `npm test` checks the table is well formed.

(function (root) {
  'use strict';

  const ANTHROPIC = 'https://platform.claude.com/docs/en/about-claude/pricing';
  const OPENAI = 'https://developers.openai.com/api/docs/pricing';
  const GOOGLE = 'https://ai.google.dev/gemini-api/docs/pricing';
  const CHECKED = '2026-10-15';

  // Anthropic: Claude 4.7 and later use a newer tokenizer that "produces approximately
  // 30% more tokens for the same text" than Sonnet 4.6 and earlier (pricing page).
  const CLAUDE_NEW = 'claude-4.7+';
  const CLAUDE_OLD = 'claude-4.6-';

  const MODELS = [
    { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', provider: 'Anthropic',
      input: 10, cached: 0.25, output: 50, tokenizer: CLAUDE_NEW,
      note: 'Always thinks before answering; thinking is billed as output.' },
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', provider: 'Anthropic',
      input: 4, cached: 0.20, output: 20, tokenizer: CLAUDE_NEW },
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', provider: 'Anthropic',
      input: 2, cached: 0.10, output: 10, tokenizer: CLAUDE_NEW },
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'Anthropic',
      input: 2, cached: 0.20, output: 10, tokenizer: CLAUDE_NEW },
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', provider: 'Anthropic',
      input: 0.10, cached: 0.01, output: 0.50, tokenizer: CLAUDE_NEW,
      long: { above: 100000, input: 0.50, cached: 0.05, output: 2.50 } },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'Anthropic',
      input: 3, cached: 0.30, output: 15, tokenizer: CLAUDE_OLD,
      note: 'Legacy: retiring no sooner than February 17, 2027.' },

    // OpenAI's page splits prices at 272K input tokens ("Long context: >272K input
    // tokens"). Read here as 272,000.
    { id: 'gpt-6-astra', name: 'gpt-6-astra', provider: 'OpenAI',
      input: 10, cached: 1, output: 50, tokenizer: null,
      long: { above: 272000, input: 20, cached: 2, output: 75 } },
    { id: 'gpt-6.1-sol', name: 'gpt-6.1-sol', provider: 'OpenAI',
      input: 2, cached: 0.10, output: 10, tokenizer: null,
      long: { above: 272000, input: 4, cached: 0.20, output: 15 } },
    { id: 'gpt-6-luna', name: 'gpt-6-luna', provider: 'OpenAI',
      input: 0.10, cached: 0.01, output: 0.50, tokenizer: null,
      long: { above: 272000, input: 0.20, cached: 0.02, output: 0.75 } },

    // Google's output prices include thinking tokens (pricing page).
    { id: 'gemini-4-argon', name: 'gemini-4-argon', provider: 'Google',
      input: 2, cached: 0.10, output: 10, tokenizer: null,
      changes: [{ from: '2026-12-01', input: 4, cached: 0.20, output: 20 }],
      note: 'Implicit caching only.' },
    { id: 'gemini-3.8-flash', name: 'gemini-3.8-flash', provider: 'Google',
      input: 0.75, cached: 0.075, output: 3.75, tokenizer: null,
      changes: [{ from: '2027-01-01', input: 1.50, cached: 0.15, output: 7.50 }] },
    { id: 'gemini-3.5-flash-lite', name: 'gemini-3.5-flash-lite', provider: 'Google',
      input: 0.30, cached: 0.03, output: 2.50, tokenizer: null },
    { id: 'gemini-3.1-flash-lite', name: 'gemini-3.1-flash-lite', provider: 'Google',
      input: 0.25, cached: 0.025, output: 1.50, tokenizer: null },
  ];

  const SOURCE = { Anthropic: ANTHROPIC, OpenAI: OPENAI, Google: GOOGLE };
  for (const m of MODELS) {
    m.source = SOURCE[m.provider];
    m.checked = CHECKED;
  }

  const api = { MODELS, CHECKED, SOURCES: SOURCE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ModelPrices = api;
})(typeof self !== 'undefined' ? self : this);
