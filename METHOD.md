# Method

This is how the calculator works, written so every number on the page can be checked by hand. It covers the formulas and why they look the way they do, a full worked example, what the calculator assumes, and what it leaves out.

The code is in [`cost.js`](cost.js). Every formula below has a test in [`test/cost.test.js`](test/cost.test.js) with its expected answer worked out by hand. Those answers were then checked with exact decimal arithmetic in [`audit/reference_check.py`](audit/reference_check.py).

## Contents

1. [The question](#1-the-question)
2. [Model cost](#2-model-cost)
3. [People cost](#3-people-cost)
4. [Cost per 1,000 records](#4-cost-per-1000-records)
5. [Would a better model pay for itself?](#5-would-a-better-model-pay-for-itself)
6. [When is a review worth it?](#6-when-is-a-review-worth-it)
7. [Worked example](#7-worked-example)
8. [Assumptions](#8-assumptions)
9. [What it leaves out](#9-what-it-leaves-out)
10. [Prices](#10-prices)
11. [References](#11-references)

## 1. The question

An AI workflow's bill has two lines that are easy to see and one that is easy to miss:

- **Model cost**: what the model provider charges for the tokens.
- **People cost**: the time people spend checking the records the workflow sends them.
- **Mistakes nobody checked**: errors in records that went out without review.

Most cost calculators stop at the first line. In a workflow with confidence routing, where uncertain records go to a person, the second line is usually far bigger than the first. The third is the reason the second exists. Leaving either out makes the model look like the cost that matters, and that leads to the wrong decisions: buying a cheaper model that sends more records to people, or cutting reviews to save money and paying for it in mistakes.

Every record that enters the workflow ends up in exactly one of three places. The calculator uses the same words as [workflow-eval-harness](https://github.com/DHuberPortfolio/workflow-eval-harness):

| Route | Share | Who sees it |
|---|---|---|
| Sent to a person | *h* | a reviewer |
| Blocked or suppressed as a duplicate | *x* | nobody: it never goes out |
| Went out without review | *a* = 1 − *h* − *x* | nobody |

All three shares are of every record that **entered** the workflow, duplicates included. The model runs on every record before the routing decides anything, so it is paid for every record. That includes the duplicates suppressed afterwards.

## 2. Model cost

A workflow can call the model more than once per record: a cheap triage call, then a bigger call for the records that need one. Each call is a **step**. For each step:

| Symbol | Input | Unit |
|---|---|---|
| *I* | input tokens per call: everything sent, including the system prompt | tokens |
| *O* | output tokens per call: everything returned, **including thinking tokens** | tokens |
| *n* | calls per record, on average | calls |
| *c* | share of the input read from the provider's prompt cache | 0 to 1 |
| *P*<sub>in</sub>, *P*<sub>cache</sub>, *P*<sub>out</sub> | the model's prices for input, cached input and output | $ per million tokens |
| *b* | batch discount: 0.5 when the work runs through a batch API, else 0 | 0 to 1 |

The model cost of one step, per record:

> *M* = *n* × [ *I* × ((1 − *c*) × *P*<sub>in</sub> + *c* × *P*<sub>cache</sub>) + *O* × *P*<sub>out</sub> ] / 1,000,000 × (1 − *b*)

The workflow's model cost per record is the sum over its steps.

Why each piece is there:

- **Input and output are priced separately** because output costs 5 to 8.3 times as much as input for every model in the price table. A workflow that writes long answers costs far more than its input size suggests.
- **Thinking tokens count as output.** A model that reasons before answering is billed for the reasoning, even when the response shows none of it. Using only the visible answer's length is the most common way to underestimate.
- ***n* is an average**, so it covers three different things with one number:
  - a step only some records reach (a rule layer stops 40% first: *n* = 0.6);
  - a loop that calls the model several times (*n* = 3);
  - a call made once per batch rather than once per record (a summary of each run of 24: *n* = 1/24 ≈ 0.042).
- **Cached input** is billed at a fraction of the normal price: between 2.5% and 10% of it for every model in the price table. A long fixed prompt reused on every record can be mostly cache. The calculator counts cache reads only (see [assumptions](#8-assumptions)).
- **Batch processing** is 50% off at Anthropic, OpenAI and Google, in exchange for results arriving within hours instead of seconds. The formula applies the discount to everything, cache reads included. Anthropic's pricing page says the discounts stack, and OpenAI's batch prices halve cached input too. Google's two pages disagree on whether cache reads in a batch are discounted, so for Gemini with both caching and batch the result may be slightly low.
- **Long prompts can cost more.** Some models charge a higher price for every token of a request whose prompt is over a threshold: Claude Haiku 5.5 above 100,000 tokens, OpenAI's GPT-6 models above 272,000. The calculator compares *I* with the threshold and uses the higher prices for the whole step when *I* is over it. Because *I* is an average, a workflow whose prompts straddle the threshold is approximated.

## 3. People cost

| Symbol | Input | Unit |
|---|---|---|
| *h* | share of records sent to a person | 0 to 1 |
| *t* | minutes a person spends per review, on average | minutes |
| *w* | what an hour of a reviewer's time costs the business | $ per hour |

One review costs:

> *r* = *t* / 60 × *w*

and the people cost per record is:

> *H* = *h* × *r*

**Use the full hourly cost, not the wage.** An employee costs a business more than their pay: paid leave, insurance, retirement and payroll taxes come on top. In US private industry, wages and salaries were **70.0%** of employers' compensation costs in June 2026 ([BLS](https://www.bls.gov/news.release/ecec.nr0.htm)). So, as a rule of thumb, divide a wage by 0.70. The page's example does this: an editor's median wage of $37.46 an hour ([BLS, May 2025](https://www.bls.gov/ooh/media-and-communication/editors.htm)) becomes $37.46 / 0.70 = **$53.51** an hour.

**Minutes per review should be the whole handling time.** That means opening the record, reading it, deciding, fixing it when it is wrong, and moving to the next one. It should not be the minute spent reading.

## 4. Cost per 1,000 records

With *N* records a month and *F* in fixed monthly costs (the workflow platform's subscription, hosting):

> cost per record = Σ *M* + *H* + *F* / *N*
>
> cost per 1,000 records = 1,000 × cost per record
>
> cost per month = *N* × cost per record

The page shows the cost per 1,000 split into its parts, and each part's share of the total.

*F* / *N* is the only term that depends on volume, so it is the only way the cost per 1,000 falls as volume grows. Model and people costs scale in a straight line: twice the records, twice the cost.

**Optional: compared with doing it by hand.** If a person would take *m* minutes to do one record with no AI at all, doing 1,000 by hand costs 1,000 × *m* / 60 × *w*. The page shows how much less the workflow costs than that. This compares cost only: people doing the work by hand make mistakes too, and the page does not count those.

## 5. Would a better model pay for itself?

A better model usually costs more per token. If it is right more often, the workflow can be confident about more records, so it sends fewer of them to people. The question is how many fewer it needs to send to cover its price.

Change one step's model (and, optionally, its token counts). The change in model cost per 1,000 records is:

> Δ*M* = 1,000 × (*M*<sub>new</sub> − *M*<sub>now</sub>)

Every percentage point of records sent to a person costs:

> one point = 1,000 × 0.01 × *r* per 1,000 records

So the new model breaks even when it sends this many points fewer records to a person:

> break-even = Δ*M* / (1,000 × 0.01 × *r*) points

- **When the new model costs more** (Δ*M* > 0), it pays for itself if it cuts the share sent to a person by at least the break-even.
- **When it costs less** (Δ*M* < 0), the answer is negative, and it reads the other way: the cheaper model stays cheaper overall only if it sends no more than that many points **more** records to a person.

If the new model's share sent to a person has been measured, the page also shows both setups' totals side by side.

The surprise is usually how small the break-even is. A review costs dollars and a model call costs fractions of a cent, so a few points of review share outweigh a large price difference between models. That also means the reverse: a cheaper model that causes slightly more reviews costs more overall.

**What this assumes:**

- **The new model's mistakes are no more frequent.** The comparison is cost at equal quality. A model that sends fewer records to people by being overconfident is cheaper on this page and worse in practice. Measure its silent error rate before trusting a lower share. The [error-rate calculator](https://dhuberportfolio.github.io/error-rate-calculator/) shows whether a measured change in a rate is real.
- **The token counts are right for the new model.** Models count tokens differently. Anthropic says its tokenizer for Claude 4.7 and later produces about 30% more tokens for the same text than Sonnet 4.6's, and different providers' tokenizers differ too. A model that thinks more also writes more output tokens. The page warns when the two models count tokens differently, and the new model's token counts can be edited.

## 6. When is a review worth it?

### The threshold

Take one record the model has some chance *p* of having got wrong. The workflow can send it to a person or let it go out.

- Sending it to a person costs a review, *r*. Reviewers catch a share *k* of the mistakes they are shown, so with chance *p* × (1 − *k*) a mistake still gets through.
- Letting it go out costs nothing now, and with chance *p* a mistake reaches a customer. Call the cost of one such mistake *E*: a refund, rework, a complaint, a lost client.

The expected costs are:

> send to a person: *r* + *p* × (1 − *k*) × *E*
>
> let it go out: *p* × *E*

The review is worth it when the first is smaller, which simplifies to:

> **send to a person when *p* > *r* / (*k* × *E*)**

This is the reject rule Chow derived in 1970 for when a classifier should decline to decide. Here, sending a record to a person is the decline.

In the example below, a review costs $2.68 and a mistake that reaches a customer is put at $50. So any record with more than a 5.4% chance of being wrong should go to a person. If the model's confidence is calibrated, that means any record below 94.6% confidence.

Edge cases:

- **The threshold is 100% or more** (*E* × *k* ≤ *r*). A review costs at least as much as the mistake it prevents, so reviewing never pays. The page says so instead of showing a threshold above 100%.
- **The threshold is near 0%.** Mistakes are so costly that nearly everything should be checked.

**This needs calibrated confidence.** The threshold is about the true chance of a mistake. A model's stated confidence is only that chance if it is calibrated: of the records it marks 90% confident, 90% are right. Models are often not. [workflow-eval-harness](https://github.com/DHuberPortfolio/workflow-eval-harness) measures calibration against an answer key. Set the routing threshold on the measured chance, not on the stated one.

### Is the current queue paying for itself?

The threshold says where the edge of the review queue should be. The queue as a whole can be checked with **review precision** *q*: the share of records sent to a person that actually needed one, measured against an answer key. Each review catches *q* × *k* mistakes on average, so:

> review cost per mistake caught = *r* / (*q* × *k*)

If that is less than *E*, the queue pays for itself on average. The average can hide a queue whose edge is set too wide or too narrow, which is what the threshold is for.

### Mistakes that reach customers

With a silent error rate *s*, the share of records that went out without review that were wrong, mistakes reach customers by two paths per 1,000 records:

> 1,000 × ( *a* × *s* + *h* × *q* × (1 − *k*) )

The first path is records that went out with a mistake. The second is mistakes reviewers were shown and missed, which is zero when *k* = 1.

*s* comes from a test, so it is a sample, not the true rate. The page takes it as a count, *wrong* out of *tested*, and shows its likely range: the 95% Wilson score interval, the same method and the same *z* = 1.96 as the [error-rate calculator](https://dhuberportfolio.github.io/error-rate-calculator/) and workflow-eval-harness. The range carries through to mistakes per 1,000 and their cost. The other inputs are taken as given: the range shows the uncertainty in the test, not in your estimates of *t*, *w* or *E*.

With a cost per mistake, the page adds a third line to the bill:

> full cost per 1,000 = model + people + fixed + mistakes that reached customers × *E*

The mistakes line is drawn apart from the others. It is an expected cost and depends on an estimate of *E*. The model and people lines are cash.

## 7. Worked example

The page's example is a real workflow: the metadata enrichment agent in [AIBuildsSeptemberShowcase](https://github.com/DHuberPortfolio/AIBuildsSeptemberShowcase). It labels news articles against a fixed taxonomy and routes uncertain ones to an editor. Where each number comes from:

| Input | Value | Source |
|---|---|---|
| Model | Claude Sonnet 5, $2 in / $10 out per million tokens | the model the workflow calls; Anthropic's pricing page |
| Input tokens per article | 2,567.75 | measured: 61,626 over 24 articles (n8n execution 49) |
| Output tokens per article | 407.58 | measured: 9,782 over 24 articles (execution 49) |
| Sent to a person | 53.6% | measured: 268 of 500 (Golden 500, run 70) |
| Suppressed as duplicates | 6.6% | measured: 33 of 500 (run 70) |
| Minutes per review | 3 | **assumed** |
| Reviewer's hourly cost | $53.51 | editor's median wage $37.46 / 0.70 (BLS) |
| Silent errors | 13 of 199 that went out | measured (run 70) |
| Review precision | 44.0% | measured: 118 of 268 (run 70) |
| Cost of one mistake that reaches a customer | $50 | **assumed** |
| Records per month | 10,000 | **assumed** |

The token counts come from the 24-article run, because that is the run with token counts on record. The routing comes from the 500-article run, because the 24-article set was too small to be representative. The 500-article run used a longer prompt, so its token counts were probably somewhat higher. The model cost below is likely a slight underestimate, of a line that is under 1% of the total.

**Model cost per article:**

> 2,567.75 × $2 / 1,000,000 = $0.0051355
>
> 407.5833 × $10 / 1,000,000 = $0.0040758
>
> total = **$0.0092113**, so **$9.21 per 1,000 articles**

**People cost per article:**

> one review: 3 / 60 × $53.51 = **$2.6755**
>
> per article: 0.536 × $2.6755 = **$1.4341**, so **$1,434.07 per 1,000 articles**

**Total: $1,443.28 per 1,000 articles.** The model is 0.64% of it. At 10,000 articles a month that is $14,433 a month.

**Would Claude Fable 5.1 pay for itself?** At the same token counts:

> Fable 5.1 per article: 2,567.75 × $10 + 407.5833 × $50, divided by 1,000,000 = $0.046057 (**$46.06 per 1,000**)
>
> Δ*M* = $46.06 − $9.21 = **$36.85 per 1,000**
>
> one point of review share = 1,000 × 0.01 × $2.6755 = **$26.76 per 1,000**
>
> break-even = 36.85 / 26.76 = **1.38 points**

The most expensive model in the table pays for itself if it sends 1.4 points fewer articles to an editor: 52.2% instead of 53.6%. Fable 5.1 always thinks before answering, so its real output count would be higher than Sonnet 5's. Even triple the output tokens only moves the break-even to about 2.9 points.

**The other way, Claude Haiku 5.5:** it costs $0.46 per 1,000, so Δ*M* = −$8.75. It stays cheaper only if it sends no more than **0.33 points** more articles to an editor. About one extra review in 300 articles erases the saving.

**When is a review worth it?** With a mistake costing $50 and reviewers catching everything (*k* = 1):

> threshold = $2.6755 / $50 = **5.4%**. Send any article with a 5.4% or higher chance of being wrong to an editor.
>
> review cost per mistake caught = $2.6755 / 0.440 = **$6.08**, well under $50, so the queue pays for itself
>
> mistakes reaching customers: 1,000 × 0.398 × 13/199 = **26.0 per 1,000** (likely 15.4 to 43.2)
>
> at $50 each: **$1,300 per 1,000** (likely $768 to $2,160)

The full cost is **$2,743 per 1,000** articles. The mistakes nobody checked cost about as much as the people who checked the rest.

## 8. Assumptions

| Assumption | What breaks it | What to do instead |
|---|---|---|
| Cost scales in a straight line with volume, apart from fixed costs | volume discounts, committed-use contracts, rate-limit upgrades | enter your negotiated prices in the price table |
| Cache writes are free | the cache expires between records: Anthropic's lasts 5 minutes, so a record every half hour pays a write each time | lower the cached share to the share of calls that actually hit the cache. Your provider's usage report gives it (cache read tokens ÷ all input tokens) |
| Every review takes the average time | reviews of wrong records take longer than confirming right ones | the average still gives the right total, as long as it is measured over a typical mix |
| Reviewers catch *k* of the mistakes they see, whatever the record | some mistakes are easier to spot than others | use *k* measured on your own reviewers, or leave it at 100% and treat the result as a best case |
| The model's confidence is calibrated (section 6 only) | an overconfident model | calibrate, or set the threshold on measured error rates by confidence band |
| Token counts are the same for every model (section 5) | different tokenizers, models that think more | edit the new model's token counts |
| A call that fails is not billed | retries after a timeout or a malformed answer | add the retries to calls per record (*n* = 1.05 for a 5% retry rate) |

## 9. What it leaves out

These are real costs. They are left out because they do not vary per record, or because they belong to a different question:

- **Building and maintaining the workflow**: engineering time, prompt changes, testing against an answer key.
- **Reviewer overhead the per-review time misses**: training, management, and idle time between reviews. If reviewers are only partly busy, the real cost per review is higher than *t* / 60 × *w*.
- **Other per-record charges**: embeddings, search, OCR, paid APIs a step calls. Add them to fixed costs if they are flat. If they are per call, add a step with their price.
- **Platform charges per execution**, such as a workflow tool billing per run. Add them as fixed costs at your volume.
- **Surcharges**: Anthropic adds 10% for US-only processing, and OpenAI adds 10% for data-residency endpoints. Edit the prices if you use them.
- **Taxes and currency conversion.** All prices are in US dollars.

## 10. Prices

The price table is in [`prices.js`](prices.js), one entry per model. Every entry carries the page it came from and the date it was checked. The page also flags:

- **Scheduled changes.** Some prices have a published change date: Google's Gemini 4 Argon doubles on December 1, 2026. The table records both prices and the date. The page uses whichever is in effect on the day it is opened, and warns about a change in the next 60 days.
- **Stale prices.** When the table was last checked more than 90 days before the day the page is opened, the page says so.
- **Edited prices.** Any price can be edited on the page, and models can be added. Edits stay in the browser and travel in the "copy a link" URL. They are never sent anywhere.

The tests check that the table is well formed:

- every price is a number zero or above;
- cached input never costs more than input;
- every entry links to an https page and has a date;
- scheduled changes are in date order.

## 11. References

- Chow, C. K. (1970). On optimum recognition error and reject tradeoff. *IEEE Transactions on Information Theory*, 16(1), 41–46.
- Wilson, E. B. (1927). Probable inference, the law of succession, and statistical inference. *Journal of the American Statistical Association*, 22(158), 209–212.
- U.S. Bureau of Labor Statistics (2026). *Employer Costs for Employee Compensation, June 2026.* Released September 9, 2026. https://www.bls.gov/news.release/ecec.nr0.htm
- U.S. Bureau of Labor Statistics. *Occupational Outlook Handbook: Editors* (May 2025 wage data). https://www.bls.gov/ooh/media-and-communication/editors.htm
- Model prices: [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), [OpenAI](https://developers.openai.com/api/docs/pricing), [Google](https://ai.google.dev/gemini-api/docs/pricing), all checked October 15, 2026.
