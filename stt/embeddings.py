"""Lazy-loading embedding encoder for transcript similarity search.

Uses sentence-transformers (all-MiniLM-L6-v2, ~80MB). Model is loaded on
first use and cached in memory. Designed for low-latency few-shot retrieval:
encode time should be <30ms for short transcripts.

If sentence-transformers is not installed, all functions return empty results
without raising — the system gracefully degrades to FTS5-only search.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Optional


_EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
_model: Optional[object] = None
_model_lock = threading.Lock()
_model_available: Optional[bool] = None  # None = not checked yet


def _get_model():
    """Lazy-load the sentence-transformers model. Thread-safe, single-load."""
    global _model, _model_available
    if _model is not None:
        return _model
    if _model_available is False:
        return None
    with _model_lock:
        if _model is not None:
            return _model
        if _model_available is False:
            return None
        try:
            from sentence_transformers import SentenceTransformer
            _model = SentenceTransformer(_EMBEDDING_MODEL_NAME)
            _model_available = True
            return _model
        except Exception:
            _model_available = False
            return None


def is_available() -> bool:
    """Return True if sentence-transformers is installed and model is loadable."""
    _get_model()
    return _model_available is True


def encode(text: str) -> Optional[list[float]]:
    """Encode a single text string to an embedding vector (384-dim). Returns None if unavailable."""
    model = _get_model()
    if model is None:
        return None
    try:
        vec = model.encode([text], show_progress_bar=False, normalize_embeddings=True)
        return vec[0].tolist()  # type: ignore[union-attr]
    except Exception:
        return None


def encode_batch(texts: list[str]) -> list[Optional[list[float]]]:
    """Encode multiple texts. Returns list of vectors (None per item on failure)."""
    model = _get_model()
    if model is None:
        return [None] * len(texts)
    try:
        vecs = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)
        return [v.tolist() for v in vecs]
    except Exception:
        return [None] * len(texts)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two pre-normalized embedding vectors."""
    return float(sum(x * y for x, y in zip(a, b)))


def most_similar(
    query_text: str,
    candidates: list[str],
    top_k: int = 3,
    min_score: float = 0.3,
) -> list[tuple[int, float]]:
    """Find top-K most similar candidates to query_text.

    Returns list of (candidate_index, similarity_score), sorted descending,
    filtered to scores >= min_score. Returns empty list if embeddings unavailable.
    """
    model = _get_model()
    if model is None or not candidates:
        return []

    try:
        all_texts = [query_text] + candidates
        vecs = model.encode(all_texts, show_progress_bar=False, normalize_embeddings=True)
        query_vec = vecs[0]
        candidate_vecs = vecs[1:]

        scored: list[tuple[int, float]] = []
        for i, cv in enumerate(candidate_vecs):
            score = float(sum(x * y for x, y in zip(query_vec, cv)))
            if score >= min_score:
                scored.append((i, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:top_k]
    except Exception:
        return []


def build_few_shot_context(
    query_text: str,
    candidates: list[dict[str, str]],
    top_k: int = 3,
    max_tokens: int = 400,
) -> str:
    """Build a compact few-shot context string from similar past corrections.

    Uses embedding similarity if sentence-transformers is available,
    falls back to simple truncation by length otherwise.

    Returns an empty string if no useful candidates are found.
    """
    if not candidates:
        return ""

    if is_available():
        raw_texts = [c.get("raw_text", "") for c in candidates]
        similar = most_similar(query_text, raw_texts, top_k=top_k, min_score=0.3)
        selected = [candidates[i] for i, _ in similar] if similar else []
    else:
        # Fallback: pick most recent that share at least one word
        query_words = set(query_text.lower().split())
        matching = [
            c for c in candidates
            if query_words & set(c.get("raw_text", "").lower().split())
        ]
        selected = matching[:top_k]

    if not selected:
        return ""

    lines: list[str] = []
    token_estimate = 0
    for pair in selected:
        raw = pair.get("raw_text", "")
        corrected = pair.get("processed_text", "")
        if not raw or not corrected or raw == corrected:
            continue
        line = f'"{raw}" → "{corrected}"'
        token_estimate += len(line.split()) * 1.3
        if token_estimate > max_tokens:
            break
        lines.append(line)

    if not lines:
        return ""

    return (
        "Here are examples of how similar transcripts were corrected:\n"
        + "\n".join(lines)
        + "\n\nFollow the same style when correcting the transcript below.\n\n"
    )
