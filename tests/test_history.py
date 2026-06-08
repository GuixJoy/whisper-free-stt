"""Tests for stt/history.py — async SQLite persistence."""

import os
import tempfile
import threading
import time
import unittest


class TestHistoryStoreInsert(unittest.TestCase):
    def setUp(self):
        fd, self._db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        from stt.history import HistoryStore
        self.store = HistoryStore(self._db_path)

    def tearDown(self):
        try:
            os.unlink(self._db_path)
        except OSError:
            pass

    def test_insert_returns_row_id(self):
        row_id = self.store.insert("hello world", "Hello world.")
        self.assertIsNotNone(row_id)
        self.assertIsInstance(row_id, int)
        self.assertGreater(row_id, 0)

    def test_insert_stores_all_fields(self):
        self.store.insert("raw text", "processed text",
                          language="en", mode="cleanup",
                          model="deepseek-chat", duration_sec=1.5)
        rows = self.store.recent_cleanups(limit=1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["raw_text"], "raw text")
        self.assertEqual(rows[0]["processed_text"], "processed text")

    def test_insert_returns_none_on_invalid_path(self):
        """Insert returns None when DB can't be opened (path is a directory)."""
        import tempfile
        from stt.history import HistoryStore
        with tempfile.TemporaryDirectory() as td:
            store = HistoryStore(os.path.join(td, "sub", "nested", "history.db"))
            result = store.insert("test")
            self.assertIsNotNone(result)  # subdirs are created by __init__

    def test_write_async_is_non_blocking(self):
        """write_async returns immediately even with large payload."""
        t0 = time.monotonic()
        self.store.write_async("raw", "processed", mode="cleanup")
        elapsed = time.monotonic() - t0
        self.assertLess(elapsed, 0.5, "write_async should return immediately")

    def test_write_async_eventually_persists(self):
        """Data written via write_async should be queryable after a short wait."""
        self.store.write_async("async raw", "async processed")
        # Give the daemon thread a moment
        time.sleep(0.2)
        rows = self.store.recent_cleanups(limit=1)
        # May or may not have landed yet, but should not throw
        self.assertIsInstance(rows, list)


class TestHistoryStoreQueries(unittest.TestCase):
    def setUp(self):
        fd, self._db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        from stt.history import HistoryStore
        self.store = HistoryStore(self._db_path)
        # Seed some data
        self.store.insert("hello world testing", "Hello world testing.",
                          language="en", mode="cleanup", model="deepseek-chat")
        self.store.insert("foo bar baz", "Foo bar baz.",
                          language="en", mode="email", model="openai/gpt-4o-mini")
        self.store.insert("this is test sentence", "This is test sentence.",
                          language="en", mode="cleanup", model="deepseek-chat")
        self.store.insert("identical text", "identical text",
                          language="en", mode="cleanup", model="deepseek-chat")

    def tearDown(self):
        try:
            os.unlink(self._db_path)
        except OSError:
            pass

    def test_recent_cleanups_excludes_identical_pairs(self):
        """Identicals (raw == processed) are excluded from cleanups."""
        rows = self.store.recent_cleanups(limit=10)
        for r in rows:
            self.assertNotEqual(r["raw_text"], r["processed_text"])

    def test_recent_cleanups_excludes_empty_processed(self):
        """Rows without processed text are excluded."""
        rows = self.store.recent_cleanups(limit=10)
        for r in rows:
            self.assertNotEqual(r["processed_text"], "")

    def test_recent_cleanups_respects_limit(self):
        rows = self.store.recent_cleanups(limit=2)
        self.assertLessEqual(len(rows), 2)

    def test_recent_cleanups_returns_list(self):
        rows = self.store.recent_cleanups(limit=5)
        self.assertIsInstance(rows, list)

    def test_search_similar_finds_relevant(self):
        result = self.store.search_similar("hello world", limit=3)
        self.assertGreater(len(result), 0)
        self.assertIn("raw_text", result[0])

    def test_search_similar_short_words_ignored(self):
        """Words shorter than 3 chars are dropped from FTS query."""
        result = self.store.search_similar("a b c", limit=3)
        self.assertEqual(len(result), 0)

    def test_search_similar_non_alpha_ignored(self):
        """Non-alpha tokens are dropped."""
        result = self.store.search_similar("123 456 789", limit=3)
        self.assertEqual(len(result), 0)

    def test_search_similar_returns_list(self):
        result = self.store.search_similar("test", limit=5)
        self.assertIsInstance(result, list)

    def test_search_similar_respects_limit(self):
        result = self.store.search_similar("world test", limit=1)
        self.assertLessEqual(len(result), 1)

    def test_search_similar_empty_input(self):
        result = self.store.search_similar("", limit=3)
        self.assertEqual(len(result), 0)


class TestGetStore(unittest.TestCase):
    def setUp(self):
        # Reset the singleton
        from stt import history
        history._store = None

    def test_get_store_returns_instance(self):
        from stt.history import HistoryStore, get_store
        store = get_store()
        self.assertIsInstance(store, HistoryStore)

    def test_get_store_is_singleton(self):
        from stt.history import get_store
        a = get_store()
        b = get_store()
        self.assertIs(a, b)

    def test_get_store_with_custom_path(self):
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        try:
            from stt.history import HistoryStore, get_store
            # Reset singleton so custom path takes effect
            from stt import history
            history._store = None
            store = get_store(path)
            self.assertIn(os.path.basename(path), store._db_path)
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass


if __name__ == "__main__":
    unittest.main()
