// Checks on index.html that need no browser. The page's logic is tested through
// cost.js and state.js; these catch the mistakes that only live in the page itself.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// \r?\n: a Windows checkout ends lines with \r\n. (The first version expected \n only
// and failed on every Windows runner in CI.)
const inline = html.match(/<script>\r?\n([\s\S]*?)<\/script>/)[1];

test('the page\'s own script parses', () => {
  // An unescaped quote in a string, say, would leave the page blank.
  assert.doesNotThrow(() => new Function(inline));
});

test('every script the page loads exists', () => {
  const sources = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(sources, ['prices.js', 'cost.js', 'state.js']);
  for (const s of sources) assert.ok(fs.existsSync(path.join(ROOT, s)), s);
});

test('text never goes into the page as HTML', () => {
  // Model names and numbers can come from a shared link, so the page builds every
  // element with text nodes. These would turn that text into markup.
  for (const risky of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(']) {
    assert.ok(!inline.includes(risky), risky + ' is used');
  }
});

test('every field the page reads has a place in the link', () => {
  const S = require('../state.js');
  const markup = html.slice(0, html.indexOf('<script'));
  const keys = [...markup.matchAll(/data-key="([^"]+)"/g)].map(m => m[1]);
  assert.ok(keys.length >= 15, 'found the fields');
  const state = S.fromPreset(S.DEFAULT_PRESET);
  for (const k of keys) assert.ok(k in state, k + ' is not in the state');
  // A changed value in each one survives a round trip through the link.
  for (const k of keys) {
    const changed = { ...state, [k]: k === 'altModel' ? 'claude-opus-5-5' : k === 'altStep' ? '0' : '12.5' };
    const back = S.decode(S.encode(changed), S.PRESETS[S.DEFAULT_PRESET].state, require('../prices.js').MODELS.map(m => m.id));
    assert.equal(back[k], changed[k], k);
  }
});
