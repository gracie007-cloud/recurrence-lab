/*
 * Recurrence Lab — inference engine
 * ---------------------------------
 * Pure, dependency-free inference engine for recurrence analysis of
 * draw-style observations (k picks without replacement from a pool of N).
 *
 * Design contract (the guardrails):
 *   1. The hypothesis class is restricted. Every model here encodes an
 *      explicit assumption about the generating process. Nothing is a
 *      free-form curve fitter.
 *   2. Conclusions are probabilistic, never certain. Every estimate ships
 *      with an interval, a p-value, or an out-of-sample score.
 *   3. Prior knowledge (exchangeability, hypergeometric sampling without
 *      replacement, the Law of Large Numbers) is injected as structure so
 *      the effective complexity that has to be learned from data is small.
 *
 * Nothing in this file touches the DOM.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RecurrenceEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ====================================================================
   * 0. Numerical helpers (special functions, tests, small utilities)
   * ================================================================== */

  var LN2 = Math.LN2;

  function log2(x) {
    return Math.log(x) / LN2;
  }

  function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
  }

  function sum(arr) {
    var t = 0;
    for (var i = 0; i < arr.length; i++) t += arr[i];
    return t;
  }

  function mean(arr) {
    return arr.length ? sum(arr) / arr.length : 0;
  }

  function variance(arr) {
    if (arr.length < 2) return 0;
    var m = mean(arr);
    var t = 0;
    for (var i = 0; i < arr.length; i++) t += (arr[i] - m) * (arr[i] - m);
    return t / (arr.length - 1);
  }

  function range(n) {
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = i;
    return out;
  }

  function mod(a, m) {
    return ((a % m) + m) % m;
  }

  // Log-gamma (Lanczos approximation).
  var LANCZOS = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7
  ];

  function logGamma(z) {
    if (z < 0.5) {
      return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
    }
    z -= 1;
    var x = 0.99999999999980993;
    for (var i = 0; i < LANCZOS.length; i++) x += LANCZOS[i] / (z + i + 1);
    var t = z + LANCZOS.length - 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  // Regularized lower incomplete gamma P(s, x) by series expansion.
  function gammaPSeries(s, x) {
    var ap = s;
    var del = 1 / s;
    var acc = del;
    for (var n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      acc += del;
      if (Math.abs(del) < Math.abs(acc) * 1e-14) break;
    }
    return acc * Math.exp(-x + s * Math.log(x) - logGamma(s));
  }

  // Regularized upper incomplete gamma Q(s, x) by continued fraction.
  function gammaQCF(s, x) {
    var tiny = 1e-300;
    var b = x + 1 - s;
    var c = 1 / tiny;
    var d = 1 / b;
    var h = d;
    for (var i = 1; i <= 500; i++) {
      var an = -i * (i - s);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < tiny) d = tiny;
      c = b + an / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      var del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    return Math.exp(-x + s * Math.log(x) - logGamma(s)) * h;
  }

  function gammaQ(s, x) {
    if (x <= 0) return 1;
    if (x < s + 1) return 1 - gammaPSeries(s, x);
    return gammaQCF(s, x);
  }

  /** Upper-tail p-value of a chi-square statistic. */
  function chiSquareP(stat, df) {
    if (!(df > 0) || !isFinite(stat) || stat <= 0) return 1;
    return clamp(gammaQ(df / 2, stat / 2), 0, 1);
  }

  // Error function (Abramowitz & Stegun 7.1.26).
  function erf(x) {
    var s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y =
      1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
        0.254829592) *
        t *
        Math.exp(-x * x);
    return s * y;
  }

  function normalCdf(z) {
    return 0.5 * (1 + erf(z / Math.SQRT2));
  }

  /** Two-sided normal-approximation p-value for a z score. */
  function twoSidedZP(z) {
    return clamp(2 * (1 - normalCdf(Math.abs(z))), 0, 1);
  }

  // Regularized incomplete beta I_x(a, b) - continued fraction (NR 6.4).
  function betacf(a, b, x) {
    var tiny = 1e-300;
    var qab = a + b;
    var qap = a + 1;
    var qam = a - 1;
    var c = 1;
    var d = 1 - (qab * x) / qap;
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= 300; m++) {
      var m2 = 2 * m;
      var aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      h *= d * c;
      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      var del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-13) break;
    }
    return h;
  }

  function incompleteBeta(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var lbeta =
      logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
    var front = Math.exp(lbeta);
    if (x < (a + 1) / (a + b + 2)) return (front * betacf(a, b, x)) / a;
    return 1 - (Math.exp(
      logGamma(a + b) - logGamma(a) - logGamma(b) + b * Math.log(1 - x) + a * Math.log(x)
    ) *
      betacf(b, a, 1 - x)) /
      b;
  }

  /** Quantile of Beta(a, b) via bisection on the regularized incomplete beta. */
  function betaQuantile(p, a, b) {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    var lo = 0;
    var hi = 1;
    var mid = 0.5;
    for (var i = 0; i < 80; i++) {
      mid = 0.5 * (lo + hi);
      if (incompleteBeta(a, b, mid) < p) lo = mid;
      else hi = mid;
    }
    return mid;
  }

  /**
   * Benjamini-Hochberg false discovery rate control.
   * Returns the indices of hypotheses that survive at level q.
   */
  function benjaminiHochberg(pvalues, q) {
    var idx = pvalues.map(function (p, i) {
      return { p: p, i: i };
    });
    idx.sort(function (u, v) {
      return u.p - v.p;
    });
    var m = idx.length;
    var kMax = -1;
    for (var r = 0; r < m; r++) {
      if (idx[r].p <= ((r + 1) / m) * q) kMax = r;
    }
    var survivors = [];
    for (var s = 0; s <= kMax; s++) survivors.push(idx[s].i);
    return { survivors: survivors, threshold: kMax >= 0 ? idx[kMax].p : 0 };
  }

  /** Deterministic PRNG so generated samples are reproducible. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ====================================================================
   * 1. Configuration + parsing
   * ================================================================== */

  var DEFAULT_CONFIG = {
    poolMin: 1,
    poolMax: 49,
    picks: 6,
    bonusPool: 0, // 0 disables the bonus pool
    bonusPicks: 0
  };

  function normalizeConfig(cfg) {
    var c = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    c.poolMin = Math.max(0, Math.round(c.poolMin));
    c.poolMax = Math.max(c.poolMin + 1, Math.round(c.poolMax));
    c.poolSize = c.poolMax - c.poolMin + 1;
    c.picks = clamp(Math.round(c.picks), 1, c.poolSize);
    c.bonusPool = Math.max(0, Math.round(c.bonusPool));
    c.bonusPicks = c.bonusPool > 0 ? clamp(Math.round(c.bonusPicks), 0, c.bonusPool) : 0;
    return c;
  }

  // Stricter date regex: requires YYYY-MM-DD, YYYY/MM/DD, or D-M-YYYY/D/M/YYYY,
  // but the extracted token must pass calendar validation below.
  var DATE_RE = /^\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/;

  function isRealDate(str) {
    if (!str) return false;
    var m = String(str).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/) ||
            String(str).match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
    if (!m) return false;
    var y = parseInt(m[1] >= 100 ? m[1] : (parseInt(m[1]) < 70 ? "20" + m[1] : "19" + m[1])),
        mo = parseInt(m[2]), d = parseInt(m[3]);
    if (y < 1900 || mo < 1 || mo > 12 || d < 1) return false;
    var daysInMonth = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return d <= daysInMonth[mo - 1];
  }

  /**
   * Parse free-form pasted text into draws.
   * Accepts one draw per line, any separator, optional leading date,
   * optional bonus numbers after a `|` or `+`.
   */
  function parseDraws(text, cfg) {
    var config = normalizeConfig(cfg);
    var lines = String(text || "").split(/\r?\n/);
    var draws = [];
    var issues = [];

    for (var li = 0; li < lines.length; li++) {
      var raw = lines[li];
      var line = raw.trim();
      if (!line || /^[#/;]/.test(line)) continue;

      var date = null;
      var dm = line.match(DATE_RE);
      if (dm) {
        if (isRealDate(dm[1])) {
          date = dm[1];
          line = line.slice(dm[0].length);
        } else {
          // Not a real calendar date; treat as ordinary text (not a date column).
          date = null;
        }
      }

      var parts = line.split(/[|+]/);
      var mainNums = extractInts(parts[0]);
      var bonusNums = parts.length > 1 ? extractInts(parts.slice(1).join(" ")) : [];

      if (!mainNums.length) continue;

      // A leading standalone index column ("12: 4 8 15 ...") is discarded
      // when it makes the row exactly one number too long.
      if (!date && mainNums.length === config.picks + 1 && /^\s*\d+\s*[:.)]/.test(line)) {
        mainNums = mainNums.slice(1);
      }

      var bad = mainNums.filter(function (n) {
        return n < config.poolMin || n > config.poolMax;
      });
      var dupes = new Set(mainNums).size !== mainNums.length;

      var entry = {
        line: li + 1,
        date: date,
        numbers: mainNums.slice().sort(function (a, b) {
          return a - b;
        }),
        raw: mainNums.slice(),
        bonus: bonusNums,
        valid: true,
        notes: []
      };

      if (mainNums.length !== config.picks) {
        entry.valid = false;
        entry.notes.push(mainNums.length + " numbers, expected " + config.picks);
      }
      if (bad.length) {
        entry.valid = false;
        entry.notes.push("out of pool range: " + bad.join(", "));
      }
      if (dupes) {
        entry.valid = false;
        entry.notes.push("repeated number inside a single draw");
      }
      if (!entry.valid) issues.push("Line " + (li + 1) + ": " + entry.notes.join("; "));
      draws.push(entry);
    }

    var valid = draws.filter(function (d) {
      return d.valid;
    });

    // Post-parse: check date ordering and duplicates (descriptive, not validity gate).
    var dateIssues = [];
    var datedOnly = draws.filter(function (d) { return d.date && d.valid; });
    // Detect overall trend (ascending or descending) so we only flag genuinely
    // out-of-order dates, not a legitimately newest-first dataset.
    var asc = 0, desc = 0;
    for (var di0 = 1; di0 < datedOnly.length; di0++) {
      var a = datedOnly[di0 - 1].date, b = datedOnly[di0].date;
      if (a && b) { if (b > a) asc++; else if (b < a) desc++; }
    }
    var trend = asc >= desc ? "asc" : "desc"; // majority direction; ties default asc
    for (var di = 1; di < datedOnly.length; di++) {
      var prev = datedOnly[di - 1].date;
      var cur = datedOnly[di].date;
      if (!prev || !cur) continue;
      if (trend === "asc" && cur < prev) {
        dateIssues.push("Line " + datedOnly[di].line + ": date " + cur + " before previous date " + prev + " (not chronological)");
      } else if (trend === "desc" && cur > prev) {
        dateIssues.push("Line " + datedOnly[di].line + ": date " + cur + " after previous date " + prev + " (breaks newest-first order)");
      }
    }
    var dateSet = {};
    for (var di2 = 0; di2 < datedOnly.length; di2++) {
      var dval = datedOnly[di2].date;
      if (dateSet[dval]) {
        dateIssues.push("Duplicate date " + dval + " at lines " + dateSet[dval] + " and " + datedOnly[di2].line);
      } else {
        dateSet[dval] = datedOnly[di2].line;
      }
    }

    return {
      config: config,
      draws: valid,
      rejected: draws.filter(function (d) {
        return !d.valid;
      }),
      issues: issues.concat(dateIssues),
      total: draws.length,
      dateIssues: dateIssues,
      datedDrawsCount: datedOnly.length
    };
  }

  function extractInts(str) {
    var m = String(str || "").match(/\d+/g);
    return m ? m.map(Number) : [];
  }

  /** Infer pool size and picks-per-draw from raw pasted text. */
  function autoDetectConfig(text) {
    var lines = String(text || "").split(/\r?\n/);
    var counts = {};
    var max = 0;
    var min = Infinity;
    var rows = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || /^[#/;]/.test(line)) continue;
      var dm = line.match(DATE_RE);
      if (dm) line = line.slice(dm[0].length);
      var nums = extractInts(line.split(/[|+]/)[0]);
      if (nums.length < 2) continue;
      rows++;
      counts[nums.length] = (counts[nums.length] || 0) + 1;
      for (var j = 0; j < nums.length; j++) {
        if (nums[j] > max) max = nums[j];
        if (nums[j] < min) min = nums[j];
      }
    }
    if (!rows) return null;
    var picks = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a];
    })[0];
    return normalizeConfig({
      poolMin: min === 0 ? 0 : 1,
      poolMax: max,
      picks: Number(picks)
    });
  }

  /* ====================================================================
   * 2. Summary statistics over a draw history
   * ================================================================== */

  function summarize(draws, config) {
    var N = config.poolSize;
    var counts = new Array(N).fill(0);
    var lastSeen = new Array(N).fill(-1);
    var gaps = [];
    for (var i = 0; i < N; i++) gaps.push([]);

    for (var t = 0; t < draws.length; t++) {
      var nums = draws[t].numbers;
      for (var j = 0; j < nums.length; j++) {
        var idx = nums[j] - config.poolMin;
        counts[idx]++;
        if (lastSeen[idx] >= 0) gaps[idx].push(t - lastSeen[idx]);
        lastSeen[idx] = t;
      }
    }

    var currentGap = lastSeen.map(function (t) {
      return t < 0 ? draws.length : draws.length - 1 - t;
    });

    return {
      N: N,
      D: draws.length,
      k: config.picks,
      counts: counts,
      lastSeen: lastSeen,
      currentGap: currentGap,
      gaps: gaps,
      expectedCount: (draws.length * config.picks) / N,
      sums: draws.map(function (d) {
        return sum(d.numbers);
      })
    };
  }

  function label(idx, config) {
    return idx + config.poolMin;
  }

  /* ====================================================================
   * 3. Signal detector - which of the three tools does the data justify?
   * ================================================================== */

  /**
   * Runs the guardrail diagnostics: is the observed recurrence structure
   * distinguishable from exchangeable sampling without replacement?
   */
  function diagnostics(draws, config) {
    var s = summarize(draws, config);
    var N = s.N;
    var D = s.D;
    var k = s.k;
    var q = k / N; // per-draw appearance probability under the null

    // --- Frequency goodness-of-fit vs the uniform / hypergeometric null ---
    var E = s.expectedCount;
    var chi = 0;
    for (var i = 0; i < N; i++) chi += ((s.counts[i] - E) * (s.counts[i] - E)) / (E || 1);
    var chiDf = N - 1;
    var chiP = chiSquareP(chi, chiDf);

    // --- Per-number binomial tests with FDR control (multiplicity guard) ---
    var sd = Math.sqrt(D * q * (1 - q)) || 1;
    var pvals = [];
    var zScores = [];
    for (var n = 0; n < N; n++) {
      var z = (s.counts[n] - D * q) / sd;
      zScores.push(z);
      pvals.push(twoSidedZP(z));
    }
    var fdr = benjaminiHochberg(pvals, 0.05);

    // --- Dispersion: are counts more variable than the binomial null? ---
    var obsVar = variance(s.counts);
    var nullVar = D * q * (1 - q);
    var dispersion = nullVar > 0 ? obsVar / nullVar : 1;

    // --- Non-stationarity: first half vs second half contingency test ---
    var half = Math.floor(D / 2);
    var stationarity = { chi: 0, p: 1, df: Math.max(1, N - 1), testable: false };
    if (half >= 8) {
      var c1 = new Array(N).fill(0);
      var c2 = new Array(N).fill(0);
      for (var t = 0; t < D; t++) {
        var target = t < half ? c1 : c2;
        for (var j = 0; j < draws[t].numbers.length; j++) {
          target[draws[t].numbers[j] - config.poolMin]++;
        }
      }
      var n1 = half * k;
      var n2 = (D - half) * k;
      var stat = 0;
      for (var m = 0; m < N; m++) {
        var tot = c1[m] + c2[m];
        if (!tot) continue;
        var e1 = (tot * n1) / (n1 + n2);
        var e2 = (tot * n2) / (n1 + n2);
        if (e1 > 0) stat += ((c1[m] - e1) * (c1[m] - e1)) / e1;
        if (e2 > 0) stat += ((c2[m] - e2) * (c2[m] - e2)) / e2;
      }
      stationarity = {
        chi: stat,
        df: N - 1,
        p: chiSquareP(stat, N - 1),
        testable: true
      };
    }

    // --- Serial dependence: lag-1 autocorrelation of draw sums ---
    var acf1 = autocorr(s.sums, 1);
    var acfSe = D > 3 ? 1 / Math.sqrt(D) : 1;
    var acfZ = acf1 / acfSe;

    // --- Gap law: observed mean recurrence interval vs geometric 1/q ---
    var allGaps = [];
    for (var g = 0; g < N; g++) allGaps = allGaps.concat(s.gaps[g]);
    var gapMean = mean(allGaps);
    var gapExpected = 1 / q;
    var gapCv = allGaps.length > 2 ? Math.sqrt(variance(allGaps)) / (gapMean || 1) : 1;

    // --- Date-derived recurrence diagnostics (only when sufficient real dates exist) ---
    var dateStats = { available: false, n: 0, sorted: false, duplicates: false, outOfOrder: false, cadenceInfo: null };
    var datedEntries = draws.filter(function (d) { return !!d.date; });
    if (datedEntries.length >= 6) {
      dateStats.available = true;
      dateStats.n = datedEntries.length;
      var datesRaw = datedEntries.map(function (d) { return d.date; });
      var duplicates = new Set(datesRaw).size < datesRaw.length;
      dateStats.duplicates = duplicates;
      // Strict sorted check requires real calendar dates; loose order accepted for user input.
      // Recognize both ascending and descending chronological order as "sorted".
      var sortedDates = datesRaw.slice().sort(); // ascending
      var sortedDesc = datesRaw.slice().sort().reverse(); // descending
      var joined = datesRaw.join(",");
      dateStats.sorted = joined === sortedDates.join(",") || joined === sortedDesc.join(",");
      dateStats.order = joined === sortedDates.join(",") ? "ascending" : (joined === sortedDesc.join(",") ? "descending" : "unordered");
      dateStats.outOfOrder = !dateStats.sorted && !duplicates;
      // Date cadence: intervals between consecutive draws (draw index, not wall-clock).
      // Note: without validated calendar conversion, this is an ordinal interval metric,
      // not a calendar-time recurrence formula. No predictive claim is made from it.
      var ordinalCadence = [];
      for (var di = 1; di < datedEntries.length; di++) ordinalCadence.push(di); // index intervals
      dateStats.cadenceInfo = {
        ordinalIntervals: ordinalCadence,
        note: "Ordinal draw-interval cadence (draw-to-draw). Calendar-time recurrence requires validated dates and more observations to be informative; here it is a descriptive statistic, not a predictive law."
      };
    }

    // --- Entropy ratio (1.0 == perfectly flat empirical distribution) ---
    var totalPicks = D * k || 1;
    var H = 0;
    for (var e = 0; e < N; e++) {
      var p = s.counts[e] / totalPicks;
      if (p > 0) H -= p * log2(p);
    }
    var entropyRatio = H / log2(N);

    // --- Deterministic structure probe (cheap analytic screen) ---
    var analytic = deriveAnalyticLaw(draws, config, { quick: true });
    var structureScore = analytic.best ? analytic.best.valAccuracy : 0;

    // --- Verdict ---
    var randomnessEvidence = [
      chiP > 0.05,
      fdr.survivors.length === 0,
      Math.abs(acfZ) < 2,
      stationarity.p > 0.05,
      entropyRatio > 0.985
    ].filter(Boolean).length;

    var mode;
    var confidence;
    if (structureScore >= 0.85) {
      mode = "pattern";
      confidence = structureScore;
    } else if (structureScore >= 0.3 || randomnessEvidence <= 3) {
      mode = "mixed";
      confidence = 1 - Math.abs(randomnessEvidence - 3) / 5;
    } else {
      mode = "random";
      confidence = randomnessEvidence / 5;
    }
    if (D < 12) {
      mode = D < 4 ? "insufficient" : mode;
    }

    return {
      summary: s,
      chi: { stat: chi, df: chiDf, p: chiP },
      perNumber: { z: zScores, p: pvals, fdr: fdr },
      dispersion: dispersion,
      stationarity: stationarity,
      autocorrelation: { lag1: acf1, z: acfZ },
      gaps: {
        observedMean: gapMean,
        expectedMean: gapExpected,
        cv: gapCv,
        n: allGaps.length,
        all: allGaps
      },
      entropyRatio: entropyRatio,
      structureScore: structureScore,
      analyticProbe: analytic,
      randomnessEvidence: randomnessEvidence,
      mode: mode,
      confidence: clamp(confidence, 0, 1),
      dateStats: dateStats
    };
  }

  function autocorr(series, lag) {
    if (series.length <= lag + 2) return 0;
    var m = mean(series);
    var num = 0;
    var den = 0;
    for (var i = 0; i < series.length; i++) {
      den += (series[i] - m) * (series[i] - m);
      if (i + lag < series.length) num += (series[i] - m) * (series[i + lag] - m);
    }
    return den ? num / den : 0;
  }

  /* ====================================================================
   * 4. TOOL 1 - Analytic derivation of a generating law
   * --------------------------------------------------------------------
   * Restricted hypothesis class. Each hypothesis is a closed-form
   * recurrence with a handful of integer parameters, fitted on a training
   * prefix and *scored on a held-out suffix it never saw*. A law is only
   * reported if it survives out-of-sample validation. Ties are broken by
   * minimum description length, not by training fit.
   * ================================================================== */

  function seriesViews(draws, config) {
    var views = [];
    var k = config.picks;
    for (var pos = 0; pos < k; pos++) {
      views.push({
        id: "pos" + pos,
        name: "Position " + (pos + 1) + " (ascending)",
        values: draws.map(function (d) {
          return d.numbers[pos];
        }),
        modulus: config.poolMax + 1,
        offset: 0
      });
    }
    views.push({
      id: "sum",
      name: "Draw sum",
      values: draws.map(function (d) {
        return sum(d.numbers);
      }),
      modulus: config.poolMax * config.picks + 1,
      offset: 0
    });
    return views;
  }

  var HYPOTHESES = [
    {
      id: "constant",
      name: "Constant law",
      params: 1,
      fit: function (v) {
        var c = v[0];
        return v.every(function (x) {
          return x === c;
        })
          ? { c: c }
          : null;
      },
      predict: function (p) {
        return p.c;
      },
      formula: function (p) {
        return "xₙ = " + p.c;
      }
    },
    {
      id: "arithmetic",
      name: "Arithmetic progression (mod M)",
      params: 2,
      fit: function (v, M) {
        if (v.length < 3) return null;
        var d = mod(v[1] - v[0], M);
        return { d: d, M: M, seed: v[0] };
      },
      predict: function (p, hist) {
        return mod(hist[hist.length - 1] + p.d, p.M);
      },
      formula: function (p) {
        return "xₙ = (xₙ₋₁ + " + p.d + ") mod " + p.M;
      }
    },
    {
      id: "affine",
      name: "Affine recurrence (mod M)",
      params: 3,
      fit: function (v, M) {
        if (v.length < 4 || M > 400) return null;
        // Screen in O(M): for each a, b is *determined* by one transition.
        // Only fully verified candidates cost O(n). This is exact for any
        // law that reproduces the anchor transition, and we anchor on
        // several transitions so partial fits are still reachable.
        var anchors = Math.min(4, v.length - 1);
        var seen = new Set();
        var best = null;
        for (var t = 0; t < anchors; t++) {
          for (var a = 0; a < M; a++) {
            var b = mod(v[t + 1] - a * v[t], M);
            var key = a * (M + 1) + b;
            if (seen.has(key)) continue;
            seen.add(key);
            var hits = 0;
            for (var i = 1; i < v.length; i++) {
              if (mod(a * v[i - 1] + b, M) === mod(v[i], M)) hits++;
            }
            var acc = hits / (v.length - 1);
            if (!best || acc > best.acc) best = { a: a, b: b, M: M, acc: acc };
            if (acc === 1) return { a: a, b: b, M: M };
          }
        }
        return best && best.acc >= 0.9 ? { a: best.a, b: best.b, M: M } : null;
      },
      predict: function (p, hist) {
        return mod(p.a * hist[hist.length - 1] + p.b, p.M);
      },
      formula: function (p) {
        return "xₙ = (" + p.a + "·xₙ₋₁ + " + p.b + ") mod " + p.M;
      }
    },
    {
      id: "order2",
      name: "Second-order linear recurrence (mod M)",
      params: 4,
      fit: function (v, M) {
        if (v.length < 6 || M > 200) return null;
        var n = v.length;
        var total = n - 2;
        // Accept nothing below 0.9 training accuracy, so we may abandon a
        // candidate as soon as its misses make 0.9 unreachable. Random
        // (a, b) pairs die within a few terms, turning the nominal
        // O(M^2 n) sweep into roughly O(M^2) in practice.
        var maxMiss = Math.floor(total * 0.1);
        var best = null;
        for (var a = 0; a < M; a++) {
          for (var b = 0; b < M; b++) {
            var c = mod(v[2] - a * v[1] - b * v[0], M);
            var hits = 0;
            var miss = 0;
            for (var i = 2; i < n; i++) {
              if (mod(a * v[i - 1] + b * v[i - 2] + c, M) === mod(v[i], M)) hits++;
              else if (++miss > maxMiss) break;
            }
            if (miss > maxMiss) continue;
            var acc = hits / total;
            if (!best || acc > best.acc) best = { a: a, b: b, c: c, M: M, acc: acc };
            if (acc === 1) return { a: a, b: b, c: c, M: M };
          }
        }
        return best && best.acc >= 0.9 ? { a: best.a, b: best.b, c: best.c, M: M } : null;
      },
      predict: function (p, hist) {
        var n = hist.length;
        return mod(p.a * hist[n - 1] + p.b * hist[n - 2] + p.c, p.M);
      },
      formula: function (p) {
        return (
          "xₙ = (" + p.a + "·xₙ₋₁ + " + p.b +
          "·xₙ₋₂ + " + p.c + ") mod " + p.M
        );
      }
    },
    {
      id: "periodic",
      name: "Periodic cycle",
      params: 2,
      fit: function (v) {
        if (v.length < 6) return null;
        for (var p = 2; p <= Math.floor(v.length / 2); p++) {
          var ok = true;
          for (var i = p; i < v.length; i++) {
            if (v[i] !== v[i - p]) {
              ok = false;
              break;
            }
          }
          if (ok) return { period: p, cycle: v.slice(0, p) };
        }
        return null;
      },
      predict: function (p, hist) {
        return hist[hist.length - p.period];
      },
      formula: function (p) {
        return "xₙ = xₙ₋" + p.period + "  (cycle of " + p.period + ")";
      }
    },
    {
      id: "polynomial",
      name: "Polynomial in n (finite differences)",
      params: 4,
      fit: function (v) {
        if (v.length < 8) return null;
        var cur = v.slice();
        for (var d = 1; d <= 3; d++) {
          var next = [];
          for (var i = 1; i < cur.length; i++) next.push(cur[i] - cur[i - 1]);
          cur = next;
          if (cur.length < 3) return null;
          var allSame = cur.every(function (x) {
            return x === cur[0];
          });
          if (allSame) return { degree: d, delta: cur[0], seed: v.slice() };
        }
        return null;
      },
      predict: function (p, hist) {
        // Extrapolate by rebuilding the difference table from history.
        var tables = [hist.slice()];
        for (var d = 1; d <= p.degree; d++) {
          var prev = tables[d - 1];
          var next = [];
          for (var i = 1; i < prev.length; i++) next.push(prev[i] - prev[i - 1]);
          tables.push(next);
        }
        var carry = p.delta;
        for (var lvl = p.degree - 1; lvl >= 0; lvl--) {
          var row = tables[lvl];
          carry = row[row.length - 1] + carry;
        }
        return carry;
      },
      formula: function (p) {
        return "Δ^" + p.degree + "xₙ = " + p.delta + " (degree-" + p.degree + " polynomial)";
      }
    }
  ];

  function fitHypothesis(hyp, series, splitAt) {
    var train = series.values.slice(0, splitAt);
    var params = null;
    try {
      params = hyp.fit(train, series.modulus);
    } catch (e) {
      params = null;
    }
    if (!params) return null;

    var trainHits = 0;
    var trainTotal = 0;
    var valHits = 0;
    var valTotal = 0;
    var minHist = hyp.id === "order2" ? 2 : hyp.id === "periodic" ? params.period : 1;

    for (var i = Math.max(minHist, 1); i < series.values.length; i++) {
      var hist = series.values.slice(0, i);
      var pred;
      try {
        pred = hyp.predict(params, hist);
      } catch (e2) {
        continue;
      }
      var hit = pred === series.values[i] ? 1 : 0;
      if (i < splitAt) {
        trainHits += hit;
        trainTotal++;
      } else {
        valHits += hit;
        valTotal++;
      }
    }
    if (!valTotal) return null;

    var trainAcc = trainTotal ? trainHits / trainTotal : 0;
    var valAcc = valHits / valTotal;
    // Minimum description length: parameter cost + residual coding cost.
    var bitsPerSymbol = log2(Math.max(2, series.modulus));
    var descriptionBits =
      hyp.params * bitsPerSymbol + (1 - valAcc) * valTotal * bitsPerSymbol;

    var next = null;
    try {
      next = hyp.predict(params, series.values);
    } catch (e3) {
      next = null;
    }

    return {
      hypothesis: hyp.id,
      name: hyp.name,
      series: series.id,
      seriesName: series.name,
      formula: hyp.formula(params),
      params: params,
      trainAccuracy: trainAcc,
      valAccuracy: valAcc,
      valTotal: valTotal,
      trainTotal: trainTotal,
      descriptionBits: descriptionBits,
      nextValue: next
    };
  }

  /**
   * Search the restricted hypothesis class for a law that survives
   * out-of-sample validation.
   */
  function deriveAnalyticLaw(draws, config, opts) {
    opts = opts || {};
    var minValAcc = opts.minValAccuracy == null ? 0.85 : opts.minValAccuracy;
    var splitFrac = opts.splitFraction == null ? 0.7 : opts.splitFraction;

    // A genuine closed-form law is identifiable from a bounded window, and
    // on a drifting process the recent window is the more honest evidence.
    // Capping the window keeps repeated refits linear rather than quadratic.
    var maxWindow = opts.maxWindow == null ? 400 : opts.maxWindow;
    if (maxWindow > 0 && draws.length > maxWindow) {
      draws = draws.slice(draws.length - maxWindow);
    }

    if (draws.length < 6) {
      return { candidates: [], best: null, verdict: "insufficient", positionLaws: null };
    }

    var views = seriesViews(draws, config);
    if (opts.quick) views = views.filter(function (v) {
      return v.id !== "sum";
    });

    var splitAt = Math.max(3, Math.floor(draws.length * splitFrac));
    var candidates = [];

    for (var v = 0; v < views.length; v++) {
      for (var h = 0; h < HYPOTHESES.length; h++) {
        if (opts.quick && (HYPOTHESES[h].id === "order2" || HYPOTHESES[h].id === "affine")) {
          if (config.poolMax > 80) continue;
        }
        var res = fitHypothesis(HYPOTHESES[h], views[v], splitAt);
        if (res) candidates.push(res);
      }
    }

    candidates.sort(function (a, b) {
      if (b.valAccuracy !== a.valAccuracy) return b.valAccuracy - a.valAccuracy;
      return a.descriptionBits - b.descriptionBits;
    });

    var survivors = candidates.filter(function (c) {
      return c.valAccuracy >= minValAcc;
    });
    survivors.sort(function (a, b) {
      return a.descriptionBits - b.descriptionBits;
    });

    var best = survivors[0] || null;

    // If every ascending-position series has its own surviving law we can
    // reconstruct a full deterministic prediction for the next draw.
    var positionLaws = null;
    var perPos = [];
    for (var p = 0; p < config.picks; p++) {
      var lawsForPos = survivors.filter(function (c) {
        return c.series === "pos" + p;
      });
      if (!lawsForPos.length) {
        perPos = null;
        break;
      }
      perPos.push(lawsForPos[0]);
    }
    if (perPos) {
      var predicted = perPos.map(function (l) {
        return l.nextValue;
      });
      var inRange = predicted.every(function (x) {
        return x != null && x >= config.poolMin && x <= config.poolMax;
      });
      var distinct = new Set(predicted).size === predicted.length;
      positionLaws = {
        laws: perPos,
        prediction: predicted.slice().sort(function (a, b) {
          return a - b;
        }),
        admissible: inRange && distinct,
        meanValAccuracy: mean(
          perPos.map(function (l) {
            return l.valAccuracy;
          })
        )
      };
    }

    var verdict = best
      ? best.valAccuracy >= 0.999
        ? "exact-law"
        : "partial-law"
      : "no-law";

    return {
      candidates: candidates.slice(0, 20),
      survivors: survivors,
      best: best,
      positionLaws: positionLaws,
      splitAt: splitAt,
      verdict: verdict
    };
  }

  /**
   * Convert an analytic result into a per-number score vector so the
   * analytic tool can be graded on the same probabilistic scale as the
   * stochastic tool. A deterministic law puts most of the mass on the
   * numbers it names but never all of it (guardrail 2).
   */
  function analyticScores(draws, config, opts) {
    var res = opts && opts.result ? opts.result : deriveAnalyticLaw(draws, config, opts);
    var N = config.poolSize;
    var w = new Array(N).fill(1);
    var predicted = [];

    if (res.positionLaws && res.positionLaws.admissible) {
      predicted = res.positionLaws.prediction;
    } else if (res.best && res.best.series.indexOf("pos") === 0 && res.best.nextValue != null) {
      predicted = [res.best.nextValue];
    }

    var conf = res.positionLaws
      ? res.positionLaws.meanValAccuracy
      : res.best
      ? res.best.valAccuracy
      : 0;
    // Confidence is capped: an analytic law is never allowed to claim
    // certainty about a future observation.
    var strength = clamp(conf, 0, 0.98) * (opts && opts.strength != null ? opts.strength : 1);

    for (var i = 0; i < predicted.length; i++) {
      var idx = predicted[i] - config.poolMin;
      if (idx >= 0 && idx < N) w[idx] = 1 + strength * N;
    }

    return { weights: w, predicted: predicted, confidence: conf, result: res };
  }

  /* ====================================================================
   * 5. TOOL 2 - Statistical / stochastic recurrence model
   * --------------------------------------------------------------------
   * Assumes no deterministic law exists. Models recurrence *frequency*
   * with an exchangeable Beta-Binomial posterior whose prior is centred on
   * the hypergeometric truth q = k/N (that is the inductive bias), plus an
   * exponentially weighted channel for non-stationary drift.
   * ================================================================== */

  var STOCHASTIC_DEFAULTS = {
    priorStrength: 40, // pseudo-draws of belief in the uniform null
    decay: 1.0, // 1.0 = stationary; < 1 discounts old draws
    credibleMass: 0.95
  };

  function stochasticModel(draws, config, opts) {
    var o = Object.assign({}, STOCHASTIC_DEFAULTS, opts || {});
    var s = summarize(draws, config);
    var N = s.N;
    var D = s.D;
    var k = s.k;
    var q = k / N;

    // Prior: Beta(a0, b0) centred exactly on the hypergeometric rate.
    var a0 = o.priorStrength * q;
    var b0 = o.priorStrength * (1 - q);

    // Exponentially weighted counts for the non-stationary channel.
    var lam = clamp(o.decay, 0.5, 1);
    var wCounts = new Array(N).fill(0);
    var wTotal = 0;
    for (var t = 0; t < D; t++) {
      var weight = Math.pow(lam, D - 1 - t);
      wTotal += weight;
      var nums = draws[t].numbers;
      for (var j = 0; j < nums.length; j++) wCounts[nums[j] - config.poolMin] += weight;
    }

    var rows = [];
    var lo = (1 - o.credibleMass) / 2;
    var hi = 1 - lo;
    var sdNull = Math.sqrt(D * q * (1 - q)) || 1;

    for (var i = 0; i < N; i++) {
      var c = s.counts[i];
      var a = a0 + c;
      var b = b0 + (D - c);
      var post = a / (a + b);
      var ewma = wTotal > 0 ? (a0 + wCounts[i]) / (a0 + b0 + wTotal) : q;
      var z = (c - D * q) / sdNull;
      var pv = twoSidedZP(z);
      var gapList = s.gaps[i];

      rows.push({
        index: i,
        number: label(i, config),
        count: c,
        expected: D * q,
        posteriorMean: post,
        ci: [betaQuantile(lo, a, b), betaQuantile(hi, a, b)],
        ewmaMean: ewma,
        z: z,
        p: pv,
        currentGap: s.currentGap[i],
        meanGap: gapList.length ? mean(gapList) : null,
        expectedGap: 1 / q,
        // Under memorylessness the hazard is flat; shown to *refute*
        // the "due number" fallacy rather than to support it.
        hazard: q,
        recurrenceOdds: gapList.length ? mean(gapList) / (1 / q) : null
      });
    }

    var fdr = benjaminiHochberg(
      rows.map(function (r) {
        return r.p;
      }),
      0.05
    );
    var survivorSet = new Set(fdr.survivors);
    rows.forEach(function (r, i) {
      r.significant = survivorSet.has(i);
    });

    // Blend the stationary posterior with the non-stationary channel.
    var blend = lam >= 0.999 ? 0 : clamp((1 - lam) * 8, 0, 0.9);
    var weights = rows.map(function (r) {
      return (1 - blend) * r.posteriorMean + blend * r.ewmaMean;
    });
    var probs = normalizeToPicks(weights, k);
    rows.forEach(function (r, i) {
      r.probability = probs[i];
      r.lift = probs[i] / q;
    });

    var ranked = rows.slice().sort(function (a, b) {
      return b.probability - a.probability;
    });

    return {
      rows: rows,
      ranked: ranked,
      weights: weights,
      probabilities: probs,
      prior: { a0: a0, b0: b0, strength: o.priorStrength, centre: q },
      decay: lam,
      blend: blend,
      effectiveSampleSize: wTotal,
      significantCount: fdr.survivors.length,
      fdrThreshold: fdr.threshold,
      summary: s,
      shrinkage: o.priorStrength / (o.priorStrength + D)
    };
  }

  /** Scale a weight vector so it sums to k (expected hits per draw). */
  function normalizeToPicks(weights, k) {
    var tot = sum(weights) || 1;
    return weights.map(function (w) {
      return (w / tot) * k;
    });
  }

  /* ====================================================================
   * 6. TOOL 3 - Hybrid model (online expert mixture)
   * --------------------------------------------------------------------
   * Neither pure law nor pure noise. Runs the analytic channel and the
   * stochastic channels as competing experts and learns the mixture
   * weights online with multiplicative weights (Hedge) under log loss.
   * The learned weights are themselves the answer: they measure how much
   * of the series is structure and how much is chance.
   * ================================================================== */

  var HYBRID_DEFAULTS = {
    learningRate: 0.5,
    priorStrength: 40,
    decay: 0.97,
    warmup: 0.4
  };

  function expertPanel(config, opts) {
    var N = config.poolSize;
    var k = config.picks;
    var o = Object.assign({}, HYBRID_DEFAULTS, opts || {});

    return [
      {
        id: "uniform",
        name: "Exchangeable null",
        note: "Hypergeometric baseline, q = k/N. The regulariser.",
        score: function () {
          return new Array(N).fill(k / N);
        }
      },
      {
        id: "frequency",
        name: "Shrunk frequency",
        note: "Beta-Binomial posterior with a prior centred on the null.",
        score: function (history) {
          var m = stochasticModel(history, config, {
            priorStrength: o.priorStrength,
            decay: 1
          });
          return m.probabilities;
        }
      },
      {
        id: "adaptive",
        name: "Adaptive (EWMA)",
        note: "Non-stationary channel; recent draws weighted more heavily.",
        score: function (history) {
          var m = stochasticModel(history, config, {
            priorStrength: o.priorStrength,
            decay: o.decay
          });
          return m.probabilities;
        }
      },
      {
        id: "analytic",
        name: "Analytic law",
        note: "Best out-of-sample-validated recurrence from the restricted class.",
        score: function (history) {
          if (history.length < 8) return new Array(N).fill(k / N);
          var a = analyticScores(history, config, { minValAccuracy: 0.8 });
          return normalizeToPicks(a.weights, k);
        }
      }
    ];
  }

  function multiLabelLogLoss(probs, drawNumbers, config) {
    var k = config.picks;
    var N = config.poolSize;
    var floor = 1e-6;
    var tot = sum(probs) || k;
    var loss = 0;
    for (var i = 0; i < drawNumbers.length; i++) {
      var idx = drawNumbers[i] - config.poolMin;
      var pi = clamp((probs[idx] || 0) / tot, floor, 1);
      loss -= Math.log(pi);
    }
    return { loss: loss / drawNumbers.length, baseline: Math.log(N) };
  }

  function hybridModel(draws, config, opts) {
    var o = Object.assign({}, HYBRID_DEFAULTS, opts || {});
    var experts = expertPanel(config, o);
    var M = experts.length;
    var w = new Array(M).fill(1 / M);
    var eta = o.learningRate;
    var start = Math.max(6, Math.floor(draws.length * o.warmup));
    var trajectory = [];
    var cumulative = new Array(M).fill(0);
    var rounds = 0;
    var N = config.poolSize;
    // Prequential record: at every step we store the mixture's prediction
    // made *before* seeing draw t. That is a genuine out-of-sample forecast,
    // so an online learner can be evaluated honestly in a single pass.
    var prequential = [];

    // Every round refits all experts on the growing history, so an
    // unbounded sweep is quadratic. Cap the number of update rounds; each
    // retained round is still predict-then-update on data the experts have
    // not seen, which is what makes the learned weights meaningful.
    var maxRounds = o.maxRounds == null ? 150 : o.maxRounds;
    var stride = Math.max(1, Math.ceil((draws.length - start) / maxRounds));

    for (var t = start; t < draws.length; t += stride) {
      var history = draws.slice(0, t);
      var scores = experts.map(function (e) {
        return e.score(history);
      });

      // Mixture forecast using the weights available before this outcome.
      var pre = new Array(N).fill(0);
      for (var pi = 0; pi < N; pi++) {
        for (var pj = 0; pj < M; pj++) pre[pi] += w[pj] * scores[pj][pi];
      }
      prequential.push({ t: t, probs: normalizeToPicks(pre, config.picks) });

      var losses = scores.map(function (s) {
        return multiLabelLogLoss(s, draws[t].numbers, config).loss;
      });
      var minLoss = Math.min.apply(null, losses);
      for (var m = 0; m < M; m++) {
        cumulative[m] += losses[m];
        w[m] *= Math.exp(-eta * (losses[m] - minLoss));
      }
      var tot = sum(w) || 1;
      for (var n = 0; n < M; n++) w[n] /= tot;
      trajectory.push({ t: t, weights: w.slice(), losses: losses });
      rounds++;
    }

    // Final blended prediction over the full history.
    var finalScores = experts.map(function (e) {
      return e.score(draws);
    });
    var N = config.poolSize;
    var blended = new Array(N).fill(0);
    for (var i = 0; i < N; i++) {
      for (var j = 0; j < M; j++) blended[i] += w[j] * finalScores[j][i];
    }
    var probs = normalizeToPicks(blended, config.picks);

    var rows = probs.map(function (p, idx) {
      return {
        index: idx,
        number: label(idx, config),
        probability: p,
        lift: p / (config.picks / N),
        contributions: experts.map(function (e, j) {
          return { id: e.id, value: w[j] * finalScores[j][idx] };
        })
      };
    });

    return {
      experts: experts.map(function (e, j) {
        return {
          id: e.id,
          name: e.name,
          note: e.note,
          weight: w[j],
          meanLoss: rounds ? cumulative[j] / rounds : null
        };
      }),
      weights: w,
      trajectory: trajectory,
      prequential: prequential,
      rounds: rounds,
      probabilities: probs,
      rows: rows,
      ranked: rows.slice().sort(function (a, b) {
        return b.probability - a.probability;
      }),
      structureShare: w[3],
      noiseShare: w[0] + w[1] + w[2]
    };
  }

  /* ====================================================================
   * 7. Walk-forward validation - the only judge that counts
   * --------------------------------------------------------------------
   * "A model should be judged by its ability to predict new observations,
   *  not by its ability to reproduce old ones."
   * Every tool is refit from scratch at each step on strictly past data.
   * ================================================================== */

  function backtest(draws, config, scorer, opts) {
    opts = opts || {};
    var startFrac = opts.startFraction == null ? 0.5 : opts.startFraction;
    var start = Math.max(6, Math.floor(draws.length * startFrac));
    var N = config.poolSize;
    var k = config.picks;
    var q = k / N;

    if (draws.length - start < 3) {
      return { testable: false, reason: "Need more draws to hold out a fair test window." };
    }

    // Each step refits from scratch, so a full sweep is quadratic. Above a
    // few hundred draws we stride through the test window instead. Every
    // retained step is still a genuine refit-and-predict on unseen data, so
    // this trades resolution for responsiveness, not validity.
    var maxSteps = opts.maxSteps == null ? 150 : opts.maxSteps;
    var stride = Math.max(1, Math.ceil((draws.length - start) / maxSteps));

    var losses = [];
    var briers = [];
    var hits = [];
    var topKHits = [];
    var calibration = [];
    for (var c = 0; c < 10; c++) calibration.push({ n: 0, predicted: 0, observed: 0 });

    for (var t = start; t < draws.length; t += stride) {
      var history = draws.slice(0, t);
      var probs;
      try {
        probs = scorer(history);
      } catch (e) {
        continue;
      }
      var actual = new Set(
        draws[t].numbers.map(function (x) {
          return x - config.poolMin;
        })
      );

      var ll = multiLabelLogLoss(probs, draws[t].numbers, config);
      losses.push(ll.loss);

      var brier = 0;
      for (var i = 0; i < N; i++) {
        var y = actual.has(i) ? 1 : 0;
        var p = clamp(probs[i], 0, 1);
        brier += (p - y) * (p - y);
        var bin = clamp(Math.floor((p / (2 * q)) * 10), 0, 9);
        calibration[bin].n++;
        calibration[bin].predicted += p;
        calibration[bin].observed += y;
      }
      briers.push(brier / N);

      var order = range(N).sort(function (a, b) {
        return probs[b] - probs[a];
      });
      var top = order.slice(0, k);
      var hit = top.filter(function (i) {
        return actual.has(i);
      }).length;
      topKHits.push(hit);
      hits.push(hit / k);
    }

    var n = losses.length;
    var meanLoss = mean(losses);
    var baseline = Math.log(N);
    var lift = (baseline - meanLoss) / baseline;
    var meanHits = mean(topKHits);
    var chanceHits = (k * k) / N;

    // Is the top-k hit rate distinguishable from chance? Under the null the
    // overlap between a fixed top-k set and the drawn k is hypergeometric,
    // so include the finite-population correction.
    var fpc = N > 1 ? (N - k) / (N - 1) : 1;
    var hitVar = k * q * (1 - q) * fpc;
    var hitSd = n > 0 ? Math.sqrt(hitVar / n) : 0;
    var hitZ = hitSd > 0 ? (meanHits - chanceHits) / hitSd : 0;
    var hitP = twoSidedZP(hitZ);

    // Paired test of log loss against the uniform baseline.
    var diffs = losses.map(function (l) {
      return baseline - l;
    });
    var dSd = Math.sqrt(variance(diffs) / (n || 1));
    var dZ = dSd > 0 ? mean(diffs) / dSd : 0;
    var dP = twoSidedZP(dZ);

    return {
      testable: true,
      n: n,
      start: start,
      stride: stride,
      meanLogLoss: meanLoss,
      baselineLogLoss: baseline,
      lift: lift,
      logLossZ: dZ,
      logLossP: dP,
      meanBrier: mean(briers),
      baselineBrier: q * (1 - q),
      meanTopKHits: meanHits,
      chanceHits: chanceHits,
      hitZ: hitZ,
      hitP: hitP,
      hitSeries: topKHits,
      lossSeries: losses,
      calibration: calibration.map(function (b) {
        return {
          n: b.n,
          predicted: b.n ? b.predicted / b.n : 0,
          observed: b.n ? b.observed / b.n : 0
        };
      }),
      // Either test may detect an edge: log loss is sensitive to the whole
      // probability vector, the hit test to the ranking at the top. Two
      // tests are run, so each is held to a Bonferroni-corrected 0.025 to
      // keep the overall false-positive rate near 5%.
      beatsChance:
        (dP < 0.025 && mean(diffs) > 0) || (hitP < 0.025 && meanHits > chanceHits),
      evidence: {
        logLoss: dP < 0.025 && mean(diffs) > 0,
        topK: hitP < 0.025 && meanHits > chanceHits,
        alpha: 0.025
      }
    };
  }

  /**
   * Evaluate a set of pre-recorded out-of-sample forecasts.
   * Shares all scoring logic with backtest(), but consumes forecasts that
   * were already produced online (one pass) instead of refitting per step.
   */
  function evaluateForecasts(forecasts, draws, config) {
    if (!forecasts || forecasts.length < 3) {
      return { testable: false, reason: "Need more draws to hold out a fair test window." };
    }
    // Index the recorded forecasts by the draw index they predicted.
    var byT = {};
    for (var i = 0; i < forecasts.length; i++) byT[forecasts[i].t] = forecasts[i].probs;
    var startT = forecasts[0].t;
    return backtest(draws, config, function (history) {
      return byT[history.length] || new Array(config.poolSize).fill(config.picks / config.poolSize);
    }, { startFraction: startT / draws.length });
  }

  function scorerFor(tool, config, opts) {
    opts = opts || {};
    var k = config.picks;
    if (tool === "analytic") {
      return function (history) {
        var a = analyticScores(history, config, {
          minValAccuracy: opts.minValAccuracy == null ? 0.85 : opts.minValAccuracy
        });
        return normalizeToPicks(a.weights, k);
      };
    }
    if (tool === "stochastic") {
      return function (history) {
        return stochasticModel(history, config, opts).probabilities;
      };
    }
    return function (history) {
      if (history.length < 12) return new Array(config.poolSize).fill(k / config.poolSize);
      return hybridModel(history, config, opts).probabilities;
    };
  }

  /* ====================================================================
   * 7b. Structure & randomness battery (ported from the prototype)
   * --------------------------------------------------------------------
   * Additional, independent evidence about *how random* the series is.
   * These operate on the observed history only. They never predict a next
   * draw; they strengthen or weaken the case that any structure exists at
   * all. Ported from the earlier numbers_predictions prototype (runs test,
   * Kolmogorov-Smirnov vs uniform, Poisson recurrence model, and FFT
   * spectral concentration), re-derived here against the real config.
   * ================================================================== */

  /**
   * Wald-Wolfowitz runs test on the draw sums (above/below median).
   * Detects serial dependence / clustering that per-number tests miss.
   */
  function runsTest(values) {
    if (!values || values.length < 10) return { testable: false, reason: "Need at least 10 draws." };
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)];
    var binary = values.map(function (v) { return v > median ? 1 : 0; });
    var runs = 1;
    for (var i = 1; i < binary.length; i++) if (binary[i] !== binary[i - 1]) runs++;
    var n1 = binary.filter(function (b) { return b === 1; }).length;
    var n0 = binary.length - n1;
    if (n1 === 0 || n0 === 0) return { testable: false, reason: "All values on one side of the median." };
    var expR = (2 * n1 * n0) / (n1 + n0) + 1;
    var varR = (2 * n1 * n0 * (2 * n1 * n0 - n1 - n0)) / (Math.pow(n1 + n0, 2) * (n1 + n0 - 1));
    var z = varR > 0 ? (runs - expR) / Math.sqrt(varR) : 0;
    return { testable: true, runs: runs, expected: expR, z: z, p: twoSidedZP(z) };
  }

  /**
   * Kolmogorov-Smirnov test of the flattened observed values against the
   * discrete uniform over the pool. The observed values are bounded integers,
   * so ties are dense and the classical asymptotic p-value is badly
   * anti-conservative here. We therefore calibrate the exact D statistic
   * against its own permutation null (uniform draws of the same size), which
   * is the honest reference for discrete data.
   */
  function ksTestUniform(values, config) {
    if (!values || values.length < 10) return { testable: false, reason: "Need at least 10 values." };
    var lo = config.poolMin;
    var N = config.poolSize;
    var n = values.length;

    function ksStat(arr) {
      var sorted = arr.slice().sort(function (a, b) { return a - b; });
      var d = 0;
      for (var i = 0; i < sorted.length; i++) {
        var empirical = (i + 1) / sorted.length;
        var theo = clamp((sorted[i] - lo + 1) / N, 0, 1);
        var theoPrev = clamp((sorted[i] - lo) / N, 0, 1);
        d = Math.max(d, Math.abs(empirical - theo), Math.abs(empirical - theoPrev));
      }
      return d;
    }

    var d = ksStat(values);

    // Permutation null: draw n independent uniforms from the pool and record
    // how often their KS statistic meets or exceeds the observed one.
    var sims = 400;
    var rand = mulberry32(0x9e3779b9 ^ n);
    var ge = 0;
    for (var s = 0; s < sims; s++) {
      var synth = new Array(n);
      for (var i = 0; i < n; i++) synth[i] = lo + Math.floor(rand() * N);
      if (ksStat(synth) >= d - 1e-12) ge++;
    }
    var p = clamp((ge + 1) / (sims + 1), 0, 1);
    return { testable: true, stat: d, p: p, n: n, calibration: "permutation (" + sims + " sims)" };
  }

  /**
   * Poisson model for the number of times a single number recurs across D
   * draws. Returns the expected count and the probability of seeing count c
   * or more extreme than c, used to sanity-check the "overdue/hot" intuition.
   */
  function poissonRecurrence(draws, config) {
    var s = summarize(draws, config);
    var q = config.picks / config.poolSize;
    var lam = draws.length * q; // expected hits per number
    // For each number, P(X >= count) under Poisson(lam), and the most extreme.
    var rows = s.counts.map(function (c, i) {
      // P(X >= c) = 1 - P(X <= c-1); compute lower tail directly.
      var cum = 0;
      var term = Math.exp(-lam);
      for (var x = 0; x < c; x++) {
        cum += term;
        term *= lam / (x + 1);
      }
      var pGe = clamp(1 - cum, 0, 1);
      return { number: label(i, config), count: c, expected: lam, pGe: pGe };
    });
    rows.sort(function (a, b) { return a.pGe - b.pGe; });
    return {
      lambda: lam,
      draws: draws.length,
      q: q,
      mostExtreme: rows.slice(0, 5),
      // Smallest P(X>=c) across the pool; with N numbers a Bonferroni floor
      // of 0.05/N is the honest significance line.
      bonferroni: 0.05 / config.poolSize
    };
  }

  /**
   * FFT spectral concentration of the draw-sum series. A single dominant
   * frequency is weak evidence of periodicity; a flat spectrum is what pure
   * noise produces. Returns the dominant peak's share of total energy.
   */
  function spectralConcentration(values) {
    if (!values || values.length < 8) return { testable: false, reason: "Need at least 8 draws." };
    var n = values.length;
    // Next power of two for a clean radix-2 FFT.
    var size = 1;
    while (size < n) size <<= 1;
    var re = new Array(size).fill(0);
    var im = new Array(size).fill(0);
    var m = mean(values);
    for (var i = 0; i < n; i++) re[i] = values[i] - m;
    fft(re, im);
    var half = size / 2;
    var mags = [];
    for (var j = 1; j < half; j++) mags.push({ bin: j, mag: Math.hypot(re[j], im[j]) });
    var total = sum(mags.map(function (x) { return x.mag * x.mag; }));
    mags.sort(function (a, b) { return b.mag - a.mag; });
    var top = mags.slice(0, 3);
    var topEnergy = sum(top.map(function (x) { return x.mag * x.mag; }));
    return {
      testable: true,
      dominantPeriod: top.length ? size / top[0].bin : null,
      concentration: total > 0 ? topEnergy / total : 0,
      topPeaks: top.map(function (x) { return { period: size / x.bin, energyShare: total > 0 ? (x.mag * x.mag) / total : 0 }; })
    };
  }

  // In-place radix-2 iterative FFT.
  function fft(re, im) {
    var n = re.length;
    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = (-2 * Math.PI) / len;
      var wr = Math.cos(ang);
      var wi = Math.sin(ang);
      for (var i2 = 0; i2 < n; i2 += len) {
        var cwr = 1;
        var cwi = 0;
        for (var j2 = 0; j2 < len / 2; j2++) {
          var ur = re[i2 + j2];
          var ui = im[i2 + j2];
          var vr = re[i2 + j2 + len / 2] * cwr - im[i2 + j2 + len / 2] * cwi;
          var vi = re[i2 + j2 + len / 2] * cwi + im[i2 + j2 + len / 2] * cwr;
          re[i2 + j2] = ur + vr;
          im[i2 + j2] = ui + vi;
          re[i2 + j2 + len / 2] = ur - vr;
          im[i2 + j2 + len / 2] = ui - vi;
          var nwr = cwr * wr - cwi * wi;
          cwi = cwr * wi + cwi * wr;
          cwr = nwr;
        }
      }
    }
  }

  /**
   * Run the full ported battery against a parsed history and return a
   * consolidated structure-evidence report for the UI.
   */
  function structureTests(draws, config) {
    var s = summarize(draws, config);
    var flat = [];
    draws.forEach(function (d) {
      d.numbers.forEach(function (x) { flat.push(x); });
    });
    return {
      runs: runsTest(s.sums),
      ks: ksTestUniform(flat, config),
      poisson: poissonRecurrence(draws, config),
      spectral: spectralConcentration(s.sums)
    };
  }

  /* ====================================================================
   * 8. Sample generators - reproducible corpora for each regime
   * ================================================================== */

  function drawWithoutReplacement(rand, weights, k) {
    var pool = weights.slice();
    var picked = [];
    for (var i = 0; i < k; i++) {
      var tot = sum(pool);
      if (tot <= 0) break;
      var r = rand() * tot;
      var acc = 0;
      for (var j = 0; j < pool.length; j++) {
        acc += pool[j];
        if (r <= acc) {
          picked.push(j);
          pool[j] = 0;
          break;
        }
      }
    }
    return picked;
  }

  var SAMPLES = {
    random: {
      id: "random",
      name: "Pure chance (6/49)",
      blurb: "120 genuinely independent draws. The honest answer is 'no pattern'.",
      config: { poolMin: 1, poolMax: 49, picks: 6 },
      generate: function (cfg, n, seed) {
        var rand = mulberry32(seed || 20260729);
        var out = [];
        for (var t = 0; t < n; t++) {
          var w = new Array(cfg.poolSize).fill(1);
          out.push(drawWithoutReplacement(rand, w, cfg.picks));
        }
        return out;
      }
    },
    law: {
      id: "law",
      name: "Deterministic law (5/40)",
      blurb: "Each ascending position follows an affine recurrence mod 41.",
      config: { poolMin: 1, poolMax: 40, picks: 5 },
      generate: function (cfg, n) {
        var out = [];
        var state = [3, 11, 19, 27, 35];
        for (var t = 0; t < n; t++) {
          out.push(
            state
              .map(function (x) {
                return x - 1;
              })
              .slice()
              .sort(function (a, b) {
                return a - b;
              })
          );
          state = state.map(function (x, i) {
            var v = mod(3 * x + (7 + i), 41);
            return v === 0 ? 1 : v;
          });
          // Keep the draw admissible (distinct values in range).
          var seen = new Set();
          state = state.map(function (v) {
            while (seen.has(v)) v = mod(v + 1, 41) || 1;
            seen.add(v);
            return v;
          });
        }
        return out;
      }
    },
    mixed: {
      id: "mixed",
      name: "Biased mechanism (6/49)",
      blurb: "Chance plus a persistent physical bias on a subset of the pool.",
      config: { poolMin: 1, poolMax: 49, picks: 6 },
      generate: function (cfg, n, seed) {
        var rand = mulberry32(seed || 424242);
        var biased = [7, 11, 23, 31, 42];
        var out = [];
        for (var t = 0; t < n; t++) {
          var w = new Array(cfg.poolSize).fill(1);
          // Slow drift: the bias strengthens over time (non-stationary).
          var strength = 1.4 + 1.6 * (t / n);
          for (var b = 0; b < biased.length; b++) w[biased[b] - 1] = strength;
          out.push(drawWithoutReplacement(rand, w, cfg.picks));
        }
        return out;
      }
    },
    drift: {
      id: "drift",
      name: "Regime shift (5/35)",
      blurb: "Stationary for 60 draws, then the mechanism changes.",
      config: { poolMin: 1, poolMax: 35, picks: 5 },
      generate: function (cfg, n, seed) {
        var rand = mulberry32(seed || 99991);
        var out = [];
        for (var t = 0; t < n; t++) {
          var w = new Array(cfg.poolSize).fill(1);
          if (t > n * 0.5) {
            for (var i = 0; i < 8; i++) w[i] = 3.2;
          }
          out.push(drawWithoutReplacement(rand, w, cfg.picks));
        }
        return out;
      }
    }
  };

  function generateSample(id, n, seed) {
    var spec = SAMPLES[id] || SAMPLES.random;
    var cfg = normalizeConfig(spec.config);
    var rows = spec.generate(cfg, n || 120, seed);
    var lines = rows.map(function (r, i) {
      var nums = r
        .map(function (x) {
          return x + cfg.poolMin;
        })
        .sort(function (a, b) {
          return a - b;
        });
      return isoDate(i, rows.length) + "  " + nums.join("  ");
    });
    return { id: spec.id, name: spec.name, blurb: spec.blurb, config: cfg, text: lines.join("\n") };
  }

  function isoDate(i, total) {
    var base = Date.UTC(2026, 6, 29) - (total - 1 - i) * 3.5 * 86400000;
    return new Date(base).toISOString().slice(0, 10);
  }

  /* ====================================================================
   * 9. Monte Carlo simulator
   * --------------------------------------------------------------------
   * Two complementary simulation views, both framed probabilistically:
   *   - monteCarloEnvelope: what does *chance* produce? Replicate the null
   *     experiment R times and read the 95% envelope around the expected
   *     count for each number, then lay the observed counts over it.
   *   - predictionMonteCarlo: what does the *fitted model* expect next?
   *     Sample R next-draws from the model's probability vector, read the
   *     predicted rate per number against the null line, and report the
   *     modal next set together with how likely any exact set is.
   * Neither claims a certain outcome; the prediction is a distribution.
   * ================================================================== */

  /**
   * Replicate the null (sampling without replacement, D draws of k from N)
   * R times and build a Monte Carlo envelope around the expected count for
   * each number. The observed per-number counts are then compared against
   * the envelope: a number outside it deviates from chance at roughly the
   * stated level (with the usual multiplicity caveat across N numbers).
   */
  function monteCarloEnvelope(draws, config, opts) {
    var o = Object.assign({ replicates: 1000, level: 0.95, seed: 20260731 }, opts || {});
    var s = summarize(draws, config);
    var N = config.poolSize;
    var k = config.picks;
    var D = draws.length;
    var rand = mulberry32(o.seed >>> 0);

    var counts = [];
    for (var i = 0; i < N; i++) counts.push([]);
    for (var r = 0; r < o.replicates; r++) {
      var w = new Array(N).fill(1);
      for (var d = 0; d < D; d++) {
        var picked = drawWithoutReplacement(rand, w, k);
        for (var p = 0; p < picked.length; p++) counts[picked[p]][r] =
          (counts[picked[p]][r] || 0) + 1;
      }
    }

    var loQ = (1 - o.level) / 2;
    var hiQ = 1 - loQ;
    var rows = [];
    for (var n = 0; n < N; n++) {
      var arr = counts[n].map(function (x) { return x || 0; }).sort(function (a, b) { return a - b; });
      var lo = arr[Math.floor(loQ * arr.length)] != null ? arr[Math.floor(loQ * arr.length)] : 0;
      var hi = arr[Math.ceil(hiQ * arr.length) - 1] != null ? arr[Math.ceil(hiQ * arr.length) - 1] : 0;
      var meanSim = mean(arr);
      rows.push({
        number: label(n, config),
        observed: s.counts[n],
        expected: s.expectedCount,
        mcMean: meanSim,
        envelopeLo: lo,
        envelopeHi: hi,
        outside: s.counts[n] < lo || s.counts[n] > hi
      });
    }

    var outsideCount = rows.filter(function (x) { return x.outside; }).length;
    var expectedOutside = N * (1 - o.level);
    return {
      rows: rows,
      draws: D,
      replicates: o.replicates,
      level: o.level,
      expectedCount: s.expectedCount,
      outsideCount: outsideCount,
      expectedOutside: expectedOutside,
      // A fair mechanism still throws a few numbers outside a 95% envelope;
      // alarm is warranted only well beyond that chance rate.
      interpretation: outsideCount <= Math.ceil(expectedOutside * 2)
        ? "within the range chance produces"
        : "more numbers outside the envelope than chance explains"
    };
  }

  /**
   * Monte Carlo next-draw simulator for a fitted model. Draws R next-draws
   * from the model's per-number probability vector (any of the three tools),
   * then reads (a) the predicted appearance rate per number against the null,
   * and (b) the modal predicted set with its exact-set probability, compared
   * to the null's 1 / C(N, k). Always framed as a distribution, not a pick.
   */
  function predictionMonteCarlo(probabilities, config, opts) {
    var o = Object.assign({ replicates: 4000, topSet: true, seed: 20260731 }, opts || {});
    var N = config.poolSize;
    var k = config.picks;
    var q = k / N;
    var rand = mulberry32(o.seed >>> 0);

    // Normalize the model vector to a proper sampling distribution.
    var tot = sum(probabilities) || k;
    var w = probabilities.map(function (p) { return Math.max(0, p / tot); });

    var hits = new Array(N).fill(0);
    var setCounts = {};
    for (var r = 0; r < o.replicates; r++) {
      var picked = drawWithoutReplacement(rand, w.slice(), k);
      var key = null;
      var arr = [];
      for (var p = 0; p < picked.length; p++) {
        hits[picked[p]]++;
        arr.push(picked[p]);
      }
      if (o.topSet && arr.length === k) {
        arr.sort(function (a, b) { return a - b; });
        key = arr.join(",");
        setCounts[key] = (setCounts[key] || 0) + 1;
      }
    }

    var rows = hits.map(function (h, i) {
      var rate = h / o.replicates;
      return {
        number: label(i, config),
        predictedRate: rate,
        nullRate: q,
        lift: q > 0 ? rate / q : 1
      };
    });

    // Modal set and its exact probability.
    var bestKey = null;
    var bestCount = 0;
    Object.keys(setCounts).forEach(function (key) {
      if (setCounts[key] > bestCount) { bestCount = setCounts[key]; bestKey = key; }
    });
    var modalSet = bestKey ? bestKey.split(",").map(function (x) { return label(Number(x), config); }) : [];
    var modalSetProb = bestCount / o.replicates;

    // Null exact-set probability: 1 / C(N, k).
    var logComb = logGamma(N + 1) - logGamma(k + 1) - logGamma(N - k + 1);
    var nullSetProb = Math.exp(-logComb);

    return {
      rows: rows,
      replicates: o.replicates,
      modalSet: modalSet,
      modalSetProb: modalSetProb,
      nullSetProb: nullSetProb,
      totalSets: Math.exp(logComb),
      // How much more likely the model's modal set is than a random set.
      concentration: nullSetProb > 0 ? modalSetProb / nullSetProb : 1,
      // Where the model's probability actually concentrates (top-k numbers).
      topNumbers: rows.slice().sort(function (a, b) { return b.predictedRate - a.predictedRate; }).slice(0, k)
    };
  }

  /* ====================================================================
   * 9b. Streaming reservoir sampler (for live animated envelopes)
   * --------------------------------------------------------------------
   * A tiny fixed-capacity reservoir that keeps a uniform-ish random sample
   * of a stream so quantiles can be estimated on the fly. Deterministic for
   * a given seeded PRNG. Used by the animated Monte Carlo envelope so the
   * 95% band can build up live as the null replications accumulate.
   * ================================================================== */

  function reservoirSampler(rand, capacity) {
    var cap = Math.max(64, capacity || 512);
    var buf = [];
    var seen = 0;
    return {
      add: function (x) {
        seen++;
        if (buf.length < cap) {
          buf.push(x);
        } else {
          var j = Math.floor(rand() * seen);
          if (j < cap) buf[j] = x;
        }
      },
      count: function () { return seen; },
      quantile: function (q) {
        if (!buf.length) return 0;
        var s = buf.slice().sort(function (a, b) { return a - b; });
        var idx = clamp(Math.floor(q * (s.length - 1)), 0, s.length - 1);
        return s[idx];
      },
      mean: function () { return buf.length ? sum(buf) / buf.length : 0; }
    };
  }

  /* ====================================================================
   * 10. Public surface
   * ================================================================== */

  return {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    STOCHASTIC_DEFAULTS: STOCHASTIC_DEFAULTS,
    HYBRID_DEFAULTS: HYBRID_DEFAULTS,
    SAMPLES: SAMPLES,
    normalizeConfig: normalizeConfig,
    parseDraws: parseDraws,
    autoDetectConfig: autoDetectConfig,
    summarize: summarize,
    diagnostics: diagnostics,
    deriveAnalyticLaw: deriveAnalyticLaw,
    analyticScores: analyticScores,
    stochasticModel: stochasticModel,
    hybridModel: hybridModel,
    backtest: backtest,
    evaluateForecasts: evaluateForecasts,
    scorerFor: scorerFor,
    structureTests: structureTests,
    monteCarloEnvelope: monteCarloEnvelope,
    predictionMonteCarlo: predictionMonteCarlo,
    drawWithoutReplacement: drawWithoutReplacement,
    reservoirSampler: reservoirSampler,
    generateSample: generateSample,
    normalizeToPicks: normalizeToPicks,
    multiLabelLogLoss: multiLabelLogLoss,
    stats: {
      chiSquareP: chiSquareP,
      twoSidedZP: twoSidedZP,
      normalCdf: normalCdf,
      betaQuantile: betaQuantile,
      incompleteBeta: incompleteBeta,
      benjaminiHochberg: benjaminiHochberg,
      logGamma: logGamma,
      mean: mean,
      variance: variance,
      autocorr: autocorr,
      mulberry32: mulberry32
    }
  };
});
