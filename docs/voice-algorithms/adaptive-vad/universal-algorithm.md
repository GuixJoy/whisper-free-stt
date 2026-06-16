# Universal Adaptive Algorithm for 24/7 Voice Processing

## Problem Statement

Application runs continuously for 24+ hours. Noise floor drifts from 0.007 to 0.05+ 
as environment changes (AC on/off, people moving, time of day). Static thresholds fail.

## Solution: UniversalAdaptiveVAD

See `universal_vad.py` for the complete, importable Python implementation.

### Three Pillars of 24/7 Adaptation

1. **IMCRA Noise Estimation** (Cohen 2003 [1])
   - Two-pass minimum tracking (150-frame window)
   - Speech presence probability gating
   - Continuous update, no VAD needed
   - Handles non-stationary noise

2. **Dual-Timescale Noise Floor**
   - Slow EMA (α=0.9999): 30-minute baseline tracking
   - Fast EMA (α=0.995): 2-second rapid change detection  
   - WebRTC-style asymmetric: 0.2 update when noise drops, 0.99 when noise rises [4]

3. **Hysteresis VAD**
   - Asymmetric thresholds: onset ≠ offset (4dB vs 3dB)
   - Hangover (150ms) prevents speech truncation
   - Multi-feature fusion: RMS + ZCR + centroid + flux + BER

### Architecture

```
Input Frame (10ms @ 16kHz = 160 samples)
       │
       ▼
┌──────────────────────┐
│ Feature Extraction   │ ← RMS, ZCR, Centroid, Flux, BER
└──────────┬───────────┘
           │
     ┌─────▼─────┐
     │ Dual-EMA  │ ← 10th percentile, slow+fast windows
     │ Noise Fl. │     Asymmetric: 0.2 down / 0.99 up
     └─────┬─────┘
           │
     ┌─────▼─────┐
     │ Simplified │ ← 5th percentile over 150 frames
     │ IMCRA      │     Bias compensation (Martin 2001)
     └─────┬─────┘
           │
     ┌─────▼─────┐
     │ Multi-    │ ← Composite score: 0.4*energy + 0.15*each feature
     │ Feature   │     Hysteresis: 4dB onset / 3dB offset
     │ VAD       │     Hangover: 150ms
     └─────┬─────┘
           │
     ┌─────▼─────┐
     │ Adaptive  │ ← Only during speech
     │ AGC       │     Fast attack (α=0.1) / Slow release (α=0.01)
     └─────┬─────┘
           │
           ▼
      Output Frame
```

### Key Parameters

| Parameter | Value | Time Constant | Purpose |
|-----------|-------|---------------|---------|
| noise_floor_slow_alpha | 0.9999 | ~30 min | Long-term baseline |
| noise_floor_fast_alpha | 0.995 | ~2 sec | Rapid change detection |
| speech_threshold_db | 6 dB | — | SNR threshold for speech |
| hysteresis_up_db | 4 dB | — | Onset margin |
| hysteresis_down_db | 3 dB | — | Offset margin |
| endpoint_timeout_ms | 500 ms | — | Silence before utterance end |
| hang_frames | 15 | 150ms | Prevents truncation |
| attack_rate (AGC) | 0.1 | ~10ms | Fast attack, prevents clipping |
| release_rate (AGC) | 0.01 | ~200ms | Slow release, prevents pumping |
| target_rms | 0.01 | — | Desired output RMS level |

### Debug Output Format

Matches the exact format from your logs:

```
[debug] rms=0.040280 (noise=0.0079) snr=7.0dB state=SPEECH
  spectral: flux=6.9442 centroid=410Hz zcr=0.0000 ber=0.0013 score=0.5030
[debug] rms=0.186801 (noise=0.0079) snr=13.7dB state=SPEECH
  spectral: flux=50.4901 centroid=497Hz zcr=0.0059 ber=0.0033 score=0.7966
```

### Files

| File | Description |
|------|-------------|
| `universal_vad.py` | Importable Python module (~300 lines) |
| `test_universal_vad.py` | Test suite (11 tests) |
| `benchmark_universal_vad.py` | Performance benchmarks |
| `universal-algorithm.md` | This documentation |

### Quick Start

```python
from universal_vad import UniversalAdaptiveVAD

vad = UniversalAdaptiveVAD()

for frame in audio_stream:  # 160 samples @ 16kHz
    output, is_speech, state = vad.process_frame(frame)
    
    # Debug
    print(f"[debug] rms={state['rms']:.6f} "
          f"(noise={state['noise_floor']:.4f}) "
          f"snr={state['snr_db']:.1f}dB "
          f"state={state['vad_state']}")
    print(f"  spectral: flux={state['flux']:.4f} "
          f"centroid={state['centroid']:.0f}Hz "
          f"zcr={state['zcr']:.4f} "
          f"ber={state['ber']:.4f}")
    
    # Feed to ASR when utterance complete
    if is_speech and state['silence_duration_ms'] > 500:
        transcript = asr_transcribe(audio_buffer)
```

### Verified Against These Sources

| Component | Source | Verified By |
|-----------|--------|-------------|
| IMCRA noise est. | Cohen 2003 [1] | Paper formula Eq. 17 |
| Decision-directed SNR | Ephraim & Malah 1984 [2] | Paper Eq. 10 |
| WebRTC min tracking | Vad_sp.c [4] | Source code lines |
| Spectral flux (L2) | Essentia Flux algorithm | Library source |
| MFCC | Davis & Mermelstein 1980 | Paper comparison |

### References

1. Cohen, I. (2003). "Noise spectrum estimation in adverse environments: Improved minima controlled recursive averaging." *IEEE Trans. Speech Audio Process.*, 11(5), 466–475. DOI: 10.1109/TSA.2003.811544
2. Ephraim, Y. & Malah, D. (1984). "Speech enhancement using a minimum mean-square error short-time spectral amplitude estimator." *IEEE Trans. Acoust., Speech, Signal Process.*, 32(6), 1109–1121. DOI: 10.1109/TASSP.1984.1164453
3. Sohn, J. et al. (1999). "A statistical model-based voice activity detection." *IEEE Signal Process. Lett.*, 6(1), 1–3. DOI: 10.1109/97.736019
4. WebRTC VAD. https://chromium.googlesource.com/external/webrtc/+/refs/heads/main/common_audio/vad/
5. Martin, R. (2001). "Noise power spectral density estimation based on optimal smoothing and minimum statistics." *IEEE Trans. SAP*, 9(5), 504–512. DOI: 10.1109/89.928915
