# Speaker Diarization — Implementation Plan v0.2

> **Status:** PLANNING — not implementing yet  
> **Target:** Universal diarizer: multi-speaker, open-set, real-time, overlap-aware  
> **Total estimated LOC:** ~530 Python + ~200 TypeScript  
> **Reference:** `docs/voice-algorithms/diarization/diarization-algorithms.md`

---

## Phase 1: Multi-Profile Enrollment (Replace Single-Speaker Gate)

**Goal:** Upgrade `SpeakerVerifier` from binary gate to multi-speaker matcher.

**Deliverable:** `speaker.py` v2 — enroll multiple speakers, match utterances to known profiles.

**Stable labels across sessions** (Alice stays "Alice" after restart).

### Schema

```sql
CREATE TABLE speaker_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,           -- "Alice", "Bob"
    embedding BLOB NOT NULL,             -- 192-d float32 serialized
    enrollment_duration_sec REAL,        -- total audio used for enrollment
    sample_count INTEGER DEFAULT 0,      -- number of utterances matched
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Implementation

```python
# stt/speaker.py — new MultiSpeakerMatcher class

class MultiSpeakerMatcher:
    """Match utterances against enrolled speaker profiles using ECAPA-TDNN."""

    def __init__(self):
        self._encoder = None           # ECAPA-TDNN (speechbrain)
        self._fallback = False         # True if using MFCC fallback

    def _ensure_encoder(self):
        """Lazy-load ECAPA-TDNN. Fall back to MFCC if speechbrain unavailable."""
        try:
            from speechbrain.inference.speaker import EncoderClassifier
            self._encoder = EncoderClassifier.from_hparams(
                source="speechbrain/spkrec-ecapa-voxceleb",
                savedir="pretrained_models/spkrec-ecapa-voxceleb"
            )
        except ImportError:
            self._fallback = True

    def embed(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """Compute 192-d speaker embedding. Falls back to MFCC if ECAPA unavailable."""
        if self._encoder is None:
            self._ensure_encoder()
        if self._fallback:
            return self._spectral_embed(audio, sr)  # existing MFCC method
        # Resample to 16kHz if needed, normalize, pad to min 1.5s
        return self._encoder.encode_batch(audio_tensor).squeeze().numpy()

    def enroll(self, name: str, audio_samples: list[np.ndarray], sr: int):
        """Create speaker profile from multiple enrollment samples.
        Stores mean embedding in DB via get_store()."""
        embeddings = [self.embed(a, sr) for a in audio_samples]
        profile = np.mean(embeddings, axis=0)
        profile = profile / np.linalg.norm(profile)
        get_store().upsert_speaker_profile(name, profile, sum(len(a)/sr for a in audio_samples))

    def match(self, audio: np.ndarray, sr: int) -> dict:
        """Match utterance against all enrolled profiles.
        Returns {'speaker': 'Alice', 'confidence': 0.87} or {'speaker': 'unknown'}."""
        emb = self.embed(audio, sr)
        profiles = get_store().list_speaker_profiles()
        best_sim = 0.0
        best_name = "unknown"
        for name, stored_emb in profiles:
            sim = float(np.dot(emb, stored_emb))
            if sim > best_sim:
                best_sim = sim
                best_name = name
        threshold = 0.5  # tune on dev set
        if best_sim >= threshold:
            get_store().increment_speaker_sample_count(best_name)
            return {"speaker": best_name, "confidence": round(best_sim, 4)}
        return {"speaker": "unknown", "confidence": round(best_sim, 4)}
```

### Orchestrator Integration

```python
# stt/orchestrator.py — _transcribe_and_print, after VAD before ASR
matcher = MultiSpeakerMatcher()
speaker_result = matcher.match(segment, sr)
_json_emit(config, {"type": "speaker", "label": speaker_result["speaker"],
                     "confidence": speaker_result["confidence"]})
```

### Store Methods (history.py)

- `upsert_speaker_profile(name, embedding, duration_sec)` — INSERT or UPDATE
- `list_speaker_profiles()` — SELECT name, embedding
- `delete_speaker_profile(name)` — DELETE by name
- `increment_speaker_sample_count(name)` — UPDATE sample_count += 1

### DB Migration

```sql
CREATE TABLE IF NOT EXISTS speaker_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    embedding BLOB NOT NULL,
    enrollment_duration_sec REAL DEFAULT 0,
    sample_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Estimated LOC:** 80 Python, 30 SQL  
**New deps:** `speechbrain` (optional, graceful fallback to MFCC)  
**Model size:** ~25MB download on first use

---

## Phase 2: Per-Utterance Attribution + Confidence

**Goal:** Every transcribed utterance gets a speaker label with confidence score in the JSON event stream. Unknown speakers get "unknown" label.

**Deliverable:** `{"type": "speaker", "label": "Alice", "confidence": 0.87}` in every utterance.

### JSON Event Changes

```json
{"type": "raw", "text": "Hello world", "speaker": "Alice", "speaker_conf": 0.87}
{"type": "processed", "text": "Hello world.", "speaker": "Alice", "speaker_conf": 0.87}
```

### Frontend Display (App.tsx)

- Show speaker avatar/initial next to each transcript line
- Color-coded by speaker (consistent palette, hashed from speaker name)
- "unknown" speakers get gray with "?" icon

### CLI Flag

```
--speaker-threshold 0.5   # Cosine similarity threshold for known speaker match
```

**Estimated LOC:** 50 Python, 40 TypeScript

---

## Phase 3: Incremental AHC for Unknown Speakers

**Goal:** When unenrolled speakers speak, cluster their utterances into `speaker_1`, `speaker_2`, etc. Clusters persist within a session.

**Deliverable:** New file `stt/diarization.py`.

### Algorithm

```
Session state:
    unknown_clusters: list[Cluster]   # each has: centroid (192-d), label ("speaker_1"), count

Per utterance (unknown speaker):
    1. Compute embedding via ECAPA-TDNN
    2. For each existing cluster: compute cosine similarity to centroid
    3. If max_sim > merge_threshold (0.6): assign to that cluster, update centroid (running mean)
    4. Else: create new cluster "speaker_{N+1}"
    5. Emit label in speaker event
```

### Implementation

```python
# stt/diarization.py

@dataclass
class Cluster:
    label: str
    centroid: np.ndarray       # 192-d
    count: int
    created_at: float          # monotonic timestamp

class IncrementalDiarizer:
    def __init__(self, merge_threshold: float = 0.6):
        self._clusters: list[Cluster] = []
        self._threshold = merge_threshold
        self._next_id = 1

    def assign(self, embedding: np.ndarray) -> str:
        """Assign embedding to existing cluster or create new one."""
        best_sim = 0.0
        best_idx = -1
        for i, c in enumerate(self._clusters):
            sim = float(np.dot(embedding, c.centroid))
            if sim > best_sim:
                best_sim = sim
                best_idx = i

        if best_sim >= self._threshold and best_idx >= 0:
            c = self._clusters[best_idx]
            # Update centroid: running mean weighted by count
            c.centroid = (c.centroid * c.count + embedding) / (c.count + 1)
            c.centroid = c.centroid / np.linalg.norm(c.centroid)
            c.count += 1
            return c.label
        else:
            label = f"speaker_{self._next_id}"
            self._clusters.append(Cluster(
                label=label,
                centroid=embedding / np.linalg.norm(embedding),
                count=1,
                created_at=time.monotonic()
            ))
            self._next_id += 1
            return label

    def reset(self):
        """Clear all clusters (new session)."""
        self._clusters.clear()
        self._next_id = 1
```

### Orchestrator Wiring

```python
# orchestrator.py
diarizer = IncrementalDiarizer(merge_threshold=0.6)

match = matcher.match(audio, sr)
if match["speaker"] == "unknown":
    label = diarizer.assign(embedding)   # cluster unknowns
else:
    label = match["speaker"]             # known speaker
```

### Key Design Decisions

- **Merge threshold 0.6:** Higher = more clusters (fragmentation). Lower = more merges (confusion). Tune per environment.
- **Running mean centroid:** O(1) update per utterance. No need to store all embeddings.
- **Session-scoped:** Clusters reset on app restart. For cross-session stability, use enrollment (Phase 1).

**Estimated LOC:** 100 Python

---

## Phase 4: Overlap Detection

**Goal:** Detect when 2+ speakers talk simultaneously. Flag overlapping regions in output.

**Deliverable:** Overlap flag in speaker events: `{"overlap": true, "overlap_confidence": 0.72}`.

### Method: Spectral Flatness + Energy Anomaly

```
per frame (25ms, 10ms stride):
    1. Compute spectral flatness = geometric_mean(spectrum) / arithmetic_mean(spectrum)
    2. Compute RMS energy
    3. Overlap score = spectral_flatness * (rms / running_mean_rms)
    4. If overlap_score > threshold (2.0): mark as overlap
```

Rationale: Overlapping speech has flatter spectrum (two vocal tracts) and higher energy.

### Implementation

```python
# stt/diarization.py

class OverlapDetector:
    def __init__(self, sr: int = 16000, frame_ms: int = 25, stride_ms: int = 10):
        self._frame_len = int(sr * frame_ms / 1000)
        self._stride = int(sr * stride_ms / 1000)
        self._energy_ema = 0.01     # running mean RMS

    def detect(self, audio: np.ndarray) -> tuple[bool, float]:
        """Returns (is_overlap, confidence)."""
        frames = np.lib.stride_tricks.sliding_window_view(
            audio[:len(audio) - len(audio) % self._stride], self._frame_len
        )[::self._stride]
        if len(frames) == 0:
            return False, 0.0

        rms_vals = np.sqrt(np.mean(frames ** 2, axis=1))
        self._energy_ema = 0.95 * self._energy_ema + 0.05 * np.median(rms_vals)

        spec = np.abs(np.fft.rfft(frames * np.hanning(self._frame_len)))
        spec = np.where(spec < 1e-10, 1e-10, spec)
        flatness = np.exp(np.mean(np.log(spec), axis=1)) / np.mean(spec, axis=1)

        scores = flatness * (rms_vals / max(self._energy_ema, 1e-8))
        max_score = float(np.max(scores))
        return max_score > 2.0, min(max_score / 4.0, 1.0)
```

### Orchestrator Wiring

```python
# Called before ASR, per audio segment
overlap_detector = OverlapDetector(sr)
is_overlap, conf = overlap_detector.detect(segment)
if is_overlap:
    _debug(config, f"overlap detected: conf={conf:.2f}")
# Include in speaker JSON event
```

**Estimated LOC:** 40 Python

---

## Phase 5: Streaming Label Reconciliation

**Goal:** Speaker labels stay consistent across long sessions. `speaker_1` in minute 1 is the same `speaker_1` in minute 60.

**Problem:** Incremental AHC (Phase 3) can create duplicate clusters for the same speaker if they pause for a long time (embedding drift, centroid shift).

**Solution:** Periodically reconcile clusters via Hungarian matching on cosine similarity.

### Algorithm

```
Every N utterances (default 20) or every M seconds (default 30):
    1. Compute pairwise cosine similarity between all cluster centroids
    2. Build cost matrix: cost = 1 - similarity
    3. Run Hungarian algorithm to find optimal matching
    4. For matched pairs with similarity > merge_threshold (0.7):
       a. Merge into older cluster (keep lower-numbered label)
       b. Update centroid as weighted mean
       c. Update all assigned utterance labels
    5. For unmatched clusters: keep as-is
```

### Implementation

```python
# stt/diarization.py

from scipy.optimize import linear_sum_assignment

class IncrementalDiarizer:
    def __init__(self, merge_threshold=0.6, reconcile_every=20):
        self._reconcile_every = reconcile_every
        self._utterance_count = 0
        # ... existing fields ...

    def assign(self, embedding: np.ndarray) -> str:
        label = self._assign_internal(embedding)   # existing logic
        self._utterance_count += 1
        if self._utterance_count % self._reconcile_every == 0:
            self._reconcile()
        return label

    def _reconcile(self):
        if len(self._clusters) < 2:
            return
        n = len(self._clusters)
        centroids = np.stack([c.centroid for c in self._clusters])
        sim_matrix = centroids @ centroids.T
        cost = 1.0 - sim_matrix

        # Only reconcile clusters that are old enough (>30s)
        now = time.monotonic()
        old_mask = np.array([(now - c.created_at) > 30 for c in self._clusters])
        if old_mask.sum() < 2:
            return

        # Hungarian matching on old clusters
        old_indices = np.where(old_mask)[0]
        old_cost = cost[old_indices][:, old_indices]
        row_ind, col_ind = linear_sum_assignment(old_cost)

        merged = set()
        for i, j in zip(row_ind, col_ind):
            if i >= j or old_indices[i] in merged or old_indices[j] in merged:
                continue
            sim = sim_matrix[old_indices[i], old_indices[j]]
            if sim > 0.7:   # merge threshold
                # Merge j into i (keep older cluster)
                ci = self._clusters[old_indices[i]]
                cj = self._clusters[old_indices[j]]
                total = ci.count + cj.count
                ci.centroid = (ci.centroid * ci.count + cj.centroid * cj.count) / total
                ci.centroid = ci.centroid / np.linalg.norm(ci.centroid)
                ci.count = total
                merged.add(old_indices[j])

        # Remove merged clusters (in reverse index order)
        for idx in sorted(merged, reverse=True):
            del self._clusters[idx]
```

**Estimated LOC:** 60 Python  
**New dep:** `scipy` (already available in most envs)

---

## Phase 6: Speaker Profiles UI + API

**Goal:** Manage speaker profiles like dictionary entries — add, remove, re-enroll.

**Deliverable:** `SpeakerProfilesPage.tsx` + REST API + Tauri commands.

### API Routes (`stt/routes/speakers.py`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/speakers` | GET | List all profiles |
| `/api/speakers` | POST | Enroll new speaker (multipart audio upload) |
| `/api/speakers/{name}` | DELETE | Remove profile |
| `/api/speakers/{name}/reenroll` | POST | Add more enrollment audio |

### Frontend (`SpeakerProfilesPage.tsx`)

- Grid of speaker cards: name, avatar (colored initial), sample count, enrollment duration
- "Enroll Speaker" button → modal with name input + "Record 10s of speech" button
- Uses existing mic infrastructure to capture enrollment audio
- "Re-enroll" button for adding more samples
- "Delete" with confirmation dialog
- Speaker color palette: 8 distinct colors, hashed from speaker name for consistency

### DB Methods (history.py)

```python
def upsert_speaker_profile(self, name, embedding, duration_sec) -> bool
def list_speaker_profiles(self) -> list[dict]
def delete_speaker_profile(self, name) -> bool
def increment_speaker_sample_count(self, name) -> bool
def get_speaker_stats(self) -> dict   # total speakers, total utterances attributed
```

### Tauri Commands (lib.rs)

```rust
#[tauri::command] async fn get_speaker_profiles() -> Vec<SpeakerProfile>
#[tauri::command] async fn enroll_speaker(name: String, audio: Vec<f32>) -> bool
#[tauri::command] async fn delete_speaker_profile(name: String) -> bool
```

### Navigation (Sidebar.tsx)

Add "Speakers" nav item with `Users` icon, between Insights and Dictionary.

**Estimated LOC:** 100 Python (routes + store methods), 80 Rust (commands), 100 TypeScript (page + modals)  
**Total Phase 6:** ~280 LOC

---

## Dependency Summary

| Dependency | Phase | Purpose | Size | Required? |
|-----------|-------|---------|------|-----------|
| `speechbrain` | 1 | ECAPA-TDNN embeddings | ~50MB | Optional (MFCC fallback) |
| `scipy` | 5 | Hungarian algorithm for reconciliation | ~30MB | Optional (manual implementation possible) |
| `numpy` | 1-5 | Array ops, already a dep | — | Already present |
| `resemblyzer` | 1 | Existing fallback embedding | ~5MB | Already present |

---

## JSON Event Stream Changes

### Current Events
```
{"type": "state", "state": "listening"}
{"type": "raw", "text": "Hello world", "utterance_id": 1}
{"type": "processed", "text": "Hello world.", "utterance_id": 1}
{"type": "mic", "level": 0.123}
{"type": "error", "message": "...", "utterance_id": 2}
```

### New Events (Phases 1-5)
```
{"type": "speaker", "label": "Alice", "confidence": 0.87, "utterance_id": 1}
{"type": "speaker", "label": "speaker_1", "confidence": 0.62, "is_clustered": true, "utterance_id": 2}
{"type": "speaker", "label": "unknown", "confidence": 0.38, "utterance_id": 3}
{"type": "overlap", "detected": true, "confidence": 0.72, "utterance_id": 4}
```

Augmented `raw` and `processed` events (Phase 2):
```
{"type": "raw", "text": "Hello", "utterance_id": 1, "speaker": "Alice", "speaker_conf": 0.87}
```

---

## Test Plan

| Phase | Test | Approach |
|-------|------|----------|
| 1 | Multi-profile match accuracy | Enroll 2 speakers, verify attribution on 50 utterances |
| 1 | MFCC fallback correctness | Run without speechbrain, verify embeddings produced |
| 2 | JSON event format | Parse all events, verify speaker field present |
| 3 | Unknown clustering | Play 3-speaker audio, verify 3 distinct clusters |
| 3 | Cluster merge threshold | Verify same speaker gets same label across 100 utterances |
| 4 | Overlap detection | Mix 2 single-speaker tracks, verify overlap flag |
| 4 | Overlap false positive rate | Single-speaker audio → overlap flag <5% of frames |
| 5 | Label stability | 60-minute session, verify no cluster fragmentation |
| 6 | Enrollment UI | Enroll speaker via UI, verify profile in DB |
| 6 | API round-trip | POST /api/speakers → GET /api/speakers → DELETE |

---

## Rollout Order

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──► Phase 6
  │           │           │           │           │           │
  ▼           ▼           ▼           ▼           ▼           ▼
Ship it     JSON        Open-set    Overlap     Stable      UI + API
MVP         events      clusters    detection   labels      management
```

Each phase is independently shippable and adds value without breaking prior phases.

---

## References

- `docs/voice-algorithms/diarization/diarization-algorithms.md` — Full algorithm reference
- `stt/speaker.py` — Current SpeakerVerifier implementation
- `stt/history.py` — HistoryStore pattern for DB methods
- `stt/routes/dictionary.py` — API route pattern to clone
- `stt-ui/src/components/DictionaryPage.tsx` — UI pattern to clone
- `speechbrain/spkrec-ecapa-voxceleb` — Pre-trained ECAPA-TDNN on HuggingFace
- `https://github.com/BUTSpeechFIT/VBx` — VBx clustering (future option)
- `https://github.com/google/uis-rnn` — UIS-RNN online clustering (future option)
