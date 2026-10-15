// Do the tests catch real mistakes?
//
// A test suite that passes proves little on its own: tests that check nothing also
// pass. This script makes deliberately broken copies of cost.js ("mutants"), each with
// one plausible mistake of the kind a person might really make, and runs the whole
// suite against each. A mutant that passes every test is a mistake the tests would
// let through.
//
// With --reference, it also runs audit/reference_check.py (the exact-decimal check)
// against each mutant.
//
// Run from the repo root:  node audit/mutants.js [--reference]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'cost.js'), 'utf8');
const withReference = process.argv.includes('--reference');

// [the mistake, the text in cost.js, what it becomes]
const MUTANTS = [
  ['Cached input billed at the full input price', 'step.cached * rate.cached', 'step.cached * rate.input'],
  ['Batch discount forgotten', '(batch ? 1 - BATCH_DISCOUNT : 1)', '1'],
  ['Long-context price from the threshold itself, not above it', 'step.input > price.long.above', 'step.input >= price.long.above'],
  ['Minutes treated as hours', 'inputs.minutes / 60 * inputs.hourly', 'inputs.minutes * inputs.hourly'],
  ['Fixed costs spread over 1,000 records, not the month\'s', 'inputs.fixed / inputs.records', 'inputs.fixed / 1000'],
  ['Break-even share moves the wrong way', 'inputs.toPerson - out.points / 100', 'inputs.toPerson + out.points / 100'],
  ['A point of review share taken as a whole share', '1000 * 0.01 * now.review', '1000 * now.review'],
  ['Review threshold ignores reviewers who miss mistakes', 'catchRate * mistakeCost', 'mistakeCost'],
  ['90% confidence instead of 95% in the Wilson range', 'const Z = 1.96;', 'const Z = 1.645;'],
  ['Mistakes reviewers miss left out', 'm.toPerson * m.precision * (1 - m.catchRate)', '0'],
  ['A price change applied a day early', 'if (change.from > date) break;', 'if (change.from >= date) break;'],
  ['Blocked records counted as going out', '1 - inputs.toPerson - inputs.stopped', '1 - inputs.toPerson'],
  ['Shares adding to exactly 100% rejected', 'inputs.toPerson + inputs.stopped > 1 + EPSILON', 'inputs.toPerson + inputs.stopped > 1'],
  ['Money rounded to cents above $100', 'if (Math.round(a) >= 100)', 'if (Math.round(a) >= 1e12)'],
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-mutants-'));
const rows = [];
let survivors = 0;

for (const [name, from, to] of MUTANTS) {
  const at = SOURCE.indexOf(from);
  if (at < 0 || SOURCE.indexOf(from, at + 1) >= 0) {
    throw new Error('"' + from + '" must appear exactly once in cost.js (mutant: ' + name + ')');
  }
  const file = path.join(dir, 'cost.' + rows.length + '.js');
  fs.writeFileSync(file, SOURCE.slice(0, at) + to + SOURCE.slice(at + from.length));
  const env = { ...process.env, COST_JS: file };

  const t = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], { cwd: ROOT, env, encoding: 'utf8' });
  const failed = Number((t.stdout.match(/^# fail (\d+)/m) || [])[1]);
  const total = Number((t.stdout.match(/^# tests (\d+)/m) || [])[1]);
  const row = { name, failed, total };

  if (withReference) {
    const r = spawnSync('py', ['-3.11', '-I', 'audit/reference_check.py'], { cwd: ROOT, env, encoding: 'utf8' });
    row.reference = r.status === 0 ? 'passed' : 'failed';
  }
  if (!(failed > 0)) survivors++;
  rows.push(row);
}
fs.rmSync(dir, { recursive: true, force: true });

console.log('| Deliberate mistake | Tests failed' + (withReference ? ' | Reference check' : '') + ' |');
console.log('|---|---' + (withReference ? '|---' : '') + '|');
for (const r of rows) {
  console.log('| ' + r.name + ' | ' + r.failed + ' of ' + r.total + (withReference ? ' | ' + r.reference : '') + ' |');
}
console.log('\n' + (survivors === 0
  ? 'Every mutant was caught.'
  : survivors + ' mutant(s) passed every test: those mistakes would go unnoticed.'));
process.exit(survivors === 0 ? 0 : 1);
