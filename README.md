# What does your AI workflow really cost?

A free calculator for the full cost of an AI workflow: the model, the people who check its work, and the mistakes that get out unchecked. It answers three questions. The answers below are for a real workflow that tags news articles:

1. **What do 1,000 records cost?** **$1,443** per 1,000 articles. The model is **0.64%** of that. The other 99.4% is editors checking the 53.6% of articles the workflow isn't sure about.
2. **Would a better model pay for itself?** Claude Fable 5.1 costs $36.85 more per 1,000 than Claude Sonnet 5. It pays for itself if it sends **1.38 points fewer** articles to an editor. A cheaper model fails the same way in reverse: Claude Haiku 5.5's saving is gone if it sends 0.33 points more.
3. **When is a review worth it?** A review costs $2.68. If a mistake that reaches a customer costs $50, send any article with **more than a 5.4% chance** of being wrong to an editor. The mistakes that get through anyway cost about as much as the editors do.

**Try it: https://dhuberportfolio.github.io/workflow-cost-calculator/**. It runs entirely in your browser, and nothing you type is sent anywhere.

## Why it exists

Most AI cost calculators multiply tokens by a price and stop there. A workflow that routes uncertain records to people has two more costs: the people, and the mistakes in the records that went out without them. People are usually most of the bill, because a review costs dollars and a model call costs fractions of a cent.

Leaving those two out pushes decisions the wrong way. A cheaper model looks like a saving even when it sends more records to people. Cutting reviews looks free even when it lets more mistakes out. This calculator puts all three costs on one page, and shows the trade between them.

It builds on two of my other tools. [workflow-eval-harness](https://github.com/DHuberPortfolio/workflow-eval-harness) grades an AI workflow against an answer key and measures three of this calculator's inputs: the silent error rate, the share sent to a person, and review precision. The [error-rate calculator](https://dhuberportfolio.github.io/error-rate-calculator/) gives a measured rate its likely range. All three tools use the same 95% Wilson interval.

## Why the prices are a table, not a number in the code

The workflow in the example estimates its own model cost: **$13.82 per 1,000 articles**. The calculator reproduces that estimate to the cent from the run's token counts, 61,626 in and 9,782 out over 24 articles, at **$3 / $15 per million tokens**, the price written into the workflow's code.

The model it calls, Claude Sonnet 5, costs **$2 / $10** today. A rise to $3 / $15 was announced for September 1, 2026, then cancelled. At today's price the same estimate is **$9.21 per 1,000**. A price written into code goes out of date without anyone noticing. So this calculator keeps every price in one table, with a source and a date. It applies announced changes on the day they take effect, and it says when the table is old.

## The math

The full derivation, a worked example and every assumption are in **[METHOD.md](METHOD.md)**. In short:

| Question | Formula | Why it looks like this |
|---|---|---|
| Model cost per record | Σ over steps: calls × (input × input price + output × output price) / 1M, with cached input at the cache price, batch at 50% off, and long prompts at the long-context price | Output costs 5 to 8.3 times input, thinking tokens are billed as output, and a workflow can call several models per record |
| People cost per record | share sent to a person × minutes / 60 × hourly cost | Uses the full cost of an hour (wage ÷ 0.70 in the US, per BLS), not the wage |
| Break-even for a new model | extra model cost per 1,000 ÷ the cost of one point of review share per 1,000 | Every point of records sent to a person has a price, so a model's price difference converts into points |
| Review threshold | send to a person when P(wrong) > review cost ÷ (share of mistakes reviewers catch × cost of a mistake) | The cost-minimising reject rule (Chow, 1970). It needs calibrated confidence |
| Mistakes that get through | 1,000 × (share out unreviewed × silent error rate + share reviewed × review precision × share reviewers miss) | The silent error rate is a test result, so it carries its 95% Wilson range |

The code is in [`cost.js`](cost.js). It has no dependencies and runs in both the browser and Node.

## How it's checked

```bash
npm test
```

64 tests, run with Node's built-in test runner. Every expected number was worked out by hand before the code was written.

Two more checks are in [`audit/`](audit):

- **[`reference_check.py`](audit/reference_check.py)** is a second, independent implementation of every formula, written from METHOD.md in exact decimal arithmetic. It recomputes all 25 figures METHOD.md's worked example quotes, and all 25 match. It then runs the shipped `cost.js` on 5,000 random workflows built to hit the edges, comparing 80,000 values. None differs by more than a billionth.
  ```bash
  py -3.11 -I audit/reference_check.py
  ```
- **[`mutants.js`](audit/mutants.js)** shows the tests catch real mistakes. It runs them against 14 broken copies of `cost.js`, each with one plausible bug, and every copy fails:

  | Deliberate mistake | Tests failed |
  |---|---|
  | Cached input billed at the full input price | 4 of 64 |
  | Batch discount forgotten | 1 of 64 |
  | Long-context price from the threshold itself, not above it | 1 of 64 |
  | Minutes treated as hours | 12 of 64 |
  | Fixed costs spread over 1,000 records, not the month's | 2 of 64 |
  | Break-even share moves the wrong way | 5 of 64 |
  | A point of review share taken as a whole share | 6 of 64 |
  | Review threshold ignores reviewers who miss mistakes | 2 of 64 |
  | 90% confidence instead of 95% in the Wilson range | 3 of 64 |
  | Mistakes reviewers miss left out | 1 of 64 |
  | A price change applied a day early | 1 of 64 |
  | Blocked records counted as going out | 2 of 64 |
  | Shares adding to exactly 100% rejected | 1 of 64 |
  | Money rounded to cents above $100 | 4 of 64 |

  The first run found a gap: rejecting shares that add to exactly 100% passed every test, because none of the tests' numbers happened to add to a hair over 1 in floating point. Typing 0.71% and 99.29% does. That case is now a test.
  ```bash
  node audit/mutants.js
  ```

GitHub Actions runs the tests on every push, on Linux and Windows, on Node 18, 22 and 24.

## Prices

The price table in [`prices.js`](prices.js) was copied from each provider's own pricing page on October 15, 2026:

- 6 Claude models, including the one the example workflow calls;
- OpenAI's 3 flagship models;
- 4 Gemini models.

Every entry links to its source. Scheduled price changes are recorded with their dates, and the page applies each on the day it takes effect: gemini-4-argon's price doubles on December 1, 2026.

Prices change, so every price can be edited on the page, and you can add your own models. Edits travel in the "copy a link" URL. The page says so when the table is more than 90 days old.

To update the table, change the numbers and the `CHECKED` date in `prices.js`, then run `npm test`. The tests check the table is well formed, and that the claims METHOD.md makes about it still hold.

## Files

- [`index.html`](index.html): the page. Plain HTML, CSS and JavaScript, with no build step.
- [`cost.js`](cost.js): the math.
- [`prices.js`](prices.js): the price table, with sources.
- [`state.js`](state.js): the presets, turning typed text into numbers, and the shareable link.
- [`METHOD.md`](METHOD.md): every formula, derived and worked through.
- [`test/`](test): the tests. [`audit/`](audit): the reference check and the mutation audit.

## References

- Chow, C. K. (1970). On optimum recognition error and reject tradeoff. *IEEE Transactions on Information Theory*, 16(1), 41–46.
- Wilson, E. B. (1927). Probable inference, the law of succession, and statistical inference. *Journal of the American Statistical Association*, 22(158), 209–212.
- Newcombe, R. G. (1998). Two-sided confidence intervals for the single proportion: comparison of seven methods. *Statistics in Medicine*, 17(8), 857–872.
- U.S. Bureau of Labor Statistics. [Employer Costs for Employee Compensation, June 2026](https://www.bls.gov/news.release/ecec.nr0.htm); [Occupational Outlook Handbook: Editors](https://www.bls.gov/ooh/media-and-communication/editors.htm).

## License

MIT. Built by [Devin Huber](https://devinhuber.com/).
