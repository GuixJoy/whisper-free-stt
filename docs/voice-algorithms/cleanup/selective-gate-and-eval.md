# Selective Gating & Own-Eval: Confidence Signals, Reachable APIs, Honest Measurement

Follow-up to `llm-cleanup-and-disfluency.md` (its citations are #69–#103 in
`../papers/citations.md`; this document does not re-derive it). Covers the three items
deliberately deferred there: (1) what confidence signal the literature actually gates on
and whether it is reachable in Floure's pinned stack, (2) the two pre-ASR settings, (3) the
own-eval design that extends `application/src-tauri/src/bench.rs` rather than replacing it.

Companion docs: `llm-cleanup-and-disfluency.md`, `../vad/vad-algorithms.md`,
`../papers/citations.md` (new section **Selective Gating & Evaluation Papers**, #104–#124).

Every claim below was verified against a fetched primary source (paper PDF/arXiv page,
first-party repo file, official spec, or crate source inspected on disk). Claims we could
not verify are marked **[unverified — dropped]** or omitted.

---

## 1. Gate Signals in the Literature, and How Thresholds Are Chosen & Reported

The companion document established that Floure's current gate keys on *disfluency*
(fillers, repeated bigrams, timestamp gaps) while the gated-correction literature keys on
*ASR-side uncertainty* (Idiap 0.7/0.95 thresholds, Pu's N-best disagreement — see
`llm-cleanup-and-disfluency.md` §3.1/§3.3/§5.2). This section maps the full signal
landscape and, critically, how thresholds and gate behavior are *chosen* and *reported*.

### 1.1 Signal families actually used (all rows fetched)

| # | Signal family | Concrete form | Used by (fetched source) |
|---|---|---|---|
| S1 | Token/frame posteriors (non-trainable) | max per-frame probability; Tsallis entropy over frame posteriors, exp-normalized, aggregated min/mean over a word | Laptev & Ginsburg, SLT 2022 (**#104**): max-per-frame-prob is "the natural way" but overconfident — *"median probability of incorrect predictions is above 0.9 … typical for overtrained CTC and RNN-T models"*; their min-aggregated entropy score is *"1.5 to 4 times better at detecting incorrect words"* for Conformer-CTC/RNN-T |
| S2 | Learned confidence module on decoder features (CEM) | `sigmoid(FC(attention, decoder state, token emb))`, trained on edit-distance correctness labels from N-best alignment | Li et al., ICASSP 2021 (**#105**); Wang et al., ASRU 2021 RNN-T CEM using word emission times (**#106**, NCE 0.4 / ECE 0.05); Naowarat et al., Interspeech 2023 CTC word-CEM (**#107**); Aggarwal et al., ICASSP 2025 — Whisper itself fine-tuned to emit confidences (**#108**) |
| S3 | N-best / multi-hypothesis disagreement | confusion-network posteriors from N-best (Hystoc); "utterances where N-best disagrees" gate (Pu #71); word confidences from lattice/N-best (hybrid era) | Beneš et al., ICASSP 2024 Hystoc (**#109**), which also records that *"in 1996, Wessel et al. have observed that word-level confidences derived from N-best list are well correlated to the error rates"*; Pu (#71) and Idiap (#75) as already established |
| S4 | Utterance/transcript-level prediction | mean of word confidences → P(utterance correct); explicit deletion-length head for WER estimation | Qiu et al. (**#78**, existing entry: joint word + utterance confidence with deletion prediction; utterance conf rescoring cuts WER 3–5% rel); Naowarat (**#107**): *"sentence-level confidence … average the word-level confidence scores"* for a review trigger |
| S5 | Calibration-set / risk-controlled thresholds | Chow reject rule (posterior < T, T from cost ratio); conformal quantile on a calibration set; Learn-then-Test on a dev set | Chow 1970 (**#110**); Ernez et al. 2023 conformal for wav2vec2.0 ASR (**#111**); Damri & Laufer-Goldshtein, ICLR 2026 (**#112**) |

Notes and bounds:

- **Aggregation choice is empirical, not folklore.** #108: *"the last token's confidence is
  considered to be the confidence for a given word. This method of aggregation proved to be
  the most optimal in our experiments, compared to other methods such as minimum, product
  and mean of word-piece confidences."* #76 (existing) found logprob + **sum** the strong
  baseline, min/second-best to sum/avg. So: word = last-token (or min/sum) — both positions
  have primary support; pick one, calibrate on dev.
- **Overconfidence is the documented default of exactly Floure's model class.** #104 (CTC/
  RNN-T), #105/#106/#107 (E2E generally): raw softmax/max-prob is systematically too
  confident; remedies are temperature scaling, entropy normalization, or a trained CEM.
  Floure has no training pipeline for a CEM, so the usable outcome of this literature is:
  *use raw token logprobs as a **ranking** signal, then choose the operating threshold on
  dev data* — do not treat `exp(logprob)` as a calibrated probability.
- **Dropped.** (a) *"MOER"*: two targeted searches returned only MooER (an unrelated LLM
  project) — **[unverified — dropped]**. (b) *"mutual-information-based confidence"* as a
  signal family: not found in any fetched source; the only verified MI connection is that
  the *evaluation metric* NCE *"is also known as the Normalized Mutual Information"* (#104)
  — **[signal claim unverified — dropped]**. (c) Predicting WER purely from transcript text
  (no audio/scores): no primary source found — the closest verified thing is S4
  (predicted word/utterance confidences, which consume model scores).

### 1.2 How the threshold is chosen (all rows fetched)

| Method | What it needs | Verified example |
|---|---|---|
| Fixed cut, swept on dev | a dev set with references | Idiap (#75): word-level 0.7 → 86.6/64.3/53.0% of utterances pass for Tiny/Medium/Large; sentence-level 0.95 (companion §3.1 holds the full table — cross-referenced here as the coverage-reporting exemplar) |
| Post-hoc monotone calibration on dev, then a cut | dev split | #105: piece-wise linear mappings *"estimated on dev-clean/dev-other and are then applied to test-clean/test-other"* — calibration never touches the test set |
| One threshold validated across heterogeneous test sets | a threshold that transfers | #77 (existing): model-selection gate with *"a pre-set threshold"* — same threshold yields 5.2% WER on Voice Search and 9.6% on the rare-word set (from 17.9% un-gated E2E) |
| Cost-ratio rule (reject option) | relative cost of a wrong correction vs. doing nothing | Chow (#110): reject iff max posterior `< T`, T determined by the cost of reject vs. error (rule restated in the fetched "Reject option with multiple thresholds": *"a pattern x is rejected if max_k P(ωk\|x) = P(ωi\|x) < T, where T ∈ [0,1]"*) |
| Conformal quantile on a calibration set (distribution-free coverage) | a calibration split + exchangeability | Ernez et al. (#111): Conformal Risk Control predicts a sentence set controlling WER to an adjustable guarantee — *"We guarantee that the WER is below 2% with a confidence level of 80% and an average set size of 29 sentences"*; their inductive conformal predictor *"detect[s] 90% of the badly transcripted words"* at ~10% of words flagged |
| Learn-then-Test multiple-testing calibration (high-probability risk bound) | a dev set + bounded risk per candidate threshold | Damri & Laufer-Goldshtein, ICLR 2026 (#112): LTT *"control[s] the expected relative word error rate degradation"* for adaptive N-best set sizes fed to an LLM corrector, with *high-probability bounds* verified empirically (*"success rates consistently exceed the theoretical minimum of 1 − δ"*). Note this is a risk-control threshold **for LLM error correction** — the same shape of decision Floure's gate makes |

**Consequence for Floure:** none of these needs a trained model. The ladder is
(dev-set sweep of a single scalar) → (conformal/LTT calibration on the same dev split if a
guarantee is wanted). The bench harness (§4) is exactly the dev set for this — with the
caveat that threshold tuning and final measurement must use different utterances or the
number is optimistically biased (see §4.6).

### 1.3 How the gate itself is reported (all rows fetched)

Aggregate WER alone hides whether the gate helps. The fetched sources report:

| Reporting practice | Verified example |
|---|---|
| Gate coverage (fraction of utterances that pass/fire) alongside WER | Idiap (#75): pass rates quoted per threshold alongside WER (numbers in companion §3.1 — cross-reference, not re-derived) |
| Threshold-relevant discrimination metrics, not just AUCROC | Wang et al. (#106): *"AUCROC and AUCPR … are dominated by correct predictions and paint an overly optimistic picture"*; they report NCE, ECE and AUC over the **NPV~TNR** curve because *"users or downstream applications wish to pick a confidence threshold to identify misrecognized words"* |
| An explicit operating point with both sides of the trade | Laptev & Ginsburg (#104): the estimator *"allows to filter out up to 40% of model hallucinations on pure noise data at the cost of 5% of correct words under regular acoustic conditions"* — i.e., false-positive cost of the gate is stated, and their Youden-curve metrics exist to assess *"adjustability"* across thresholds |
| Detection metrics on the error class specifically (TNR at fixed FPR) | #104 reports `TNR.05` (true-negative rate at 5% FPR) and `AUCNT`; #107 reports ROC with *"correctly predicted sentences as true positives"* for the review-trigger use |
| Empirical verification that the calibrated guarantee holds | #112: measured success rates vs the `1 − δ` bound on every trial |

**Minimum report for Floure's gate** (our synthesis, sources above + companion §5.2):
for every threshold, report (a) **coverage** — fraction of utterances sent to the LLM;
(b) **precision/recall of the gate** against the ground truth *"raw decode has ≥1 word
error"* (labels fall straight out of `bench.rs`'s per-utterance `edit_distance` vs the
manifest); (c) **WER of the pipeline, and WER on the corrected-vs-skipped subsets
separately, for both arms**; (d) the paired significance test of §4.7. A gate that reports
only aggregate WER cannot distinguish "the cleanup helped" from "the cleanup fixed the
fired subset and silently broke the skipped subset" — exactly the failure Idiap measured
even *with* confidence gating (companion §3.1).

---

## 2. What Is Actually Reachable Through sherpa-onnx 1.13.7

This is the decisive section: either a real confidence signal is reachable without forking,
or the gate must run on proxies. **Result: the signal is reachable** — upstream ships
per-token log-probabilities (`ys_log_probs`) in both the C API and the *JSON* the Rust safe
wrapper already fetches; only the Rust wrapper's serde struct drops it. N-best is *not*
reachable at this pin.

Paths inspected (no compilation involved):

- Safe crate: `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sherpa-onnx-1.13.7/src/offline_asr.rs`
- FFI crate: `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sherpa-onnx-sys-1.13.7/src/offline_asr.rs`
  (and `Cargo.toml`, `build.rs`)
- Upstream at the exact pin: source tarball
  `https://github.com/k2-fsa/sherpa-onnx/archive/refs/tags/v1.13.7.tar.gz` (fetched;
  `build.rs` downloads the prebuilt native libs from the same tag:
  `RELEASE_BASE_URL ... /releases/download/v{CARGO_PKG_VERSION}/...`)

### 2.1 The safe wrapper (confirmed exactly as suspected — and one step further)

`sherpa-onnx-1.13.7/src/offline_asr.rs` line 617–624:

```rust
#[derive(Clone, Debug, Deserialize)]
/// Recognition result returned by [`OfflineStream::get_result`].
pub struct OfflineRecognizerResult {
    pub text: String,
    pub tokens: Vec<String>,
    pub timestamps: Option<Vec<f32>>,
    pub durations: Option<Vec<f32>>,
}
```

Only `text`, `tokens`, `timestamps`, `durations`. No `ys_log_probs`, no per-token
logprob, no N-best. **But the wrapper goes further than dropping fields** —
`get_result()` (lines 733–745) does:

```rust
let cstr = sys::SherpaOnnxGetOfflineStreamResultAsJson(self.ptr);
...
serde_json::from_str(&s).ok()          // deserializes into the 4-field struct
```

It fetches upstream's *full* result JSON and then parses it into a struct that declares
four fields. `serde`'s default is to **ignore unknown fields** — so whatever else the JSON
carries is silently discarded at this line, not upstream. Two further wrapper facts that
matter for any workaround:

- The JSON string is destroyed before the caller sees it (`SherpaOnnxDestroyOfflineStreamResultJson`).
- `OfflineStream`'s raw pointer is `pub(crate)` (line 712), and `OfflineRecognizer`'s too —
  **there is no safe escape hatch to hand an existing wrapper stream to the C API.**

### 2.2 The sys crate (FFI) surface — narrower than upstream

`sherpa-onnx-sys-1.13.7/src/offline_asr.rs` declares the offline-ASR extern block
(lines 226–281) ending at:

```rust
pub fn SherpaOnnxGetOfflineStreamResultAsJson(stream: *const OfflineStream) -> *const c_char;
pub fn SherpaOnnxDestroyOfflineStreamResultJson(s: *const c_char);
```

Grep over the whole sys crate: **zero** matches for `ys_log_probs`,
`SherpaOnnxGetOfflineStreamResult` (the struct getter), or `OfflineRecognizerResult`.
So the sys crate does *not* even declare the struct-returning getter that upstream C
provides — only the JSON getter, which happens to be enough (next section).

### 2.3 Upstream v1.13.7: `ys_log_probs` is there — in the struct, the JSON, and every decoder Floure uses

**C API** (`sherpa-onnx/c-api/c-api.h` at tag v1.13.7, lines 1470–1554):

```c
typedef struct SherpaOnnxOfflineRecognizerResult {
  const char *text;
  float *timestamps;
  int32_t count;
  const char *tokens;
  const char *const *tokens_arr;
  const char *json;
  const char *lang;
  const char *emotion;
  const char *event;
  float *durations;
  /** Optional token log probabilities, parallel to @c tokens_arr. */
  float *ys_log_probs;
  ...
} SherpaOnnxOfflineRecognizerResult;

SHERPA_ONNX_API const SherpaOnnxOfflineRecognizerResult *
SherpaOnnxGetOfflineStreamResult(const SherpaOnnxOfflineStream *stream);
```

**JSON** (`sherpa-onnx/csrc/offline-stream.cc` at v1.13.7,
`OfflineRecognitionResult::AsJsonString()`, line 433): emits keys `lang`, `emotion`,
`event`, `text`, `timestamps` (2 decimals = 10 ms grid), `durations` (2 decimals),
`tokens`, **`ys_log_probs` (6 decimals)**, `words` — plus `segment_*` in Whisper
timestamp-token mode. **The exact JSON string the Rust `get_result()` already calls and
then throws away contains `ys_log_probs`.**

**Decoders populate it on Floure's exact paths** (grep of tag v1.13.7):

| Decoder file | Floure path | Line |
|---|---|---|
| `offline-transducer-greedy-search-nemo-decoder.cc` | Parakeet `model_type=nemo_transducer`, **greedy_search (default)** — both `DecodeOne` (RNN-T) and `DecodeOneTDT` (TDT) | 87, ~169 |
| `offline-transducer-modified-beam-search-nemo-decoder.cc` | Parakeet `modified_beam_search` (bias path) | 406 |
| `offline-transducer-greedy-search-decoder.cc` / `offline-transducer-modified-beam-search-decoder.cc` | generic transducers | 71 / 193 |

What the number *is* (fetched source, `DecodeOneTDT` lines 156–169): take the joiner/token
logits of the emitted symbol, `LogSoftmax` over the vocabulary, store the selected token's
log-probability — always ≤ 0; `exp()` gives the token probability. Upstream's own usage note
(PR #2843): *"Values are log probabilities (always ≤ 0) … Closer to 0 = higher confidence."*
`CHANGELOG.md` at the pin records both features:
*"Add token-level confidence scores (ys_probs) for offline transducer models (#2843)"* and
*"feat: Add ys_log_probs to NeMo transducer greedy search decoder (#3105)"*.

**Whisper path does NOT populate it** — grep of every `*whisper*` source file in tag
v1.13.7 returns no `ys_log_probs`; the C API sets the pointer to `nullptr` when absent and
the JSON will carry `[]`. The confidence signal exists for **Parakeet only**; the Whisper
arm falls back to text proxies (§2.7).

### 2.4 Upstream history — the Rust gap is known, and one caveat bites Floure's bias path

All pages fetched:

- **PR #2843** (merged 2025-12-02): added `ys_log_probs` end-to-end — C API field, JSON,
  Python property, standard greedy + modified-beam decoders. Motivation verbatim:
  *"Users often need confidence scores for each recognized token to: Filter out
  low-confidence transcriptions … Detect uncertain or potentially incorrect words."*
- **PR #3105** (merged 2026-02-05): extended it to the **NeMo** transducer decoders — i.e.
  Parakeet TDT — *"Tested with Parakeet TDT 0.6B model — `ys_log_probs` now matches token
  count. Before: tokens=5, ys_log_probs=0 / After: tokens=5, ys_log_probs=5,
  sample=[-0.030, -0.001, -0.007, -0.012, -0.497]."* Both PRs are **in tag v1.13.7**.
- **PR #3764 "rust: expose ys_log_probs in OfflineRecognizerResult"** — **OPEN**
  (opened 2026-07-15, `size:XS`). This is the wrapper gap itself: upstream knows, nobody
  has merged the one-field fix. Until it lands, the field is invisible through the safe
  wrapper. Sibling bindings already expose it (Go PR #3553 merged; Kotlin PR #3638 open).
- **Issue #2937 "Token log probabilities with hotwords" (OPEN) — caveat for Floure's
  biased path:** hotword boosting *injects score*, so `ys_log_probs` are no longer
  acoustic confidences under biasing: *"when I use hotwords … token probabilities
  `ys_log_probs` decrease with boosting score increasing … `hello` at score 1.0 → 87.12%,
  at score 2.0 → 44.91%"* (same clearly-spoken word). **Confidence must be taken from an
  unbiased decode** (Floure's greedy default, or plain `modified_beam_search` without
  hotwords) — never from the hotword-biased beam output.

### 2.5 N-best: not available at this pin (verifiable, and explicitly requested upstream)

- Grep over the whole v1.13.7 tree: **zero matches** for `nbest`/`N-best` — no N-best
  extraction exists for any model family at this tag.
- **Issue #465 (open):** *"in sherpa onnx, there are only two valid decode methods
  (greedy_search and modified_beam_search)"* — icefall's `fast_beam_search_nbest` is absent.
- **Issue #3858 (open, 2026-08):** *"modified_beam_search keeps multiple hypotheses
  internally according to max_active_paths, but only the single best hypothesis is returned
  to the user"* — and its motivation is literally Floure's use case: *"downstream ASR
  post-processing … ASR error correction … the correct named entity may already exist as
  the 2nd or 3rd hypothesis."* Implementation PRs **#3859** and **#3953** are both **open**,
  Python-only so far; #3953 notes *"`AsJsonString()` does not include `hypotheses` yet."*

**Conclusion:** Pu et al.'s N-best-disagreement gate (#71) is **not implementable** at
sherpa-onnx 1.13.7 — it needs a future release (or a non-sherpa decode path). What *is*
implementable today is the S1-family signal: per-token `ys_log_probs`.

### 2.6 Options without forking, and the recommended signal

The native library at the pin already computes and serializes the signal. Three options,
in preference order:

1. **Zero-fork, zero native rebuild — call the JSON getter through `sherpa-onnx-sys`.**
   Add `sherpa-onnx-sys = "=1.13.7"` (the exact same package already in the dependency
   graph as the wrapper's dependency; `links = "sherpa-onnx"` means one copy of the native
   lib, already downloaded by the existing build) and drive the offline path on sys handles
   directly — create recognizer → create stream → `SherpaOnnxAcceptWaveformOffline` →
   `SherpaOnnxDecodeOfflineStream` → `SherpaOnnxGetOfflineStreamResultAsJson` →
   `serde_json::Value["ys_log_probs"]`. Because the wrapper's stream pointers are
   `pub(crate)` (§2.1), the *whole* decode (not just the result call) goes through sys —
   the config plumbing is ~15 fields, mirroring `parakeet.rs::build` /
   `whisper.rs::build_recognizer`. No C/C++ is written or compiled; `build.rs` reuses the
   cached prebuilt archive under `target/.../sherpa-onnx-prebuilt/`.
2. **Land/watch upstream PR #3764** (adds `ys_log_probs: Option<Vec<f32>>` to the serde
   struct — the JSON already carries it, so the fix really is one field). Re-pin when it
   merges; nothing else changes.
3. **Proxies only** (§2.7) — the fallback for the Whisper arm, which has no signal at all.

**Recommended confidence signal for the gate** (all components verified above):

- **Primary (Parakeet): per-word confidence = last-token `exp(ys_log_probs)`** from the
  *unbiased greedy* decode; word aggregation per #108 (last-token, empirically best) with
  min/sum as alternates (#76). Utterance score = mean word confidence; threshold swept on
  dev (§1.2), operating point chosen by gate precision/recall (§1.3).
- **Guardrails:** never take confidence from the hotword-biased decode (#2937); treat
  values as *ranking* scores until calibrated (#104/#105/#106 overconfidence evidence);
  JSON timestamps/durations arrive on a 10 ms grid (`setprecision(2)`), which is fine for
  the existing 1.5 s gap / 1.0 s duration checks.
- **Whisper arm: no signal exists** at this pin → text/alignment proxies below + VAD.

### 2.7 Proxy candidates given only `text`/`tokens`/`timestamps`/`durations` — verdicts

| Proxy | Evidence (fetched) | Verdict |
|---|---|---|
| Greedy vs. `modified_beam_search` (unbiased) **disagreement** | Floure can construct both today (`parakeet.rs::new` / `new_with_decoding`; `bench.rs` already builds and asserts the beam path). Literature: disagreement among hypotheses is *the* canonical uncertainty cue — Hystoc (**#109**) converts N-best into confidences citing Wessel 1996; Pu (#71) gates on N-best disagreement; SR-CEM (#79) shows beam scores themselves calibrate. Two decodes = degenerate 2-hypothesis N-best | **Supported (weak form).** A 2-way disagreement is the smallest instance of the verified N-best family. Usable as a secondary/cheap trigger; its precision must be measured in the own-eval, not assumed |
| Biased vs. unbiased decode disagreement | No fetched source uses response-to-biasing as confidence; #2937 shows biasing corrupts the scores themselves | **Folklore for confidence.** At most a "hotword won/lost" UI factoid, not a gate signal |
| OOV/rare-token rate vs. derived `bpe.vocab` | Structural problem: `derive_bpe_vocab` builds the vocab **from `tokens.txt`** (`parakeet.rs::build`), and every token the model can emit comes from `tokens.txt` — an emitted token is in-vocab **by construction**, so the OOV rate is identically 0. A *rarity* rate would need an external frequency resource Floure doesn't have. #77 shows rare-word utterances are where routing helps, but its gate is learned CEM confidence, not vocab rarity | **Folklore (as a confidence signal).** Cannot fire by construction; rarity-based variants lack a source and a data structure |
| Timestamp/duration anomalies (gap > 1.5 s, token > 1.0 s) | First-party precedent for *duration* extremes — openai-whisper's own `word_anomaly_score` (`whisper/transcribe.py`, fetched): penalty if `duration < 0.133` or `duration > 2.0`, plus `probability < 0.15` — used to detect *hallucination/anomaly segments*, not correction worthiness. Companion F6/F7: under VAD, long gaps are often real pauses → false fires | **Supported only as a silent-input/hallucination *symptom*** (Whisper first-party), **not** as "send to LLM". Per companion §5.2: re-decode or drop; never LLM-repair |
| Tokens-per-second / speech rate | Tapias et al. (**#119**) found *"SPL is not related to speech rate changes"*; pause/duration knobs are severity markers in dysarthric *synthesis* (**#124**); Ward & Ortega (#92): no working reduction detector exists | **Folklore as ASR-error confidence.** Slow tempo may indicate reduced effort, but no fetched source validates rate as an error signal — and #92 says reduction itself can't be cheaply detected |
| Fillers / repeated bigrams | Companion §1/§5.2 (Shriberg, Bortfeld, whisper normalizer) | **Refuted as error evidence** — established content, not repeated here |
| Vocabulary-coverage measures beyond OOV | — | Same structural verdict as the OOV row: coverage of the model's own vocab carries no error information |

**Net:** the proxy table confirms the companion's §5.2 instinct but replaces its
"beam scores are the signal" guess with a verified fact: **the real signal (per-token
logprobs) exists in the pinned native library and is one JSON parse away** (§2.6), so the
proxy set is only needed for the Whisper arm and as a belt-and-braces secondary trigger.

---

## 3. The Two Pre-ASR Settings (first-party confirmation)

### 3.1 `condition_on_previous_text` — what the first parties actually say

**OpenAI whisper.** The README (fetched) documents the sliding-window design
(*"processes the audio with a sliding 30-second window, performing autoregressive
sequence-to-sequence predictions on each window"*) but does **not** document this flag.
The flag is documented in the official `whisper/transcribe.py` (fetched) — docstring and
CLI help, verbatim:

> `condition_on_previous_text: bool`
> if True, the previous output of the model is provided as a prompt for the next window;
> disabling may make the text inconsistent across windows, but the model becomes less
> prone to getting stuck in a failure loop, such as repetition looping or timestamps
> going out of sync.

CLI help (same file): *"…disabling may make the text inconsistent across windows, but the
model becomes less prone to getting stuck in a failure loop."* Mechanism (same file,
fetched): when disabled (or when a fallback decode used `temperature > 0.5`),
`prompt_reset_since = len(all_tokens)` — the accumulated previous tokens are simply not
fed as the next window's prompt. **Trade-off, stated by OpenAI themselves: cross-window
text consistency ⇄ repetition-loop robustness.** The maintainer-side reinforcement
(previous-window prompting *"makes the decoding more prone to repetition looping"*) is
whisper discussion #29 — already established as citation #101 / companion §5.5; not
re-derived here.

**HuggingFace `transformers`.** The Whisper API docs (fetched) expose the equivalent
under a different name on `WhisperForConditionalGeneration.generate`:

> `condition_on_prev_tokens` (`bool`, *optional*): Only relevant for long-form
> transcription. Whether to condition each segment on the previous segment. As shown in
> the Whisper paper, this can help to improve performance.

Also present: `prompt_condition_type` (`'first-segment'` | `'all-segments'`, controls
whether `prompt_ids` applies to the first segment only or all segments) and `prompt_ids`.
Note the **divergence between the two first parties**: transformers' doc cites the paper
and states only the benefit; openai-whisper's docstring states the failure-loop cost.
Both were fetched; both are quoted, neither is interpreted beyond the text.

**Floure's local sherpa-onnx Whisper path: no equivalent knob exists — and none is
needed.** Verified at the pin:

- `OfflineWhisperModelConfig` (safe crate `offline_asr.rs` lines 95–103; sys crate lines
  29–37) has exactly: `encoder`, `decoder`, `language`, `task`, `tail_paddings`,
  `enable_token_timestamps`, `enable_segment_timestamps`. **No conditioning field.**
- Grep of tag v1.13.7: **zero** matches for `condition_on_prev*` anywhere in sherpa-onnx.
- Structural reason (fetched source `offline-recognizer-whisper-impl.h` `DecodeStream`,
  lines 84–139): offline Whisper runs **one** encoder pass + **one** decode over the whole
  stream — there is no sliding-window loop and therefore no cross-window prompt to
  condition or disable. Each Floure call (`whisper.rs::transcribe`, fetched local source)
  creates a fresh `OfflineStream`, so nothing carries between VAD segments either.
- Two facts worth keeping: (a) input is clamped — *"Only waves less than 30 seconds are
  supported. We process only the first 30 seconds and discard the remaining data"*
  (lines 96–101); a >30 s VAD segment would be **silently truncated** (VAD normally keeps
  segments well under this, but it is a real ceiling). (b) `tail_paddings` (default 1000
  frames) exists so the decoder can emit EOT — the only decoding-shape knob exposed.

**Verdict:** the companion's recommendation *"set `condition_on_previous_text=False`"*
(#29-based) is correct **and already effectively satisfied** on the local path: the knob
exists only in openai-whisper / `transformers`; sherpa-onnx has no such state to turn off.
It becomes actionable only if Floure ever moves Whisper decoding to windowed-streaming
implementations (openai-whisper `transcribe()`, faster-whisper, HF pipeline long-form) —
there, set it False / `condition_on_prev_tokens=False` per the docstrings above.

### 3.2 A "too quiet" warning — measurement is standard, the cutoff is not

**The measurement framework is first-party standard (fetched):**

- **EBU R 128 (v5, Nov 2023, fetched PDF):** Programme Loudness *"shall be normalised to a
  Target Level of **−23.0 LUFS**"* (±1.0 LU tolerance where the target isn't practically
  attainable, ±0.2 LU QC tolerance); measurement *"shall be made with a loudness meter
  compliant with **ITU-R BS.1770** (including the level-gating method described in
  equation (7)) and **EBU Tech 3341**"*; True Peak ≤ **−1 dBTP**; LUFS ≡ BS.1770's LKFS.
  It also explicitly measures *"in its entirety, without emphasis on specific foreground
  elements such as speech"* — i.e. **R128 is a programme standard and says nothing about
  a dictation cutoff.**
- **EBU Tech 3341 (fetched PDF):** defines the metering windows — Momentary Loudness =
  *"sliding rectangular time window of length 0.4 s"*, Short-term = *"length 3 s"*, plus
  Integrated (gated). This is the ready-made recipe for a per-segment level meter:
  K-weight per BS.1770, gate per Eq. (7), read the short-term value over the VAD segment.
- **ITU-R BS.1770** itself: the ITU PDF fetch was blocked in this session (returned an HTML
  error page) — its role (K-weighting + Eq. 7 gating, LU/LKFS definition) is verified
  **via R128's own normative references (fetched)** rather than from BS.1770 directly.
  **[direct fetch failed — cited through R128]**

**Why quiet input matters for ASR (fetched primary, beyond the already-cited Whisper §3.7 /
#17):**

- Tapias, García & Cazassus, ICASSP 1999 (**#119**, PDF fetched): speech production level
  is a *U-shaped* degradation factor — word accuracy degrades *"if it is lower or higher
  than normal"* — and *"the word error rate (WER) increases **up to 2 times** for slow SPL
  with respect to the WER at the normal SPL."* Level and SNR are coupled in any fixed-noise
  room: measured mean SNR **38 dB (high SPL) / 31 dB (normal) / 20 dB (low) / 14 dB
  (whispery)** — quiet speech buys no SNR headroom. (Whisper §3.7's noise/SNR curve —
  citation #17, companion §2.2 — says the same from the model side; not re-derived.)

**What is NOT first-party (stated honestly):** **no ITU/EBU/3GPP recommendation defines a
"too quiet for dictation" threshold.** R128/BS.1770 standardise *how to measure loudness*,
not a minimum for speech input to an ASR. Any specific cutoff is therefore engineering
judgment — labelled as such:

> **Practical threshold (our judgment, standard-anchored):** per VAD segment, compute the
> BS.1770/Tech 3341 K-weighted short-term loudness (or, cheaper, plain speech-segment RMS
> in dBFS). Warn when the segment sits **≈ 10 LU below the R128 target (≈ −33…−35 LUFS)**
> or, for raw RMS, below roughly **−35…−40 dBFS speech RMS** — below that a normally-mic'd
> speaker has left the range where Tapias et al.'s U-curve is flat, and the effective SNR
> of the whole pipeline is collapsing (their low-SPL mean SNR: 20 dB). Calibrate the exact
> number on the machine's own hardware: record one normal and one deliberately quiet
> dictation, confirm the two land on opposite sides of the cutoff, adjust. Keep it a
> *warning*, not a gate — VAD (Silero, ahead of every engine) remains the anti-hallucination
> mechanism per the companion's first-party evidence (#101/#102/#103).

Absolute dBFS figures depend on mic gain/AGC, which is exactly why the *relative* form
("this session is ≫ quieter than your recent sessions") is the more robust warning once a
few utterances exist. That adaptive variant is our construction — **[no primary source —
labeled]**.

---

## 4. Own-Eval Design Extending `bench.rs`

Constraint honored: the eval **extends** the existing harness. Nothing below replaces
`normalize()`, `edit_distance()`, `manifest.jsonl`, `baseline.json`, or the existing
beam+hotwords assertion.

### 4.1 Inventory (local source, verified)

| Existing piece (`application/src-tauri/src/bench.rs`) | Role in the extension |
|---|---|
| `bench_dir()` — reads `$BENCH_AUDIO/manifest.jsonl` | reused as-is; a second manifest (mumbled tier) reuses the same format (`id`, `wav`, `text`) |
| `normalize()` — lowercase, strip non-alphanumerics (keeps `'`), split | kept for arm-vs-arm continuity with `baseline.json`; **augmented**, not replaced (§4.4) |
| `edit_distance()` — Levenshtein over `Vec<String>` | reused; it *is* the (S+D+I) word count the WER definition calls for (#111 states the same formula) |
| per-utterance rows with `"errors"` for parakeet/whisper | becomes the gate's ground truth: `errors_raw > 0` labels gate precision/recall for free |
| `#[ignore]` tests `bench_baseline`, `bench_hotwords_app_path` | pattern for the new test; run line mirrors the header comment |
| `derive_bpe_vocab` + beam/hotwords assertion | the decode configurations the disagreement proxy needs already exist and are spike-verified |

### 4.2 The test to add: `bench_gate_eval`

Name: **`bench_gate_eval`** (`#[test] #[ignore]`, same file, same `BENCH_AUDIO`
mechanism). It never needs the LLM to evaluate the *gate*; the cleanup arm is optional:

1. Load manifest; per utterance run **arm A** = `ParakeetRecognizer::new` (greedy,
   `transcribe_full` → text/tokens/timestamps/durations) — the raw pipeline.
2. Compute the gate twice: `crate::llm::needs_cleanup(...)` (current heuristic gate) and
   the confidence gate of §2.6 once reachable (feature-flag/env-selectable, e.g.
   `BENCH_GATE=heuristic|confidence`). Both are plain functions — no model needed.
3. **Arm B** = gated pipeline output. Two levels:
   - always: `strip_fillers` (deterministic part — companion §5.1);
   - if `BENCH_LLM=local|cloud` is set: run the real cleanup pass on *fired* utterances
     only and use its output; otherwise skip LLM rows and still report all gate metrics.
4. Optional proxy row: decode arm A2 = `new_with_decoding(..., "modified_beam_search",
   ...)` **without hotwords** and record greedy↔beam disagreement (§2.7) as a second gate
   candidate. (Confidence values come in when §2.6 option 1/2 is implemented; the JSON
   parse is orthogonal to this test.)
5. Emit `benchmark-audio/gate-eval.json` next to `baseline.json` with per-utterance rows
   (`id`, `fired`, `disagree`, `ref_words`, `errors_raw`, `errors_clean`) plus aggregates.

### 4.3 The metrics to report (this is the contract)

For **each** gate variant, one JSON block:

| Metric | Definition | Why (source) |
|---|---|---|
| `coverage` | fraction of utterances fired | Idiap-style pass rates (#75, companion §3.1) |
| `gate_precision`, `gate_recall` | vs label `errors_raw > 0` | §1.3: measure the gate *as an error detector* — the thing the heuristic gate currently never measures |
| `wer_raw`, `wer_gated` | aggregate both arms | continuity with `baseline.json` |
| **`wer_raw_fired`, `wer_gated_fired`, `wer_raw_skipped`, `wer_gated_skipped`** | WER split by gate decision, both arms | §1.3: corrected-vs-skipped reported **separately** — aggregate-only hides harm |
| `deltas`, `sigma_z`, `p_mapsswe`, `p_sign` | paired tests (§4.7) | a delta without a paired p-value is not a result (Gillick & Cox #113: claims are *"seldom backed by evidence"*) |
| `wer_filler_stripped_ref` variant | scoring with official filler stripping (§4.4) | so filler removal is scored the way official WER scores it |

**Primary metric to report:** *paired per-utterance error-difference test* (MAPSSWE-style,
§4.7) on `errors_gated − errors_raw`, plus its effect size ΔWER.
**Secondary:** gate precision/recall/coverage at the chosen threshold. Aggregate WER is
reported but never quoted alone.

### 4.4 Normalization: two scorings, official parity for fillers

- Scoring (a): existing `normalize()` — unchanged, keeps comparability with
  `baseline.json`.
- Scoring (b): **official-parity pass first** — strip the bracketed material and the
  filler ignore-set (`hmm|mm|mhm|mmm|uh|um`) exactly as OpenAI's `EnglishTextNormalizer`
  does (verified source: citation **#100**, companion §3.5 — not re-derived here), *then*
  `normalize()`. Why this matters mechanically: `normalize()` today counts fillers as
  ordinary words, so a cleanup that only deletes `um` would look like a WER *improvement*
  under scoring (a) that official WER would never award, and (worse) would mask real
  regressions behind filler gains. Under scoring (b), filler removal is WER-neutral by
  construction and any measured delta is about *content*.
- Tooling conventions (fetched): **jiwer** (Apache-2.0, jitsi/jiwer, README fetched) —
  WER/MER/WIL/WIP/CER via minimum edit distance (RapidFuzz), and since 4.0 a defined
  empty-reference behavior explicitly *"for testing whether models hallucinate on silent
  audio"* (`wer('', 'x')` = insertions — a ready-made silent-audio hallucination probe for
  Floure's own VAD/ASR stack). **sclite/sc_stats** (NIST SCTK, `doc/sc_stats.1` fetched):
  the reference implementation of the paired tests —
  `-t [ mcn | mapsswe | sign | wilc | anovar | std4 ]` reading `sclite -o sgml` output.
  Recommendation: keep the in-repo Rust scorer for the loop, and treat jiwer/sc_stats as
  *cross-check* tooling on exported hypotheses (they are conventions, not dependencies —
  **the harness is not rewritten around them**).

### 4.5 Building the mumbled subset

**Tier 2 — real mumbled dictations (primary).** No public corpus exists (companion §2.3 —
finding of that doc's search, not re-derived), so record our own, following the design the
companion already prescribed (~50 utterances, §5.6):

- Fixed mic/position/gain; per prompt, two takes: *enunciated* and *deliberately mumbled
  think-aloud*; references typed exactly as intended; store as
  `benchmark-audio/mumbled/manifest.jsonl` with the **same schema** (`id`, `wav`, `text`)
  so `bench_gate_eval` iterates tier-1 and tier-2 with zero format work.
- The paired design (same prompt, both conditions) doubles as its own control: ASR/cleanup
  effects are compared *within* prompt, which is what the paired tests of §4.7 want
  (Gillick & Cox #113: paired testing *"reflect[s] differences between the algorithms
  rather than any accidental differences in the difficulty of the test items"*).

**Synthesized/derived stress variants (secondary, labeled honestly).** When real mumbled
recordings are scarce, published work degrades speech by construction — verified
precedents, each scoped for what it actually simulates:

| Method | Verified precedent | What it does / doesn't simulate |
|---|---|---|
| Additive noise at stepped SNR | Whisper §3.7 (citation #17, companion §2.2 — not re-derived); #119 shows natural SPL↔SNR coupling | simulates *low SNR*, not reduced articulation |
| Level scaling to low/high SPL | **#119** (TRESVOL: low/normal/high SPL + whispery subsets, WER up to 2×) | simulates *quiet input* — exactly the level-warning validation set for §3.2 |
| Spectral transformation to pseudo-articulation variants | Lin et al. (**#96**, abs re-fetched): *"a signal processing-based technique that transforms the spectral characteristics of normal speech to those of pseudo-whispered speech"* — 18.2% rel WER gain on wTIMIT | simulates *whisper-like spectral tilt*; precedent for degradation-by-transform, not a mumble model |
| Severity-parameterised re-synthesis (pause insertion, energy, duration, pitch knobs) | Soleymanpour et al. (**#124**, PDF fetched): multi-talker TTS with *"a dysarthria severity level coefficient and a pause insertion model"*; subjective ratings track target severity | closest verified template for **controllable reduced-articulation synthesis**; used there for training augmentation, we propose it for *eval* variants |

Label rule: variants from rows 1–3 are **degraded conditions**, never "mumbled speech" —
Ward & Ortega (#92) showed even human judgment of reduction barely correlates (r ≤ 0.24),
so we do not claim a synthesis is the Floure input distribution; the real tier-2
recordings carry that claim.

### 4.6 Minimum sample size for single-digit relative WER deltas

Assumptions stated (replace with manifest-exact numbers at runtime — `baseline.json`
already computes `words` and per-utterance `errors`):

- Tier-1: n = 100 utterances, 13.6 min audio → ≈ 8.2 s/utt → at LibriSpeech read-speech
  rates ≈ **18–20 words/utt → ≈ 1,800–2,000 reference words**.
- Baseline WER ≈ 5–7% (Parakeet-class on dev-clean) → ≈ **100–140 raw word errors**.
- A "single-digit relative" change (e.g. 5% rel) ≈ **5–7 net error difference**.

**MAPSSWE power** (formula from Gillick & Cox #113, who define the test; our arithmetic):
with per-utterance error-difference Z, mean `μ̂_Z`, sd `σ̂_Z`, `W = μ̂_Z / (σ̂_Z/√n)` ~ N(0,1)
for n > 50 (their quoted validity bound — tier-1's n=100 clears it). Detectable mean
difference at α=0.05 two-sided, 80% power: `δ_min = (1.96 + 0.84)·σ_Z/√n = 2.8·σ_Z/10`.
`σ_Z` is measurable from the harness itself (it's the sd of per-utterance
`errors_gated − errors_raw`):

| σ_Z (driven by how many utts the gate actually changes) | δ_min at n=100 | net errors (×100 utts) | ≈ relative WER at 6% baseline | verdict |
|---|---|---|---|---|
| 0.25 (≈ few utts change) | 0.07/utt | 7 | ~6% rel | marginal |
| 0.5 (≈ more utts change both ways) | 0.14/utt | 14 | ~12% rel | large effects only |

Inverse — utterances needed to detect 5% rel (δ = 0.055/utt at ~1,900 words):
`n = (2.8·σ_Z/δ)²` → **≈ 165 (σ_Z=0.25) to ≈ 650 (σ_Z=0.5)** utterances.
**Honest verdict: tier-1's 100 utterances can establish ~10%+ relative changes and can
measure gate precision/recall usefully, but is under-powered for the single-digit relative
deltas Floure expects** — either pool tiers (tier-2 + degraded variants), widen the set,
or report single-digit deltas as *directional* with the p-value shown, never as settled.

**Exact sign test** (distribution-free fallback, works on tiny counts): two-sided exact
binomial on utterances where the arms *differ*, H0: each arm wins equally. Our arithmetic:
significant at α=0.05 only when the differing utterances are near-unanimous — 6/6
(p=0.031), 8/9 (p=0.039), 9/10 (p=0.021), 10/12 (p=0.039), 11/13 (p=0.022) — while 7/8
(p=0.070) or any real two-way split fails. **So if cleanup fixes some utterances and breaks
others (the expected regime), n=100 sign tests will read "inconclusive" almost surely —
which is information, not failure**; report it as such. NIST's own experience (Pallett et
al., **#114**, fetched): on their 12-speaker/310-utterance set *"the Wilcoxon signed rank
test (WI) is more sensitive than the (ordinary) sign test (SI)"* and *"the McNemar test
(MN) … is in general less sensitive than the matched-pair-sentence segment word error rate
test (MAPSSWE)"* — plus a CMU–BBN difference that only MAPSSWE detected among the four
tests. Corroborating: use MAPSSWE as primary, the sign test as the assumption-free check
with low expected power.

### 4.7 Significance-testing choice (primary sources)

- **Primary: MAPSSWE — the matched-pairs sentence-segment word-error test.** Primary
  source is Gillick & Cox, ICASSP 1989 (**#113**, PDF fetched): per-segment error counts
  `Z_i = N_1i − N_2i`, `W = μ̂_Z/(σ̂_Z/√n)`, normal for *"n … large enough (> 50, say)"*,
  two-tailed against H0: `μ_Z = 0`; sentences/phrases are the natural segmentation. The
  per-utterance structure of `manifest.jsonl` *is* the segmenting (one segment = one
  utterance; errors inside are dependent, across utterances independent — the exact
  justification Gillick & Cox give for preferring this over McNemar on connected speech:
  *"errors are therefore highly inter-dependent and it would be wrong to attempt to
  compare performance on segments of a phrase which were in error"*).
  Also quote their open issue in our reporting: *"it would be of considerable interest to
  give a confidence interval for the difference in the two error-rates … if the magnitude
  … is very small, the improvement we have discerned may be immaterial"* → report ΔWER
  with the p-value, not the p-value alone.
- **Secondary/assumption-free: exact two-sided sign test** (binomial on discordant
  utterances) — implementable in ~10 lines in the test; same counting family NIST ships as
  `sc_stats -t sign` (`doc/sc_stats.1` fetched; NIST's comparison suite is
  `mcn|mapsswe|sign|wilc`, **#114**: four tests *"examining, for each pair of systems,
  whether the observed results are inconsistent with a null hypothesis that the systems are
  statistically identical"*).
- **Not McNemar as primary**: by Gillick & Cox's own scope it needs independent errors —
  sentence-level use only (*"wise to supplement the test with data on the relative frequency
  of insertion, deletion and substitution errors"*). We follow that supplement anyway by
  logging S/D/I splits per arm (trivial with `edit_distance` on aligned arrays — optional
  stretch row in `gate-eval.json`).
- jiwer/sc_stats cross-check: if an external tool is wanted, `sc_stats -p -t mapsswe -v -u`
  over `sclite -o sgml` outputs is the canonical invocation (NIST man page, fetched).

### 4.8 What the run looks like (concrete)

```
BENCH_AUDIO=/home/akshat/practice/stt/benchmark-audio \
  cargo test -p stt-ui --lib bench -- --ignored --nocapture      # existing, unchanged
BENCH_AUDIO=.../benchmark-audio BENCH_GATE=heuristic \
  cargo test -p stt-ui --lib bench_gate_eval -- --ignored --nocapture   # new
BENCH_AUDIO=.../benchmark-audio/mumbled  ...                     # same test, tier-2 manifest
```

(memory cap applies to any test run on this machine — none was run for this document; the
harness was inspected as source only.)

---

## 5. References (every source fetched for this document)

1. Laptev, A., Ginsburg, B. "Fast Entropy-Based Methods of Word-Level Confidence Estimation for End-To-End ASR." SLT 2022 (Doha, Jan 2023). https://arxiv.org/abs/2212.08703 · **DOI:** 10.1109/SLT54892.2023.10022960 (abs page fetched) — also citations #104
2. Li, Q., Qiu, D., Zhang, Y., Li, B., He, Y., Woodland, P. C., Cao, L., Strohman, T. "Confidence Estimation for Attention-based Sequence-to-sequence Models for Speech Recognition." ICASSP 2021. https://arxiv.org/abs/2010.11428 (abs fetched) — also citations #105
3. Wang, M., Soltau, H., El Shafey, L., Shafran, I. "Word-level confidence estimation for RNN transducers." ASRU 2021. https://arxiv.org/abs/2110.15222 · **DOI:** 10.1109/ASRU51503.2021.9688247 (abs fetched) — also citations #106
4. Naowarat, B., Kongthaworn, T., Chuangsuwanich, E. "Word-level Confidence Estimation for CTC Models." Interspeech 2023. https://www.isca-archive.org/interspeech_2023/naowarat23b_interspeech.pdf (PDF fetched) — also citations #107
5. Aggarwal, V., Nair, S. S., Verma, Y., Jogi, Y. "Adopting Whisper for Confidence Estimation." ICASSP 2025. https://arxiv.org/abs/2502.13446 (abs fetched) — also citations #108
6. Beneš, K., Kocour, M., Burget, L. "HYSTOC: Obtaining Word Confidences for Fusion of End-To-End ASR Systems." ICASSP 2024. https://www.fit.vut.cz/research/group/speech/public/publi/2024/benes_icassp2024_hystoc-End_ASR_Systems.pdf · **DOI:** 10.1109/ICASSP48485.2024.10446739 (PDF fetched) — also citations #109
7. Chow, C. K. "On optimum recognition error and reject tradeoff." IEEE Trans. Inf. Theory, 1970. **DOI:** 10.1109/TIT.1970.1054406 (DOI page + IBM Research abstract fetched); rule restatement fetched: https://www.sciencedirect.com/science/article/abs/pii/S0031320300000595 — also citations #110
8. Ernez, F., Arnold, A., Galametz, A., Kobus, C., Ould-Amer, N. "Applying the conformal prediction paradigm for the uncertainty quantification of an end-to-end automatic speech recognition model (wav2vec 2.0)." PMLR v204 (COPA 2023). https://proceedings.mlr.press/v204/ernez23a/ernez23a.pdf (PDF fetched) — also citations #111
9. Damri, A., Laufer-Goldshtein, B. "Confident and Adaptive Generative Speech Recognition via Risk Control." ICLR 2026. https://proceedings.iclr.cc/paper_files/paper/2026/file/96c7270f52625148c6dee3e3910a844d-Paper-Conference.pdf (PDF fetched) — also citations #112
10. Gillick, L., Cox, S. J. "Some statistical issues in the comparison of speech recognition algorithms." ICASSP 1989. https://labrosa.ee.columbia.edu/~dpwe/papers/GilC89-signif.pdf (fetched via https://web.archive.org/web/2020id_/https://labrosa.ee.columbia.edu/~dpwe/papers/GilC89-signif.pdf, text extracted and read) — also citations #113
11. Pallett, D. S., Fiscus, J. G., Fisher, W. M., Garofolo, J. S. (NIST). "Benchmark tests for the DARPA Spoken Language Program." 1993. https://aclanthology.org/H93-1003.pdf · **DOI:** 10.3115/1075671.1075675 (PDF fetched, read) — also citations #114
12. NIST SCTK — `sc_stats` man page (statistical system comparison: mcn/mapsswe/sign/wilc/anovar/std4). https://raw.githubusercontent.com/usnistgov/SCTK/master/doc/sc_stats.1 (fetched) — also citations #115
13. jiwer (Jitsi/8x8, Apache-2.0) — README (WER/MER/WIL/WIP/CER, RapidFuzz edit distance, empty-reference semantics for hallucination probing). https://raw.githubusercontent.com/jitsi/jiwer/master/README.md (fetched) — also citations #116
14. EBU R 128 (v5, Nov 2023) "Loudness normalisation and permitted maximum level of audio signals." https://tech.ebu.ch/docs/r/r128.pdf (PDF fetched, text read) — also citations #117
15. EBU Tech 3341 (2023) "Loudness Metering: 'EBU Mode' metering…" (momentary 0.4 s / short-term 3 s / integrated). https://tech.ebu.ch/docs/tech/tech3341.pdf (PDF fetched, text read) — also citations #118
16. Tapias, D., García, C., Cazassus, C. (Telefónica I+D). "On the characteristics and effects of loudness during utterance production in continuous speech recognition." ICASSP 1999. http://congres.cran.univ-lorraine.fr/1999/ICASSP_99/PDF/AUTHOR/IC992302.PDF · **DOI:** 10.1109/ICASSP.1999.758069 (PDF fetched, read) — also citations #119
17. sherpa-onnx **v1.13.7** source (exact pin of `sherpa-onnx`/`sherpa-onnx-sys` crates): https://github.com/k2-fsa/sherpa-onnx/archive/refs/tags/v1.13.7.tar.gz (fetched). Inspected: `sherpa-onnx/c-api/c-api.h` (`SherpaOnnxOfflineRecognizerResult.ys_log_probs`, `SherpaOnnxGetOfflineStreamResult`), `sherpa-onnx/csrc/offline-stream.cc` (`AsJsonString`, `ys_log_probs` at 6 decimals, timestamps/durations at 2), `offline-transducer-greedy-search-nemo-decoder.cc`, `offline-transducer-modified-beam-search-nemo-decoder.cc`, `offline-recognizer-whisper-impl.h` (30 s clamp, single pass), `CHANGELOG.md` (#2843, #3105) — also citations #120
18. sherpa-onnx upstream issues/PRs (all fetched): PR #2843 https://github.com/k2-fsa/sherpa-onnx/pull/2843 · PR #3105 https://github.com/k2-fsa/sherpa-onnx/pull/3105 · **open** PR #3764 (Rust `ys_log_probs`) https://github.com/k2-fsa/sherpa-onnx/pull/3764 · issue #2937 (hotwords bias logprobs) https://github.com/k2-fsa/sherpa-onnx/issues/2937 · issue #465 (only two decode methods) https://github.com/k2-fsa/sherpa-onnx/issues/465 · issue #3858 / PR #3859 / PR #3953 (N-best, open) https://github.com/k2-fsa/sherpa-onnx/issues/3858 — also citations #121
19. Crate sources inspected on disk (no compilation):
    `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sherpa-onnx-1.13.7/src/offline_asr.rs` (result struct L617–624, `get_result` L733–745, `OfflineWhisperModelConfig` L95–103, `pub(crate)` stream ptr L712) ·
    `…/sherpa-onnx-sys-1.13.7/src/offline_asr.rs` (extern block L226–281: JSON getter only), `…/Cargo.toml` (repository, `links = "sherpa-onnx"`), `…/build.rs` (`RELEASE_BASE_URL …/v{version}/`) ·
    upstream mirror of the safe wrapper: https://github.com/k2-fsa/sherpa-onnx (repository field of both crates, fetched from their Cargo.toml)
20. OpenAI whisper — README (fetched) + `whisper/transcribe.py` (`condition_on_previous_text` docstring, CLI help, prompt-reset logic, `word_anomaly_score`): https://raw.githubusercontent.com/openai/whisper/main/whisper/transcribe.py · https://raw.githubusercontent.com/openai/whisper/main/README.md — also citations #122
21. HuggingFace `transformers` Whisper API docs (`condition_on_prev_tokens`, `prompt_condition_type`, `prompt_ids`): https://huggingface.co/docs/transformers/main/en/model_doc/whisper (fetched) — also citations #123
22. Soleymanpour, M., Johnson, M. T., Soleymanpour, R., Berry, J. "Accurate synthesis of Dysarthric Speech for ASR data augmentation." 2023. https://arxiv.org/abs/2308.08438 (abs fetched) — also citations #124
23. Lin, Z., Patel, T., Scharenborg, O. "Improving Whispered Speech Recognition Performance using Pseudo-whispered based Data Augmentation." ASRU 2023 — abs re-fetched for the synthesis-method quote (already citations **#96**): https://arxiv.org/abs/2311.05179
24. Local app sources read (not modified): `application/src-tauri/src/llm.rs` (`needs_cleanup`, `strip_fillers`, prompts), `application/src-tauri/src/parakeet.rs` (`derive_bpe_vocab`, decode constructors), `application/src-tauri/src/whisper.rs` (fresh-stream-per-segment), `application/src-tauri/src/bench.rs` (harness inventory).

**Explicitly dropped after search:** *"MOER"* as a named confidence method (no primary
source found); *"mutual-information-based confidence signal"* (only NCE-the-metric
connection verified); transcript-text-only WER prediction (no source); ITU-R BS.1770
direct PDF (fetch blocked — cited through EBU R128's normative references); ITU-T P.79
(page not retrievable in this session — not relied on anywhere above).
