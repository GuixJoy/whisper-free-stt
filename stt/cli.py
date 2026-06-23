"""CLI entrypoint — parses args, builds config, launches orchestrator."""

from __future__ import annotations

import argparse
import os
import sys
import threading
from dataclasses import dataclass

from stt.log import get_logger

from stt.config import (
    AppConfig,
    AudioConfig,
    ComputeType,
    DiarizationConfig,
    LLMConfig,
    LLMMode,
    LLMProvider,
    TranscriptionBackend,
    TranscriptionConfig,
    VADConfig,
    load_dotenv,
)
from stt.orchestrator import run, run_file, run_ws_audio, start_ws_server

logger = get_logger(__name__)


@dataclass(frozen=True)
class _ASRProfile:
    model_name: str
    beam_size: int
    condition_on_previous_text: bool
    backend: TranscriptionBackend = TranscriptionBackend.WHISPER_CPP


_ASR_PROFILES: dict[str, _ASRProfile] = {
    # whisper.cpp (fastest on CPU) — English-optimized models
    "speed": _ASRProfile(model_name="tiny.en", beam_size=1, condition_on_previous_text=False),
    "balanced": _ASRProfile(model_name="base.en", beam_size=1, condition_on_previous_text=True),
    "accuracy": _ASRProfile(model_name="small.en", beam_size=3, condition_on_previous_text=True),
    # faster-whisper (supports distil/turbo models not in whisper.cpp)
    "small-cuda": _ASRProfile(
        model_name="small.en", beam_size=3, condition_on_previous_text=False,
        backend=TranscriptionBackend.FASTER_WHISPER,
    ),
    "distil": _ASRProfile(
        model_name="distil-large-v3", beam_size=5, condition_on_previous_text=False,
        backend=TranscriptionBackend.FASTER_WHISPER,
    ),
    "turbo": _ASRProfile(
        model_name="large-v3-turbo", beam_size=1, condition_on_previous_text=False,
        backend=TranscriptionBackend.FASTER_WHISPER,
    ),
}


def _has_cuda() -> bool:
    """Check if CUDA is actually usable — library load + real inference test."""
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() == 0:
            return False
        import ctypes as _ct, os as _os, sys as _sys, site as _site
        # 1. Load libcublas
        loaded = False
        if _sys.platform == "win32":
            # Windows: try pip-installed nvidia-cublas, then CUDA toolkit
            # Check pip-installed nvidia-cublas package
            for sp in (_site.getsitepackages() if hasattr(_site, 'getsitepackages') else []):
                cublas_dll = _os.path.join(sp, "nvidia", "cublas", "bin", "cublas64_12.dll")
                if _os.path.isfile(cublas_dll):
                    try:
                        _ct.CDLL(cublas_dll)
                        loaded = True
                        break
                    except OSError:
                        continue
            # Check PyInstaller frozen app directories
            if not loaded and getattr(_sys, 'frozen', False):
                app_dir = _os.path.dirname(_sys.executable)
                meipass = getattr(_sys, '_MEIPASS', app_dir)
                for base in (app_dir, meipass):
                    for sub in ("", "nvidia/cublas/bin", "lib/nvidia/cublas/bin"):
                        cublas_dll = _os.path.join(base, sub, "cublas64_12.dll") if sub else _os.path.join(base, "cublas64_12.dll")
                        if _os.path.isfile(cublas_dll):
                            try:
                                _ct.CDLL(cublas_dll)
                                loaded = True
                                break
                            except OSError:
                                continue
                    if loaded:
                        break
            if not loaded:
                # Try system PATH (CUDA toolkit)
                for lib in ("cublas64_12.dll", "cublas64_11.dll"):
                    try:
                        _ct.CDLL(lib)
                        loaded = True
                        break
                    except OSError:
                        continue
            if not loaded:
                # Try CUDA toolkit default install path
                for cuda_ver in ("v12.8", "v12.6", "v12.4", "v12.1", "v12.0", "v11.8"):
                    cuda_bin = rf"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\{cuda_ver}\bin"
                    for lib_name in ("cublas64_12.dll", "cublas64_11.dll"):
                        lib_path = _os.path.join(cuda_bin, lib_name)
                        if _os.path.isfile(lib_path):
                            try:
                                _ct.CDLL(lib_path)
                                loaded = True
                                break
                            except OSError:
                                continue
                    if loaded:
                        break
        else:
            # Linux / macOS
            for d in ["/usr/local/lib/ollama/cuda_v12", "/usr/local/lib/ollama/cuda_v13"]:
                lib = _os.path.join(d, "libcublas.so.12")
                if _os.path.isfile(lib):
                    try:
                        _ct.CDLL(lib, _ct.RTLD_GLOBAL)
                        loaded = True
                        break
                    except OSError:
                        continue
            if not loaded:
                for lib in ("libcublas.so.12", "libcublas.so.11"):
                    try: _ct.CDLL(lib, _ct.RTLD_GLOBAL); loaded = True; break
                    except OSError: continue
        if not loaded:
            return False
        # 2. Avoid running an inference here (can download models / slow startup).
        # Library-load + device count is enough for selecting a default profile.
        return True
    except Exception:
        return False


def _get_vram_mb() -> int:
    """Return free VRAM in MB for the first CUDA device, or 0 if unavailable."""
    try:
        import subprocess
        if subprocess.run(["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                          capture_output=True, text=True, timeout=5).returncode == 0:
            out = subprocess.run(["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                                 capture_output=True, text=True, timeout=5).stdout.strip()
            if out:
                return int(out.split("\n")[0].strip())
    except Exception:
        pass
    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    """Build the argument parser.  Pure — no side effects."""
    parser = argparse.ArgumentParser(
        prog="stt",
        description="Local-first speech-to-text assistant for Linux (Wayland + X11)",
    )

    # Audio
    parser.add_argument("--sample-rate", type=int, default=16000, help="Audio sample rate (Hz)")
    parser.add_argument("--device-index", type=int, default=None, help="Microphone device index")

    # VAD
    parser.add_argument("--silence-threshold", type=float, default=None, help="RMS silence threshold (default: 0.005)")
    parser.add_argument("--silence-duration", type=float, default=None, help="Seconds of silence before stopping")
    parser.add_argument("--min-duration", type=float, default=0.5, help="Minimum recording duration (seconds)")
    parser.add_argument("--fast-commit", action="store_true", help="Faster endpointing (lower silence, higher detrigger)")

    # Whisper
    parser.add_argument(
        "--asr-profile",
        type=str,
        default="auto",
        choices=["auto"] + list(_ASR_PROFILES.keys()),
        help="ASR preset: auto, speed, balanced, accuracy, distil, turbo",
    )
    parser.add_argument(
        "--backend",
        type=str,
        default=None,
        choices=[e.value for e in TranscriptionBackend],
        help="ASR engine: whisper_cpp (fastest CPU) or faster_whisper",
    )
    parser.add_argument("--model", type=str, default=None, help="Model name override (default: profile-dependent)")
    parser.add_argument("--compute-type", type=str, default="auto", choices=[e.value for e in ComputeType])
    parser.add_argument("--device", type=str, default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--cpu-threads", type=int, default=4, help="CPU threads")
    parser.add_argument("--language", type=str, default=None, help="Force transcription language (e.g., 'en')")
    parser.add_argument("--beam-size", type=int, default=None, help="Beam size (default: profile-dependent)")
    parser.add_argument("--hotwords", type=str, default="", help="Comma-separated terms to boost recognition")

    # Diarization
    parser.add_argument("--diarization", action="store_true", help="Enable speaker verification (reject non-enrolled speakers)")
    parser.add_argument("--diarization-threshold", type=float, default=0.65, help="Cosine similarity threshold (default: 0.65)")

    # LLM — defaults=None so we can fall back to env/.env
    parser.add_argument(
        "--llm-provider",
        type=str,
        default=None,
        choices=["auto"] + [e.value for e in LLMProvider],
        help="LLM backend: auto (detect from env), deepseek, or openrouter",
    )
    parser.add_argument(
        "--llm-mode",
        type=str,
        default=None,
        choices=[e.value for e in LLMMode],
        help="LLM rewrite mode (env: STT_LLM_MODE)",
    )
    parser.add_argument("--llm-model", type=str, default=None, help="LLM model (env: STT_LLM_MODEL)")
    parser.add_argument("--llm-fallback", type=str, default=None, help="Fallback model (env: STT_LLM_FALLBACK, OpenRouter only)")
    parser.add_argument("--llm-timeout", type=float, default=None, help="LLM timeout in seconds")
    parser.add_argument("--deepseek-api-key", type=str, default=None, help="DeepSeek API key (overrides DEEPSEEK_API_KEY env)")
    parser.add_argument("--openrouter-api-key", type=str, default=None, help="OpenRouter API key (overrides OPENROUTER_API_KEY env)")

    # Debug
    parser.add_argument("--debug", action="store_true", help="Print diagnostic info at each pipeline stage")
    parser.add_argument("--json-mode", action="store_true", help="Output JSON events to stdout (for Tauri/UI integration)")
    parser.add_argument("--ws-port", type=int, default=None, help="Start WebSocket server on this port for browser UI")
    parser.add_argument("--ws-audio", action="store_true", help="Accept audio from browser via WebSocket (no mic capture)")
    parser.add_argument("--input-file", type=str, default=None, help="Process a WAV file instead of live mic (dry-run)")
    parser.add_argument("--list-microphones", action="store_true", help="List available microphones and exit")
    parser.add_argument("--download-model", type=str, default=None, help="Download a specific model and exit")
    parser.add_argument("--log-file", type=str, default=None, help="Write logs to file (e.g., stt.log)")

    return parser


def build_config(args: argparse.Namespace) -> AppConfig:
    """Build an immutable AppConfig from CLI args + env.

    Precedence: CLI flag > env var > hardcoded default.
    """
    # Inject API keys from CLI args into environment before LLMConfig detects them
    if args.deepseek_api_key:
        os.environ["DEEPSEEK_API_KEY"] = args.deepseek_api_key
    if args.openrouter_api_key:
        os.environ["OPENROUTER_API_KEY"] = args.openrouter_api_key

    llm_defaults = LLMConfig()

    llm_mode = LLMMode(args.llm_mode) if args.llm_mode is not None else llm_defaults.mode
    llm_model = args.llm_model if args.llm_model is not None else llm_defaults.model
    llm_fallback = args.llm_fallback if args.llm_fallback is not None else llm_defaults.fallback_model
    llm_timeout = args.llm_timeout if args.llm_timeout is not None else llm_defaults.timeout_sec

    # Provider: CLI override > auto-detect from env
    if args.llm_provider and args.llm_provider != "auto":
        llm_provider = LLMProvider(args.llm_provider)
    else:
        llm_provider = llm_defaults.provider

    has_cuda = _has_cuda()
    profile_name = args.asr_profile
    if profile_name == "auto":
        if has_cuda:
            vram_mb = _get_vram_mb()
            if vram_mb >= 6000:
                profile_name = "turbo"       # large-v3-turbo (~3.5GB VRAM)
            elif vram_mb >= 3000:
                profile_name = "distil"      # distil-large-v3 (~2.5GB VRAM)
            elif vram_mb >= 1500:
                profile_name = "small-cuda"  # small.en on CUDA (~1.2GB VRAM)
            else:
                profile_name = "accuracy"    # small.en on CPU (low VRAM)
        else:
            profile_name = "accuracy"

    profile = _ASR_PROFILES[profile_name]
    model_name = args.model if args.model is not None else profile.model_name
    beam_size = args.beam_size if args.beam_size is not None else profile.beam_size
    backend = TranscriptionBackend(args.backend) if args.backend is not None else profile.backend
    device = args.device if args.device != "auto" else ("cuda" if has_cuda else "cpu")
    compute_type = ComputeType(args.compute_type)
    if compute_type is ComputeType.AUTO:
        compute_type = ComputeType.FLOAT16 if device == "cuda" else ComputeType.INT8

        return AppConfig(
        audio=AudioConfig(
            sample_rate=args.sample_rate,
            device_index=args.device_index,
        ),
        vad=VADConfig(
            silence_threshold_rms=args.silence_threshold if args.silence_threshold is not None else VADConfig.silence_threshold_rms,
            silence_duration_sec=args.silence_duration if args.silence_duration is not None else VADConfig.silence_duration_sec,
            min_recording_sec=args.min_duration,
            fast_commit=args.fast_commit,
        ),
        transcription=TranscriptionConfig(
            backend=backend,
            model_name=model_name,
            compute_type=compute_type,
            device=device,
            cpu_threads=args.cpu_threads,
            language=args.language,
            beam_size=beam_size,
            condition_on_previous_text=profile.condition_on_previous_text,
            hotwords=getattr(args, "hotwords", "") or "",
            profile_name=profile_name,
        ),
        llm=LLMConfig(
            mode=llm_mode,
            provider=llm_provider,
            model=llm_model,
            fallback_model=llm_fallback,
            timeout_sec=llm_timeout,
        ),
        diarization=DiarizationConfig(
            enabled=args.diarization,
            similarity_threshold=args.diarization_threshold,
        ),
        debug=args.debug,
        json_mode=args.json_mode,
    )


def _ensure_cuda_libs() -> None:
    """Pre-load CUDA libraries from known paths.

    On Linux: setting os.environ['LD_LIBRARY_PATH'] after process start has no
    effect on the dynamic linker — we must load via ctypes so symbols are
    available when ctranslate2 tries to use them.

    On Windows: add the CUDA toolkit bin directory to PATH so DLLs are found.
    """
    import ctypes as _ct
    import os as _os
    import sys as _sys
    import site as _site

    if _sys.platform == "win32":
        # Windows: add pip-installed nvidia-cublas bin to PATH
        # Check standard site-packages paths
        for sp in (_site.getsitepackages() if hasattr(_site, 'getsitepackages') else []):
            cublas_bin = _os.path.join(sp, "nvidia", "cublas", "bin")
            if _os.path.isdir(cublas_bin) and cublas_bin not in _os.environ.get("PATH", ""):
                _os.environ["PATH"] = cublas_bin + ";" + _os.environ.get("PATH", "")
        # Check PyInstaller frozen app directories
        if getattr(_sys, 'frozen', False):
            # Running as PyInstaller bundle
            app_dir = _os.path.dirname(_sys.executable)
            meipass = getattr(_sys, '_MEIPASS', app_dir)
            for base in (app_dir, meipass):
                cublas_bin = _os.path.join(base, "nvidia", "cublas", "bin")
                if _os.path.isdir(cublas_bin) and cublas_bin not in _os.environ.get("PATH", ""):
                    _os.environ["PATH"] = cublas_bin + ";" + _os.environ.get("PATH", "")
                # Also check lib subdirectory
                cublas_bin = _os.path.join(base, "lib", "nvidia", "cublas", "bin")
                if _os.path.isdir(cublas_bin) and cublas_bin not in _os.environ.get("PATH", ""):
                    _os.environ["PATH"] = cublas_bin + ";" + _os.environ.get("PATH", "")
        # Also add CUDA toolkit bin to PATH
        for cuda_ver in ("v12.8", "v12.6", "v12.4", "v12.1", "v12.0", "v11.8"):
            cuda_bin = rf"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\{cuda_ver}\bin"
            if _os.path.isdir(cuda_bin) and cuda_bin not in _os.environ.get("PATH", ""):
                _os.environ["PATH"] = cuda_bin + ";" + _os.environ.get("PATH", "")
        # Try loading directly
        for lib in ("cublas64_12.dll", "cublas64_11.dll"):
            try:
                _ct.CDLL(lib)
                return
            except OSError:
                continue
    else:
        # Linux: load from Ollama bundled CUDA libs
        candidate_dirs = [
            "/usr/local/lib/ollama/cuda_v12",
            "/usr/local/lib/ollama/cuda_v13",
        ]
        for d in candidate_dirs:
            lib_path = _os.path.join(d, "libcublas.so.12")
            if _os.path.isfile(lib_path):
                try:
                    _ct.CDLL(lib_path, _ct.RTLD_GLOBAL)
                    ld = _os.environ.get("LD_LIBRARY_PATH", "")
                    if d not in ld:
                        _os.environ["LD_LIBRARY_PATH"] = f"{d}:{ld}" if ld else d
                    return
                except OSError:
                    continue
        # Fallback: try system ld path
        for lib in ("libcublas.so.12", "libcublas.so.11"):
            try:
                _ct.CDLL(lib, _ct.RTLD_GLOBAL)
                return
            except OSError:
                continue


def _list_microphones(config: AppConfig) -> None:
    """Print available microphones as JSON and exit."""
    import json as _json
    try:
        from stt.audio_capture import list_microphones
        devices = list_microphones(config.audio.sample_rate)
        print(_json.dumps(devices), flush=True)
    except Exception as exc:
        print(_json.dumps({"error": str(exc)}), flush=True)
        sys.exit(1)


def _download_model(model_name: str, config: AppConfig) -> None:
    """Trigger model download by doing a warm-up with the specified model."""
    import json as _json
    from stt.config import TranscriptionConfig
    tcfg = TranscriptionConfig(
        model_name=model_name,
        backend=config.transcription.backend,
    )
    try:
        warm_up_backend(tcfg)
        print(_json.dumps({"status": "downloaded", "model": model_name}), flush=True)
    except Exception as exc:
        print(_json.dumps({"error": str(exc)}), flush=True)
        sys.exit(1)


def main(argv: list[str] | None = None) -> None:
    """Parse args → build config → run.  Impure: reads argv, .env, launches app."""
    # Load .env before anything else — so config defaults can see it
    load_dotenv()
    _ensure_cuda_libs()

    parser = build_arg_parser()
    args = parser.parse_args(argv)
    config = build_config(args)

    # Configure log file if specified
    if args.log_file:
        import logging
        file_handler = logging.FileHandler(args.log_file)
        file_handler.setLevel(logging.DEBUG)
        formatter = logging.Formatter("%(asctime)s [%(name)s] %(levelname)s: %(message)s")
        file_handler.setFormatter(formatter)
        logging.getLogger().addHandler(file_handler)
        logging.getLogger().setLevel(logging.DEBUG)

    if args.list_microphones:
        _list_microphones(config)
        return

    if args.download_model:
        _download_model(args.download_model, config)
        return

    if args.ws_port:
        # Start FastAPI + Socket.IO server
        import uvicorn
        from stt.server import asgi_app, sio
        # Store config in server module for the orchestrator to use
        import stt.server as _server_mod
        _server_mod._config = config
        object.__setattr__(config, "json_mode", True)  # ws implies json

        # Run server in background thread
        def _run_server():
            uvicorn.run(asgi_app, host="127.0.0.1", port=args.ws_port, log_level="warning")
        threading.Thread(target=_run_server, daemon=True).start()
        logger.info(f"listening on http://127.0.0.1:{args.ws_port}")
        logger.info(f"API docs at http://127.0.0.1:{args.ws_port}/docs")

    if args.input_file:
        run_file(config, args.input_file)
    elif args.ws_audio:
        # Browser mic mode: wait for audio via Socket.IO
        if not args.ws_port:
            import uvicorn
            from stt.server import asgi_app
            import stt.server as _server_mod
            _server_mod._config = config
            object.__setattr__(config, "json_mode", True)

            def _run_server():
                uvicorn.run(asgi_app, host="127.0.0.1", port=8765, log_level="warning")
            threading.Thread(target=_run_server, daemon=True).start()
            logger.info("listening on http://127.0.0.1:8765")
        run_ws_audio(config)
    else:
        run(config)


if __name__ == "__main__":
    main()
