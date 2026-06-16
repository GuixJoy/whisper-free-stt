# Voice Processing Algorithms Documentation

Comprehensive, verified reference for voice activity detection (VAD), automatic speech 
recognition (ASR), noise estimation, and adaptive audio processing.

All algorithms verified against actual paper formulas, source code, and library implementations.

## Directory Structure

```
voice-algorithms/
├── README.md                         ← You are here
│
├── vad/
│   └── vad-algorithms.md             ← VAD: energy, WebRTC (source-verified), Silero, DL
│
├── asr/
│   └── asr-systems.md                ← ASR: Whisper, wav2vec2, RNN-T, Vosk, pre-processing
│
├── noise-estimation/
│   └── noise-algorithms.md           ← Martin 2001, EM 1984, MCRA, IMCRA, Wiener
│
├── dsp-features/
│   └── feature-formulas.md           ← RMS, ZCR, centroid, flux, BER, MFCC, flatness
│
├── production-systems/
│   └── production-architecture.md    ← AGC, endpointing, memory, latency, WebRTC APM
│
├── papers/
│   └── citations.md                  ← 48 citations with DOIs, verified URLs, licenses
│
└── adaptive-vad/
    ├── universal-algorithm.md        ← Algorithm documentation
    ├── universal_vad.py              ← Importable Python module (~300 lines)
    ├── test_universal_vad.py         ← 11 unit tests
    └── benchmark_universal_vad.py    ← Performance benchmarks
```

## Quick Reference: Key Algorithms

| Problem | Algorithm | Paper / Source | Verified |
|---------|-----------|---------------|----------|
| Noise estimation | IMCRA | Cohen 2003 [DOI:10.1109/TSA.2003.811544] | ✅ Source code |
| SNR estimation | Decision-Directed | Ephraim & Malah 1984 [DOI:10.1109/TASSP.1984.1164453] | ✅ Paper Eq. 10 |
| Noise tracking | Minimum Statistics | Martin 2001 [DOI:10.1109/89.928915] | ✅ Paper Eq. 6,20,23 |
| VAD (neural) | Silero VAD v5 | snakers4/silero-vad (MIT) | ✅ repo license |
| VAD (classical) | WebRTC GMM | Google WebRTC | ✅ Source code |
| ASR (streaming) | RNN-T | Graves 2012 | ✅ Paper |
| ASR (batch) | Whisper | Radford et al. 2023 | ✅ Paper/code |
| ASR (self-supervised) | wav2vec 2.0 | Baevski et al. 2020 | ✅ Paper |
| Speech enhancement | MMSE-STSA | Ephraim & Malah 1984 | ✅ Paper Eq. 13 |
| Spectral subtraction | Over-subtraction | Berouti 1979 | ✅ Paper |

## 24-Hour Adaptive Operation

The core problem: noise floor drifts from 0.007 to 0.05+ over hours.

**Sold solution:** `adaptive-vad/universal_vad.py` — combines IMCRA + dual-EMA + 
hysteresis VAD + adaptive AGC. Passes 11 unit tests including 24hr simulation.

## Contributing

When adding to this documentation:
1. Verify all formulas against actual paper/library source code
2. Include DOIs for all paper citations
3. Note the license for all code repositories
4. Include working Python implementations that can be tested
