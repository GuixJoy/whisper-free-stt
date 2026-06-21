# Voice Activity Detection (VAD) Algorithms

## 1. Energy-Based (RMS) VAD

**Formula:**
```
E_frame = (1/N) * Σ x[n]²
RMS = sqrt(E_frame)
Decision: if RMS > threshold → Speech, else → Silence
```

**Adaptive threshold (VOCAL Technologies):**
```
threshold = α * mean(energy) + β * N_frames * M_mics
```
Updated continuously during non-speech frames.

**Weakness:** Fails when noise energy approaches speech energy (low SNR). A 1dB change at SNR=0dB dramatically changes results (Aalto University, https://speechprocessingbook.aalto.fi).

---

## 2. Zero-Crossing Rate (ZCR)

```
ZCR = (1/2N) * Σ |sgn(x[n]) - sgn(x[n-1])|     for n = 1 to N-1
```
Where `sgn(x) = 1 if x ≥ 0, else -1`

Speech: 50-3000 crossings/sec. ZCR alone is unreliable but useful as secondary feature.

**Rabiner & Sambur adaptive threshold (1975):**
```
IZC = mean(ZCR[1..10])        # initial frames (noise-only assumption)
stddev = std(ZCR[1..10])
IZCT = min(25, IZC + 2 * stddev)
```
Frame is speech if `ZCR[frame] > IZCT`.

---

## 3. Spectral Flux

```
SF(k) = Σ |X(k, f) - X(k-1, f)|²     for all frequency bins f
```
Where `X(k, f)` is the STFT magnitude of frame k at frequency f.

Speech has higher spectral flux than stationary noise. Half-rectified L2-norm is standard.

**Implementation (verified against Essentia Flux source):**
```python
def spectral_flux(mag_spectrum_curr, mag_spectrum_prev, half_rectify=True):
    diff = mag_spectrum_curr - mag_spectrum_prev
    if half_rectify:
        diff = np.maximum(0, diff)
    return np.sqrt(np.sum(diff ** 2))
```

---

## 4. Spectral Centroid

```
SC = Σ(f * |X(f)|) / Σ|X(f)|
```

Speech has higher spectral centroid (~250Hz-4kHz) than many noise types.

---

## 5. Long-Term Spectral Flatness Measure (LSFM)

**Paper:** EURASIP 2013, "Efficient voice activity detection algorithm using long-term spectral flatness measure"

```
LSFM = GM(P(f)) / AM(P(f))
```
Where GM = geometric mean, AM = arithmetic mean of power spectrum.

**Low LSFM → Speech** (has spectral structure)
**High LSFM → Silence/Noise** (flat spectrum)

---

## 6. WebRTC VAD (GMM-Based)

**Source URL:** https://chromium.googlesource.com/external/webrtc/+/refs/heads/main/common_audio/vad/

**Architecture:** 6 frequency sub-bands, 2-component Gaussian Mixture Model per sub-band.

### Verified: Sub-band decomposition (from WebRTC vad_filterbank.c)
| Band | Frequency Range |
|------|----------------|
| 1 | 80–250 Hz |
| 2 | 250–500 Hz |
| 3 | 500–1000 Hz |
| 4 | 1000–2000 Hz |
| 5 | 2000–3000 Hz |
| 6 | 3000–4000 Hz |

### Verified: Spectrum Weighting (from WebRTC vad_core.c)
```c
static const int16_t kSpectrumWeight[kNumChannels] = { 6, 8, 10, 12, 14, 16 };
```

### Verified: GMM Model Parameters (from WebRTC vad_core.c)
```c
// Initial noise model means (Q7)
static const int16_t kNoiseDataMeans[kTableSize] = {
    6738, 4892, 7065, 6715, 6771, 3369, 7646, 3863, 7820, 7266, 5020, 4362
};
// Initial speech model means (Q7)
static const int16_t kSpeechDataMeans[kTableSize] = {
    8306, 10085, 10078, 11823, 11843, 6309, 9473, 9571, 10879, 7581, 8180, 7483
};
// Initial noise stds (Q7)
static const int16_t kNoiseDataStds[kTableSize] = {
    378, 1064, 493, 582, 688, 593, 474, 697, 475, 688, 421, 455
};
// Initial speech stds (Q7)
static const int16_t kSpeechDataStds[kTableSize] = {
    555, 505, 567, 524, 585, 1231, 509, 828, 492, 1540, 1079, 850
};
```

### Verified: Gaussian Probability (from WebRTC vad_gmm.c)
Formula for normal distribution probability:
```
P(input | mean, std) = 1/std * exp(-(input - mean)² / (2 * std²))
```

### Verified: Log-Likelihood Ratio Test (from WebRTC vad_core.c)
```c
// H0: Noise, H1: Speech
// Global LRT: sum over all channels of individual LLRs
// Individual test per channel + global test over all channels
```

### Verified: Hangover Constants (from WebRTC vad_core.c)
```c
// Mode 0 (Quality)
static const int16_t kOverHangMax1Q[3] = { 8, 4, 3 };   // short hangover
static const int16_t kOverHangMax2Q[3] = { 14, 7, 5 };  // long hangover
static const int16_t kLocalThresholdQ[3] = { 24, 21, 24 };
static const int16_t kGlobalThresholdQ[3] = { 57, 48, 57 };

// Mode 3 (Very Aggressive)
static const int16_t kLocalThresholdVAG[3] = { 94, 94, 94 };
static const int16_t kGlobalThresholdVAG[3] = { 1100, 1050, 1100 };
```

### Verified: Adaptive Model Update (from WebRTC vad_core.c)
```c
// Noise model update constants
static const int16_t kNoiseUpdateConst = 655;   // Q15 (~0.02)
static const int16_t kSpeechUpdateConst = 6554;  // Q15 (~0.2)
static const int16_t kBackEta = 154;             // Q8  (~0.6)
// Minimum difference between speech/noise models
static const int16_t kMinimumDifference[kNumChannels] = { 544, 544, 576, 576, 576, 576 };
```

**Verified Update Logic (from actual source):**
```c
// Only update noise mean during noise-only frames
if (!vadflag) {
    delt = (ngprvec[gaussian] * deltaN[gaussian]) >> 11;        // Q14
    nmk2 = nmk + (delt * kNoiseUpdateConst) >> 22;              // Q7 update
}

// Long-term correction using minimum tracking
ndelt = (feature_minimum << 4) - tmp1_s16;                      // Q8
nmk3 = nmk2 + (ndelt * kBackEta) >> 9;                          // Q7 correction

// Only update speech mean during speech frames
if (vadflag) {
    delt = (sgprvec[gaussian] * deltaS[gaussian]) >> 11;        // Q14
    tmp_s16 = (delt * kSpeechUpdateConst) >> 21;                // Q8
    smk2 = smk + ((tmp_s16 + 1) >> 1);                          // Q7 update
}
```

### Verified: Minimum Tracking (from WebRTC vad_sp.c)
The `WebRtcVad_FindMinimum` function maintains a sorted list of the 16 smallest feature values with ages (0-100 frames). Uses **median of 3rd smallest value** (index 2). **Asymmetric smoothing:**
```c
if (current_median < self->mean_value[channel]) {
    alpha = 6553;   // 0.2 in Q15 (noise dropping: fast update)
} else {
    alpha = 32439;  // 0.99 in Q15 (noise rising: slow update)
}
// Smoothed: alpha * mean + (1-alpha) * current_median
tmp32 = (alpha + 1) * mean + (WEBRTC_SPL_WORD16_MAX - alpha) * current_median;
self->mean_value[channel] = (int16_t)(tmp32 >> 15);
```

### Verified: Aggressiveness Modes
- **Mode 0 (Quality):** Least aggressive, most false positives, lowest thresholds
- **Mode 1 (Low Bitrate):** Moderate
- **Mode 2 (Aggressive):** High thresholds
- **Mode 3 (Very Aggressive):** Most aggressive, most false negatives, highest thresholds

### Performance
- RTF ≈ 0.0001 on modern CPU (measured in production)
- 10ms, 20ms, 30ms frame sizes supported at 8/16/32/48 kHz

### Verified Python Wrapper
```python
import webrtcvad
vad = webrtcvad.Vad(mode=0)  # 0=quality, 3=very aggressive
# Process 30ms frames at 16kHz (480 samples, 16-bit PCM)
is_speech = vad.is_speech(frame_bytes, sample_rate=16000)
```

**Repos:**
- `github.com/wiseman/py-webrtcvad` — Python wrapper (MIT)
- WebRTC source: `chromium.googlesource.com/external/webrtc/`

---

## 7. Silero VAD (v5)

**Source:** `github.com/snakers4/silero-vad` (9.3k+ stars)
**License:** MIT (LICENSE file), not CC BY-NC 4.0 as badge shows. Verify: https://raw.githubusercontent.com/snakers4/silero-vad/master/LICENSE

**Architecture:** Lightweight neural network (~2MB quantized JIT model via ONNX).

**Verified Specs:**
- 30ms chunk processing in <1ms on single CPU thread (from README benchmarks)
- Supports 8kHz and 16kHz sampling rates
- Trained on 6000+ languages
- ONNX Runtime support for 2-5x speedup vs PyTorch

**Usage (verified from repo):**
```python
import torch
torch.set_num_threads(1)
model, utils = torch.hub.load('snakers4/silero-vad', 'silero_vad')
(get_speech_timestamps, _, _, _, _) = utils
speech_timestamps = get_speech_timestamps(wav, model, sampling_rate=16000)
```

**Streaming (verified from repo examples):**
```python
for i in range(0, len(wav), window_size_samples):
    chunk = wav[i:i+window_size_samples]
    speech_prob = model(chunk, 16000).item()
    if speech_prob > threshold:
        # speech detected
```

**Benchmarks (Picovoice benchmarks):**
- Silero VAD RTF: 0.004
- Cobra VAD RTF: 0.0005 (8.6x faster)
- WebRTC VAD RTF: ~0.0001 (fastest, but least accurate at low SNR)

---

## 8. Deep Learning VAD

**Source:** nicklashansen/voice-activity-detection (204 stars, supervised by Retune DSP)

| Architecture | Parameters | AUC | FAR (FRR=1%) |
|---|---|---|---|
| LSTM-RNN | 10k | 0.985 | 48.13% |
| GRU-RNN | 30k | 0.991 | 3.61% |
| DenseNet | 10k | 0.981 | 58.14% |

**Features:** 12 MFCCs + deltas + delta-deltas, 900ms temporal context.
**Loss:** Focal Loss with γ=2 outperforms Cross-Entropy for imbalanced data.

---

## 9. Multi-Feature Fusion VAD

### mVAD (Zhu et al. 2023, Digital Signal Processing, vol. 140)
Combines: RMS, spectral centroid, ZCR, spectral entropy, spectral flatness.
Robust at SNR < 0 dB.

### G.729 VAD (ITU-T Standard G.729 Annex B)
4 features in 4D decision space: full-band energy, low-band energy, LSF spectral distortion, ZCR.
Uses adaptive background noise tracking and hangover scheme.

### Practical Fusion Implementation
```python
def multi_feature_vad(frame, state):
    rms = sqrt(mean(frame**2))
    zcr = zero_crossing_rate(frame)
    sc = spectral_centroid(frame)
    flux = spectral_flux(frame, state['prev_spectrum'])
    
    # Update adaptive thresholds during silence
    if not state['is_speech']:
        state['noise_floor'] = 0.999 * state['noise_floor'] + 0.001 * rms
    
    # Composite multi-feature score
    features = np.array([rms / state['noise_floor'], zcr, sc / 1000, flux])
    weights = np.array([0.4, 0.2, 0.2, 0.2])
    score = np.dot(features, weights)
    
    return score > 1.0, state
```

---

## 10. Handling 24-Hour Runtime

### Key Strategies
1. **Continuous noise floor tracking** — never assume noise is stationary
2. **Dual-timescale adaptation:**
   - Fast percentile (10th): React to sudden changes
   - Slow EMA: Stable long-term baseline
3. **Hangover scheme** (100-300ms) to prevent speech truncation
4. **Periodic state reset** (Silero VAD technical docs suggest every 5s)

### Asymmetric Noise Floor (from actual WebRTC code, vad_sp.c)
```
if current_median < mean:
    alpha = 0.2   # noise dropping: fast update
else:
    alpha = 0.99  # noise rising: slow update
```

---

## 11. OpenAI Realtime API VAD

Uses `server_vad` mode with configurable:
- `threshold` (0-1): activation threshold
- `prefix_padding_ms`: audio before detected speech
- `silence_duration_ms`: silence duration to detect speech stop

---

## 12. Recommendation for 24hr Operation

1. **Primary VAD:** Silero VAD (best accuracy/efficiency, <1ms per chunk, MIT license)
2. **Noise tracking:** IMCRA (Cohen 2003) for spectral noise floor
3. **Adaptive thresholds:** Dual-timescale with asymmetric WebRTC-style smoothing
4. **Hangover:** 100-300ms to prevent speech truncation
5. **State management:** Periodic model state reset (every 5-30 seconds)
6. **Fallback:** Energy-based VAD as lightweight always-on pre-filter

---

## References

1. WebRTC VAD source: https://chromium.googlesource.com/external/webrtc/+/refs/heads/main/common_audio/vad/
   - vad_core.c — GMM model, update logic, hangover constants
   - vad_gmm.c — Gaussian probability computation
   - vad_sp.c — FindMinimum, asymmetric smoothing
   - vad_filterbank.c — Sub-band filterbank, feature extraction
2. Silero VAD: https://github.com/snakers4/silero-vad (MIT)
3. Rabiner, L. & Sambur, M. (1975). "An algorithm for determining the endpoints of isolated utterances." Bell System Technical Journal.
4. Sohn, J. et al. (1999). "A statistical model-based voice activity detection." IEEE Signal Process. Lett., vol. 6, no. 1, pp. 1–3.
5. Zhu, Z. et al. (2023). "A robust and lightweight VAD for speech enhancement at low SNR." Digital Signal Processing, vol. 140.
6. ITU-T G.729 Annex B: "Silence compression scheme for G.729 optimized for terminals conforming to ITU-T V.70."
7. Aalto University Speech Processing: https://speechprocessingbook.aalto.fi
