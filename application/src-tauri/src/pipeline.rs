use anyhow::Result;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Instant;
use tauri::Emitter;

use crate::config::{AppConfig, history_db_path};
use crate::llm::{LlmBackend, LlmCleanup, LlmMode};
use crate::models::{MODEL_MANIFEST, find_model, download_model, verify_model};
use crate::parakeet::ParakeetRecognizer;
use crate::vad::VoiceActivityDetector;
use crate::whisper::WhisperRecognizer;
use crate::output::{save_to_history, type_text, copy_to_clipboard};

static PIPELINE_RUNNING: std::sync::OnceLock<Arc<AtomicBool>> = std::sync::OnceLock::new();

pub fn get_running_flag() -> &'static Arc<AtomicBool> {
    PIPELINE_RUNNING.get_or_init(|| Arc::new(AtomicBool::new(false)))
}

pub struct LlmProcessor {
    llm: Option<LlmCleanup>,
    config: AppConfig,
}

impl LlmProcessor {
    pub fn new(config: AppConfig) -> Self {
        // Build the model path from the selected LLM model ID in config.
        // The manifest's `filename` field is the on-disk name; fall back to
        // the legacy gemma path if the model isn't in the manifest yet.
        let filename = crate::models::find_model(&config.llm_model)
            .and_then(|m| m.filename)
            .unwrap_or("s1-mini-q4_k_m.gguf");
        let llm_model_path = config.model_dir.join(&config.llm_model).join(filename);
        // Legacy fallback: check the old flat path before the subdirectory layout
        let llm_model_path = if llm_model_path.exists() {
            llm_model_path
        } else {
            config.model_dir.join(filename)
        };
        let llm = LlmCleanup::new(LlmBackend::Local, Some(&llm_model_path)).ok();
        Self { llm, config }
    }

    pub fn process(&mut self, text: &str, app: &tauri::AppHandle) {
        let mode = self.config.llm_mode;
        let cleaned: String;

        if mode == LlmMode::Off {
            cleaned = text.to_string();
        } else if let Some(llm) = &mut self.llm {
            // The local context is 512 tokens with a 128-token completion
            // budget, so clamp pathological transcripts (keep the tail =
            // most recent speech) instead of failing opaquely in decode.
            const MAX_TRANSCRIPT_BYTES: usize = 1200;
            let transcript = if text.len() > MAX_TRANSCRIPT_BYTES {
                eprintln!(
                    "[pipeline] transcript truncated for LLM ({} -> {} bytes)",
                    text.len(),
                    MAX_TRANSCRIPT_BYTES
                );
                let mut start = text.len() - MAX_TRANSCRIPT_BYTES;
                while !text.is_char_boundary(start) {
                    start += 1;
                }
                &text[start..]
            } else {
                text
            };
            let prompt = crate::llm::build_prompt(transcript, mode, "", "");
            let _ = app.emit("llm_start", serde_json::json!({}));

            let collected = Arc::new(std::sync::Mutex::new(String::new()));
            let collected_clone = collected.clone();
            let app_for_callback = app.clone();

            let result = llm.stream_cleanup(&prompt, move |token| {
                let _ = app_for_callback
                    .emit("llm_token", serde_json::json!({ "token": token }));
                collected_clone.lock().unwrap().push_str(&token);
            });

            let _ = app.emit("llm_end", serde_json::json!({}));
            if result.is_ok() {
                cleaned = crate::llm::clean_response(&collected.lock().unwrap());
            } else {
                // Fall back to the raw transcript, but surface the failure
                // instead of silently degrading: the frontend shows it.
                if let Err(e) = result {
                    eprintln!("[pipeline] LLM cleanup failed: {}", e);
                    let _ = app.emit("llm_error", serde_json::json!({"error": e.to_string()}));
                }
                cleaned = crate::llm::clean_response(text);
            }
        } else {
            cleaned = crate::llm::clean_response(text);
        }

        if self.config.typing_enabled {
            let _ = type_text(&cleaned);
        }
        if self.config.clipboard_enabled {
            let _ = copy_to_clipboard(&cleaned);
        }

        let db_path = history_db_path();
        let _ = save_to_history(&cleaned, text, mode.as_str(), "floure", &db_path);
    }
}

pub struct PipelineController {
    running: Arc<AtomicBool>,
    app: tauri::AppHandle,
    config: AppConfig,
    silero_path: PathBuf,
    _model_dir: PathBuf,
}

impl PipelineController {
    pub fn new(app: tauri::AppHandle, config: AppConfig) -> Result<Self> {
        let running = get_running_flag().clone();
        let model_dir = config.model_dir.clone();
        let silero_path = model_dir.join("silero-vad").join("silero_vad.onnx");
        let vad_manifest = MODEL_MANIFEST
            .iter()
            .find(|m| m.id == "silero-vad")
            .unwrap();

        // Use verify_model (existence + exact size) rather than `exists()`:
        // a stale/truncated file from an old broken download would crash
        // sherpa-onnx at VAD creation with an uncaught C++ exception.
        let silero_valid = verify_model(&model_dir, vad_manifest);

        eprintln!(
            "[pipeline] model_dir={:?} profile={:?} silero_valid={}",
            model_dir,
            config.asr_profile,
            silero_valid
        );

        if !silero_valid {
            if silero_path.exists() {
                std::fs::remove_file(&silero_path)?;
                eprintln!("[pipeline] removed invalid silero VAD file, re-downloading");
            }
            std::fs::create_dir_all(model_dir.join("silero-vad"))?;
            let model_dir_dl = model_dir.join("silero-vad");
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?;
            // Surface progress to the frontend: start_listening blocks on
            // this download, so a silent no-op callback leaves the UI hung
            // with no feedback on first run.
            let app_dl = app.clone();
            let result = runtime.block_on(async {
                download_model(vad_manifest, &model_dir_dl, |percent, bytes| {
                    let _ = app_dl.emit(
                        "model_download_progress",
                        serde_json::json!({"id": vad_manifest.id, "percent": percent, "bytes": bytes}),
                    );
                })
                .await
            });
            if let Err(e) = result {
                let _ = app.emit(
                    "asr_error",
                    serde_json::json!({"error": format!("Failed to download VAD: {}", e)}),
                );
                running.store(false, Ordering::SeqCst);
                return Err(anyhow::anyhow!("VAD model download failed"));
            }
        }

        if !verify_model(&model_dir, vad_manifest) {
            let _ = app.emit(
                "asr_error",
                serde_json::json!({"error": "Silero VAD model file not found after download attempt"}),
            );
            running.store(false, Ordering::SeqCst);
            return Err(anyhow::anyhow!("Silero VAD model not found"));
        }

        // Lazy download of the selected ASR model (mirrors the VAD pattern
        // above): if the profile's model files are missing, fetch them now
        // instead of failing later inside the worker thread.
        let asr_model_id = config.asr_profile.model_id();
        let asr_manifest = MODEL_MANIFEST
            .iter()
            .find(|m| m.id == asr_model_id)
            .ok_or_else(|| anyhow::anyhow!("Unknown ASR model: {}", asr_model_id))?;
        eprintln!(
            "[pipeline] ASR model: {} (exists={})",
            asr_model_id,
            verify_model(&model_dir, asr_manifest)
        );
        if !verify_model(&model_dir, asr_manifest) {
            let asr_dir = config.asr_profile.model_dir(&model_dir);
            std::fs::create_dir_all(&asr_dir)?;
            eprintln!("[pipeline] downloading ASR model {} to {}", asr_model_id, asr_dir.display());
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?;
            let app_dl = app.clone();
            let result = runtime.block_on(async {
                download_model(asr_manifest, &asr_dir, |percent, bytes| {
                    let _ = app_dl.emit(
                        "model_download_progress",
                        serde_json::json!({"id": asr_manifest.id, "percent": percent, "bytes": bytes}),
                    );
                })
                .await
            });
            if let Err(e) = result {
                eprintln!("[pipeline] ASR model download FAILED: {}", e);
                let _ = app.emit(
                    "asr_error",
                    serde_json::json!({"error": format!("Failed to download ASR model: {}", e)}),
                );
                running.store(false, Ordering::SeqCst);
                return Err(anyhow::anyhow!("ASR model download failed: {}", e));
            }
            if !verify_model(&model_dir, asr_manifest) {
                let _ = app.emit(
                    "asr_error",
                    serde_json::json!({"error": "ASR model files not found after download attempt"}),
                );
                running.store(false, Ordering::SeqCst);
                return Err(anyhow::anyhow!("ASR model not found"));
            }
            eprintln!("[pipeline] ASR model {} ready", asr_model_id);
        }

        Ok(Self {
            running,
            app,
            config,
            silero_path,
            _model_dir: model_dir,
        })
    }

    pub fn start(&self) -> Result<()> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Err(anyhow::anyhow!("Pipeline already running"));
        }

        let (tx, rx) = mpsc::channel::<Vec<f32>>();

        let mic_name: Option<String> = self.config.selected_mic_index.and_then(|i| {
            crate::audio::list_input_devices()
                .ok()
                .and_then(|devices| devices.get(i).map(|(name, _)| name.clone()))
        });

        let app_clone = self.app.clone();
        let config_clone = self.config.clone();
        let running_clone = self.running.clone();
        let silero_path = self.silero_path.clone();

        let audio = match crate::audio::start_capture(mic_name.as_deref(), move |samples: &[f32]| {
            let _ = tx.send(samples.to_vec());
        }) {
            Ok(a) => a,
            Err(e) => {
                let _ = app_clone.emit(
                    "asr_error",
                    serde_json::json!({"error": format!("Audio device error: {}", e)}),
                );
                running_clone.store(false, Ordering::SeqCst);
                return Ok(());
            }
        };

        let mic_sample_rate = audio.sample_rate;

        std::thread::spawn(move || {
            let _audio = audio;

            let resampler: Option<sherpa_onnx::LinearResampler> = if mic_sample_rate != 16000 {
                sherpa_onnx::LinearResampler::create(mic_sample_rate as i32, 16000)
            } else {
                None
            };

            let mut vad = match VoiceActivityDetector::new(&silero_path, 0.5) {
                Ok(v) => v,
                Err(e) => {
                    let _ = app_clone.emit(
                        "asr_error",
                        serde_json::json!({"error": e.to_string()}),
                    );
                    return;
                }
            };

            let model_id = config_clone.asr_profile.model_id();
            let model_dir = config_clone.asr_profile.model_dir(&config_clone.model_dir);

            // Owns LLM cleanup/typing/clipboard/history for this worker thread.
            // Created here (rather than moved from the controller) so inference
            // stays on the thread that uses it.
            let mut llm_processor = LlmProcessor::new(config_clone.clone());

            let mut parakeet: Option<ParakeetRecognizer> = None;
            let mut whisper: Option<WhisperRecognizer> = None;

            if verify_model(&config_clone.model_dir, find_model(model_id).unwrap()) {
                match config_clone.asr_profile {
                    crate::config::AsrProfile::Parakeet => {
                        match ParakeetRecognizer::new(&model_dir, 4, false) {
                            Ok(r) => {
                                parakeet = Some(r);
                                let _ = app_clone
                                    .emit("asr_ready", serde_json::json!({ "backend": "parakeet" }));
                            }
                            Err(e) => {
                                let _ = app_clone
                                    .emit("asr_error", serde_json::json!({"error": e.to_string()}));
                            }
                        }
                    }
                    crate::config::AsrProfile::WhisperTurbo | crate::config::AsrProfile::WhisperBase => {
                        match WhisperRecognizer::new(&model_dir, 4, false) {
                            Ok(mut r) => {
                                if let Err(e) = r.set_language(&config_clone.language) {
                                    let _ = app_clone.emit(
                                        "asr_error",
                                        serde_json::json!({"error": e.to_string()}),
                                    );
                                    // Don't advertise readiness: the recognizer
                                    // would transcribe in the wrong language.
                                    // Clearing the flag lets the user retry.
                                    running_clone.store(false, Ordering::SeqCst);
                                    return;
                                }
                                whisper = Some(r);
                                let _ = app_clone
                                    .emit("asr_ready", serde_json::json!({ "backend": "whisper" }));
                            }
                            Err(e) => {
                                let _ = app_clone
                                    .emit("asr_error", serde_json::json!({"error": e.to_string()}));
                            }
                        }
                    }
                }
            } else {
                let _ = app_clone.emit(
                    "asr_error",
                    serde_json::json!({"error": format!("Model {} not downloaded", model_id)}),
                );
            }

            while running_clone.load(Ordering::SeqCst) {
                match rx.recv_timeout(std::time::Duration::from_millis(50)) {
                    Ok(samples) => {
                        let resampled: Vec<f32> = if let Some(ref r) = resampler {
                            r.resample(&samples, false)
                        } else {
                            samples
                        };

                        vad.feed(&resampled);

                        if let Some(segment) = vad.try_get_segment() {
                            let start = Instant::now();
                            let text = if let Some(ref rec) = parakeet {
                                rec.transcribe(&segment)
                            } else if let Some(ref ws) = whisper {
                                ws.transcribe(&segment)
                            } else {
                                String::new()
                            };
                            let latency_ms = start.elapsed().as_millis() as u64;

                            if !text.is_empty() {
                                let _ = app_clone.emit(
                                    "asr_final",
                                    serde_json::json!({
                                        "text": text,
                                        "latency_ms": latency_ms,
                                    }),
                                );
                                llm_processor.process(&text, &app_clone);
                            }
                            vad.reset_after_segment();
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        Ok(())
    }
}

pub fn start_pipeline(app: tauri::AppHandle, config: AppConfig) -> Result<()> {
    let controller = PipelineController::new(app.clone(), config.clone())?;
    controller.start()?;
    Ok(())
}

pub fn stop_pipeline() {
    if let Some(flag) = PIPELINE_RUNNING.get() {
        flag.store(false, Ordering::SeqCst);
    }
}