import { useState, useCallback, useRef, useEffect } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import Lenis from "lenis";
import "./App.css";
import { type STTApi, type STTEvent } from "./api";
import { createTauriApi } from "./api-tauri";
import { createWsApi } from "./api-ws";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const qc = new QueryClient();

// ── Types ──
type Status = "idle" | "listening" | "transcribing" | "rewriting" | "error";
interface Card { id: number; raw: string; processed: string; status: Status; at: string; }

// ── Sketch Button ──
function Btn({ children, onClick, on, small, accent, disabled }: {
  children: React.ReactNode; onClick?: () => void; on?: boolean; small?: boolean; accent?: boolean; disabled?: boolean;
}) {
  return (
    <motion.button
      className={`sketch-btn ${on ? "recording" : ""} ${accent ? "accent" : ""}`}
      onClick={onClick}
      whileHover={{ scale: 1.04, rotate: 0.5 }}
      whileTap={disabled ? undefined : { scale: 0.96, rotate: 0 }}
      style={small ? { fontSize: "0.85rem", padding: "0.3em 0.8em" } : {}}
      disabled={disabled}
    >
      {children}
    </motion.button>
  );
}

// ── Main App ──
function AppInner() {
  const [status, setStatus] = useState<Status>("idle");
  const [micLevel, setMicLevel] = useState(0);
  const [compact, setCompact] = useState(false);
  const [typing, setTyping] = useState(true);
  const apiRef = useRef<STTApi | null>(null);
  const currentCard = useRef<Card | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Lenis smooth scroll
  useEffect(() => {
    const lenis = new Lenis({ duration: 0.8, easing: (t: number) => 1 - Math.pow(1 - t, 3) });
    function raf(time: number) { lenis.raf(time); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);
    return () => lenis.destroy();
  }, []);

  // Transcript feed via TanStack Query
  const { data: cards = [] } = useQuery<Card[]>({
    queryKey: ["transcripts"],
    queryFn: () => Promise.resolve([]),
    staleTime: Infinity,
    initialData: [],
  });

  const addCard = useCallback((raw: string, processed: string) => {
    const card: Card = { id: Date.now(), raw, processed, status: "idle", at: new Date().toLocaleTimeString() };
    queryClient.setQueryData<Card[]>(["transcripts"], (prev = []) => [card, ...prev].slice(0, 500));
  }, [queryClient]);

  const clearCards = useCallback(() => {
    queryClient.setQueryData<Card[]>(["transcripts"], []);
  }, [queryClient]);

  // Start listening
  const start = useCallback(async () => {
    setStatus("listening");
    const api = isTauri ? createTauriApi() : createWsApi();
    apiRef.current = api;

    api.onEvent((e: STTEvent) => {
      switch (e.type) {
        case "state":
          if (["listening", "transcribing", "rewriting", "error", "idle"].includes(e.state)) {
            setStatus(e.state as Status);
          }
          break;
        case "raw":
          currentCard.current = { id: Date.now(), raw: e.text, processed: "", status: "transcribing", at: new Date().toLocaleTimeString() };
          queryClient.setQueryData<Card[]>(["transcripts"], (prev = []) => [currentCard.current!, ...prev]);
          break;
        case "processed":
          if (currentCard.current) {
            queryClient.setQueryData<Card[]>(["transcripts"], (prev = []) =>
              prev.map(c => c.id === currentCard.current!.id ? { ...c, processed: e.text, status: "idle" as Status } : c)
            );
          } else {
            addCard(e.text, e.text);
          }
          break;
        case "mic": setMicLevel(e.level); break;
        case "error": setStatus("error"); break;
      }
    });

    try { await api.start(); } catch { setStatus("error"); }
  }, [queryClient, addCard]);

  const stop = useCallback(() => {
    apiRef.current?.stop(); apiRef.current = null;
    setStatus("idle"); setMicLevel(0);
  }, []);

  const copyLast = useCallback(() => {
    const last = cards.find(c => c.processed);
    if (last) navigator.clipboard.writeText(last.processed);
  }, [cards]);

  const isRunning = status !== "idle";

  return (
    <div className={compact ? "compact" : ""}>
      {/* ── Header ── */}
      <header className="app-header">
        <h1>✎ stt</h1>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span className={`status-badge ${status === "listening" ? "status-listening" : status === "transcribing" ? "status-transcribing" : status === "rewriting" ? "status-rewriting" : status === "error" ? "status-error" : "status-idle"}`}>
            {status === "listening" ? "● listening" : status === "transcribing" ? "↻ transcribing" : status === "rewriting" ? "✎ rewriting" : status === "error" ? "⚠ error" : "○ idle"}
          </span>
          <Btn small onClick={() => setTyping(!typing)}>{typing ? "⌨ on" : "⌨ off"}</Btn>
          <Btn small onClick={() => setCompact(!compact)}>{compact ? "□" : "▤"}</Btn>
        </div>
      </header>

      {/* ── Mic level bar ── */}
      <motion.div className="mic-bar-wrap" animate={{ opacity: isRunning ? 1 : 0.4 }}>
        <motion.div className="mic-bar-fill" animate={{ width: `${Math.min(100, micLevel * 200)}%` }} transition={{ duration: 0.1 }} />
      </motion.div>

      {/* ── Controls bar ── */}
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", alignItems: "center", padding: "0.6rem 0.5rem", flexWrap: "wrap" }}>
        {isRunning ? (
          <Btn on onClick={stop}>■ Stop</Btn>
        ) : (
          <Btn onClick={start}>▶ Start</Btn>
        )}
        <Btn small onClick={copyLast} disabled={cards.length === 0}>📋 Copy last</Btn>
        <Btn small onClick={clearCards} disabled={cards.length === 0}>🗑 Clear</Btn>
        <span style={{ fontFamily: "var(--font-sketch)", fontSize: "0.9rem", color: "var(--pencil-light)", marginLeft: "0.5rem" }}>
          {cards.length} cards
        </span>
      </div>

      {/* ── Infinite transcript scroll ── */}
      <main className="main-area" ref={scrollRef}>
        <AnimatePresence initial={false}>
          {cards.length === 0 && status === "idle" && (
            <motion.p
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              style={{ textAlign: "center", marginTop: "4rem", fontFamily: "var(--font-sketch)", fontSize: "1.4rem", color: "var(--pencil-light)" }}
            >
              press start and speak →
            </motion.p>
          )}
          {cards.map((c, i) => (
            <motion.div
              key={c.id}
              className="sketch-card"
              initial={{ opacity: 0, y: 20, rotate: -1 }}
              animate={{ opacity: 1, y: 0, rotate: -0.2 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3, delay: i === 0 ? 0 : 0 }}
              layout
            >
              <div className="transcript-meta">
                <span>{c.at}</span>
                <span style={{ color: c.status === "transcribing" ? "var(--accent)" : c.status === "rewriting" ? "#D97706" : "var(--pencil-light)" }}>
                  {c.status}
                </span>
              </div>
              {c.raw && <div className="transcript-raw">~ {c.raw}</div>}
              {c.processed && (
                <motion.div
                  className="transcript-clean"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ duration: 0.4 }}
                >
                  {c.processed}
                </motion.div>
              )}
              {c.processed && (
                <div className="transcript-actions">
                  <button className="icon-btn" onClick={() => navigator.clipboard.writeText(c.processed)}>📋 copy</button>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </main>
    </div>
  );
}

// ── Root with QueryClientProvider ──
export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AppInner />
    </QueryClientProvider>
  );
}
