use anyhow::Result;
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig};
use std::path::PathBuf;

pub struct WhisperRecognizer {
    recognizer: OfflineRecognizer,
    model_dir: PathBuf,
    num_threads: i32,
    debug: bool,
    language: Option<String>,
}

/// Map a UI language setting to the Whisper `language` config value:
/// `"auto"`/`""` (and whitespace-only) mean auto-detect (`None`).
fn normalize_language(lang: &str) -> Option<String> {
    let trimmed = lang.trim();
    if trimmed.is_empty() || trimmed == "auto" {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn build_recognizer(
    model_dir: &std::path::Path,
    num_threads: i32,
    debug: bool,
    language: Option<String>,
) -> Result<OfflineRecognizer> {
    let encoder = model_dir.join("whisper-encoder.onnx");
    let decoder = model_dir.join("whisper-decoder.onnx");
    let tokens = model_dir.join("tokens.txt");

    let mut config = OfflineRecognizerConfig::default();
    config.model_config.whisper.encoder = Some(encoder.to_str().unwrap().into());
    config.model_config.whisper.decoder = Some(decoder.to_str().unwrap().into());
    config.model_config.whisper.language = language;
    config.model_config.whisper.task = Some("transcribe".to_string());
    config.model_config.tokens = Some(tokens.to_str().unwrap().into());
    config.model_config.num_threads = num_threads;
    config.model_config.debug = debug;
    config.model_config.model_type = Some("whisper".to_string());

    let recognizer = OfflineRecognizer::create(&config)
        .ok_or_else(|| anyhow::anyhow!("Failed to create Whisper OfflineRecognizer"))?;

    Ok(recognizer)
}

impl WhisperRecognizer {
    pub fn new(model_dir: &std::path::Path, num_threads: i32, debug: bool) -> Result<Self> {
        let language = Some("en".to_string());
        let recognizer = build_recognizer(model_dir, num_threads, debug, language.clone())?;

        Ok(Self {
            recognizer,
            model_dir: model_dir.to_path_buf(),
            num_threads,
            debug,
            language,
        })
    }

    /// Set the recognition language. `"auto"` and `""` select auto-detect
    /// (`None`); anything else is passed through as the Whisper language tag.
    /// The underlying recognizer is rebuilt so the new language takes effect.
    /// The stored language is committed only after a successful rebuild, so
    /// a failed rebuild keeps retrying on the next call instead of latching
    /// the new tag while transcribing in the old language.
    pub fn set_language(&mut self, lang: &str) -> Result<()> {
        let new_language = normalize_language(lang);
        if new_language == self.language {
            return Ok(());
        }
        let model_dir = self.model_dir.clone();
        let recognizer = build_recognizer(
            &model_dir,
            self.num_threads,
            self.debug,
            new_language.clone(),
        )?;
        self.recognizer = recognizer;
        self.language = new_language;
        Ok(())
    }

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

#[cfg(test)]
mod tests {
    use super::normalize_language;

    #[test]
    fn language_mapping_auto_and_empty_to_none() {
        assert_eq!(normalize_language("auto"), None);
        assert_eq!(normalize_language(""), None);
        assert_eq!(normalize_language("   "), None);
    }

    #[test]
    fn language_mapping_passthrough() {
        assert_eq!(normalize_language("en"), Some("en".to_string()));
        assert_eq!(normalize_language("de"), Some("de".to_string()));
        assert_eq!(normalize_language("  fr  "), Some("fr".to_string()));
    }
}
