# Recurrence Lab

A standalone, dependency-free, static web app for one honest question about a
draw-style number series:

> **Is the recurrence you see a derivable law, pure chance, or a mixture of the two?**

Paste any history of draws (a lottery, a generator, a physical mechanism — one
draw per line). The lab first tests whether what you're seeing is
distinguishable from exchangeable sampling without replacement, then routes you
to the tool that the evidence actually justifies. Every model is judged on
draws it never saw.

Open `index.html` in a browser, or serve the folder with any static file
server. No build step, no dependencies, no API keys, no backend. State is kept
in `localStorage`.

---

## The three tools

The lab runs a battery of checks against the null hypothesis (every number
equally likely, `q = k/N`), then recommends — never locks — one of three tools.
All three stay selectable at all times.

| Tool | Used when | What it does |
| --- | --- | --- |
| **1. Analytic derivation** | A pattern is detected | Searches a *restricted* class of closed-form recurrences (constant, arithmetic, affine mod M, second-order linear mod M, periodic, low-degree polynomial) and reports a law **only if it survives out-of-sample validation**, selected by minimum description length. |
| **2. Stochastic recurrence** | No pattern is detected | Beta-Binomial posterior per number with the prior centred on the hypergeometric rate `q = k/N`, FDR-controlled deviation tests, credible intervals, and a gap analysis that quantifies the gambler's fallacy. |
| **3. Hybrid ensemble** | A mixture is detected | Four experts (exchangeable null, shrunk frequency, adaptive EWMA, analytic law) compete under log loss; multiplicative weights (Hedge) learn the mixture online. The learned weights measure how much is structure and how much is chance. |

A **structure & randomness battery** (runs test, Kolmogorov–Smirnov vs uniform,
Poisson recurrence model, and FFT spectral concentration) adds independent
evidence about how random the series itself is. These judge structure — they
never predict a next draw.

## Guardrails

These are enforced in code, not just in prose:

1. **Restricted hypothesis class.** Tool 1 only searches explicit closed-form
   assumptions about the generating process. A universal function approximator
   would fit any history perfectly and predict nothing.
2. **Probabilistic conclusions.** Nothing is reported as certain. Frequencies
   carry credible intervals, deviations carry FDR-controlled p-values, and even
   a validated analytic law is capped below certainty about any future draw.
3. **Prior knowledge as structure.** Sampling without replacement,
   exchangeability, and `q = k/N` are hard-wired, so the model starts at the
   right answer for a fair mechanism and only moves away when the evidence pays
   for the move.
4. **Judged on new observations.** Every tool is walk-forward tested: refit on
   a prefix, scored on the next unseen draw, repeated. Reproducing history
   earns no credit. If a model can't beat the uniform baseline out of sample,
   the lab says so.

## What it will *not* tell you

For a fair, well-maintained lottery the correct conclusion is **Tool 2 with
zero lift**: draws are independent, the past carries no information about the
future, and no staking scheme changes the negative expected value. This lab is
built to reach that conclusion honestly when it's true — and it will tell you
when your "pattern" is the shape random data always has. Where it's genuinely
useful is detecting a **biased mechanism** or a **non-random generator**, which
the bundled sample corpora demonstrate.

A finite list of numbers alone can never determine a future recurrence law —
any formula that "forces" a chosen set to recur is an *imposition* of a pattern,
not a *discovery* of one. The lab is explicit about that distinction throughout.

## Verified behaviour

The engine is exercised by an automated honesty suite:

- On **30 independent pure-chance corpora**, the lab reports "no pattern",
  finds no surviving law, and declines to claim an edge (predictive lift is
  slightly *negative* — fitting noise costs you). 0/30 false patterns.
- On **planted-bias data** it recovers exactly the biased numbers and the
  stochastic tool beats the uniform baseline out of sample.
- On **deterministic data** it recovers the recurrence and validates at 100%
  held-out accuracy.
- The KS test is calibrated against its own permutation null (the classical
  asymptotic p-value is badly anti-conservative on discrete uniform data).

## Provenance

Consolidated from an earlier `numbers_predictions` Flask prototype. The
prototype's useful statistical battery (runs test, KS, Poisson model, spectral
analysis) was ported into the static engine; its hardcoded "time-powered
recurrence" generator and fixed target set were **not** carried over, because
they imposed a pattern rather than discovering one — which is exactly the
failure mode this lab is built to avoid.
