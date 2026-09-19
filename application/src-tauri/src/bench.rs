//! Tier-1 baseline harness. Ignored by default; needs real models + audio.
//!
//! Run:
//!   BENCH_AUDIO=/home/akshat/practice/stt/benchmark-audio \
//!     cargo test -p stt-ui --lib bench -- --ignored --nocapture
//!
//! Feeds every manifest wav through Parakeet-int8 and Whisper-base, writes
//! per-utterance hypotheses + aggregate WER/latency to
//! `$BENCH_AUDIO/baseline.json`, and smoke-tests `modified_beam_search` +
//! per-stream hotwords on the on-disk Parakeet v2 build (GitHub #2753 says
//! beam may not work on it — this asserts it does before phase 2 is planned
//! around it).

use std::path::PathBuf;
use std::time::Instant;

use crate::config::{AppConfig, AsrProfile};
use crate::parakeet::ParakeetRecognizer;
use crate::whisper::WhisperRecognizer;

fn bench_dir() -> Option<PathBuf> {
    std::env::var_os("BENCH_AUDIO")
        .map(PathBuf::from)
        .filter(|p| p.join("manifest.jsonl").exists())
}

fn normalize(s: &str) -> Vec<String> {
    s.to_lowercase()
        .split_whitespace()
        .map(|w| {
            w.trim_matches(|c: char| !c.is_alphanumeric() && c != '\'')
                .to_string()
        })
        .filter(|w| !w.is_empty())
        .collect()
}

fn edit_distance(a: &[String], b: &[String]) -> usize {
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for (i, x) in a.iter().enumerate() {
        cur[0] = i + 1;
        for (j, y) in b.iter().enumerate() {
            cur[j + 1] = (prev[j] + usize::from(x != y))
                .min(prev[j + 1] + 1)
                .min(cur[j] + 1);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

fn percentile(mut v: Vec<f64>, pct: f64) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[((v.len() as f64 * pct / 100.0) as usize).min(v.len() - 1)]
}

/// Derive the bpe.vocab the Parakeet release doesn't ship (per the upstream
/// node hotwords example: every tokens.txt entry with a uniform score).
fn derive_bpe_vocab(model_dir: &std::path::Path) -> PathBuf {
    let out = std::env::temp_dir().join("floure-bench-bpe.vocab");
    if !out.exists() {
        let tokens = std::fs::read_to_string(model_dir.join("tokens.txt")).unwrap();
        let mut vocab: String = tokens
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| format!("{}\t-1.0", l.split_whitespace().next().unwrap()))
            .collect::<Vec<_>>()
            .join("\n");
        vocab.push('\n');
        std::fs::write(&out, vocab).unwrap();
    }
    out
}

#[test]
#[ignore]
fn bench_baseline() {
    let Some(dir) = bench_dir() else {
        eprintln!("[bench] BENCH_AUDIO missing manifest.jsonl — skipped");
        return;
    };
    let base = AppConfig::default().model_dir;
    let parakeet_dir = AsrProfile::Parakeet.model_dir(&base);
    let whisper_dir = AsrProfile::WhisperBase.model_dir(&base);
    for d in [&parakeet_dir, &whisper_dir] {
        assert!(d.exists(), "[bench] model dir missing: {}", d.display());
    }

    let manifest: Vec<serde_json::Value> = std::fs::read_to_string(dir.join("manifest.jsonl"))
        .unwrap()
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    eprintln!("[bench] {} utterances", manifest.len());

    let parakeet = ParakeetRecognizer::new(&parakeet_dir, 4, false).unwrap();
    let whisper = WhisperRecognizer::new(&whisper_dir, 4, false).unwrap();

    // Spike verification 1: timestamps/durations really populate on greedy TDT.
    let first_wav = dir.join(manifest[0]["wav"].as_str().unwrap());
    let first_wave = sherpa_onnx::Wave::read(first_wav.to_str().unwrap()).unwrap();
    let full = parakeet.transcribe_full(first_wave.samples()).unwrap();
    eprintln!(
        "[bench] sample result: {} tokens, timestamps={}, durations={}",
        full.tokens.len(),
        full.timestamps.as_ref().map(|t| t.len()).unwrap_or(0),
        full.durations.as_ref().map(|t| t.len()).unwrap_or(0)
    );
    assert!(!full.tokens.is_empty());
    assert!(full.timestamps.as_ref().map(|t| !t.is_empty()).unwrap_or(false));

    let mut rows = Vec::new();
    let mut total_audio_s = 0.0;
    for (i, m) in manifest.iter().enumerate() {
        let wav_path = dir.join(m["wav"].as_str().unwrap());
        let wave = sherpa_onnx::Wave::read(wav_path.to_str().unwrap()).unwrap();
        assert_eq!(wave.sample_rate(), 16000);
        let dur_s = wave.samples().len() as f64 / 16000.0;
        total_audio_s += dur_s;
        let reference = normalize(m["text"].as_str().unwrap());

        let t0 = Instant::now();
        let p_text = parakeet.transcribe(wave.samples());
        let p_lat = t0.elapsed().as_secs_f64();
        let p_hyp = normalize(&p_text);

        let t0 = Instant::now();
        let w_text = whisper.transcribe(wave.samples());
        let w_lat = t0.elapsed().as_secs_f64();
        let w_hyp = normalize(&w_text);

        rows.push(serde_json::json!({
            "id": m["id"],
            "duration_s": (dur_s * 100.0).round() / 100.0,
            "ref_words": reference.len(),
            "parakeet": {"text": p_text, "errors": edit_distance(&reference, &p_hyp), "latency_s": (p_lat * 1000.0).round() / 1000.0},
            "whisper": {"text": w_text, "errors": edit_distance(&reference, &w_hyp), "latency_s": (w_lat * 1000.0).round() / 1000.0},
        }));
        if (i + 1) % 20 == 0 {
            eprintln!("[bench] {}/{} …", i + 1, manifest.len());
        }
    }

    let mut out = serde_json::json!({"utterances": rows});
    for (key, prof) in [("parakeet", "parakeet"), ("whisper", "whisper")] {
        let errs: usize = rows.iter().map(|r| r[prof]["errors"].as_u64().unwrap() as usize).sum();
        let words: usize = rows.iter().map(|r| r["ref_words"].as_u64().unwrap() as usize).sum();
        let lats: Vec<f64> = rows
            .iter()
            .map(|r| r[prof]["latency_s"].as_f64().unwrap())
            .collect();
        let total_lat: f64 = lats.iter().sum();
        out[key] = serde_json::json!({
            "n": rows.len(),
            "wer_pct": (errs as f64 * 10000.0 / words as f64).round() / 100.0,
            "errors": errs,
            "words": words,
            "latency_p50_s": (percentile(lats.clone(), 50.0) * 1000.0).round() / 1000.0,
            "latency_p95_s": (percentile(lats.clone(), 95.0) * 1000.0).round() / 1000.0,
            "rtf": (total_lat * 1000.0 / total_audio_s).round() / 1000.0,
        });
    }
    out["audio_min"] = serde_json::json!((total_audio_s / 60.0 * 10.0).round() / 10.0);
    std::fs::write(dir.join("baseline.json"), serde_json::to_string_pretty(&out).unwrap()).unwrap();
    eprintln!(
        "[bench] parakeet WER={}% p50={}s rtf={} | whisper WER={}% p50={}s rtf={}",
        out["parakeet"]["wer_pct"],
        out["parakeet"]["latency_p50_s"],
        out["parakeet"]["rtf"],
        out["whisper"]["wer_pct"],
        out["whisper"]["latency_p50_s"],
        out["whisper"]["rtf"]
    );

    // Spike verification 2: modified_beam_search + hotwords on Parakeet v2-int8.
    let vocab = derive_bpe_vocab(&parakeet_dir);
    let beam = ParakeetRecognizer::new_with_decoding(&parakeet_dir, 4, false, "modified_beam_search", Some(&vocab), 2.0)
        .expect("[bench] beam recognizer creation failed");
    let t0 = Instant::now();
    let plain = beam.transcribe(first_wave.samples());
    let beam_lat = t0.elapsed().as_secs_f64();
    let hot = beam.transcribe_with_hotwords(first_wave.samples(), "KALIKO");
    eprintln!("[bench] beam: plain={:?} hotwords={:?} latency={:.2}s", plain, hot, beam_lat);
    assert!(!plain.is_empty(), "[bench] beam search returned empty text");
}
