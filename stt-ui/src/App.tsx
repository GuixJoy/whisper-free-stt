import { useState, useCallback, useRef } from "react";
import "./App.css";
import { type STTApi, type STTEvent } from "./api";
import { createTauriApi } from "./api-tauri";
import { createWsApi } from "./api-ws";

type Status = "idle" | "listening" | "transcribing" | "rewriting" | "error";
interface Card { id: number; raw: string; processed: string; status: Status; at: string; }

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function Btn({ children, onClick, on, small }: {
  children: React.ReactNode; onClick?: () => void; on?: boolean; small?: boolean;
}) {
  return <button className={`sketch-btn ${on ? "recording" : ""}`} onClick={onClick}
    style={small ? { fontSize: "0.8rem", padding: "0.3em 0.7em" } : {}}>{children}</button>;
}

export default function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [cards, setCards] = useState<Card[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [compact, setCompact] = useState(false);
  const apiRef = useRef<STTApi | null>(null);
  const currentRef = useRef<Card | null>(null);

  const addCard = useCallback((raw: string, processed: string) => {
    const card: Card = { id: Date.now(), raw, processed, status: "idle", at: new Date().toLocaleTimeString() };
    setCards(prev => [card, ...prev].slice(0, 500));
  }, []);

  const start = useCallback(async () => {
    setStatus("listening");
    const api = isTauri ? createTauriApi() : createWsApi();
    apiRef.current = api;

    api.onEvent((e: STTEvent) => {
      switch (e.type) {
        case "state":
          if (e.state === "listening" || e.state === "transcribing" || e.state === "rewriting" || e.state === "error" || e.state === "idle") {
            setStatus(e.state);
            if (currentRef.current) currentRef.current.status = e.state;
          }
          break;
        case "raw":
          currentRef.current = { id: Date.now(), raw: e.text, processed: "", status: "transcribing", at: new Date().toLocaleTimeString() };
          setCards(prev => [currentRef.current!, ...prev]);
          break;
        case "processed":
          if (currentRef.current) currentRef.current.processed = e.text;
          addCard(currentRef.current?.raw || e.text, e.text);
          break;
        case "mic": setMicLevel(e.level); break;
        case "error": setStatus("error"); break;
      }
    });

    try { await api.start(); } catch { setStatus("error"); }
  }, [addCard]);

  const stop = useCallback(() => {
    apiRef.current?.stop(); apiRef.current = null;
    setStatus("idle"); setMicLevel(0);
  }, []);

  return (
    <div className={compact ? "compact" : ""}>
      <header className="app-header">
        <h1>✎ stt</h1>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span className={`status-badge ${status === "listening" ? "status-listening" : status === "transcribing" ? "status-transcribing" : status === "rewriting" ? "status-rewriting" : status === "error" ? "status-error" : "status-idle"}`}>
            {status === "listening" ? "● listening" : status === "transcribing" ? "↻ transcribing" : status === "rewriting" ? "✎ rewriting" : status === "error" ? "⚠ error" : "○ idle"}
          </span>
          <Btn small onClick={() => setCompact(!compact)}>{compact ? "□" : "▤"}</Btn>
        </div>
      </header>

      <main className="main-area">
        <div className="mic-bar-wrap">
          <div className="mic-bar-fill" style={{ width: `${Math.min(100, micLevel * 200)}%` }} />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0.3rem" }}>
          {cards.length === 0 && status === "idle" && (
            <p style={{ textAlign: "center", marginTop: "3rem", fontFamily: "var(--font-sketch)", fontSize: "1.3rem", color: "var(--pencil-light)" }}>
              press start and speak →
            </p>
          )}
          {cards.map(c => (
            <div className="sketch-card" key={c.id}>
              <div className="transcript-meta"><span>{c.at}</span><span>{c.status}</span></div>
              {c.raw && <div className="transcript-raw">~ {c.raw}</div>}
              {c.processed && <div className="transcript-clean">{c.processed}</div>}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", padding: "0.6rem" }}>
          {status === "idle" ? <Btn onClick={start}>▶ Start</Btn> : <Btn on onClick={stop}>■ Stop</Btn>}
          <span style={{ fontFamily: "var(--font-sketch)", color: "var(--pencil-light)", alignSelf: "center" }}>{cards.length} cards</span>
        </div>
      </main>
    </div>
  );
}
