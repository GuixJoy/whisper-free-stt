# Algorithm — Streaming VAD & Endpoint Detection

## Overview

The voice-activity detector is an adaptive, dual-threshold streaming state machine
with hysteresis, windowed voting, and EMA-based noise-floor tracking. It processes
64ms audio chunks (1024 samples @ 16kHz) in real time.

## Data Structures

### `VADEvent`
```
kind: "start" | "end"
start_sample: int          # absolute sample index where speech began
end_sample: int | None     # absolute sample index where speech ended
forced_split: bool         # True if max_recording_sec triggered
```

### `StreamingEndpointDetector` State
```
_in_speech: bool                        # current VAD state
_speech_start_sample: int               # absolute sample of speech onset
_consecutive_unvoiced: int              # consecutive blocks below threshold
_noise_floor: float                     # EMA-tracked ambient RMS
_history: deque[bool]                   # sliding window of voiced/unvoiced decisions
_window_blocks: int                     # window size in blocks (decision_window_sec * sr / blocksize)
_min_silence_blocks: int                # silence_duration_sec * sr / blocksize
_min_speech_samples: int                # min_recording_sec * sr
_max_speech_samples: int                # max_recording_sec * sr
```

## RMS Computation

For a mono float32 signal `s` of length `n`:

```
RMS(s) = sqrt( mean( s.astype(float64) ** 2 ) )
```

Float64 accumulator prevents precision loss on long utterances. Returns 0.0 for empty input.

## Threshold Computation (Hysteresis)

Two thresholds are computed dynamically from the noise floor each update:

```
end_threshold   = clamp(noise_floor * noise_floor_margin,   silence_threshold_rms, 0.1)
start_threshold = clamp(end_threshold * start_threshold_multiplier, end_threshold, 0.2)
```

With default values:
- `noise_floor_margin = 3.0` → end threshold is 3× ambient noise
- `start_threshold_multiplier = 1.3` → start threshold is 30% higher than end
- Upper caps: end ≤ 0.1, start ≤ 0.2

This creates a **hysteresis gap**: speech must be 30% louder to start than to continue. Once speaking, the detector stays in SPEECH state through brief pauses that would not have triggered entry.

## State Machine

### SILENCE → SPEECH (trigger)

```
IF NOT _in_speech:
    # Track noise floor when silent
    IF rms <= start_threshold:
        noise_floor = α * noise_floor + (1-α) * rms    # EMA, α=0.95

    voiced = (rms >= start_threshold)
    history.append(voiced)
    voiced_ratio = sum(history) / len(history)

    IF history is full AND voiced_ratio >= trigger_ratio:
        pre_roll = window_blocks * blocksize + pre_speech_padding_sec * sample_rate
        speech_start = max(0, current_sample - pre_roll)
        _in_speech = True
        emit VADEvent("start", start_sample=speech_start)
```

Key design decisions:
- **Window voting** (`trigger_ratio = 0.8`): prevents false triggers from transient noises (keyboard clicks, door slams). At least 80% of the decision window must vote "voiced."
- **Pre-roll**: speech start is backdated by one full window plus `pre_speech_padding_sec` (0.2s) to capture the consonant onset that preceded the trigger.
- **EMA noise tracking** (`α = 0.95`): smooths ambient noise estimates. The α value means the noise floor has a ~20-block (~1.3s) half-life.

### SPEECH → SILENCE (detrigger)

```
IF _in_speech:
    voiced = (rms >= end_threshold)    # note: end threshold, lower than start
    history.append(voiced)
    voiced_ratio = sum(history) / len(history)

    IF voiced:
        consecutive_unvoiced = 0
    ELSE:
        consecutive_unvoiced += 1

    # Forced split: don't let utterances exceed max_recording_sec
    IF speech_duration_samples >= max_speech_samples:
        emit VADEvent("end", end_sample=current_sample, forced_split=True)

    # Natural endpoint
    unvoiced_ratio = 1 - voiced_ratio
    IF history is full
       AND unvoiced_ratio >= detrigger_ratio
       AND consecutive_unvoiced >= min_silence_blocks
       AND speech_duration >= min_speech_samples:
        # Trim trailing silence and add post-padding
        trim_samples = consecutive_unvoiced * blocksize
        end_sample = max(speech_start, current_sample - trim_samples)
        end_sample = min(end_sample + pre_speech_padding, current_sample)
        emit VADEvent("end", end_sample=end_sample, forced_split=False)
```

Key design decisions:
- **End threshold is lower**: hysteresis prevents chatter at the boundary.
- **Higher detrigger bar** (`detrigger_ratio = 0.9`): 90% of the window must be silent before ending. This avoids cutting off speech during natural pauses (e.g., between sentences).
- **Consecutive silence guard** (`min_silence_blocks`): even if the window ratio is met, the last N blocks must be continuously silent. With defaults: 0.9s × 16000 / 1024 ≈ 14 consecutive silent blocks.
- **Trailing silence trim**: the final `consecutive_unvoiced` blocks are trimmed so the utterance ends at the last speech sample, not the last silent block.
- **Minimum utterance guard** (`min_recording_sec = 0.5s`): prevents processing noise bursts as speech.
- **Maximum utterance guard** (`max_recording_sec = 15s`): prevents memory issues from a mic left open. Forces a split even mid-speech.

## Default Constants

| Parameter | Value | Rationale |
|---|---|---|
| `blocksize` | 1024 samples (64ms) | Fine enough for responsive VAD, coarse enough for low CPU |
| `sample_rate` | 16000 Hz | Whisper native rate, avoids resampling |
| `silence_threshold_rms` | 0.005 | Absolute floor, prevents divide-by-zero in noise margin |
| `silence_duration_sec` | 0.9 | ~1s of silence = end of utterance |
| `min_recording_sec` | 0.5 | Ignore clicks, coughs, chair creaks |
| `max_recording_sec` | 15.0 | Safety valve for runaway recordings |
| `noise_floor_alpha` | 0.95 | Slow EMA — resists brief spikes, adapts to room changes |
| `noise_floor_margin` | 3.0 | 3× ambient = end threshold |
| `start_threshold_multiplier` | 1.3 | 30% above end threshold |
| `trigger_ratio` | 0.8 | 80% of window must be voiced to start |
| `detrigger_ratio` | 0.9 | 90% of window must be silent to end |
| `decision_window_sec` | 0.2 | 3 blocks @ 64ms each |

## Transcription Pipeline

### 1. Pre-processing
- Normalize to float32 in [-1, 1]: `audio / max(|audio|)` if peak > 1.0
- Trim trailing silence: find last sample above 0.005, keep 200ms pad after it

### 2. Backend Dispatch
```
IF config.backend == WHISPER_CPP:
    model = cached pywhispercpp.Model(ggml_model_name)
    segments = model.transcribe(audio, single_segment=True)
    # Each segment: .t0, .t1 (10ms ticks), .text
ELSE:
    model = cached faster_whisper.WhisperModel(name, device, compute_type)
    segments, info = model.transcribe(audio, beam_size, language,
                                      condition_on_previous_text)
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
    payload = {model, messages=[system, user], max_tokens, temperature}
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
