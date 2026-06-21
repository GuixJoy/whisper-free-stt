# Digital Signal Processing Features for Voice Analysis

All formulas verified against library source code (librosa, Essentia) and research papers.

## 1. Spectral Flux

### Formula (L2-norm, half-rectified — Essentia default)
```
SF(t) = sqrt( sum_k max(0, |X(k,t)| - |X(k,t-1)|)^2 )
```

**Verified against Essentia `Flux` algorithm source:** Default mode uses L2-norm with half-rectification. Half-rectification means only spectral *increases* contribute — sensitive to onsets/attacks.

### Parameters
| Parameter | Value | Why |
|-----------|-------|-----|
| Norm | L2 (L1 also available) | More common in Essentia |
| Half-rectify | True (default) | Onset sensitivity |

### Voice vs Noise vs Silence
- **Speech onset:** high flux (0.1–1.0 normalized)
- **Stationary noise:** low flux (near 0)
- **Silence:** flux ≈ 0
- **Non-stationary noise:** high flux (can confuse VAD)

---

## 2. Spectral Centroid

### Formula (verified from librosa source)
```
SC(t) = sum_k f(k) · |X(k,t)| / sum_k |X(k,t)|
```
Amplitude-weighted mean frequency — "center of mass" of spectrum.

### Parameters
| Library | n_fft | hop_length | window |
|---------|-------|------------|--------|
| librosa | 2048 | 512 | Hann |
| Essentia | var | var | var (Centroid(range=sr/2)) |

### Voice vs Noise vs Silence
- **Voiced speech:** ~300–1500 Hz (formant structure)
- **Unvoiced speech** (/s/, /f/): ~4–8 kHz
- **White noise:** ≈ sr/4
- **Silence:** undefined/low (use energy gate first)

---

## 3. Zero Crossing Rate (ZCR)

### Formula (verified from librosa source)
```
ZCR(t) = 1/2 · mean( |sgn(x[n]) - sgn(x[n-1])| )
```

### Adaptive Threshold (Rabiner & Sambur 1975 [1])
```
IZC = mean(ZCR[1..10])        # initial frames (noise-only)
stddev = std(ZCR[1..10])
IZCT = min(25, IZC + 2 * stddev)  # IZCT in hundreds of Hz
```
Frame is speech if `ZCR * sr / frame_size > IZCT`.

### Parameters
| Library | frame_length | hop_length |
|---------|-------------|------------|
| librosa | 2048 | 512 |
| Essentia | var | var |

### Voice vs Noise vs Silence
- **Voiced speech** (vowels): low ZCR (~0.01–0.05)
- **Unvoiced speech** (/s/, /sh/): high ZCR (~0.1–0.3)
- **White noise:** ZCR ≈ 0.5 (maximum randomness)
- **Silence:** ZCR ≈ 0

---

## 4. Band Energy Ratio (BER)

### Formula
```
BER(t) = E_high(t) / E_low(t)
```

### Standard Band Split (ETSI VAD Standard [2])
| Band | Freq Range | Used for |
|------|-----------|----------|
| Low | 0–1000 Hz | Voiced speech (formants) |
| High | 1000–4000 Hz | Unvoiced speech, fricatives |

### ETSI Full 9-Band Split (G.729 Annex B)
| Band | Range | Band | Range | Band | Range |
|------|-------|------|-------|------|-------|
| 1 | 0–250 Hz | 4 | 750–1000 Hz | 7 | 2000–2500 Hz |
| 2 | 250–500 Hz | 5 | 1000–1500 Hz | 8 | 2500–3000 Hz |
| 3 | 500–750 Hz | 6 | 1500–2000 Hz | 9 | 3000–4000 Hz |

### Voice vs Noise vs Silence
- **Voiced speech:** BER < 1 (energy concentrated in low bands)
- **Unvoiced speech:** BER > 1 (energy shifted to high bands)
- **White noise:** BER ≈ high_band_bins / low_band_bins

---

## 5. Spectral Rolloff

### Formula (verified from librosa source)
Find freq `f_r` where:
```
sum_{k=0}^{k_r} |X(k)|² >= roll_percent · sum_{k=0}^{K} |X(k)|²
```
Default `roll_percent = 0.85`.

### Parameters
| Rolloff Percent | Use Case |
|----------------|----------|
| 0.85 | Default (librosa) |
| 0.95 | Higher frequency bound |
| 0.99 | Maximum frequency estimate |

### Voice vs Noise vs Silence
- **Voiced speech:** ~2–4 kHz
- **Unvoiced speech:** ~6–8 kHz
- **White noise:** ≈ roll_percent · sr/2

---

## 6. Spectral Flatness

### Formula (verified from librosa source)
```
tonality = geometric_mean(|X|²) / arithmetic_mean(|X|²)
```
Range: [0, 1]. 0 = tonal (pure tone), 1 = flat (white noise).
Often converted to dB: `SF_dB = 10 · log10(SF)`

### Voice vs Noise vs Silence
- **Tonal speech** (vowels): → 0
- **Unvoiced speech** (/s/): → 0.3–0.7
- **White noise:** → 1.0

---

## 7. MFCC

### Full Pipeline (Davis & Mermelstein 1980 [3])

1. **Pre-emphasis:** `y'[n] = y[n] - 0.97 · y[n-1]`
2. **Framing:** 25ms Hamming window, 10ms hop
3. **FFT:** N=512, power spectrum `|X(k)|²`
4. **Mel filterbank:** 26 triangular filters, mel scale:
   ```
   mel(f) = 2595 · log10(1 + f/700)
   ```
5. **Log energy:** `log(E_k)` for each filter
6. **DCT:** Decorrelate → keep first 13 coefficients
   ```
   C[n] = sum_k log(E_k) · cos(π·n·(k+0.5)/K)
   ```
7. **Liftering** (optional): `C'[n] = C[n] · (1 + L/2 · sin(π·(n+1)/L))`, L=22

### Library Defaults
| Library | n_fft | hop | n_mels | n_mfcc | preemph | lifter |
|---------|-------|-----|--------|--------|---------|--------|
| librosa | 2048 | 512 | 128 | 20 | 0 | 0 |
| python_speech_features | 512 | 160 | 26 | 13 | 0.97 | 22 |
| CMU Sphinx | 512 | 160 | 40 | 13 | 0.97 | 22 |

---

## 8. RMS Energy

```
RMS(t) = sqrt( mean( x²[t] ) )
RMS_dB(t) = 20 · log10( RMS(t) / reference )
```

---

## 9. Optimal Parameters for VAD

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| sr | 16000 Hz | Telephony standard, adequate for speech |
| n_fft | 512 | 32ms window — captures formants |
| hop_length | 128 | 8ms — sufficient time resolution |
| window | Hann | Low sidelobes |
| n_mels | 26–40 | 26 classic, 40 modern |

---

## 10. Feature Normalization

### Z-Score (CMVN)
```
x_norm = (x - μ) / σ
```
Standardized per-feature across utterance or sliding window (~300 frames).

### Adaptive Running Statistics
```python
class AdaptiveNormalizer:
    def __init__(self, alpha=0.98):
        self.mean = 0.0
        self.var = 1.0
        self.alpha = alpha
    def update(self, x):
        self.mean = self.alpha * self.mean + (1 - self.alpha) * x
        self.var = self.alpha * self.var + (1 - self.alpha) * (x - self.mean)**2
    def normalize(self, x):
        self.update(x)
        return (x - self.mean) / (np.sqrt(self.var) + 1e-10)
```

---

## 11. Feature Sensitivity Matrix

| Feature | Voiced Speech | Unvoiced Speech | Stationary Noise | Non-Stationary Noise | Silence |
|---------|--------------|-----------------|-------------------|---------------------|---------|
| RMS | High | Medium | Low-Medium | Variable | Near 0 |
| ZCR | Low (~0.02) | High (~0.15) | High (~0.3) | Variable | ~0 |
| Centroid | Low (~800Hz) | High (~4kHz) | Medium | Variable | ~0 |
| Flux | Low-Med | Medium | Low | High | ~0 |
| BER | Low (<1) | High (>1) | ~3 | Variable | Undefined |
| Flatness | Low (~0.01) | Medium (~0.3) | High (~0.8) | Variable | Undefined |
| Rolloff | Low (~3kHz) | High (~6kHz) | Medium | Variable | ~0 |

---

## 12. Library Comparison

| Feature | librosa | Essentia | scipy |
|---------|---------|----------|-------|
| Spectral Flux | `onset_strength()` (log-Mel) | `Flux()` (raw spectrum) | Manual |
| Centroid | `feature.spectral_centroid()` | `Centroid(range=sr/2)` | Manual |
| ZCR | `feature.zero_crossing_rate()` | `ZeroCrossingRate()` | Manual |
| Rolloff | `feature.spectral_rolloff()` | `RollOff(cutoff=0.85)` | Manual |
| Flatness | `feature.spectral_flatness()` | `FlatnessDB()` | Manual |
| MFCC | `feature.mfcc()` | `MFCC()` | Manual |
| RMS | `feature.rms()` | `RMS()` | Manual |

**Key difference:** Essentia computes flux on raw magnitude spectrum. librosa computes `onset_strength` on log-Mel spectrogram. For VAD, raw spectral flux is more direct.

---

## References

1. Rabiner, L. & Sambur, M. (1975). "An algorithm for determining the endpoints of isolated utterances." *Bell System Technical Journal*, 54(2), 297–315.
2. ETSI EN 301 708. "Voice Activity Detector (VAD) for Adaptive Multi-Rate (AMR) speech traffic channels."
3. Davis, S. & Mermelstein, P. (1980). "Comparison of parametric representations for monosyllabic word recognition." *IEEE Trans. ASSP*, 28(4), 357–366.
4. Peeters, G. (2004). "A large set of audio features for sound description." CUIDADO Project Report, IRCAM.
5. Essentia documentation: https://essentia.upf.edu/reference/streaming_Flux.html
6. librosa documentation: https://librosa.org/doc/main/feature.html
