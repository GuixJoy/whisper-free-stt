use anyhow::Result;
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig};

pub struct ParakeetRecognizer {
    recognizer: OfflineRecognizer,
}

impl ParakeetRecognizer {
    pub fn new(model_dir: &std::path::Path, num_threads: i32, debug: bool) -> Result<Self> {
        Self::build(model_dir, num_threads, debug, "greedy_search", None, 0.0)
    }

    /// Variant for the hotword/biasing path: `modified_beam_search` is the
    /// only decoding method sherpa-onnx applies hotwords under, and it needs
    /// `modeling_unit=bpe` plus a bpe vocab (derived from tokens.txt when the
    /// release ships none).
    // Used only by the bench harness (`mod bench` is #[cfg(test)]), so it is
    // dead code in a normal build. Not deleted: it is the beam-search /
    // hotword surface the harness exists to verify.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn new_with_decoding(
        model_dir: &std::path::Path,
        num_threads: i32,
        debug: bool,
        decoding_method: &str,
        bpe_vocab: Option<&std::path::Path>,
        hotwords_score: f32,
    ) -> Result<Self> {
        Self::build(model_dir, num_threads, debug, decoding_method, bpe_vocab, hotwords_score)
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
            config.model_config.bpe_vocab =
                Some(bpe_vocab.unwrap().to_str().unwrap().to_string());
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
        self.transcribe_full(samples).map(|r| r.text).unwrap_or_default()
    }

    /// Full decode result (tokens, per-token timestamps/durations when the
    /// decoder emits them). The selective-cleanup gate consumes this.
    pub fn transcribe_full(
        &self,
        samples: &[f32],
    ) -> Option<sherpa_onnx::OfflineRecognizerResult> {
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
}
