"""Microphone capture via sounddevice.

This module is the sole owner of microphone I/O.
Supports both one-shot (record_utterance) and continuous streaming (mic_stream).
"""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Callable, Iterator

import numpy as np
import sounddevice as sd
from kakashi import get_logger

from stt.config import AudioConfig
from stt.types import AudioSegment

logger = get_logger(__name__)


def apply_agc(audio: np.ndarray, target_level: float = 0.1, max_gain: float = 10.0) -> np.ndarray:
    """Simple automatic gain control — scale audio to target RMS level.

    Helps normalize mic input levels when user distance varies.
    Limits gain to prevent amplifying noise.
    """
    from stt.vad import compute_rms
    rms = compute_rms(audio)
    if rms < 0.001:
        return audio
    gain = target_level / rms
    gain = min(gain, max_gain)
    return (audio * gain).astype(np.float32)


def open_input_stream(
    device_index: int,
    target_samplerate: int,
    channels: int,
    dtype: str,
    blocksize: int,
    callback: Callable[[np.ndarray, int, object, int], None],
) -> sd.InputStream:
    """Safely opens a PortAudio InputStream at the target sample rate.

    If the target sample rate (e.g., 16000) is unsupported natively by the hardware/driver,
    it falls back to the device's native default sample rate, opens the stream,
    and resamples the incoming audio chunks transparently on-the-fly to the target rate
    before invoking the user callback.
    """
    import threading as _threading
    import time as _time

    def _try_open(samplerate: int, blocksz: int) -> sd.InputStream | None:
        """Attempt to open stream with a timeout to prevent hanging."""
        result = [None]
        def _do_open():
            try:
                result[0] = sd.InputStream(
                    samplerate=samplerate,
                    channels=channels,
                    dtype=dtype,
                    blocksize=blocksz,
                    device=device_index,
                    callback=callback,
                )
            except Exception:
                pass
        t = _threading.Thread(target=_do_open, daemon=True)
        t.start()
        t.join(timeout=3.0)  # 3 second timeout
        return result[0]

    # First attempt: Open at the requested sample rate natively
    stream = _try_open(target_samplerate, blocksize)
    if stream is not None:
        return stream

    logger.debug("Target sample rate %sHz failed. Trying fallback...", target_samplerate)

    # Fallback attempt: Query native default sample rate for the device
    try:
        device_info = sd.query_devices(device_index, "input")
        native_samplerate = int(device_info["default_samplerate"])
    except Exception:
        native_samplerate = 44100  # standard safe default

    logger.debug("Falling back to device native rate: %sHz", native_samplerate)

    # Calculate native blocksize to maintain similar chunk duration (~128ms)
    native_blocksize = int((blocksize / target_samplerate) * native_samplerate)

    # Thread-local/internal buffer to accumulate samples for continuous resampling
    def resampling_callback(indata: np.ndarray, frames_count: int, time_info: object, status: int) -> None:
        mono_data = indata[:, 0].copy()
        # Resample mono data to target_samplerate using linear interpolation
        num_samples = len(mono_data)
        duration = num_samples / native_samplerate
        num_target_samples = int(duration * target_samplerate)

        indices = np.linspace(0, num_samples - 1, num_target_samples)
        resampled_chunk = np.interp(indices, np.arange(num_samples), mono_data).astype(np.float32)

        # Since user callback expects 2D array of shape (frames, channels), we construct it:
        if channels == 1:
            callback_data = resampled_chunk[:, np.newaxis]
        else:
            callback_data = np.column_stack([resampled_chunk] * channels)

        callback(callback_data, len(resampled_chunk), time_info, status)

    stream = _try_open(native_samplerate, native_blocksize)
    if stream is not None:
        return stream

    raise RuntimeError(f"Failed to open microphone device {device_index} after multiple attempts")

# ---------------------------------------------------------------------------
# One-shot recording (original)
# ---------------------------------------------------------------------------

_FramesDeque = deque[np.ndarray]


def _make_callback(
    frames: _FramesDeque,
    sample_rate: int,
    start_event: threading.Event,
) -> Callable[[np.ndarray, int, object, int], None]:
    def _callback(indata: np.ndarray, frames_count: int, time_info: object, status: int) -> None:
        if status:
            logger.warning("audio stream status: %s", status)
        frames.append(indata[:, 0].copy())
        start_event.set()
    return _callback


def list_microphones() -> list[dict[str, object]]:
    """Return available input devices.

    Safe against hanging ALSA/PipeWire device queries via internal timeout.
    """
    devices: list[dict[str, object]] = []
    raw_devices: list[dict[str, object]] | None = [None]
    done = threading.Event()

    def _query() -> None:
        try:
            raw_devices[0] = list(sd.query_devices())
        except Exception:
            pass
        done.set()

    t = threading.Thread(target=_query, daemon=True)
    t.start()
    done.wait(timeout=5.0)
    if raw_devices[0] is None:
        return devices

    for idx, dev in enumerate(raw_devices[0]):
        if dev["max_input_channels"] > 0:
            devices.append({
                "index": idx,
                "name": dev["name"],
                "channels": dev["max_input_channels"],
                "default_samplerate": dev["default_samplerate"],
            })
    return devices


def find_default_microphone() -> int | None:
    """Return the device index of the default input, or None."""
    try:
        default = sd.query_devices(kind="input")
        return default["index"] if default is not None else None
    except Exception:
        devices = list_microphones()
        return devices[0]["index"] if devices else None


def find_best_microphone(sample_rate: int = 16000) -> tuple[int, str, float]:
    """Sample every input device briefly and return (index, name, peak_rms).

    Picks the mic with the highest RMS — the one actively hearing something.
    Falls back to the default mic if all are silent.
    """
    from stt.vad import compute_rms

    mics = list_microphones()
    if not mics:
        raise RuntimeError("No microphone found.")

    # Exclude loopback/monitor devices
    candidates = [
        m for m in mics
        if "loopback" not in m["name"].lower()
        and "monitor" not in m["name"].lower()
    ]
    if not candidates:
        candidates = mics

    best_idx = candidates[0]["index"]
    best_name = str(candidates[0]["name"])
    best_rms = 0.0

    for mic in candidates:
        idx = mic["index"]
        try:
            rms = _sample_mic_rms(idx, sample_rate, duration=0.3)
        except Exception:
            rms = 0.0
        if rms > best_rms:
            best_rms = rms
            best_idx = idx
            best_name = str(mic["name"])

    # If all are silent, fall back to default
    if best_rms < 0.001:
        default = find_default_microphone()
        if default is not None:
            best_idx = default
            best_name = str(sd.query_devices(device=default)["name"])

    return best_idx, best_name, best_rms


def _sample_mic_rms(device_index: int, sample_rate: int, duration: float) -> float:
    """Open a mic briefly and return the peak RMS observed.

    Runs in a daemon thread with a timeout so that a hanging ALSA device
    (open or close) cannot block the caller indefinitely.
    """
    from stt.vad import compute_rms

    result: list[float] = [0.0]
    done = threading.Event()

    def _run() -> None:
        frames: _FramesDeque = deque()
        started = threading.Event()

        def _cb(indata: np.ndarray, n: int, ti: object, st: int) -> None:
            if not st:
                frames.append(indata[:, 0].copy())
                started.set()

        try:
            stream = open_input_stream(
                device_index=device_index,
                target_samplerate=sample_rate,
                channels=1,
                dtype="float32",
                blocksize=2048,
                callback=_cb,
            )
        except Exception:
            done.set()
            return

        best = 0.0
        deadline = time.monotonic() + duration
        try:
            with stream:
                started.wait(timeout=1.0)
                while time.monotonic() < deadline:
                    if frames:
                        chunk = frames.popleft()
                        rms = compute_rms(chunk)
                        if rms > best:
                            best = rms
                    else:
                        sd.sleep(50)
        except Exception:
            pass
        result[0] = best
        done.set()

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    done.wait(timeout=duration + 4.0)
    return result[0]


def record_utterance(
    config: AudioConfig,
    should_stop: Callable[[np.ndarray], bool],
    debug: bool = False,
) -> AudioSegment:
    """Record audio until *should_stop* returns True on a chunk."""
    device_index = config.device_index
    if device_index is None:
        device_index = find_default_microphone()
    if device_index is None:
        raise RuntimeError("No microphone found.")

    if debug:
        logger.debug("audio: opening InputStream(device=%s, sr=%s, blocksize=%s)", device_index, config.sample_rate, config.blocksize)

    frames: _FramesDeque = deque()
    start_event = threading.Event()
    callback = _make_callback(frames, config.sample_rate, start_event)

    stream = open_input_stream(
        device_index=device_index,
        target_samplerate=config.sample_rate,
        channels=config.channels,
        dtype=config.dtype,
        blocksize=config.blocksize,
        callback=callback,
    )

    chunk_count = 0
    with stream:
        start_event.wait(timeout=5.0)
        if not start_event.is_set():
            raise RuntimeError("Microphone stream started but no data received.")

        if debug:
            logger.debug("audio: first chunk received, accumulating...")

        while not should_stop(_collect_frames(frames)):
            sd.sleep(int(config.blocksize / config.sample_rate * 1000))
            chunk_count += 1
            if debug and chunk_count % 10 == 0:
                dur = len(_collect_frames(frames)) / config.sample_rate
                logger.debug("audio: %.1fs accumulated (%s chunks)...", dur, chunk_count)

    data = _collect_frames(frames)
    if debug:
        logger.debug("audio: recording stopped, total %.1fs (%s samples)", len(data)/config.sample_rate, len(data))

    return AudioSegment(data=data, sample_rate=config.sample_rate, start_time=0.0,
                        end_time=len(data) / config.sample_rate)


# ---------------------------------------------------------------------------
# Continuous streaming (mic stays open forever)
# ---------------------------------------------------------------------------

def mic_stream(
    config: AudioConfig,
    debug: bool = False,
) -> Iterator[np.ndarray]:
    """Yield audio chunks continuously from the microphone.

    The mic is opened ONCE. Each yielded value is a numpy array of
    float32 samples (mono) at config.sample_rate, containing *blocksize*
    samples per chunk (~128ms at 16kHz/2048).

    If the selected device fails to open, falls back to other available
    input devices automatically.

    Yields forever — the caller must break the loop.
    """
    device_index = config.device_index
    if device_index is None:
        device_index = find_default_microphone()
    if device_index is None:
        raise RuntimeError("No microphone found.")

    # Thread-safe queue for audio chunks
    chunk_queue: deque[np.ndarray] = deque()
    chunk_ready = threading.Event()

    def _callback(indata: np.ndarray, frames_count: int, time_info: object, status: int) -> None:
        if status:
            logger.warning("audio stream status: %s", status)
        chunk_queue.append(indata[:, 0].copy())
        chunk_ready.set()

    last_error: Exception | None = None
    stream: sd.InputStream | None = None
    chosen_device: int | None = None

    # Build fallback list lazily — calling list_microphones() before the
    # primary device open can destabilise PipeWire's ALSA compatibility.
    _fallback_devices: list[int] = []

    # Try primary device first with retries
    for attempt in range(1, 4):
        try:
            stream = open_input_stream(
                device_index=device_index,
                target_samplerate=config.sample_rate,
                channels=config.channels,
                dtype=config.dtype,
                blocksize=config.blocksize,
                callback=_callback,
            )
            chosen_device = device_index
            break
        except Exception as exc:
            last_error = exc
            if attempt < 3:
                logger.debug("audio: device %s attempt %s failed (%s). Retrying in 0.5s...", device_index, attempt, exc)
                sd.sleep(500)

    # If primary device failed, build fallback list and try others
    if stream is None:
        try:
            all_mics = list_microphones()
            _fallback_devices = [m["index"] for m in all_mics if m["index"] != device_index]
        except Exception:
            pass

        for dev_idx in _fallback_devices:
            for attempt in range(1, 3):
                try:
                    stream = open_input_stream(
                        device_index=dev_idx,
                        target_samplerate=config.sample_rate,
                        channels=config.channels,
                        dtype=config.dtype,
                        blocksize=config.blocksize,
                        callback=_callback,
                    )
                    chosen_device = dev_idx
                    break
                except Exception as exc:
                    last_error = exc
                    if attempt < 2:
                        logger.debug("audio: device %s attempt %s failed (%s). Retrying in 0.5s...", dev_idx, attempt, exc)
                        sd.sleep(500)
            if stream is not None:
                logger.debug("audio: using fallback device %s (preferred %s failed)", dev_idx, device_index)
                break

    if stream is None:
        msg = "No working microphone found"
        if last_error:
            msg += f" (last error: {last_error})"
        raise RuntimeError(msg)

    if chosen_device != device_index:
        logger.debug("audio: using fallback device %s (preferred %s failed)", chosen_device, device_index)
        # Update config so subsequent code uses the working device
        object.__setattr__(config, "device_index", chosen_device)

    # Start the stream with a timeout — PortAudio start() can hang on PipeWire
    _started = [False]
    def _start() -> None:
        try:
            stream.start()
            _started[0] = True
        except Exception:
            pass
    _st = threading.Thread(target=_start, daemon=True)
    _st.start()
    _st.join(timeout=3.0)
    if not _started[0]:
        raise RuntimeError(f"Stream start timed out on device {chosen_device}")

    if debug:
        logger.debug("audio: persistent stream active")

    try:
        while True:
            # Wait briefly for a chunk; yield silence if none arrives so the
            # caller (calibration / main loop) can always make progress.
            chunk_ready.wait(timeout=0.5)
            chunk_ready.clear()
            if chunk_queue:
                chunk = chunk_queue.popleft()
            else:
                # Yield a silence chunk so next() never blocks forever
                chunk = np.zeros(config.blocksize, dtype=np.float32)
            yield chunk
    finally:
        # Close with timeout — PortAudio close can hang on PipeWire
        _closed = [False]
        def _close() -> None:
            try:
                stream.close()
                _closed[0] = True
            except Exception:
                pass
        _ct = threading.Thread(target=_close, daemon=True)
        _ct.start()
        _ct.join(timeout=2.0)


def _collect_frames(frames: _FramesDeque) -> np.ndarray:
    if not frames:
        return np.array([], dtype=np.float32)
    return np.concatenate(list(frames))
