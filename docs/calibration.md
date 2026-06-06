# Calibration Logic

## Overview

At startup, STT samples the microphone for **1.5 seconds** to measure the ambient
noise floor. This measurement seeds the adaptive VAD with an initial noise estimate,
so the detector works correctly regardless of microphone gain, room acoustics, or
background hum.

The calibration runs **in parallel** with ASR model warm-up (loading the Whisper
model into memory), so there is no added startup latency.

## Algorithm

### Step 1: Collect ambient samples

```python
calib_rms: list[float] = []
stream_iter = mic_stream(config.audio)   # opens mic, starts streaming
deadline = time.monotonic() + 1.5        # 1.5 second window

while time.monotonic() < deadline:
    chunk = next(stream_iter)             # 1024 samples (64ms) per chunk
    ring.extend(chunk)                    # preserve chunks — nothing lost
    calib_rms.append(compute_rms(chunk)) # compute RMS for each chunk
```

At 16kHz with 1024-sample blocks, this produces approximately:
```
1.5s × (16000 / 1024) ≈ 23 chunks
```

### Step 2: Compute the 10th percentile

```python
sorted_rms = sorted(calib_rms)           # ascending order
p10 = sorted_rms[len(sorted_rms) // 10]  # value at index ~2
```

**Why the 10th percentile?** The median or mean would be skewed upward if the
user speaks or makes noise during calibration. The 10th percentile is a robust
estimate of the quietest sustained noise floor — it's resistant to transient
sounds (speech, chair creaks, keyboard) that briefly spike RMS.

Example with 23 chunks, sorted:
```
[0.002, 0.003, 0.003, 0.003, 0.003, 0.004, 0.004, 0.004, 0.004, 0.004,
 0.005, 0.005, 0.005, 0.005, 0.005, 0.005, 0.006, 0.006, 0.007, 0.008,
 0.012, 0.015, 0.450]    ← 0.450 was a chair creak during calibration

p10 = sorted[23 // 10] = sorted[2] = 0.003
```

The spike at 0.450 does not affect p10. The median (sorted[11] = 0.005) would
have been pulled up, and the mean even more so.

### Step 3: Seed the detector

```python
detector.set_noise_floor(p10)
```

This sets `detector._noise_floor = max(0.003, 1e-6) = 0.003`.

### Step 4: Compute initial thresholds

The detector computes adaptive thresholds from the noise floor:

```python
end_threshold   = clamp(noise_floor × noise_floor_margin,  0.005, 0.1)
                = clamp(0.003 × 3.0, 0.005, 0.1)
                = clamp(0.009, 0.005, 0.1)
                = 0.009

start_threshold = clamp(end_threshold × start_threshold_multiplier, end_th, 0.2)
                = clamp(0.009 × 1.3, 0.009, 0.2)
                = clamp(0.0117, 0.009, 0.2)
                = 0.0117
```

So after calibration with a quiet room (p10=0.003):
- Speech must exceed **RMS 0.012** to trigger detection
- Speech drops below **RMS 0.009** to end the utterance
- The **hysteresis gap** is 0.0027 (start − end)

## Ongoing Adaptation

After calibration, the noise floor continues to track via exponential moving
average (EMA) during non-speech periods:

```python
if not _in_speech and rms <= start_threshold:
    noise_floor = 0.95 × noise_floor + 0.05 × rms
```

With α = 0.95, the noise floor has a **half-life of ~14 blocks** (~0.9 seconds).
This means:
- Brief noise spikes (door closing) barely register
- Sustained changes (fan turns on, room gets noisier) adapt within a few seconds
- The floor never drops below `silence_threshold_rms / noise_floor_margin` (the initial floor from the constructor)

## Why This Works

| Problem | Solution |
|---|---|
| Different mics have different gains | Calibration measures the actual noise level of the selected mic |
| User speaks during calibration | 10th percentile ignores transient speech spikes |
| Room noise changes over time | EMA continues tracking after calibration |
| Silent room → threshold too low → false triggers | `max(..., silence_threshold_rms)` floor at 0.005 |
| Noisy room → threshold too high → miss speech | Caps at 0.1 (end) and 0.2 (start) prevent unusable thresholds |
| First utterance cold start | ASR model loaded in parallel thread during calibration |

## Edge Cases

### Dead-silent room (p10 ≈ 0.0)
```
p10 = 0.001
end_th = clamp(0.001 × 3.0, 0.005, 0.1) = 0.005   ← floor kicks in
start_th = clamp(0.005 × 1.3, 0.005, 0.2) = 0.0065
```

### Noisy room (p10 = 0.05)
```
p10 = 0.05
end_th = clamp(0.05 × 3.0, 0.005, 0.1) = 0.1      ← cap kicks in
start_th = clamp(0.1 × 1.3, 0.1, 0.2) = 0.13
```

### All mics silent (calibration fails)
If no calibration data is collected (stream error), the detector starts with the
constructor default:
```
noise_floor = 0.005 / max(3.0, 1.0) = 0.00167
```
This is deliberately low, so the first few utterances will use conservative
thresholds that adapt upward quickly via EMA.

### Calibration overlap with warm-up
The ASR model warm-up (`warm_up_backend`) is launched as a daemon thread before
calibration begins. It runs completely in parallel — the mic stream and calibration
are on the main thread, while model loading happens on the warm-up thread. By the
time the first utterance is transcribed, the model is already in memory.
