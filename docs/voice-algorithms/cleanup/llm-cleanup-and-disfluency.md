# LLM Cleanup & Disfluency: Evidence for Post-Processing ASR Transcripts

Scope: Floure's cleanup pass (mic → Silero VAD → ASR → **LLM cleanup** → typed output).
Companion docs: `../vad/vad-algorithms.md`, `../asr/asr-systems.md`, `../papers/citations.md`.

Every claim below was verified against a fetched primary source (paper PDF/arXiv page,
first-party repo file, or official catalog page). Claims we could not verify are marked
**[unverified — dropped]** or omitted entirely.

---

## 1. Disfluency: Taxonomy and Measured Rates

### 1.1 Taxonomy (Shriberg, ICSLP-96 "Disfluencies in Switchboard", Table 2 — verified from fetched PDF)

The standard classification used by Switchboard/CallHome-style annotations. The
**interruption point** (`.`) splits the utterance; words before it that must be deleted to
recover the fluent sentence are the **edited words** (reparandum):

| Class | Example |
|---|---|
| filled pause (um/uh) | `she . uh liked it` |
| repetition | `she . she liked it` |
| substitution (repair) | `she . he liked it` |
| insertion | `she liked . really liked it` |
| deletion (abandonment) | `it was very . she liked it` |
| speech error / cut-off word | `shle . she liked it` |

Shriberg (ICPhS-14, 1999, verified) summarizes the structure: *"Most disfluencies can be
analyzed as a **three-region structure**, in which the first two regions are removed to
yield a fluent version of the utterance"* (reparandum – interregnum – repair). That paper
also states plainly: *"Disfluencies are rare in **laboratory speech**, but occur with
considerable frequency in everyday communication."*

### 1.2 Measured rates

| Corpus / style | Rate (disfluencies per word) | Source (fetched) |
|---|---|---|
| Switchboard — free human-human phone conversation | **5.53%** (param `b=.0553`, 1−b) | Shriberg, ICSLP-96, §3.1 (SRI PDF) |
| AMEX — goal-oriented human-human phone calls | **5.47%** | same |
| ATIS — human-computer dialog (read-like task speech) | **0.78%** | same |
| Range across spontaneous English | "under 1% for constrained human-computer dialog, to **5–10%** for natural conversations" | Shriberg, ICPhS-14 1999, p.1 (SRI PDF) |
| Task-oriented conversation, overall | **5.97 disfluencies per 100 words** (fillers + repeats + restarts) | Bortfeld et al. 2001, §3.2, **DOI 10.1177/00238309010440020101** (PDF fetched) |

Bortfeld et al. (2001) further break it down (all per 100 words, fetched PDF):
- **Fillers ~2–3** (3.04 for men vs 2.07 for women), restarts ~1.9–2.0, repeats ~1.2–1.7.
- Age: older 6.65, middle-aged 5.69, young 5.55 — demographic effects are small.
- **Planning demand dominates demographics**: rates rise when the speaker bears the task
  ("director" role) and when the topic is harder — disfluency tracks cognitive load, not
  speaker identity.

**Consequence for dictation:** there is no "dictate-while-thinking" corpus with published
disfluency rates in anything we fetched. The two measured poles are human-computer task
speech (~0.8%/word, ATIS) and free conversation (~5.5%/word, Switchboard); thinking-aloud
dictation has no listener to coordinate with (the ATIS factor that *lowers* rate) but high
planning demand (the Bortfeld factor that *raises* it). Planning for **~1–6% of words being
disfluent** spans the evidence.

### 1.3 The transcripts that define "ground truth"

Switchboard-1 Release 2 (LDC97S62, verified from LDC catalog page): ~260 hours, ~2,400
two-sided telephone conversations, 543 speakers, 8 kHz telephony, DOI
10.35111/sw3h-rw02. Its reference transcripts *contain* the disfluencies — they are not
edited out. Same for the official Whisper evaluation: see §3.5 — OpenAI's own English
normalizer **strips `um/uh/hmm` from both hypothesis and reference before computing WER**,
which means fillers are, by construction, not what WER measures.

---

## 2. Mumbled / Low-Articulation Speech and ASR

### 2.1 "Mumbling" (reduced articulatory precision) in normal speakers is common and hard to detect

Ward & Ortega, arXiv:2405.01376 (fetched abs + tech-report PDF, cs.utep.edu):
- Reduced articulation in everyday dialog is annotated on a 4-point scale
  (`0=enunciated, 1=normal, 2=reduced, 3=highly reduced`), criterion: *"subjective
  judgments of being poorly articulated or possibly hard to understand without context."*
- In 3,051 annotated dialog regions: **35% enunciated, 38% normal, 21% reduced, 6% highly
  reduced → ~27% of ordinary dialog is reduced or worse.**
- **No working detector exists**: *"there currently exist no generally usable methods for
  estimating the phrase-level degree of reduction"*; their best model (linear regression on
  prosodic features) correlates only **0.24 (EN) / 0.17 (ES)** with human judgments, and the
  second human annotator only reaches r=0.57 — *"we were unable to create a working
  reduction detector."*
- Correlates of reduction **in dialog differ from read speech** (high pitch, wide pitch
  range, intensity — not the low-energy profile read-speech studies report).

**Consequence:** we cannot gate on "is this mumbled?" — nobody can, cheaply. The acoustic
mismatch has to be handled upstream (ASR robustness, VAD, hotwords) or the risk managed
downstream (conservative cleanup), not detected by a reduction classifier.

### 2.2 What degradation actually looks like

Whispered speech (the most-studied extreme of low-articulation speech, no glottal source):

| Condition | WER | Source (fetched) |
|---|---|---|
| Whisper large-v2, CHAINS **normal** speech | 16.69% | Farhadipour et al., arXiv:2407.21211, Table II |
| Whisper large-v2, CHAINS **whispered** (identical texts) | **18.80%** | same |
| Fine-tuned WavLM on whispered speech | 9.22% | same |
| E2E trained on normal speech, tested on wTIMIT whispered | **WER >100%** (101.9% conformer) | Lin/Patel/Scharenborg, arXiv:2311.05179, Table 1 |
| Same model + matched data | 44.4% → 36.3% (best) | same |
| Normal-trained E2E: normal vs whispered (PER) | 29.7 vs **59.5** | Chang et al., arXiv:2005.01972, Table 2 |

Mumbling proper (clinical, but the phenomenon is described in mumble terms) — EasyCall
Corpus (Turrisi et al., Interspeech 2021, fetched ISCA PDF):
- Commercial ASR on healthy controls: **6.55% WER**; on dysarthric speakers: **61.90%**.
- The paper explains the >100% per-speaker cases directly: *"due to the speakers'
  **mumbling that the ASR system attempts to recognize as a sequence of words**"* — i.e.
  garbage-in yields **insertion-heavy, fluent-looking nonsense**, not an error signal.

Low SNR / quiet dictation — Whisper's own study (Radford et al., arXiv:2212.04356 §3.7,
fetched): with white/pub noise added to LibriSpeech, *all* comparison models degrade as SNR
falls; Whisper is the most robust below 10 dB pub-noise SNR, but its own WER still rises
monotonically with noise intensity. **No ASR is level-invariant; being quiet lowers the
effective SNR of the whole pipeline.**

### 2.3 Datasets/benchmarks that exist (verified via fetched papers)

- **wTIMIT** — Whispered TIMIT: 450 phonetically balanced sentences, parallel
  normal/whispered, 28 US + 20 Singaporean English speakers (described in arXiv:2311.05179,
  fetched). Note: *not* the same as LDC's WTIMIT 1.0 (which is wideband-mobile telephony).
- **CHAINS** — Irish corpus with whispered + normal speech, 36 speakers (arXiv:2407.21211).
- **DRAL + reduction annotations** — 25–31 min/dialog EN & ES with word-level 4-level
  reduction labels, downloadable from cs.utep.edu/nigel/reduction (arXiv:2405.01376).
- **EasyCall / TORGO / UASpeech** — dysarthric (incl. mumbled) speech (EasyCall PDF fetched).
- **Switchboard / CallHome** — the disfluent conversational corpora (LDC97S62 page fetched).

**[Finding of our own search, honestly scoped]:** we found **no public benchmark of mumbled
healthy-speaker dictation** (the exact Floure input) in the sources fetched. Everything
above is adjacent: whisper, clinical dysarthria, or conversational telephone speech.

---

## 3. LLM Post-Processing of ASR Transcripts: What Works vs What Regresses

### 3.1 The Idiap result this repo cites (re-verified from the primary PDF)

Naderi et al., Interspeech 2024 (Idiap, fetched PDF), LibriSpeech **test-clean**, GPT
correction **with confidence-based gating** (only utterances containing words below a 0.7
confidence threshold are sent to the LLM; 86.6% / 64.3% / 53.0% of utterances pass for
Tiny/Medium/Large):

| Whisper model | ASR baseline | → GPT-3.5 | → GPT-4 |
|---|---|---|---|
| Tiny | 8.13 | 6.55 | **5.65** (helps) |
| Medium | 4.27 | 3.42 | 3.54 |
| Large-v3 | 2.78 | 2.86 | **3.21** (regresses) |

Sentence-level gating (threshold 0.95) shows the same shape: Large-v3 2.78 → 2.83 / 3.13.
The paper's own conclusion: *"this can improve the performance of **less competitive** ASR
systems."* Their error analysis also shows a correction *introducing* an error
(`anxious` → `anxiously`, example 3, fetched PDF §4.4).

**Even gated, even with GPT-4, correcting a strong model's output makes it worse.**

### 3.2 Unconstrained vs constrained rewriting (Ma et al., arXiv:2307.04172 — PDF fetched)

- Unconstrained correction from the **top-1 hypothesis only "may degrade performance"**
  (§3.1): with no N-best evidence the LLM "makes many unnecessary changes to the input to
  make the sentence more reasonable."
- On **Whisper outputs** ChatGPT underperforms: *"many more deletion errors than in the
  baseline"*, and human eval found **14 sentences truncated** (only the first few words
  returned) — truncation becomes deletions in WER.
- ChatGPT *"tends to remove redundant spoken words from the given ASR hypothesis to make
  the transcription more fluent"* — fluency-driven deletion, the core over-correction.
- Their case analysis: legitimate disfluency/words (`that`, `you know`) *"incorrectly
  removed or introduced"*.
- **Constrained** variants (select/closest among N-best) cut deletions without raising
  substitutions — restriction, not model scale, is what makes it safe.
- Also relevant: Whisper itself already does cleanup natively — *"Whisper learns to
  generate sentences with inverse text normalisation … capitalisation added, punctuation
  included, and disfluencies removed"* (§4). CTC/TDT-style models (Parakeet) don't.

### 3.3 Gated, rule-constrained correction DOES work (Pu et al., arXiv:2310.11532 — HTML fetched)

- LLM-only stage **downgrades LibriSpeech**: *"corrections of ChatGPT can produce
  undesired changes … steer sentences more towards written language … unexpectedly
  corrected grammar errors but hindered the speech fidelity, raising the WER."*
- Fix = uncertainty gate (send only N-best-disagreeing utterances) + explicit rules:
  *no added/deleted words, same word count as input, **only words from the N-best list**
  (else "LLMs may use synonyms"), output only one sentence.* Result: **10–20% relative WER
  gains** across domains, zero-shot.

### 3.4 Direct prompting hallucinates; verification fixes it (Fang et al., arXiv:2505.24347 — HTML fetched)

- *"general LLMs often generate hallucinations, **producing more errors than corrections**"*
  with simple prompts (their Table I).
- Their staged fix — (1) error pre-detection (*if no error detected, keep the sentence
  verbatim*), (2) decomposed correction, (3) answer verification — yields 9% / 11.4%
  relative WER reductions (LibriSpeech clean/other) with GPT-4o.
- Cited within: Min & Wang found direct LLM integration *"inadvertently introduce
  hallucination errors by fabricating content absent from the original audio."*

Udagawa et al., EMNLP 2024 Industry (arXiv:2407.13300, fetched abstract): noisy EC training
pairs *"induce overcorrection in out-of-domain settings"*; their **conservative data
filtering** trains the model to **copy the input when the correction isn't inferable from
the context** — explicitly teaching "when unsure, do nothing" — and reduces OOD
overcorrection on 21 internal benchmarks.

### 3.5 Filler removal: deterministic, and officially WER-neutral

OpenAI's official English text normalizer (whisper/normalizers/english.py, fetched raw):

```python
class EnglishTextNormalizer:
    def __init__(self):
        self.ignore_patterns = r"\b(hmm|mm|mhm|mmm|uh|um)\b"
        ...
        s = re.sub(r"[<\[][^>\]]*[>\]]", "", s)   # remove bracketed material
        s = re.sub(r"\(([^)]+?)\)", "", s)        # remove parenthesized material
        s = re.sub(self.ignore_patterns, "", s)   # strip fillers
```

The Whisper paper (§3.2/4.4, fetched) says the normalizer was built so *"naive WER"* stops
penalizing *"innocuous differences"*, drops measured WER by up to 50% on some datasets, and
cautions about overfitting to Whisper's transcription style.

Two hard implications for Floure:
1. **Filler stripping is a solved, zero-risk, zero-cost regex** — the exact token set the
   official evaluator ignores is five patterns. Spending a 128-token LLM budget to delete
   `um` buys nothing measurable and risks deleting real words (§3.2).
2. Under official scoring, fillers are not errors at all. LLM filler removal is a **UX**
   feature, not a WER feature — which is a legitimate goal, just not an LLM-shaped one.

### 3.6 Whisper hallucination on degraded input (first-party repo — all fetched)

- **Discussion #29** (maintainer `jongwook`): long non-speech gaps cause repetition loops;
  *"`no_speech_prob` is often not a reliable predictor of voice activity"*; feeding the
  previous window's text as prompt *"makes the decoding more prone to repetition looping."*
  The community fix in the same thread: segment with **Silero VAD before Whisper**.
- **Discussion #1606** (mic streaming every 5 s): silence/no-speech chunks generate random
  text; a user added the prompt *"do not make up words to fill in the rest of the
  sentence"* — *it returns the prompt back as output*. **Prompting does not suppress
  hallucination; VAD gating does.**
- **Discussion #2608**: 30 s of digital silence deterministically transcribes as one fixed
  phrase (`ترجمة نانسي قنقر`) in Arabic large-v3; German `"Untertitelung des ZDF für funk,
  2017."`; English applause/"like and subscribe" endings — training-data priors on
  subtitle-credit silence. Workaround stated in-thread: VAD to remove silence.

The mechanism generalizes: **when the acoustics carry no signal, the decoder emits its
highest-prior text.** A post-hoc LLM sees only text, so it inherits fabricated content and
— per §3.3/§3.4 — will happily "clean" it into *better-looking* fabricated content.

---

## 4. Failure Modes of Cleanup on Mumbled Input

Each row: failure → verified evidence → why mumbled input makes it worse.

| # | Failure mode | Evidence (fetched) | Amplifier on mumbled input |
|---|---|---|---|
| F1 | **Truncation → deletions**: LLM returns a shortened transcript | Ma 2023: 14 truncated sentences; deletion↑ on Whisper outputs (PDF §4.3) | Garbage in → longer, rambling input → more likely to blow the completion budget (§5.3) |
| F2 | **Fluency-driven rewriting of correct text** | Pu 2023: LLM-only stage *raises* WER by steering to written language (HTML) | Mumbled speech has *more* disfluencies the model wants to "fix" — including words that were actually said |
| F3 | **Fabrication when input is near-garbage** | Fang 2025: simple prompting gives "more errors than corrections"; Min & Wang cited: fabricating content absent from audio (HTML) | Mumbling → EasyCall-style fluent nonsense ASR output ("mumbling … recognized as a sequence of words") → LLM confidently normalizes it |
| F4 | **Technical/rare term corruption or deletion** | DeRAGEC (ACL Findings 2025, fetched): GEC/LLM correctors *"favor high-frequency words"*; rare/OOV named entities are systematically hardest to recover | Truncated/slurred technical words look *more* like common words (`kubernetes` → `kubernetes? no → sidecar`) |
| F5 | **Lost speaker intent** | Pu 2023: "unexpectedly corrected grammar … hindered speech fidelity"; Ma 2023: `that`, `you know` removed or invented | Hesitation and repair *carry* meaning in thinking-out-loud speech (Bortfeld: fillers track planning load); deleting them erases "I'm not sure yet" vs committed assertion |
| F6 | **Hallucination laundering**: ASR repetition-loop/silence output gets "repaired" into fluent prose | Whisper discussions #29/#1606/#2608 (fetched); gate triggers on repeated bigrams are exactly this signature | Mumbled trailing-off → VAD-adjacent silence → Whisper loop → LLM completes the loop into a plausible sentence |
| F7 | **Silent gate misses**: mumbled garbage often has *no* fillers, no repeated bigrams, no gaps — a fluent-looking wrong transcript is skipped | Gate behavior (app context); gate signals provenance from Shriberg/Bortfeld regularities, not from ASR confidence (Idiap gates on confidence) | The cleanest-looking transcript can be the most wrong; surface heuristics can't see it |

---

## 5. Recommendations for Floure (each tied to cited evidence)

### 5.1 Do filler removal deterministically, before/regardless of the LLM

Strip `hmm|mm|mhm|mmm|uh|um` (plus bracketed ASR artifacts) with a regex identical in
spirit to OpenAI's official normalizer (§3.5, raw file fetched). Why: it's the exact token
set official WER ignores (so it's free), it's the bulk of what the current prompt asks the
LLM to do, and LLMs performing the same task have a measured tendency to delete *neighboring
real words* along with fillers (Ma 2023: `that`/`you know` removed, §3.2).

### 5.2 Rework the gate: send *evidence of ASR error*, not *evidence of disfluency*

Current gate sends transcripts with fillers/repeated bigrams/timestamp gaps and skips clean
ones. Problems, by evidence:

1. **Fillers present ≠ ASR error.** Fillers are regular, expected content (Shriberg 1996;
   Bortfeld 2001) and are officially ignored at eval time (whisper normalizer). Sending
   filler-bearing transcripts to the LLM = running correction on *faithful* transcripts —
   the exact regime where Idiap measures regression (Large-v3 2.78→3.21 even gated) and Pu
   measures WER *increases*. → Handle fillers by regex (5.1); don't count them as a gate
   trigger.
2. **Repeated bigrams = hallucination signature, not cleanup work.** That's the Whisper
   repetition-loop failure (#29, maintainer-verified: previous-text conditioning causes
   loops). LLM-cleaning a loop fabricates a plausible ending (F3/F6). → Re-decode the audio
   instead (`condition_on_previous_text=False` for Whisper, per #29) or drop the segment;
   never ask the LLM to repair a loop.
3. **Gate on real confidence when it exists.** Idiap and Pu both gate on ASR-side
   confidence (word-level logprob / N-best disagreement) and get 10–20% relative gains
   doing so. Floure already has `modified_beam_search` + hotwords; beam scores are the
   gate signal this literature uses (see `../papers/citations.md` #75, #71, #79 — greedy
   scores are the weak kind, acceptable for skip/keep only). → When beam decode is on,
   threshold on it; keep surface heuristics as the greedy fallback.
4. **Add an upper "too broken to clean" gate.** Very short transcripts (< ~4 words),
   transcripts dominated by non-dictionary tokens, and empty outputs should be *dropped or
   flagged to the user*, not sent for cleanup — direct-LLM-on-garbage yields "more errors
   than corrections" (Fang 2025), and mumbled garbage is fluent-looking (EasyCall §2.2).
   This also covers silent-mic input (#1606), which should never reach either model.

Net effect: **the LLM sees fewer, better-targeted transcripts** — that is the direction
every verified positive result points (gated > ungated: Idiap, Pu, Fang pre-detect-first).

### 5.3 The 512-token local model: adequate input-side, marginal output-side — fix the arithmetic

Budget trace for `s1-mini-q4_k_m` (512 ctx, 128 completion, 1200-byte clamp), using ~4
chars/token for English:

- 1200 bytes ≈ **300 tokens ≈ 180 words**; narrow prompt ≈ 60–80 tokens.
- Input fits (70 + 300 < 512), but a faithful cleanup output is ≈ input length: ~180 words
  ≈ **~250 tokens out > 128 budget**.
- 128 completion tokens ≈ **~95 words ≈ 500 bytes** of output. The clamp allows ~2.4× more
  transcript than the completion budget can return.
- Result past ~95 words: **truncated output → deletion errors** — precisely Ma et al.'s
  observed failure (14 truncated sentences, deletion↑, §3.2).

Concrete fixes (any one, in order of preference):
1. **Clamp ≈ 512 bytes (~90 words)** for the local path — fits prompt+input+output inside
   512 with margin; longer dictations go out whole or not at all.
2. Or keep 1200 bytes and **raise completion to 256** (70 + 300 + 256 ≈ 626 > 512 ✗ — so
   this only works *with* a smaller clamp; i.e., clamp ≈ 600 bytes + completion 256).
3. **Post-condition check**: if output word count < ~60% of input word count, treat as
   truncation/failure and fall back to input (with regex filler strip applied). Cheap
   guard against F1 with zero paper-side assumptions.

Capability caveat (explicit): every positive result in §3 used commercial LLMs
(GPT-3.5/4/4o). **No fetched source evaluates a quantized ~single-digit-billion local model
for this task** — treat local-model quality as unmeasured; the conservative gate is doing
real work, not decoration. Cloud fallback (`gpt-4o-mini`) inherits every rule below
regardless: Idiap shows a *bigger* model is not automatically safer (§3.1).

### 5.4 Prompt wording: keep it narrow, add explicit conservation rules

Current prompt direction (remove fillers, fix obvious mishears, punctuate, preserve
technical terms, output transcript only) matches Pu et al.'s winning rule set except for
missing constraints. Add, quoting the verified sources' own rules:

- **"Do not add or delete words. The output must contain the same number of words as the
  input, except that the listed filler words may be removed."** (Pu Rule 4 + Rule 5: same
  word count; Ma: deletion is the dominant regression mode.)
- **"If a word looks technical or rare, keep it exactly as given; never replace it with a
  more common word."** (DeRAGEC: LLM correctors favor high-frequency words — and even
  that bias *cannot be fully prompt-fixed*, so pair with ASR hotwords, §5.6.)
- **"If the transcript contains no obvious errors, return it unchanged."**
  (Fang's pre-detection stage: direct correction produces more errors than corrections.)
- Keep **"return only the transcript"** (Pu Rule 8: "output only one modified sentence and
  no explanation").
- "Fix obvious mishears" should be softened to **"fix words that are obvious context-free
  mishearings"** — unconstrained 1-best rewriting is the variant that measured degrades
  (Ma §3.1).

### 5.5 Pre-ASR steps worth having (and one to avoid)

- **Keep Silero VAD ahead of every engine** — the first-party Whisper fix for silence
  hallucination across #29/#1606/#2608 is unanimous (VAD; the anti-hallucination *prompt*
  demonstrably fails). Already in the pipeline; the evidence says don't weaken it.
- **Whisper modes: set `condition_on_previous_text=False`** — maintainer-verified as the
  loop-suppression lever (#29), at the cost of cross-window consistency.
- **Low-level input is a user-facing problem, not a cleanup problem.** Quiet/mumbled audio
  lowers effective SNR; WER rises monotonically as SNR falls (Whisper §3.7), and heavily
  reduced speech produces insertion-heavy nonsense rather than detectable errors (EasyCall).
  A simple RMS/level warning ("that was quiet — lean in") attacks the cause; no fetched
  source supports a cheap "is it mumbled" detector (Ward: r≤0.24, §2.1).
- Hotwords before cleanup, not after: rare-term recall is fixed at decode time via
  constrained/hotword search (`../papers/citations.md` #80–#85), not by asking an LLM to
  reinvent the term (F4).

### 5.6 Eval before trusting any of this

None of the primary literature evaluates LLM cleanup on mumbled dictation (§2.3 — no such
benchmark exists publicly). Ship a tiny in-repo eval: record ~50 deliberately mumbled
dictations with references, run raw vs gated-cleanup, and report WER-style delta per gate
branch — the Idiap protocol (before/after, per model, per gate threshold) is the template.
Until that number exists, the honest default is **the smallest cleanup that provably can't
make things worse** (regex fillers + punctuation-only edits).

---

## 6. Do NOT Do This (the evidence says it regresses)

1. **Don't run unconstrained rewriting on top-1 output from a strong ASR.**
   Idiap: Large-v3 2.78 → 3.21 (GPT-4) / 2.83 → 3.13 even *with* confidence gating; Ma:
   top-1-only unconstrained "may degrade performance" with more deletions. (§3.1, §3.2)
2. **Don't ship cleanup ungated "because the model is good."** The regression *is* the
   strong-model result — gating/copy-when-unsure is what turns the sign of the effect
   positive (Idiap, Pu, Fang, Udagawa). (§3.1–§3.4)
3. **Don't prompt-strike hallucinations.** "Do not make up words" was echoed back as output
   on silent input (#1606); silence→fixed-phrase is deterministic (#2608). Gate audio, not
   text. (§3.6)
4. **Don't send empty, looping, or near-empty transcripts to the LLM for repair.**
   Direct LLM correction on such inputs yields "more errors than corrections" and content
   fabricated from audio that never existed (Fang; Min&Wang as cited there). (§3.4, F6)
5. **Don't ask for grammar, style, register, or "make it read well" improvements.**
   Pu: grammar-fixing raised WER by steering to written language; fidelity is the metric.
   (§3.3, F2/F5)
6. **Don't rely on the prompt to protect technical terms.** Frequency bias toward common
   words is intrinsic to these models (DeRAGEC); protect terms at decode (hotwords/beam),
   verify them after (F4).
7. **Don't LLM-remove fillers.** Five regexes match OpenAI's official normalizer; official
   WER ignores those tokens anyway; the LLM variant deletes real words too (Ma). (§3.5)
8. **Don't feed previous-window text forward in Whisper modes** (#29: "more prone to
   repetition looping"), and don't treat the repeated-bigram gate trigger as cleanup work —
   re-decode instead.
9. **Don't assume the cloud fallback changes any of the above.** Bigger model, same failure
   modes: Idiap's regression came from GPT-4. (§3.1)

---

## References (all fetched for this document)

1. Shriberg, E. (1996). "Disfluencies in Switchboard." Proc. ICSLP-96, Philadelphia, Vol. Addendum, 11–14. https://www.sri.com/wp-content/uploads/2021/12/disfluencies_in_switchboard.pdf
2. Shriberg, E. E. (1999). "Phonetic consequences of speech disfluency." ICPhS-14, San Francisco, 619–622. https://www.internationalphoneticassociation.org/icphs-proceedings/ICPhS1999/p14_0619.html · PDF: https://www.sri.com/wp-content/uploads/2021/12/phonetic_consequences_of_speech_disfluency.pdf
3. Bortfeld, H., Leon, S. D., Bloom, J. E., Schober, M. F., Brennan, S. E. (2001). "Disfluency rates in conversation." Language and Speech 44(2), 123–147. **DOI:** 10.1177/00238309010440020101 · PDF: https://psychology.psy.sunysb.edu/sbrennan-/papers/bortetal.pdf
4. Ward, N. G., Ortega, C. A. (2024). "Topics in the Study of the Pragmatic Functions of Phonetic Reduction in Dialog." https://arxiv.org/abs/2405.01376 · Tech report: https://www.cs.utep.edu/nigel/reduction/techreport.pdf
5. Godfrey, J. J., Holliman, E. — Switchboard-1 Release 2, LDC97S62. https://catalog.ldc.upenn.edu/LDC97S62 (DOI 10.35111/sw3h-rw02)
6. Turrisi, M. et al. (2021). "EasyCall Corpus: A Dysarthric Speech Dataset." Interspeech 2021. https://www.isca-archive.org/interspeech_2021/turrisi21_interspeech.pdf
7. Lin, Z., Patel, T., Scharenborg, O. (2023). "Improving Whispered Speech Recognition Performance using Pseudo-whispered based Data Augmentation." ASRU 2023. https://arxiv.org/abs/2311.05179 (DOI 10.1109/ASRU57964.2023.10389801)
8. Chang, H.-J., Liu, A. H., Lee, H.-y., Lee, L. (2020). "End-to-end Whispered Speech Recognition with Frequency-weighted Approaches and Pseudo Whisper Pre-training." SLT 2021. https://arxiv.org/abs/2005.01972
9. Farhadipour, A., Asadi, H., Dellwo, V. (2024). "Leveraging Self-Supervised Models for Automatic Whispered Speech Recognition." ICCKE 2024. https://arxiv.org/abs/2407.21211
10. Naderi, M., Hermann, E., Nanchen, A., Hovsepyan, S., Magimai.-Doss, M. (2024). "Towards interfacing large language models with ASR systems using confidence measures and prompting." Interspeech 2024. https://publications.idiap.ch/attachments/papers/2024/Naderi_INTERSPEECH_2024.pdf (also citations.md #75)
11. Ma, R., Qian, M., Manakul, P., Gales, M., Knill, K. (2023). "Can Generative Large Language Models Perform ASR Error Correction?" https://arxiv.org/abs/2307.04172 · PDF fetched (also citations.md #69)
12. Pu, T., Nguyen, H., Stüker, S. (2023). "Multi-stage Large Language Model Correction for Speech Recognition." https://arxiv.org/abs/2310.11532 (also citations.md #71)
13. Fang, Y. et al. (2025). "Fewer Hallucinations, More Verification: A Three-Stage LLM-Based Framework for ASR Error Correction." ASRU. https://arxiv.org/abs/2505.24347 (also citations.md #74)
14. Udagawa, T., Suzuki, M., Muraoka, M., Kurata, G. (2024). "Robust ASR Error Correction with Conservative Data Filtering." EMNLP 2024 Industry. https://arxiv.org/abs/2407.13300
15. Im, S., Lee, W., An, J., Kim, Y., Ok, J., Lee, G. (2025). "DeRAGEC: Denoising Named Entity Candidates with Synthetic Rationale for ASR Error Correction." Findings of ACL 2025. https://aclanthology.org/2025.findings-acl.786/ (DOI 10.18653/v1/2025.findings-acl.786)
16. Radford, A. et al. (2022/2023). "Robust Speech Recognition via Large-Scale Weak Supervision." §3.7 noise robustness, §3.2/4.4 text normalization. https://arxiv.org/pdf/2212.04356
17. OpenAI Whisper — English text normalizer (filler stripping): https://raw.githubusercontent.com/openai/whisper/main/whisper/normalizers/english.py
18. OpenAI Whisper — Discussion #29 (repetition loops; maintainer answer): https://github.com/openai/whisper/discussions/29
19. OpenAI Whisper — Discussion #1606 (hallucination on no-speech audio): https://github.com/openai/whisper/discussions/1606
20. OpenAI Whisper — Discussion #2608 (deterministic silence hallucination): https://github.com/openai/whisper/discussions/2608
