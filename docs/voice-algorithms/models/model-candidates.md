# Model Candidates: ASR, Cleanup LLM, VAD — Viable at Floure's Exact Pins

Scope: answers "what better models can we use, and how does that interact with the
gate/cleanup work already researched." Companion docs (established, **not re-derived
here**): `../cleanup/llm-cleanup-and-disfluency.md` (citations 89–103),
`../cleanup/selective-gate-and-eval.md` (citations 104–124; the confidence-gate
analysis, the `ys_log_probs` reachability result, the eval design), `../asr/asr-systems.md`,
`../vad/vad-algorithms.md`. New sources for this document are citations **125–150** in
`../papers/citations.md` (new section **Model Selection Papers & Model Cards**).

Every claim below was verified against a fetched primary source (upstream tag source
tarball, crate source on disk, first-party model card, first-party repo file, paper
abs/PDF, or the GitHub release API for the repo we pin). Claims we could not verify are
marked **[dropped — unverifiable]** or omitted. All sizes/`df`/`ls` values were measured
on this machine during this session. Nothing under `application/`, `paper/`, or
`benchmark-audio/` was modified; no models were downloaded; no code was compiled.

---

## 1. The Hard Constraints, Re-Verified

### 1.1 Runtime pin: sherpa-onnx 1.13.7 — and a premise correction

We re-downloaded the exact pin (`https://github.com/k2-fsa/sherpa-onnx/archive/refs/tags/v1.13.7.tar.gz`,
release published **2026-09-01**) and grepped it, plus both Rust crates on disk. The
companion's results (citations **#120/#121**) all hold: per-token `ys_log_probs` exists
only for transducer decoders; N-best is absent everywhere; the Rust safe wrapper's
`OfflineRecognizerResult` drops everything but text/tokens/timestamps/durations.

**Premise correction — the question assumed "Qwen/Canary-class architectures are
unsupported at the pin." They are not.** Verified at tag v1.13.7:

> `sherpa-onnx/csrc/offline-recognizer-impl.cc` dispatches on
> `config.model_config.canary.encoder` → `OfflineRecognizerCanaryImpl` and
> `config.model_config.qwen3_asr.conv_frontend` → `OfflineRecognizerQwen3ASRImpl`;
> `c-api/c-api.h` declares `SherpaOnnxOfflineCanaryModelConfig` (L884) and
> `SherpaOnnxOfflineQwen3ASRModelConfig` (L1019); and the **pinned safe Rust crate**
> exposes both (`sherpa-onnx-1.13.7/src/offline_asr.rs`: `OfflineCanaryModelConfig` L120,
> `OfflineQwen3ASRModelConfig` L324, wired into `OfflineModelConfig` L463/L469).

The CHANGELOG at the tag confirms the landing PRs (#3399/#3409/#3423 — Qwen3-ASR;
#3268 — Canary runtime). So the question is not "can the runtime load them" but "is
there exported weight, first-party English evidence, and a gate signal" — §2 answers per
model.

Full model-type dispatch at the pin (source-verified): `transducer`, `nemo_transducer`,
`paraformer`, `nemo_ctc`/`tdnn`/`zipformer2_ctc`/`wenet_ctc`/`telespeech_ctc`, `whisper`,
`moonshine` (v1 and v2 impls), plus config-keyed (no model_type needed) `canary`,
`qwen3_asr`, `sense_voice`, `cohere_transcribe`, `fire_red_asr`, `fire_red_asr_ctc`,
`dolphin`, `omnilingual`, `funasr_nano`, `medasr`, `zipformer`/`zipformer2`/`conformer`
(icefall transducers). Decoding methods: `greedy_search`, `modified_beam_search` only
(issue #465, companion §2.5).

`ys_log_probs` distribution at the pin (full-tree grep of `sherpa-onnx/csrc/`): matches
occur **only** in the transducer decoders (generic + NeMo/greedy + modified-beam),
`offline-stream.{h,cc}` (serialization), and the QNN transducer impls. Zero matches in
the CTC, Whisper, Moonshine, Canary, Qwen3-ASR, Paraformer, SenseVoice sources. This
single fact drives §6.

### 1.2 Local LLM path

`application/src-tauri/src/llm.rs` uses `llama_cpp_4` (crate `llama-cpp-4 = 0.6`,
`default-features = false`, static link — Cargo.toml L52). `models.rs::MODEL_MANIFEST`
declares each model as `id / url / size_bytes / backend / is_archive / filename`, and
`verify_model`'s backend arms are `vad | parakeet | whisper | llm` (an unknown backend
returns `false`). Cloud (OpenRouter) exists but is optional; the app works without an
account (local is `LlmProvider` default, `config.rs`).

### 1.3 CPU-only, Linux-only

CPU-only: `llm.rs` pins `n_gpu_layers(0)` unless `FLOURE_COMPUTE` says otherwise; the
Vulkan feature exists (`vulkan = ["llama-cpp-4/vulkan"]`) but is not a default build.
Linux-only release verified in `.github/workflows/release.yml` (matrix has exactly one
entry, `ubuntu-22.04`, with the in-file comment *"Linux only, deliberately. Windows fails
to link … macOS is unsigned…"*). Consequence: every candidate must run acceptably on CPU
and ship as a plain download — no GPU-priced model, no platform-specific wheel.

### 1.4 Disk is the real gate (measured this session)

```
$ df -h /
Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme0n1p7  393G  366G  7.8G  98% /
```

**7.8 GB free.** Models download at first run, so this is the actual per-model budget.
Current on-disk inventory (`~/.local/share/floure/models`, `du -sh`):

| Model dir | On disk | Download archive (`MODEL_MANIFEST.size_bytes`) | Extracted ≈ archive × |
|---|---|---|---|
| `parakeet-tdt-0.6b-v2-int8` | 631 MB | 482,468,385 | 1.31× |
| `whisper-large-v3-turbo-q5_1` | 990 MB | 563,790,207 | 1.76× |
| `whisper-base-q5_1` | 433 MB | 207,557,382 | 2.09× |
| `s1-mini-q4_k_m` | 462 MB | 484,219,808 (single file, no extraction) | 1.00× |
| `silero-vad` | 636 KB | 643,854 | 1.00× |

(Extracted ratios for the three archives are computed from our own directory sizes; the
Parakeet ratio also matches the upstream docs' `ls` output — 663 MB with `test_wavs` —
citation #126.) Any new candidate must state its download size against **7.8 GB** and
prefer an extracted estimate ×1.3–2.1 where no docs `ls` exists.

---

## 2. ASR Candidates Loadable at the Pin

Sizes are exact bytes from the first-party `asr-models` release API (citation **#125**,
498 assets). "WER evidence" is spelled out per row: **who measured it, on what, with what
protocol** — leaderboards are deliberately not used as evidence even when a card links
them; where a card's numbers *are* the OpenASR-protocol numbers, they are labeled
self-reported-with-that-protocol.

### 2.1 Viable candidates (fit disk, evidence exists)

| # | Model (release asset) | Type at pin | Download (bytes) | Extracted (verified unless marked EST) | Fits 7.8 GB? | First-party WER evidence (source → protocol) | Code change | Gate signal |
|---|---|---|---|---|---|---|---|---|
| A1 | `sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8` **(current)** | `nemo_transducer` | 482,468,385 | 631 MB (on disk) | already present | **avg 6.05; LS test-clean 1.69 / test-other 3.19** — NVIDIA card, self-reported, OpenASR datasets, greedy transducer, no LM (#130) | none (baseline) | **`ys_log_probs` ✓** |
| A2 | `sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-non-streaming` | `nemo_transducer` | 501,350,460 | 663 MB (docs `ls` total 1296016×512 B) ✓ | **yes** (≤0.7 GB) | **offline avg 5.91; LS 1.63 / 3.11**; same table re-runs parakeet-v2 at 6.04 — NVIDIA card, self-reported, whisper-normalizer scoring, greedy (#133) | `MODEL_MANIFEST` entry + new `AsrProfile` variant only: archive ships `encoder/decoder/joiner.int8.onnx` + `tokens.txt` → existing `verify_model` "parakeet" arm passes after `normalize_extracted` renames `.int8.onnx`; `parakeet.rs` already hardcodes `model_type=nemo_transducer`, which upstream's own command confirms for this model (#126). **License differs: NVIDIA Open Model License, not CC-BY-4.0** (#133) | **✓** — upstream's own decode example for this model prints `ys_log_probs` (#126) |
| A3 | `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` | `nemo_transducer` | 487,170,055 | 640 MB (docs `ls`) ✓ | **yes** | **avg 6.34; LS 1.93 / 3.59; FLEURS en 4.85** — NVIDIA card, self-reported (#131); technical report claims Canary-1B-v2 > Whisper-large-v3 on English at ~10× speed, but **that is a different model with no sherpa export** (#132) | same as A2 (drop-in) | **✓** |
| A4 | `sherpa-onnx-nemo-parakeet_tdt_ctc_110m-en-36000-int8` (CTC doc) / `…parakeet_tdt_transducer_110m-en-36000-int8` | hybrid TDT-CTC, archived under NeMo CTC docs / TDT transducer | 104,337,827 / 108,035,095 | EST ~135–220 MB | **yes** | **LS 2.4 / 5.2** (114M params, transducer greedy, no LM; 36k h PnC training) — NVIDIA+Suno card, self-reported (#136) | CTC archive: **new backend** (files are `model.onnx`/`model.int8.onnx` + `tokens.txt` per NeMo CTC export docs, #129) → new `verify_model` arm + new builder setting `model_config.nemo_ctc.model`; transducer archive: expected to hit the existing "parakeet" arm — **layout of this specific asset not verified without downloading** | CTC arm **✗**; transducer arm ✓ (by family) |
| A5 | `sherpa-onnx-zipformer-en-2023-06-26` (also `-small-` 112,232,184 / `-large-` 688,420,438) | icefall zipformer transducer | 307,666,046 | EST ~400–650 MB | **yes** | **greedy 2.22 / 4.87** (test-clean/other) for the exact source model (`Zengwei/icefall-asr-librispeech-zipformer-2023-05-15`, epoch 50 avg 25) — k2-fsa self-reported, mapping verified from sherpa docs → icefall RESULTS (#128, #134) | new `AsrProfile` variant; **`parakeet.rs` hardcodes `model_type="nemo_transducer"`, which is wrong for this family** → parameterize `model_type` (exact value comes from the archive's own README, verify at adoption) | ✓ (transducer) |
| A6 | Whisper family: `tiny` 116,204,861 · `tiny.en` 118,071,777 · `base` 207,557,382 (on disk) · `base.en` 208,576,005 · `small` 639,387,718 · `small.en` 635,693,775 · `medium` 1,931,372,882 · `medium.en` 1,905,872,689 · `large-v1/v2/v3` 1,066,424,971 / 1,134,475,725 / 1,068,482,488 · `turbo` 563,790,207 (on disk) · `distil-small.en` 453,710,017 · `distil-large-v2/v3/v3.5` 576,607,838 / 529,350,808 / 528,659,059 · `distil-medium.en` 1,007,278,599 | `whisper` | see left | turbo 990 MB, base 433 MB (measured); others EST ×1.3–2.1 (medium EN ≈ 2.5–4 GB — **exact extraction size unverified**) | all except medium-class fit; medium is risky at 98% disk use | **[dropped — not re-verified here]**: per-model WER lives in Radford et al. (#17, companion-fetched); we did not re-fetch the paper, so **no Whisper WER numbers are quoted in this document** | existing `whisper` backend works for `whisper-*` archives (manifest row only). **`distil-*` archives: file layout not verified against our `whisper.rs` rename logic — treat as unverified** | **✗ — no `ys_log_probs` on any Whisper path** (#120), so the gate falls back to text/timestamp proxies only |
| A7 | Moonshine: `tiny-en-int8` 107,569,151 · `base-en-int8` 250,807,309 · `tiny-en-quantized` 29,858,559 · `base-en-quantized` 111,266,225 | `moonshine` (v1/v2 impls at pin) | see left | EST ×2 (multi-file) | **yes** (trivially) | **Moonshine Tiny: 5× less compute than Whisper `tiny.en` at no WER increase; Tiny/Base beat the corresponding Whisper averages** — first-party paper (Jeffries et al., Useful Sensors), OpenASR-dataset protocol, greedy; paper also documents its weakness: repeated tokens on <1 s utterances (Earnings22) (#138) | **new backend**: `OfflineMoonshineModelConfig` at pin needs 4 files (v1) or `merged_decoder` (v2) — crate doc comment L157–160; new `verify_model` arm + new builder | **✗** (no `ys_log_probs` in moonshine decoders) |
| A8 | `sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25` | `qwen3_asr` | 878,702,423 | **1,000,730,624 B ≈ 0.98 GB** (docs `ls` total 1954552×512 B: conv_frontend 42M + decoder.int8 721M + encoder.int8 174M + tokenizer) ✓ | **yes** (≈1.9 GB combined download+extract) | **No English WER number is extractable from first-party sources**: the tech-report abstract says only "the 0.6B version offers the best accuracy-efficiency trade-off"; the repo's evaluation tables are **images**. **[dropped — unverifiable from fetched text]** (#137) | **new backend**: safe crate has `qwen3_asr.{conv_frontend,encoder,decoder,tokenizer,hotwords,max_total_len,max_new_tokens,…}` (L324–377) → new `verify_model` arm + new builder; autoregressive decode on CPU with sherpa's own defaults `max_total_len=512, max_new_tokens=128` (#126 config printout) — **CPU RTF unmeasured** | **✗** (no `ys_log_probs` in the Qwen3 impl) — and note its hotword field exists, but hotword-biased scores are caveated by #2937 regardless |
| A9 | `sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr(-int8)` | `canary` (AED) | 717,064,890 / **153,692,328** (int8) | EST ~200–400 MB (int8) | **yes** | **182M params; LS clean 1.87 / other 3.83** (whisper-normalizer, greedy, w/o PnC), plus its own MUSAN hallucination metric (91.52 chars/min) and SNR sweep — NVIDIA card, self-reported (#135) | **new backend**: `OfflineCanaryModelConfig{encoder, decoder, src_lang, tgt_lang, use_pnc}` exposed at pin (crate L120; C API L884) → new `verify_model` arm + builder + language plumbing; archive layout not verified without download | **✗** |
| A10 | `sherpa-onnx-nemotron-speech-streaming-en-0.6b-int8-*` (468,994,262; chunked 463,945,051×4) | streaming transducer exports | see left | EST ×1.5–2 | **yes** | **offline avg 6.92** vs parakeet-v2 6.04 in parakeet-unified's own comparison table (#133); NVIDIA streaming card exists as citation **#54** (established) | likely transducer-shaped, but streaming exports are tuned for chunked decode — layout/RTF unverified | ✓ by family (unverified for this asset) |
| A11 | `sherpa-onnx-nemo-ctc-en-conformer-small` 76,482,338 · `-medium` 165,685,608 · `-large` 610,719,312 · `citrinet-512` 164,307,491 · `sherpa-onnx-zipformer-ctc-en-2023-10-02` 383,165,059 | `nemo_ctc` / `zipformer2_ctc` | see left | EST ×1.3–2 | **yes** | **[dropped — no first-party WER fetched]** for every CTC row (we did not fetch the NeMo model cards) | new CTC backend (A4's shape) | **✗** |

Also present in the zoo but **not recommended and not re-litigated**: SenseVoice int8
(165,783,878 — multilingual incl. EN, no EN WER fetched → dropped), Paraformer-en
(~1 GB class, no EN WER fetched → dropped), TeleSpeech/Wenet CTC (Chinese), Vietnamese/
Russian/Japanese/Thai zipformers (wrong language), Ascend/QNN/rknn/NPU variants (wrong
platform).

### 2.2 The important negative results (so nobody re-litigates)

| Notable model | Why it is NOT a Floure candidate | Evidence |
|---|---|---|
| **Canary-1B / Canary-1B-v2** — the model whose report claims *"outperforms Whisper-large-v3 on English ASR while being 10x faster"* | **No sherpa-onnx export exists.** The full 498-asset `asr-models` release contains only the 180m-flash variant (both sizes) — no Canary-1B archive of any size | release API enumeration (#132 for the claim, #125 for the absence) |
| **HuggingFace wav2vec 2.0 / WavLM / any HF-Transformers ASR** | **No support in sherpa-onnx.** Grep of the whole pin finds only a comment "based on Wav2Vec" describing the *feature extractor* — no wav2vec model loading path | tag grep (#120 re-verified) |
| **faster-whisper (CTranslate2), whisper.cpp, Vosk/Kaldi, NeMo-native runtime, Moonshine's own runtime** | Different runtimes. Floure's ASR goes through the Rust crate `sherpa-onnx 1.13.7` (`parakeet.rs`/`whisper.rs` import `sherpa_onnx::OfflineRecognizer`); adopting these means replacing the runtime, not the model — out of scope of "candidate model" | local code (#grounding, §1.2) |
| **Qwen2-Audio-class audio-LLMs** | Not in sherpa-onnx. The Qwen family member that *is* supported is Qwen3-ASR (§1.1 premise correction) — see A8 for why it still isn't recommended | tag dispatch + docs (#127) |
| **Whisper full large-v3 as an "upgrade"** | 1,068,482,488 B download + likely ~2.2–3 GB extracted **[extracted EST — unverified]** on a 7.8 GB / 98%-full disk, *and* it moves us off the transducer arm → loses `ys_log_probs` (§6). No fetched evidence it beats what we already run | release API (#125), #120 |
| **Cohere Transcribe** (`…cohere-transcribe-14-lang-int8` 1,699,791,751) | Fits disk only barely; it is an LLM-class encoder/decoder and **no CPU RTF or English WER was fetched** → unverifiable perf → dropped | release API (#125) |
| **FireRedAsr / FireRedASR2** (838,589,068 – 2,072,964,047) | zh_en / Chinese-centric focus; no English-vs-parakeet evidence fetched → dropped | release API (#125) |
| **Streaming models for our pipeline** | Floure decodes complete VAD segments offline (`pipeline.rs` segment loop); chunked-streaming buys nothing there | local code |

### 2.3 What the first-party numbers actually say (honest synthesis)

All English numbers below are **self-reported by NVIDIA on OpenASR-protocol datasets with
greedy decoding and no external LM** (cards #130/#131/#133/#135/#136) — same protocol
across rows, which makes them mutually comparable but *not* independent:

| Model | Params | LS clean | LS other | Avg (8 sets) | vs current (parakeet-v2) |
|---|---|---|---|---|---|
| **parakeet-tdt-0.6b-v2 (current)** | 0.6B | **1.69** | **3.19** | 6.05 | — |
| parakeet-unified-en-0.6b | 0.6B | 1.63 | 3.11 | **5.91** | ≈2% rel better (same-table v2 = 6.04) |
| parakeet-tdt-0.6b-v3 (25 langs) | 0.6B | 1.93 | 3.59 | 6.34 | **worse on English** |
| parakeet-tdt_ctc-110m | 114M | 2.4 | 5.2 | — (AMI 15.88) | clearly worse |
| canary-180m-flash | 182M | 1.87 | 3.83 | — (AMI 14.86) | worse |
| nemotron-speech-streaming-en-0.6b (offline mode) | 0.6B | — | — | 6.92 | worse |
| zipformer-2023-05-15 (icefall, k2-fsa self-report) | 65.5M | 2.22 | 4.87 | — | worse |

> **Headline finding:** on English, at this size class, the first-party evidence does
> not offer a meaningfully better ASR than the one already on disk. The best available
> same-class delta is parakeet-unified's ≈2% relative (5.91 vs 6.04/6.05) — an effect
> **below what our own eval can detect at n=100** (companion §4.6: 600–1200-utterance
> scale needed; their inverse formula gives ≈165–650 utterances for a clean 5% rel).
> Multilingual is the one axis with a real answer: v3 (25 EU languages, worse English),
> Qwen3-ASR (30 languages + dialects, no extractable EN number), SenseVoice (5).

Not quoted anywhere above: any HF Open ASR Leaderboard figure. Where a card's table *is*
the leaderboard protocol, the numbers are reproduced as the vendor's own measurement.

---

## 3. Local Cleanup LLM Candidates (GGUF, CPU, fits disk)

### 3.1 What the already-cited evidence says about "a stronger corrector"

Re-stated, not re-derived (companion §§3.1–3.4, §5.3):

- **Idiap (Naderi et al. 2024, #75):** even *gated*, even with GPT-4, correction
  **regresses** the strong model (Whisper Large-v3 2.78 → 3.21); it helps only the weak
  model (Tiny 8.13 → 5.65).
- **Every positive result used commercial models** (GPT-3.5/4/4o; Pu's 10–20% rel used a
  commercial LLM behind an N-best gate + rules; Fang's 9–11.4% used GPT-4o).
- **No fetched source evaluates any quantized local single-digit-billion model for this
  task.** Local cleanup-model quality is **unmeasured**, full stop.

So: upgrading the local model is *not* an evidence-backed lever. It is an unmeasured
 gamble in the direction the literature says can go negative. The evidence-backed local
levers are (a) gate targeting, (b) prompt conservation rules — both already implemented
in `llm.rs` — and (c) using the local model **according to its own card**, which we
currently do not (§3.3).

### 3.2 Candidate table

| Model | Params | GGUF size (q4_k_m) | Fits 7.8 GB? | Context capability (first-party) | Task evidence | Notes / code change |
|---|---|---|---|---|---|---|
| **s1-mini-q4_k_m (current)** | 0.6B unique (596.0M; Hub shows 0.8B because `lm_head` is a materialized copy — card explains) | 484,219,808 **on disk** | already present | **40,960** tokens (card's GGUF skeleton note; = `Qwen3-0.6B` config `max_position_embeddings: 40960`) | **self-reported 94.8% token accuracy on superwhisper's own held-out set of 7,519 English cases**, measured on this exact Q4_K_M build — *not* a WER-delta-after-cleanup number, and no head-to-head against any other corrector (#139) | Current default (`default_llm_model()`). It is a **task-trained text normalizer** (fillers, false starts, punctuation, ITN) built on Qwen3 — the closest specialization class to our task of anything here |
| Qwen3-0.6B (official base/instruct) | 0.6B | official `Qwen/Qwen3-0.6B-GGUF` repo contains **a single GGUF file** (API-verified; a q4_k_m build is not confirmed in it) — third-party q4_k_m builds land in s1-mini's ~460–490 MB class | fits | **40,960** (official config) (#140) | **none for cleanup** | No task training, no normalizer specialization; strictly a downgrade in evidence terms vs s1-mini |
| Qwen2.5-1.5B-Instruct | 1.5B | **1,117,320,736** (official Qwen GGUF, API-verified) | fits (~6.7 GB left) | **32,768** (`max_position_embeddings`, official config) (#141) | **none for cleanup** | General instruct model. GQA-2 → KV cache cheap (§4.2). Nothing in the fetched literature suggests a *bigger general* corrector is safer (Idiap #75 says the opposite) |
| gemma-3-1b-it (already declared in `MODEL_MANIFEST`) | 1.0B | 806,058,272 (manifest) / "Q4_K_M 806 MB" (Unsloth card) — matches | fits; declared but not downloaded | **32K input / 8192 output for the 1B size** (Google's card text on the Unsloth repo) (#142) | **none for cleanup** | Gemma license terms apply; different chat template than Qwen3 (`llm.rs` already branches templates) |
| Llama-3.2-1B-Instruct | 1B | official `meta-llama` GGUF repo is **gated (HF API: 401)** → skipped as first-party; third-party bartowski q4_k_m = 807,694,464 (API-verified, *not* first-party quantization) | fits | **[dropped — not fetched]** | none | Official-first-party rule not satisfiable without an account → dropped (#143) |

Disk note: **7.8 GB free is shared across ASR + LLM downloads at first run** — e.g.
adding parakeet-unified (0.5 GB dl / 0.66 GB extracted) *and* Qwen2.5-1.5B (1.12 GB)
still fits, but the medium-Whisper class (§2 A6) and any second 0.6B ASR should not be
assumed co-resident.

### 3.3 The integration findings that outrank any model swap (verified in our code)

The s1-mini card (#139) is unusually prescriptive. Two of its requirements are **not met
by the current code**, and one is *not reachable* through our wrapper:

1. **Format:** *"Every request needs the system prompt and the control line, exactly as
   shown… Skip either one… and the model can hallucinate or produce garbled output."*
   Our `build_prompt()` produces `instruction + "\n\nTranscript:\n" + text` and
   `stream_local` sends it as a **single user message with no system prompt and no
   `[Styling: …] [Structure: …] [Context: …]` control line** (`llm.rs`). We are running
   the model off-spec by its own card. The card also notes filler-only input should yield
   an empty string — a behavior we cannot expect while off-format.
2. **Thinking mode:** *"S1-mini was trained with thinking off, so the assistant turn must
   start with an empty `<think>` block, or you will get no usable output… In llama.cpp that
   means `--jinja` together with `--chat-template-kwargs '{"enable_thinking":false}'`."*
   Our wrapper call is `apply_chat_template(None, &chat, true)`, and the pinned
   `llama-cpp-4` signature is exactly `fn apply_chat_template(&self, tmpl: Option<&str>,
   chat: &[LlamaChatMessage], add_ass: bool)` — **no chat-template-kwargs parameter
   exists** (#149, crate source on disk). So the card-mandated switch is not expressible
   through the current API surface. Whether output today contains think-block leakage is
   **[unverified — needs an instrumented run]**; what is verified is that we cannot pass
   the flag the card requires.
3. **Sampling:** the card requires greedy (`--temp 0`) and warns the file metadata
   carries `temp=0.6/top_p=0.95/top_k=20` inherited from Qwen3. Our sampler is already
   `LlamaSampler::greedy()` ✓ — this one we get right.

**Verdict:** for the local LLM, the evidence-backed action is *spec conformance +
measurement* (fix 1–2, then measure the fired-subset failure rate), not a model swap.
Every swap candidate in §3.2 has strictly less task evidence than s1-mini.

---

## 4. Context / Completion Budget: does raising 512/128 change anything?

### 4.1 What llama.cpp actually requires (grounded in the pinned crates)

- `llama.h` (bundled in `llama-cpp-sys-4-0.6.1`): `uint32_t n_ctx; // text context,
  0 = from model` — and `llama-context.cpp`: `cparams.n_ctx = params.n_ctx == 0 ?
  hparams.n_ctx_train : params.n_ctx`, plus a **warning** (not an error) when
  `n_ctx_seq > n_ctx_train` ("possible training context overflow") (#149).
- The safe crate's default is `n_ctx: 4096` (`llama-cpp-4` `common.rs` L83) (#149).
- Floure overrides to **512** explicitly (`llm.rs`: `LlamaContextParams::default().with_n_ctx(512)`,
  `LlamaBatch::new(512, 1)`, `max_new_tokens = 128`).

**Conclusion:** no candidate model *requires* a small context. Every model in §3.2 was
trained at ≥32,768 tokens (cards/configs #139–#142), so 512 is a **pure allocation
choice** we made; raising it is legal for all candidates and never trips
`n_ctx_train`. The only costs are KV-cache memory and prompt-processing time.

### 4.2 KV-cache cost of raising ctx (our arithmetic, first-party config values)

Assuming llama.cpp's default f16 K/V (labeled assumption; override exists via
cache-type flags). Per token: `2 (K+V) × n_layer × n_kv_heads × head_dim × 2 bytes`:

| Model | Config (fetched) | KV per token | ctx 512 | ctx 1024 | ctx 2048 | ctx 4096 |
|---|---|---|---|---|---|---|
| s1-mini / Qwen3-0.6B | 28 layers, **8** KV heads, head_dim **128** (#140) | 112 KiB | 56 MiB | 112 MiB | 224 MiB | 448 MiB |
| Qwen2.5-1.5B | 28 layers, **2** KV heads, head_dim 128 (#141) | 28 KiB | 14 MiB | 28 MiB | 56 MiB | 112 MiB |
| gemma-3-1b | config gated → **[dropped]** | — | — | — | — | — |

Raising the local budget to ctx 1024 + completion 256 costs **+56 MiB RAM** on the
current model — negligible; it is not a resource decision.

### 4.3 Does a larger ctx change the truncation analysis? — it fixes a *different*, worse bug

The companion's §5.3 arithmetic still holds and is unaffected by ctx: the binding
constraint is the **128-token completion (≈95 words output)** vs transcript length, and
commit 5ae0a14 already landed its recommended fix #1 (local clamp = **512 bytes**,
verified: `max_transcript_bytes(Local) == 512` with a test asserting it).

But reading the clamp's caller surfaced a **verified current-code failure mode** the
companion's analysis predates (`pipeline.rs` L107–126, L140–141):

> When the gate **fires** and `text.len() > 512` bytes, the code keeps the **tail**
> (*"keep the tail = most recent speech"*), feeds only that tail to the model, and on
> success `cleaned` = the model's rewrite of the tail — which then **replaces the whole
> transcript**. The head of any gate-fired dictation longer than ~90 words is silently
> dropped from typed output.

So the 512-byte clamp traded mid-sentence truncation (Ma-et-al. deletions, F1) for
**head deletion on long fired transcripts**. This is now the top truncation finding, and
it makes question 3's answer concrete:

| Option | Change | Arithmetic (our counting: current prompt ≈ 100 words ≈ 135 tokens + chat framing ≈ 150; 4 chars/token) | Effect on the failure mode |
|---|---|---|---|
| **B1 (preferred)** | On over-clamp, **skip the LLM and use the full transcript + regex fillers** (the companion's "whole or nothing" instinct) | no ctx change | eliminates head deletion outright; costs only "long fired dictations aren't cleaned" |
| **B2** | ctx 512 → **1024**, completion 128 → **256**, clamp → **~1000 bytes** | 150 prompt + ~250 in + 256 out ≈ 656 ≤ 1024 ✓; KV +56 MiB (§4.2) | covers dictations up to ~250 words end-to-end; truncation risk returns only above that (keep B1 as the residue guard) |
| Status quo | — | fits (≈410 ≤ 512) but has the head-loss bug | not acceptable as-is |

Other small GGUF models do not impose different budget *requirements* (§4.1); a swap to
Qwen2.5-1.5B or gemma-3-1b would change nothing here except KV cost (cheaper for
Qwen2.5, unknown for gemma until measured). **The budget is a pipeline decision, not a
model-selection decision.**

---

## 5. VAD: does anything beat Silero for this use?

Short answer: **no published evidence says so for Floure's regime** (short dictation,
CPU, offline, Linux) — say plainly, don't invent an option.

| Candidate | What exists (fetched) | Verdict |
|---|---|---|
| **Silero VAD (current)** | First-party README: *"less than **1ms** to be processed on a single CPU thread"*, ~2 MB model, trained on **6000+ languages**, 8/16 kHz, MIT (#148). Published work in our regime *supports* keeping it: McKinnon et al. 2026 measured *"Silero significantly outperforms WebRTC and RMS"* and found hysteresis gives it no benefit (MCC 0.72 vs 0.41/0.11) (#147) | **Keep** |
| **TEN VAD** | Reachable at the pin — the safe crate at 1.13.7 exposes `TenVadModelConfig` (crate source, #149). Evidence: (a) **vendor repo claim** of better PR-curve than Silero on their own annotated set — self-published, no peer review (#145); (b) an independent-ish comparison repo reporting **ROC-AUC 0.981 (Silero) vs 0.985 (TEN)** on labeled LibriSpeech+MLS test sets — a near-tie, and it notes *"TEN VAD does not support ARM CPU with Python on Linux"* (#146); (c) its citation block is a GitHub-repo `@misc`, i.e. no paper | Not justified: strongest evidence is a vendor claim and the only independent number is a statistical near-tie on detection AUC, not on Floure's outcome metric (endpointing → WER). Revisit only if we ever measure endpointing latency as a problem |
| **LibriVAD (ViT+MFCC)** | Paper's own abstract: ViT+MFCC beats **"boosted deep neural network and convolutional long short-term memory deep neural network"** — the baselines are *not* Silero; no dictation/CPU/offline Silero comparison; it is a dataset+benchmark release (#144) | Does not establish a Silero successor |
| WebRTC VAD, energy/RMS | Refuted by #147 (and superseded long ago) | No |

**[Dropped]**: any claim that TEN VAD or LibriVAD's ViT "beats Silero" as a *published*
result — neither source says that in any peer-reviewed or independent measurement we
fetched. Moonshine-v2-style papers, blog roundups, and leaderboard tables were out of
scope per the task's primary-source rule.

---

## 6. Interaction with the confidence gate (per candidate)

Companion result assumed (not re-derived): transducers populate `ys_log_probs` (reachable
only via the sys-crate JSON getter at this pin); Whisper-class has **no** per-token
confidence → text/timestamp proxies only (§2.7 there); N-best unavailable for *every*
family (§2.5 there); hotword-biased decodes corrupt the scores (issue #2937).

| Candidate | Model family | Gate signal at the pin | Consequence for the gate plan |
|---|---|---|---|
| parakeet-v2 **(current)**, parakeet-unified (A2), parakeet-v3 (A3), parakeet-110m **transducer** (A4), zipformer transducers (A5), nemotron exports (A10) | transducer | **`ys_log_probs` ✓** (NeMo + generic decoders at pin; PRs #2843/#3105; A2's own docs example prints the field) | Full companion §2.6 plan applies unchanged: per-word = last-token `exp(ys_log_probs)` from the **unbiased greedy** decode; never from the hotword-biased beam (#2937) |
| **Whisper family + distil (A6)** | seq2seq | **✗ none** (zero grep matches at pin; #120) | Proxies only (companion §2.7). Choosing Whisper-class *forfeits* the primary gate signal — a reason to prefer transducers independent of WER |
| Moonshine (A7) | enc-dec greedy | **✗ none** | proxies only |
| **Qwen3-ASR (A8)** | autoregressive (LLM-style decoder) | **✗ none** in its impl at pin | proxies only — and its built-in `hotwords` field would hit the same #2937 score-contamination caveat if it produced scores |
| **Canary-180m (A9)** | AED | **✗ none** | proxies only. Its card does publish a *hallucination* metric (MUSAN chars/min), which is adjacent to our F6 "too broken to clean" gate but is not a per-utterance confidence |
| CTC family (A4-CTC, A11) | CTC | **✗ none at this pin** (CTC decoders don't fill `ys_log_probs`) — even though the *literature* has strong non-trainable CTC confidence (Laptev & Ginsburg, #104) | CTC would strand us on proxies despite being the family #104 was written for. Another reason transducer > CTC here |
| N-best (any family) | — | **✗ absent at pin** (companion §2.5) | Pu-style N-best-disagreement gates remain unimplementable regardless of model choice |

**Net:** model choice and gate capability are coupled. Every *recommended* candidate in
§2.1-A keeps the gate story exactly as researched; every architecture swap off the
transducer arm (Whisper/Moonshine/CTC/Canary/Qwen3) silently downgrades the gate to
proxies **before** any WER comparison is even run.

---

## 7. Recommendation, ordered, with what `benchmark-audio` can and cannot prove

Companion §4.6 power result assumed: n=100 utterances detects only **≈6–12% relative WER**
at 80% power (MAPSSWE, σ_Z 0.25–0.5); the exact sign test will almost surely read
"inconclusive" whenever cleanup both fixes and breaks utterances; gate precision/recall
*is* measurable at n=100.

| # | Action | Expected *measurable* effect | What the harness can prove | What it cannot prove |
|---|---|---|---|---|
| 1 | **Fix the head-deletion mode** (§4.3 B1: skip-LLM on over-clamp, or B2: ctx 1024 / completion 256 / clamp ~1000 B) | Removes a *deterministic* deletion bug on every gate-fired dictation >512 B | **Yes — mode frequency**: replay the gate over `manifest.jsonl` and count fired ∧ `len>512` (pure text, no LLM needed); post-fix, the word-count conservation check (companion §5.3 fix 3) catches regressions per-utterance | The WER *delta* of cleaning-vs-not on those long utterances (few in n=100) |
| 2 | **Run the local model per its card** (§3.3: system prompt + control line; resolve thinking-off — may need an upstream `llama-cpp-4` API or a raw template string) | Fewer garbled/hallucinated cleanup outputs; filler-only input → empty output as designed | **Partially**: failure counts on the fired subset are countable at n=100 (catastrophic modes don't need power); a pre/post MAPSSWE only if the failure rate is ≥~10% of fired utterances | Small quality deltas; any claim that cleanup now *helps* WER (that needs ≥165–650 utts per companion §4.6) |
| 3 | **Implement the confidence-gate signal first** (companion §2.6 option 1: sys-crate JSON parse) | Gate becomes precision-targetable (coverage + P/R vs `errors_raw>0`) | **Yes — that is exactly what §4.3/§4.6 of the companion designed** (`bench_gate_eval`: coverage, gate P/R, WER split by fired/skipped) | Whether a *threshold choice* improves WER by single-digit % (underpowered) |
| 4 | **ASR: stay on parakeet-v2 for English**, optionally trial **parakeet-unified** (A2) as the only first-party-beats-us candidate (5.91 vs 6.05 avg, 1.63 vs 1.69 clean) | ≈2% rel avg / ≈4% rel LS-clean *if* the self-reported delta transfers to our mic/room | **No — direction only**: 2–4% rel is far under the 6–12% detectable band; report MAPSSWE + p-value as directional per companion §4.6, or pool tiers to ≥165 utts first | Any settled claim that unified is better; absolute WER comparability (their protocol ≠ our audio) |
| 5 | **ASR: do not switch to** v3 (English is worse: 6.34 vs 6.05 — measured by the vendor itself), Whisper-class (loses `ys_log_probs`, no fetched gain evidence, medium-class strains disk), zipformer/110M/canary/moonshine/CTC (all strictly worse in first-party tables *and/or* lose the gate), Qwen3-ASR (no extractable EN number, no confidence, +1 GB disk, unmeasured CPU cost) | — | The harness *could* falsify "no better model available" only for ≥~10% deltas; none of these claims a ≥10% delta from first-party tables | — |
| 6 | **LLM: keep s1-mini; do not swap** (§3.1/§3.2). If ever revisited: swap candidates must first produce *some* first-party evidence for this task — none exists today | Unmeasured either way; Idiap says scale can invert the sign | A swap A/B is only provable at ≥165–650 utts (companion §4.6); at n=100 it is untestable | Any conclusion at n=100 — **call this out explicitly in the PR** |
| 7 | **VAD: keep Silero** (§5). Optional low-priority spike of TEN VAD *only if* endpointing latency is ever user-reported | Unmeasured; only vendor claim + AUC near-tie | Segment-boundary diffs between the two VADs are directly countable on the bench audio (timestamps, no labels needed) | That any VAD swap changes WER (both are near-ceiling on clean bench audio) |

**Ordering rationale:** 1–3 are code/gate fixes with *directly countable* effects at
current sample size; 4 is a plausible-but-small model improvement the harness can only
treat as directional; 5–7 are "don't do its" whose purpose is to stop re-litigation.
Disk (7.8 GB free) reinforces the order: nothing above costs more than ~1.1 GB, and the
only candidates that would strain it (whisper-medium class, Cohere) are ones we reject
on evidence grounds anyway.

---

## 8. Explicitly dropped / unverifiable in this document

1. **Qwen3-ASR English WER numbers** — tech-report abstract carries no number; the
   repo's eval tables are images. **[dropped]**, not guessed.
2. **All Whisper per-model WER** — companion already cites Radford et al. (#17); we did
   not re-fetch it this session, so no Whisper WER is quoted. **[dropped]**.
3. **Moonshine "Medium beats Whisper large-v3" (repo README claim)** — sourced to the
   OpenASR leaderboard; leaderboards excluded by task scope. **[dropped]**; we only use
   the Moonshine *paper's* tiny/base comparisons (#138).
4. **Official Meta Llama-3.2 GGUF sizes** — HF API returns *401 Invalid username or
   password* (gated). Third-party quant size noted but labeled. **[dropped]**.
5. **Extracted sizes for assets without docs `ls` output** (whisper medium/large,
   moonshine, zipformer, canary, 110M) — marked **EST** where given, omitted where not.
6. **Any "beats Silero" claim for VAD** — no peer-reviewed or independent fetched source
   says it. **[dropped]** (§5).
7. **Moonshine v2 paper (arXiv:2602.12241)** — surfaced only via search snippets, never
   fetched directly → **not cited**.
8. **Qwen3-0.6B official GGUF q4_k_m size** — the official GGUF repo exposes a single
   file and our API probe did not return its byte size; **[dropped]** rather than
   approximate.
9. **Whether the current s1-mini output contains think-block leakage** — requires an
   instrumented run; documentation-only constraint respected. **[unverified — flagged]**.

---

## References (every source fetched for this document)

1. k2-fsa/sherpa-onnx **`asr-models` release** (498 assets + exact byte sizes) via
   GitHub API: https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/tags/asr-models — also citations **#125**
2. k2-fsa/sherpa-onnx **v1.13.7 tag source tarball**
   https://github.com/k2-fsa/sherpa-onnx/archive/refs/tags/v1.13.7.tar.gz + release API
   (`published_at 2026-09-01`) — re-verified dispatch table, `ys_log_probs` grep,
   `CHANGELOG.md` (#3399/#3409/#3423/#3268) — cross-reference citations **#120/#121**
3. sherpa docs — **NeMo transducer zoo page** (v2/v3/unified layouts, `--model-type=nemo_transducer`
   commands, unified decode output carrying `ys_log_probs`, config printouts including
   `qwen3_asr`/`canary`/`ten_vad` fields):
   https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html — **#126**
4. sherpa docs — **Qwen3-ASR section** (QwenLM conversion; int8 archive layout):
   https://k2-fsa.github.io/sherpa/onnx/qwen3-asr/index.html ·
   https://k2-fsa.github.io/sherpa/onnx/qwen3-asr/pretrained.html — **#127**
5. sherpa docs — **zipformer zoo page** (`sherpa-onnx-zipformer-en-2023-06-26` ←
   `Zengwei/icefall-asr-librispeech-zipformer-2023-05-15`):
   https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/zipformer-transducer-models.html — **#128**
6. sherpa docs — **offline NeMo CTC English page** (`nvidia/parakeet-tdt_ctc-110m`
   origin; `model.onnx` + `tokens.txt` export steps):
   https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-ctc/nemo/english.html — **#129**
7. sherpa docs — **pretrained-models index** (model-family taxonomy):
   https://k2-fsa.github.io/sherpa/onnx/pretrained_models/index.html — part of **#126**
8. NVIDIA **parakeet-tdt-0.6b-v2 model card** (avg 6.05, LS 1.69/3.19, SNR sweep,
   telephony table): https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2 — **#130**
9. NVIDIA **parakeet-tdt-0.6b-v3 model card** (avg 6.34, LS 1.93/3.59, FLEURS en 4.85):
   https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 — **#131**
10. Sekoyan et al. (NVIDIA), **Canary-1B-v2 & Parakeet-TDT-0.6B-v3 report**:
    https://arxiv.org/abs/2509.14128 · **DOI:** 10.48550/arXiv.2509.14128 — **#132**
11. NVIDIA **parakeet-unified-en-0.6b model card** (offline 5.91 vs v2 6.04 same table;
    LS 1.63/3.11; whisper-normalizer; NVIDIA Open Model License; unified-transducer paper
    arXiv:2604.19079 referenced): https://huggingface.co/nvidia/parakeet-unified-en-0.6b — **#133**
12. k2-fsa **icefall LibriSpeech `RESULTS.md`** (zipformer self-reported WERs):
    https://raw.githubusercontent.com/k2-fsa/icefall/master/egs/librispeech/ASR/RESULTS.md — **#134**
13. NVIDIA **canary-180m-flash model card** (182M; LS 1.87/3.83; MUSAN hallucination
    metric; SNR sweep): https://huggingface.co/nvidia/canary-180m-flash — **#135**
14. NVIDIA/Suno **parakeet-tdt_ctc-110m model card** (114M hybrid; LS 2.4/5.2; 36k h):
    https://huggingface.co/nvidia/parakeet-tdt_ctc-110m — **#136**
15. Qwen Team, **Qwen3-ASR repo README** + **Qwen3-ASR Technical Report**:
    https://github.com/QwenLM/Qwen3-ASR · https://arxiv.org/abs/2601.21337
    (**DOI:** 10.48550/arXiv.2601.21337) — **#137**
16. Jeffries, King, Kudlur, Nicholson, Wang, Warden (Useful Sensors), **Moonshine**:
    https://arxiv.org/abs/2410.15608 (**DOI:** 10.48550/arXiv.2410.15608) — **#138**
17. Superwhisper, **s1-mini-GGUF model card** (462 MiB Q4_K_M; 40,960-token context;
    94.8% token accuracy on held-out 7,519 cases, self-reported; required system prompt +
    control line; thinking-off requirement; greedy requirement):
    https://huggingface.co/superwhisper/s1-mini-GGUF — **#139**
18. **Qwen3-0.6B config.json** (28 layers, 8 KV heads, head_dim 128,
    max_position_embeddings 40960): https://huggingface.co/Qwen/Qwen3-0.6B/raw/main/config.json — **#140**
19. **Qwen2.5-1.5B-Instruct config.json** (max_position_embeddings 32768; 28 layers,
    2 KV heads) + official GGUF `qwen2.5-1.5b-instruct-q4_k_m.gguf` =
    1,117,320,736 bytes: https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct/raw/main/config.json ·
    https://huggingface.co/api/models/Qwen/Qwen2.5-1.5B-Instruct-GGUF?blobs=true — **#141**
20. **gemma-3-1b-it GGUF card (Unsloth)** — Q4_K_M 806 MB (matches manifest
    806,058,272); Google card text: 32K input context for the 1B size, 8192 output:
    https://huggingface.co/unsloth/gemma-3-1b-it-GGUF — **#142**
21. HF API — `meta-llama/Llama-3.2-1B-Instruct-GGUF` returns **401 (gated)**;
    `bartowski/Llama-3.2-1B-Instruct-Q4_K_M` = 807,694,464 bytes (third-party quant):
    https://huggingface.co/api/models/meta-llama/Llama-3.2-1B-Instruct-GGUF?blobs=true ·
    https://huggingface.co/api/models/bartowski/Llama-3.2-1B-Instruct-GGUF?blobs=true — **#143**
22. Stylianou, Sarkar, Dawalatabad, Glass, Tan, **LibriVAD**: https://arxiv.org/abs/2512.17281
    (**DOI:** 10.48550/arXiv.2512.17281) — **#144**
23. TEN Team, **TEN VAD repo README** (vendor Silero comparison, RTF table, GitHub `@misc`
    citation): https://github.com/TEN-framework/ten-vad — **#145**
24. guynich, **vad_eval_comparison README** (Silero 0.981 vs TEN 0.985 ROC-AUC; TEN ARM
    note): https://github.com/guynich/vad_eval_comparison — **#146**
25. McKinnon, Khaki, Reddy, Huang, **Window Size Versus Accuracy Experiments in Voice
    Activity Detectors**: https://arxiv.org/abs/2601.17270 (**DOI:** 10.48550/arXiv.2601.17270) — **#147**
26. Silero Team, **silero-vad README** (first-party perf/size/language claims):
    https://raw.githubusercontent.com/snakers4/silero-vad/master/README.md — **#148**
27. Pinned crate sources **on disk** (no compilation): `llama-cpp-sys-4-0.6.1/llama.cpp`
    (`include/llama.h` `n_ctx` semantics; `src/llama-context.cpp` n_ctx←n_ctx_train +
    overflow warning), `llama-cpp-4-0.6.1/src/common.rs` (default `n_ctx: 4096`),
    `…/src/model.rs` (`apply_chat_template(tmpl, chat, add_ass)` — no kwargs),
    `sherpa-onnx-1.13.7/src/offline_asr.rs` (`OfflineQwen3ASRModelConfig`,
    `OfflineCanaryModelConfig`, `TenVadModelConfig`, Moonshine v1/v2 file counts),
    `sherpa-onnx-sys-1.13.7/src` — **#149**
28. Local repo files **read, not modified**: `application/src-tauri/src/models.rs`,
    `llm.rs`, `parakeet.rs`, `whisper.rs`, `config.rs`, `pipeline.rs`,
    `.github/workflows/release.yml`; disk state via `df -h /` + `du -sh
    ~/.local/share/floure/models/*` — **#150**
