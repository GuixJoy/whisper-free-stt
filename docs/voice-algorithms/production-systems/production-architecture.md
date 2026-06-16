# Production Voice Processing Systems

## 1. Adaptive Gain Control (AGC)

### WebRTC AGC (verified from source)

**Three modes (from webrtc/modules/audio_processing/agc/):**
1. **kAdaptiveAnalog** — Prescribes analog gain to audio HAL + digital compression fallback
2. **kAdaptiveDigital** — Digital-only scaling + compression (no analog control)
3. **kFixedDigital** — Fixed gain + compression only at high levels

**Verified Parameters:**
- `target_level_dbfs`: Target peak level in dBFs [0, 31] (e.g., 3 = -3 dBFs). **Default: 3**
- `max_gain_db`: Maximum digital compression gain (default 40dB)
- `analog_level`: Current analog level from audio HAL (0–255 scale on Mac/ALSA)
- **Update rate:** 10ms frames

**Algorithm flow (verified from webrtc/agc/agc.cc):**
```python
# Per 10ms frame:
# 1. Measure input RMS level
# 2. Compare to target_level_dbfs
# 3. If adaptive: compute analog gain adjustment
# 4. Apply digital compression
# 5. Update gain for next frame
```

### DAGC — Digital AGC (verified from sile/dagc Rust and hearing aid literature)

```python
def dagc(frame, is_speech, state):
    """Digital AGC with VAD gating and asymmetric attack/release."""
    if not is_speech:
        return frame * state['gain']  # maintain gain, don't update
    
    rms = np.sqrt(np.mean(frame ** 2))
    if rms < 1e-10:
        return frame
    
    # Target -12 dBFS (~0.25 RMS)
    desired_gain = state['target_rms'] / rms
    desired_gain = np.clip(desired_gain, 0.1, 10.0)
    
    # Asymmetric smoothing
    if desired_gain < state['gain']:
        # Fast attack: prevents clipping (5-10ms time constant)
        state['gain'] += state['attack_rate'] * (desired_gain - state['gain'])
    else:
        # Slow release: prevents pumping (100-200ms time constant)
        state['gain'] += state['release_rate'] * (desired_gain - state['gain'])
    
    return frame * state['gain']
```

**Parameters:**
- target_rms: 0.01–0.1 (production: 0.01 for -40dB input, 0.25 for -12dBFS)
- Attack time: 5-10ms (α ≈ 0.1 for 10ms frames)
- Release time: 100-200ms (α ≈ 0.01 for 10ms frames)
- Min gain: 0.1, Max gain: 10.0 (20dB range)

### Hearing Aid AGC (IEC Standard 118-3)
- Attack time: 5-20ms (sudden loud sound → gain reduces quickly)
- Release time: 100-500ms (gain recovers slowly to avoid pumping)
- **Key constraint:** Long release time = after loud event, user can't hear quiet sounds briefly

---

## 2. VAD with Hysteresis

### Production VAD Algorithm
```
Per 10ms frame:
  1. Energy = Σx[n]²/N
  2. Compare to adaptive threshold T[n]
  3. Apply hysteresis band:
     if energy > T + hysteresis_high → state = SPEECH
     if energy < T - hysteresis_low  → state = SILENCE
     else → maintain previous state (dead zone)
  4. Minimum segment duration enforced:
     - Min speech: 50-100ms (reject noise clicks)
     - Min silence: 100-300ms (prevent mid-speech splitting)
```

### Verified Parameters (from multiple production systems)
| Parameter | Range | Production Value |
|-----------|-------|------------------|
| Endpoint silence | 10–2000ms | 300–500ms |
| Speech onset | 5–50ms | 10–20ms |
| Speech offset | 100–2000ms | 300–800ms |
| Min speech | 30–200ms | 50–100ms |
| Min silence | 50–500ms | 100–300ms |
| Frame size | 5–30ms | 10ms |
| Energy threshold | -40 to -20 dBFS | -35 dBFS |
| Hysteresis | 2–8 dB | 4–6 dB |

### Deepgram Endpointing (from docs.deepgram.com)
1. **VAD-based endpointing:** Configurable silence duration (default 10ms, set via `endpointing=500` for 500ms)
2. **UtteranceEnd:** Word-timing based gaps — uses finalized + interim word timestamps. Better for noisy environments.

---

## 3. Forced Utterance Splitting

### Whisper 30-Second Boundary (from faster-whisper)
```
1. Run VAD on full audio → find voiced regions
2. Add 100ms silence buffer on each voice region edge
3. Merge adjacent regions to fill 30-second windows
4. Use min-cut optimization near 30-second boundary
5. Process each segment independently through Whisper
6. Merge transcripts with timestamp alignment
```

### Streaming Splitting Strategies
1. **VAD-Based:** Split at silence boundaries, 500ms overlap for continuity
2. **Fixed + VAD Adjustment:** 5s window, adjust ±500ms to nearest VAD boundary
3. **Semantic:** LLM detects sentence boundaries (higher latency, better quality)

---

## 4. Memory Management for Long-Running Pipelines

### Critical Problems (from HuggingFace issues, faster-whisper issues)
1. Whisper/wav2vec NOT designed for arbitrarily long audio in single pass
2. Continuous memory growth in HuggingFace speech pipelines
3. 5-hour videos can cause OOM after 24 hours

### Production Strategy
```
Per-Session State (constant size, fixed allocation):
  Ring buffer: 2 * window_size (e.g., 6 seconds at 16kHz)
  Noise floor: single float
  Gain state: single float  
  VAD state: small struct
  Encoder KV cache (for streaming models): fixed per model

Per-Chunk Cleanup:
  1. Process one chunk (e.g., 5s)
  2. Free intermediate tensors immediately
  3. Zero out scratch buffers
  4. Explicit gc.collect() every N chunks
  5. Never grow unbounded queues
```

---

## 5. Latency Optimization

| Technique | Reduction | Source |
|-----------|-----------|--------|
| Cache-aware streaming (NeMo) | 3x concurrent streams | NVIDIA Nemotron |
| VAD-based batching (faster-whisper) | 64x real-time | MobiusML benchmarks |
| Parallel STFT extraction | 104x real-time | faster-whisper |
| TensorRT acceleration | 2-5x inference | WhisperLive |
| INT8/FP16 quantization | 2-4x memory reduction | Multiple |

### Verified Latency Budget
| Component | % of total | Absolute |
|-----------|------------|----------|
| ASR | 5% | ~24ms |
| LLM | 60% | ~300ms |
| TTS | 30% | ~150ms |
| Network | 5% | ~26ms |
| **Total** | 100% | **~500ms** |

Source: NVIDIA Nemotron (RTX 5090 benchmarks)

---

## 6. WebRTC Audio Processing Module (APM)

**Verified features (from webrtc/modules/audio_processing/):**
- Acoustic Echo Cancellation (AEC) — linear + nonlinear
- Acoustic Echo Control for Mobile (AECM)
- Automatic Gain Control (AGC) — adaptive analog + digital
- High-pass Filter (HPF) — removes DC offset
- Level Estimator
- Noise Suppression (NS) — spectral subtraction based
- Voice Activity Detection (VAD) — GMM-based

**Standard VoIP Processing Chain:**
```
Mic → HPF → AEC → NS → AGC → VAD → Codec → Network
```

**Sample rate:** Any rate < 384 kHz (auto-reconfigures on format change)

---

## 7. Key Parameter Ranges

| Parameter | Range | Recommended |
|-----------|-------|-------------|
| Sample rate | 8–48 kHz | 16 kHz (ASR) |
| Frame size | 5–30 ms | 10 ms |
| Noise floor α | 0.99–0.9999 | 0.999 |
| Speech threshold (SNR) | 3–10 dB | 6 dB |
| Hysteresis band | 2–8 dB | 4-6 dB |
| Endpoint silence | 100–2000 ms | 300–500 ms |
| AGC attack | 1–20 ms | 5–10 ms |
| AGC release | 50–500 ms | 100–200 ms |
| Min speech duration | 30–200 ms | 50–100 ms |
| Target output | -20 to -6 dBFS | -12 dBFS (0.25 RMS) |
| Max gain | 6–40 dB | 20 dB |
| Audio buffer | 3–10 s | 5 s |

---

## References

1. WebRTC Audio Processing Module. https://webrtc.org/ (source: https://chromium.googlesource.com/external/webrtc/)
2. NVIDIA NeMo. https://github.com/NVIDIA/NeMo
3. Deepgram API Docs. https://developers.deepgram.com/
4. faster-whisper. https://github.com/SYSTRAN/faster-whisper
5. WhisperLive (Collabora). https://github.com/collabora/WhisperLive
6. IEC 60118-15: Hearing aid audio quality.
7. Alango Technologies. "Combining DRC with fast AGC for hearing aids."
