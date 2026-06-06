import { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";
import { type STTApi, type STTEvent } from "./api";
import { createTauriApi } from "./api-tauri";
import { createWsApi } from "./api-ws";

// ── Types ──
type Status = "idle" | "listening" | "transcribing" | "rewriting" | "error";
type View = "main" | "history" | "settings";

interface Transcript {
  id: number; raw: string; processed: string;
  language: string; mode: string; favorite: boolean; at: string;
}

// ── Pick the API backend ──
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ── Sketch Button ──
function Btn({ children, onClick, on, small }: {
  children: React.ReactNode; onClick?: () => void; on?: boolean; small?: boolean;
}) {
  return (
    <button className={`sketch-btn ${on ? "recording" : ""}`} onClick={onClick}
      style={small ? { fontSize: "0.8rem", padding: "0.3em 0.7em" } : {}}>
      {children}
    </button>
  );
}

// ── Main App ──
export default function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [rawText, setRawText] = useState("");
  const [processedText, setProcessedText] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [view, setView] = useState<View>("main");
  const [compact, setCompact] = useState(false);
  const apiRef = useRef<STTApi | null>(null);

  // Load history
  useEffect(() => {
    try {
      const stored = localStorage.getItem("stt-transcripts");
      if (stored) setTranscripts(JSON.parse(stored));
    } catch { }
  }, []);

  const save = useCallback((raw: string, processed: string) => {
    const entry: Transcript = { id: Date.now(), raw, processed: processed || raw, language: "en", mode: "cleanup", favorite: false, at: new Date().toISOString() };
    setTranscripts(prev => {
      const next = [entry, ...prev].slice(0, 200);
      localStorage.setItem("stt-transcripts", JSON.stringify(next));
      return next;
    });
  }, []);

  // Start
  const start = useCallback(async () => {
    setStatus("listening"); setRawText(""); setProcessedText("");
    const api = isTauri ? createTauriApi() : createWsApi();
    apiRef.current = api;

    api.onEvent((e: STTEvent) => {
      switch (e.type) {
        case "state":
          if (e.state === "listening" || e.state === "transcribing" || e.state === "rewriting" || e.state === "error" || e.state === "idle")
            setStatus(e.state);
          break;
        case "raw": setRawText(e.text); break;
        case "processed": setProcessedText(e.text); save(e.text, e.text); break;
        case "mic": setMicLevel(e.level); break;
        case "error": setStatus("error"); break;
      }
    });

    try { await api.start(); } catch { setStatus("error"); }
  }, [save]);

  // Stop
  const stop = useCallback(() => {
    apiRef.current?.stop();
    apiRef.current = null;
    setStatus("idle"); setMicLevel(0);
  }, []);

  const statusBadge = () => {
    switch (status) {
      case "listening": return "status-listening";
      case "transcribing": return "status-transcribing";
      case "rewriting": return "status-rewriting";
      case "error": return "status-error";
      default: return "status-idle";
    }
  };

  const statusLabel = () => {
    switch (status) {
      case "listening": return "● listening";
      case "transcribing": return "↻ transcribing";
      case "rewriting": return "✎ rewriting";
      case "error": return "⚠ error";
      default: return "○ idle";
    }
  };

  const toggleFav = (id: number) => {
    setTranscripts(prev => prev.map(t => t.id === id ? { ...t, favorite: !t.favorite } : t));
  };

  return (
    <div className={compact ? "compact" : ""}>
      <header className="app-header">
        <h1>✎ stt-ui</h1>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span className={`status-badge ${statusBadge()}`}>{statusLabel()}</span>
          <Btn small onClick={() => setCompact(!compact)}>{compact ? "□" : "▤"}</Btn>
          <Btn small onClick={() => setView("settings")}>⚙</Btn>
        </div>
      </header>

      <main className="main-area">
        {view === "settings" ? (
          <SettingsPanel onClose={() => setView("main")} />
        ) : view === "history" ? (
          <HistoryPanel transcripts={transcripts} toggleFav={toggleFav} onClose={() => setView("main")} />
        ) : (
          <>
            <div className="mic-bar-wrap">
              <div className="mic-bar-fill" style={{ width: `${Math.min(100, micLevel * 200)}%` }} />
            </div>

            {(rawText || processedText) && (
              <div className="sketch-card">
                {rawText && <div className="transcript-raw">~ {rawText}</div>}
                {processedText && <div className="transcript-clean">{processedText}</div>}
                <div className="transcript-meta"><span>{status === "rewriting" ? "rewriting..." : "done"}</span></div>
              </div>
            )}

            {!rawText && !processedText && status === "idle" && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <p style={{ fontFamily: "var(--font-sketch)", fontSize: "1.2rem", color: "var(--pencil-light)" }}>start and speak →</p>
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", padding: "1rem" }}>
              {status === "idle" ? <Btn onClick={start}>▶ Start</Btn> : <Btn on onClick={stop}>■ Stop</Btn>}
              <Btn onClick={() => setView("history")}>📋 History ({transcripts.length})</Btn>
            </div>
          </>
        )}
      </main>

      <footer className="app-footer">
        <span>← sketched with ✎</span>
        <span>{isTauri ? "tauri" : "ws"} · {compact ? "compact" : "full"} · {transcripts.length} notes</span>
      </footer>
    </div>
  );
}

// ── History ──
function HistoryPanel({ transcripts, toggleFav, onClose }: { transcripts: Transcript[]; toggleFav: (id: number) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const filtered = transcripts.filter(t => !search || t.raw.toLowerCase().includes(search.toLowerCase()) || t.processed.toLowerCase().includes(search.toLowerCase()));
  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", margin: "0.5rem" }}>
        <Btn small onClick={onClose}>← Back</Btn>
        <input className="sketch-input" placeholder="search..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1 }} />
      </div>
      {filtered.length === 0 ? <p style={{ textAlign: "center", color: "var(--pencil-light)", marginTop: "2rem" }}>{search ? "no matches" : "nothing yet — speak!"}</p>
        : filtered.map(t => (
          <div className="sketch-card" key={t.id}>
            <div className="transcript-meta"><span>{new Date(t.at).toLocaleTimeString()}</span><span>{t.language} · {t.mode}</span></div>
            {t.processed ? <div className="transcript-clean">{t.processed}</div> : <div className="transcript-raw">~ {t.raw}</div>}
            <div className="transcript-actions">
              <button className={`icon-btn ${t.favorite ? "fav" : ""}`} onClick={() => toggleFav(t.id)}>{t.favorite ? "★" : "☆"}</button>
              <button className="icon-btn" onClick={() => navigator.clipboard.writeText(t.processed || t.raw)}>📋 copy</button>
            </div>
          </div>
        ))}
    </div>
  );
}

// ── Settings ──
function SettingsPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="settings-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ fontFamily: "var(--font-sketch)" }}>Settings</h2>
        <Btn small onClick={onClose}>✕</Btn>
      </div>
      <div className="settings-section"><label>ASR Profile</label><select className="sketch-input" defaultValue="auto"><option value="auto">Auto</option><option value="speed">tiny.en</option><option value="balanced">base.en</option><option value="accuracy">small.en</option><option value="distil">distil-large-v3 (GPU)</option><option value="turbo">large-v3-turbo (GPU)</option></select></div>
      <div className="settings-section"><label>LLM Mode</label><select className="sketch-input" defaultValue="cleanup"><option value="cleanup">Cleanup</option><option value="off">Off</option><option value="bullet_list">Bullet List</option><option value="email">Email</option><option value="commit_message">Commit Message</option></select></div>
      <div className="settings-section"><label><input type="checkbox" defaultChecked /> Auto-copy to clipboard</label></div>
    </div>
  );
}
