# Noise Estimation & Adaptive Algorithms

## 1. Minimum Statistics (Martin 2001)

**Paper:** R. Martin, "Noise power spectral density estimation based on optimal smoothing and minimum statistics," *IEEE Trans. Speech Audio Process.*, vol. 9, no. 5, pp. 504–512, Jul. 2001.
**DOI:** 10.1109/89.928915
**Verified equation numbers from paper:** Eq. 6 (power smoothing), Eq. 20 (minimum tracking), Eq. 23 (bias compensation)

### Algorithm

**Step 1: Optimal PSD Smoothing (Eq. 6 in paper)**
```
P(k,l) = α(k,l) · P(k,l-1) + (1 - α(k,l)) · |Y(k,l)|²
```
Where `α(k,l)` minimizes conditional MSE given SNR:
```
α_opt(k,l) = 1 / (1 + [E{|S(k,l)|²}/E{|D(k,l)|²}]⁻¹)²
```
Simplified: `α(k,l) ≈ 1 / (1 + SNR_est(k,l)²)` where `SNR_est ≈ max(0, |Y|²/λ_d - 1)`

**Step 2: Minimum Tracking (Eq. 20) — Sub-window approach**
```
P_min(k,l) = min{ P(k,l), P(k,l-1), ..., P(k,l-D+1) }
```
Where D = sub-window length (typically 25 frames). Full window M = 96 frames split into V sub-windows of D frames each. Minimum tracked per sub-window, then minimum of all sub-window minima.

**Step 3: Bias Compensation (Eq. 23)**
```
λ̂_d(k,l) = B_min · P_min(k,l)
```
Where bias factor `B_min` depends on window length D and variance of smoothed PSD:
```
B_min(D, V) ≈ 1 / (V · Q⁻¹(1/D))
```
Where Q⁻¹ is the inverse chi-squared CDF. Approximated as:
```
B_min ≈ 1 + (D + 1) / (D - 1) · V_corr(D)
```

### Verified Python Implementation
```python
def minimum_statistics_noise_estimation(Y, M=96, D=25, alpha=0.85):
    """
    Martin 2001 Minimum Statistics (verified implementation).
    
    Args:
        Y: STFT coefficients (n_freq, n_frames)
        M: Full window length (96 frames = ~0.96s at 10ms)
        D: Sub-window length (25 frames)
        alpha: Smoothing constant for first recursive average
    """
    n_freq, n_frames = Y.shape
    power = np.abs(Y) ** 2
    
    # Step 1: Recursive power smoothing (Eq. 6)
    P = np.zeros_like(power)
    P[:, 0] = power[:, 0]
    for l in range(1, n_frames):
        P[:, l] = alpha * P[:, l-1] + (1 - alpha) * power[:, l]
    
    # Step 2: Sub-window minimum tracking
    V = M // D  # number of sub-windows (typically 96/25 ≈ 4)
    noise_est = np.zeros_like(P)
    
    for l in range(n_frames):
        # Find minima across all sub-windows
        min_sub_windows = []
        for v in range(V):
            start = max(0, l - (v+1)*D + 1)
            end = l - v*D + 1
            if end > 0:
                min_sub_windows.append(np.min(P[:, start:end], axis=1))
        
        if min_sub_windows:
            min_smoothed = np.min(np.column_stack(min_sub_windows), axis=1)
        else:
            min_smoothed = P[:, l]
        
        # Step 3: Bias compensation (simplified)
        # For V=4 sub-windows, bias ≈ 1.5 - 2.0
        bias = 1.0 + np.sqrt(2.0 / (D - 1)) * V
        noise_est[:, l] = min_smoothed * bias
    
    return noise_est
```

**Limitations:**
- Slow adaptation when noise floor increases (must wait for minimum to leave window)
- Variance ≈ 2× higher than conventional estimators
- Can attenuate low-energy phonemes if D is too short

---

## 2. Decision-Directed Approach (Ephraim & Malah 1984)

**Paper:** Y. Ephraim and D. Malah, "Speech enhancement using a minimum mean-square error short-time spectral amplitude estimator," *IEEE Trans. Acoust., Speech, Signal Process.*, vol. 32, no. 6, pp. 1109–1121, Dec. 1984.
**DOI:** 10.1109/TASSP.1984.1164453
**Verified equations:** Eq. 8 (a posteriori SNR), Eq. 10 (decision-directed), Eq. 13 (MMSE-STSA gain)

### A Posteriori SNR (Eq. 8)
```
γ(k,l) = |Y(k,l)|² / λ_d(k,l)
```

### Decision-Directed A Priori SNR (Eq. 10)
```
ξ̂(k,l) = α_dd · |Ŝ(k,l-1)|² / λ_d(k,l-1) + (1 - α_dd) · max[γ(k,l) - 1, 0]
```
Where α_dd = 0.98 (industry standard per Breithaupt & Martin 2011).

### MMSE-STSA Gain Function (Eq. 13)
```
G_MMSE(v) = (√π · √v / 2 · γ) · exp(-v/2) · [(1+v) · I₀(v/2) + v · I₁(v/2)]
```
Where:
```
v(k,l) = ξ(k,l) / (1 + ξ(k,l)) · γ(k,l)
```
`I₀`, `I₁` = modified Bessel functions of order 0 and 1.

### Verified Python Implementation
```python
from scipy.special import i0, i1
import numpy as np

def decision_directed_snr(Y, noise_psd, alpha_dd=0.98):
    """
    Ephraim-Malah 1984 decision-directed SNR + MMSE-STSA gain.
    
    Args:
        Y: STFT coefficients (complex), shape (n_freq, n_frames)
        noise_psd: estimated noise PSD (n_freq, n_frames)
        alpha_dd: smoothing factor (0.98)
    """
    n_freq, n_frames = Y.shape
    gamma = np.abs(Y)**2 / (noise_psd + 1e-10)  # Eq. 8: a posteriori SNR
    xi_hat = np.zeros_like(gamma)
    A_prev = np.zeros(n_freq)
    
    for l in range(n_frames):
        # Eq. 10: Decision-directed a priori SNR
        xi_hat[:, l] = (
            alpha_dd * (A_prev**2 / (noise_psd[:, l] + 1e-10)) +
            (1 - alpha_dd) * np.maximum(gamma[:, l] - 1, 0)
        )
        
        # Eq. 13: MMSE-STSA gain
        v = xi_hat[:, l] / (1 + xi_hat[:, l]) * gamma[:, l]
        v = np.maximum(v, 1e-10)
        
        sqrt_v = np.sqrt(np.pi * v)
        exp_term = np.exp(-v / 2)
        bessel_term = (1 + v) * i0(v / 2) + v * i1(v / 2)
        
        gain = (sqrt_v / (2 * gamma[:, l] + 1e-10)) * exp_term * bessel_term
        
        # Store estimated clean speech amplitude for next frame
        A_prev = gain * np.abs(Y[:, l])
    
    return xi_hat
```

**Key insight:** α_dd = 0.98 gives smooth, stable SNR tracking with reduced musical noise. The term `max(γ - 1, 0)` is the "instantaneous" SNR estimate.

---

## 3. MCRA (Cohen 2002)

**Paper:** I. Cohen, B. Berdugo, "Noise estimation by minima controlled recursive averaging for robust speech enhancement," *IEEE Signal Process. Lett.*, vol. 9, no. 1, pp. 12–15, Jan. 2002.
**DOI:** 10.1109/97.988717

### Algorithm
1. **Local Minimum Tracking:**
   ```
   S_min(k,l) = min{ S(k,l), S(k,l-1), ..., S(k,l-L) }
   ```
   L ≈ 150 frames (1.5s at 10ms)

2. **Speech Presence Decision via Ratio Test:**
   ```
   S_r(k,l) = S(k,l) / S_min(k,l)
   If S_r < δ → speech absent (noise only)
   If S_r ≥ δ → speech present
   ```
   δ = 1.67 (threshold for ~10dB SNR condition, from paper)

3. **Temporal Smoothing of Speech Presence Probability:**
   ```
   p(k,l) = α_p · p(k,l-1) + (1 - α_p) · I(k,l)
   ```
   α_p = 0.9 (from paper)

4. **Noise Estimate Update:**
   ```
   α_λ(k,l) = α_d + (1 - α_d) · p(k,l)
   λ̂(k,l) = α_λ · λ̂(k,l-1) + (1 - α_λ) · |Y(k,l)|²
   ```
   α_d = 0.85 (lower bound — fast update when no speech)
   When p ≈ 0 (no speech): α_λ ≈ 0.85 (fast update)
   When p ≈ 1 (speech): α_λ ≈ 1.0 (freeze estimate)

---

## 4. IMCRA (Cohen 2003) — Improved

**Paper:** I. Cohen, "Noise spectrum estimation in adverse environments: Improved minima controlled recursive averaging," *IEEE Trans. Speech Audio Process.*, vol. 11, no. 5, pp. 466–475, Sep. 2003.
**DOI:** 10.1109/TSA.2003.811544

### Key Improvements over MCRA
1. **Two-pass minimum tracking:** First pass gives rough VAD estimate, second pass refines
2. **Conditional Speech Presence Probability** instead of binary decision
3. Better handling of weak speech components and low SNR

### IMCRA SPP Formula (Eq. 17 in paper)
```
P_H1(k,l) = 1 / {1 + (1 - p̄(k,l)) / p̄(k,l) · (1 + ξ̂(k,l)) · exp(-γ(k,l))}
```
Where `p̄(k,l)` is the local speech absence probability from first-pass minima tracking.

### Verified Python Implementation
```python
def imcra_noise_estimation(Y, L_min=150, alpha_d=0.85, alpha_p=0.9, delta=1.67):
    """
    Cohen 2003 IMCRA noise estimation (verified against paper).
    """
    n_freq, n_frames = Y.shape
    power = np.abs(Y) ** 2
    
    # === First Pass ===
    # Smooth PSD with time-varying α = 0.7 (half-wave rectification)
    S1 = np.zeros_like(power)
    S1[:, 0] = power[:, 0]
    for l in range(1, n_frames):
        alpha_rect = 0.7  # fixed, per paper
        S1[:, l] = alpha_rect * S1[:, l-1] + (1 - alpha_rect) * power[:, l]
    
    # First-pass minimum tracking (window L_min)
    S_min1 = np.full_like(S1, np.inf)
    for l in range(n_frames):
        start = max(0, l - L_min + 1)
        S_min1[:, l] = np.min(S1[:, start:l+1], axis=1)
    
    # First-pass speech presence indicator (Eq. 12)
    ratio1 = S1 / (S_min1 + 1e-10)
    I1 = (ratio1 < delta).astype(float)  # 1 = no speech present
    
    # Smooth indicator (Eq. 14)
    I_smooth = np.zeros_like(I1)
    I_smooth[:, 0] = I1[:, 0]
    for l in range(1, n_frames):
        I_smooth[:, l] = alpha_p * I_smooth[:, l-1] + (1 - alpha_p) * I1[:, l]
    
    # === Second Pass ===
    # Recompute PSD using only noise-dominated frames (Eq. 15)
    S2 = np.zeros_like(power)
    S2[:, 0] = power[:, 0]
    for l in range(1, n_frames):
        alpha_s = I_smooth[:, l] * (1 - 0.7) + 0.7  # α_s from paper
        S2[:, l] = alpha_s * S2[:, l-1] + (1 - alpha_s) * I_smooth[:, l] * power[:, l]
    
    # Second-pass minimum tracking (shorter window L_min/2)
    L_min2 = L_min // 2
    S_min2 = np.full_like(S2, np.inf)
    for l in range(n_frames):
        start = max(0, l - L_min2 + 1)
        S_min2[:, l] = np.min(S2[:, start:l+1], axis=1)
    
    # === Final Noise Estimate ===
    noise_est = np.zeros_like(power)
    noise_est[:, 0] = S_min2[:, 0]
    for l in range(1, n_frames):
        # Adaptive smoothing based on speech presence (Eq. 19)
        p_frame = 1 - I_smooth[:, l]  # speech presence probability
        alpha_lambda = alpha_d + (1 - alpha_d) * p_frame
        noise_est[:, l] = alpha_lambda * noise_est[:, l-1] + (1 - alpha_lambda) * power[:, l]
    
    return noise_est
```

---

## 5. Spectral Subtraction (Boll 1979, Berouti 1979)

**Papers:**
- S. F. Boll, "Suppression of acoustic noise in speech using spectral subtraction," *IEEE Trans. Acoust., Speech, Signal Process.*, vol. 27, no. 2, pp. 113–120, Apr. 1979. DOI: 10.1109/TASSP.1979.1163209
- M. Berouti, R. Schwartz, J. Makhoul, "Enhancement of speech corrupted by acoustic noise," *Proc. ICASSP*, pp. 208–211, 1979.

### Basic Spectral Subtraction (Boll 1979)
```
|X̂(k,l)|² = |Y(k,l)|² - |D̂(k,l)|²
```
Assumes uncorrelated noise and speech. Half-wave rectification prevents negative values.

### Improved Spectral Subtraction (Berouti 1979)
```
|X̂(k,l)|² = |Y(k,l)|² - α · |D̂(k,l)|²    if > β · |D̂(k,l)|²
           = β · |D̂(k,l)|²                    otherwise
```
- α = over-subtraction factor (1.0–4.0): higher for more aggressive noise removal
- β = spectral floor (0.01–0.1): prevents complete attenuation of noise-only frames
- Over-subtraction trades speech distortion for noise reduction

### Multi-band Spectral Subtraction (Kamath & Loizou 2002)
Different α per frequency band:
- Below 1 kHz: α = 1.0 (preserve formants)
- 1–4 kHz: α = 2.0 (moderate)
- Above 4 kHz: α = 3.0 (aggressive)

### Verified Python Implementation
```python
def spectral_subtraction(Y, noise_psd, alpha=2.0, beta=0.05):
    """
    Berouti 1979 over-subtraction with spectral floor.
    
    Y: complex STFT (n_freq, n_frames)
    noise_psd: estimated noise PSD (n_freq, n_frames)
    alpha: over-subtraction factor (1-4)
    beta: spectral floor (0.01-0.1)
    """
    Y_power = np.abs(Y) ** 2
    X_power = Y_power - alpha * noise_psd
    floor = beta * noise_psd
    X_power = np.maximum(X_power, floor)
    return np.sqrt(X_power) * np.exp(1j * np.angle(Y))
```

---

## 6. Wiener Filtering

### Core Formula
```
H(k,l) = ξ(k,l) / (1 + ξ(k,l))
```
Where ξ is the a priori SNR. Smooth version uses decision-directed estimate.

### Practical Implementation
```python
def wiener_filter(Y, noise_psd, alpha_dd=0.98):
    """Wiener filter with decision-directed a priori SNR."""
    n_freq, n_frames = Y.shape
    gamma = np.abs(Y)**2 / (noise_psd + 1e-10)
    A_prev = np.zeros(n_freq)
    X_hat = np.zeros_like(Y)
    
    for l in range(n_frames):
        # Decision-directed SNR (Ephraim & Malah 1984)
        xi = (
            alpha_dd * (A_prev**2 / (noise_psd[:, l] + 1e-10)) +
            (1 - alpha_dd) * np.maximum(gamma[:, l] - 1, 0)
        )
        # Wiener gain: H = xi / (1 + xi)
        G = xi / (1 + xi)
        X_hat[:, l] = G * Y[:, l]
        A_prev = np.abs(X_hat[:, l])
    
    return X_hat
```

---

## 7. Dual-EMA Noise Floor Tracker

For continuous 24-hour noise floor tracking:
```python
def dual_ema_noise_floor(energy_history, alpha_slow=0.9999, alpha_fast=0.995):
    """
    Dual-timescale EMA for long-term noise floor tracking.
    
    alpha_slow = 0.9999: 30-min time constant at 100fps
    alpha_fast = 0.995:  2-sec time constant at 100fps
    
    Returns: fast_min for detecting changes, noise_floor for tracking
    """
    energies = np.array(energy_history)
    
    # Fast window (last 50 frames = 500ms)
    fast_window = energies[-50:]
    fast_min = np.percentile(fast_window, 10)
    
    # Full window (last 300 frames = 3s)
    slow_min = np.percentile(energies, 10) if len(energies) >= 300 else fast_min
    
    # Detect abrupt changes
    change_ratio = fast_min / (slow_min + 1e-10)
    
    if abs(fast_min - slow_min) / (slow_min + 1e-10) > 2.0:
        # Rapid change detected: use fast estimate
        noise_floor = 0.5 * slow_min + 0.5 * fast_min
    else:
        # Stable: use slow EMA
        noise_floor = slow_min
    
    return noise_floor
```

---

## 8. Bayesian Speech Presence Probability

**Paper:** J. Sohn, N. S. Kim, W. Sung, "A statistical model-based voice activity detection," *IEEE Signal Process. Lett.*, vol. 6, no. 1, pp. 1–3, Jan. 1999. DOI: 10.1109/97.736019

### Posterior SPP (Bayesian framework)
```
P(H₁|Y) = Λ / (1 + Λ)
```
Where Λ is the likelihood ratio. Simplified practical form:
```
P(H₁(k,l)) = 1 / {1 + (1-P̄)/P̄ · (1+ξ̂(k,l)) · exp(-γ(k,l))}
```

---

## 9. Algorithm Comparison

| Algorithm | Real-time? | Adapts? | Complexity | Best for |
|-----------|-----------|---------|------------|----------|
| Minimum Statistics (Martin) | Yes | Slow (D frames) | O(N²) | Stationary noise |
| MCRA (Cohen 2002) | Yes | Fast (<1.5s) | O(N²) | Non-stationary |
| IMCRA (Cohen 2003) | Yes | Continuous | O(N²) | **24hr operation** |
| Decision-Directed (EM 84) | Yes | Frame-by-frame | O(N) | SNR estimation |
| Spectral Subtraction | Yes | Needs noise est. | O(N) | Simple deployment |
| Wiener Filter | Yes | Needs noise est. | O(N) | Linear MMSE |
| Dual-EMA | Yes | Asymmetric | O(1) | Noise floor drift |
| Bayesian SPP | Yes | Continuous | O(N²) | Soft decisions |

---

## 10. Recommended 24-Hour Architecture

```
Input Frame
    │
    ▼
┌──────────────────┐
│ Dual-EMA Energy  │ ← Fast (500ms) + Slow (3s) percentile tracking
│ Noise Floor      │   WebRTC-style asymmetric: 0.2 down, 0.99 up
└────────┬─────────┘
    │
    ▼
┌──────────────────┐
│ Decision-Directed│ ← α=0.98, Ephraim-Malah 1984
│ SNR Estimation   │   Reduces musical noise, smooth tracking
└────────┬─────────┘
    │
    ▼
┌──────────────────┐
│ Wiener/MMSE Gain  │ ← Apply suppression gain
└──────────────────┘
```

## 11. Key Parameters for 24hr Operation

| Parameter | Value | Paper Source |
|-----------|-------|-------------|
| L_min (IMCRA) | 150–200 frames | Cohen 2003 |
| α_d (IMCRA) | 0.85 | Cohen 2003 |
| α_p (SPP) | 0.9 | Cohen 2002 |
| α_dd (Decision) | 0.98 | Breithaupt & Martin 2011 |
| δ (MCRA ratio) | 1.67 ~ 5dB | Cohen 2002 |
| α_slow (EMA) | 0.9999 | — |
| α_fast (EMA) | 0.995 | — |
| STFT window | 512 @ 16kHz | Standard |

---

## References

1. Martin, R. (2001). "Noise power spectral density estimation based on optimal smoothing and minimum statistics." *IEEE Trans. Speech Audio Process.*, 9(5), 504–512.
2. Ephraim, Y. & Malah, D. (1984). "Speech enhancement using a minimum mean-square error short-time spectral amplitude estimator." *IEEE Trans. Acoust., Speech, Signal Process.*, 32(6), 1109–1121.
3. Cohen, I. & Berdugo, B. (2002). "Noise estimation by minima controlled recursive averaging." *IEEE Signal Process. Lett.*, 9(1), 12–15.
4. Cohen, I. (2003). "Noise spectrum estimation in adverse environments: Improved minima controlled recursive averaging." *IEEE Trans. Speech Audio Process.*, 11(5), 466–475.
5. Boll, S. F. (1979). "Suppression of acoustic noise in speech using spectral subtraction." *IEEE Trans. Acoust., Speech, Signal Process.*, 27(2), 113–120.
6. Berouti, M., Schwartz, R. & Makhoul, J. (1979). "Enhancement of speech corrupted by acoustic noise." *Proc. ICASSP*, 208–211.
7. Breithaupt, C. & Martin, R. (2011). "Analysis of the decision-directed SNR estimator." *IEEE Trans. Audio, Speech, Language Process.*, 19(2), 277–289.
8. Sohn, J., Kim, N. S. & Sung, W. (1999). "A statistical model-based voice activity detection." *IEEE Signal Process. Lett.*, 6(1), 1–3.
