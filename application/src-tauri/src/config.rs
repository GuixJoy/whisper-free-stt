use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::llm::LlmMode;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AsrProfile {
    #[serde(rename = "parakeet")]
    Parakeet,
    #[serde(rename = "whisper-turbo")]
    WhisperTurbo,
    #[serde(rename = "whisper-base")]
    WhisperBase,
}

impl AsrProfile {
    pub fn model_id(&self) -> &'static str {
        match self {
            Self::Parakeet => "parakeet-tdt-0.6b-v2-int8",
            Self::WhisperTurbo => "whisper-large-v3-turbo-q5_1",
            Self::WhisperBase => "whisper-base-q5_1",
        }
    }

    pub fn model_dir(&self, base: &std::path::Path) -> std::path::PathBuf {
        base.join(self.model_id())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LlmProvider {
    #[serde(rename = "local")]
    Local,
    #[serde(rename = "openrouter")]
    OpenRouter,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub asr_profile: AsrProfile,
    #[serde(default = "default_language")]
    pub language: String,
    pub llm_provider: LlmProvider,
    #[serde(default)]
    pub llm_mode: LlmMode,
    #[serde(default = "default_llm_model")]
    pub llm_model: String,
    pub selected_mic_index: Option<usize>,
    pub typing_enabled: bool,
    pub clipboard_enabled: bool,
    /// Space-separated vocabulary to bias decoding toward. Empty disables the
    /// biased decode path entirely (see `pipeline.rs`).
    #[serde(default)]
    pub hotwords: String,
    pub model_dir: PathBuf,
}

fn default_language() -> String {
    "en".to_string()
}

fn default_llm_model() -> String {
    "s1-mini-q4_k_m".to_string()
}

/// The LLM model id to actually load.
///
/// Configs written by the UI can carry an empty `llm_model` (the frontend's
/// default is "" and it is sent verbatim). An empty id silently collapses the
/// per-model subdirectory out of the path — `models/""/file.gguf` resolves to
/// `models/file.gguf`, which does not exist — so the model "fails to load"
/// even though it is downloaded. Treat blank as the default.
pub fn resolved_llm_model(id: &str) -> String {
    if id.trim().is_empty() {
        default_llm_model()
    } else {
        id.to_string()
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        let model_dir = dirs_next::data_dir()
            .unwrap_or_else(|| PathBuf::from(".local/share/floure"))
            .join("floure")
            .join("models");

        Self {
            asr_profile: AsrProfile::Parakeet,
            language: default_language(),
            llm_provider: LlmProvider::Local,
            llm_mode: LlmMode::default(),
            llm_model: default_llm_model(),
            selected_mic_index: None,
            typing_enabled: true,
            clipboard_enabled: true,
            hotwords: String::new(),
            model_dir,
        }
    }
}

/// UI-owned subset of settings, sent by the frontend on every settings save
/// (`set_floure_config`). `model_dir` is deliberately absent: the frontend
/// never sees it and must not be able to clobber it. Every field has a
/// serde default so older payloads keep parsing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsUpdate {
    #[serde(default = "default_profile")]
    pub asr_profile: AsrProfile,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_provider")]
    pub llm_provider: LlmProvider,
    #[serde(default)]
    pub llm_mode: LlmMode,
    #[serde(default = "default_llm_model")]
    pub llm_model: String,
    #[serde(default = "default_true")]
    pub typing_enabled: bool,
    #[serde(default = "default_true")]
    pub clipboard_enabled: bool,
    #[serde(default)]
    pub hotwords: String,
}

/// Hotwords arrive as the UI's comma-separated list; sherpa-onnx wants a
/// space-separated string. Normalise at this boundary so the decode path stays
/// a straight pass-through, and cap the length so a runaway paste cannot blow
/// up the beam search.
pub fn normalize_hotwords(raw: &str) -> String {
    raw.split(|c: char| c == ',' || c.is_whitespace())
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(200)
        .collect()
}

fn default_profile() -> AsrProfile {
    AsrProfile::Parakeet
}

fn default_provider() -> LlmProvider {
    LlmProvider::Local
}

fn default_true() -> bool {
    true
}

/// Config directory for `floure/config.json`
/// (`~/.config/floure`, `%APPDATA%/floure`, ...).
fn config_dir() -> PathBuf {
    dirs_next::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("floure")
}

/// Canonical data directory for the app.
///
/// Honors the `STT_DATA_DIR` env override (used by the Python backend);
/// otherwise `~/.local/share/floure`.
pub fn data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("STT_DATA_DIR") {
        PathBuf::from(dir)
    } else {
        dirs_next::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".local/share/floure")
    }
}

/// Single source of truth for the transcript history DB path.
///
/// Migrates the legacy `~/.local/share/stt/history.db` forward: if the
/// canonical DB does not exist yet but the legacy one does (and no
/// `STT_DATA_DIR` override is set), it is copied into place.
pub fn history_db_path() -> PathBuf {
    let canonical = data_dir().join("history.db");

    if std::env::var("STT_DATA_DIR").is_err() && !canonical.exists() {
        if let Some(home) = dirs_next::home_dir() {
            let legacy = home.join(".local/share/stt/history.db");
            if legacy != canonical && legacy.exists() {
                if let Some(parent) = canonical.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if std::fs::copy(&legacy, &canonical).is_ok() {
                    eprintln!(
                        "migrated history DB from legacy path {} to {}",
                        legacy.display(),
                        canonical.display()
                    );
                }
            }
        }
    }

    canonical
}

impl AppConfig {
    pub fn load() -> Self {
        let store_path = config_dir().join("config.json");

        if store_path.exists() {
            if let Ok(contents) = std::fs::read_to_string(&store_path) {
                if let Ok(config) = serde_json::from_str::<AppConfig>(&contents) {
                    return config;
                }
            }
        }
        Self::default()
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let store_path = config_dir();

        std::fs::create_dir_all(&store_path)?;
        let config_path = store_path.join("config.json");
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(&config_path, json)?;
        Ok(())
    }

    /// Apply a frontend settings update, preserving fields the UI doesn't own.
    pub fn apply_update(&mut self, update: SettingsUpdate) {
        self.asr_profile = update.asr_profile;
        self.language = update.language;
        self.llm_provider = update.llm_provider;
        self.llm_mode = update.llm_mode;
        // Never persist a blank id: it would resolve to a non-existent path.
        self.llm_model = resolved_llm_model(&update.llm_model);
        self.typing_enabled = update.typing_enabled;
        self.clipboard_enabled = update.clipboard_enabled;
        self.hotwords = normalize_hotwords(&update.hotwords);
    }
}

#[cfg(test)]
mod tests {
    use super::AppConfig;

    #[test]
    fn language_defaults_to_en() {
        assert_eq!(AppConfig::default().language, "en");
    }

    #[test]
    fn old_config_without_language_loads_as_en() {
        // Config files written before the `language` field existed must
        // still parse, defaulting to English.
        let old = serde_json::json!({
            "asr_profile": "parakeet",
            "llm_provider": "local",
            "llm_mode": "cleanup",
            "selected_mic_index": null,
            "typing_enabled": true,
            "clipboard_enabled": true,
            "model_dir": "/tmp/models"
        });
        let config: AppConfig = serde_json::from_value(old).unwrap();
        assert_eq!(config.language, "en");
        // Same for configs predating `hotwords`.
        assert!(config.hotwords.is_empty());
    }

    #[test]
    fn hotwords_normalize_commas_and_whitespace() {
        assert_eq!(
            super::normalize_hotwords("Tauri, PyTorch ,,  wl-copy\nFloure"),
            "Tauri PyTorch wl-copy Floure"
        );
        assert_eq!(super::normalize_hotwords("   "), "");
    }

    #[test]
    fn apply_update_normalizes_hotwords() {
        let mut config = AppConfig::default();
        config.apply_update(super::SettingsUpdate {
            asr_profile: super::AsrProfile::Parakeet,
            language: "en".to_string(),
            llm_provider: super::LlmProvider::Local,
            llm_mode: crate::llm::LlmMode::Cleanup,
            llm_model: "x".to_string(),
            typing_enabled: true,
            clipboard_enabled: true,
            hotwords: "Calico, Kaliko".to_string(),
        });
        assert_eq!(config.hotwords, "Calico Kaliko");
    }

    #[test]
    fn language_round_trips() {
        let mut config = AppConfig::default();
        config.language = "auto".to_string();
        let json = serde_json::to_string(&config).unwrap();
        let back: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.language, "auto");
    }

    #[test]
    fn frontend_wire_strings_deserialize() {
        // The exact strings the UI sends (see App.tsx RuntimeSettings).
        let update: super::SettingsUpdate = serde_json::from_value(serde_json::json!({
            "asr_profile": "whisper-turbo",
            "language": "de",
            "llm_provider": "openrouter",
            "llm_mode": "bullet_list",
            "llm_model": "openai/gpt-4o-mini",
            "typing_enabled": false,
            "clipboard_enabled": false
        }))
        .unwrap();
        assert!(matches!(
            update.asr_profile,
            super::AsrProfile::WhisperTurbo
        ));
        assert!(matches!(
            update.llm_provider,
            super::LlmProvider::OpenRouter
        ));
        assert!(matches!(update.llm_mode, crate::llm::LlmMode::BulletList));
    }

    #[test]
    fn apply_update_preserves_model_dir() {
        let mut config = AppConfig::default();
        let update = super::SettingsUpdate {
            asr_profile: super::AsrProfile::WhisperBase,
            language: "fr".to_string(),
            llm_provider: super::LlmProvider::OpenRouter,
            llm_mode: crate::llm::LlmMode::Email,
            llm_model: "x".to_string(),
            typing_enabled: false,
            clipboard_enabled: false,
            hotwords: String::new(),
        };
        let dir = config.model_dir.clone();
        config.apply_update(update);
        assert_eq!(config.model_dir, dir);
        assert!(matches!(config.asr_profile, super::AsrProfile::WhisperBase));
        assert!(!config.typing_enabled);
    }
}
