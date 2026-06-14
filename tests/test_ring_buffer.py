"""Tests for stt/orchestrator.py — _RingBuffer numpy circular buffer."""

import unittest
import numpy as np


class TestRingBuffer(unittest.TestCase):
    """Tests for the pre-allocated numpy circular ring buffer."""

    def _make_buf(self, max_samples=100):
        from stt.orchestrator import _RingBuffer
        return _RingBuffer(max_samples)

    def test_initial_state(self):
        ring = self._make_buf()
        self.assertEqual(ring.total_samples(), 0)

    def test_extend_increments_total(self):
        ring = self._make_buf()
        ring.extend(np.ones(10, dtype=np.float32))
        self.assertEqual(ring.total_samples(), 10)

    def test_extend_multiple_chunks(self):
        ring = self._make_buf()
        ring.extend(np.ones(10, dtype=np.float32))
        ring.extend(np.ones(20, dtype=np.float32))
        self.assertEqual(ring.total_samples(), 30)

    def test_slice_range_basic(self):
        """Slice returns correct values before buffer wraps."""
        ring = self._make_buf(100)
        audio = np.arange(10, dtype=np.float32)
        ring.extend(audio)
        result = ring.slice_range(0, 10)
        np.testing.assert_array_equal(result, audio)

    def test_slice_range_partial(self):
        """Slice a subset of the buffer."""
        ring = self._make_buf(100)
        audio = np.arange(20, dtype=np.float32)
        ring.extend(audio)
        result = ring.slice_range(5, 15)
        np.testing.assert_array_equal(result, np.arange(5, 15, dtype=np.float32))

    def test_slice_range_empty_when_out_of_bounds(self):
        """Slice returns empty when range is beyond buffer."""
        ring = self._make_buf(100)
        ring.extend(np.ones(10, dtype=np.float32))
        result = ring.slice_range(100, 200)
        self.assertEqual(len(result), 0)

    def test_slice_range_wraps_around(self):
        """Slice correctly handles wrap-around in circular buffer."""
        ring = self._make_buf(10)
        # Fill and overflow: write 15 samples into a 10-sample buffer
        ring.extend(np.arange(10, dtype=np.float32))  # [0,1,2,...,9]
        ring.extend(np.arange(10, 15, dtype=np.float32))  # overwrites to [10,11,12,13,14,5,6,7,8,9]
        # Total is 15, oldest surviving is sample 5
        self.assertEqual(ring.total_samples(), 15)
        result = ring.slice_range(5, 15)
        np.testing.assert_array_equal(result, np.arange(5, 15, dtype=np.float32))

    def test_slice_range_wraps_boundary(self):
        """Slice that wraps exactly at buffer boundary."""
        ring = self._make_buf(10)
        ring.extend(np.arange(10, dtype=np.float32))
        ring.extend(np.arange(10, 20, dtype=np.float32))
        # Buffer has samples 10-19 mapped to positions 0-9
        # Slice [10, 20) → position 0 to position 10 → wraps
        result = ring.slice_range(10, 20)
        np.testing.assert_array_equal(result, np.arange(10, 20, dtype=np.float32))

    def test_slice_range_zero_length(self):
        """Slice with start == end returns empty array."""
        ring = self._make_buf(100)
        ring.extend(np.ones(10, dtype=np.float32))
        result = ring.slice_range(5, 5)
        self.assertEqual(len(result), 0)

    def test_slice_range_negative_length(self):
        """Slice with start > end returns empty array."""
        ring = self._make_buf(100)
        ring.extend(np.ones(10, dtype=np.float32))
        result = ring.slice_range(8, 3)
        self.assertEqual(len(result), 0)

    def test_large_chunk_overwrites_entire_buffer(self):
        """Chunk larger than buffer keeps only the last max_samples."""
        ring = self._make_buf(10)
        big = np.arange(20, dtype=np.float32)
        ring.extend(big)
        self.assertEqual(ring.total_samples(), 20)
        result = ring.slice_range(10, 20)
        np.testing.assert_array_equal(result, np.arange(10, 20, dtype=np.float32))

    def test_slice_returns_copy(self):
        """Slice result is independent of buffer (a copy)."""
        ring = self._make_buf(100)
        ring.extend(np.arange(10, dtype=np.float32))
        result = ring.slice_range(0, 5)
        result[0] = 999.0
        # Original buffer should be unchanged
        original = ring.slice_range(0, 5)
        self.assertEqual(original[0], 0.0)

    def test_multiple_wrap_arounds(self):
        """Buffer wraps multiple times and still returns correct data."""
        ring = self._make_buf(5)
        for i in range(20):
            ring.extend(np.array([float(i)], dtype=np.float32))
        self.assertEqual(ring.total_samples(), 20)
        result = ring.slice_range(15, 20)
        np.testing.assert_array_equal(result, np.arange(15, 20, dtype=np.float32))

    def test_dtype_is_float32(self):
        """Slice returns float32 array."""
        ring = self._make_buf(100)
        ring.extend(np.ones(10, dtype=np.float32))
        result = ring.slice_range(0, 10)
        self.assertEqual(result.dtype, np.float32)

    def test_empty_buffer_slice_returns_empty(self):
        """Slicing an empty buffer returns empty array."""
        ring = self._make_buf(100)
        result = ring.slice_range(0, 0)
        self.assertEqual(len(result), 0)
