# Voice Algorithms Research

## Directory Structure

```
voice-algorithms/
├── README.md                              # This file
├── vad/
│   └── vad-algorithms.md                  # VAD survey (energy, spectral, deep learning)
├── asr/
│   └── asr-systems.md                     # ASR survey (Whisper, wav2vec, RNN-T, NeMo)
├── noise-estimation/
│   └── noise-algorithms.md                # Noise estimation (MCRA, IMCRA, Wiener, EMA)
├── dsp-features/
│   └── feature-formulas.md                # DSP feature formulas (flux, centroid, MFCC)
├── production-systems/
│   └── production-architecture.md         # Production patterns (AGC, memory, latency)
├── adaptive-vad/
│   ├── universal-algorithm.md             # Our adaptive VAD algorithm
│   ├── universal_vad.py                   # Standalone implementation
│   ├── test_universal_vad.py              # Unit tests
│   └── benchmark_universal_vad.py         # Performance benchmarks
├── diarization/
│   ├── diarization-algorithms.md          # Speaker diarization survey
│   └── implementation-plan-v0.2.md        # Phased implementation plan
└── papers/
    └── citations.md                       # 74 verified entries (surveys + 2026 sweep: transducers, LLM cleanup)
```

## Quick Reference

| Topic | File | Key Algorithms |
|---|---|---|
| Voice Activity Detection | `vad/vad-algorithms.md` | Energy, ZCR, Spectral Flux, Silero VAD v5, WebRTC GMM |
| Speech Recognition | `asr/asr-systems.md` | Whisper, wav2vec 2.0, RNN-T, Conformer, NVIDIA NeMo |
| Noise Estimation | `noise-estimation/noise-algorithms.md` | MCRA, IMCRA, Spectral Subtraction, Wiener, Dual-EMA |
| DSP Features | `dsp-features/feature-formulas.md` | Flux, Centroid, ZCR, BER, MFCC, RMS |
| Production Patterns | `production-systems/production-architecture.md` | AGC, Hysteresis VAD, Forced Splitting, Memory Mgmt |
| Our VAD | `adaptive-vad/universal-algorithm.md` | IMCRA + Dual-EMA + Hysteresis (implemented) |
| Speaker Diarization | `diarization/diarization-algorithms.md` | ECAPA-TDNN, pyannote, AHC, VBx, UIS-RNN |
| LLM Cleanup | `papers/citations.md` §74 | ClozeGER, uncertainty gating, RLLM-CF |
| Citations | `papers/citations.md` | 74 entries with verified links |

## Implemented vs Planned

### Implemented
- Universal Adaptive VAD (`stt/vad.py`) — IMCRA + dual-EMA + hysteresis
- 3-layer dictionary system (exact + fuzzy + LLM context)
- Dual-backend ASR (whisper.cpp + faster-whisper with CUDA fallback)
- Streaming LLM rewrite with SSE

### Planned (PLANNING status)
- Speaker diarization (phases 1-6 in `implementation-plan-v0.2.md`)
- Multi-speaker attribution
- Speaker profile UI

## Latest Research (2026)

### VAD
- **LibriVAD** (arXiv:2512.17281): ViT + MFCC outperforms BDNN/ConvLSTM on OOD data
- **Silero VAD v5**: 3x faster, 6000+ languages, 2MB, <1ms/chunk on CPU
- **ResNet-LSTM hybrid**: Spectro-temporal domain with sparsity reduction (Springer 2025)
- **Sony hybrid VAD**: Classical features + light ML match deep learning

### ASR
- **whisper.cpp 1.8.3**: 12x speedup on iGPU via Vulkan, OpenVINO support
- **faster-whisper 1.1.0**: 4x faster batched inference, 3x faster VAD filter
- **Whisper large-v3-turbo**: 32→4 decoder layers, ~5x faster, minor quality loss
- **NVIDIA Nemotron**: Cache-aware streaming, 3x efficiency over buffered inference
- **Speech ReaLLM**: Decoder-only ASR with RNN-T for real-time streaming
- **Parakeet-TDT-0.6B-v3 / Canary-1B-v2 report** (arXiv:2509.14128): 25 EU languages, beats Whisper-large-v3 on English at ~10x speed
- **Whisper-turbo caveat**: no paper, release-discussion only; translation degraded

### LLM Cleanup (generative error correction)

- **ClozeGER** (Findings of ACL 2024): cloze-test over N-best disagreements beats full-sentence rewriting — don't regenerate, select
- **Uncertainty-gated correction** (Pu et al. 2023): only correct low-confidence utterances; unconstrained rewriting over-corrects clean transcripts
- **RLLM-CF** (accepted ASRU): pre-detection + verification without fine-tuning or N-best — closest to our 1-best setup
- **Key gap for us**: every paper agrees N-best input beats 1-best; we pass 1-best only — check what sherpa-onnx exposes

### Diarization
- **pyannote 4.0**: Community-1 model, self-hosted option
- **ECAPA-TDNN + Mamba (MASV)**: Global+local context for speaker verification
- **TS-VAD+**: Transformer + ECAPA-TDNN + WavLM for overlapping speech

### Noise Estimation
- **IMCRA** (Cohen 2003): Still state-of-the-art for non-stationary noise
- **Stochastic volatility models**: Heavy-tailed distribution modeling for STFT coefficients

## Key Papers

| Paper | DOI | Year | Relevance |
|---|---|---|---|
| Cohen, "IMCRA" | 10.1109/TSA.2003.811544 | 2003 | Core noise estimation |
| Radford et al., "Whisper" | arXiv:2212.04356 | 2022 | ASR architecture |
| Desplanques et al., "ECAPA-TDNN" | Interspeech 2020 | 2020 | Speaker embeddings |
| Xu et al., "TDT" | PMLR v202 (ICML) | 2023 | Why Parakeet is fast |
| Hu et al., "ClozeGER" | Findings of ACL 2024 | 2024 | How to prompt the cleanup pass |
| Silero Team, "Silero VAD v5" | GitHub | 2024 | Streaming VAD |
| Stylianou et al., "LibriVAD" | arXiv:2512.17281 | 2025 | VAD benchmarking |
