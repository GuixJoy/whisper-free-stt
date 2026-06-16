# ASR Systems: Algorithms, Architectures & Pre-processing

## 1. OpenAI Whisper

**Paper:** Radford et al., "Robust Speech Recognition via Large-Scale Weak Supervision" (2023)
**URL (verified):** https://cdn.openai.com/papers/whisper.pdf
**Code (verified):** https://github.com/openai/whisper (Apache 2.0)

### Architecture
Encoder-decoder Transformer (seq2seq) trained on 680,000 hours of weakly-supervised web audio across 96+ languages.

### Input Pipeline (30-second chunks, verified from whisper/audio.py)
1. Audio resampled to **16 kHz mono** using `torchaudio` or `soundfile`
2. **80-channel log-Mel spectrogram**: 25ms Hamming windows, 10ms hop stride
3. Two **1D convolution layers** (conv stem):
   - Conv1D: in=80, out=128, kernel=3, stride=1, padding=1
   - Conv1D: in=128, out=256, kernel=3, stride=2, padding=1  ← **stride=2 downsamples time by 2x**
   - Both with GELU activation
4. **Sinusoidal positional embeddings** added to encoder input
5. Stack of **Transformer encoder blocks** (self-attention + FFN)

### Decoder
Autoregressive Transformer with **cross-attention** to encoder output.
Special tokens: `<|startoftranscript|>`, language code, `<|transcribe|>`/`<|translate|>`, timestamps.

### Verified Model Sizes (from whisper/model.py)
| Model | Parameters | Encoder Layers | Decoder Layers | Embed dim | Heads |
|-------|-----------|---------------|---------------|-----------|-------|
| tiny | 39M | 4 | 4 | 384 | 6 |
| base | 74M | 6 | 6 | 512 | 8 |
| small | 244M | 12 | 12 | 768 | 12 |
| medium | 769M | 24 | 24 | 1024 | 16 |
| large-v3 | 1.55B | 32 | 32 | 1280 | 20 |
| large-v3-turbo | 809M | 32 | 32 | 1280 | 20 |

### Noise Robustness
Training on 680K hours of noisy web data makes Whisper inherently noise-robust. No explicit noise adaptation needed.

---

## 2. Meta wav2vec 2.0

**Paper:** Baevski et al., "wav2vec 2.0: A Framework for Self-Supervised Learning of Speech Representations" (NeurIPS 2020)
**arXiv (verified):** https://arxiv.org/abs/2006.11477
**Code (verified):** https://github.com/facebookresearch/wav2vec2

### Architecture (4 components, verified from paper)
1. **Feature Encoder** — 7-layer 1D CNN, 512 channels, kernel strides (5,2,2,2,2,2,2). Total receptive field = 400 samples = 25ms at 16kHz. Outputs one feature vector per 20ms (conv stride).
2. **Context Network** — Transformer encoder with **relative positional embedding** (not absolute positional encoding). BASE: 95M params (12 layers, 768 embed, 8 heads), LARGE: 317M params (24 layers, 1024 embed, 16 heads)
3. **Quantization Module** — Gumbel-Softmax sampling (τ=1 → 0.5) from 2 codebooks of 320 entries each. Codebook dim = 256 combined.
4. **Contrastive Loss** — BERT-style masking: mask 7% of time steps, replace with learned mask embedding. Predict quantized target from masked context.

### Two-phase Training
- **Phase 1:** Pre-train on unlabeled audio (LibriVox 960h or 53K hours)
- **Phase 2:** Fine-tune with CTC loss on labeled data

### Verified Results
- With **10 minutes** labeled + 53K hours unlabeled → WER 5.2/8.6 (LibriSpeech clean/other)
- With **1 hour** labeled → WER 4.0/6.0
- With **960 hours** labeled (supervised only) → WER 3.0/5.0

---

## 3. Google RNN-T

**Original paper:** A. Graves, "Sequence Transduction with Recurrent Neural Networks" (2012)
**arXiv:** https://arxiv.org/abs/1211.3711
**Streaming paper:** "Streaming End-to-end Speech Recognition for Mobile Devices" (ICASSP 2019)
**arXiv:** https://arxiv.org/abs/1811.06621

### Architecture (3 networks)
1. **Encoder (Acoustic Model):** LSTM/Transformer processes audio features → `f_t`
2. **Prediction Network:** LSTM/embedding encodes previous text tokens `y_{u-1}` → `g_u`
3. **Joint Network:** `z = f_t + g_u` (add) → feed-forward + softmax → `P(k | t, u)`

### RNN-T Loss
- Marginalizes all possible alignments between `t` (frames) and `u` (output tokens)
- Unlike CTC: outputs are NOT conditionally independent (prediction network models label dependencies)
- The blank symbol (∅) advances frame index `t`; non-blank symbols advance both `t` and `u`

### Beam Search Decoding
- Standard beam search over the alignment lattice
- At each step: emit a non-blank symbol or blank (advance time)

### Transformer Transducer (T-T, Jia et al. 2020)
Replaces LSTM encoder with Transformer encoder. Chunk-wise causal attention for streaming. arXiv:2002.02562

---

## 4. NVIDIA NeMo

**Code (verified):** https://github.com/NVIDIA/NeMo (Apache 2.0)
**Docs:** https://docs.nvidia.com/nemo-framework/

### Verified Model Families
| Model | Decoder | Parameters | Key Feature |
|-------|---------|------------|-------------|
| Parakeet-TDT | Token-and-Duration Transducer | 1.1B | Jointly predicts tokens + durations, best on HF leaderboard |
| Conformer-CTC | CTC | 120M→600M | Convolution-augmented Transformer (Gulati et al. 2020) |
| FastConformer | CTC/Transducer | 120M→1B | Linear attention (Performer-style), 2x faster CPU inference |
| Canary | AED | 1B | Multilingual (EN/DE/FR/ES/PT) + translation |

### Conformer Layer (Gulati et al. 2020, arXiv:2005.08100)
```
Input → FFN → Self-Attention → Depthwise Conv → FFN → Output
                                               ↓
                                         LayerNorm + residual
```

### Cache-Aware Streaming (Nemotron 2024)
- Each audio frame encoded ONCE (no sliding window recomputation)
- ~3x more concurrent streams on H100 vs buffered approach
- 4 configurable chunk sizes: ~80ms, 160ms, 560ms, 1.12s
- WER: 7.2%–7.8% across latency settings (no retraining needed)

---

## 5. Vosk (Lightweight Offline ASR)

**Code (verified):** https://github.com/alphacep/vosk-api (Apache 2.0)
**Website:** https://alphacephei.com/vosk

Built on **Kaldi** (C++ toolkit). Key characteristics:
- Models ~50MB per language (from api/README.md)
- 20+ languages supported
- TDNN acoustic model with i-vectors for speaker adaptation
- Streaming API with near-zero latency
- Uses Kaldi's WFST decoding graph: HCLG.fst + trees

### Verified Model Structure
```
am/final.mdl              — Acoustic model (TDNN)
am/global_cmvn.stats      — Online CMVN statistics
conf/mfcc.conf            — MFCC configuration (13 cepstral + deltas)
conf/pitch.conf           — Pitch feature configuration
graph/HCLG.fst            — Weighted Finite State Transducer decoding graph
ivector/final.ie          — i-vector extractor
```

### Usage
```python
import vosk
model = vosk.Model("model-en-us-0.22")
rec = vosk.KaldiRecognizer(model, 16000)
while True:
    data = audio_stream.read(4000)
    if rec.AcceptWaveform(data):
        print(rec.Result())
    else:
        print(rec.PartialResult())
```

---

## 6. Signal Pre-processing Algorithms

### 6.1 Pre-emphasis
```
y[n] = x[n] - α · x[n-1]    (α = 0.97)
```
Compensates for 6dB/octave spectral rolloff of human speech.

### 6.2 Framing & Windowing
- Frame length: 25ms (400 samples at 16kHz)
- Frame shift (hop): 10ms (160 samples at 16kHz)
- Hamming window: `w[n] = 0.54 - 0.46 · cos(2πn/(N-1))`
- Raised cosine reduces spectral leakage in FFT

### 6.3 Short-Time Fourier Transform
```
X(k, m) = Σ_{n=0}^{N-1} x(m·H + n) · w(n) · e^{-j2πkn/N}
```
Where H = hop size (160), N = FFT size (512 typically), k = freq bin, m = frame index.

### 6.4 Mel Filter Bank
```
mel(f) = 2595 · log10(1 + f/700)          (O'Shaughnessy 1987)
mel_inv(m) = 700 · (10^(m/2595) - 1)
```
- Whisper: 80 filters on 0-8kHz range at 16kHz
- Kaldi: 40 filters (0-8kHz) → 13 MFCCs
- Each filter is triangular, equally spaced on mel scale

### 6.5 Log-Mel Spectrogram
```
log_mel(k, m) = log( Σ_{f} |X(f, m)|² · H_k(f) )
```
Where `H_k(f)` is the k-th mel-spaced triangular filter.

### 6.6 MFCC (Davis & Mermelstein 1980)
Apply DCT to log-mel energies (decorrelates features):
```
MFCC(n, m) = Σ_{k=0}^{K-1} log_mel(k, m) · cos(π·n·(k+0.5)/K)
```
- Keep first 13 coefficients
- Add delta + delta-delta for 39-dim feature vector
- Liftering (scaling) applied: weight cepstral coeff n by `1 + L/2 · sin(π·(n+1)/L)`, L=22

### 6.7 CMVN (Cepstral Mean & Variance Normalization)
```
x_norm = (x - μ) / σ
```
Kaldi's online CMVN: sliding window of ~300 frames (3s) computes running mean/variance.
Critical for noise robustness — removes channel effects.

### Verified Feature Extraction Summary
| Feature | Formula | Channels | Used By |
|---------|---------|----------|---------|
| MFCC | DCT(log(mel-power)) | 13-40 | Kaldi, Vosk, CMU Sphinx |
| Log-Mel | log(mel-filtered power) | 80 | Whisper, wav2vec2 |
| Fbanks | mel-filtered power (no DCT) | 40 | SpeechBrain, NeMo |
| Raw PCM | Direct samples | 1 | wav2vec2, HuBERT, WavLM |

---

## 7. Noise Robustness Techniques

### Data Augmentation (most effective per research)
- **SpecAugment:** Mask random time (max 10 frames) and frequency (max 27 bands) in spectrogram
- **Noise mixing:** Add noise at SNRs 0-20dB from MUSAN/DNS Challenge
- **Speed/pitch perturbation:** 0.9x-1.1x speed, ±2 semitones pitch

### Signal-level Enhancement
- **Spectral subtraction:** Remove noise spectral estimate from signal
- **Wiener filtering:** MMSE-optimal gain in freq domain
- **Beamforming:** Delay-and-sum or MVDR for multi-mic arrays

### Feature-level Robustness
- **CMVN:** Remove channel effects (most important single technique per Kaldi docs)
- **i-vectors:** Speaker/channel identity as additional features
- **Attention mechanism:** Self-attention learns speech-relevant time-freq regions

---

## 8. Real-Time Streaming ASR

| System | Approach | Latency | Deployment |
|--------|----------|---------|------------|
| Vosk | Kaldi TDNN + i-vector | <10ms | CPU, offline |
| RNN-T | Encoder per-frame + prediction | 100-300ms | GPU/CPU |
| Whisper-Streaming | Chunked Whisper + causal attention | 1-3s | GPU |
| faster-whisper | CTranslate2 quantized Whisper | 0.1-0.5x RT | GPU/CPU |

### Latency Budget (Voice Agents)
Human conversation threshold: **200-300ms** total pipeline
```
├── Audio capture + preprocessing: ~20ms
├── ASR: 100-500ms (depends on chunk size)
├── LLM: 100-500ms (streaming)
├── TTS: 100-300ms (streaming)
└── Network: ~20-50ms
```

---

## References

1. Radford et al. (2023). "Robust Speech Recognition via Large-Scale Weak Supervision." OpenAI. https://cdn.openai.com/papers/whisper.pdf
2. Baevski et al. (2020). "wav2vec 2.0: Self-Supervised Learning of Speech Representations." NeurIPS. arXiv:2006.11477
3. Graves (2012). "Sequence Transduction with Recurrent Neural Networks." arXiv:1211.3711
4. He et al. (2019). "Streaming End-to-end Speech Recognition for Mobile Devices." ICASSP. arXiv:1811.06621
5. Gulati et al. (2020). "Conformer: Convolution-augmented Transformer." arXiv:2005.08100
6. Davis & Mermelstein (1980). "Comparison of parametric representations for monosyllabic word recognition." IEEE Trans. ASSP.
7. O'Shaughnessy (1987). "Speech Communication: Human and Machine." Addison-Wesley.
8. Park et al. (2019). "SpecAugment: A Simple Data Augmentation Method for Automatic Speech Recognition." Interspeech.
