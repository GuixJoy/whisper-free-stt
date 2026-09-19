# Benchmark audio (Tier 1) — NOT in git except manifest

Source: LibriSpeech dev-clean (read English, 16 kHz). CC BY 4.0.
Regenerate: `python3 fetch.py <dev-clean.tar.gz>` (100 utts, ≤5/speaker).
`text` is the book transcript = ASR reference (`verbatim`).
`clean` targets (cleanup-stage references) still to be added per the
selective-cleanup benchmark design.
Caveat: read speech, no disfluencies; Qwen-lineage LLMs may have seen
these texts — fine for ASR WER, weaker for cleanup scoring.
