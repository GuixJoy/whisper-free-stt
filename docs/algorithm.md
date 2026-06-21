# Algorithm — Universal Adaptive Streaming VAD & Endpoint Detection

## Overview

The voice-activity detector is a production-grade adaptive system designed for 24/7
continuous operation. It combines three pillars of adaptation:

1. **IMCRA noise estimation** (Cohen 2003) — continuous noise tracking
2. **Dual-timescale EMA** — 30-minute baseline + 2-second rapid change detection
3. **Hysteresis VAD** — asymmetric onset/offset thresholds with hangover

This replaces static thresholds that fail as environment changes (AC on/off, people
moving, time of day).

## Data Structures

### `VADEvent`
```
kind: "start" | "end"
start_sample: int          # absolute sample index where speech began
end_sample: int | None     # absolute sample index where speech ended
forced_split: bool         # True if max_recording_sec triggered
```

### `VADState` (Enum)
```
SILENCE = 0
SPEECH = 1
```

### `StreamingEndpointDetector` State
```
# Noise floor tracking (dual-timescale)
_noise_floor: float                    # current noise floor estimate
_noise_slow_alpha: float = 0.9999      # 30-minute time constant
_noise_fast_alpha: float = 0.995       # 2-second time constant
_noise_alpha: float                    # current alpha (blends slow/fast)
_energy_history: deque[float]          # 3-second window for percentile

# IMCRA state
_imcra_window: int = 150               # ~1.5s at 10ms frames
_imcra_power_history: deque[float]     # power spectrum history
_imcra_noise_est: float                # IMCRA noise estimate

# VAD state machine
_vad_state: VADState                   # SILENCE or SPEECH
_speech_duration_ms: int               # current speech duration
_silence_duration_ms: int              # current silence duration

# Thresholds (SNR-based, adaptive)
_speech_threshold_db: float = 6.0      # SNR threshold for speech
_hysteresis_up_db: float = 4.0         # onset margin (harder to start)
_hysteresis_down_db: float = 3.0       # offset margin (easier to stay)
_endpoint_timeout_ms: int = 500        # silence before speech end

# Hangover (prevents truncation)
_hang_counter: int                     # frames remaining in hangover
_hang_time: int                        # 150ms in blocks

# Streaming state
_in_speech: bool                       # current VAD state
_speech_start_sample: int              # absolute sample of speech onset
_min_speech_samples: int               # min_recording_sec * sr
_max_speech_samples: int               # max_recording_sec * sr
```

## RMS Computation

For a mono float32 signal `s` of length `n`:

```
RMS(s) = sqrt( mean( s² ) )
```

Returns 0.0 for empty input.

## Noise Floor Tracking (Dual-Timescale EMA)

The noise floor is tracked continuously using two exponential moving averages:

### Slow EMA (30-minute baseline)
```
noise_slow = α_slow * noise_slow + (1 - α_slow) * min_energy
α_slow = 0.9999  # ~30-minute half-life
```

### Fast EMA (2-second rapid changes)
```
noise_fast = α_fast * noise_fast + (1 - α_fast) * min_energy
α_fast = 0.995   # ~2-second half-life
```

### Adaptive Blending
```
energy_history.append(rms)
min_energy = percentile(energy_history, 10)  # robust to speech contamination

IF len(energy_history) >= 50:
    fast_min = percentile(last_50, 10)
    IF abs(fast_min - noise_floor) > 0.02:
        # Rapid change detected — blend 50/50
        noise_floor = 0.5 * noise_floor + 0.5 * fast_min
        α = 0.99  # temporarily faster
    ELSE:
        # Decay back to slow adaptation
        α = min(α_slow, α + 0.001)

noise_floor = α * noise_floor + (1 - α) * min_energy
noise_floor = clip(noise_floor, 0.001, 0.5)
```

## IMCRA Noise Estimation (Simplified)

Tracks local minimum of power spectrum over a sliding window:

```
power = mean(frame²)
imcra_power_history.append(power)

IF len(history) >= 150:
    local_min = percentile(powers, 5)  # proxy for minimum
    local_mean = mean(powers)
    local_var = var(powers)
    bias = 1 + sqrt(2/(window-1)) * (local_var / local_mean)
    imcra_noise_est = local_min * bias
```

## SNR-Based Speech Scoring

Instead of arbitrary RMS thresholds, speech is detected using SNR in dB:

```
snr_linear = rms / max(noise_floor, 1e-10)
snr_db = 10 * log10(snr_linear)
energy_score = snr_db / speech_threshold_db  # 6dB = 2x louder = speech
```

### Multi-Feature Fusion (Optional)

When `use_spectral_vad=True`, combines energy with spectral features:

```
spectral_score = (
    0.15 * flux_norm +        # onset detection
    0.15 * centroid_norm +    # speech frequency band
    0.15 * zcr_norm +         # voicing pattern
    0.15 * ber_norm           # speech energy concentration
)

composite = (1 - w) * energy_score + w * (energy_score * 0.6 + spectral_score * 0.4)
```

Where `w = spectral_weight` (default 0.4).

## Hysteresis VAD State Machine

### SILENCE → SPEECH (onset)

```
onset_threshold = 1.0 + hysteresis_up_db / 6.0   # = 1.67

IF vad_state == SILENCE:
    IF composite > onset_threshold:
        vad_state = SPEECH
        speech_duration_ms = 0
        silence_duration_ms = 0
        emit VADEvent("start", start_sample=current_sample - pre_roll)
    ELSE:
        silence_duration_ms += block_duration_ms
```

### SPEECH → SILENCE (offset)

```
offset_threshold = 1.0 - hysteresis_down_db / 6.0   # = 0.50

IF vad_state == SPEECH:
    IF composite < offset_threshold:
        silence_duration_ms += block_duration_ms
        IF silence_duration_ms > endpoint_timeout_ms:
            vad_state = SILENCE
        ELSE:
            is_speech = True  # still in hangover period
    ELSE:
        silence_duration_ms = 0
        is_speech = True
    speech_duration_ms += block_duration_ms
```

### Hangover Scheme

Prevents speech truncation by extending output for 150ms after speech ends:

```
IF is_speech:
    hang_counter = hang_time  # 150ms in blocks
ELSE:
    hang_counter = max(0, hang_counter - 1)

is_speech_final = hang_counter > 0 OR is_speech
```

## Default Constants

| Parameter | Value | Rationale |
|---|---|---|
| `blocksize` | 1024 samples (64ms) | Fine enough for responsive VAD, coarse enough for low CPU |
| `sample_rate` | 16000 Hz | Whisper native rate, avoids resampling |
| `speech_threshold_db` | 6.0 dB | SNR threshold — 2x louder than noise = speech |
| `hysteresis_up_db` | 4.0 dB | Onset margin — harder to start (prevents false triggers) |
| `hysteresis_down_db` | 3.0 dB | Offset margin — easier to stay (prevents cutting speech) |
| `endpoint_timeout_ms` | 500 ms | Silence before speech end |
| `hang_time` | 150 ms | Prevents truncation of trailing sounds |
| `noise_slow_alpha` | 0.9999 | 30-minute baseline tracking |
| `noise_fast_alpha` | 0.995 | 2-second rapid change detection |
| `imcra_window` | 150 frames | ~1.5s minimum for noise estimation |
| `min_recording_sec` | 0.5 | Ignore clicks, coughs, chair creaks |
| `max_recording_sec` | 15.0 | Safety valve for runaway recordings |
| `spectral_weight` | 0.4 | Balance between energy and spectral features |

## Transcription Pipeline

### 1. Pre-processing
- Normalize to float32 in [-1, 1]: `audio / max(|audio|)` if peak > 1.0
- Trim trailing silence: find last sample above 0.005, keep 200ms pad after it
- Noise reduction: spectral gating via `noisereduce` library

### 2. Backend Dispatch
```
IF config.backend == WHISPER_CPP:
    model = cached pywhispercpp.Model(ggml_model_name)
    segments = model.transcribe(audio, single_segment=True)
ELSE:
    model = cached faster_whisper.WhisperModel(name, device, compute_type)
    segments, info = model.transcribe(audio, beam_size, language, ...)
    # CUDA failure → retry with device="cpu", compute_type="int8"
```

### 3. Post-processing
- Concatenate segment texts with spaces
- Filter junk tokens: `[BLANK_AUDIO]`, `[MUSIC]`, `[NOISE]`
- Return `TranscriptionResult(text, language, segments)`

### 4. LLM Rewrite (optional, background thread)
```
IF llm_mode != OFF:
    prompt = build_user_prompt(raw_text, mode)
    payload = {model, messages, max_tokens, temperature, stream: false}
    POST to provider URL with Bearer auth
    IF OpenRouter and primary fails → retry with fallback_model
    Return cleaned text (or raw on failure)
```

### 5. Output
```
wtype → types into focused input (if typing enabled)
wl-copy → copies to Wayland clipboard (if clipboard enabled)
stdout → prints [raw] and [cleanup] markers
```

## Debug Output Format

```
[debug] rms=0.034 noise=0.007 snr=16.9dB state=SPEECH
[debug]   spectral: flux=43.85 centroid=1047Hz zcr=0.0811 ber=0.7267 score=1.94
```

- `rms`: current chunk RMS energy
- `noise`: tracked noise floor (adapts continuously)
- `snr`: signal-to-noise ratio in dB
- `state`: VAD state (SILENCE or SPEECH)
- `score`: composite speech probability (>1.67 = onset, <0.50 = offset)
