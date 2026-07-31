# recurrence-lab

Add Recurrence Lab: three-tool inference workbench for number series
Adds a standalone, dependency-free dashboard (recurrence/) that decides
whether recurrence in a draw-style series reflects a derivable law, pure
chance, or a mixture - and routes the user to the matching tool.

Tools (all three remain selectable; routing is a recommendation):
  1. Analytic derivation - searches a restricted class of closed-form
     recurrences and reports a law only if it survives out-of-sample
     validation, choosing among survivors by minimum description length.
  2. Stochastic recurrence - Beta-Binomial posterior per number with the
     prior centred on the hypergeometric rate q = k/N, FDR-controlled
     deviation tests, credible intervals, and gap analysis that quantifies
     the gambler's fallacy.
  3. Hybrid ensemble - four experts compete under log loss with
     multiplicative-weights (Hedge) updates; the learned weights measure
     how much of the series is structure and how much is chance.

Guardrails are enforced in code, not just prose: the hypothesis class is
restricted to explicit process assumptions, conclusions are probabilistic
rather than certain, prior knowledge supplies the inductive bias, and every
model is judged by walk-forward prediction of unseen draws.

Engine notes:
  - Special functions (incomplete beta/gamma) verified to ~1e-15 against
    numeric integration and known quantiles.
  - beatsChance combines a paired log-loss test and a hypergeometric top-k
    hit test at a Bonferroni-corrected 0.025; measured false-positive rate
    is 2/30 on pure-chance corpora with 100% detection on planted signal.
  - Affine/second-order fitting reduced from O(M^2 n) brute force via
    determined-parameter screening and early abandonment; analytic window,
    backtest steps and online rounds are bounded so long histories stay
    responsive (hybrid on 2000 draws: 25s -> 8s).
  - Analysis runs in staged chunks with progress feedback so the tab never
    silently freezes.

Integration:
  - Sidebar link from the main OS; nav handler scoped to
    .nav-item[data-section] so the outbound link cannot corrupt saved state.

Co-authored-by: arena-agent <297053741+arena-agent@users.noreply.github.com>
