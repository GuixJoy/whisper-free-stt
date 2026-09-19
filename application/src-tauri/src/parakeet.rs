use anyhow::Result;
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig};

pub struct ParakeetRecognizer {
    recognizer: OfflineRecognizer,
}

impl ParakeetRecognizer {
    pub fn new(model_dir: &std::path::Path, num_threads: i32, debug: bool) -> Result<Self> {
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

        config.decoding_method = Some("greedy_search".to_string());

        let recognizer = OfflineRecognizer::create(&config)
            .ok_or_else(|| anyhow::anyhow!("Failed to create Parakeet OfflineRecognizer"))?;

        Ok(Self { recognizer })
    }

    /// Transcribe a complete audio segment (e.g. a VAD speech segment).
    pub fn transcribe(&self, samples: &[f32]) -> String {
        let stream = self.recognizer.create_stream();
        stream.accept_waveform(16000, samples);
        self.recognizer.decode(&stream);
        stream
            .get_result()
            .map(|r| r.text)
            .unwrap_or_default()
    }
}
