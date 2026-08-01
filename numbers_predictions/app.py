#!/usr/bin/env python3
"""
Numbers Predictions Dashboard
=============================
Interactive web app implementing three interchangeable prediction tools:
1. Pattern Detected -> Analytic derivation of generating law
2. No Pattern Detected -> Statistical/stochastic model of recurrence frequency
3. Mixed Pattern -> Hybrid model

Based on: Future Recurrence Determined Law methodology.
Target set S = {3, 10, 13, 15, 17, 33, 37, 46}, phase space Z_46.
"""

import math
import json
import numpy as np
from scipy import stats, signal
from flask import Flask, request, jsonify, render_template

app = Flask(__name__, static_folder="static", template_folder="templates")

# ============================================================
# Constants from the document
# ============================================================
TARGET_SET = [3, 10, 13, 15, 17, 33, 37, 46]
PHASE_SPACE_SIZE = 46  # Z_46 = {0, 1, ..., 45}
NUM_ELEMENTS = len(TARGET_SET)  # 8


# ============================================================
# TOOL 1: Pattern Detected - Analytic Derivation of Generating Law
# ============================================================
class AnalyticModel:
    """Implements deterministic generating law formulas from the document."""

    def __init__(self, target_set=None, phase_space_size=46):
        self.S = target_set or TARGET_SET
        self.P = phase_space_size
        self.N = len(self.S)

    def time_horizon(self, t):
        """T(t) = t^t for t >= 1"""
        if t < 1:
            return 0
        # Use log to avoid overflow for large t
        try:
            return float(t) ** float(t)
        except OverflowError:
            return float("inf")

    def recurrence_mapping(self, t):
        """R(t) = sum_{s in S} s * 1{floor(T(t)) mod 46 = s}"""
        T_t = self.time_horizon(t)
        if math.isinf(T_t):
            return None
        floor_T = math.floor(T_t)
        mod_val = floor_T % self.P
        if mod_val in self.S:
            return mod_val
        return None

    def energy_function(self, x):
        """E(x) = 1 - 1_S(x)"""
        return 1 if x not in self.S else 0

    def redistribution_kernel(self, t, eta_func=None):
        """K_{ij}(t) = exp(-eta(t)|A_i - A_j|) / sum_l exp(-eta(t)|A_l - A_j|)"""
        if eta_func is None:
            eta_func = lambda t: 1.0 / (1.0 + math.log1p(t))

        eta = eta_func(t)
        A = self.S
        n = len(A)
        K = np.zeros((n, n))
        for j in range(n):
            denom = sum(math.exp(-eta * abs(A[l] - A[j])) for l in range(n))
            if denom == 0:
                denom = 1e-10
            for i in range(n):
                K[i][j] = math.exp(-eta * abs(A[i] - A[j])) / denom
        return K

    def redistributed_probability(self, p, t, eta_func=None):
        """p_tilde_i(t) = sum_j K_{ij}(t) p_j(t)"""
        K = self.redistribution_kernel(t, eta_func)
        return K @ np.array(p)

    def master_formula(self, n, t, alpha=1.0, omega=1.0, gamma=0.5, B_func=None):
        """X_{n,t} = A_{B(floor(n^alpha + omega*t^gamma) mod P)}"""
        if B_func is None:
            # Default B: identity-like mapping over the target set indices
            def B_func(s):
                return s % self.N

        exponent = n ** alpha + omega * (t ** gamma if t > 0 else 0)
        idx = B_func(math.floor(exponent) % self.P)
        if 0 <= idx < self.N:
            return self.S[idx]
        return None

    def horizon(self, t, H=2.0, gamma=0.5):
        """N(t) = ceil(H^{t^gamma})"""
        return math.ceil(H ** (t ** gamma))

    def recurrence_distribution(self, t, alpha=1.0, omega=1.0, gamma=0.5, H=2.0, B_func=None):
        """p_i(t) = (1/N(t)) sum_{n=0}^{N(t)-1} 1[X_{n,t} = A_i]"""
        N_t = self.horizon(t, H, gamma)
        N_t = min(N_t, 5000)  # Cap for computational feasibility
        counts = np.zeros(self.N)
        for n in range(N_t):
            x = self.master_formula(n, t, alpha, omega, gamma, B_func)
            if x is not None and x in self.S:
                counts[self.S.index(x)] += 1
        return counts / N_t if N_t > 0 else counts

    def long_run_distribution(self, B_func=None):
        """p_i^infty = #{s in {0,...,P-1} : B(s)=i} / P"""
        if B_func is None:
            def B_func(s):
                return s % self.N
        counts = np.zeros(self.N)
        for s in range(self.P):
            idx = B_func(s)
            if 0 <= idx < self.N:
                counts[idx] += 1
        return counts / self.P

    def generate_sequence(self, t_max=20, alpha=1.0, omega=1.0, gamma=0.5, B_func=None):
        """Generate recurrence sequence R(t) for t=1..t_max"""
        results = []
        for t in range(1, t_max + 1):
            r = self.recurrence_mapping(t)
            results.append({"t": t, "R(t)": r, "T(t)": self.time_horizon(t)})
        return results


# ============================================================
# TOOL 2: No Pattern - Statistical/Stochastic Model
# ============================================================
class StochasticModel:
    """Statistical and stochastic recurrence frequency models."""

    def __init__(self, target_set=None, phase_space_size=46):
        self.S = set(target_set or TARGET_SET)
        self.P = phase_space_size
        self.N = len(self.S)
        self.S_list = sorted(self.S)

    def expected_occurrences(self, num_draws):
        """E[C_i(N)] = N * p_i, for uniform p_i = 1/8 -> N/8"""
        p = 1.0 / self.N
        return {"expected": num_draws * p, "p_i": p, "N": num_draws}

    def _phase_value(self, s):
        """Map target set value to phase space position (46 -> 0 mod 46)."""
        return s % self.P

    def monte_carlo_simulation(self, num_draws=1000, num_simulations=10000, rng=None):
        """Monte Carlo simulation of random draws from phase space."""
        if rng is None:
            rng = np.random.default_rng()
        # Simulate draws from Z_46
        # Map target values to phase space positions
        phase_values = [self._phase_value(s) for s in self.S_list]
        all_counts = np.zeros((num_simulations, self.N))
        for sim in range(num_simulations):
            draws = rng.integers(0, self.P, size=num_draws)
            for i, pv in enumerate(phase_values):
                all_counts[sim, i] = np.sum(draws == pv)
        
        mean_counts = np.mean(all_counts, axis=0)
        std_counts = np.std(all_counts, axis=0)
        ci_lower = np.percentile(all_counts, 2.5, axis=0)
        ci_upper = np.percentile(all_counts, 97.5, axis=0)
        
        return {
            "values": self.S_list,
            "mean_counts": mean_counts.tolist(),
            "std_counts": std_counts.tolist(),
            "ci_lower": ci_lower.tolist(),
            "ci_upper": ci_upper.tolist(),
            "expected": (num_draws / self.N),
            "num_draws": num_draws,
            "num_simulations": num_simulations
        }

    def markov_chain_analysis(self, historical_draws, order=1):
        """Build Markov transition matrix from historical data."""
        if len(historical_draws) < 2:
            return None
        
        # Build transition matrix over phase space
        trans = np.zeros((self.P, self.P))
        for i in range(len(historical_draws) - order):
            current = historical_draws[i] % self.P
            next_val = historical_draws[i + order] % self.P
            trans[current][next_val] += 1
        
        # Normalize
        row_sums = trans.sum(axis=1, keepdims=True)
        row_sums[row_sums == 0] = 1
        trans = trans / row_sums
        
        # Get transition probabilities for target set values
        target_trans = {}
        for s in self.S_list:
            if s < self.P:
                probs = trans[s].tolist()
                target_trans[s] = {
                    "to": list(range(self.P)),
                    "probs": probs,
                    "top_targets": sorted(
                        [(j, probs[j]) for j in range(self.P) if probs[j] > 0],
                        key=lambda x: -x[1]
                    )[:5]
                }
        return target_trans

    def poisson_model(self, num_draws=1000, rate=None):
        """Poisson process modeling for recurrence times."""
        if rate is None:
            rate = self.N / self.P  # Expected rate of hitting target set
        
        # Expected inter-arrival times
        mean_interval = 1.0 / rate
        # Poisson lambda for number of hits in N draws
        lam = rate * num_draws
        
        # P(X = k) for k = 0, 1, ..., 20
        k_values = list(range(0, 21))
        pmf = [stats.poisson.pmf(k, lam) for k in k_values]
        cdf = [stats.poisson.cdf(k, lam) for k in k_values]
        
        return {
            "rate": rate,
            "lambda": lam,
            "mean_interval": mean_interval,
            "k_values": k_values,
            "pmf": pmf,
            "cdf": cdf,
            "num_draws": num_draws
        }

    def frequency_analysis(self, historical_draws):
        """Analyze observed frequencies vs expected."""
        total = len(historical_draws)
        if total == 0:
            return None
        
        observed = np.zeros(self.N)
        for draw in historical_draws:
            # Map draw to phase space and check against target values
            for i, s in enumerate(self.S_list):
                if draw % self.P == s % self.P:
                    observed[i] += 1
        
        expected = np.full(self.N, total / self.N)
        # Chi-square test
        if np.sum(observed) > 0:
            chi2, p_value = stats.chisquare(observed, expected)
        else:
            chi2, p_value = 0, 1.0
        
        return {
            "values": self.S_list,
            "observed": observed.tolist(),
            "expected": expected.tolist(),
            "frequencies": (observed / total).tolist(),
            "expected_freq": (1.0 / self.N),
            "chi2": float(chi2),
            "p_value": float(p_value),
            "total": total
        }

    def law_of_large_numbers(self, max_draws=5000, num_trials=100):
        """Demonstrate LLN convergence."""
        rng = np.random.default_rng(42)
        draw_counts = [10, 50, 100, 200, 500, 1000, 2000, 5000]
        max_count = max(draw_counts)
        
        convergence = []
        for target_idx in range(self.N):
            target_val = self.S_list[target_idx]
            phase_val = target_val % self.P
            freqs_at_n = {"value": target_val, "trials": {}}
            for n in draw_counts:
                trial_freqs = []
                for _ in range(min(num_trials, 20)):
                    draws = rng.integers(0, self.P, size=n)
                    freq = np.sum(draws == phase_val) / n
                    trial_freqs.append(freq)
                freqs_at_n["trials"][str(n)] = {
                    "mean": float(np.mean(trial_freqs)),
                    "std": float(np.std(trial_freqs)),
                    "min": float(np.min(trial_freqs)),
                    "max": float(np.max(trial_freqs))
                }
            convergence.append(freqs_at_n)
        return {"convergence": convergence, "expected": 1.0 / self.N}

    def randomness_tests(self, historical_draws):
        """Run statistical randomness tests."""
        if len(historical_draws) < 10:
            return {"error": "Insufficient data for randomness tests"}
        
        arr = np.array(historical_draws)
        results = {}
        
        # Autocorrelation
        if len(arr) > 2:
            acf = signal.correlate(arr - arr.mean(), arr - arr.mean(), mode="full")
            acf = acf / acf[len(acf) // 2]  # Normalize
            mid = len(acf) // 2
            results["autocorrelation"] = {
                "lags": list(range(-min(10, mid), min(10, mid) + 1)),
                "values": acf[mid - min(10, mid):mid + min(10, mid) + 1].tolist()
            }
        
        # Runs test
        median = np.median(arr)
        binary = (arr > median).astype(int)
        runs = 1 + np.sum(np.diff(binary) != 0)
        n1 = np.sum(binary == 1)
        n0 = np.sum(binary == 0)
        if n1 > 0 and n0 > 0:
            expected_runs = 2 * n1 * n0 / (n1 + n0) + 1
            var_runs = 2 * n1 * n0 * (2 * n1 * n0 - n1 - n0) / ((n1 + n0) ** 2 * (n1 + n0 - 1))
            z_runs = (runs - expected_runs) / math.sqrt(max(var_runs, 1e-10))
            p_runs = 2 * (1 - stats.norm.cdf(abs(z_runs)))
            results["runs_test"] = {
                "observed_runs": int(runs),
                "expected_runs": float(expected_runs),
                "z_statistic": float(z_runs),
                "p_value": float(p_runs)
            }
        
        # Entropy
        value_counts = np.bincount(arr, minlength=self.P)
        probs = value_counts / len(arr)
        probs = probs[probs > 0]
        entropy = -np.sum(probs * np.log2(probs))
        max_entropy = math.log2(self.P)
        results["entropy"] = {
            "observed": float(entropy),
            "maximum": float(max_entropy),
            "ratio": float(entropy / max_entropy)
        }
        
        # Kolmogorov-Smirnov test against uniform
        unique_vals = sorted(set(arr.tolist()))
        if len(unique_vals) > 1:
            ks_stat, ks_p = stats.kstest(arr, "uniform", args=(0, self.P))
            results["ks_test"] = {
                "statistic": float(ks_stat),
                "p_value": float(ks_p)
            }
        
        return results


# ============================================================
# TOOL 3: Hybrid Model - Pattern Detection + Stochastic Residual
# ============================================================
class HybridModel:
    """Combines deterministic pattern detection with stochastic modeling."""

    def __init__(self, target_set=None, phase_space_size=46):
        self.S = target_set or TARGET_SET
        self.S_set = set(self.S)
        self.P = phase_space_size
        self.N = len(self.S)
        self.analytic = AnalyticModel(self.S, self.P)
        self.stochastic = StochasticModel(self.S, self.P)

    def detect_patterns(self, historical_draws):
        """Run pattern detection tests on historical data."""
        if len(historical_draws) < 5:
            return {"error": "Insufficient data"}
        
        arr = np.array(historical_draws)
        results = {
            "modular_arithmetic": {},
            "prime_factors": {},
            "digit_patterns": {},
            "spectral": {},
            "deterministic_score": 0.0
        }
        
        # Modular arithmetic tests
        for mod in [2, 3, 5, 7, 11, 23, 46]:
            residues = arr % mod
            unique_residues = set(residues.tolist())
            # Check if residues are concentrated
            counts = np.bincount(residues, minlength=mod)
            max_count = np.max(counts)
            concentration = max_count / len(arr)
            results["modular_arithmetic"][f"mod_{mod}"] = {
                "residues": sorted(unique_residues),
                "concentration": float(concentration),
                "distribution": counts.tolist()
            }
        
        # Prime factorization patterns
        def prime_factors(n):
            factors = []
            d = 2
            while d * d <= n:
                while n % d == 0:
                    factors.append(d)
                    n //= d
                d += 1
            if n > 1:
                factors.append(n)
            return factors
        
        factor_patterns = {}
        for v in self.S:
            factor_patterns[v] = prime_factors(v)
        results["prime_factors"]["target_set"] = factor_patterns
        
        # Digit-level patterns
        digit_sums = [sum(int(d) for d in str(v)) for v in self.S]
        results["digit_patterns"]["digit_sums"] = digit_sums
        results["digit_patterns"]["mean_digit_sum"] = float(np.mean(digit_sums))
        results["digit_patterns"]["std_digit_sum"] = float(np.std(digit_sums))
        
        # Spectral analysis (FFT)
        if len(arr) > 4:
            fft_vals = np.fft.fft(arr - np.mean(arr))
            magnitudes = np.abs(fft_vals)[:len(arr) // 2]
            frequencies = np.fft.fftfreq(len(arr))[:len(arr) // 2]
            # Dominant frequencies
            top_indices = np.argsort(magnitudes)[-5:][::-1]
            results["spectral"]["dominant_freqs"] = frequencies[top_indices].tolist()
            results["spectral"]["magnitudes"] = magnitudes[top_indices].tolist()
            results["spectral"]["all_magnitudes"] = magnitudes.tolist()
        
        # Compute deterministic score (0-1)
        score = 0.0
        # Check modular concentration
        max_mod_concentration = 0
        for mod_key, mod_data in results["modular_arithmetic"].items():
            if mod_data["concentration"] > max_mod_concentration:
                max_mod_concentration = mod_data["concentration"]
        score += max_mod_concentration * 0.3
        
        # Spectral energy concentration
        if "magnitudes" in results["spectral"] and len(results["spectral"]["all_magnitudes"]) > 0:
            all_mags = np.array(results["spectral"]["all_magnitudes"])
            top_3_energy = np.sum(np.sort(all_mags)[-3:])
            total_energy = np.sum(all_mags)
            if total_energy > 0:
                score += (top_3_energy / total_energy) * 0.4
        
        # Autocorrelation significance
        if len(arr) > 2:
            acf = np.correlate(arr - arr.mean(), arr - arr.mean(), mode="full")
            acf = acf / acf[len(acf) // 2]
            mid = len(acf) // 2
            side = acf[mid - 5:mid + 6]
            peak_ratio = np.max(np.abs(side[6:])) if len(side) > 6 else 0
            score += min(peak_ratio * 0.3, 0.3)
        
        results["deterministic_score"] = min(score, 1.0)
        results["stochastic_score"] = 1.0 - results["deterministic_score"]
        return results

    def hybrid_prediction(self, historical_draws, num_predictions=10, alpha=1.0, omega=1.0, gamma=0.5):
        """Generate predictions combining deterministic + stochastic components."""
        # Get pattern detection results
        patterns = self.detect_patterns(historical_draws)
        det_score = patterns.get("deterministic_score", 0.0)
        
        # Deterministic component: recurrence mapping
        t_start = len(historical_draws) + 1
        deterministic_preds = []
        for t in range(t_start, t_start + num_predictions):
            r = self.analytic.recurrence_mapping(t)
            deterministic_preds.append(r if r is not None else -1)
        
        # Stochastic component: frequency-weighted random draws
        freq_data = self.stochastic.frequency_analysis(historical_draws)
        observed_freqs = np.array(freq_data["frequencies"]) if freq_data else np.full(self.N, 1.0 / self.N)
        
        rng = np.random.default_rng()
        stochastic_preds = []
        for _ in range(num_predictions):
            # Sample from target set based on observed frequencies
            idx = rng.choice(self.N, p=observed_freqs / np.sum(observed_freqs))
            stochastic_preds.append(self.S[idx])
        
        # Weighted combination
        combined_preds = []
        for i in range(num_predictions):
            if det_score > 0.5:
                # Primarily deterministic with stochastic fallback
                if deterministic_preds[i] != -1 and deterministic_preds[i] in self.S_set:
                    combined_preds.append(deterministic_preds[i])
                else:
                    combined_preds.append(stochastic_preds[i])
            else:
                # Primarily stochastic with deterministic bias
                combined_preds.append(stochastic_preds[i])
        
        return {
            "deterministic_predictions": deterministic_preds,
            "stochastic_predictions": stochastic_preds,
            "combined_predictions": combined_preds,
            "deterministic_score": det_score,
            "stochastic_score": 1.0 - det_score,
            "patterns": patterns
        }

    def adaptive_learning(self, historical_draws, num_predictions=10, learning_rate=0.1):
        """Online learning with exponential weights (multiplicative weights algorithm)."""
        if len(historical_draws) < 2:
            return {"error": "Insufficient data"}
        
        # Initialize weights for each value in phase space
        weights = np.ones(self.P)
        
        # Online update
        weight_history = []
        for draw in historical_draws:
            # Map draw to phase space index (46 -> 0)
            draw_idx = draw % self.P
            # Loss: 1 if we didn't predict this value, 0 if we did
            prediction = np.argmax(weights)
            loss = 1.0 if prediction != draw_idx else 0.0
            # Update weights
            weights[draw_idx] *= (1 - learning_rate * loss)
            # Normalize
            weights = weights / np.sum(weights)
            weight_history.append(weights.copy())
        
        # Predict next values
        predictions = []
        current_weights = weights.copy()
        for _ in range(num_predictions):
            # Sample from current weights
            pred = np.random.choice(self.P, p=current_weights)
            predictions.append(int(pred))
            # Simulate feedback (no real feedback, so weights stay)
        
        # Target set probability distribution (map 46 -> 0 in phase space)
        target_probs = [weights[self.S[i] % self.P] for i in range(self.N)]
        
        return {
            "predictions": predictions,
            "target_set_probs": target_probs,
            "all_weights": weights.tolist(),
            "weight_history_entropy": float(-np.sum(weights * np.log(weights + 1e-10))),
            "learning_rate": learning_rate
        }

    def game_theoretic_analysis(self, historical_draws):
        """Fictitious play / replicator dynamics analysis."""
        if len(historical_draws) < 5:
            return {"error": "Insufficient data"}
        
        arr = np.array(historical_draws)
        # Strategy space: each value in target set is a pure strategy
        # Payoff: frequency of occurrence
        
        # Fictitious play: track empirical frequencies
        freq_history = np.zeros((len(arr), self.N))
        for t in range(len(arr)):
            if arr[t] in self.S_set:
                idx = self.S.index(arr[t])
                freq_history[t, idx] = 1
            # Cumulative frequency
            if t > 0:
                freq_history[t] += freq_history[t - 1] * t
            freq_history[t] /= (t + 1)
        
        # Replicator dynamics: dx_i/dt = x_i * (fitness_i - avg_fitness)
        # Fitness = observed frequency
        final_freqs = freq_history[-1] if len(freq_history) > 0 else np.zeros(self.N)
        avg_fitness = np.mean(final_freqs)
        
        # Growth rates
        growth_rates = final_freqs - avg_fitness
        
        # Nash equilibrium approximation
        # Mixed strategy that equalizes payoffs
        nash_approx = np.ones(self.N) / self.N  # Uniform as baseline
        
        return {
            "empirical_frequencies": final_freqs.tolist(),
            "growth_rates": growth_rates.tolist(),
            "nash_approximation": nash_approx.tolist(),
            "values": self.S,
            "convergence": float(np.std(final_freqs)),
            "freq_history": freq_history[::max(1, len(arr) // 50)].tolist()  # Subsample
        }


# ============================================================
# Flask Routes
# ============================================================

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/analytic/generate", methods=["POST"])
def analytic_generate():
    data = request.json or {}
    t_max = int(data.get("t_max", 20))
    alpha = float(data.get("alpha", 1.0))
    omega = float(data.get("omega", 1.0))
    gamma = float(data.get("gamma", 0.5))
    H = float(data.get("H", 2.0))
    custom_set = data.get("target_set")
    
    model = AnalyticModel(custom_set, 46) if custom_set else AnalyticModel()
    
    sequence = model.generate_sequence(t_max, alpha, omega, gamma)
    
    # Also compute distributions for a few t values
    t_sample = [1, 5, 10, 15, 20] if t_max >= 20 else list(range(1, t_max + 1))
    distributions = []
    for t in t_sample:
        dist = model.recurrence_distribution(t, alpha, omega, gamma, H)
        distributions.append({"t": t, "distribution": dist.tolist()})
    
    long_run = model.long_run_distribution()
    
    return jsonify({
        "sequence": sequence,
        "distributions": distributions,
        "long_run_distribution": long_run.tolist(),
        "target_set": model.S,
        "params": {"alpha": alpha, "omega": omega, "gamma": gamma, "H": H, "t_max": t_max}
    })


@app.route("/api/analytic/kernel", methods=["POST"])
def analytic_kernel():
    data = request.json or {}
    t = float(data.get("t", 5))
    custom_set = data.get("target_set")
    
    model = AnalyticModel(custom_set, 46) if custom_set else AnalyticModel()
    K = model.redistribution_kernel(t)
    p_uniform = np.ones(model.N) / model.N
    p_redistributed = model.redistributed_probability(p_uniform, t)
    
    return jsonify({
        "kernel": K.tolist(),
        "uniform_prob": p_uniform.tolist(),
        "redistributed_prob": p_redistributed.tolist(),
        "values": model.S,
        "t": t
    })


@app.route("/api/stochastic/monte_carlo", methods=["POST"])
def stochastic_monte_carlo():
    data = request.json or {}
    num_draws = int(data.get("num_draws", 1000))
    num_simulations = int(data.get("num_simulations", 10000))
    custom_set = data.get("target_set")
    
    model = StochasticModel(custom_set, 46) if custom_set else StochasticModel()
    result = model.monte_carlo_simulation(num_draws, num_simulations)
    return jsonify(result)


@app.route("/api/stochastic/poisson", methods=["POST"])
def stochastic_poisson():
    data = request.json or {}
    num_draws = int(data.get("num_draws", 1000))
    rate = data.get("rate")
    rate = float(rate) if rate is not None else None
    custom_set = data.get("target_set")
    
    model = StochasticModel(custom_set, 46) if custom_set else StochasticModel()
    result = model.poisson_model(num_draws, rate)
    return jsonify(result)


@app.route("/api/stochastic/markov", methods=["POST"])
def stochastic_markov():
    data = request.json or {}
    draws = data.get("draws", [])
    order = int(data.get("order", 1))
    custom_set = data.get("target_set")
    
    if not draws:
        return jsonify({"error": "No historical draws provided"}), 400
    
    model = StochasticModel(custom_set, 46) if custom_set else StochasticModel()
    result = model.markov_chain_analysis(draws, order)
    return jsonify(result)


@app.route("/api/stochastic/frequency", methods=["POST"])
def stochastic_frequency():
    data = request.json or {}
    draws = data.get("draws", [])
    custom_set = data.get("target_set")
    
    if not draws:
        return jsonify({"error": "No historical draws provided"}), 400
    
    model = StochasticModel(custom_set, 46) if custom_set else StochasticModel()
    result = model.frequency_analysis(draws)
    return jsonify(result)


@app.route("/api/stochastic/lln", methods=["POST"])
def stochastic_lln():
    data = request.json or {}
    max_draws = int(data.get("max_draws", 5000))
    custom_set = data.get("target_set")
    
    model = StochasticModel(custom_set, 46) if custom_set else StochasticModel()
    result = model.law_of_large_numbers(max_draws)
    return jsonify(result)


@app.route("/api/stochastic/randomness", methods=["POST"])
def stochastic_randomness():
    data = request.json or {}
    draws = data.get("draws", [])
    custom_set = data.get("target_set")
    
    if not draws or len(draws) < 10:
        return jsonify({"error": "Need at least 10 draws for randomness tests"}), 400
    
    model = StochasticModel(custom_set, 46) if custom_set else StochasticModel()
    result = model.randomness_tests(draws)
    return jsonify(result)


@app.route("/api/hybrid/detect", methods=["POST"])
def hybrid_detect():
    data = request.json or {}
    draws = data.get("draws", [])
    custom_set = data.get("target_set")
    
    if not draws or len(draws) < 5:
        return jsonify({"error": "Need at least 5 draws for pattern detection"}), 400
    
    model = HybridModel(custom_set, 46) if custom_set else HybridModel()
    result = model.detect_patterns(draws)
    return jsonify(result)


@app.route("/api/hybrid/predict", methods=["POST"])
def hybrid_predict():
    data = request.json or {}
    draws = data.get("draws", [])
    num_predictions = int(data.get("num_predictions", 10))
    alpha = float(data.get("alpha", 1.0))
    omega = float(data.get("omega", 1.0))
    gamma = float(data.get("gamma", 0.5))
    custom_set = data.get("target_set")
    
    if not draws or len(draws) < 5:
        return jsonify({"error": "Need at least 5 draws for hybrid prediction"}), 400
    
    model = HybridModel(custom_set, 46) if custom_set else HybridModel()
    result = model.hybrid_prediction(draws, num_predictions, alpha, omega, gamma)
    return jsonify(result)


@app.route("/api/hybrid/adaptive", methods=["POST"])
def hybrid_adaptive():
    data = request.json or {}
    draws = data.get("draws", [])
    num_predictions = int(data.get("num_predictions", 10))
    learning_rate = float(data.get("learning_rate", 0.1))
    custom_set = data.get("target_set")
    
    if not draws or len(draws) < 2:
        return jsonify({"error": "Need at least 2 draws for adaptive learning"}), 400
    
    model = HybridModel(custom_set, 46) if custom_set else HybridModel()
    result = model.adaptive_learning(draws, num_predictions, learning_rate)
    return jsonify(result)


@app.route("/api/hybrid/game_theory", methods=["POST"])
def hybrid_game_theory():
    data = request.json or {}
    draws = data.get("draws", [])
    custom_set = data.get("target_set")
    
    if not draws or len(draws) < 5:
        return jsonify({"error": "Need at least 5 draws for game-theoretic analysis"}), 400
    
    model = HybridModel(custom_set, 46) if custom_set else HybridModel()
    result = model.game_theoretic_analysis(draws)
    return jsonify(result)


@app.route("/api/info", methods=["GET"])
def info():
    return jsonify({
        "target_set": TARGET_SET,
        "phase_space_size": PHASE_SPACE_SIZE,
        "num_elements": NUM_ELEMENTS,
        "tools": {
            "analytic": "Pattern Detected - Analytic Derivation of Generating Law",
            "stochastic": "No Pattern Detected - Statistical/Stochastic Model of Recurrence Frequency",
            "hybrid": "Mixed Pattern - Hybrid Model"
        },
        "formulas": {
            "time_horizon": "T(t) = t^t for t >= 1",
            "recurrence_mapping": "R(t) = sum_{s in S} s * 1{floor(T(t)) mod 46 = s}",
            "energy": "E(x) = 1 - 1_S(x)",
            "redistribution_kernel": "K_ij(t) = exp(-eta(t)|A_i - A_j|) / sum_l exp(-eta(t)|A_l - A_j|)",
            "master_formula": "X_{n,t} = A_{B(floor(n^alpha + omega*t^gamma) mod P)}",
            "horizon": "N(t) = ceil(H^{t^gamma})",
            "recurrence_distribution": "p_i(t) = (1/N(t)) sum_{n=0}^{N(t)-1} 1[X_{n,t} = A_i]",
            "long_run": "p_i^infty = #{s in {0,...,P-1} : B(s)=i} / P",
            "expected_occurrences": "E[C_i(N)] = N * p_i, uniform = N/8"
        }
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5212, debug=True)
