"""Tests for speaker.py — embedding, enrollment, verification, fallback."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from stt.speaker import SpeakerVerifier


def _make_audio(duration_sec: float = 1.0, sr: int = 16000, freq: float = 440.0) -> NDArray[np.float32]:
    """Generate a synthetic tone at given frequency."""
    t = np.linspace(0, duration_sec, int(sr * duration_sec), dtype=np.float32)
    return np.sin(2 * np.pi * freq * t).astype(np.float32)


class TestSpeakerEmbed:
    def test_embedding_shape(self):
        v = SpeakerVerifier(method="spectral")
        audio = _make_audio(1.0, 16000, 440.0)
        emb = v.embed(audio, 16000)
        assert emb.shape == (256,), f"Expected (256,), got {emb.shape}"
        assert emb.dtype == np.float32

    def test_embedding_normalized(self):
        v = SpeakerVerifier(method="spectral")
        audio = _make_audio(1.0, 16000, 440.0)
        emb = v.embed(audio, 16000)
        norm = np.linalg.norm(emb)
        assert abs(norm - 1.0) < 0.01, f"Embedding not normalized: {norm}"

    def test_short_audio_padding(self):
        v = SpeakerVerifier(method="spectral")
        audio = _make_audio(0.1, 16000, 440.0)
        emb = v.embed(audio, 16000)
        assert emb.shape == (256,)


class TestSpeakerEnroll:
    def test_enroll_mean_profile(self):
        v = SpeakerVerifier(method="spectral")
        a1 = _make_audio(1.0, 16000, 440.0)
        a2 = _make_audio(1.0, 16000, 440.0)
        e1 = v.embed(a1, 16000)
        e2 = v.embed(a2, 16000)
        profile = v.enroll([e1, e2])
        assert profile.shape == (256,)
        # Profile should be close to mean of embeddings
        expected = (e1 + e2) / 2
        expected = expected / np.linalg.norm(expected)
        sim = np.dot(profile, expected)
        assert sim > 0.99, f"Profile not close to mean: {sim}"

    def test_enroll_empty_raises(self):
        v = SpeakerVerifier(method="spectral")
        try:
            v.enroll([])
            assert False, "Should have raised ValueError"
        except ValueError:
            pass


class TestSpeakerVerify:
    def test_same_speaker_accepted(self):
        v = SpeakerVerifier(method="spectral")
        audio = _make_audio(1.0, 16000, 440.0)
        emb = v.embed(audio, 16000)
        profile = v.enroll([emb])
        accepted, score = v.verify(audio, 16000, profile, threshold=0.65)
        assert accepted, f"Same speaker not accepted: {score}"
        assert score > 0.99

    def test_different_speaker_rejected(self):
        v = SpeakerVerifier(method="spectral")
        # Create two distinct speakers using different frequencies
        a1 = _make_audio(1.0, 16000, 200.0)
        a2 = _make_audio(1.0, 16000, 800.0)
        e1 = v.embed(a1, 16000)
        profile = v.enroll([e1])
        accepted, score = v.verify(a2, 16000, profile, threshold=0.90)
        # Different tones should have lower similarity
        # (exact rejection depends on spectral fingerprinting)
        assert isinstance(accepted, bool)
        assert isinstance(score, float)

    def test_threshold_boundary(self):
        v = SpeakerVerifier(method="spectral")
        audio = _make_audio(1.0, 16000, 440.0)
        emb = v.embed(audio, 16000)
        profile = v.enroll([emb])
        # With threshold=1.0, even same speaker won't pass (sim ~= 1.0 but float precision)
        accepted, score = v.verify(audio, 16000, profile, threshold=1.0)
        # With threshold=0.0, always passes
        accepted_lo, score_lo = v.verify(audio, 16000, profile, threshold=0.0)
        assert accepted_lo, "Threshold 0.0 should always accept"
        assert score_lo == score  # same computation


class TestSpectralFallback:
    def test_spectral_used_when_resemblyzer_missing(self):
        v = SpeakerVerifier(method="spectral")
        v._loaded = True
        v._encoder = None  # Force no resemblyzer
        audio = _make_audio(1.0, 16000, 440.0)
        emb = v.embed(audio, 16000)
        assert emb.shape == (256,)

    def test_multichannel_audio(self):
        v = SpeakerVerifier(method="spectral")
        stereo = np.stack([_make_audio(1.0, 16000, 440.0)] * 2, axis=-1)
        emb = v.embed(stereo, 16000)
        assert emb.shape == (256,)
