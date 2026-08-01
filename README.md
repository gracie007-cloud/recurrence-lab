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

## Monte Carlo simulator

Two simulation views make the statistics visible rather than just numeric:

- **Observed vs expected — Monte Carlo envelope (animated).** The null
  experiment (the observed number of draws of `k` from `N`) is replicated live,
  and the 95% envelope band and observed-count bars **build up as the
  replications accumulate**, with a play/replay control and a replication-count
  slider. A live readout shows how many numbers sit outside the band versus the
  ~5% a fair mechanism throws off by luck, and settles when the run completes.
  Streaming quantiles come from a deterministic reservoir sampler.
- **Next-draw prediction — Monte Carlo (animated).** The currently selected
  tool's fitted probability vector is sampled live, and the predicted-rate bars
  **build up as the draws accumulate**, with a play/replay control and a
  replication-count slider (500–10,000). A live readout shows the most likely
  set and its exact-set probability converging against the `1 / C(N, k)` any
  set carries. This is always framed as a **distribution, never a promise** —
  on a fair mechanism the model spreads probability near-evenly and says so.

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
- The Monte Carlo envelope is calibrated: ~2–5% of numbers sit outside a 95%
  envelope on pure chance (the chance rate), while planted bias is flagged and
  the deterministic law's predicted set is recovered exactly. On noise the
  prediction simulator shows no meaningful concentration (top-number lift near
  1×), which is the honest answer.

## Real lottery dataset library

The lab ships with a browsable library of real, source-cited draw histories.
Open the app from a static server (Netlify, GitHub Pages, or `npx serve`) and
the **Real lottery dataset library** panel appears at the top of the intake.
Click **Load dataset** on any card and the draws populate the history textarea
with the matching draw-format preset applied automatically — ready to analyze.

> Opening `app.html` or `index.html` directly from disk (`file://`) will load
> the app, but the library panel will show a fetch error: browsers block
> `fetch()` of local files for security. Serve the folder with any static
> server and the library works.

### Datasets included

| Dataset | Game | Draws | Date range | Source |
| --- | --- | --- | --- | --- |
| Canada Lotto 6/49 | 6/49 + bonus | 25 | 2026-05-06 → 2026-07-29 | lotto-8.com (cross-referenced with calotteries.com) |
| US Powerball | 5/69 + 1/26 | 25 | 2026-06-03 → 2026-07-29 | powerball-checker.com (cross-verified with nclottery.com, texaslottery.com) |
| US Mega Millions | 5/70 + 1/25 | 25 | 2026-04-17 → 2026-07-10 | lottery.net (cross-verified with AP News, Maryland Lottery, Texas Lottery) |
| UK Lotto | 6/59 + bonus | 25 | 2026-05-06 → 2026-07-29 | lottery.co.uk (cross-verified with results.co.uk, news sources) |
| Philippine PCSO 6/49 Super Lotto | 6/49 | 20 | 2026-06-09 → 2026-07-23 | lottopcso.com (cross-referenced with lottobot.ai) |

Each dataset file (`datasets/*.txt`) carries a header comment with the full
source URL, access date, draw schedule, and format notes. The
`datasets/manifest.json` file lists every dataset with its config so the app
applies the right pool/picks/preset on load.

### Adding a dataset

Drop a `.txt` file into `datasets/` (one draw per line, `YYYY-MM-DD  N1 N2 ... | Bonus`),
add an entry to `datasets/manifest.json` with the matching config, and redeploy.
No code changes required.

## Draw-format presets

Eight common lottery formats are one click away in the **Draw format preset**
dropdown, plus **Custom** for manual pool/picks:

- 6 from 1–49 (standard)
- 7 from 1–52
- 5 from 1–49 (Euro-style)
- 6 from 1–45
- 6 from 1–70 (Powerball-style pool)
- 4 digits 0–9 (pick-4)
- 3 digits 0–9 (pick-3)
- 2 digits 0–9 (pick-2 / pairs)

## Date-aware diagnostics

Draws may carry an optional leading date (`YYYY-MM-DD`). The engine validates
real calendar dates, detects duplicates and out-of-order entries, and — when
enough dated draws are present — shows **descriptive** date statistics
(cadence, ordering, duplicate notes) in the verdict. These are explicitly
labeled **"Not predictive"**: no calendar-time recurrence law is inferred and
no claim is made about future draw dates. Both ascending and descending
chronological order are recognized.

## Deploy to Netlify

The app is static — no build step. The repo root is the publish directory.

**Option A — drag and drop.** Zip the repo folder and drop it onto
[app.netlify.com/drop](https://app.netlify.com/drop). Done.

**Option B — Git-connected (auto-deploy).**

1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
3. Build settings (auto-detected from `netlify.toml`):
   - **Build command:** *(none)*
   - **Publish directory:** `.`
4. Deploy. Every push to the main branch redeploys automatically.

`netlify.toml` sets sane cache headers for `datasets/`, JS, CSS, and the
manifest, and serves `index.html` as the site root.

**Local preview:** `npx serve .` (or `python3 -m http.server`) from the repo
root, then open the printed URL.

## Provenance

Consolidated from an earlier `numbers_predictions` Flask prototype. The
prototype's useful statistical battery (runs test, KS, Poisson model, spectral
analysis) was ported into the static engine; its hardcoded "time-powered
recurrence" generator and fixed target set were **not** carried over, because
they imposed a pattern rather than discovering one — which is exactly the
failure mode this lab is built to avoid.
