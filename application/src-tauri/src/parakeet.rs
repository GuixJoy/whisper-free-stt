use anyhow::Result;
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig};
use std::path::PathBuf;

/// Hotword bias strength, matching the value the bench spike verified.
const HOTWORDS_SCORE: f32 = 2.0;

pub struct ParakeetRecognizer {
    recognizer: OfflineRecognizer,
}

/// Derive the `bpe.vocab` the Parakeet release does not ship: every tokens.txt
/// entry with a uniform score, per the upstream node hotwords example. Cached
/// inside the model dir, which `verify_model` does not enumerate.
pub fn derive_bpe_vocab(model_dir: &std::path::Path) -> Result<PathBuf> {
    let out = model_dir.join("bpe.vocab");
    if !out.exists() {
        let tokens = std::fs::read_to_string(model_dir.join("tokens.txt"))?;
        let mut vocab: String = tokens
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| format!("{}\t-1.0", l.split_whitespace().next().unwrap()))
            .collect::<Vec<_>>()
            .join("\n");
        vocab.push('\n');
        std::fs::write(&out, vocab)?;
    }
    Ok(out)
}

impl ParakeetRecognizer {
    pub fn new(model_dir: &std::path::Path, num_threads: i32, debug: bool) -> Result<Self> {
        Self::build(model_dir, num_threads, debug, "greedy_search", None, 0.0)
    }

    /// Hotword-biased variant: `modified_beam_search` is the only decoding
    /// method sherpa-onnx applies hotwords under, and it needs
    /// `modeling_unit=bpe` plus a bpe vocab (derived from tokens.txt, which the
    /// release ships none of).
    pub fn new_biased(model_dir: &std::path::Path, num_threads: i32, debug: bool) -> Result<Self> {
        let vocab = derive_bpe_vocab(model_dir)?;
        Self::new_with_decoding(
            model_dir,
            num_threads,
            debug,
            "modified_beam_search",
            Some(&vocab),
            HOTWORDS_SCORE,
        )
    }

    /// Variant for the hotword/biasing path, used by the bench harness to
    /// construct a recognizer with an explicit decoding method.
    pub fn new_with_decoding(
        model_dir: &std::path::Path,
        num_threads: i32,
        debug: bool,
        decoding_method: &str,
        bpe_vocab: Option<&std::path::Path>,
        hotwords_score: f32,
    ) -> Result<Self> {
        Self::build(
            model_dir,
            num_threads,
            debug,
            decoding_method,
            bpe_vocab,
            hotwords_score,
        )
    }

    fn build(
        model_dir: &std::path::Path,
        num_threads: i32,
        debug: bool,
        decoding_method: &str,
        bpe_vocab: Option<&std::path::Path>,
        hotwords_score: f32,
    ) -> Result<Self> {
        let encoder = model_dir.join("encoder.onnx");
        let decoder = model_dir.join("decoder.onnx");
        let joiner = model_dir.join("joiner.onnx");
        let tokens = model_dir.join("tokens.txt");

        let mut config = OfflineRecognizerConfig::default();
        config.model_config.transducer.encoder = Some(encoder.to_str().unwrap().into());
        config.model_config.transducer.decoder = Some(decoder.to_str().unwrap().into());
        config.model_config.transducer.joiner = Some(joiner.to_str().unwrap().into());
        config.model_config.tokens = Some(tokens.to_str().unwrap().into());
        config.model_config.model_type = Some("nemo_transducer".to_string());
        config.model_config.num_threads = num_threads;
        config.model_config.debug = debug;
        if decoding_method == "modified_beam_search" {
            config.model_config.modeling_unit = Some("bpe".to_string());
            config.model_config.bpe_vocab = Some(bpe_vocab.unwrap().to_str().unwrap().to_string());
            config.hotwords_score = hotwords_score;
        }

        config.decoding_method = Some(decoding_method.to_string());

        let recognizer = OfflineRecognizer::create(&config)
            .ok_or_else(|| anyhow::anyhow!("Failed to create Parakeet OfflineRecognizer"))?;

        Ok(Self { recognizer })
    }

    /// Transcribe a complete audio segment (e.g. a VAD speech segment).
    /// Superseded by `transcribe_full` in the pipeline (which also returns the
    /// timestamps the cleanup gate needs); kept for the bench harness.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn transcribe(&self, samples: &[f32]) -> String {
        self.transcribe_full(samples)
            .map(|r| r.text)
            .unwrap_or_default()
    }

    /// Full decode result (tokens, per-token timestamps/durations when the
    /// decoder emits them). The selective-cleanup gate consumes this.
    pub fn transcribe_full(&self, samples: &[f32]) -> Option<sherpa_onnx::OfflineRecognizerResult> {
        let stream = self.recognizer.create_stream();
        stream.accept_waveform(16000, samples);
        self.recognizer.decode(&stream);
        stream.get_result()
    }

    /// Single decode with per-stream hotwords (`PHRASE/OTHER :score`).
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn transcribe_with_hotwords(&self, samples: &[f32], hotwords: &str) -> String {
        let stream = self.recognizer.create_stream_with_hotwords(hotwords);
        stream.accept_waveform(16000, samples);
        self.recognizer.decode(&stream);
        stream.get_result().map(|r| r.text).unwrap_or_default()
    }

    /// `transcribe_full` under hotword biasing. Same result shape, so the
    /// selective-cleanup gate still receives timestamps and durations.
    pub fn transcribe_full_with_hotwords(
        &self,
        samples: &[f32],
        hotwords: &str,
    ) -> Option<sherpa_onnx::OfflineRecognizerResult> {
        let stream = self.recognizer.create_stream_with_hotwords(hotwords);
        stream.accept_waveform(16000, samples);
        self.recognizer.decode(&stream);
        stream.get_result()
    }
}

#[cfg(test)]
mod tests {
    use super::derive_bpe_vocab;

    #[test]
    fn derive_bpe_vocab_builds_then_reuses_cache() {
        let dir = std::env::temp_dir().join(format!("floure-bpe-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("tokens.txt"),
            "\u{2581}hello 1\n\u{2581}world 2\n\n",
        )
        .unwrap();

        let path = derive_bpe_vocab(&dir).unwrap();
        let vocab = std::fs::read_to_string(&path).unwrap();
        assert!(vocab.contains("\u{2581}hello\t-1.0"), "vocab: {vocab:?}");
        assert!(vocab.contains("\u{2581}world\t-1.0"), "vocab: {vocab:?}");

        // A second call must reuse the cached file, not re-derive it.
        std::fs::write(&path, "cached\n").unwrap();
        let again = derive_bpe_vocab(&dir).unwrap();
        assert_eq!(std::fs::read_to_string(again).unwrap(), "cached\n");

        std::fs::remove_dir_all(&dir).ok();
    }
}
