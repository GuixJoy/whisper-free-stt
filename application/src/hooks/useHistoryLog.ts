import { useCallback, useEffect, useState } from "react";
import type { TranscriptLine } from "../views/FeedView";

interface HistoryRow {
  id: number;
  raw_text: string;
  processed_text: string;
  created_at: string;
  mode: string;
  language: string;
  duration_sec: number;
}

/**
 * Paged history log for the feed. `enabled` is false while the onboarding view
 * is up, so the first page is not fetched before the shell exists.
 */
export function useHistoryLog(feedRef: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [items, setItems] = useState<TranscriptLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const fetchPage = useCallback(async (p: number, pageSize: number = 200) => {
    setLoading(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const rows = await invoke<HistoryRow[]>("get_history", { limit: p * pageSize });
      setItems(
        rows.map((r) => ({
          id: r.id,
          raw: r.raw_text,
          processed: r.processed_text,
          status: "done",
          createdAt: r.created_at,
        })),
      );
      setHasMore(rows.length >= p * pageSize);
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) fetchPage(1);
  }, [enabled, fetchPage]);

  // Infinite scroll: load the next page near the bottom.
  const onScroll = useCallback(() => {
    const el = feedRef.current;
    if (!el || loading || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchPage(nextPage);
    }
  }, [feedRef, loading, hasMore, page, fetchPage]);

  return { items, loading, hasMore, onScroll };
}
