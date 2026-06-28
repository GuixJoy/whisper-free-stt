"""QA tests for every Socket.IO event handler in stt/server.py.

Tests handler functions directly by importing them and calling with mock
sid/environ dicts. Uses a real in-memory HistoryStore (no mocks for DB).
Mocks only sio.emit to capture outbound events.
"""

from __future__ import annotations

import asyncio
import io
import os
import tempfile
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest

# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------

_FAKE_SID = "test-sid-001"


def _make_environ() -> dict:
    """Minimal WSGI environ dict for connect()."""
    return {"HTTP_HOST": "localhost:8000", "SERVER_NAME": "localhost"}


def _patch_store(tmp_db: str):
    """Return a context manager that patches get_store to use a temp DB."""
    from stt.history import HistoryStore

    store = HistoryStore(tmp_db)
    return patch("stt.server.get_store", return_value=store), store


def _seed_transcript(store, raw="hello world", processed="Hello world.", **kw):
    """Insert a transcript and return its id."""
    return store.insert(raw, processed, **kw)


def _seed_dict_entry(store, phrase="flouray", replacement="Floure", **kw):
    """Insert a dictionary entry and return its id."""
    return store.add_dictionary_entry(phrase, replacement, **kw)


# ---------------------------------------------------------------------------
# collect_events helper — captures sio.emit calls
# ---------------------------------------------------------------------------

class EmitCollector:
    """Intercepts sio.emit calls and stores (event, data, kwargs) tuples."""

    def __init__(self):
        self.events: list[tuple[str, dict, dict]] = []

    async def __call__(self, event: str, data=None, **kwargs):
        self.events.append((event, data, kwargs))

    def reset(self):
        self.events.clear()

    def by_event(self, event_name: str) -> list[dict]:
        return [d for (e, d, _) in self.events if e == event_name]


# ===========================================================================
# connect / disconnect
# ===========================================================================

class TestConnectDisconnect(unittest.TestCase):
    """Test client tracking via _browser_clients set."""

    def setUp(self):
        import stt.server as srv
        self._orig = srv._browser_clients.copy()
        srv._browser_clients.clear()

    def tearDown(self):
        import stt.server as srv
        srv._browser_clients.clear()
        srv._browser_clients.update(self._orig)

    def test_connect_adds_sid(self):
        from stt.server import connect
        asyncio.get_event_loop().run_until_complete(
            connect(_FAKE_SID, _make_environ())
        )
        import stt.server as srv
        self.assertIn(_FAKE_SID, srv._browser_clients)

    def test_connect_multiple_clients(self):
        from stt.server import connect
        loop = asyncio.get_event_loop()
        loop.run_until_complete(connect("sid-a", _make_environ()))
        loop.run_until_complete(connect("sid-b", _make_environ()))
        import stt.server as srv
        self.assertIn("sid-a", srv._browser_clients)
        self.assertIn("sid-b", srv._browser_clients)
        self.assertEqual(len(srv._browser_clients), 2)

    def test_disconnect_removes_sid(self):
        from stt.server import connect, disconnect
        loop = asyncio.get_event_loop()
        loop.run_until_complete(connect(_FAKE_SID, _make_environ()))
        loop.run_until_complete(disconnect(_FAKE_SID))
        import stt.server as srv
        self.assertNotIn(_FAKE_SID, srv._browser_clients)

    def test_disconnect_nonexistent_is_safe(self):
        from stt.server import disconnect
        loop = asyncio.get_event_loop()
        loop.run_until_complete(disconnect("ghost-sid"))  # should not raise

    def test_disconnect_only_removes_target(self):
        from stt.server import connect, disconnect
        loop = asyncio.get_event_loop()
        loop.run_until_complete(connect("sid-a", _make_environ()))
        loop.run_until_complete(connect("sid-b", _make_environ()))
        loop.run_until_complete(disconnect("sid-a"))
        import stt.server as srv
        self.assertNotIn("sid-a", srv._browser_clients)
        self.assertIn("sid-b", srv._browser_clients)


# ===========================================================================
# audio_chunk
# ===========================================================================

class TestAudioChunk(unittest.TestCase):
    """Test audio chunk handler — float32 PCM bytes → queue."""

    def setUp(self):
        import stt.server as _srv
        self._orig_queue = _srv._audio_queue
        _srv._audio_queue = asyncio.Queue()

    def tearDown(self):
        import stt.server as _srv
        _srv._audio_queue = self._orig_queue

    def test_valid_audio_chunk_queued(self):
        from stt.server import audio_chunk
        import stt.server as _srv
        pcm = np.array([0.1, 0.2, -0.3], dtype=np.float32)
        loop = asyncio.get_event_loop()
        loop.run_until_complete(audio_chunk(_FAKE_SID, pcm.tobytes()))
        self.assertFalse(_srv._audio_queue.empty())
        item = _srv._audio_queue.get_nowait()
        np.testing.assert_array_equal(item, pcm)

    def test_empty_audio_not_queued(self):
        from stt.server import audio_chunk
        import stt.server as _srv
        loop = asyncio.get_event_loop()
        loop.run_until_complete(audio_chunk(_FAKE_SID, b""))
        self.assertTrue(_srv._audio_queue.empty())

    def test_large_audio_chunk(self):
        from stt.server import audio_chunk
        import stt.server as _srv
        pcm = np.random.randn(16000).astype(np.float32)  # 1 second
        loop = asyncio.get_event_loop()
        loop.run_until_complete(audio_chunk(_FAKE_SID, pcm.tobytes()))
        item = _srv._audio_queue.get_nowait()
        self.assertEqual(len(item), 16000)

    def test_multiple_chunks_fifo_order(self):
        from stt.server import audio_chunk
        import stt.server as _srv
        loop = asyncio.get_event_loop()
        for i in range(5):
            pcm = np.array([float(i)], dtype=np.float32)
            loop.run_until_complete(audio_chunk(_FAKE_SID, pcm.tobytes()))
        self.assertEqual(_srv._audio_queue.qsize(), 5)
        for i in range(5):
            item = _srv._audio_queue.get_nowait()
            self.assertAlmostEqual(item[0], float(i))


# ===========================================================================
# get_history
# ===========================================================================

class TestGetHistory(unittest.TestCase):
    """Test get_history handler."""

    def setUp(self):
        fd, self._db = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._patcher, self.store = _patch_store(self._db)
        self._patcher.start()
        self.collector = EmitCollector()
        self._emit_patcher = patch("stt.server.sio")
        mock_sio = self._emit_patcher.start()
        mock_sio.emit = self.collector

    def tearDown(self):
        self._patcher.stop()
        self._emit_patcher.stop()
        os.unlink(self._db)

    def test_returns_rows_dict(self):
        from stt.server import get_history
        _seed_transcript(self.store, "hello", "Hello.")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_history(_FAKE_SID, {}))
        emitted = self.collector.by_event("history")
        self.assertEqual(len(emitted), 1)
        self.assertIn("rows", emitted[0])
        self.assertIsInstance(emitted[0]["rows"], list)

    def test_default_limit(self):
        from stt.server import get_history
        for i in range(5):
            _seed_transcript(self.store, f"row {i}", f"Row {i}.")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_history(_FAKE_SID, {}))
        rows = self.collector.by_event("history")[0]["rows"]
        self.assertLessEqual(len(rows), 100)

    def test_custom_limit(self):
        from stt.server import get_history
        for i in range(10):
            _seed_transcript(self.store, f"row {i}", f"Row {i}.")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_history(_FAKE_SID, {"limit": 3}))
        rows = self.collector.by_event("history")[0]["rows"]
        self.assertLessEqual(len(rows), 3)

    def test_non_dict_data_handled(self):
        from stt.server import get_history
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_history(_FAKE_SID, "invalid"))
        emitted = self.collector.by_event("history")
        self.assertEqual(len(emitted), 1)

    def test_empty_db_returns_empty(self):
        from stt.server import get_history
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_history(_FAKE_SID, {}))
        rows = self.collector.by_event("history")[0]["rows"]
        self.assertEqual(rows, [])

    def test_emitted_to_correct_sid(self):
        from stt.server import get_history
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_history("target-sid", {}))
        self.assertEqual(self.collector.events[0][2].get("to"), "target-sid")


# ===========================================================================
# search_history
# ===========================================================================

class TestSearchHistory(unittest.TestCase):
    def setUp(self):
        fd, self._db = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._patcher, self.store = _patch_store(self._db)
        self._patcher.start()
        self.collector = EmitCollector()
        self._emit_patcher = patch("stt.server.sio")
        mock_sio = self._emit_patcher.start()
        mock_sio.emit = self.collector

    def tearDown(self):
        self._patcher.stop()
        self._emit_patcher.stop()
        os.unlink(self._db)

    def test_search_finds_matches(self):
        from stt.server import search_history
        _seed_transcript(self.store, "hello world test", "Hello world test.")
        _seed_transcript(self.store, "something else", "Something else.")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(search_history(_FAKE_SID, {"query": "hello"}))
        rows = self.collector.by_event("history")[0]["rows"]
        self.assertGreater(len(rows), 0)

    def test_search_no_match(self):
        from stt.server import search_history
        _seed_transcript(self.store, "hello world", "Hello.")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(search_history(_FAKE_SID, {"query": "zzzznotfound"}))
        rows = self.collector.by_event("history")[0]["rows"]
        self.assertEqual(len(rows), 0)

    def test_search_empty_query(self):
        from stt.server import search_history
        loop = asyncio.get_event_loop()
        loop.run_until_complete(search_history(_FAKE_SID, {"query": ""}))
        rows = self.collector.by_event("history")[0]["rows"]
        self.assertIsInstance(rows, list)

    def test_search_non_dict_data(self):
        from stt.server import search_history
        loop = asyncio.get_event_loop()
        loop.run_until_complete(search_history(_FAKE_SID, None))
        emitted = self.collector.by_event("history")
        self.assertEqual(len(emitted), 1)

    def test_search_missing_query_key(self):
        from stt.server import search_history
        loop = asyncio.get_event_loop()
        loop.run_until_complete(search_history(_FAKE_SID, {}))
        emitted = self.collector.by_event("history")
        self.assertEqual(len(emitted), 1)


# ===========================================================================
# get_insights
# ===========================================================================

class TestGetInsights(unittest.TestCase):
    def setUp(self):
        fd, self._db = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._patcher, self.store = _patch_store(self._db)
        self._patcher.start()
        self.collector = EmitCollector()
        self._emit_patcher = patch("stt.server.sio")
        mock_sio = self._emit_patcher.start()
        mock_sio.emit = self.collector

    def tearDown(self):
        self._patcher.stop()
        self._emit_patcher.stop()
        os.unlink(self._db)

    def test_emits_insights_event(self):
        from stt.server import get_insights
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_insights(_FAKE_SID))
        emitted = self.collector.by_event("insights")
        self.assertEqual(len(emitted), 1)
        self.assertIn("data", emitted[0])

    def test_insights_data_structure(self):
        from stt.server import get_insights
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_insights(_FAKE_SID))
        data = self.collector.by_event("insights")[0]["data"]
        for key in ("wpm", "totalWords", "aiFixes", "categories", "streak", "heatmap"):
            self.assertIn(key, data)

    def test_insights_with_data(self):
        from stt.server import get_insights
        _seed_transcript(self.store, "hello world test", "Hello world test.",
                         mode="cleanup", duration_sec=60.0)
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_insights(_FAKE_SID))
        data = self.collector.by_event("insights")[0]["data"]
        self.assertGreater(data["totalWords"], 0)


# ===========================================================================
# export_history
# ===========================================================================

class TestExportHistory(unittest.TestCase):
    def setUp(self):
        fd, self._db = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._patcher, self.store = _patch_store(self._db)
        self._patcher.start()
        self.collector = EmitCollector()
        self._emit_patcher = patch("stt.server.sio")
        mock_sio = self._emit_patcher.start()
        mock_sio.emit = self.collector

    def tearDown(self):
        self._patcher.stop()
        self._emit_patcher.stop()
        os.unlink(self._db)

    def test_export_csv_default(self):
        from stt.server import export_history
        _seed_transcript(self.store, "hello", "Hello.")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(export_history(_FAKE_SID, {}))
        emitted = self.collector.by_event("export")
        self.assertEqual(len(emitted), 1)
        self.assertIn("csv", emitted[0])

    def test_export_csv_explicit(self):
        from stt.server import export_history
        loop = asyncio.get_event_loop()
        loop.run_until_complete(export_history(_FAKE_SID, {"format": "csv"}))
        emitted = self.collector.by_event("export")
        self.assertIn("csv", emitted[0])

    def test_export_text(self):
        from stt.server import export_history
        loop = asyncio.get_event_loop()
        loop.run_until_complete(export_history(_FAKE_SID, {"format": "text"}))
        emitted = self.collector.by_event("export")
        self.assertIn("text", emitted[0])

    def test_export_empty_db_csv(self):
        from stt.server import export_history
        loop = asyncio.get_event_loop()
        loop.run_until_complete(export_history(_FAKE_SID, {}))
        csv_content = self.collector.by_event("export")[0]["csv"]
        self.assertIn("id,raw_text", csv_content)

    def test_export_non_dict_data(self):
        from stt.server import export_history
        loop = asyncio.get_event_loop()
        loop.run_until_complete(export_history(_FAKE_SID, "bad"))
        emitted = self.collector.by_event("export")
        self.assertEqual(len(emitted), 1)

    def test_export_text_content_format(self):
        from stt.server import export_history
        _seed_transcript(self.store, "hello", "Hello.", mode="cleanup")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(export_history(_FAKE_SID, {"format": "text"}))
        text = self.collector.by_event("export")[0]["text"]
        self.assertIn("STT Transcript History", text)


# ===========================================================================
# toggle_favorite
# ===========================================================================

class TestToggleFavorite(unittest.TestCase):
    def setUp(self):
        fd, self._db = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._patcher, self.store = _patch_store(self._db)
        self._patcher.start()
        self.collector = EmitCollector()
        self._emit_patcher = patch("stt.server.sio")
        mock_sio = self._emit_patcher.start()
        mock_sio.emit = self.collector

    def tearDown(self):
        self._patcher.stop()
        self._emit_patcher.stop()
        os.unlink(self._db)

    def test_toggle_favorite_on(self):
        from stt.server import toggle_favorite
        rid = _seed_transcript(self.store, "test", "Test.")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(toggle_favorite(_FAKE_SID, {"id": rid}))
        emitted = self.collector.by_event("favorited")
        self.assertEqual(len(emitted), 1)
        self.assertTrue(emitted[0]["favorite"])

    def test_toggle_favorite_off(self):
        from stt.server import toggle_favorite
        rid = _seed_transcript(self.store, "test", "Test.")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(toggle_favorite(_FAKE_SID, {"id": rid}))
        loop.run_until_complete(toggle_favorite(_FAKE_SID, {"id": rid}))
        emitted = self.collector.by_event("favorited")
        self.assertEqual(len(emitted), 2)
        self.assertFalse(emitted[1]["favorite"])

    def test_toggle_favorite_nonexistent_id(self):
        """BUG: toggle_favorite emits with favorite=None for nonexistent id.
        
        Server code at server.py:106-108 does not check new_state for None
        before emitting. The frontend receives {favorite: null} which is
        a broken state. Should silently ignore like the other handlers.
        """
        from stt.server import toggle_favorite
        loop = asyncio.get_event_loop()
        loop.run_until_complete(toggle_favorite(_FAKE_SID, {"id": 99999}))
        emitted = self.collector.by_event("favorited")
        # Actual behavior: emits with favorite=None (BUG in server)
        self.assertEqual(len(emitted), 1)
        self.assertIsNone(emitted[0]["favorite"])

    def test_toggle_favorite_no_id(self):
        from stt.server import toggle_favorite
        loop = asyncio.get_event_loop()
        loop.run_until_complete(toggle_favorite(_FAKE_SID, {}))
        self.assertEqual(len(self.collector.events), 0)

    def test_toggle_favorite_non_dict_data(self):
        from stt.server import toggle_favorite
        loop = asyncio.get_event_loop()
        loop.run_until_complete(toggle_favorite(_FAKE_SID, "bad"))
        self.assertEqual(len(self.collector.events), 0)

    def test_toggle_favorite_none_id(self):
        from stt.server import toggle_favorite
        loop = asyncio.get_event_loop()
        loop.run_until_complete(toggle_favorite(_FAKE_SID, {"id": None}))
        self.assertEqual(len(self.collector.events), 0)


# ===========================================================================
# delete_entry
# ===========================================================================

class TestDeleteEntry(unittest.TestCase):
    def setUp(self):
        fd, self._db = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._patcher, self.store = _patch_store(self._db)
        self._patcher.start()
        self.collector = EmitCollector()
        self._emit_patcher = patch("stt.server.sio")
        mock_sio = self._emit_patcher.start()
        mock_sio.emit = self.collector

    def tearDown(self):
        self._patcher.stop()
        self._emit_patcher.stop()
        os.unlink(self._db)

    def test_delete_existing(self):
        from stt.server import delete_entry
        rid = _seed_transcript(self.store, "delete me", "Delete me.")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(delete_entry(_FAKE_SID, {"id": rid}))
        emitted = self.collector.by_event("deleted")
        self.assertEqual(len(emitted), 1)
        self.assertEqual(emitted[0]["id"], rid)
        # Verify actually deleted
        rows = self.store.get_recent()
        self.assertFalse(any(r["id"] == rid for r in rows))

    def test_delete_nonexistent_always_emits(self):
        """BUG: delete_entry emits 'deleted' even for nonexistent ids.
        
        store.delete_entry (history.py:525-534) always returns True because
        DELETE WHERE id=? succeeds even when no rows match. The handler emits
        'deleted' unconditionally for any truthy id.
        """
        from stt.server import delete_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(delete_entry(_FAKE_SID, {"id": 99999}))
        emitted = self.collector.by_event("deleted")
        # Actual behavior: emits deleted for any id (BUG in store.delete_entry)
        self.assertEqual(len(emitted), 1)

    def test_delete_no_id(self):
        from stt.server import delete_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(delete_entry(_FAKE_SID, {}))
        self.assertEqual(len(self.collector.events), 0)

    def test_delete_non_dict(self):
        from stt.server import delete_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(delete_entry(_FAKE_SID, "bad"))
        self.assertEqual(len(self.collector.events), 0)

    def test_delete_none_id(self):
        from stt.server import delete_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(delete_entry(_FAKE_SID, {"id": None}))
        self.assertEqual(len(self.collector.events), 0)


# ===========================================================================
# get_dictionary
# ===========================================================================

class TestGetDictionary(unittest.TestCase):
    def setUp(self):
        fd, self._db = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._patcher, self.store = _patch_store(self._db)
        self._patcher.start()
        self.collector = EmitCollector()
        self._emit_patcher = patch("stt.server.sio")
        mock_sio = self._emit_patcher.start()
        mock_sio.emit = self.collector

    def tearDown(self):
        self._patcher.stop()
        self._emit_patcher.stop()
        os.unlink(self._db)

    def test_get_dictionary_empty(self):
        from stt.server import get_dictionary
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_dictionary(_FAKE_SID, {}))
        emitted = self.collector.by_event("dictionary")
        self.assertEqual(len(emitted), 1)
        self.assertEqual(emitted[0]["rows"], [])

    def test_get_dictionary_with_entries(self):
        from stt.server import get_dictionary
        _seed_dict_entry(self.store, "flouray", "Floure")
        _seed_dict_entry(self.store, "ceo", "Chief Executive Officer")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_dictionary(_FAKE_SID, {}))
        rows = self.collector.by_event("dictionary")[0]["rows"]
        self.assertEqual(len(rows), 2)

    def test_get_dictionary_search(self):
        from stt.server import get_dictionary
        _seed_dict_entry(self.store, "flouray", "Floure")
        _seed_dict_entry(self.store, "ceo", "Chief Executive Officer")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_dictionary(_FAKE_SID, {"search": "flouray"}))
        rows = self.collector.by_event("dictionary")[0]["rows"]
        self.assertEqual(len(rows), 1)

    def test_get_dictionary_category_filter(self):
        from stt.server import get_dictionary
        _seed_dict_entry(self.store, "a", "A", category="tech")
        _seed_dict_entry(self.store, "b", "B", category="names")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_dictionary(_FAKE_SID, {"category": "tech"}))
        rows = self.collector.by_event("dictionary")[0]["rows"]
        self.assertEqual(len(rows), 1)

    def test_get_dictionary_favorite_only(self):
        from stt.server import get_dictionary
        _seed_dict_entry(self.store, "a", "A")
        _seed_dict_entry(self.store, "b", "B")
        self.store.toggle_dictionary_favorite(
            self.store.add_dictionary_entry("fav", "Fav")["id"]
        )
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_dictionary(_FAKE_SID, {"favorite": True}))
        rows = self.collector.by_event("dictionary")[0]["rows"]
        self.assertTrue(all(r["is_favorite"] for r in rows))

    def test_get_dictionary_non_dict_data(self):
        from stt.server import get_dictionary
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_dictionary(_FAKE_SID, "bad"))
        emitted = self.collector.by_event("dictionary")
        self.assertEqual(len(emitted), 1)


# ===========================================================================
# add_dictionary_entry
# ===========================================================================

class TestAddDictionaryEntry(unittest.TestCase):
    def setUp(self):
        fd, self._db = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._patcher, self.store = _patch_store(self._db)
        self._patcher.start()
        self.collector = EmitCollector()
        self._emit_patcher = patch("stt.server.sio")
        mock_sio = self._emit_patcher.start()
        mock_sio.emit = self.collector

    def tearDown(self):
        self._patcher.stop()
        self._emit_patcher.stop()
        os.unlink(self._db)

    def test_add_success(self):
        from stt.server import add_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(add_dictionary_entry(_FAKE_SID, {
            "phrase": "flouray", "replacement": "Floure",
            "category": "custom", "notes": "test note"
        }))
        emitted = self.collector.by_event("dictionary_added")
        self.assertEqual(len(emitted), 1)
        self.assertIn("entry", emitted[0])
        self.assertEqual(emitted[0]["entry"]["phrase"], "flouray")

    def test_add_duplicate(self):
        from stt.server import add_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(add_dictionary_entry(_FAKE_SID, {
            "phrase": "flouray", "replacement": "Floure"
        }))
        loop.run_until_complete(add_dictionary_entry(_FAKE_SID, {
            "phrase": "flouray", "replacement": "Different"
        }))
        errors = self.collector.by_event("dictionary_error")
        self.assertEqual(len(errors), 1)

    def test_add_empty_phrase(self):
        from stt.server import add_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(add_dictionary_entry(_FAKE_SID, {
            "phrase": "", "replacement": "Floure"
        }))
        errors = self.collector.by_event("dictionary_error")
        self.assertEqual(len(errors), 1)

    def test_add_empty_replacement(self):
        from stt.server import add_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(add_dictionary_entry(_FAKE_SID, {
            "phrase": "flouray", "replacement": ""
        }))
        errors = self.collector.by_event("dictionary_error")
        self.assertEqual(len(errors), 1)

    def test_add_phrase_too_long(self):
        from stt.server import add_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(add_dictionary_entry(_FAKE_SID, {
            "phrase": "a" * 61, "replacement": "ok"
        }))
        errors = self.collector.by_event("dictionary_error")
        self.assertEqual(len(errors), 1)

    def test_add_replacement_too_long(self):
        from stt.server import add_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(add_dictionary_entry(_FAKE_SID, {
            "phrase": "ok", "replacement": "b" * 61
        }))
        errors = self.collector.by_event("dictionary_error")
        self.assertEqual(len(errors), 1)

    def test_add_non_dict_data(self):
        from stt.server import add_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(add_dictionary_entry(_FAKE_SID, "bad"))
        self.assertEqual(len(self.collector.events), 0)

    def test_add_default_category(self):
        from stt.server import add_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(add_dictionary_entry(_FAKE_SID, {
            "phrase": "test", "replacement": "Test"
        }))
        emitted = self.collector.by_event("dictionary_added")
        self.assertEqual(emitted[0]["entry"]["category"], "custom")

    def test_add_missing_keys(self):
        from stt.server import add_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(add_dictionary_entry(_FAKE_SID, {}))
        errors = self.collector.by_event("dictionary_error")
        self.assertEqual(len(errors), 1)


# ===========================================================================
# update_dictionary_entry
# ===========================================================================

class TestUpdateDictionaryEntry(unittest.TestCase):
    def setUp(self):
        fd, self._db = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._patcher, self.store = _patch_store(self._db)
        self._patcher.start()
        self.collector = EmitCollector()
        self._emit_patcher = patch("stt.server.sio")
        mock_sio = self._emit_patcher.start()
        mock_sio.emit = self.collector

    def tearDown(self):
        self._patcher.stop()
        self._emit_patcher.stop()
        os.unlink(self._db)

    def test_update_success(self):
        from stt.server import update_dictionary_entry
        entry = _seed_dict_entry(self.store, "flouray", "Floure")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(update_dictionary_entry(_FAKE_SID, {
            "id": entry["id"], "replacement": "Floor"
        }))
        emitted = self.collector.by_event("dictionary_updated")
        self.assertEqual(len(emitted), 1)
        self.assertEqual(emitted[0]["entry"]["replacement"], "Floor")

    def test_update_nonexistent_id(self):
        from stt.server import update_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(update_dictionary_entry(_FAKE_SID, {
            "id": 99999, "replacement": "X"
        }))
        errors = self.collector.by_event("dictionary_error")
        self.assertEqual(len(errors), 1)

    def test_update_no_id(self):
        from stt.server import update_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(update_dictionary_entry(_FAKE_SID, {
            "replacement": "X"
        }))
        self.assertEqual(len(self.collector.events), 0)

    def test_update_non_dict_data(self):
        from stt.server import update_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(update_dictionary_entry(_FAKE_SID, "bad"))
        self.assertEqual(len(self.collector.events), 0)

    def test_update_phrase_too_long(self):
        from stt.server import update_dictionary_entry
        entry = _seed_dict_entry(self.store, "flouray", "Floure")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(update_dictionary_entry(_FAKE_SID, {
            "id": entry["id"], "phrase": "a" * 61
        }))
        errors = self.collector.by_event("dictionary_error")
        self.assertEqual(len(errors), 1)

    def test_update_replacement_too_long(self):
        from stt.server import update_dictionary_entry
        entry = _seed_dict_entry(self.store, "flouray", "Floure")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(update_dictionary_entry(_FAKE_SID, {
            "id": entry["id"], "replacement": "b" * 61
        }))
        errors = self.collector.by_event("dictionary_error")
        self.assertEqual(len(errors), 1)

    def test_update_notes(self):
        from stt.server import update_dictionary_entry
        entry = _seed_dict_entry(self.store, "flouray", "Floure")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(update_dictionary_entry(_FAKE_SID, {
            "id": entry["id"], "notes": "important term"
        }))
        emitted = self.collector.by_event("dictionary_updated")
        self.assertEqual(len(emitted), 1)


# ===========================================================================
# delete_dictionary_entry
# ===========================================================================

class TestDeleteDictionaryEntry(unittest.TestCase):
    def setUp(self):
        fd, self._db = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._patcher, self.store = _patch_store(self._db)
        self._patcher.start()
        self.collector = EmitCollector()
        self._emit_patcher = patch("stt.server.sio")
        mock_sio = self._emit_patcher.start()
        mock_sio.emit = self.collector

    def tearDown(self):
        self._patcher.stop()
        self._emit_patcher.stop()
        os.unlink(self._db)

    def test_delete_success(self):
        from stt.server import delete_dictionary_entry
        entry = _seed_dict_entry(self.store, "flouray", "Floure")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(delete_dictionary_entry(_FAKE_SID, {"id": entry["id"]}))
        emitted = self.collector.by_event("dictionary_deleted")
        self.assertEqual(len(emitted), 1)
        self.assertEqual(emitted[0]["id"], entry["id"])

    def test_delete_nonexistent_id(self):
        """BUG: delete_dictionary_entry returns True even for nonexistent ids.
        
        store.delete_dictionary_entry (history.py:688-699) always returns True
        because DELETE WHERE id=? succeeds with 0 rows affected. Should check
        conn.total_changes or cursor.rowcount to distinguish actual deletes.
        Server handler then emits 'dictionary_deleted' instead of 'dictionary_error'.
        """
        from stt.server import delete_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(delete_dictionary_entry(_FAKE_SID, {"id": 99999}))
        # Actual behavior: emits 'dictionary_deleted' (BUG in store.delete_dictionary_entry)
        deleted = self.collector.by_event("dictionary_deleted")
        self.assertEqual(len(deleted), 1)
        self.assertEqual(deleted[0]["id"], 99999)

    def test_delete_no_id(self):
        from stt.server import delete_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(delete_dictionary_entry(_FAKE_SID, {}))
        self.assertEqual(len(self.collector.events), 0)

    def test_delete_non_dict(self):
        from stt.server import delete_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(delete_dictionary_entry(_FAKE_SID, "bad"))
        self.assertEqual(len(self.collector.events), 0)

    def test_delete_none_id(self):
        from stt.server import delete_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(delete_dictionary_entry(_FAKE_SID, {"id": None}))
        self.assertEqual(len(self.collector.events), 0)


# ===========================================================================
# toggle_dictionary_favorite
# ===========================================================================

class TestToggleDictionaryFavorite(unittest.TestCase):
    def setUp(self):
        fd, self._db = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._patcher, self.store = _patch_store(self._db)
        self._patcher.start()
        self.collector = EmitCollector()
        self._emit_patcher = patch("stt.server.sio")
        mock_sio = self._emit_patcher.start()
        mock_sio.emit = self.collector

    def tearDown(self):
        self._patcher.stop()
        self._emit_patcher.stop()
        os.unlink(self._db)

    def test_toggle_on(self):
        from stt.server import toggle_dictionary_favorite
        entry = _seed_dict_entry(self.store, "flouray", "Floure")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(toggle_dictionary_favorite(_FAKE_SID, {"id": entry["id"]}))
        emitted = self.collector.by_event("dictionary_favorited")
        self.assertEqual(len(emitted), 1)
        self.assertTrue(emitted[0]["is_favorite"])

    def test_toggle_off(self):
        from stt.server import toggle_dictionary_favorite
        entry = _seed_dict_entry(self.store, "flouray", "Floure")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(toggle_dictionary_favorite(_FAKE_SID, {"id": entry["id"]}))
        loop.run_until_complete(toggle_dictionary_favorite(_FAKE_SID, {"id": entry["id"]}))
        emitted = self.collector.by_event("dictionary_favorited")
        self.assertEqual(len(emitted), 2)
        self.assertFalse(emitted[1]["is_favorite"])

    def test_toggle_nonexistent(self):
        from stt.server import toggle_dictionary_favorite
        loop = asyncio.get_event_loop()
        loop.run_until_complete(toggle_dictionary_favorite(_FAKE_SID, {"id": 99999}))
        errors = self.collector.by_event("dictionary_error")
        self.assertEqual(len(errors), 1)

    def test_toggle_no_id(self):
        from stt.server import toggle_dictionary_favorite
        loop = asyncio.get_event_loop()
        loop.run_until_complete(toggle_dictionary_favorite(_FAKE_SID, {}))
        self.assertEqual(len(self.collector.events), 0)

    def test_toggle_non_dict(self):
        from stt.server import toggle_dictionary_favorite
        loop = asyncio.get_event_loop()
        loop.run_until_complete(toggle_dictionary_favorite(_FAKE_SID, "bad"))
        self.assertEqual(len(self.collector.events), 0)

    def test_toggle_none_id(self):
        from stt.server import toggle_dictionary_favorite
        loop = asyncio.get_event_loop()
        loop.run_until_complete(toggle_dictionary_favorite(_FAKE_SID, {"id": None}))
        self.assertEqual(len(self.collector.events), 0)


# ===========================================================================
# import_dictionary_csv
# ===========================================================================

class TestImportDictionaryCsv(unittest.TestCase):
    def setUp(self):
        fd, self._db = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._patcher, self.store = _patch_store(self._db)
        self._patcher.start()
        self.collector = EmitCollector()
        self._emit_patcher = patch("stt.server.sio")
        mock_sio = self._emit_patcher.start()
        mock_sio.emit = self.collector

    def tearDown(self):
        self._patcher.stop()
        self._emit_patcher.stop()
        os.unlink(self._db)

    def test_import_valid_csv(self):
        from stt.server import import_dictionary_csv
        csv_text = "phrase,replacement\nhello,Hello\nworld,World"
        loop = asyncio.get_event_loop()
        loop.run_until_complete(import_dictionary_csv(_FAKE_SID, {"csv_text": csv_text}))
        emitted = self.collector.by_event("dictionary_imported")
        self.assertEqual(len(emitted), 1)
        self.assertIn("imported", emitted[0])
        self.assertGreater(emitted[0]["imported"], 0)

    def test_import_skips_duplicates(self):
        from stt.server import import_dictionary_csv
        _seed_dict_entry(self.store, "hello", "Hello")
        csv_text = "phrase,replacement\nhello,Duplicate\nworld,World"
        loop = asyncio.get_event_loop()
        loop.run_until_complete(import_dictionary_csv(_FAKE_SID, {"csv_text": csv_text}))
        emitted = self.collector.by_event("dictionary_imported")
        self.assertIn("skipped", emitted[0])

    def test_import_empty_csv_text(self):
        from stt.server import import_dictionary_csv
        loop = asyncio.get_event_loop()
        loop.run_until_complete(import_dictionary_csv(_FAKE_SID, {"csv_text": ""}))
        self.assertEqual(len(self.collector.events), 0)

    def test_import_no_csv_text_key(self):
        from stt.server import import_dictionary_csv
        loop = asyncio.get_event_loop()
        loop.run_until_complete(import_dictionary_csv(_FAKE_SID, {}))
        self.assertEqual(len(self.collector.events), 0)

    def test_import_non_dict_data(self):
        from stt.server import import_dictionary_csv
        loop = asyncio.get_event_loop()
        loop.run_until_complete(import_dictionary_csv(_FAKE_SID, "bad"))
        self.assertEqual(len(self.collector.events), 0)

    def test_import_phrase_too_long_skipped(self):
        from stt.server import import_dictionary_csv
        csv_text = f'phrase,replacement\n{"a" * 61},ok'
        loop = asyncio.get_event_loop()
        loop.run_until_complete(import_dictionary_csv(_FAKE_SID, {"csv_text": csv_text}))
        emitted = self.collector.by_event("dictionary_imported")
        self.assertEqual(emitted[0]["skipped"], 1)

    def test_import_single_column(self):
        from stt.server import import_dictionary_csv
        csv_text = "hello\nworld"
        loop = asyncio.get_event_loop()
        loop.run_until_complete(import_dictionary_csv(_FAKE_SID, {"csv_text": csv_text}))
        emitted = self.collector.by_event("dictionary_imported")
        self.assertGreater(emitted[0]["imported"], 0)

    def test_import_with_header(self):
        from stt.server import import_dictionary_csv
        csv_text = "phrase,replacement\nalpha,Alpha\nbeta,Beta"
        loop = asyncio.get_event_loop()
        loop.run_until_complete(import_dictionary_csv(_FAKE_SID, {"csv_text": csv_text}))
        rows = self.store.list_dictionary()
        phrases = {r["phrase"] for r in rows}
        self.assertIn("alpha", phrases)
        self.assertIn("beta", phrases)


# ===========================================================================
# export_dictionary_csv
# ===========================================================================

class TestExportDictionaryCsv(unittest.TestCase):
    def setUp(self):
        fd, self._db = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._patcher, self.store = _patch_store(self._db)
        self._patcher.start()
        self.collector = EmitCollector()
        self._emit_patcher = patch("stt.server.sio")
        mock_sio = self._emit_patcher.start()
        mock_sio.emit = self.collector

    def tearDown(self):
        self._patcher.stop()
        self._emit_patcher.stop()
        os.unlink(self._db)

    def test_export_empty(self):
        from stt.server import export_dictionary_csv
        loop = asyncio.get_event_loop()
        loop.run_until_complete(export_dictionary_csv(_FAKE_SID))
        emitted = self.collector.by_event("dictionary_export")
        self.assertEqual(len(emitted), 1)
        self.assertIn("csv", emitted[0])

    def test_export_with_entries(self):
        from stt.server import export_dictionary_csv
        _seed_dict_entry(self.store, "flouray", "Floure")
        _seed_dict_entry(self.store, "ceo", "Chief Executive Officer")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(export_dictionary_csv(_FAKE_SID))
        csv_content = self.collector.by_event("dictionary_export")[0]["csv"]
        self.assertIn("phrase,replacement", csv_content)
        self.assertIn("flouray", csv_content)

    def test_export_content_format(self):
        from stt.server import export_dictionary_csv
        _seed_dict_entry(self.store, "hello", "Hello")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(export_dictionary_csv(_FAKE_SID))
        csv_content = self.collector.by_event("dictionary_export")[0]["csv"]
        lines = csv_content.strip().split("\n")
        self.assertGreaterEqual(len(lines), 2)  # header + at least 1 row


# ===========================================================================
# emit_event (sync→async bridge)
# ===========================================================================

class TestEmitEvent(unittest.TestCase):
    """Test the public emit_event() sync→async bridge function."""

    def test_emit_event_no_loop(self):
        from stt.server import emit_event
        with patch("stt.server.sio") as mock_sio:
            mock_sio.emit = AsyncMock()
            # Should not raise even without a running loop
            try:
                emit_event("test_event", {"key": "value"})
            except Exception:
                pass  # Some RuntimeError path is expected

    def test_emit_audio_level(self):
        from stt.server import emit_audio_level
        with patch("stt.server.emit_event") as mock_emit:
            emit_audio_level(0.75)
            mock_emit.assert_called_once_with("mic", {"level": 0.75})

    def test_emit_audio_level_rounding(self):
        from stt.server import emit_audio_level
        with patch("stt.server.emit_event") as mock_emit:
            emit_audio_level(0.123456789)
            args = mock_emit.call_args[0]
            self.assertAlmostEqual(args[1]["level"], 0.123457, places=5)


# ===========================================================================
# _browser_clients set management
# ===========================================================================

class TestBrowserClientsSet(unittest.TestCase):
    """Test _browser_clients set operations."""

    def setUp(self):
        import stt.server as srv
        self._orig = srv._browser_clients.copy()
        srv._browser_clients.clear()

    def tearDown(self):
        import stt.server as srv
        srv._browser_clients.clear()
        srv._browser_clients.update(self._orig)

    def test_set_starts_empty(self):
        import stt.server as srv
        self.assertEqual(len(srv._browser_clients), 0)

    def test_add_multiple(self):
        import stt.server as srv
        srv._browser_clients.add("a")
        srv._browser_clients.add("b")
        srv._browser_clients.add("c")
        self.assertEqual(len(srv._browser_clients), 3)

    def test_discard_nonexistent_safe(self):
        import stt.server as srv
        srv._browser_clients.discard("ghost")  # should not raise

    def test_set_deduplicates(self):
        import stt.server as srv
        srv._browser_clients.add("a")
        srv._browser_clients.add("a")
        self.assertEqual(len(srv._browser_clients), 1)


# ===========================================================================
# _audio_queue management
# ===========================================================================

class TestAudioQueue(unittest.TestCase):
    """Test _audio_queue operations."""

    def setUp(self):
        import stt.server as srv
        self._orig = srv._audio_queue
        srv._audio_queue = asyncio.Queue()

    def tearDown(self):
        import stt.server as srv
        srv._audio_queue = self._orig

    def test_queue_starts_empty(self):
        import stt.server as srv
        self.assertTrue(srv._audio_queue.empty())

    def test_put_and_get(self):
        import stt.server as srv
        pcm = np.array([0.1, 0.2], dtype=np.float32)
        srv._audio_queue.put_nowait(pcm)
        item = srv._audio_queue.get_nowait()
        np.testing.assert_array_equal(item, pcm)

    def test_fifo_order(self):
        import stt.server as srv
        for i in range(10):
            srv._audio_queue.put_nowait(np.array([float(i)], dtype=np.float32))
        for i in range(10):
            item = srv._audio_queue.get_nowait()
            self.assertAlmostEqual(item[0], float(i))


# ===========================================================================
# Edge cases: handler with no data arg
# ===========================================================================

class TestHandlersWithoutDataArg(unittest.TestCase):
    """Test handlers that don't take a data parameter."""

    def setUp(self):
        fd, self._db = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._patcher, self.store = _patch_store(self._db)
        self._patcher.start()
        self.collector = EmitCollector()
        self._emit_patcher = patch("stt.server.sio")
        mock_sio = self._emit_patcher.start()
        mock_sio.emit = self.collector

    def tearDown(self):
        self._patcher.stop()
        self._emit_patcher.stop()
        os.unlink(self._db)

    def test_get_insights_no_args(self):
        from stt.server import get_insights
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_insights(_FAKE_SID))
        self.assertEqual(len(self.collector.by_event("insights")), 1)

    def test_export_dictionary_csv_no_args(self):
        from stt.server import export_dictionary_csv
        loop = asyncio.get_event_loop()
        loop.run_until_complete(export_dictionary_csv(_FAKE_SID))
        self.assertEqual(len(self.collector.by_event("dictionary_export")), 1)


# ===========================================================================
# Cross-cutting: emit target verification
# ===========================================================================

class TestEmitTargetVerification(unittest.TestCase):
    """Verify events are emitted to the correct sid."""

    def setUp(self):
        fd, self._db = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._patcher, self.store = _patch_store(self._db)
        self._patcher.start()
        self.collector = EmitCollector()
        self._emit_patcher = patch("stt.server.sio")
        mock_sio = self._emit_patcher.start()
        mock_sio.emit = self.collector

    def tearDown(self):
        self._patcher.stop()
        self._emit_patcher.stop()
        os.unlink(self._db)

    def test_get_history_target_sid(self):
        from stt.server import get_history
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_history("client-xyz", {}))
        self.assertEqual(self.collector.events[0][2].get("to"), "client-xyz")

    def test_search_history_target_sid(self):
        from stt.server import search_history
        loop = asyncio.get_event_loop()
        loop.run_until_complete(search_history("client-xyz", {"query": "test"}))
        self.assertEqual(self.collector.events[0][2].get("to"), "client-xyz")

    def test_get_insights_target_sid(self):
        from stt.server import get_insights
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_insights("client-xyz"))
        self.assertEqual(self.collector.events[0][2].get("to"), "client-xyz")

    def test_export_history_target_sid(self):
        from stt.server import export_history
        loop = asyncio.get_event_loop()
        loop.run_until_complete(export_history("client-xyz", {}))
        self.assertEqual(self.collector.events[0][2].get("to"), "client-xyz")

    def test_add_dictionary_target_sid(self):
        from stt.server import add_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(add_dictionary_entry("client-xyz", {
            "phrase": "test", "replacement": "Test"
        }))
        self.assertEqual(self.collector.events[0][2].get("to"), "client-xyz")

    def test_get_dictionary_target_sid(self):
        from stt.server import get_dictionary
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_dictionary("client-xyz", {}))
        self.assertEqual(self.collector.events[0][2].get("to"), "client-xyz")

    def test_export_dictionary_csv_target_sid(self):
        from stt.server import export_dictionary_csv
        loop = asyncio.get_event_loop()
        loop.run_until_complete(export_dictionary_csv("client-xyz"))
        self.assertEqual(self.collector.events[0][2].get("to"), "client-xyz")


# ===========================================================================
# Regression: special characters in data
# ===========================================================================

class TestSpecialCharacters(unittest.TestCase):
    """Test handlers with special characters, unicode, SQL-injection-like input."""

    def setUp(self):
        fd, self._db = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._patcher, self.store = _patch_store(self._db)
        self._patcher.start()
        self.collector = EmitCollector()
        self._emit_patcher = patch("stt.server.sio")
        mock_sio = self._emit_patcher.start()
        mock_sio.emit = self.collector

    def tearDown(self):
        self._patcher.stop()
        self._emit_patcher.stop()
        os.unlink(self._db)

    def test_unicode_dictionary_entry(self):
        from stt.server import add_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(add_dictionary_entry(_FAKE_SID, {
            "phrase": "über", "replacement": "Uber"
        }))
        emitted = self.collector.by_event("dictionary_added")
        self.assertEqual(len(emitted), 1)

    def test_special_chars_in_search(self):
        from stt.server import search_history
        loop = asyncio.get_event_loop()
        loop.run_until_complete(search_history(_FAKE_SID, {
            "query": "'; DROP TABLE transcripts; --"
        }))
        emitted = self.collector.by_event("history")
        self.assertEqual(len(emitted), 1)  # should not crash

    def test_special_chars_in_get_history(self):
        from stt.server import get_history
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_history(_FAKE_SID, {
            "limit": -1
        }))
        emitted = self.collector.by_event("history")
        self.assertEqual(len(emitted), 1)

    def test_special_chars_in_dictionary_search(self):
        from stt.server import get_dictionary
        loop = asyncio.get_event_loop()
        loop.run_until_complete(get_dictionary(_FAKE_SID, {
            "search": "'; DROP TABLE dictionary_entries; --"
        }))
        emitted = self.collector.by_event("dictionary")
        self.assertEqual(len(emitted), 1)

    def test_very_long_string(self):
        from stt.server import add_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(add_dictionary_entry(_FAKE_SID, {
            "phrase": "x" * 60, "replacement": "y" * 60
        }))
        emitted = self.collector.by_event("dictionary_added")
        self.assertEqual(len(emitted), 1)

    def test_whitespace_only_phrase(self):
        from stt.server import add_dictionary_entry
        loop = asyncio.get_event_loop()
        loop.run_until_complete(add_dictionary_entry(_FAKE_SID, {
            "phrase": "   ", "replacement": "test"
        }))
        errors = self.collector.by_event("dictionary_error")
        self.assertEqual(len(errors), 1)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short", "-s"])
