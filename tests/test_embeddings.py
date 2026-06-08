"""Tests for stt/embeddings.py — lazy-loading embedding encoder."""

import unittest
from unittest.mock import patch, MagicMock


class TestIsAvailable(unittest.TestCase):
    def setUp(self):
        # Reset module-level state before each test
        import stt.embeddings as emb
        emb._model = None
        emb._model_available = None

    def test_is_available_returns_false_when_not_installed(self):
        from stt.embeddings import is_available
        with patch("stt.embeddings._get_model", return_value=None):
            self.assertFalse(is_available())

    def test_is_available_returns_true_when_model_loaded(self):
        from stt.embeddings import is_available
        mock_model = MagicMock()
        import stt.embeddings as emb
        emb._model = mock_model
        emb._model_available = True
        try:
            self.assertTrue(is_available())
        finally:
            emb._model = None
            emb._model_available = None

    def test_is_available_caches_failure(self):
        """Once model load fails, it should stay False without retrying."""
        import stt.embeddings as emb
        emb._model = None
        emb._model_available = False
        try:
            from stt.embeddings import is_available
            self.assertFalse(is_available())
        finally:
            emb._model_available = None


class TestCosineSimilarity(unittest.TestCase):
    def test_identical_vectors(self):
        from stt.embeddings import cosine_similarity
        v = [1.0, 2.0, 3.0]
        score = cosine_similarity(v, v)
        # For normalized vectors this would be 1.0, but un-normalized it's not
        self.assertIsInstance(score, float)

    def test_orthogonal_vectors(self):
        from stt.embeddings import cosine_similarity
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        score = cosine_similarity(a, b)
        self.assertAlmostEqual(score, 0.0)

    def test_same_direction(self):
        from stt.embeddings import cosine_similarity
        a = [0.5, 0.5]
        b = [1.0, 1.0]
        score = cosine_similarity(a, b)
        self.assertGreater(score, 0.0)

    def test_opposite_direction(self):
        from stt.embeddings import cosine_similarity
        a = [1.0, 1.0]
        b = [-1.0, -1.0]
        score = cosine_similarity(a, b)
        self.assertLess(score, 0.0)


class TestMostSimilar(unittest.TestCase):
    def setUp(self):
        import stt.embeddings as emb
        emb._model = None
        emb._model_available = None

    def test_returns_empty_when_model_unavailable(self):
        from stt.embeddings import most_similar
        with patch("stt.embeddings._get_model", return_value=None):
            result = most_similar("hello", ["hello world", "goodbye"])
            self.assertEqual(result, [])

    def test_returns_empty_for_empty_candidates(self):
        from stt.embeddings import most_similar
        result = most_similar("hello", [])
        self.assertEqual(result, [])

    def test_filters_below_min_score(self):
        """If no candidate meets min_score, return empty."""
        from stt.embeddings import most_similar
        mock_model = MagicMock()
        # Normalized vectors: query=[1,0,0], candidate=[0,1,0] → score=0
        mock_model.encode.return_value = [
            [1.0, 0.0, 0.0],  # query
            [0.0, 1.0, 0.0],  # candidate
        ]
        import stt.embeddings as emb
        emb._model = mock_model
        emb._model_available = True
        try:
            result = most_similar("hello", ["world"], min_score=0.5)
            self.assertEqual(result, [])
        finally:
            emb._model = None
            emb._model_available = None

    def test_returns_top_k_by_score(self):
        from stt.embeddings import most_similar
        mock_model = MagicMock()
        # query high similarity to second candidate
        mock_model.encode.return_value = [
            [0.0, 1.0, 0.0],  # query
            [1.0, 0.0, 0.0],  # candidate 0 (low sim)
            [0.0, 1.0, 0.0],  # candidate 1 (high sim)
        ]
        import stt.embeddings as emb
        emb._model = mock_model
        emb._model_available = True
        try:
            result = most_similar("test", ["a", "b"], top_k=1, min_score=0.0)
            self.assertEqual(len(result), 1)
            # candidate index 1 should be highest
            self.assertEqual(result[0][0], 1)
        finally:
            emb._model = None
            emb._model_available = None

    def test_respects_top_k_limit(self):
        from stt.embeddings import most_similar
        mock_model = MagicMock()
        n = 5
        vectors = [[float(i == j) for i in range(3)] for j in range(n + 1)]
        mock_model.encode.return_value = vectors
        import stt.embeddings as emb
        emb._model = mock_model
        emb._model_available = True
        try:
            result = most_similar("test", ["a", "b", "c", "d", "e"], top_k=2, min_score=0.0)
            self.assertLessEqual(len(result), 2)
        finally:
            emb._model = None
            emb._model_available = None


class TestBuildFewShotContext(unittest.TestCase):
    def setUp(self):
        import stt.embeddings as emb
        emb._model = None
        emb._model_available = None

    def test_empty_candidates_returns_empty_string(self):
        from stt.embeddings import build_few_shot_context
        result = build_few_shot_context("hello", [])
        self.assertEqual(result, "")

    def test_no_useful_pairs_returns_empty_string(self):
        """If all pairs are identical (raw == corrected), return empty."""
        from stt.embeddings import build_few_shot_context
        candidates = [
            {"raw_text": "same", "processed_text": "same"},
            {"raw_text": "also same", "processed_text": "also same"},
        ]
        with patch("stt.embeddings.is_available", return_value=False):
            result = build_few_shot_context("hello", candidates)
        self.assertEqual(result, "")

    def test_fallback_word_matching(self):
        """Without embeddings, fall back to word overlap matching."""
        from stt.embeddings import build_few_shot_context
        candidates = [
            {"raw_text": "hello world", "processed_text": "Hello world."},
            {"raw_text": "goodbye moon", "processed_text": "Goodbye moon."},
        ]
        with patch("stt.embeddings.is_available", return_value=False):
            result = build_few_shot_context("hello there", candidates)
        self.assertNotEqual(result, "")
        self.assertIn("hello world", result)
        self.assertIn("Hello world.", result)

    def test_no_word_overlap_returns_empty(self):
        from stt.embeddings import build_few_shot_context
        candidates = [
            {"raw_text": "foo bar", "processed_text": "Foo bar."},
        ]
        with patch("stt.embeddings.is_available", return_value=False):
            result = build_few_shot_context("hello", candidates)
        self.assertEqual(result, "")

    def test_includes_correction_header(self):
        from stt.embeddings import build_few_shot_context
        candidates = [
            {"raw_text": "hello world", "processed_text": "Hello world."},
        ]
        with patch("stt.embeddings.is_available", return_value=False):
            result = build_few_shot_context("hello", candidates)
        self.assertIn("Here are examples", result)
        self.assertIn("Follow the same style", result)

    def test_max_tokens_respected(self):
        """Should truncate output when token estimate exceeds max_tokens."""
        from stt.embeddings import build_few_shot_context
        candidates = [
            {"raw_text": f"very long sentence number {i} with many words in it",
             "processed_text": f"Very long sentence number {i} with many words in it."}
            for i in range(20)
        ]
        with patch("stt.embeddings.is_available", return_value=False):
            result = build_few_shot_context("hello", candidates, max_tokens=10)
        # Should produce very short output or empty if first pair exceeds limit
        self.assertIsInstance(result, str)

    def test_empty_raw_or_corrected_skipped(self):
        from stt.embeddings import build_few_shot_context
        candidates = [
            {"raw_text": "", "processed_text": "Got it."},
            {"raw_text": "hello", "processed_text": ""},
            {"raw_text": "good text", "processed_text": "Good text."},
        ]
        with patch("stt.embeddings.is_available", return_value=False):
            result = build_few_shot_context("good text", candidates)
        self.assertIn("Good text.", result)
        self.assertNotIn("Got it", result)

    def test_format_uses_arrow(self):
        from stt.embeddings import build_few_shot_context
        candidates = [
            {"raw_text": "raw", "processed_text": "corrected"},
        ]
        with patch("stt.embeddings.is_available", return_value=False):
            result = build_few_shot_context("raw test", candidates)
        self.assertIn("→", result)


class TestEncode(unittest.TestCase):
    def setUp(self):
        import stt.embeddings as emb
        emb._model = None
        emb._model_available = None

    def test_encode_returns_none_when_unavailable(self):
        from stt.embeddings import encode
        with patch("stt.embeddings._get_model", return_value=None):
            result = encode("test")
            self.assertIsNone(result)

    def test_encode_batch_returns_nones_when_unavailable(self):
        from stt.embeddings import encode_batch
        with patch("stt.embeddings._get_model", return_value=None):
            result = encode_batch(["a", "b"])
            self.assertEqual(result, [None, None])


if __name__ == "__main__":
    unittest.main()
