/*
 * Recurrence Lab — UI controller
 * Renders three interchangeable tools over RecurrenceEngine.
 */
(function () {
  "use strict";

  var E = window.RecurrenceEngine;
  var STORAGE_KEY = "recurrence-lab:v1";

  var state = {
    tool: "analytic",
    parsed: null,
    diag: null,
    results: {},
    config: E.normalizeConfig({}),
    stochasticOpts: { priorStrength: 40, decay: 1.0 },
    mcSeed: 20260731,
    running: false
  };

  var el = {};

  function $(id) {
    return document.getElementById(id);
  }

  function ready() {
    el.input = $("dataInput");
    el.parseStatus = $("parseStatus");
    el.detectHint = $("detectHint");
    el.verdictHost = $("verdictHost");
    el.toolSection = $("toolSection");
    el.panels = {
      analytic: $("panel-analytic"),
      stochastic: $("panel-stochastic"),
      hybrid: $("panel-hybrid")
    };
    el.cfg = {
      min: $("cfgMin"),
      max: $("cfgMax"),
      picks: $("cfgPicks"),
      replace: $("cfgReplace")
    };

    el.input.addEventListener("input", onInput);
    $("btnAnalyze").addEventListener("click", runAnalysis);
    $("btnClear").addEventListener("click", function () {
      el.input.value = "";
      onInput();
      reset();
    });
    $("btnUpload").addEventListener("click", function () {
      $("fileInput").click();
    });
    $("fileInput").addEventListener("change", onFile);
    $("btnExport").addEventListener("click", exportReport);
    $("btnMethod").addEventListener("click", function () {
      var c = $("methodCard");
      c.hidden = !c.hidden;
      if (!c.hidden && c.scrollIntoView) c.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("btnMethodClose").addEventListener("click", function () {
      $("methodCard").hidden = true;
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-sample]"), function (b) {
      b.addEventListener("click", function () {
        loadSample(b.getAttribute("data-sample"));
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll(".tool-tab"), function (t) {
      t.addEventListener("click", function () {
        selectTool(t.getAttribute("data-tool"));
      });
    });

    Object.keys(el.cfg).forEach(function (k) {
      el.cfg[k].addEventListener("change", function () {
        readConfig();
        onInput();
      });
    });

    restore();
    onInput();
  }

  function readConfig() {
    state.config = E.normalizeConfig({
      poolMin: Number(el.cfg.min.value),
      poolMax: Number(el.cfg.max.value),
      picks: Number(el.cfg.picks.value)
    });
    state.withReplacement = el.cfg.replace.value === "with";
    $("priorNote").innerHTML =
      "Null hypothesis: every number equally likely, q = k/N = " +
      state.config.picks +
      "/" +
      state.config.poolSize +
      " = <strong>" +
      (state.config.picks / state.config.poolSize).toFixed(4) +
      "</strong> per draw.";
    return state.config;
  }

  function writeConfig(cfg) {
    el.cfg.min.value = cfg.poolMin;
    el.cfg.max.value = cfg.poolMax;
    el.cfg.picks.value = cfg.picks;
    readConfig();
  }

  /* ---------------- intake ---------------- */

  function onInput() {
    var text = el.input.value;
    if (!text.trim()) {
      el.parseStatus.className = "parse-status";
      el.parseStatus.textContent = "Waiting for observations.";
      el.detectHint.textContent = "";
      $("btnAnalyze").disabled = true;
      return;
    }
    readConfig();
    var parsed = E.parseDraws(text, state.config);
    var detected = E.autoDetectConfig(text);

    // If the current structure rejects everything but the data clearly has a
    // consistent shape of its own, adopt it rather than showing a wall of
    // errors the user has to decode.
    if (!parsed.draws.length && detected && parsed.total > 0) {
      var trial = E.parseDraws(text, detected);
      if (trial.draws.length) {
        writeConfig(detected);
        parsed = trial;
        el.detectHint.innerHTML =
          "Structure auto-set to <strong>" + detected.picks + "/" + detected.poolMax + "</strong> to match your data.";
      }
    }
    state.parsed = parsed;
    if (
      detected &&
      (detected.picks !== state.config.picks || detected.poolMax !== state.config.poolMax)
    ) {
      el.detectHint.innerHTML =
        'Looks like <strong>' + detected.picks + "/" + detected.poolMax +
        '</strong>. <a href="#" id="applyDetect">Apply</a>';
      var a = $("applyDetect");
      if (a) {
        a.addEventListener("click", function (ev) {
          ev.preventDefault();
          writeConfig(detected);
          onInput();
        });
      }
    } else {
      el.detectHint.textContent = detected ? "Structure matches your settings." : "";
    }

    var n = parsed.draws.length;
    var cls = "parse-status is-ok";
    var msg = "<strong>" + n + " valid draws</strong> parsed.";
    if (!n) {
      cls = "parse-status is-bad";
      msg = "<strong>No valid draws.</strong> Check the pool range and picks per draw.";
    } else if (n < 12) {
      cls = "parse-status is-warn";
      msg +=
        " Fewer than 12 draws is too little to separate signal from noise; results will be" +
        " dominated by the prior.";
    }
    if (parsed.rejected.length) {
      cls = n ? "parse-status is-warn" : cls;
      msg +=
        " <strong>" + parsed.rejected.length + " rejected.</strong>" +
        "<ul>" +
        parsed.issues.slice(0, 5).map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") +
        (parsed.issues.length > 5 ? "<li>and " + (parsed.issues.length - 5) + " more</li>" : "") +
        "</ul>";
    }
    el.parseStatus.className = cls;
    el.parseStatus.innerHTML = msg;
    $("btnAnalyze").disabled = n < 4;
    persist();
  }

  function onFile(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      el.input.value = String(r.result);
      var d = E.autoDetectConfig(el.input.value);
      if (d) writeConfig(d);
      onInput();
    };
    r.readAsText(f);
    ev.target.value = "";
  }

  function loadSample(id) {
    var s = E.generateSample(id, 120);
    el.input.value = s.text;
    writeConfig(s.config);
    onInput();
    runAnalysis();
  }

  function reset() {
    state.diag = null;
    state.results = {};
    el.verdictHost.hidden = true;
    el.toolSection.hidden = true;
    Object.keys(el.panels).forEach(function (k) {
      el.panels[k].hidden = true;
      el.panels[k].innerHTML = "";
    });
    $("btnExport").disabled = true;
  }

  /* ---------------- analysis ---------------- */

  function runAnalysis() {
    if (state.running) return;
    var parsed = state.parsed;
    if (!parsed || parsed.draws.length < 4) return;

    state.running = true;
    var btn = $("btnAnalyze");
    btn.disabled = true;

    var draws = state.parsed.draws;
    var cfg = state.config;

    // Each tool refits repeatedly, which is heavy for long histories. Run the
    // stages in sequence with a yield between them so the browser can paint
    // progress instead of showing a frozen tab.
    var stages = [
      ["Testing against the null…", function () {
        state.diag = E.diagnostics(draws, cfg);
        state.tests = E.structureTests(draws, cfg);
        state.envelope = E.monteCarloEnvelope(draws, cfg, { seed: state.mcSeed });
      }],
      ["Searching for a law…", function () {
        state.results.analytic = {
          model: E.deriveAnalyticLaw(draws, cfg),
          backtest: E.backtest(draws, cfg, E.scorerFor("analytic", cfg))
        };
      }],
      ["Fitting recurrence frequencies…", function () {
        state.results.stochastic = {
          model: E.stochasticModel(draws, cfg, state.stochasticOpts),
          backtest: E.backtest(draws, cfg, E.scorerFor("stochastic", cfg, state.stochasticOpts))
        };
      }],
      ["Learning the mixture online…", function () {
        var hybrid = E.hybridModel(draws, cfg);
        state.results.hybrid = {
          model: hybrid,
          backtest: E.evaluateForecasts(hybrid.prequential, draws, cfg)
        };
      }]
    ];

    state.results = {};
    var i = 0;

    function fail(err) {
      el.verdictHost.hidden = false;
      el.verdictHost.innerHTML =
        '<div class="card"><div class="callout is-danger"><strong>Analysis failed.</strong> ' +
        esc(err && err.message ? err.message : String(err)) +
        "</div></div>";
      if (window.console) console.error(err);
      done();
    }

    function done() {
      state.running = false;
      btn.disabled = false;
      btn.textContent = "Run analysis";
      showProgress("");
    }

    function tick() {
      if (i >= stages.length) {
        try {
          var recommend =
            state.diag.mode === "pattern" ? "analytic"
            : state.diag.mode === "mixed" ? "hybrid"
            : "stochastic";
          state.recommended = recommend;
          state.tool = recommend;
          // Monte Carlo next-draw simulation from the recommended model.
          var probs = E.scorerFor(recommend, cfg, state.stochasticOpts)(draws);
          state.predProbs = probs;
          state.predMC = E.predictionMonteCarlo(probs, cfg, { seed: state.mcSeed });
          state.predTool = recommend;
          render();
          persist();
        } catch (err) {
          return fail(err);
        }
        return done();
      }
      var stage = stages[i++];
      btn.textContent = "Analysing…";
      showProgress(stage[0]);
      setTimeout(function () {
        try {
          stage[1]();
        } catch (err) {
          return fail(err);
        }
        tick();
      }, 16);
    }

    setTimeout(tick, 16);
  }

  function showProgress(text) {
    var host = el.detectHint;
    if (!host) return;
    if (!text) {
      host.innerHTML = host.getAttribute("data-prev") || "";
      host.removeAttribute("data-prev");
      return;
    }
    if (!host.hasAttribute("data-prev")) host.setAttribute("data-prev", host.innerHTML);
    host.innerHTML = '<span class="spinner-note"><i class="spinner"></i>' + esc(text) + "</span>";
  }

  function render() {
    renderVerdict();
    el.toolSection.hidden = false;
    renderAnalytic();
    renderStochastic();
    renderHybrid();
    selectTool(state.tool);
    renderPredictionMC();
    $("btnExport").disabled = false;
  }

  // Monte Carlo next-draw card sits below the tool panels and reflects the
  // currently selected tool's model.
  function renderPredictionMC() {
    var host = $("predictionHost");
    if (!host) return;
    if (!state.predMC || !state.predProbs) { host.hidden = true; host.innerHTML = ""; return; }
    host.hidden = false;
    // Animated build by default; static summary if reduced-motion is preferred.
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      host.innerHTML = predictionMonteCarloCard();
      var btn = $("btnResim");
      if (btn) btn.addEventListener("click", resimulate);
    } else {
      startPredictionAnimation(host);
    }
  }

  function resimulate() {
    if (!state.parsed || !state.parsed.draws.length) return;
    state.mcSeed = (state.mcSeed * 1664525 + 1013904223) >>> 0;
    var draws = state.parsed.draws;
    var cfg = state.config;
    state.envelope = E.monteCarloEnvelope(draws, cfg, { seed: state.mcSeed });
    var probs = E.scorerFor(state.predTool || state.recommended || "stochastic", cfg, state.stochasticOpts)(draws);
    state.predProbs = probs;
    state.predMC = E.predictionMonteCarlo(probs, cfg, { seed: state.mcSeed });
    renderStochastic();
    renderPredictionMC();
  }

  /* ---------------- verdict ---------------- */

  var MODE_COPY = {
    pattern: {
      icon: "&#9673;",
      title: "Pattern detected",
      tool: "Tool 1 — analytic derivation",
      body:
        "A closed-form recurrence reproduces draws it was never fitted on. This series is not " +
        "behaving like a chance mechanism."
    },
    random: {
      icon: "&#9678;",
      title: "No pattern detected",
      tool: "Tool 2 — stochastic recurrence model",
      body:
        "Every structure in this history is within the range random data produces by chance. " +
        "The honest model describes recurrence frequency, not a law."
    },
    mixed: {
      icon: "&#9680;",
      title: "Mixed pattern",
      tool: "Tool 3 — hybrid ensemble",
      body:
        "Some components deviate from the null while the rest look exchangeable. A single " +
        "explanation would be wrong in one direction or the other."
    },
    insufficient: {
      icon: "&#9888;",
      title: "Not enough data",
      tool: "Collect more draws",
      body:
        "With this few observations almost any hypothesis fits. Any 'law' found here would be " +
        "an artefact of small samples."
    }
  };

  function renderVerdict() {
    var d = state.diag;
    var c = MODE_COPY[d.mode] || MODE_COPY.random;
    el.verdictHost.hidden = false;
    el.verdictHost.innerHTML =
      '<div class="verdict mode-' + d.mode + '">' +
        '<div class="verdict-badge">' + c.icon + "</div>" +
        "<div>" +
          "<h2>" + c.title + "</h2>" +
          "<p>" + c.body + "</p>" +
        "</div>" +
        '<div class="verdict-cta">' +
          '<span class="tag">' + esc(c.tool) + "</span>" +
          '<span class="hint">' + state.parsed.draws.length + " draws · " +
            state.config.picks + "/" + state.config.poolSize + "</span>" +
        "</div>" +
      "</div>" +
      '<div class="card" style="margin-top:16px">' +
        '<div class="card-head"><div><h3>Evidence behind the routing</h3>' +
        "<p>Five independent checks against exchangeable sampling without replacement.</p></div></div>" +
        '<div class="grid-3">' + diagnosticCards(d) + "</div>" +
      "</div>" +
      structureTestsCard();
  }

  function diagnosticCards(d) {
    var q = state.config.picks / state.config.poolSize;
    var cards = [];

    cards.push(metric(
      "Frequency goodness-of-fit",
      "χ² = " + d.chi.stat.toFixed(1),
      "p = " + fmtP(d.chi.p) + " on " + d.chi.df + " df" +
        (d.chi.p < 0.05 ? " — counts are uneven" : " — consistent with uniform"),
      d.chi.p < 0.05 ? "is-warn" : "is-good"
    ));

    cards.push(metric(
      "Numbers off the null (FDR 5%)",
      String(d.perNumber.fdr.survivors.length),
      d.perNumber.fdr.survivors.length
        ? "survive multiplicity correction"
        : "none survive — expected for fair draws",
      d.perNumber.fdr.survivors.length ? "is-warn" : "is-good"
    ));

    cards.push(metric(
      "Serial dependence (lag 1)",
      d.autocorrelation.lag1.toFixed(3),
      "z = " + d.autocorrelation.z.toFixed(2) +
        (Math.abs(d.autocorrelation.z) > 2 ? " — draws are not independent" : " — no memory detected"),
      Math.abs(d.autocorrelation.z) > 2 ? "is-warn" : "is-good"
    ));

    cards.push(metric(
      "Stationarity (first vs second half)",
      d.stationarity.testable ? "p = " + fmtP(d.stationarity.p) : "n/a",
      d.stationarity.testable
        ? d.stationarity.p < 0.05
          ? "the mechanism changed over time"
          : "no regime change detected"
        : "needs at least 16 draws",
      d.stationarity.testable && d.stationarity.p < 0.05 ? "is-warn" : "is-good"
    ));

    cards.push(metric(
      "Entropy ratio",
      d.entropyRatio.toFixed(4),
      d.entropyRatio > 0.985 ? "near-maximal — looks unstructured" : "below maximal — mass is concentrated",
      d.entropyRatio > 0.985 ? "is-good" : "is-warn"
    ));

    cards.push(metric(
      "Mean recurrence gap",
      d.gaps.observedMean ? d.gaps.observedMean.toFixed(1) : "—",
      "theory 1/q = " + (1 / q).toFixed(1) + " draws" +
        (d.gaps.n ? " (" + d.gaps.n + " intervals)" : ""),
      "is-good"
    ));

    return cards.join("");
  }

  /* ------- ported structure & randomness battery (from the prototype) ------- */

  function structureTestsCard() {
    var t = state.tests;
    if (!t) return "";
    var tiles = [];

    if (t.runs && t.runs.testable) {
      tiles.push(metric(
        "Runs test (clustering)",
        "z = " + t.runs.z.toFixed(2),
        t.runs.runs + " runs vs " + t.runs.expected.toFixed(1) + " expected · p = " + fmtP(t.runs.p) +
          (t.runs.p < 0.05 ? " — values cluster in time" : " — no clustering"),
        t.runs.p < 0.05 ? "is-warn" : "is-good"
      ));
    }
    if (t.ks && t.ks.testable) {
      tiles.push(metric(
        "KS test vs uniform",
        "D = " + t.ks.stat.toFixed(3),
        "p = " + fmtP(t.ks.p) + (t.ks.p < 0.05 ? " — distribution is not uniform" : " — consistent with uniform"),
        t.ks.p < 0.05 ? "is-warn" : "is-good"
      ));
    }
    if (t.spectral && t.spectral.testable) {
      tiles.push(metric(
        "Spectral concentration",
        (t.spectral.concentration * 100).toFixed(1) + "%",
        (t.spectral.dominantPeriod ? "top period ≈ " + t.spectral.dominantPeriod.toFixed(1) + " draws · " : "") +
          (t.spectral.concentration > 0.6 ? "a dominant cycle is present" : "flat spectrum — no dominant cycle"),
        t.spectral.concentration > 0.6 ? "is-warn" : "is-good"
      ));
    }

    var poissonNote = "";
    if (t.poisson) {
      var ex = t.poisson.mostExtreme && t.poisson.mostExtreme.length ? t.poisson.mostExtreme[0] : null;
      poissonNote =
        '<p class="footnote" style="margin-top:14px"><strong>Poisson recurrence check.</strong> ' +
        "Each number is expected about " + t.poisson.lambda.toFixed(1) + " times in " + t.poisson.draws +
        " draws. The single most extreme number (" + (ex ? ex.number : "—") + ", seen " +
        (ex ? ex.count : "—") + "×) has tail probability p ≈ " + (ex ? fmtP(ex.pGe) : "—") +
        "; with " + state.config.poolSize + " numbers the honest significance line is p &lt; " +
        fmtP(t.poisson.bonferroni) + ". A single 'hot' or 'overdue' number almost never clears it." +
        "</p>";
    }

    if (!tiles.length && !poissonNote) return "";
    return (
      '<div class="card" style="margin-top:16px">' +
        '<div class="card-head"><div><h3>Structure &amp; randomness battery</h3>' +
        "<p>Independent checks on how random the series itself is — ported from the prototype. " +
        "These judge structure, never predict a next draw.</p></div></div>" +
        (tiles.length ? '<div class="grid-3">' + tiles.join("") + "</div>" : "") +
        poissonNote +
      "</div>"
    );
  }

  function metric(label, value, note, cls) {
    return (
      '<div class="metric ' + (cls || "") + '">' +
      "<span>" + esc(label) + "</span>" +
      "<strong>" + value + "</strong>" +
      "<small>" + esc(note) + "</small>" +
      "</div>"
    );
  }

  /* ---------------- tool switching ---------------- */

  function selectTool(tool) {
    state.tool = tool;
    // Keep the Monte Carlo next-draw simulation on the selected tool's model.
    if (state.parsed && state.parsed.draws.length && state.results[tool]) {
      var cfg = state.config;
      var probs = E.scorerFor(tool, cfg, state.stochasticOpts)(state.parsed.draws);
      state.predProbs = probs;
      state.predMC = E.predictionMonteCarlo(probs, cfg, { seed: state.mcSeed });
      state.predTool = tool;
    }
    Array.prototype.forEach.call(document.querySelectorAll(".tool-tab"), function (t) {
      var on = t.getAttribute("data-tool") === tool;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    Object.keys(el.panels).forEach(function (k) {
      el.panels[k].hidden = k !== tool;
      el.panels[k].classList.toggle("is-active", k === tool);
    });
    // Recommendation flags
    Array.prototype.forEach.call(document.querySelectorAll("[data-flag]"), function (f) {
      var key = f.getAttribute("data-flag");
      var r = state.results[key];
      var isRec = state.recommended === key;
      f.classList.toggle("is-recommended", isRec);
      if (isRec) {
        f.textContent = "Recommended";
      } else if (r && r.backtest && r.backtest.testable) {
        f.textContent = r.backtest.beatsChance ? "Beats chance" : "No edge found";
      } else {
        f.textContent = "Available";
      }
    });
    renderPredictionMC();
    persist();
  }

  /* ---------------- Tool 1: analytic ---------------- */

  function renderAnalytic() {
    var r = state.results.analytic;
    var m = r.model;
    var bt = r.backtest;
    var html = "";

    if (m.verdict === "insufficient") {
      html = card("Analytic derivation", "", '<div class="empty-state">Need at least 6 draws to attempt a derivation.</div>');
      el.panels.analytic.innerHTML = html;
      return;
    }

    if (!m.best) {
      html += card(
        "No law survived validation",
        "The restricted hypothesis class was searched exhaustively.",
        '<div class="callout is-warn"><strong>This is a real result, not a failure.</strong> ' +
          "Every candidate recurrence either failed to fit the training prefix or fit it and then " +
          "collapsed on the held-out draws. A law that cannot predict unseen observations is " +
          "curve-fitting, and the lab refuses to report it." +
        "</div>" +
        '<div class="stack" style="margin-top:16px">' +
          "<h4 style=\"font-size:0.85rem\">Closest candidates (all rejected)</h4>" +
          candidateTable(m.candidates.slice(0, 6)) +
        "</div>"
      );
    } else {
      var law = m.best;
      html += card(
        m.verdict === "exact-law" ? "Law derived and validated" : "Partial law derived",
        "Selected by minimum description length among candidates that survived out-of-sample validation.",
        '<div class="formula">' + esc(law.formula) + "</div>" +
        '<p class="hint" style="margin-top:10px">Applies to: <strong>' + esc(law.seriesName) + "</strong></p>" +
        '<div class="grid-3" style="margin-top:16px">' +
          metric("Training accuracy", pct(law.trainAccuracy), law.trainTotal + " transitions fitted", "") +
          metric("Held-out accuracy", pct(law.valAccuracy), law.valTotal + " transitions never seen during fitting",
            law.valAccuracy >= 0.85 ? "is-good" : "is-warn") +
          metric("Description length", law.descriptionBits.toFixed(1) + " bits", "lower is simpler", "") +
        "</div>" +
        (m.positionLaws && m.positionLaws.admissible
          ? '<div class="stack" style="margin-top:20px">' +
              "<h4 style=\"font-size:0.85rem\">Deterministic prediction for the next draw</h4>" +
              '<div class="prediction-row">' +
                m.positionLaws.prediction.map(function (n) {
                  return '<div class="pred-ball is-law">' + n + "</div>";
                }).join("") +
              "</div>" +
              '<p class="hint">Every ascending position carries its own validated law ' +
                "(mean held-out accuracy " + pct(m.positionLaws.meanValAccuracy) + "). " +
                "Reported as a probabilistic forecast, not a certainty.</p>" +
            "</div>"
          : '<div class="callout" style="margin-top:16px">A law was found for one series, but not ' +
            "for every position, so a complete next-draw reconstruction is not available.</div>") +
        '<div class="stack" style="margin-top:20px">' +
          "<h4 style=\"font-size:0.85rem\">All surviving candidates</h4>" +
          candidateTable(m.survivors.slice(0, 8)) +
        "</div>"
      );
    }

    html += backtestCard(bt, "analytic");
    html += card(
      "Hypothesis class",
      "The search space is deliberately small — that restriction is what makes a positive result meaningful.",
      '<div class="grid-2">' +
        hypoNote("Constant", "x&#8345; = c") +
        hypoNote("Arithmetic progression", "x&#8345; = (x&#8345;&#8331;&#8321; + d) mod M") +
        hypoNote("Affine recurrence", "x&#8345; = (a·x&#8345;&#8331;&#8321; + b) mod M") +
        hypoNote("Second-order linear", "x&#8345; = (a·x&#8345;&#8331;&#8321; + b·x&#8345;&#8331;&#8322; + c) mod M") +
        hypoNote("Periodic cycle", "x&#8345; = x&#8345;&#8331;&#8346;") +
        hypoNote("Polynomial in n", "&#916;&#7496;x&#8345; = const") +
      "</div>"
    );

    el.panels.analytic.innerHTML = html;
  }

  function hypoNote(name, formula) {
    return (
      '<div class="metric"><span>' + esc(name) + "</span>" +
      '<strong style="font-family:var(--mono);font-size:0.86rem">' + formula + "</strong></div>"
    );
  }

  function candidateTable(rows) {
    if (!rows || !rows.length) {
      return '<div class="empty-state">No candidate produced a usable fit.</div>';
    }
    return (
      '<div class="table-wrap"><table><thead><tr>' +
      "<th>Hypothesis</th><th>Series</th><th>Formula</th>" +
      '<th class="num">Train</th><th class="num">Held-out</th><th class="num">Bits</th>' +
      "</tr></thead><tbody>" +
      rows.map(function (c) {
        return (
          "<tr><td>" + esc(c.name) + "</td><td>" + esc(c.seriesName) + "</td>" +
          '<td style="font-family:var(--mono);font-size:0.78rem">' + esc(c.formula) + "</td>" +
          '<td class="num">' + pct(c.trainAccuracy) + "</td>" +
          '<td class="num">' + pct(c.valAccuracy) + "</td>" +
          '<td class="num">' + c.descriptionBits.toFixed(0) + "</td></tr>"
        );
      }).join("") +
      "</tbody></table></div>"
    );
  }

  /* ---------------- Tool 2: stochastic ---------------- */

  function renderStochastic() {
    var r = state.results.stochastic;
    var m = r.model;
    var bt = r.backtest;
    var q = state.config.picks / state.config.poolSize;

    var controls =
      '<div class="grid-2">' +
        '<div class="slider-row">' +
          '<div class="row-between"><label for="optPrior">Prior strength (pseudo-draws)</label>' +
          '<output id="outPrior">' + state.stochasticOpts.priorStrength + "</output></div>" +
          '<input type="range" id="optPrior" min="0" max="200" step="5" value="' +
            state.stochasticOpts.priorStrength + '">' +
          '<p class="hint">How much belief in a fair mechanism the data must overcome. ' +
            "Currently shrinking observed rates " + pct(m.shrinkage) + " toward q.</p>" +
        "</div>" +
        '<div class="slider-row">' +
          '<div class="row-between"><label for="optDecay">Memory (EWMA decay λ)</label>' +
          '<output id="outDecay">' + state.stochasticOpts.decay.toFixed(2) + "</output></div>" +
          '<input type="range" id="optDecay" min="0.80" max="1.00" step="0.01" value="' +
            state.stochasticOpts.decay + '">' +
          '<p class="hint">λ = 1.00 assumes a stationary process. Below 1 discounts old draws, ' +
            "which is the right move only if the mechanism genuinely drifts.</p>" +
        "</div>" +
      "</div>";

    var head =
      '<div class="grid-3">' +
        metric("Draws observed", String(m.summary.D), "expected " + m.summary.expectedCount.toFixed(1) + " hits per number", "") +
        metric("Numbers beyond the null", String(m.significantCount),
          m.significantCount ? "after Benjamini-Hochberg FDR control" : "no number deviates once multiplicity is handled",
          m.significantCount ? "is-warn" : "is-good") +
        metric("Posterior shrinkage", pct(m.shrinkage), "weight still held by the prior", "") +
      "</div>";

    var rows = m.ranked.slice(0, 15).map(function (row) {
      var cls = row.significant ? "is-hot" : row.lift < 0.9 ? "is-cold" : "";
      return (
        "<tr>" +
        '<td><span class="ball ' + cls + '">' + row.number + "</span></td>" +
        '<td class="num">' + row.count + "</td>" +
        '<td class="num">' + row.expected.toFixed(1) + "</td>" +
        '<td class="num">' + (row.posteriorMean * 100).toFixed(2) + "%</td>" +
        '<td class="num">[' + (row.ci[0] * 100).toFixed(2) + ", " + (row.ci[1] * 100).toFixed(2) + "]</td>" +
        '<td class="num">' + row.lift.toFixed(2) + "×</td>" +
        '<td class="num">' + row.currentGap + "</td>" +
        '<td class="num">' + fmtP(row.p) + "</td>" +
        '<td><span class="tag ' + (row.significant ? "is-sig" : "is-null") + '">' +
          (row.significant ? "deviates" : "null") + "</span></td>" +
        "</tr>"
      );
    }).join("");

    var table =
      '<div class="table-wrap"><table><thead><tr>' +
      "<th>Number</th>" +
      '<th class="num">Seen</th><th class="num">Expected</th>' +
      '<th class="num">Posterior rate</th><th class="num">95% CI</th>' +
      '<th class="num">Lift</th><th class="num">Gap</th><th class="num">p</th><th>Verdict</th>' +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>";

    var gapCard = card(
      "Recurrence intervals",
      "Under a memoryless mechanism the waiting time between appearances is geometric with mean 1/q = " +
        (1 / q).toFixed(1) + " draws.",
      histogram(state.diag.gaps.all, 1 / q) +
      '<div class="callout is-warn" style="margin-top:14px"><strong>The gambler\'s fallacy, quantified.</strong> ' +
        "A number absent for " + Math.max.apply(null, m.rows.map(function (x) { return x.currentGap; })) +
        " draws is no more likely to appear next: the hazard rate stays flat at q = " + (q * 100).toFixed(2) +
        "% regardless of history. Any 'due number' logic is reading structure into memorylessness.</div>"
    );

    el.panels.stochastic.innerHTML =
      card("Stochastic recurrence model",
        "Beta-Binomial posterior per number, prior centred on the hypergeometric rate q = k/N.",
        controls + head) +
      card("Per-number posterior", "Ranked by predictive probability for the next draw. Top 15 shown.", table) +
      monteCarloEnvelopeCard() +
      gapCard +
      backtestCard(bt, "stochastic");

    // Kick off the animated envelope if the shell is present (skipped for
    // reduced-motion, which renders the static final card instead).
    if (el.panels.stochastic.querySelector && el.panels.stochastic.querySelector("#envChartWrap")) {
      startEnvelopeAnimation(el.panels.stochastic);
    }

    var p = $("optPrior");
    var dsl = $("optDecay");
    if (p) {
      p.addEventListener("input", function () { $("outPrior").textContent = p.value; });
      p.addEventListener("change", function () {
        state.stochasticOpts.priorStrength = Number(p.value);
        recomputeStochastic();
      });
    }
    if (dsl) {
      dsl.addEventListener("input", function () { $("outDecay").textContent = Number(dsl.value).toFixed(2); });
      dsl.addEventListener("change", function () {
        state.stochasticOpts.decay = Number(dsl.value);
        recomputeStochastic();
      });
    }
  }

  function recomputeStochastic() {
    var draws = state.parsed.draws;
    var cfg = state.config;
    state.results.stochastic = {
      model: E.stochasticModel(draws, cfg, state.stochasticOpts),
      backtest: E.backtest(draws, cfg, E.scorerFor("stochastic", cfg, state.stochasticOpts))
    };
    renderStochastic();
    persist();
  }

  /* ---------------- Tool 3: hybrid ---------------- */

  function renderHybrid() {
    var r = state.results.hybrid;
    var m = r.model;
    var bt = r.backtest;

    if (!m.rounds) {
      el.panels.hybrid.innerHTML = card(
        "Hybrid ensemble",
        "",
        '<div class="empty-state">Not enough draws to run the online mixture. Add more observations.</div>'
      );
      return;
    }

    var expertRows = m.experts.map(function (e) {
      return (
        "<tr><td><strong>" + esc(e.name) + "</strong><br>" +
        '<span class="hint">' + esc(e.note) + "</span></td>" +
        '<td class="num">' + pct(e.weight) + "</td>" +
        '<td class="num">' + (e.meanLoss == null ? "—" : e.meanLoss.toFixed(4)) + "</td>" +
        "<td>" + weightBar(e.weight) + "</td></tr>"
      );
    }).join("");

    var structure = m.structureShare;
    var interpretation =
      structure > 0.6
        ? "The mixture has moved decisively onto the analytic channel: this series is mostly law."
        : structure < 0.15
        ? "The mixture keeps almost no weight on the analytic channel: this series is mostly chance."
        : "Weight is genuinely split. Part of this series is structured and part is noise — which is " +
          "exactly the case a single-explanation model gets wrong.";

    var top = m.ranked.slice(0, state.config.picks);

    el.panels.hybrid.innerHTML =
      card("Hybrid ensemble",
        "Four experts compete under log loss; multiplicative weights (Hedge) learn the mixture online. " +
          "The learned weights are the finding.",
        '<div class="grid-3">' +
          metric("Structure share", pct(structure), "weight on the analytic channel",
            structure > 0.5 ? "is-warn" : "is-good") +
          metric("Chance share", pct(m.noiseShare), "weight on null + frequency + adaptive", "") +
          metric("Online rounds", String(m.rounds), "sequential predict-then-update steps", "") +
        "</div>" +
        '<div class="callout" style="margin-top:16px">' + esc(interpretation) + "</div>") +
      card("Expert weights", "Learned from sequential prediction, not from goodness of fit.",
        '<div class="table-wrap"><table><thead><tr><th>Expert</th>' +
        '<th class="num">Weight</th><th class="num">Mean log loss</th><th style="width:34%">Share</th>' +
        "</tr></thead><tbody>" + expertRows + "</tbody></table></div>") +
      card("Weight trajectory", "How belief moved as each new draw arrived.",
        trajectoryChart(m) +
        '<div class="legend" style="margin-top:10px">' +
          m.experts.map(function (e, i) {
            return '<span><i class="swatch" style="background:' + EXPERT_COLORS[i] + '"></i>' + esc(e.name) + "</span>";
          }).join("") +
        "</div>") +
      card("Blended forecast", "Top " + state.config.picks + " numbers by mixture probability for the next draw.",
        '<div class="prediction-row">' +
          top.map(function (t) {
            return '<div class="pred-ball is-hybrid">' + t.number + "</div>";
          }).join("") +
        "</div>" +
        '<p class="hint" style="margin-top:12px">Highest mixture probability ' +
          (top[0].probability * 100).toFixed(2) + "% versus null " +
          ((state.config.picks / state.config.poolSize) * 100).toFixed(2) + "% (" +
          top[0].lift.toFixed(2) + "× lift). " +
          (Math.abs(top[0].lift - 1) < 0.15
            ? "That is within noise — treat this as a ranking, not an edge."
            : "") +
        "</p>") +
      backtestCard(bt, "hybrid");
  }

  var EXPERT_COLORS = ["#8b99ad", "#0b65d8", "#f59e0b", "#7c5cf0"];

  function weightBar(w) {
    return (
      '<div style="height:8px;border-radius:99px;background:var(--surface-soft);overflow:hidden">' +
      '<div style="height:100%;width:' + (w * 100).toFixed(1) +
      '%;background:var(--blue);border-radius:99px"></div></div>'
    );
  }

  function trajectoryChart(m) {
    var traj = m.trajectory;
    if (!traj.length) return "";
    var W = 720, H = 200, pad = 28;
    var n = traj.length;
    var paths = m.experts.map(function (e, j) {
      var pts = traj.map(function (p, i) {
        var x = pad + (i / Math.max(1, n - 1)) * (W - pad * 2);
        var y = H - pad - p.weights[j] * (H - pad * 2);
        return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      }).join(" ");
      return '<path d="' + pts + '" fill="none" stroke="' + EXPERT_COLORS[j] + '" stroke-width="2.2" />';
    }).join("");

    return (
      '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Expert weight trajectory">' +
      '<line x1="' + pad + '" y1="' + (H - pad) + '" x2="' + (W - pad) + '" y2="' + (H - pad) + '" stroke="#dce4ef"/>' +
      '<line x1="' + pad + '" y1="' + pad + '" x2="' + pad + '" y2="' + (H - pad) + '" stroke="#dce4ef"/>' +
      '<text x="' + (pad - 6) + '" y="' + (pad + 4) + '" text-anchor="end" font-size="10" fill="#8b99ad">1.0</text>' +
      '<text x="' + (pad - 6) + '" y="' + (H - pad) + '" text-anchor="end" font-size="10" fill="#8b99ad">0</text>' +
      '<text x="' + (W / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="#8b99ad">draw index</text>' +
      paths +
      "</svg>"
    );
  }

  /* ---------------- Monte Carlo: observed vs expected ---------------- */

  var envelopeAnim = { raf: null };

  function monteCarloEnvelopeCard() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return monteCarloEnvelopeStatic();
    }
    return monteCarloEnvelopeAnimatedShell();
  }

  // Static (final-state) envelope card — used for reduced-motion.
  function monteCarloEnvelopeStatic() {
    var env = state.envelope;
    if (!env) return "";
    var interp = env.outsideCount <= Math.ceil(env.expectedOutside * 2)
      ? '<div class="callout is-good"><strong>Consistent with chance.</strong> ' +
        env.outsideCount + " of " + env.rows.length + " numbers sit outside the " + Math.round(env.level * 100) +
        "% Monte Carlo envelope — about what a fair mechanism throws off by luck (~" +
        env.expectedOutside.toFixed(1) + ")." + "</div>"
      : '<div class="callout is-warn"><strong>More structure than chance explains.</strong> ' +
        env.outsideCount + " of " + env.rows.length + " numbers sit outside the " + Math.round(env.level * 100) +
        "% envelope, well beyond the ~" + env.expectedOutside.toFixed(1) + " expected from a fair mechanism. " +
        "The mechanism is unlikely to be uniform.</div>";

    return card(
      "Observed vs expected — Monte Carlo envelope",
      env.replicates.toLocaleString() + " null replications of " + env.draws + " draws of " +
        state.config.picks + " from " + state.config.poolSize + ". Bars are observed counts; " +
        "the band is the " + Math.round(env.level * 100) + "% envelope chance produces.",
      envelopeChart(env) +
      '<div class="legend" style="margin-top:8px">' +
        '<span><i class="swatch" style="background:#0b65d8"></i>observed count</span>' +
        '<span><i class="swatch" style="background:#e65f6a"></i>outside envelope</span>' +
        '<span><i class="swatch" style="background:#c9d4e4"></i>' + Math.round(env.level * 100) + "% envelope</span>" +
      "</div>" +
      '<div style="margin-top:14px">' + interp + "</div>"
    );
  }

  // Shell the animator fills in live.
  function monteCarloEnvelopeAnimatedShell() {
    var env = state.envelope;
    var reps = env ? env.replicates : 1000;
    return card(
      "Observed vs expected — Monte Carlo envelope",
      "Null replications of " + (env ? env.draws : state.parsed.draws.length) + " draws of " +
        state.config.picks + " from " + state.config.poolSize + ", building live. Bars are observed counts; " +
        "the band is the 95% envelope chance produces.",
      '<div class="row-between" style="margin-bottom:14px;gap:16px">' +
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
          '<button class="primary-button" type="button" id="envPlay">Replay</button>' +
          '<span class="hint" id="envCount">0 replications</span>' +
        "</div>" +
        '<div class="slider-row" style="min-width:240px;margin:0">' +
          '<div class="row-between"><label for="envReps">Replications</label><output id="envRepsOut">' + reps.toLocaleString() + "</output></div>" +
          '<input type="range" id="envReps" min="200" max="5000" step="100" value="' + reps + '">' +
        "</div>" +
      "</div>" +
      '<div id="envChartWrap"></div>' +
      '<div id="envLive" style="margin-top:14px"></div>'
    );
  }

  function envelopeChart(env) {
    var rows = env.rows;
    var W = 720, H = 220, pad = 34;
    var maxV = Math.max.apply(null, rows.map(function (r) {
      return Math.max(r.observed, r.envelopeHi);
    })) || 1;
    var n = rows.length;
    var bw = (W - pad * 2) / n;
    function y(v) { return H - pad - (v / maxV) * (H - pad * 2); }

    var bands = "";
    var bars = "";
    var labels = "";
    for (var i = 0; i < n; i++) {
      var r = rows[i];
      var x = pad + i * bw;
      var cx = x + bw / 2;
      // envelope band
      bands += '<rect x="' + x.toFixed(1) + '" y="' + y(r.envelopeHi).toFixed(1) +
        '" width="' + Math.max(1, bw - 1).toFixed(1) +
        '" height="' + (y(r.envelopeLo) - y(r.envelopeHi)).toFixed(1) +
        '" fill="#c9d4e4" opacity="0.45"/>';
      // observed bar, red if outside
      var outside = r.observed < r.envelopeLo || r.observed > r.envelopeHi;
      bars += '<rect x="' + (x + bw * 0.2).toFixed(1) + '" y="' + y(r.observed).toFixed(1) +
        '" width="' + Math.max(1, bw * 0.6).toFixed(1) +
        '" height="' + (H - pad - y(r.observed)).toFixed(1) +
        '" fill="' + (outside ? "#e65f6a" : "#0b65d8") + '" rx="1"/>';
      if (n <= 60 && (i % Math.ceil(n / 24) === 0)) {
        labels += '<text x="' + cx.toFixed(1) + '" y="' + (H - pad + 14) +
          '" text-anchor="middle" font-size="8.5" fill="#8b99ad">' + r.number + "</text>";
      }
    }
    var ey = y(env.expectedCount);
    return (
      '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Observed counts vs Monte Carlo envelope">' +
      '<line x1="' + pad + '" y1="' + (H - pad) + '" x2="' + (W - pad) + '" y2="' + (H - pad) + '" stroke="#dce4ef"/>' +
      bands + bars +
      '<line x1="' + pad + '" y1="' + ey.toFixed(1) + '" x2="' + (W - pad) + '" y2="' + ey.toFixed(1) +
        '" stroke="#0a7a55" stroke-dasharray="4 3" stroke-width="1.4"/>' +
      '<text x="' + (W - pad) + '" y="' + (ey - 5).toFixed(1) + '" text-anchor="end" font-size="10" fill="#0a7a55">expected ' +
        env.expectedCount.toFixed(1) + "</text>" +
      labels +
      '<text x="' + (pad - 6) + '" y="' + (pad + 4) + '" text-anchor="end" font-size="10" fill="#8b99ad">' + maxV + "</text>" +
      '<text x="' + (pad - 6) + '" y="' + (H - pad) + '" text-anchor="end" font-size="10" fill="#8b99ad">0</text>' +
      "</svg>"
    );
  }

  /* ------- Animated observed-vs-expected envelope: band + bars build live ------- */

  function startEnvelopeAnimation(panel) {
    if (envelopeAnim.raf) cancelAnimationFrame(envelopeAnim.raf);
    var wrap = panel.querySelector("#envChartWrap");
    var live = panel.querySelector("#envLive");
    var countEl = panel.querySelector("#envCount");
    var repsEl = panel.querySelector("#envReps");
    var repsOut = panel.querySelector("#envRepsOut");
    if (!wrap) return;

    var draws = state.parsed.draws;
    var cfg = state.config;
    var N = cfg.poolSize;
    var k = cfg.picks;
    var D = draws.length;
    var q = k / N;
    var expectedCount = (D * k) / N;
    var s = E.summarize(draws, cfg);
    var observed = s.counts;
    var level = 0.95;
    var loQ = (1 - level) / 2;
    var hiQ = 1 - loQ;

    var R, samplers, rand, done;

    function reset(newReps) {
      R = newReps;
      rand = E.stats.mulberry32(state.mcSeed >>> 0);
      done = 0;
      samplers = [];
      for (var j = 0; j < N; j++) samplers.push(E.reservoirSampler(rand, 384));
    }

    function fmtInt(x) { return x.toLocaleString(); }

    function currentRows() {
      var rows = [];
      for (var i = 0; i < N; i++) {
        rows.push({
          number: i + cfg.poolMin,
          observed: observed[i],
          expected: expectedCount,
          envelopeLo: samplers[i].quantile(loQ),
          envelopeHi: samplers[i].quantile(hiQ)
        });
      }
      return rows;
    }

    function renderFrame(final) {
      var rows = currentRows();
      wrap.innerHTML = envelopeChart({ rows: rows, expectedCount: expectedCount });
      countEl.textContent = fmtInt(done) + " replications";

      var outside = rows.filter(function (r) { return r.observed < r.envelopeLo || r.observed > r.envelopeHi; });
      var expectedOutside = N * (1 - level);
      var consistent = outside.length <= Math.ceil(expectedOutside * 2);

      live.innerHTML =
        '<div class="grid-3">' +
          '<div class="metric ' + (consistent ? "is-good" : "is-warn") + '"><span>Numbers outside the 95% band</span>' +
            "<strong>" + outside.length + "</strong>" +
            "<small>~" + expectedOutside.toFixed(1) + " expected by chance across " + N + " numbers</small></div>" +
          '<div class="metric"><span>Outside numbers</span>' +
            '<strong style="font-size:1rem">' + (outside.length ? outside.map(function (r) { return r.number; }).join(" · ") : "none") + "</strong>" +
            "<small>observed count beyond the envelope</small></div>" +
          '<div class="metric"><span>Expected count / number</span>' +
            "<strong>" + expectedCount.toFixed(1) + "</strong>" +
            "<small>" + D + " draws × " + k + " picks ÷ " + N + " numbers</small></div>" +
        "</div>" +
        (final
          ? consistent
            ? '<div class="callout is-good" style="margin-top:12px"><strong>Settled — consistent with chance.</strong> ' +
              outside.length + " of " + N + " numbers sit outside the 95% envelope after " + fmtInt(done) +
              " replications, about what a fair mechanism throws off by luck.</div>"
            : '<div class="callout is-warn" style="margin-top:12px"><strong>Settled — more structure than chance explains.</strong> ' +
              outside.length + " of " + N + " numbers sit outside the 95% envelope after " + fmtInt(done) +
              " replications, well beyond the ~" + expectedOutside.toFixed(1) + " expected from a fair mechanism.</div>"
          : "");
    }

    function step() {
      var chunk = Math.max(2, Math.floor(R / 160));
      for (var c = 0; c < chunk && done < R; c++) {
        // One null replication: D draws of k from a uniform pool of N, then
        // record the count each number received (0 if it was never picked).
        var repCounts = new Array(N).fill(0);
        var w = new Array(N).fill(1);
        for (var d = 0; d < D; d++) {
          var picked = E.drawWithoutReplacement(rand, w, k);
          for (var p = 0; p < picked.length; p++) repCounts[picked[p]]++;
        }
        for (var nn = 0; nn < N; nn++) samplers[nn].add(repCounts[nn]);
        done++;
      }
      renderFrame(done >= R);
      if (done < R) {
        envelopeAnim.raf = requestAnimationFrame(step);
      } else {
        envelopeAnim.raf = null;
      }
    }

    panel.querySelector("#envPlay").addEventListener("click", function () {
      if (envelopeAnim.raf) cancelAnimationFrame(envelopeAnim.raf);
      reset(R);
      envelopeAnim.raf = requestAnimationFrame(step);
    });
    repsEl.addEventListener("input", function () {
      repsOut.textContent = fmtInt(Number(repsEl.value));
    });
    repsEl.addEventListener("change", function () {
      if (envelopeAnim.raf) cancelAnimationFrame(envelopeAnim.raf);
      reset(Number(repsEl.value));
      envelopeAnim.raf = requestAnimationFrame(step);
    });

    reset(R = state.envelope ? state.envelope.replicates : 1000);
    envelopeAnim.raf = requestAnimationFrame(step);
  }

  /* ---------------- Monte Carlo: prediction pattern + next set ---------------- */

  var predictionAnim = { raf: null };

  function predictionRatesChartSmall(rows, nullRate) {
    var W = 720, H = 180, pad = 30;
    var maxV = Math.max.apply(null, rows.map(function (r) { return r.predictedRate; }).concat([nullRate])) || 1;
    var n = rows.length;
    var bw = (W - pad * 2) / n;
    function y(v) { return H - pad - (v / maxV) * (H - pad * 2); }
    var bars = "";
    for (var i = 0; i < n; i++) {
      var r = rows[i];
      var x = pad + i * bw;
      var lift = nullRate > 0 ? r.predictedRate / nullRate : 1;
      var col = lift > 1.3 ? "#12b981" : lift < 0.7 ? "#e65f6a" : "#0b65d8";
      bars += '<rect x="' + (x + bw * 0.15).toFixed(1) + '" y="' + y(r.predictedRate).toFixed(1) +
        '" width="' + Math.max(1, bw * 0.7).toFixed(1) +
        '" height="' + (H - pad - y(r.predictedRate)).toFixed(1) +
        '" fill="' + col + '" rx="1"><title>' + r.number + ": " + (r.predictedRate * 100).toFixed(1) + "%</title></rect>";
    }
    var qy = y(nullRate);
    return (
      '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Predicted rate per number vs null">' +
      '<line x1="' + pad + '" y1="' + (H - pad) + '" x2="' + (W - pad) + '" y2="' + (H - pad) + '" stroke="#dce4ef"/>' +
      bars +
      '<line x1="' + pad + '" y1="' + qy.toFixed(1) + '" x2="' + (W - pad) + '" y2="' + qy.toFixed(1) +
        '" stroke="#0a7a55" stroke-dasharray="4 3" stroke-width="1.4"/>' +
      '<text x="' + (W - pad) + '" y="' + (qy - 5).toFixed(1) + '" text-anchor="end" font-size="10" fill="#0a7a55">null ' +
        (nullRate * 100).toFixed(1) + "%</text>" +
      '<text x="' + (pad - 6) + '" y="' + (pad + 4) + '" text-anchor="end" font-size="10" fill="#8b99ad">' + (maxV * 100).toFixed(0) + "%</text>" +
      '<text x="' + (pad - 6) + '" y="' + (H - pad) + '" text-anchor="end" font-size="10" fill="#8b99ad">0</text>' +
      "</svg>"
    );
  }

  // Static (final-state) card — used for reduced-motion and as the summary.
  function predictionMonteCarloCard() {
    var mc = state.predMC;
    if (!mc) return "";
    var toolName = { analytic: "Analytic derivation", stochastic: "Stochastic recurrence", hybrid: "Hybrid ensemble" }[state.predTool] || "Model";
    var k = state.config.picks;
    var top = mc.topNumbers;

    var framing =
      mc.concentration > 2
        ? '<div class="callout is-warn"><strong>The model concentrates probability.</strong> Its most likely exact set is ' +
          fmtSmall(mc.modalSetProb) + " — about " + mc.concentration.toFixed(1) + "× the " + fmtSmall(mc.nullSetProb) +
          " a random set carries. That is real structure <em>if the model is right</em>; it is still one set out of " +
          Number(mc.totalSets).toLocaleString(undefined, { maximumFractionDigits: 0 }) + " possible.</div>"
        : '<div class="callout"><strong>The model spreads probability near-evenly.</strong> Its most likely exact set is ' +
          fmtSmall(mc.modalSetProb) + ", close to the " + fmtSmall(mc.nullSetProb) +
          " any random set carries — which is what an honest model says when the mechanism is near-fair. " +
          "No set is meaningfully more likely than another.</div>";

    return card(
      "Next-draw prediction — Monte Carlo",
      mc.replicates.toLocaleString() + " simulated next draws from the " + esc(toolName) +
        " probability vector. A distribution, not a promise.",
      predictionRatesChartSmall(mc.rows, mc.rows[0].nullRate) +
      "<h4 style=\"font-size:0.85rem;margin:18px 0 10px\">Most likely next set (top " + k + " by model probability)</h4>" +
      '<div class="prediction-row">' + mc.modalSet.map(function (n) { return '<div class="pred-ball">' + n + "</div>"; }).join("") + "</div>" +
      '<p class="hint" style="margin-top:12px">Highest per-number rate ' + (top[0].predictedRate * 100).toFixed(1) +
        "% versus null " + (top[0].nullRate * 100).toFixed(1) + "%. " +
        (Math.abs(top[0].lift - 1) < 0.2 ? "Within noise — treat as a ranking, not an edge." : "") + "</p>" +
      '<div style="margin-top:14px">' + framing + "</div>"
    );
  }

  /* ------- Animated next-draw Monte Carlo: bars build as draws accumulate ------- */

  function startPredictionAnimation(host) {
    if (predictionAnim.raf) cancelAnimationFrame(predictionAnim.raf);

    var toolName = { analytic: "Analytic derivation", stochastic: "Stochastic recurrence", hybrid: "Hybrid ensemble" }[state.predTool] || "Model";
    var cfg = state.config;
    var k = cfg.picks;
    var N = cfg.poolSize;
    var q = k / N;

    host.innerHTML = card(
      "Next-draw prediction — Monte Carlo",
      "Simulated next draws from the " + esc(toolName) + " probability vector, building live. A distribution, not a promise.",
      '<div class="row-between" style="margin-bottom:14px;gap:16px">' +
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
          '<button class="primary-button" type="button" id="mcPlay">Replay</button>' +
          '<span class="hint" id="mcCount">0 draws simulated</span>' +
        "</div>" +
        '<div class="slider-row" style="min-width:240px;margin:0">' +
          '<div class="row-between"><label for="mcReps">Replications</label><output id="mcRepsOut">2,000</output></div>' +
          '<input type="range" id="mcReps" min="500" max="10000" step="500" value="2000">' +
        "</div>" +
      "</div>" +
      '<div id="mcChartWrap"></div>' +
      '<div id="mcLive" style="margin-top:14px"></div>'
    );

    var chartWrap = host.querySelector("#mcChartWrap");
    var live = host.querySelector("#mcLive");
    var countEl = host.querySelector("#mcCount");
    var repsEl = host.querySelector("#mcReps");
    var repsOut = host.querySelector("#mcRepsOut");

    var tot = sum(state.predProbs) || k;
    var w = state.predProbs.map(function (p) { return Math.max(0, p / tot); });

    var R, hits, setCounts, drawn, seed, rand;

    function reset(newReps) {
      R = newReps;
      hits = new Array(N).fill(0);
      setCounts = {};
      drawn = 0;
      seed = state.mcSeed;
      rand = E.stats.mulberry32(seed >>> 0);
    }

    function fmtInt(x) { return x.toLocaleString(); }

    function renderFrame(final) {
      // Per-number predicted rate vs null.
      var rows = hits.map(function (h, i) {
        return { number: i + cfg.poolMin, predictedRate: drawn ? h / drawn : 0, nullRate: q };
      });
      chartWrap.innerHTML = predictionRatesChartSmall(rows, q);
      countEl.textContent = fmtInt(drawn) + " draws simulated";

      // Live convergence: modal set + its exact-set probability.
      var bestKey = null, bestCount = 0;
      Object.keys(setCounts).forEach(function (key) {
        if (setCounts[key] > bestCount) { bestCount = setCounts[key]; bestKey = key; }
      });
      var modalSet = bestKey ? bestKey.split(",").map(function (x) { return Number(x) + cfg.poolMin; }) : [];
      var setProb = drawn ? bestCount / drawn : 0;
      var logComb = E.stats.logGamma(N + 1) - E.stats.logGamma(k + 1) - E.stats.logGamma(N - k + 1);
      var nullSetProb = Math.exp(-logComb);
      var concentration = nullSetProb > 0 ? setProb / nullSetProb : 1;

      var balls = modalSet.length
        ? '<div class="prediction-row" style="margin:10px 0">' + modalSet.map(function (n) { return '<div class="pred-ball">' + n + "</div>"; }).join("") + "</div>"
        : '<p class="hint">Waiting for the first complete set…</p>';

      live.innerHTML =
        '<div class="grid-3">' +
          '<div class="metric"><span>Most likely set (so far)</span>' +
            '<strong style="font-size:1rem">' + (modalSet.length ? modalSet.join(" · ") : "—") + "</strong>" +
            "<small>exact-set probability " + fmtSmall(setProb) + "</small></div>" +
          '<div class="metric"><span>Concentration vs null</span>' +
            "<strong>" + (concentration >= 1 ? concentration.toFixed(1) + "×" : "< 1×") + "</strong>" +
            "<small>vs " + fmtSmall(nullSetProb) + " for any set</small></div>" +
          '<div class="metric"><span>Top number rate</span>' +
            "<strong>" + (function () { var t = rows.slice().sort(function (a, b) { return b.predictedRate - a.predictedRate; })[0]; return t ? t.number + " · " + (t.predictedRate * 100).toFixed(1) + "%" : "—"; })() + "</strong>" +
            "<small>null " + (q * 100).toFixed(1) + "%</small></div>" +
        "</div>" + balls +
        (final ? '<div class="callout" style="margin-top:12px"><strong>Settled.</strong> After ' + fmtInt(drawn) +
          " draws the estimate has converged — replications only smooth it now. " +
          (concentration > 2
            ? "The model concentrates real probability on this set (if the model is right)."
            : "Probability stays near-even, which is the honest answer when the mechanism is near-fair.") +
          "</div>" : "");
    }

    function step() {
      // Accumulate a chunk of draws, then paint. Chunk scales to R for pace.
      var chunk = Math.max(5, Math.floor(R / 160));
      for (var c = 0; c < chunk && drawn < R; c++) {
        var picked = E.drawWithoutReplacement(rand, w.slice(), k);
        for (var p = 0; p < picked.length; p++) hits[picked[p]]++;
        drawn++;
        if (picked.length === k) {
          var key = picked.slice().sort(function (a, b) { return a - b; }).join(",");
          setCounts[key] = (setCounts[key] || 0) + 1;
        }
      }
      renderFrame(drawn >= R);
      if (drawn < R) {
        predictionAnim.raf = requestAnimationFrame(step);
      } else {
        predictionAnim.raf = null;
      }
    }

    host.querySelector("#mcPlay").addEventListener("click", function () {
      if (predictionAnim.raf) cancelAnimationFrame(predictionAnim.raf);
      reset(R);
      predictionAnim.raf = requestAnimationFrame(step);
    });
    repsEl.addEventListener("input", function () {
      repsOut.textContent = fmtInt(Number(repsEl.value));
    });
    repsEl.addEventListener("change", function () {
      if (predictionAnim.raf) cancelAnimationFrame(predictionAnim.raf);
      reset(Number(repsEl.value));
      predictionAnim.raf = requestAnimationFrame(step);
    });

    reset(2000);
    predictionAnim.raf = requestAnimationFrame(step);
  }

  function sum(arr) { var t = 0; for (var i = 0; i < arr.length; i++) t += arr[i]; return t; }

  function fmtSmall(p) {
    if (p == null || isNaN(p)) return "—";
    if (p >= 0.01) return (p * 100).toFixed(2) + "%";
    if (p >= 1e-4) return (p * 100).toFixed(3) + "%";
    return p.toExponential(1);
  }

  function histogram(values, expected) {
    if (!values || !values.length) return '<div class="empty-state">No recurrence intervals yet.</div>';
    var max = Math.max.apply(null, values);
    var bins = Math.min(24, Math.max(6, Math.ceil(max / 2)));
    var w = max / bins;
    var counts = new Array(bins).fill(0);
    values.forEach(function (v) {
      counts[Math.min(bins - 1, Math.floor(v / w))]++;
    });
    var peak = Math.max.apply(null, counts) || 1;
    var W = 720, H = 180, pad = 28;
    var bw = (W - pad * 2) / bins;

    var bars = counts.map(function (c, i) {
      var h = (c / peak) * (H - pad * 2);
      return (
        '<rect x="' + (pad + i * bw + 1).toFixed(1) + '" y="' + (H - pad - h).toFixed(1) +
        '" width="' + (bw - 2).toFixed(1) + '" height="' + h.toFixed(1) +
        '" fill="#0b65d8" opacity="0.72" rx="2"/>'
      );
    }).join("");

    // Geometric reference curve.
    var q = 1 / expected;
    var ref = [];
    for (var i = 0; i < bins; i++) {
      var g = i * w + w / 2;
      var dens = Math.pow(1 - q, g - 1) * q * values.length * w;
      var y = H - pad - (dens / peak) * (H - pad * 2);
      ref.push((i ? "L" : "M") + (pad + i * bw + bw / 2).toFixed(1) + " " + Math.max(pad, y).toFixed(1));
    }

    var ex = pad + (expected / max) * (W - pad * 2);
    return (
      '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Distribution of gaps between appearances">' +
      bars +
      '<path d="' + ref.join(" ") + '" fill="none" stroke="#e65f6a" stroke-width="2" stroke-dasharray="4 3"/>' +
      '<line x1="' + ex.toFixed(1) + '" y1="' + pad + '" x2="' + ex.toFixed(1) + '" y2="' + (H - pad) +
        '" stroke="#12b981" stroke-width="1.5"/>' +
      '<text x="' + (ex + 5).toFixed(1) + '" y="' + (pad + 10) + '" font-size="10" fill="#0a7a55">1/q = ' +
        expected.toFixed(1) + "</text>" +
      '<text x="' + (W / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="#8b99ad">draws between appearances</text>' +
      "</svg>" +
      '<div class="legend" style="margin-top:8px">' +
        '<span><i class="swatch" style="background:#0b65d8"></i>observed intervals</span>' +
        '<span><i class="swatch" style="background:#e65f6a"></i>geometric prediction</span>' +
      "</div>"
    );
  }

  /* ---------------- shared: backtest card ---------------- */

  function backtestCard(bt, tool) {
    if (!bt || !bt.testable) {
      return card("Out-of-sample validation", "",
        '<div class="callout is-warn">' + esc(bt && bt.reason ? bt.reason : "Not enough data to validate.") + "</div>");
    }

    var ev = bt.evidence || {};
    var via = [];
    if (ev.logLoss) via.push("log loss (p = " + fmtP(bt.logLossP) + ")");
    if (ev.topK) via.push("top-" + state.config.picks + " hit rate (p = " + fmtP(bt.hitP) + ")");

    var verdict = bt.beatsChance
      ? '<div class="callout is-good"><strong>This model beats the uniform baseline on unseen draws.</strong> ' +
        "Detected by " + via.join(" and ") + ", against a Bonferroni-corrected threshold of 0.025. " +
        "Mean log loss " + bt.meanLogLoss.toFixed(4) + " versus baseline " + bt.baselineLogLoss.toFixed(4) +
        ". The improvement is unlikely to be luck.</div>"
      : '<div class="callout is-danger"><strong>No out-of-sample edge.</strong> ' +
        "Against draws it never saw, this model does not beat simply assuming every number is " +
        "equally likely (log loss p = " + fmtP(bt.logLossP) + ", hit rate p = " + fmtP(bt.hitP) +
        "). Whatever it found in the history does not generalise — " +
        "which is the outcome to expect from a fair mechanism.</div>";

    return card(
      "Out-of-sample validation",
      "Walk-forward: refit on the past, predict the next unseen draw, repeat " + bt.n + " times.",
      verdict +
      '<div class="grid-3" style="margin-top:16px">' +
        metric("Predictive lift", (bt.lift * 100).toFixed(2) + "%",
          "reduction in log loss vs uniform", bt.lift > 0 ? "is-good" : "is-bad") +
        metric("Top-" + state.config.picks + " hits", bt.meanTopKHits.toFixed(2),
          "chance level " + bt.chanceHits.toFixed(2) + " (p = " + fmtP(bt.hitP) + ")",
          bt.meanTopKHits > bt.chanceHits && bt.hitP < 0.05 ? "is-good" : "") +
        metric("Brier score", bt.meanBrier.toFixed(5),
          "baseline " + bt.baselineBrier.toFixed(5) + " — lower is better",
          bt.meanBrier < bt.baselineBrier ? "is-good" : "is-bad") +
      "</div>" +
      hitChart(bt) +
      '<p class="footnote" style="margin-top:12px"><strong>Why this is the only score that counts.</strong> ' +
        "Reproducing history is trivial for a flexible model; the test above is the one the " +
        "principle demands, because each prediction is made against data the model had never seen.</p>"
    );
  }

  function hitChart(bt) {
    var s = bt.hitSeries;
    if (!s || !s.length) return "";
    var W = 720, H = 130, pad = 26;
    var n = s.length;
    var max = Math.max(state.config.picks, Math.max.apply(null, s)) || 1;
    var bw = (W - pad * 2) / n;
    var bars = s.map(function (v, i) {
      var h = (v / max) * (H - pad * 2);
      return '<rect x="' + (pad + i * bw + 0.5).toFixed(1) + '" y="' + (H - pad - h).toFixed(1) +
        '" width="' + Math.max(1, bw - 1).toFixed(1) + '" height="' + h.toFixed(1) +
        '" fill="' + (v > bt.chanceHits ? "#12b981" : "#c9d4e4") + '" rx="1.5"/>';
    }).join("");
    var cy = H - pad - (bt.chanceHits / max) * (H - pad * 2);
    return (
      '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Hits per held-out draw">' +
      bars +
      '<line x1="' + pad + '" y1="' + cy.toFixed(1) + '" x2="' + (W - pad) + '" y2="' + cy.toFixed(1) +
        '" stroke="#e65f6a" stroke-dasharray="4 3" stroke-width="1.5"/>' +
      '<text x="' + (W - pad) + '" y="' + (cy - 5).toFixed(1) + '" text-anchor="end" font-size="10" fill="#b03a45">chance ' +
        bt.chanceHits.toFixed(2) + "</text>" +
      "</svg>" +
      '<p class="chart-caption">Correct numbers inside the model\'s top-' + state.config.picks +
      " for each held-out draw.</p>"
    );
  }

  /* ---------------- helpers ---------------- */

  function card(title, sub, body) {
    return (
      '<div class="card"><div class="card-head"><div><h3>' + esc(title) + "</h3>" +
      (sub ? "<p>" + esc(sub) + "</p>" : "") +
      "</div></div>" + body + "</div>"
    );
  }

  function pct(x) {
    return (x * 100).toFixed(1) + "%";
  }

  function fmtP(p) {
    if (p == null || isNaN(p)) return "—";
    if (p < 1e-4) return p.toExponential(1);
    return p.toFixed(4);
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------------- export ---------------- */

  function exportReport() {
    var d = state.diag;
    var cfg = state.config;
    var L = [];
    var rule = "=".repeat(66);
    L.push(rule);
    L.push("RECURRENCE LAB REPORT");
    L.push(new Date().toISOString());
    L.push(rule, "");
    L.push("DATA");
    L.push("  Draws analysed : " + state.parsed.draws.length);
    L.push("  Rejected rows  : " + state.parsed.rejected.length);
    L.push("  Structure      : " + cfg.picks + " of " + cfg.poolMin + "-" + cfg.poolMax +
      " (N=" + cfg.poolSize + ", q=" + (cfg.picks / cfg.poolSize).toFixed(5) + ")");
    L.push("");
    L.push("VERDICT: " + (MODE_COPY[d.mode] || {}).title);
    L.push("  " + (MODE_COPY[d.mode] || {}).body);
    L.push("");
    L.push("DIAGNOSTICS");
    L.push("  Chi-square GOF      : " + d.chi.stat.toFixed(2) + " (df " + d.chi.df + "), p = " + fmtP(d.chi.p));
    L.push("  Deviating numbers   : " + d.perNumber.fdr.survivors.length + " at FDR 5%");
    L.push("  Lag-1 autocorr      : " + d.autocorrelation.lag1.toFixed(4) + " (z = " + d.autocorrelation.z.toFixed(2) + ")");
    L.push("  Stationarity p      : " + (d.stationarity.testable ? fmtP(d.stationarity.p) : "n/a"));
    L.push("  Entropy ratio       : " + d.entropyRatio.toFixed(4));
    L.push("  Mean gap            : " + (d.gaps.observedMean || 0).toFixed(2) +
      " (theory " + d.gaps.expectedMean.toFixed(2) + ")");
    if (state.tests) {
      var T = state.tests;
      L.push("");
      L.push("STRUCTURE & RANDOMNESS BATTERY");
      if (T.runs && T.runs.testable) L.push("  Runs test           : z = " + T.runs.z.toFixed(2) + ", p = " + fmtP(T.runs.p));
      if (T.ks && T.ks.testable) L.push("  KS vs uniform       : D = " + T.ks.stat.toFixed(3) + ", p = " + fmtP(T.ks.p));
      if (T.spectral && T.spectral.testable) L.push("  Spectral concentration : " + (T.spectral.concentration * 100).toFixed(1) + "%");
      if (T.poisson) L.push("  Poisson lambda      : " + T.poisson.lambda.toFixed(2) + " expected hits per number");
    }
    if (state.envelope) {
      var EN = state.envelope;
      L.push("");
      L.push("MONTE CARLO — OBSERVED vs EXPECTED");
      L.push("  Replications      : " + EN.replicates + " of " + EN.draws + " draws of " + cfg.picks + " from " + cfg.poolSize);
      L.push("  Envelope level    : " + Math.round(EN.level * 100) + "%");
      L.push("  Outside envelope  : " + EN.outsideCount + " of " + EN.rows.length +
        " numbers (~" + EN.expectedOutside.toFixed(1) + " expected by chance)");
      L.push("  Reading           : " + EN.interpretation);
      var flagged = EN.rows.filter(function (r) { return r.outside; }).map(function (r) { return r.number; });
      if (flagged.length) L.push("  Numbers outside   : " + flagged.join(", "));
    }
    if (state.predMC) {
      var MC = state.predMC;
      L.push("");
      L.push("MONTE CARLO — NEXT-DRAW PREDICTION (" + (state.predTool || "model").toUpperCase() + ")");
      L.push("  Simulated draws   : " + MC.replicates);
      L.push("  Most likely set   : " + MC.modalSet.join(", "));
      L.push("  Exact-set prob    : " + fmtSmall(MC.modalSetProb) + "  (any set " + fmtSmall(MC.nullSetProb) + ")");
      L.push("  Concentration     : " + MC.concentration.toFixed(2) + "x the null set probability");
      L.push("  Top numbers       : " + MC.topNumbers.map(function (t) { return t.number; }).join(", "));
    }
    L.push("");

    ["analytic", "stochastic", "hybrid"].forEach(function (k) {
      var r = state.results[k];
      if (!r) return;
      L.push(rule);
      L.push("TOOL: " + k.toUpperCase());
      L.push(rule);
      if (k === "analytic") {
        L.push("  Verdict : " + r.model.verdict);
        if (r.model.best) {
          L.push("  Law     : " + r.model.best.formula);
          L.push("  Series  : " + r.model.best.seriesName);
          L.push("  Held-out accuracy : " + pct(r.model.best.valAccuracy));
        } else {
          L.push("  No law survived out-of-sample validation.");
        }
        if (r.model.positionLaws && r.model.positionLaws.admissible) {
          L.push("  Next-draw reconstruction : " + r.model.positionLaws.prediction.join(", "));
        }
      }
      if (k === "stochastic") {
        L.push("  Prior strength : " + state.stochasticOpts.priorStrength +
          "   decay : " + state.stochasticOpts.decay);
        L.push("  Numbers beyond null (FDR 5%) : " + r.model.significantCount);
        L.push("  Top 10 by posterior probability:");
        r.model.ranked.slice(0, 10).forEach(function (row) {
          L.push("    " + String(row.number).padStart(3) + "  seen " + String(row.count).padStart(3) +
            "  rate " + (row.posteriorMean * 100).toFixed(2) + "%" +
            "  lift " + row.lift.toFixed(2) + "x" +
            "  p " + fmtP(row.p) + (row.significant ? "  *" : ""));
        });
      }
      if (k === "hybrid") {
        L.push("  Learned expert weights:");
        r.model.experts.forEach(function (e) {
          L.push("    " + e.name.padEnd(22) + pct(e.weight).padStart(7) +
            "   mean log loss " + (e.meanLoss == null ? "—" : e.meanLoss.toFixed(4)));
        });
        L.push("  Structure share : " + pct(r.model.structureShare));
      }
      var bt = r.backtest;
      L.push("");
      L.push("  OUT-OF-SAMPLE VALIDATION");
      if (!bt || !bt.testable) {
        L.push("    " + (bt && bt.reason ? bt.reason : "not testable"));
      } else {
        L.push("    Held-out draws  : " + bt.n);
        L.push("    Mean log loss   : " + bt.meanLogLoss.toFixed(4) + "  (baseline " + bt.baselineLogLoss.toFixed(4) + ")");
        L.push("    Predictive lift : " + (bt.lift * 100).toFixed(2) + "%   p = " + fmtP(bt.logLossP));
        L.push("    Top-k hits      : " + bt.meanTopKHits.toFixed(3) + "  (chance " + bt.chanceHits.toFixed(3) + ")");
        L.push("    Top-k hit p     : " + fmtP(bt.hitP));
        L.push("    Beats chance    : " + (bt.beatsChance ? "YES" : "NO") +
          (bt.evidence ? "  (log-loss test " + (bt.evidence.logLoss ? "fired" : "null") +
            ", hit-rate test " + (bt.evidence.topK ? "fired" : "null") + ")" : ""));
      }
      L.push("");
    });

    L.push(rule);
    L.push("GUARDRAILS");
    L.push("  1. Hypothesis class restricted to explicit assumptions about the process.");
    L.push("  2. Conclusions are probabilistic, never certain.");
    L.push("  3. Prior knowledge (sampling without replacement, q = k/N) supplies the");
    L.push("     inductive bias, reducing what must be learned from data.");
    L.push("  4. Models are judged only by prediction of unseen draws.");
    L.push(rule);

    var blob = new Blob([L.join("\n")], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "recurrence-report-" + new Date().toISOString().slice(0, 10) + ".txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------------- persistence ---------------- */

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        text: el.input.value.slice(0, 200000),
        config: state.config,
        tool: state.tool,
        stochasticOpts: state.stochasticOpts
      }));
    } catch (e) { /* quota or private mode - non-fatal */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (s.text) el.input.value = s.text;
      if (s.config) writeConfig(E.normalizeConfig(s.config));
      if (s.stochasticOpts) state.stochasticOpts = s.stochasticOpts;
      if (s.tool) state.tool = s.tool;
    } catch (e) { /* ignore corrupt state */ }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
})();
