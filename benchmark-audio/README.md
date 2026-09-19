# Benchmark audio (Tier 1) — NOT in git except manifest

Source: LibriSpeech dev-clean (read English, 16 kHz). CC BY 4.0.
Regenerate: `python3 fetch.py <dev-clean.tar.gz>` (100 utts, ≤5/speaker).
`text` is the book transcript = ASR reference (`verbatim`).
`clean` targets (cleanup-stage references) still to be added per the
selective-cleanup benchmark design.
Caveat: read speech, no disfluencies; Qwen-lineage LLMs may have seen
these texts — fine for ASR WER, weaker for cleanup scoring.

Baseline (2026-09-19, `cargo test -- --ignored bench`, 100 utts):
Parakeet-v2-int8 WER 1.67% p50 0.32s RTF 0.04;
Whisper-base-q5_1 WER 7.12% p50 0.95s RTF 0.12.
Beam search + hotwords verified working on the v2-int8 build
("Calico"→"Kalico" with hotword KALIKO, 0.33s vs 0.32s greedy).
