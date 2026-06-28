"""Speaker verification for diarization — neural embeddings or spectral fallback."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray


class SpeakerVerifier:
    """Verify whether an audio segment matches an enrolled speaker profile.

    Uses resemblyzer for neural embeddings when available, otherwise falls back
    to MFCC-based spectral comparison using only numpy.
    """

    def __init__(self, method: str = "resemblyzer") -> None:
        self._method = method
        self._encoder = None
        self._loaded = False

    def _ensure_model(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        if self._method == "resemblyzer":
            try:
                from resemblyzer import VoiceEncoder
                self._encoder = VoiceEncoder()
            except ImportError:
                self._encoder = None

    def embed(self, audio: NDArray[np.float32], sr: int) -> NDArray[np.float32]:
        """Compute a 256-d speaker embedding from audio samples."""
        self._ensure_model()
        if self._encoder is not None:
            return self._neural_embed(audio, sr)
        return self._spectral_embed(audio, sr)

    def _neural_embed(self, audio: NDArray[np.float32], sr: int) -> NDArray[np.float32]:
        """resemblyzer-based embedding (256-d)."""
        # resemblyzer expects 16kHz mono float32 in [-1, 1]
        if sr != 16000:
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                import librosa
                audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)
                sr = 16000
        # Ensure 1-D
        audio = audio.astype(np.float32)
        if audio.ndim > 1:
            audio = audio.mean(axis=-1)
        # Pad to minimum length (0.4s = 6400 samples at 16kHz)
        min_len = int(sr * 0.4)
        if len(audio) < min_len:
            audio = np.pad(audio, (0, min_len - len(audio)))
        embeds = self._encoder.embed_utterance(audio)
        return embeds.astype(np.float32)

    def _spectral_embed(self, audio: NDArray[np.float32], sr: int) -> NDArray[np.float32]:
        """MFCC mean/variance fallback — 256-d vector from spectral stats."""
        audio = audio.astype(np.float32)
        if audio.ndim > 1:
            audio = audio.mean(axis=-1)
        n_mfcc = 20
        frame_len = int(sr * 0.025)
        hop_len = int(sr * 0.010)
        if len(audio) < frame_len:
            audio = np.pad(audio, (0, frame_len - len(audio)))

        # DFT-based MFCC extraction (zero external deps)
        frames = np.lib.stride_tricks.sliding_window_view(audio, frame_len)[::hop_len]
        windowed = frames * np.hanning(frame_len)
        spectrum = np.abs(np.fft.rfft(windowed))[:, :n_mfcc]
        spectrum = np.where(spectrum == 0, 1e-10, spectrum)
        log_spec = np.log(spectrum)
        # DCT-II approximation (manual)
        n_coeffs = log_spec.shape[1]  # number of MFCC coefficients
        dct = np.zeros_like(log_spec)
        for k in range(n_coeffs):
            # cos term has shape (n_coeffs,), broadcast with log_spec (n_frames, n_coeffs)
            cos_term = np.cos(np.pi * k * (np.arange(n_coeffs) + 0.5) / n_coeffs)
            dct[:, k] = np.sum(log_spec * cos_term[None, :], axis=1)
        mfccs = dct[:, :n_mfcc]

        # 256-d: mean(20) + std(20) = 40, then pad/cycle to 256
        mean = np.mean(mfccs, axis=0)
        std = np.std(mfccs, axis=0) + 1e-8
        stats = np.concatenate([mean, std])  # 40-d
        # Cycle-pad to 256-d
        embed = np.tile(stats, 256 // len(stats) + 1)[:256]
        # L2 normalize
        norm = np.linalg.norm(embed)
        if norm > 0:
            embed = embed / norm
        return embed.astype(np.float32)

    def enroll(self, embeddings: list[NDArray[np.float32]]) -> NDArray[np.float32]:
        """Create a speaker profile (mean embedding) from collected samples."""
        if not embeddings:
            raise ValueError("Need at least one embedding for enrollment")
        stacked = np.stack(embeddings)
        profile = np.mean(stacked, axis=0)
        norm = np.linalg.norm(profile)
        if norm > 0:
            profile = profile / norm
        return profile.astype(np.float32)

    def verify(
        self,
        audio: NDArray[np.float32],
        sr: int,
        profile: NDArray[np.float32],
        threshold: float = 0.65,
    ) -> tuple[bool, float]:
        """Check if audio matches the enrolled speaker.

        Returns (accepted, cosine_similarity).
        """
        emb = self.embed(audio, sr)
        sim = float(np.dot(emb, profile) / (np.linalg.norm(emb) * np.linalg.norm(profile) + 1e-8))
        return sim >= threshold, sim
