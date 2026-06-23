"""Subprocess worker for whisper.cpp transcription.

Runs in a separate process so a native segfault cannot kill the main app.
Communicates via stdin (JSON config) and stdout (JSON results).

Usage:
    python -m stt._cpp_worker < config.json > results.json

Input JSON on stdin:
    {
        "model_name": "base.en",
        "audio_path": "/tmp/audio.npy",
        "n_threads": 4,
        "language": "",
        "condition_on_previous_text": false,
        "no_speech_thold": 0.6,
        "entropy_thold": 2.4,
        "logprob_thold": -1.0,
        "hotwords": ""
    }

Output JSON on stdout:
    {
        "ok": true,
        "text": "hello world",
        "language": "en",
        "segments": [{"text": "hello world", "start": 0.0, "end": 1.5}]
    }
"""

from __future__ import annotations

import json
import sys
import warnings

import numpy as np


def main() -> None:
    warnings.filterwarnings("ignore")

    try:
        config = json.loads(sys.stdin.read())
    except Exception as exc:
        json.dump({"ok": False, "error": f"Invalid config: {exc}"}, sys.stdout)
        return

    model_name = config.get("model_name", "base.en")
    audio_path = config.get("audio_path", "")
    n_threads = config.get("n_threads", 4)
    language = config.get("language", "")
    condition_on_previous_text = config.get("condition_on_previous_text", False)
    no_speech_thold = config.get("no_speech_thold", 0.6)
    entropy_thold = config.get("entropy_thold", 2.4)
    logprob_thold = config.get("logprob_thold", -1.0)
    hotwords = config.get("hotwords", "")

    # Load audio
    try:
        audio = np.load(audio_path, allow_pickle=False)
    except Exception as exc:
        json.dump({"ok": False, "error": f"Failed to load audio: {exc}"}, sys.stdout)
        return

    if audio.dtype != np.float32:
        audio = audio.astype(np.float32)

    # Load model
    try:
        from pywhispercpp.model import Model as CppModel
        import os
        with open(os.devnull, "w") as devnull:
            model = CppModel(
                model_name,
                print_progress=False,
                print_realtime=False,
                redirect_whispercpp_logs_to=devnull,
                n_threads=n_threads,
            )
    except Exception as exc:
        json.dump({"ok": False, "error": f"Failed to load model '{model_name}': {exc}"}, sys.stdout)
        return

    # Build prompt
    prompt = (
        "Clear, accurate transcription with proper punctuation and capitalization. "
        "Remove filler words like um, uh, ah. "
        "Correct obvious speech-to-text errors."
    )
    if hotwords:
        prompt = f"{prompt} Expected terms: {hotwords}"

    # Transcribe
    try:
        raw_segments = model.transcribe(
            audio,
            n_threads=n_threads,
            no_context=not condition_on_previous_text,
            single_segment=True,
            language=language,
            initial_prompt=prompt,
            temperature=0.0,
            temperature_inc=0.2,
            no_speech_thold=no_speech_thold,
            entropy_thold=entropy_thold,
            logprob_thold=logprob_thold,
            suppress_non_speech_tokens=True,
            suppress_blank=True,
            greedy={"best_of": 5},
        )

        JUNK = {"[BLANK_AUDIO]", "[MUSIC]", "[NOISE]", "[INAUDIBLE]", "[SILENCE]",
                "[Applause]", "[Laughter]", "[Music]", "[Noise]", "[Silence]", "♪", "♫"}

        segments = []
        text_parts = []
        detected_lang = language or ""
        for seg in raw_segments:
            text = seg.text.strip() if isinstance(seg.text, str) else seg.text.decode("utf-8").strip()
            if not text or text in JUNK:
                continue
            segments.append({"text": text, "start": seg.t0 * 0.01, "end": seg.t1 * 0.01})
            text_parts.append(text)

        result = {
            "ok": True,
            "text": " ".join(text_parts),
            "language": detected_lang,
            "segments": segments,
        }
        json.dump(result, sys.stdout)

    except Exception as exc:
        json.dump({"ok": False, "error": f"whisper.cpp transcription failed: {exc}"}, sys.stdout)


if __name__ == "__main__":
    main()
