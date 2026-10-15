"""Does cost.js compute what METHOD.md says, to the last digit that matters?

The tests check cost.js against answers worked out by hand. That catches a wrong
formula only where a hand-worked case happens to exercise it. This script is a
second implementation, written from METHOD.md's formulas and not from cost.js. It
uses exact decimal arithmetic (Python's Decimal, 50 significant digits), so it has
no floating-point rounding of its own.

It does two things:

  1. Prints every figure METHOD.md's worked example quotes, recomputed exactly, and
     checks each against the text.
  2. Runs the shipped cost.js (through dump.js) on 5,000 random cases and compares
     every result with its own. The random cases are built to hit the edges:
     the long-context threshold exactly and either side of it, zero calls, a fully
     cached prompt, batch on and off, dates either side of a scheduled price change,
     reviews that cost nothing. The allowance is a billionth of the value, which
     floating-point rounding stays well inside; a wrong formula does not.

Standard library only. Run from the repo root:  py -3.11 -I audit/reference_check.py
"""

import json
import random
import subprocess
import sys
from decimal import Decimal as D, getcontext
from pathlib import Path

getcontext().prec = 50
ROOT = Path(__file__).resolve().parent.parent
MILLION = D(1_000_000)
Z = D("1.96")
CASES = 5000
TOLERANCE = D("1e-9")


def dec(x):
    """The exact decimal value of a number as JSON would carry it to JavaScript."""
    return D(repr(x)) if isinstance(x, float) else D(x)


def node(args, payload=None):
    """Run Node in the repo root and read its JSON output."""
    result = subprocess.run(["node", *args], input=payload, capture_output=True, text=True, cwd=ROOT, check=True)
    return json.loads(result.stdout)


# The price table is data, not what this script checks, so it is read from prices.js.
MODELS = node(["-e", "console.log(JSON.stringify(require('./prices.js').MODELS))"])
BY_ID = {m["id"]: m for m in MODELS}


# ---- METHOD.md's formulas, written again ----

def price_on(model, date):
    p = {k: model[k] for k in ("input", "cached", "output")}
    p["long"] = model.get("long")
    for change in model.get("changes", []):
        if change["from"] <= date:
            p.update({k: v for k, v in change.items() if k != "from"})
    return p


def step_cost(step, model, date, batch):
    """Section 2: n x [I x ((1 - c) P_in + c P_cache) + O x P_out] / 1e6 x (1 - b)."""
    p = price_on(model, date)
    if p["long"] is not None and dec(step["input"]) > dec(p["long"]["above"]):
        p = p["long"]
    i, o, n, c = (dec(step[k]) for k in ("input", "output", "calls", "cached"))
    b = D("0.5") if batch else D(0)
    return n * (i * ((1 - c) * dec(p["input"]) + c * dec(p["cached"])) + o * dec(p["output"])) / MILLION * (1 - b)


def workflow(inputs, date):
    """Sections 3 and 4."""
    model = sum((step_cost(s, BY_ID[s["model"]], date, inputs["batch"]) for s in inputs["steps"]), D(0))
    review = dec(inputs["minutes"]) / 60 * dec(inputs["hourly"])
    people = dec(inputs["toPerson"]) * review
    fixed = dec(inputs["fixed"]) / dec(inputs["records"])
    total = model + people + fixed
    return {"model": model, "people": people, "fixed": fixed, "total": total, "review": review,
            "out": max(D(0), 1 - dec(inputs["toPerson"]) - dec(inputs["stopped"]))}


def break_even(inputs, date, change):
    """Section 5."""
    now = workflow(inputs, date)
    steps = [dict(s) for s in inputs["steps"]]
    steps[change["step"]].update(model=change["model"], input=change["input"], output=change["output"])
    nxt = workflow({**inputs, "steps": steps}, date)
    delta = 1000 * (nxt["model"] - now["model"])
    point = 1000 * D("0.01") * now["review"]
    points = None if point == 0 else delta / point
    share = None if points is None else dec(inputs["toPerson"]) - points / 100
    return {"delta": delta, "point": point, "points": points, "shareNeeded": share}


def wilson(wrong, tested):
    p = D(wrong) / D(tested)
    n = D(tested)
    denom = 1 + Z * Z / n
    center = (p + Z * Z / (2 * n)) / denom
    half = Z * (p * (1 - p) / n + Z * Z / (4 * n * n)).sqrt() / denom
    return p, max(D(0), center - half), min(D(1), center + half)


def mistakes(m, inputs, w):
    """Section 6: 1,000 x (a x s + h x q x (1 - k)), and r / (q x k)."""
    q, k = dec(m["precision"]), dec(m["catchRate"])
    missed = dec(inputs["toPerson"]) * q * (1 - k)
    rate, low, high = wilson(m["wrong"], m["tested"])
    per = lambda s: 1000 * (w["out"] * s + missed)
    return {"rate": per(rate), "low": per(low), "high": per(high),
            "perCaught": None if q * k == 0 else w["review"] / (q * k)}


# ---- 1. the worked example ----

def worked_example():
    run49 = {"input": D(61626) / 24, "output": D(9782) / 24, "calls": 1, "cached": 0}
    # Decimal token counts go in as exact values; step_cost's dec() leaves Decimals alone.
    ex = {"records": 10000, "steps": [{"model": "claude-sonnet-5", **run49}], "batch": False,
          "toPerson": D(268) / 500, "stopped": D(33) / 500, "minutes": 3, "hourly": D("53.51"), "fixed": 0}
    w = workflow(ex, "2026-10-15")
    fable = break_even(ex, "2026-10-15", {"step": 0, "model": "claude-fable-5-1", **{k: run49[k] for k in ("input", "output")}})
    haiku = break_even(ex, "2026-10-15", {"step": 0, "model": "claude-haiku-5-5", **{k: run49[k] for k in ("input", "output")}})
    thinks = break_even(ex, "2026-10-15", {"step": 0, "model": "claude-fable-5-1", "input": run49["input"], "output": 3 * run49["output"]})
    at_3_15 = (D(61626) * 3 + D(9782) * 15) / 24 / MILLION
    m = mistakes({"wrong": 13, "tested": 199, "precision": D("0.44"), "catchRate": 1}, ex, w)
    full = 1000 * w["total"] + 50 * m["rate"]

    # [what, exact value, how METHOD.md prints it, decimals to round to]
    rows = [
        ("execution 49 at $3/$15, per 1,000", 1000 * at_3_15, "13.82", 2),
        ("model per 1,000 (Sonnet 5)", 1000 * w["model"], "9.21", 2),
        ("one review", w["review"], "2.6755", 4),
        ("people per 1,000", 1000 * w["people"], "1434.07", 2),
        ("total per 1,000", 1000 * w["total"], "1443.28", 2),
        ("model share of the total, %", 100 * w["model"] / w["total"], "0.64", 2),
        ("per month at 10,000", 10000 * w["total"], "14433", 0),
        ("Fable 5.1 per 1,000", 1000 * w["model"] + fable["delta"], "46.06", 2),
        ("Fable 5.1 extra per 1,000", fable["delta"], "36.85", 2),
        ("one point per 1,000", fable["point"], "26.76", 2),
        ("Fable 5.1 break-even, points", fable["points"], "1.38", 2),
        ("... share at break-even, %", 100 * fable["shareNeeded"], "52.2", 1),
        ("... with triple output, points", thinks["points"], "2.9", 1),
        ("Haiku 5.5 per 1,000", 1000 * w["model"] + haiku["delta"], "0.46", 2),
        ("Haiku 5.5 saving per 1,000", -haiku["delta"], "8.75", 2),
        ("Haiku 5.5 break-even, points more", -haiku["points"], "0.33", 2),
        ("review threshold, %", 100 * w["review"] / 50, "5.4", 1),
        ("cost per mistake caught", m["perCaught"], "6.08", 2),
        ("mistakes reaching customers per 1,000", m["rate"], "26.0", 1),
        ("... likely from", m["low"], "15.4", 1),
        ("... likely to", m["high"], "43.2", 1),
        ("mistakes cost per 1,000 at $50", 50 * m["rate"], "1300", 0),
        ("... likely from", 50 * m["low"], "768", 0),
        ("... likely to", 50 * m["high"], "2160", 0),
        ("full cost per 1,000", full, "2743", 0),
    ]
    bad = 0
    print("1. Figures quoted in METHOD.md section 7, recomputed exactly\n")
    print(f"   {'figure':40} {'exact':>24}  {'METHOD.md':>10}")
    for what, exact, printed, places in rows:
        shown = f"{exact:.{places}f}"
        ok = shown == printed
        bad += not ok
        print(f"   {what:40} {exact:24.10f}  {printed:>10}  {'ok' if ok else 'MISMATCH (' + shown + ')'}")
    print(f"\n   {len(rows) - bad} of {len(rows)} match\n")
    return bad


# ---- 2. random cases against the shipped cost.js ----

def random_case(rng):
    def step():
        return {
            "model": rng.choice(MODELS)["id"],
            "input": rng.choice([0, 100000, 100001, 272000, 272001,
                                 rng.uniform(1, 5000), rng.uniform(90000, 130000), rng.uniform(250000, 300000)]),
            "output": rng.choice([0, rng.uniform(1, 5000)]),
            "calls": rng.choice([0, 0.5, 1, 1 / 24, 3, rng.uniform(0, 5)]),
            "cached": rng.choice([0, 1, 0.25, rng.random()]),
        }
    to_person = rng.choice([0, 1, rng.random()])
    inputs = {
        "records": rng.choice([1, 1000, rng.uniform(1, 1e6)]),
        "steps": [step() for _ in range(rng.randint(1, 3))],
        "batch": rng.random() < 0.5,
        "toPerson": to_person,
        "stopped": rng.uniform(0, 1 - to_person),
        "minutes": rng.choice([0, rng.uniform(0, 30)]),
        "hourly": rng.uniform(0, 200),
        "fixed": rng.choice([0, rng.uniform(0, 5000)]),
        "manualMinutes": None,
    }
    tested = rng.randint(1, 1000)
    return {
        "date": rng.choice(["2026-10-15", "2026-11-30", "2026-12-01", "2027-02-01"]),
        "inputs": inputs,
        "change": {"step": rng.randrange(len(inputs["steps"])), "model": rng.choice(MODELS)["id"],
                   "input": rng.uniform(0, 300000), "output": rng.uniform(0, 5000), "toPerson": None},
        "threshold": {"mistakeCost": rng.choice([0, rng.uniform(0, 500)]), "catchRate": rng.choice([0, 1, rng.random()])},
        "mistakes": {"wrong": rng.randint(0, tested), "tested": tested,
                     "precision": rng.choice([0, 1, rng.random()]), "catchRate": rng.choice([1, rng.random()])},
    }


def allowance(exact):
    """A billionth of the value; for values under 1, a billionth absolute. (A value that
    cancels to nearly zero, such as a break-even share of 0.536 - 0.536, would otherwise
    demand impossible precision from floating point.)"""
    return TOLERANCE * max(D(1), abs(exact))


def same(js, exact):
    """JavaScript's float against the exact value: within the allowance, or both absent."""
    if exact is None or js is None:
        return exact is None and js is None
    return abs(dec(js) - exact) <= allowance(exact)


def random_cases():
    rng = random.Random(20261015)
    cases = [random_case(rng) for _ in range(CASES)]
    got = node(["audit/dump.js"], json.dumps(cases))
    worst, bad, compared = D(0), 0, 0
    for case, js in zip(cases, got):
        inputs, date = case["inputs"], case["date"]
        w = workflow(inputs, date)
        b = break_even(inputs, date, case["change"])
        saved = dec(case["threshold"]["catchRate"]) * dec(case["threshold"]["mistakeCost"])
        m = mistakes(case["mistakes"], inputs, w)
        pairs = [
            (js["per1000"]["model"], 1000 * w["model"]), (js["per1000"]["people"], 1000 * w["people"]),
            (js["per1000"]["fixed"], 1000 * w["fixed"]), (js["per1000"]["total"], 1000 * w["total"]),
            (js["perMonth"]["total"], dec(inputs["records"]) * w["total"]), (js["review"], w["review"]),
            (js["out"], w["out"]),
            (js["breakEven"]["delta"], b["delta"]), (js["breakEven"]["point"], b["point"]),
            (js["breakEven"]["points"], b["points"]), (js["breakEven"]["shareNeeded"], b["shareNeeded"]),
            (js["threshold"], None if saved <= 0 else w["review"] / saved),
            (js["mistakes"]["rate"], m["rate"]), (js["mistakes"]["low"], m["low"]),
            (js["mistakes"]["high"], m["high"]), (js["mistakes"]["perCaught"], m["perCaught"]),
        ]
        for got_js, exact in pairs:
            compared += 1
            if not same(got_js, exact):
                bad += 1
                if bad <= 5:
                    print("   MISMATCH", got_js, exact, json.dumps(case)[:300])
            elif exact is not None:
                worst = max(worst, abs(dec(got_js) - exact) / allowance(exact))
    print("2. cost.js against an exact implementation of METHOD.md\n")
    print(f"   {CASES:,} random cases, {compared:,} values compared, {bad} outside the allowance")
    print(f"   largest difference: {worst:.1e} of the allowance (a billionth of the value)\n")
    return bad


if __name__ == "__main__":
    failures = worked_example() + random_cases()
    print("PASS" if failures == 0 else f"FAIL: {failures} problems")
    sys.exit(0 if failures == 0 else 1)
