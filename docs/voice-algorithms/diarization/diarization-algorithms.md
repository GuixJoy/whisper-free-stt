# Speaker Diarization — Algorithms, Architecture & Universal Pipeline

## Overview

Speaker diarization answers "who spoke when?" It partitions an audio stream into
homogeneous segments and labels each with a speaker identity. This is distinct from
**speaker verification** (is this Alice?) — diarization must handle unknown numbers
of speakers, unknown identities, overlap, and turn-taking dynamics.

### Current STT System (speaker.py)

```
Audio → Resemblyzer/MFCC embedding → cosine similarity vs enrolled profile → accept/reject
```

**Limitations:**
- Single-speaker gate: binary accept/reject, no multi-speaker tracking
- Only verifies against ONE enrolled profile
- No speaker change detection — doesn't know when speaker switches
- No overlap handling
- No clustering for unknown speakers
- Embedding quality degrades on short segments (<1.5s)

### Target: Universal Diarization

```
Audio → VAD segments → speaker change detection → per-segment embeddings
                                                    │
                              ┌─────────────────────┼─────────────────────┐
                              ▼                     ▼                     ▼
                         Known speakers       Unknown speakers        Overlap regions
                         (nearest-neighbor)   (clustering)           (multi-label)
                              │                     │                     │
                              └─────────────────────┴─────────────────────┘
                                                    ▼
                                          Labeled segments: "Alice said X, Bob said Y"
```

---

## 1. Speaker Embeddings — The Foundation

Every diarization system starts with good embeddings. These convert arbitrary-length
audio into fixed-length vectors where same-speaker pairs cluster together.

### Architecture Comparison

| Model | Dim | Short Segment (<2s) | CPU Speed | Memory | Code |
|-------|-----|---------------------|-----------|--------|------|
| **ECAPA-TDNN** | 192 | ★★★★★ Best | ~20ms/2s | ~25MB | SpeechBrain |
| **TitaNet-L** | 192 | ★★★★★ SOTA | ~30ms/2s | ~100MB | NVIDIA NeMo |
| **Resemblyzer** | 256 | ★★★☆☆ OK ≥1.6s | ~10ms/2s | ~5MB | resemblyzer |
| **WavLM Base+** | 768 | ★★★★☆ Good | ~50ms/2s | ~350MB | HuggingFace |
| **x-vector** | 512 | ★★☆☆☆ ≥3s needed | ~5ms/2s | ~10MB | Kaldi |
| **MFCC fallback** | 256 | ★☆☆☆☆ Unstable | ~1ms/2s | 0MB | numpy only |

### ECAPA-TDNN Architecture (Desplanques et al. 2020)

```
Audio → Mel Filterbank (80-dim) → 3× SE-Res2Block → Multi-layer Feature Aggregation
         → Attentive Statistics Pooling (weighted mean/std per channel) → 192-d embedding
```

**Key innovations over x-vector:**
1. **Squeeze-and-Excitation blocks**: channel-wise attention recalibrates feature importance
2. **Multi-layer feature aggregation**: skip connections from all 3 SE-Res2Block layers
3. **Channel-dependent attentive pooling**: learned attention weights, not uniform pooling
4. **AAM-Softmax loss**: additive angular margin for better inter-speaker separation

**Quick integration:**
```python
from speechbrain.inference.speaker import EncoderClassifier
classifier = EncoderClassifier.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb",
    savedir="pretrained_models/spkrec-ecapa-voxceleb"
)
embedding = classifier.encode_batch(audio_tensor)  # [1, 192]
```

### TitaNet Architecture (Koluguri et al. 2021)

```
Audio → Mel Spectrogram → 1D Depthwise Separable Conv blocks
         → SE layers with Global Context → Attentive Stats Pooling → 192-d t-vector
```

**Key difference from ECAPA-TDNN:** Global context in SE blocks operates over the
entire sequence (not frame-local), making it more robust to variable-length inputs.

---

## 2. Segmentation — Finding "Who Spoke When"

Segmentation divides audio into speaker-homogeneous regions. This includes VAD
(speech vs silence), speaker change detection (SCD), and optionally overlap detection.

### Tier 1: Simple VAD + Fixed Windows

```
Silero VAD → split at silence gaps ≥ 500ms → one embedding per segment → cluster
```

**Pros:** Zero external deps beyond VAD. <5 lines of code.  
**Cons:** Long segments may contain speaker changes. Short segments produce poor embeddings.

### Tier 2: pyannote Segmentation Model

```python
from pyannote.audio import Pipeline
pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1")
diarization = pipeline(audio_file)  # returns Annotation with speaker labels
```

**Internals:**
- **Powerset multi-class loss** (Plaquet & Bredin 2023): frames labeled as {A}, {B}, {A,B} etc.
- SincNet frontend → LSTM backbone → per-frame multi-label output
- Simultaneously predicts: speech/non-speech, speaker count, overlap
- One model handles VAD + SCD + overlap detection jointly

**Latency:** ~31s per hour of audio on H100. ~5-10min/hour on CPU (model dependent).

### Tier 3: Streaming BIC/KL Speaker Change Detection

```
Sliding window (2-3s, 100ms stride) → MFCC extraction → model left half vs right half
→ ΔBIC = BIC(2 Gaussians) - BIC(1 Gaussian) > threshold → speaker change detected
```

**BIC formula:**
```
ΔBIC = (N_l/2)log|Σ_l| + (N_r/2)log|Σ_r| - (N/2)log|Σ| + λ·(d + d(d+1)/2)·log(N)
```
where λ = penalty weight, d = feature dimension, N = total frames.

**Pros:** CPU-real-time, zero ML deps, ~1ms per window.  
**Cons:** Fails on noisy/overlapped speech. ~20% miss rate on conversational data.

---

## 3. Clustering — Grouping Unknown Speakers

When you don't know who the speakers are, clustering groups similar embeddings
into speaker clusters.

### AHC — Agglomerative Hierarchical Clustering (pyannote 3.1 default)

```
1. Compute pairwise cosine distance matrix
2. Iteratively merge closest clusters until threshold exceeded
3. Output: cluster ID per segment
```

**Threshold tuning is critical.** Too low → speaker fragmentation (one speaker → many clusters).
Too high → speaker merging (two speakers → one cluster).

```python
from sklearn.cluster import AgglomerativeClustering
clustering = AgglomerativeClustering(
    n_clusters=None, distance_threshold=0.5, metric='cosine', linkage='average'
)
labels = clustering.fit_predict(embeddings)
```

### VBx — Bayesian HMM Clustering (Diez et al. 2020)

**Current SOTA for offline clustering accuracy.**

```
Model: x-vector space ~ Gaussian per speaker + HMM transition matrix
Method: Variational Bayes iterative refinement
        1. Initialize: AHC on x-vectors → rough speaker labels
        2. E-step: compute soft speaker assignment posteriors
        3. M-step: update speaker means, covariances, transition probs
        4. Repeat 10-20 iterations
```

**Key properties:**
- No threshold tuning needed (fully Bayesian)
- Models turn-taking dynamics (HMM self-loop probability ~0.98)
- ~1-2s per 10min audio on CPU
- Assumes NO overlap (single-speaker HMM states)
- DER improvement: ~30-50% over raw AHC

**Code:** `https://github.com/BUTSpeechFIT/VBx`

### UIS-RNN — Online Clustering (Google 2019)

**The only production-ready online clustering method.**

```
Per timestep:
    1. Feed speaker embedding to current speaker's RNN
    2. RNN predicts: continue same speaker? OR switch?
    3. If switch: pick existing speaker (via ddCRP prior) OR create new
    4. Update RNN hidden state
```

**Key properties:**
- Truly online: instant speaker assignment per segment
- Learned transition probabilities (trained on labeled diarization data)
- ~2-10ms per frame on CPU
- DER ~8-10% on CALLHOME (worse than offline VBx, but real-time)

**Code:** `https://github.com/google/uis-rnn`

---

## 4. Overlap Detection

10-20% of conversational speech contains overlapping talkers. Standard pipelines
fail here because they assume one speaker per frame.

### Method 1: pyannote Segmentation (built-in)

The powerset segmentation model natively outputs multi-label frame predictions:
`{speaker_A}, {speaker_B}, {speaker_A, speaker_B}`. No extra code needed.

### Method 2: Binary Classifier (simple, independent)

```python
# Fine-tune small model on overlap/non-overlap labels
# Input: 1s audio chunk → MFCC or spectrogram
# Output: P(overlap)
# Threshold at 0.5
```

### Method 3: Dual Energy Threshold (crude, zero-deps)

```
IF frame_energy > 2 * median_energy AND spectral_flatness > 0.5:
    mark as potential_overlap
```

**Only use as a last resort.** False positive rate >30%.

---

## 5. Universal Pipeline Architectures

### Architecture A: Enrollment-Based (Known Speakers, Our Current Evolution)

**When to use:** You know all speakers in advance (team meetings, personal use).

```
Enrollment Phase (once):
    10-30s clean audio per speaker → ECAPA-TDNN embedding → store in DB

Runtime Phase:
    Audio → VAD → per-segment ECAPA-TDNN embedding
                → cosine similarity vs all enrolled profiles
                → assign nearest neighbor if sim > 0.5
                → mark as "unknown" if all below threshold
                → optionally cluster unknowns via AHC
```

**Implementation path in STT:**
1. Replace `SpeakerVerifier` with multi-profile enrollment
2. Store profiles in `dictionary_entries` table or new `speaker_profiles` table
3. Per-utterance: embed → match against all profiles → attribute
4. Add "unknown" cluster for unattributed segments

**Stats:** ~50-100 LOC change in `speaker.py`. ECAPA-TDNN adds ~25MB model download.

### Architecture B: Fully Open-Set (Unknown Speakers, Offline)

**When to use:** Meetings, interviews, podcasts — you don't know who will speak.

```
Audio → pyannote community-1 pipeline (VAD + segmentation + AHC)
     → post-process with VBx (refine clusters)
     → output: speaker labels per segment
```

**Implementation path in STT:**
1. Add `pyannote.audio` as optional dependency
2. Add `--diarization-mode open` CLI flag
3. Post-processing step after utterance collection (batch mode)

**Stats:** ~500 LOC new file `stt/diarization.py`. Heavy dep (~1GB models).

### Architecture C: Real-Time Open-Set (Unknown Speakers, Streaming)

**When to use:** Live dictation with multiple speakers, low latency required.

```
Audio → sliding window (3s window, 1.5s stride)
     → VAD → ECAPA-TDNN per chunk
     → UIS-RNN online clustering → instant speaker label
     → Hungarian matching across consecutive windows to reconcile labels
```

**Implementation path in STT:**
1. Add UIS-RNN as optional dep (or implement lightweight incremental AHC)
2. Maintain sliding context buffer (~10s) for label reconciliation
3. Emit `speaker_change` events in the JSON stream

**Stats:** ~300 LOC new file. UIS-RNN adds torch dep (~200MB).

### Architecture D: Universal (Recommended for STT)

**Combines best of all worlds — known speakers + open-set + real-time.**

```
┌─────────────────────────────────────────────────────────┐
│                   STT Universal Diarizer                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Audio → VAD → Segmentation                             │
│                  │                                      │
│                  ▼                                      │
│  ┌──────────────────────────────┐                       │
│  │  Per-segment ECAPA-TDNN      │                       │
│  │  embedding (192-d)           │                       │
│  └──────────────┬───────────────┘                       │
│                  │                                      │
│         ┌───────┴────────┐                              │
│         ▼                ▼                              │
│  ┌──────────────┐  ┌──────────────┐                     │
│  │ Known Profile │  │ Open-Set     │                     │
│  │ Matcher       │  │ Clusterer    │                     │
│  │ (cosine >0.5) │  │ (incremental │                     │
│  │ → enrolled ID │  │  AHC)        │                     │
│  └──────┬───────┘  └──────┬───────┘                     │
│         │                │                              │
│         └───────┬────────┘                              │
│                  ▼                                      │
│  ┌──────────────────────────────┐                       │
│  │  Speaker Label per Segment   │                       │
│  │  {speaker, start, end, conf} │                       │
│  └──────────────────────────────┘                       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Concrete implementation plan:**

| Phase | What | Dependencies | LOC | Deliverable |
|-------|------|-------------|-----|-------------|
| **1** | Multi-profile enrollment (replace single-speaker gate) | ECAPA-TDNN (SpeechBrain) | ~80 | `speaker.py` v2 |
| **2** | Per-utterance attribution with confidence scores | Same | ~50 | JSON event: `{"type":"speaker","label":"Alice","conf":0.87}` |
| **3** | Incremental AHC for unknown speakers | numpy + scipy | ~100 | `stt/diarization.py` |
| **4** | Overlap detection via energy + spectral flatness | numpy only | ~40 | Overlap flag in speaker event |
| **5** | Streaming label reconciliation (Hungarian matching across windows) | scipy.optimize | ~60 | Stable labels across long sessions |
| **6** | Speaker profiles UI + DB storage | SQLite + React | ~200 | Dictionary-like management page |

---

## 6. Evaluation & Benchmarks

### Standard Metrics

| Metric | Formula | Best For |
|--------|---------|----------|
| **DER** | (Missed + False Alarm + Confusion) / Total | NIST standard, forgiving collar 250ms |
| **JER** | 1 - mean(Jaccard per speaker) | Short-utterance fairness (DIHARD) |
| **cpWER** | Concatenated minimum-permutation WER | ASR+diarization joint eval |

### Target Performance

| Scenario | Target DER | Realistic with Phase 1-3 |
|----------|-----------|--------------------------|
| Single known speaker (current) | <5% | ✅ Already achieved |
| 2 known speakers, clean audio | <10% | ✅ Phase 1-2 |
| 2-4 known speakers, meeting audio | <15% | ✅ Phase 1-3 |
| Open-set, 2-4 unknown speakers | <20% | ⚠️ Phase 3-4 |
| Open-set, noisy environment | <30% | ⚠️ Phase 3-5 |
| Real-time streaming | <25% | ⚠️ Phase 5-6 |

---

## 7. Key Papers

| Paper | Authors | Year | Key Contribution |
|-------|---------|------|-----------------|
| ECAPA-TDNN | Desplanques et al. | 2020 | Channel attention + multi-layer aggregation for speaker embeddings |
| TitaNet | Koluguri et al. | 2021 | Global context SE blocks for scalable speaker embeddings |
| pyannote.audio 2.1 | Bredin | 2023 | End-to-end segmentation with powerset loss |
| VBx | Diez et al. | 2020 | Bayesian HMM clustering for diarization refinement |
| UIS-RNN | Zhang et al. | 2019 | Supervised online speaker clustering |
| Powerset EEND | Plaquet & Bredin | 2023 | Multi-class formulation for overlap-native diarization |
| WhisperX | Bain et al. | 2023 | ASR + forced alignment + diarization pipeline |
| DOVER-Lap | Raj et al. | 2020 | System fusion for overlapping speech diarization |

## 8. Key Repositories

| Repository | What | License |
|------------|------|---------|
| `pyannote/pyannote-audio` | Gold standard diarization pipeline | MIT |
| `speechbrain/speechbrain` | ECAPA-TDNN + full speaker recognition toolkit | Apache 2.0 |
| `BUTSpeechFIT/VBx` | Best clustering refinement | Apache 2.0 |
| `google/uis-rnn` | Online clustering (archived 2026) | Apache 2.0 |
| `m-bain/whisperX` | ASR + diarization combo | BSD-4 |
| `huggingface/speechbrain/spkrec-ecapa-voxceleb` | Pre-trained ECAPA-TDNN | Apache 2.0 |
| `snakers4/silero-vad` | Fastest open VAD | MIT |
| `juanmc2005/Diart` | Streaming diarization pipeline | MIT |
