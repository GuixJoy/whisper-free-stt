"""Transcription — whisper.cpp and faster-whisper backends.

whisper.cpp (default) is 10-16x faster on CPU.
faster-whisper supports more models (distil-large-v3, turbo) and GPU.
BatchedInferencePipeline gives 4-10x additional speedup on GPU.
"""

from __future__ import annotations

import threading

import numpy as np

from stt.config import TranscriptionConfig, TranscriptionBackend
from stt.types import TranscriptionResult, TranscriptionSegment

# ---------------------------------------------------------------------------
# Model caches
# ---------------------------------------------------------------------------

_whisper_cpp_cache: dict[str, "object"] = {}  # pywhispercpp.Model
_whisper_cpp_lock = threading.Lock()             # whisper.cpp is NOT thread-safe
_faster_whisper_cache: dict[str, "object"] = {}  # faster_whisper.WhisperModel
_batched_cache: dict[str, "object"] = {}  # BatchedInferencePipeline wrappers


def _get_cpp_model(config: TranscriptionConfig):
    """Return cached whisper.cpp model."""
    from pywhispercpp.model import Model as CppModel

    key = config.model_name
    if key not in _whisper_cpp_cache:
        import os as _os
        with open(_os.devnull, "w") as _devnull:
            _whisper_cpp_cache[key] = CppModel(
                config.model_name,
                print_progress=False,
                print_realtime=False,
                redirect_whispercpp_logs_to=_devnull,
                n_threads=config.cpu_threads,
            )
    return _whisper_cpp_cache[key]


def _get_fw_model(config: TranscriptionConfig):
    """Return cached faster-whisper model."""
    from faster_whisper import WhisperModel

    key = f"{config.model_name}|{config.device}|{str(config.compute_type)}|{config.cpu_threads}"
    if key not in _faster_whisper_cache:
        _faster_whisper_cache[key] = WhisperModel(
            config.model_name,
            device=config.device,
            compute_type=config.compute_type.value,
            cpu_threads=config.cpu_threads,
        )
    return _faster_whisper_cache[key]


def _get_batched_model(config: TranscriptionConfig):
    """Return cached BatchedInferencePipeline wrapping the faster-whisper model."""
    from faster_whisper import BatchedInferencePipeline

    base_key = f"{config.model_name}|{config.device}|{config.compute_type.value}|{config.cpu_threads}"
    batched_key = f"batched|{base_key}"
    if batched_key not in _batched_cache:
        base_model = _get_fw_model(config)
        _batched_cache[batched_key] = BatchedInferencePipeline(model=base_model)
    return _batched_cache[batched_key]


# ---------------------------------------------------------------------------
# Audio pre-processing (pure)
# ---------------------------------------------------------------------------

_JUNK_TOKENS = frozenset({"[BLANK_AUDIO]", "[MUSIC]", "[NOISE]", "[INAUDIBLE]", "[SILENCE]", "[Applause]", "[Laughter]", "[Music]", "[Noise]", "[Silence]", "♪", "♫"})


def _trim_silence(audio: np.ndarray, threshold: float = 0.005) -> np.ndarray:
    """Trim trailing samples below *threshold* amplitude."""
    if len(audio) == 0:
        return audio
    above = np.where(np.abs(audio) > threshold)[0]
    if len(above) == 0:
        return audio[:0]
    end = min(len(audio), above[-1] + int(0.2 * 16000))
    return audio[:end]


def _reduce_noise(audio: np.ndarray, sr: int, config: TranscriptionConfig) -> np.ndarray:
    """Apply spectral noise gating to reduce background hum and fan noise.

    Only runs on signals with sufficient amplitude.  Costs ~10-15ms on CPU.
    """
    if not config.noise_reduce:
        return audio
    from stt.vad import compute_rms
    # Skip if signal is already clean (very low ambient RMS)
    if compute_rms(audio[: min(len(audio), sr // 2)]) < 0.001:
        return audio
    # Skip very short utterances to avoid unnecessary latency/artifacts.
    if len(audio) < int(0.8 * sr):
        return audio

    import noisereduce as nr
    try:
        return nr.reduce_noise(
            y=audio,
            sr=sr,
            prop_decrease=config.noise_reduce_prop_decrease,
            n_std_thresh_stationary=1.5,
            stationary=True,
        )
    except Exception:
        return audio  # fallback — don't lose a transcription over a filter failure


# ---------------------------------------------------------------------------
# Audio pre-processing (public — shared with orchestrator partials path)
# ---------------------------------------------------------------------------

def preprocess_audio(
    audio_data: np.ndarray,
    sample_rate: int,
    config: TranscriptionConfig,
) -> np.ndarray | None:
    """Normalize, noise-reduce, and trim silence. Returns None if unusable."""
    if len(audio_data) == 0:
        return None
    if audio_data.dtype != np.float32:
        audio_data = audio_data.astype(np.float32)
    peak = np.max(np.abs(audio_data))
    if peak > 1.0:
        audio_data = audio_data / peak
    elif peak == 0.0:
        return None
    audio_data = _reduce_noise(audio_data, sample_rate, config)
    audio_data = _trim_silence(audio_data)
    if len(audio_data) == 0:
        return None
    return audio_data


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def transcribe(
    audio_data: np.ndarray,
    sample_rate: int,
    config: TranscriptionConfig,
) -> TranscriptionResult:
    """Transcribe audio using the configured backend."""
    audio_data = preprocess_audio(audio_data, sample_rate, config)
    if audio_data is None:
        return TranscriptionResult(text="", language="")

    if config.backend is TranscriptionBackend.WHISPER_CPP:
        return _transcribe_cpp(audio_data, sample_rate, config)
    else:
        return _transcribe_fw(audio_data, sample_rate, config)


def warm_up_backend(config: TranscriptionConfig) -> None:
    """Preload model weights to avoid first-utterance cold-start latency."""
    if config.backend is TranscriptionBackend.WHISPER_CPP:
        _get_cpp_model(config)
    else:
        _get_fw_model(config)
        # Also warm up batched pipeline if batch_size > 0 or auto (GPU)
        batch_size = config.batch_size if config.batch_size > 0 else (8 if config.device == "cuda" else 0)
        if batch_size > 0:
            _get_batched_model(config)


# ---------------------------------------------------------------------------
# whisper.cpp backend
# ---------------------------------------------------------------------------

_OUTPUT_PROMPT = (
    "Clear, accurate transcription with proper punctuation and capitalization. "
    "Remove filler words like um, uh, ah. "
    "Correct obvious speech-to-text errors."
)


def _transcribe_cpp(
    audio: np.ndarray,
    sr: int,
    config: TranscriptionConfig,
) -> TranscriptionResult:
    """Transcribe via whisper.cpp — runs in a subprocess for crash isolation.

    A native segfault in whisper.cpp would kill the entire process. By running
    it in a subprocess, we survive the crash and raise a proper Python error.
    """
    import json as _json
    import os
    import subprocess
    import sys
    import tempfile

    # Save audio to temp file for the subprocess
    audio_path = None
    try:
        fd, audio_path = tempfile.mkstemp(suffix=".npy")
        os.close(fd)
        np.save(audio_path, audio, allow_pickle=False)

        worker_cfg = {
            "model_name": config.model_name,
            "audio_path": audio_path,
            "n_threads": config.cpu_threads,
            "language": config.language or "",
            "condition_on_previous_text": config.condition_on_previous_text,
            "no_speech_thold": config.whisper_no_speech_thold,
            "entropy_thold": config.whisper_entropy_thold,
            "logprob_thold": config.whisper_logprob_thold,
            "hotwords": config.hotwords or "",
        }

        proc = subprocess.run(
            [sys.executable, "-u", "-m", "stt._cpp_worker"],
            input=_json.dumps(worker_cfg),
            capture_output=True,
            text=True,
            timeout=120,
        )

        if proc.returncode != 0:
            stderr_tail = (proc.stderr or "")[-500:]
            raise RuntimeError(
                f"whisper.cpp worker crashed (exit {proc.returncode}): {stderr_tail}"
            )

        result = _json.loads(proc.stdout)

        if not result.get("ok"):
            raise RuntimeError(result.get("error", "whisper.cpp worker returned error"))

        segments = [
            TranscriptionSegment(text=s["text"], start=s["start"], end=s["end"])
            for s in result.get("segments", [])
            if s.get("text", "").strip() not in _JUNK_TOKENS
        ]

        return TranscriptionResult(
            text=result.get("text", ""),
            language=result.get("language", "") or (config.language or ""),
            segments=tuple(segments),
        )

    except subprocess.TimeoutExpired:
        raise RuntimeError("whisper.cpp transcription timed out (120s)")
    finally:
        if audio_path and os.path.exists(audio_path):
            try:
                os.unlink(audio_path)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# faster-whisper backend
# ---------------------------------------------------------------------------

def _build_vad_kwargs(config: TranscriptionConfig) -> dict:
    """Return vad_filter + vad_parameters kwargs dict for faster-whisper transcribe().

    Returns an empty dict when config.vad_filter is False so callers can always
    splat the result without branching.
    """
    if not config.vad_filter:
        return {}
    from faster_whisper.vad import VadOptions
    return {
        "vad_filter": True,
        "vad_parameters": VadOptions(
            threshold=0.5,
            min_silence_duration_ms=config.vad_min_silence_ms,
            min_speech_duration_ms=250,
            max_speech_duration_s=config.vad_max_speech_sec,
            speech_pad_ms=400,
        ),
    }


def _transcribe_fw(
    audio: np.ndarray,
    sr: int,
    config: TranscriptionConfig,
) -> TranscriptionResult:
    """Transcribe via faster-whisper with batched inference, VAD, word timestamps, and hotwords.

    Uses BatchedInferencePipeline when batch_size > 0 (default: 8 on GPU).
    This gives 4-10x speedup over sequential transcription.
    """
    try:
        model = _get_fw_model(config)
    except Exception as exc:
        raise RuntimeError(f"Failed to load faster-whisper model '{config.model_name}': {exc}") from exc

    vad_kwargs = _build_vad_kwargs(config)

    # Determine batch size: explicit > 0, or auto (8 on GPU, 1 on CPU)
    batch_size = config.batch_size if config.batch_size > 0 else (8 if config.device == "cuda" else 0)

    # Build common transcribe kwargs
    transcribe_kwargs = dict(
        beam_size=config.beam_size,
        language=config.language,
        condition_on_previous_text=config.condition_on_previous_text,
        no_speech_threshold=config.whisper_no_speech_thold,
        compression_ratio_threshold=config.whisper_compression_ratio_thold,
        log_prob_threshold=config.whisper_logprob_thold,
        **vad_kwargs,
    )

    # Word timestamps (only supported in non-batched mode)
    if config.word_timestamps:
        transcribe_kwargs["word_timestamps"] = True

    # Hotwords (keyword boosting)
    if config.hotwords:
        transcribe_kwargs["hotwords"] = config.hotwords

    try:
        if batch_size > 0:
            # Batched inference — 4-10x faster on GPU
            batched_model = _get_batched_model(config)
            raw_segments, info = batched_model.transcribe(
                audio,
                batch_size=batch_size,
                **{k: v for k, v in transcribe_kwargs.items()
                   if k != "word_timestamps"},  # batched doesn't support word_timestamps yet
            )
        else:
            raw_segments, info = model.transcribe(audio, **transcribe_kwargs)
    except Exception as exc:
        err = str(exc).lower()
        if "libcublas" in err or "cublas" in err or "out of memory" in err or ("cuda" in err and "error" in err):
            import os
            os.environ["CT2_FORCE_CPU"] = "1"
            from faster_whisper import WhisperModel
            fallback = WhisperModel(
                config.model_name,
                device="cpu",
                compute_type="int8",
                cpu_threads=config.cpu_threads,
            )
            raw_segments, info = fallback.transcribe(audio, **transcribe_kwargs)
        else:
            raise RuntimeError(f"faster-whisper transcription failed: {exc}") from exc

    segments: list[TranscriptionSegment] = []
    text_parts: list[str] = []

    for seg in raw_segments:
        text = seg.text.strip()
        if not text or text in _JUNK_TOKENS:
            continue
        segments.append(TranscriptionSegment(text=text, start=seg.start, end=seg.end))
        text_parts.append(text)

    return TranscriptionResult(
        text=" ".join(text_parts),
        language=info.language if info else "",
        segments=tuple(segments),
    )
