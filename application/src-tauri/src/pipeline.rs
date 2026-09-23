use anyhow::Result;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;

use crate::config::{history_db_path, resolved_llm_model, AppConfig};
use crate::llm::{LlmBackend, LlmCleanup, LlmMode};
use crate::models::{download_model, find_model, verify_model, MODEL_MANIFEST};
use crate::output::{copy_to_clipboard, save_to_history, type_text};
use crate::parakeet::ParakeetRecognizer;
use crate::vad::VoiceActivityDetector;
use crate::whisper::WhisperRecognizer;

static PIPELINE_RUNNING: std::sync::OnceLock<Arc<AtomicBool>> = std::sync::OnceLock::new();

/// Monotonic run id, bumped on every stop and every start.
///
/// The worker also polls `PIPELINE_RUNNING`, but that flag alone cannot decide
/// its fate: `stop_pipeline` clears it and a following `start_pipeline` sets it
/// straight back to true, so a worker that was still inside `process()` woke up
/// and kept running alongside its successor — two capture streams, both typing,
/// which interleaved duplicated text into the focused window. A run may only
/// continue while its own id is still the newest one, and ids are never reused.
static PIPELINE_GEN: AtomicU64 = AtomicU64::new(0);

/// Open a new run, invalidating every earlier one.
fn begin_run() -> u64 {
    PIPELINE_GEN.fetch_add(1, Ordering::SeqCst) + 1
}

/// Whether the run started with `run_id` is still the current one.
fn run_is_current(run_id: u64) -> bool {
    PIPELINE_GEN.load(Ordering::SeqCst) == run_id
}

/// The worker thread handle. `stop_pipeline` joins it so the flush (and the
/// engine hand-back below) always completes before the next press starts.
/// Without the join, a rapid re-press overlaps the previous worker: two live
/// `LlamaBackend`s, and the second `init` fails with
/// `BackendAlreadyInitialized` (the flag only resets on drop).
static WORKER: std::sync::Mutex<Option<std::thread::JoinHandle<()>>> =
    std::sync::Mutex::new(None);

/// Engines kept warm across PTT presses. Reloading ~1GB of models per press
/// made tap-to-talk unusable (stop killed the worker before ASR finished),
/// so the worker takes these on start and returns them on exit.
struct CachedEngines {
    key: String,
    parakeet: Option<ParakeetRecognizer>,
    whisper: Option<WhisperRecognizer>,
    llm: Option<LlmCleanup>,
}

static ENGINE_CACHE: std::sync::Mutex<Option<CachedEngines>> = std::sync::Mutex::new(None);

/// True while the start-up warm thread is (or may still be) building.
/// Set first thing in `warm_engines` so a UI query racing thread start
/// still sees "warming"; cleared on every exit path via the guard.
static WARMING: AtomicBool = AtomicBool::new(false);

struct WarmGuard;

impl Drop for WarmGuard {
    fn drop(&mut self) {
        WARMING.store(false, Ordering::SeqCst);
    }
}

pub fn is_warming() -> bool {
    WARMING.load(Ordering::SeqCst)
}

/// True when the cache already holds engines for the on-disk config.
pub fn is_ready() -> bool {
    let config = AppConfig::load();
    let key = engine_key(&config);
    ENGINE_CACHE
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|c| c.key == key)
}

fn engine_key(config: &AppConfig) -> String {
    format!(
        "{:?}|{}|{}|{}|{:?}|{}",
        config.asr_profile,
        config.asr_profile.model_id(),
        config.language,
        config.hotwords,
        config.llm_provider,
        resolved_llm_model(&config.llm_model),
    )
}

/// Cache engines for the next press. Never stores an empty set: a failed
/// build must rebuild next press, not latch the failure.
fn store_engines(
    key: String,
    parakeet: Option<ParakeetRecognizer>,
    whisper: Option<WhisperRecognizer>,
    llm: Option<LlmCleanup>,
) {
    if parakeet.is_none() && whisper.is_none() {
        return;
    }
    *ENGINE_CACHE.lock().unwrap() = Some(CachedEngines {
        key,
        parakeet,
        whisper,
        llm,
    });
}

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
        // Resolve blank ids first: `models/""/file.gguf` collapses to
        // `models/file.gguf` and never matches the downloaded layout, which is
        // why a downloaded model could report "Local LLM model not loaded".
        let llm_model_id = resolved_llm_model(&config.llm_model);
        let filename = crate::models::find_model(&llm_model_id)
            .and_then(|m| m.filename)
            .unwrap_or("s1-mini-q4_k_m.gguf");
        let llm_model_path = config.model_dir.join(&llm_model_id).join(filename);
        // Legacy fallback: check the old flat path before the subdirectory layout
        let llm_model_path = if llm_model_path.exists() {
            llm_model_path
        } else {
            config.model_dir.join(filename)
        };
        let backend = match config.llm_provider {
            crate::config::LlmProvider::OpenRouter => LlmBackend::OpenRouter,
            crate::config::LlmProvider::Local => LlmBackend::Local,
        };
        // `.ok()` used to swallow the load failure, so the only visible
        // symptom was the downstream "Local LLM model not loaded" — which
        // says nothing about *why* (missing file, blank model id, bad GGUF).
        let llm = match LlmCleanup::new(backend, Some(&llm_model_path)) {
            Ok(llm) => Some(llm),
            Err(e) => {
                eprintln!(
                    "[llm] local model failed to load from {}: {e}",
                    llm_model_path.display()
                );
                None
            }
        };
        Self::from_cached(config, llm)
    }

    pub fn from_cached(config: AppConfig, llm: Option<LlmCleanup>) -> Self {
        Self { llm, config }
    }

    pub fn into_llm(self) -> Option<LlmCleanup> {
        self.llm
    }

    pub fn process(
        &mut self,
        text: &str,
        timestamps: &[f32],
        durations: &[f32],
        app: &tauri::AppHandle,
    ) {
        let mode = self.config.llm_mode;
        let cleaned: String;

        if mode == LlmMode::Off {
            cleaned = text.to_string();
        } else if mode == LlmMode::Cleanup
            && !crate::llm::needs_cleanup(text, timestamps, durations)
        {
            // Skip the LLM on transcripts that look clean: the pass costs
            // seconds and unconstrained rewriting regresses good output.
            eprintln!("[pipeline] cleanup gate: skipped (looks clean)");
            cleaned = text.to_string();
        } else if let Some(llm) = &mut self.llm {
            // Clamp to what this backend can actually echo back (keep the tail
            // = most recent speech) instead of failing opaquely in decode. The
            // old flat 1200 bytes fit ~180 words, but the local model's
            // 128-token completion returns only ~95, so long transcripts were
            // being truncated into deletion errors.
            let max_bytes = crate::llm::max_transcript_bytes(llm.backend);
            let transcript = if text.len() > max_bytes {
                eprintln!(
                    "[pipeline] transcript truncated for LLM ({} -> {} bytes)",
                    text.len(),
                    max_bytes
                );
                let mut start = text.len() - max_bytes;
                while !text.is_char_boundary(start) {
                    start += 1;
                }
                &text[start..]
            } else {
                text
            };
            let prompt = crate::llm::build_prompt(transcript, mode);
            let _ = app.emit("llm_start", serde_json::json!({}));

            let collected = Arc::new(std::sync::Mutex::new(String::new()));
            let collected_clone = collected.clone();
            let app_for_callback = app.clone();

            let result = llm.stream_cleanup(&prompt, move |token| {
                let _ = app_for_callback.emit("llm_token", serde_json::json!({ "token": token }));
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

        // Fillers come out deterministically, whatever produced `cleaned` —
        // including the skip and Off paths — so filler removal no longer
        // depends on the model, which is prone to eating real words next to them.
        let cleaned = crate::llm::strip_fillers(&cleaned);
        // ponytail: the decoder bleeds space runs onto utterance ends; trim
        // them. Internal newlines (bullet/email modes) are preserved.
        let cleaned = cleaned.trim().to_string();

        if self.config.typing_enabled {
            match type_text(&cleaned) {
                Ok(true) => {}
                // Empty text is a legitimate no-op, not a failure.
                Ok(false) if cleaned.trim().is_empty() => {}
                // The tool ran but reported failure — e.g. xdotool present
                // with no DISPLAY. Previously indistinguishable from success.
                Ok(false) => {
                    eprintln!("[pipeline] type_text ran but reported failure");
                    // ponytail: platform hint only; the tool name differs per
                    // OS and a wrong hint here already cost a debug round.
                    let hint = match std::env::consts::OS {
                        "linux" => "xdotool (X11) or wtype (Wayland)",
                        "windows" => "PowerShell clipboard+paste",
                        _ => "the system typing helper",
                    };
                    let _ = app.emit(
                        "output_error",
                        serde_json::json!({
                            "error": format!(
                                "Typing the transcript failed. Check that {hint} works in this session."
                            )
                        }),
                    );
                }
                // Spawn failure: the tool is not installed at all.
                Err(e) => {
                    eprintln!("[pipeline] type_text failed: {}", e);
                    let _ = app.emit(
                        "output_error",
                        serde_json::json!({
                            "error": format!("Could not type the transcript: {e}.")
                        }),
                    );
                }
            }
        }
        if self.config.clipboard_enabled {
            match copy_to_clipboard(&cleaned) {
                Ok(true) => {}
                Ok(false) if cleaned.is_empty() => {}
                Ok(false) => {
                    eprintln!("[pipeline] copy_to_clipboard ran but reported failure");
                    let _ = app.emit(
                        "output_error",
                        serde_json::json!({
                            "error": "Copying to the clipboard failed. Check that wl-clipboard (Wayland) or xclip (X11) works in this session."
                        }),
                    );
                }
                Err(e) => {
                    eprintln!("[pipeline] copy_to_clipboard failed: {}", e);
                    let _ = app.emit(
                        "output_error",
                        serde_json::json!({
                            "error": format!(
                                "Could not copy to the clipboard: {e}. Install wl-clipboard (Wayland) or xclip (X11)."
                            )
                        }),
                    );
                }
            }
        }

        let db_path = history_db_path();
        let _ = save_to_history(&cleaned, text, mode.as_str(), "floure", &db_path);
    }
}

/// Decode one VAD segment and run it through LLM cleanup → typing /
/// clipboard / history. Shared by the live loop and the stop-flush.
fn transcribe_segment(
    segment: &[f32],
    parakeet: &Option<ParakeetRecognizer>,
    whisper: &Option<WhisperRecognizer>,
    hotwords: &str,
    llm_processor: &mut LlmProcessor,
    app: &tauri::AppHandle,
) {
    let start = Instant::now();
    eprintln!(
        "[pipeline] transcribing segment ({} samples)",
        segment.len()
    );
    let (text, timestamps, durations) = if let Some(rec) = parakeet {
        let decoded = if hotwords.is_empty() {
            rec.transcribe_full(segment)
        } else {
            rec.transcribe_full_with_hotwords(segment, hotwords)
        };
        match decoded {
            Some(r) => (
                r.text.clone(),
                r.timestamps.clone().unwrap_or_default(),
                r.durations.clone().unwrap_or_default(),
            ),
            None => (String::new(), Vec::new(), Vec::new()),
        }
    } else if let Some(ws) = whisper {
        (ws.transcribe(segment), Vec::new(), Vec::new())
    } else {
        (String::new(), Vec::new(), Vec::new())
    };
    let latency_ms = start.elapsed().as_millis() as u64;
    eprintln!("[pipeline] transcribed in {latency_ms}ms: {text:?}");

    // ponytail: trim-guard, not is_empty — VAD noise segments decode to
    // whitespace (" "), which must never emit, type, or save as rows.
    if text.trim().is_empty() {
        return;
    }
    let _ = app.emit(
        "asr_final",
        serde_json::json!({
            "text": text,
            "latency_ms": latency_ms,
        }),
    );
    llm_processor.process(&text, &timestamps, &durations, app);
}

/// Build ASR recognizers for this config. Returns the pair plus whether the
/// language check passed (false = wrong-language whisper, caller must abort).
/// Emits `asr_ready` / `asr_error`, so start-up warm-up announces readiness
/// through the same channel as a first press.
fn build_recognizers(
    config: &AppConfig,
    app: &tauri::AppHandle,
) -> (
    Option<ParakeetRecognizer>,
    Option<WhisperRecognizer>,
    bool,
) {
    let model_id = config.asr_profile.model_id();
    let model_dir = config.asr_profile.model_dir(&config.model_dir);
    let mut parakeet: Option<ParakeetRecognizer> = None;
    let mut whisper: Option<WhisperRecognizer> = None;

    if verify_model(&config.model_dir, find_model(model_id).unwrap()) {
        match config.asr_profile {
            crate::config::AsrProfile::Parakeet => {
                // No vocabulary means no biasing: greedy search is
                // faster and the bench baseline shows it is not less
                // accurate without hotwords.
                let built = if config.hotwords.is_empty() {
                    ParakeetRecognizer::new(&model_dir, 4, false)
                } else {
                    ParakeetRecognizer::new_biased(&model_dir, 4, false)
                };
                match built {
                    Ok(r) => {
                        parakeet = Some(r);
                        let _ = app.emit(
                            "asr_ready",
                            serde_json::json!({ "backend": "parakeet" }),
                        );
                    }
                    Err(e) => {
                        let _ =
                            app.emit("asr_error", serde_json::json!({"error": e.to_string()}));
                    }
                }
            }
            crate::config::AsrProfile::WhisperTurbo | crate::config::AsrProfile::WhisperBase => {
                match WhisperRecognizer::new(&model_dir, 4, false) {
                    Ok(mut r) => {
                        if let Err(e) = r.set_language(&config.language) {
                            let _ = app.emit(
                                "asr_error",
                                serde_json::json!({"error": e.to_string()}),
                            );
                            // Don't advertise readiness: the recognizer
                            // would transcribe in the wrong language.
                            return (None, None, false);
                        }
                        whisper = Some(r);
                        let _ =
                            app.emit("asr_ready", serde_json::json!({ "backend": "whisper" }));
                    }
                    Err(e) => {
                        let _ =
                            app.emit("asr_error", serde_json::json!({"error": e.to_string()}));
                    }
                }
            }
        }
    } else {
        let _ = app.emit(
            "asr_error",
            serde_json::json!({"error": format!("Model {} not downloaded", model_id)}),
        );
    }
    (parakeet, whisper, true)
}

/// Preload ASR + LLM engines once at startup so the first press never pays
/// model-load latency (which pegged the CPU and made the app look hung).
/// Skips when models are missing (first press downloads as before) or a
/// press is already active (that press populates the cache instead).
/// A press landing mid-warm simply builds its own set; the overlap falls
/// back gracefully and the next press hits the cache.
pub fn warm_engines(app: tauri::AppHandle, config: AppConfig) {
    WARMING.store(true, Ordering::SeqCst);
    let _guard = WarmGuard;
    let key = engine_key(&config);
    if ENGINE_CACHE
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|c| c.key == key)
    {
        return;
    }
    if get_running_flag().load(Ordering::SeqCst) {
        return;
    }
    let vad_ok = MODEL_MANIFEST
        .iter()
        .find(|m| m.id == "silero-vad")
        .map(|m| verify_model(&config.model_dir, m))
        .unwrap_or(false);
    let asr_ok = find_model(config.asr_profile.model_id())
        .map(|m| verify_model(&config.model_dir, m))
        .unwrap_or(false);
    if !(vad_ok && asr_ok) {
        return;
    }
    eprintln!("[pipeline] warming engines in background");
    let (parakeet, whisper, _) = build_recognizers(&config, &app);
    let llm = LlmProcessor::new(config.clone()).into_llm();
    store_engines(key, parakeet, whisper, llm);
    eprintln!("[pipeline] engines warm");
}

pub struct PipelineController {
    running: Arc<AtomicBool>,
    app: tauri::AppHandle,
    config: AppConfig,
    silero_path: PathBuf,
    #[allow(dead_code)]
    model_dir: PathBuf,
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
            model_dir, config.asr_profile, silero_valid
        );

        if !silero_valid {
            if silero_path.exists() {
                std::fs::remove_file(&silero_path)?;
                eprintln!("[pipeline] removed invalid silero VAD file, re-downloading");
            }
            std::fs::create_dir_all(model_dir.join("silero-vad"))?;
            let model_dir_dl = model_dir.join("silero-vad");
            // Surface progress to the frontend: start_listening blocks on
            // this download, so a silent no-op callback leaves the UI hung
            // with no feedback on first run.
            let app_dl = app.clone();
            let result = download_model(vad_manifest, &model_dir_dl, |percent, bytes| {
                let _ = app_dl.emit(
                    "model_download_progress",
                    serde_json::json!({"id": vad_manifest.id, "percent": percent, "bytes": bytes}),
                );
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
            // A fetch already running (earlier PTT press, Models-page
            // button) owns the resume file — don't spawn a second writer
            // that download_model would only reject.
            if crate::models::is_downloading(&asr_dir) {
                running.store(false, Ordering::SeqCst);
                return Err(anyhow::anyhow!("ASR model {} still downloading in background — retry when the Models page shows 100%", asr_model_id));
            }
            std::fs::create_dir_all(&asr_dir)?;
            eprintln!(
                "[pipeline] ASR model {} missing, downloading in background to {}",
                asr_model_id,
                asr_dir.display()
            );
            // Never block the Tauri command on a ~500MB download (it hangs
            // the backend until the last byte). Fetch on a worker thread and
            // fail fast: the Models page shows live progress, retry start
            // when it reports done.
            let app_dl = app.clone();
            std::thread::spawn(move || {
                let res = download_model(asr_manifest, &asr_dir, |percent, bytes| {
                    let _ = app_dl.emit(
                        "model_download_progress",
                        serde_json::json!({"id": asr_manifest.id, "percent": percent, "bytes": bytes}),
                    );
                });
                match res {
                    Ok(()) => {
                        let _ = app_dl.emit(
                            "model_download_progress",
                            serde_json::json!({"id": asr_manifest.id, "percent": 100, "done": true}),
                        );
                        eprintln!("[pipeline] ASR model {} ready", asr_manifest.id);
                    }
                    Err(e) => {
                        eprintln!("[pipeline] ASR model download FAILED: {}", e);
                        let _ = app_dl.emit(
                            "asr_error",
                            serde_json::json!({"error": format!("Failed to download ASR model: {}", e)}),
                        );
                    }
                }
            });
            running.store(false, Ordering::SeqCst);
            return Err(anyhow::anyhow!("ASR model {} not downloaded yet — downloading in background, retry when the Models page shows 100%", asr_model_id));
        }

        Ok(Self {
            running,
            app,
            config,
            silero_path,
            model_dir,
        })
    }

    pub fn start(&self) -> Result<()> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Err(anyhow::anyhow!("Pipeline already running"));
        }
        // Claim a run id: this is what a stale worker checks, and a later
        // start (below) mints a new one, so the old worker never comes back.
        let run_id = begin_run();

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

        let audio =
            match crate::audio::start_capture(mic_name.as_deref(), move |samples: &[f32]| {
                let _ = tx.send(samples.to_vec());
            }) {
                Ok(a) => {
                    eprintln!(
                        "[pipeline] capturing from {:?} @ {}Hz",
                        mic_name.as_deref().unwrap_or("<default>"),
                        a.sample_rate
                    );
                    a
                }
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

        let handle = std::thread::spawn(move || {
            let _audio = audio;

            let resampler: Option<sherpa_onnx::LinearResampler> = if mic_sample_rate != 16000 {
                sherpa_onnx::LinearResampler::create(mic_sample_rate as i32, 16000)
            } else {
                None
            };

            // Take warm engines when the config matches. On a key mismatch the
            // old set is dropped first (frees its backend) so the fresh
            // build below can init without hitting BackendAlreadyInitialized.
            let key = engine_key(&config_clone);
            let taken = ENGINE_CACHE.lock().unwrap().take();
            let fresh = taken.as_ref().map(|c| c.key != key).unwrap_or(true);
            if !fresh {
                eprintln!("[pipeline] reusing warm engines");
            }
            let (mut parakeet, mut whisper, cached_llm) = match taken {
                Some(c) if !fresh => (c.parakeet, c.whisper, c.llm),
                _ => (None, None, None),
            };

            let mut vad = match VoiceActivityDetector::new(&silero_path, 0.5) {
                Ok(v) => v,
                Err(e) => {
                    let _ =
                        app_clone.emit("asr_error", serde_json::json!({"error": e.to_string()}));
                    store_engines(key, parakeet, whisper, cached_llm);
                    return;
                }
            };

            // Owns LLM cleanup/typing/clipboard/history for this worker thread.
            // Created here (rather than moved from the controller) so inference
            // stays on the thread that uses it. Reuses the cached model when
            // the config matches, so repeat presses skip the ~1GB reload.
            let mut llm_processor = match cached_llm {
                Some(llm) => LlmProcessor::from_cached(config_clone.clone(), Some(llm)),
                None => LlmProcessor::new(config_clone.clone()),
            };

            if fresh {
                let (p, w, lang_ok) = build_recognizers(&config_clone, &app_clone);
                parakeet = p;
                whisper = w;
                if !lang_ok {
                    running_clone.store(false, Ordering::SeqCst);
                    return;
                }
            } else if let Some(ref mut ws) = whisper {
                // Warm recognizer: re-check the language (no-op when
                // unchanged) so a settings change applies without a rebuild.
                if let Err(e) = ws.set_language(&config_clone.language) {
                    let _ = app_clone.emit(
                        "asr_error",
                        serde_json::json!({"error": e.to_string()}),
                    );
                    running_clone.store(false, Ordering::SeqCst);
                    return;
                }
            }

            // Live mic meter for the widget (max ~15Hz). Doubles as proof the
            // mic delivers signal: flat zero here means a device problem,
            // not a pipeline problem.
            let mut last_level = Instant::now()
                .checked_sub(Duration::from_millis(100))
                .unwrap_or_else(Instant::now);

            // Feed one chunk through VAD → ASR → LLM → output.
            let mut pump = |samples: &[f32]| {
                let resampled: Vec<f32> = if let Some(ref r) = resampler {
                    r.resample(samples, false)
                } else {
                    samples.to_vec()
                };
                if last_level.elapsed() >= Duration::from_millis(66) {
                    last_level = Instant::now();
                    let n = resampled.len().max(1);
                    let level = (resampled.iter().map(|s| s * s).sum::<f32>() / n as f32)
                        .sqrt()
                        .clamp(0.0, 1.0);
                    let _ = app_clone.emit("mic_level", level);
                }
                vad.feed(&resampled);
                if let Some(segment) = vad.try_get_segment() {
                    transcribe_segment(
                        &segment,
                        &parakeet,
                        &whisper,
                        &config_clone.hotwords,
                        &mut llm_processor,
                        &app_clone,
                    );
                }
                vad.reset_after_segment();
            };

            loop {
                if !run_is_current(run_id) {
                    // Superseded by a newer press: exit quietly without
                    // flushing — the successor owns typing now, and a flush
                    // here would duplicate text into the focused window.
                    break;
                }
                // Check every iteration, not just on timeout: the mic streams
                // continuously, so with audio flowing the timeout arm never
                // fires and a timeout-only check wedges the worker forever.
                if !running_clone.load(Ordering::SeqCst) {
                    // Stopped mid-utterance: drain leftover audio, then
                    // force-close the trailing segment with silence so
                    // the last words are still transcribed and typed.
                    while let Ok(samples) = rx.try_recv() {
                        pump(&samples);
                    }
                    pump(&vec![0.0f32; 8000]);
                    break;
                }
                match rx.recv_timeout(std::time::Duration::from_millis(50)) {
                    Ok(samples) => pump(&samples),
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }

            // Hand warm engines back for the next press.
            store_engines(key, parakeet, whisper, llm_processor.into_llm());
        });
        // Reap any previous worker first: two live workers would overlap
        // their LLM backends (see WORKER). Normally absent (stop joins).
        if let Some(old) = WORKER.lock().unwrap().replace(handle) {
            let _ = old.join();
        }

        Ok(())
    }
}

pub fn start_pipeline(app: tauri::AppHandle, config: AppConfig) -> Result<()> {
    let controller = PipelineController::new(app.clone(), config.clone())?;
    controller.start()?;
    Ok(())
}

pub fn stop_pipeline() {
    // Invalidate the current run *and* clear the flag. Clearing alone was the
    // bug: the worker re-reads this same flag every loop, so the next start
    // setting it true again revived a worker that was still finishing the
    // previous utterance.
    let _ = begin_run();
    if let Some(flag) = PIPELINE_RUNNING.get() {
        flag.store(false, Ordering::SeqCst);
    }
    // Join the worker so its stop-flush (transcribe tail → type) and engine
    // hand-back finish before the next press spawns a new worker.
    if let Some(handle) = WORKER.lock().unwrap().take() {
        eprintln!("[pipeline] stop: joining worker");
        let _ = handle.join();
        eprintln!("[pipeline] stop: worker joined");
    }
}

#[cfg(test)]
mod run_id_tests {
    use super::{begin_run, run_is_current};

    /// The regression this id exists for: a stop then a start must leave the
    /// old run dead even though the shared flag goes true again afterwards.
    #[test]
    fn a_later_run_never_revives_an_earlier_one() {
        let first = begin_run();
        assert!(run_is_current(first));

        let _ = begin_run(); // stop_pipeline
        assert!(!run_is_current(first), "stop must invalidate the run");

        let second = begin_run(); // start_pipeline
        assert!(
            !run_is_current(first),
            "the old run must stay dead after a later start"
        );
        assert!(run_is_current(second));
    }
}
