use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum LlmMode {
    #[serde(rename = "off")]
    Off,
    #[serde(rename = "cleanup")]
    #[default]
    Cleanup,
    #[serde(rename = "bullet_list")]
    BulletList,
    #[serde(rename = "email")]
    Email,
    #[serde(rename = "commit_message")]
    CommitMessage,
}

impl LlmMode {
    /// Storage/display label used in the history DB `mode` column.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Cleanup => "cleanup",
            Self::BulletList => "bullet_list",
            Self::Email => "email",
            Self::CommitMessage => "commit_message",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum LlmBackend {
    Local,
    OpenRouter,
}

static OPENROUTER_API_KEY: std::sync::OnceLock<std::sync::Mutex<Option<String>>> =
    std::sync::OnceLock::new();

/// Session-only OpenRouter key, set from the UI via `set_openrouter_api_key`.
/// Never written to disk; the `OPENROUTER_API_KEY` env var is the fallback.
pub fn set_openrouter_api_key(key: String) {
    let slot = OPENROUTER_API_KEY.get_or_init(|| std::sync::Mutex::new(None));
    *slot.lock().unwrap() = if key.trim().is_empty() {
        None
    } else {
        Some(key)
    };
}

pub(crate) fn openrouter_api_key() -> Option<String> {
    if let Some(slot) = OPENROUTER_API_KEY.get() {
        if let Some(key) = slot.lock().unwrap().clone() {
            return Some(key);
        }
    }
    std::env::var("OPENROUTER_API_KEY").ok()
}

pub const CLEANUP_PROMPT: &str =
    "Fix only clear errors in this transcript: remove filler words (um, uh), \
fix obviously misheard words, add any missing punctuation and capitalization. \
Preserve technical terms and all other wording. \
Do not add or delete words: the output must contain the same number of words \
as the input, apart from removed filler words. \
If a word looks technical or rare, keep it exactly as given; never replace it \
with a more common word. \
If the transcript is already correct, return it unchanged. \
IMPORTANT: Return ONLY the transcript text. \
Do NOT add any labels, headers, commentary, safety ratings, or explanations.";

pub const BULLET_PROMPT: &str = "Convert the following microphone transcript into a clean, \
well-structured bulleted list. Group related points together. \
Return only the bullet list with no preamble.";

pub const EMAIL_PROMPT: &str =
    "Rewrite the following microphone transcript as a professional email. \
Add a short subject line in brackets at the top. \
Return only the email body with no extra preamble.";

pub const COMMIT_PROMPT: &str =
    "Convert the following microphone transcript into a git commit message. \
Use conventional commit format (type: short description). \
Keep the subject line under 72 characters. \
Return only the commit message with no preamble.";

fn mode_instruction(mode: LlmMode) -> &'static str {
    match mode {
        LlmMode::Off => "",
        LlmMode::Cleanup => CLEANUP_PROMPT,
        LlmMode::BulletList => BULLET_PROMPT,
        LlmMode::Email => EMAIL_PROMPT,
        LlmMode::CommitMessage => COMMIT_PROMPT,
    }
}

/// The longest transcript the cleanup pass will accept; anything longer is
/// left untouched rather than cleaned.
///
/// The local path is bounded by its own budgets — 512 context tokens and a
/// 128-token completion, i.e. roughly 95 words that can come back. Ask it for
/// more and the completion truncates (deletion errors, Ma et al. 2023), and
/// because the model's output *replaces* the whole transcript, sending it a
/// clipped fragment would silently drop the part you clipped. See
/// `docs/voice-algorithms/cleanup/llm-cleanup-and-disfluency.md` (§5.3).
pub fn max_transcript_bytes(backend: LlmBackend) -> usize {
    if backend == LlmBackend::Local {
        512
    } else {
        1200
    }
}

pub fn build_prompt(transcript: &str, mode: LlmMode) -> String {
    let instruction = mode_instruction(mode);
    if instruction.is_empty() {
        return transcript.to_string();
    }

    format!("{}\n\nTranscript:\n{}", instruction, transcript)
}

/// Conservative skip-gate for the Cleanup pass: rewriting already-clean
/// transcripts hurts (Idiap 2024: Whisper-Large-v3 2.78% → 3.21% after
/// unconstrained GPT correction), and our Parakeet output is already
/// cased/punctuated. Only Cleanup mode is gated — Bullet/Email/Commit are
/// explicit generative requests. Fires on filler words, repeated
/// words/bigrams (disfluency/hallucination signature), or alignment
/// anomalies (long gaps, stuck tokens); everything else passes through.
/// Filler words. The set matches what OpenAI's official English normalizer
/// strips before it scores WER (`whisper/normalizers/english.py`), so removing
/// them costs nothing at eval time — and they are never wanted in typed output.
const FILLERS: &[&str] = &[
    "um", "uh", "uhh", "umm", "hmm", "mm", "mhm", "mmm", "ah", "er",
];

/// Whether a whitespace-delimited token is a filler, ignoring punctuation
/// attached to it ("Um," and "um" both match).
fn is_filler(word: &str) -> bool {
    let core = word
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase();
    FILLERS.contains(&core.as_str())
}

/// Strip filler words deterministically, preserving line structure.
///
/// Deliberately outside the model: filler removal is most of what the cleanup
/// prompt asks for, and a model asked to do it has a measured tendency to
/// delete neighbouring real words along with the fillers (Ma et al. 2023).
pub fn strip_fillers(text: &str) -> String {
    text.split('\n')
        .map(|line| {
            line.split_whitespace()
                .filter(|w| !is_filler(w))
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

pub fn needs_cleanup(text: &str, timestamps: &[f32], durations: &[f32]) -> bool {
    let words: Vec<String> = text
        .split_whitespace()
        .map(|w| {
            w.trim_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase()
        })
        .filter(|w| !w.is_empty())
        .collect();
    if words.len() <= 2 {
        return false;
    }
    if words.iter().any(|w| FILLERS.contains(&w.as_str())) {
        return true;
    }
    if words.windows(2).any(|w| w[0] == w[1]) {
        return true;
    }
    if words.windows(4).any(|w| w[0..2] == w[2..4]) {
        return true;
    }
    if timestamps.windows(2).any(|t| t[1] - t[0] > 1.5) {
        return true;
    }
    if durations.iter().any(|&d| d > 1.0) {
        return true;
    }
    false
}

pub fn clean_response(text: &str) -> String {
    text.lines()
        .filter(|line| {
            let trimmed = line.trim();
            !trimmed.is_empty()
                && !trimmed.starts_with('<')
                && !trimmed.starts_with('[')
                && !trimmed.starts_with("Note:")
                && !trimmed.starts_with("Here")
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

use llama_cpp_4::prelude::*;

pub struct LlmCleanup {
    pub backend: LlmBackend,
    backend_handle: Option<LlamaBackend>,
    local_model: Option<LlamaModel>,
    api_key: Option<String>,
}

impl LlmCleanup {
    pub fn new(backend: LlmBackend, model_path: Option<&Path>) -> Result<Self> {
        let backend_handle = if backend == LlmBackend::Local {
            Some(LlamaBackend::init()?)
        } else {
            None
        };

        let local_model = if backend == LlmBackend::Local {
            if let Some(path) = model_path {
                if path.exists() {
                    // GPU-first: offload all layers to the detected GPU via
                    // the Vulkan backend (works on NVIDIA and AMD without a
                    // CUDA toolkit). Falls back to CPU when no GPU is found.
                    let compute = crate::compute::detect();
                    eprintln!("[llm] compute device: {}", compute.as_str());
                    let mut model_params = LlamaModelParams::default();
                    if compute.use_gpu() {
                        let gpu = crate::compute::main_gpu();
                        eprintln!("[llm] offloading layers to GPU (main_gpu={})", gpu);
                        model_params = model_params.with_n_gpu_layers(999).with_main_gpu(gpu);
                    } else {
                        // The wrapper default is n_gpu_layers=-1 (all
                        // layers); pin to 0 so FLOURE_COMPUTE=cpu (or a
                        // GPU-less host) can never silently offload.
                        eprintln!("[llm] CPU path: keeping all layers on CPU");
                        model_params = model_params.with_n_gpu_layers(0);
                    }
                    let model = LlamaModel::load_from_file(
                        backend_handle.as_ref().unwrap(),
                        path,
                        &model_params,
                    )?;
                    // Log every ggml device so load logs can confirm which
                    // physical GPU received the layers.
                    for dev in model.devices() {
                        let (free, total) = dev.memory();
                        eprintln!(
                            "[llm] device: name={} type={:?} free={}MB total={}MB desc={}",
                            dev.name().unwrap_or("?"),
                            dev.device_type(),
                            free / 1024 / 1024,
                            total / 1024 / 1024,
                            dev.description().unwrap_or("?"),
                        );
                    }
                    Some(model)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        let api_key = match backend {
            LlmBackend::OpenRouter => openrouter_api_key(),
            LlmBackend::Local => None,
        };

        Ok(Self {
            backend,
            backend_handle,
            local_model,
            api_key,
        })
    }

    fn endpoint_url(&self) -> Option<&'static str> {
        match self.backend {
            LlmBackend::OpenRouter => Some("https://openrouter.ai/api/v1/chat/completions"),
            LlmBackend::Local => None,
        }
    }

    fn cloud_model(&self) -> String {
        match self.backend {
            LlmBackend::OpenRouter => std::env::var("OPENROUTER_MODEL")
                .ok()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "openai/gpt-4o-mini".to_string()),
            LlmBackend::Local => String::new(),
        }
    }

    pub fn stream_cleanup<F: FnMut(String) + Send + 'static>(
        &mut self,
        prompt: &str,
        callback: F,
    ) -> Result<()> {
        if self.backend == LlmBackend::Local {
            self.stream_local(prompt, callback)
        } else {
            self.stream_cloud(prompt, callback)
        }
    }

    fn stream_local<F: FnMut(String) + Send + 'static>(
        &mut self,
        prompt: &str,
        mut callback: F,
    ) -> Result<()> {
        let backend = self
            .backend_handle
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Local LLM backend not initialized"))?;

        let model = self
            .local_model
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Local LLM model not loaded"))?;

        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(std::num::NonZeroU32::new(512))
            .with_n_threads(crate::compute::inference_threads() as i32);
        let mut ctx = model.new_context(backend, ctx_params)?;
        let mut batch = LlamaBatch::new(512, 1);

        // Wrap the cleanup instruction in the model's own chat template
        // (Qwen3 `<|im_start|>` framing for S1-Mini, Gemma turns for Gemma).
        // Without this the model doesn't know where its answer should end
        // and rambles past EOS. `add_assistant=true` appends the assistant
        // header so generation starts as the reply.
        let chat = vec![
            LlamaChatMessage::new("user".to_string(), prompt.to_string())
                .map_err(|e| anyhow::anyhow!("chat message: {}", e))?,
        ];
        let formatted = model
            .apply_chat_template(None, &chat, true)
            .map_err(|e| anyhow::anyhow!("chat template: {}", e))?;

        let tokens = model.str_to_token(&formatted, AddBos::Always)?;
        eprintln!("[llm] prompt tokens: {}", tokens.len());

        // Decode the full prompt — only the last token needs logits.
        let prompt_t0 = std::time::Instant::now();
        for (i, &tok) in tokens.iter().enumerate() {
            batch.add(tok, i as i32, &[0], i == tokens.len() - 1)?;
        }
        ctx.decode(&mut batch)?;
        eprintln!(
            "[llm] prompt decoded in {}ms",
            prompt_t0.elapsed().as_millis()
        );

        // Sampler index is batch-relative (position within the last decoded
        // batch), NOT the absolute KV-cache position. The prompt batch holds
        // N tokens with logits on the last one; every follow-up batch holds
        // a single token at batch index 0.
        let mut idx = tokens.len() as i32 - 1;
        let mut n_pos = tokens.len() as i32 - 1;
        let sampler = LlamaSampler::greedy();
        let eos_token = model.token_eos();
        let max_new_tokens = 128;
        let mut generated = 0;
        let gen_t0 = std::time::Instant::now();

        loop {
            let token = sampler.sample(&ctx, idx);

            // Stop before emitting: the EOS piece (e.g. `<|im_end|>`) is a
            // control token, not transcript text.
            if token == eos_token || generated >= max_new_tokens {
                break;
            }

            let piece = model.token_to_bytes(token, Special::Plaintext)?;
            let s = String::from_utf8_lossy(&piece).to_string();
            callback(s);
            generated += 1;

            // Advance the KV position and decode one new token at a time.
            n_pos += 1;
            batch.clear();
            batch.add(token, n_pos, &[0], true)?;
            ctx.decode(&mut batch)?;
            idx = 0; // single-token batch: the token sits at batch index 0
        }

        eprintln!(
            "[llm] done, generated {} tokens in {}ms ({:.1} tok/s)",
            generated,
            gen_t0.elapsed().as_millis(),
            generated as f64 / gen_t0.elapsed().as_secs_f64().max(1e-6),
        );
        Ok(())
    }

    fn stream_cloud<F: FnMut(String) + Send + 'static>(
        &mut self,
        prompt: &str,
        mut callback: F,
    ) -> Result<()> {
        // Read the *live* session key: engines are cached across presses, so
        // the copy captured in `new` is whatever existed at warm-up — which
        // runs before the UI has entered a key, and `engine_key` does not
        // include it. Without this, cloud cleanup fails with "API key not set"
        // until a restart or a provider/model change rebuilds the engine. The
        // stored copy stays as the fallback for a key set at construction.
        let api_key = self
            .api_key
            .clone()
            .or_else(openrouter_api_key)
            .ok_or_else(|| anyhow::anyhow!("API key not set"))?;

        let url = self
            .endpoint_url()
            .ok_or_else(|| anyhow::anyhow!("Invalid backend"))?;

        let body = serde_json::json!({
            "model": self.cloud_model(),
            "stream": true,
            "messages": [{"role": "user", "content": prompt}]
        });

        let api_key = api_key.clone();

        let response = reqwest::blocking::Client::new()
            .post(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| anyhow::anyhow!("HTTP request failed: {}", e))?;

        use std::io::Read;

        let mut reader = response;
        let mut buffer = String::new();
        let mut pending: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 8 * 1024];

        loop {
            let n = reader
                .read(&mut chunk)
                .map_err(|e| anyhow::anyhow!("Stream error: {}", e))?;
            if n == 0 {
                break;
            }
            pending.extend_from_slice(&chunk[..n]);

            let (text, remainder) = split_utf8(&pending);
            pending = remainder;

            for token in drain_sse_buffer(&mut buffer, &text) {
                callback(token);
            }
        }
        // Flush any trailing line without a newline terminator.
        for token in drain_sse_buffer(&mut buffer, "\n") {
            callback(token);
        }

        Ok(())
    }
}

/// Split `pending` at the last complete UTF-8 boundary, returning the
/// decodable prefix and the trailing bytes to carry into the next read.
///
/// A multi-byte character straddling two network reads must not be decoded
/// in halves — `String::from_utf8_lossy` would turn it into U+FFFD and
/// corrupt non-ASCII transcripts.
fn split_utf8(pending: &[u8]) -> (String, Vec<u8>) {
    match std::str::from_utf8(pending) {
        Ok(s) => (s.to_string(), Vec::new()),
        Err(e) => {
            let valid = e.valid_up_to();
            // valid_up_to() is always a char boundary, so this cannot fail.
            let text = std::str::from_utf8(&pending[..valid])
                .unwrap_or_default()
                .to_string();
            (text, pending[valid..].to_vec())
        }
    }
}

/// Extract the delta text from a single SSE line.
///
/// Handles OpenAI-compatible chunks: strips an optional `data:` prefix,
/// skips `[DONE]` sentinels / empty lines / SSE comments, and returns
/// `choices[0].delta.content` when present. Returns `None` when the line
/// carries no token text.
fn extract_delta_content(line: &str) -> Option<String> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    // SSE comments (keep-alive `: ...`) carry no data.
    if line.starts_with(':') {
        return None;
    }
    let data = if let Some(rest) = line.strip_prefix("data:") {
        rest.trim()
    } else if line.starts_with('{') {
        // Lenient: accept bare JSON lines (some proxies strip the prefix).
        line
    } else {
        return None;
    };
    if data.is_empty() || data == "[DONE]" {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(data).ok()?;
    value
        .get("choices")?
        .get(0)?
        .get("delta")?
        .get("content")?
        .as_str()
        .map(|s| s.to_string())
}

/// Append `chunk_text` to `buffer`, extract complete `\n`-terminated lines,
/// and return the parsed token texts. Any incomplete trailing line stays in
/// `buffer` for the next chunk.
fn drain_sse_buffer(buffer: &mut String, chunk_text: &str) -> Vec<String> {
    buffer.push_str(chunk_text);
    let mut tokens = Vec::new();
    while let Some(pos) = buffer.find('\n') {
        let line: String = buffer.drain(..=pos).collect();
        if let Some(token) = extract_delta_content(&line) {
            if !token.is_empty() {
                tokens.push(token);
            }
        }
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_fillers_drops_fillers_only() {
        assert_eq!(
            strip_fillers("um so I think we should ship"),
            "so I think we should ship"
        );
        // Punctuation-attached and mid-line fillers go; everything else stays.
        assert_eq!(
            strip_fillers("so, uh, the plan is: ship it"),
            "so, the plan is: ship it"
        );
        assert_eq!(strip_fillers("Um, uh! mhm"), "");
        assert_eq!(strip_fillers("no fillers here"), "no fillers here");
        // Real words that merely contain a filler sequence are not fillers.
        assert_eq!(
            strip_fillers("hardware and memorandum"),
            "hardware and memorandum"
        );
    }

    #[test]
    fn local_clamp_matches_the_completion_budget() {
        assert_eq!(max_transcript_bytes(LlmBackend::Local), 512);
        assert_eq!(max_transcript_bytes(LlmBackend::OpenRouter), 1200);
    }

    #[test]
    fn cleanup_prompt_constrains_word_count() {
        assert!(CLEANUP_PROMPT.contains("same number of words"));
        assert!(CLEANUP_PROMPT.contains("never replace it"));
        assert!(CLEANUP_PROMPT.contains("unchanged"));
    }

    #[test]
    fn gate_skips_clean_transcript() {
        let ts: Vec<f32> = (0..10).map(|i| i as f32 * 0.3).collect();
        let du = vec![0.2; 10];
        assert!(!needs_cleanup(
            "The metal forest is in the great domed cavern.",
            &ts,
            &du
        ));
    }

    #[test]
    fn gate_skips_short_and_empty() {
        assert!(!needs_cleanup("", &[], &[]));
        assert!(!needs_cleanup("Call John", &[], &[]));
    }

    #[test]
    fn gate_fires_on_filler_and_repeats() {
        assert!(needs_cleanup("Um call John on Friday please", &[], &[]));
        assert!(needs_cleanup("Call the the doctor tomorrow", &[], &[]));
        assert!(needs_cleanup("Go to the to the store now", &[], &[]));
    }

    #[test]
    fn gate_fires_on_alignment_anomalies() {
        assert!(needs_cleanup(
            "The metal forest is in the cavern today here",
            &[0.0, 0.3, 2.5, 2.8, 3.1, 3.4, 3.7, 4.0, 4.3],
            &[0.2; 9]
        ));
        assert!(needs_cleanup(
            "The metal forest is in the cavern today here",
            &[0.0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4],
            &[0.2, 0.2, 2.5, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]
        ));
    }

    #[test]
    fn cleanup_prompt_is_constrained() {
        assert!(CLEANUP_PROMPT.contains("unchanged"));
    }

    #[test]
    fn extracts_delta_content_from_data_line() {
        let line = r#"data: {"choices":[{"delta":{"content":"hello"}}]}"#;
        assert_eq!(extract_delta_content(line).as_deref(), Some("hello"));
    }

    #[test]
    fn skips_done_empty_and_comment_lines() {
        assert_eq!(extract_delta_content("data: [DONE]"), None);
        assert_eq!(extract_delta_content(""), None);
        assert_eq!(extract_delta_content(": keep-alive"), None);
        assert_eq!(
            extract_delta_content(r#"data: {"choices":[{"delta":{}}]}"#),
            None
        );
    }

    #[test]
    fn buffers_incomplete_lines_across_chunks() {
        let mut buffer = String::new();
        let first = drain_sse_buffer(
            &mut buffer,
            "data: {\"choices\":[{\"delta\":{\"content\":\"hel",
        );
        assert!(first.is_empty());
        assert!(!buffer.is_empty());
        let second = drain_sse_buffer(&mut buffer, "lo\"}}]}\n\ndata: [DONE]\n");
        assert_eq!(second, vec!["hello".to_string()]);
        assert!(buffer.is_empty());
    }

    #[test]
    fn utf8_split_keeps_partial_multibyte_char() {
        // "नमस्ते" — the first char is 3 bytes. Feed only 2 of them and the
        // leftover byte must be carried, not decoded as U+FFFD.
        let text = "नमस्ते";
        let bytes = text.as_bytes();
        let (head, tail) = split_utf8(&bytes[..2]);
        assert_eq!(head, "");
        assert_eq!(tail.len(), 2, "partial char must be carried over");

        // Completing the character decodes the full string.
        let mut joined = tail;
        joined.extend_from_slice(&bytes[2..]);
        let (full, rest) = split_utf8(&joined);
        assert_eq!(full, text);
        assert!(rest.is_empty());
    }

    #[test]
    fn utf8_split_passes_through_ascii_and_complete_input() {
        let (text, rest) = split_utf8(b"data: hello\n");
        assert_eq!(text, "data: hello\n");
        assert!(rest.is_empty());
    }
}
