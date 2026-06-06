import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

// ── Types ──
type Status = "idle" | "listening" | "transcribing" | "rewriting" | "error";
type View = "main" | "history" | "settings";

interface Transcript {
  id: number;
  raw_text: string;
  processed_text: string;
  language: string;
  mode: string;
  favorite: number;
  created_at: string;
}

// ── Sketch Button Component ──
function SketchBtn({
  children, onClick, recording, small, className,
}: {
  children: React.ReactNode; onClick?: () => void;
  recording?: boolean; small?: boolean; className?: string;
}) {
  return (
    <button
      className={`sketch-btn ${recording ? "recording" : ""} ${small ? "small" : ""} ${className || ""}`}
      onClick={onClick}
      style={small ? { fontSize: "0.85rem", padding: "0.3em 0.7em" } : {}}
    >
      {children}
    </button>
  );
}

// ── Sketch Card ──
function SketchCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`sketch-card ${className || ""}`}>{children}</div>;
}

// ── Main App ──
function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [rawText, setRawText] = useState("");
  const [processedText, setProcessedText] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [view, setView] = useState<View>("main");
  const [compactMode, setCompactMode] = useState(false);
  // Load persisted transcripts on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("stt-transcripts");
      if (stored) setTranscripts(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  const saveTranscript = useCallback(async (raw: string, processed: string) => {
    const entry: Transcript = {
      id: Date.now(),
      raw_text: raw,
      processed_text: processed || raw,
      language: "en",
      mode: "cleanup",
      favorite: 0,
      created_at: new Date().toISOString(),
    };
    const updated = [entry, ...transcripts].slice(0, 200); // keep last 200
    setTranscripts(updated);
    localStorage.setItem("stt-transcripts", JSON.stringify(updated));
  }, [transcripts]);

  // ── Detect Tauri vs browser dev mode ──
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const _devTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Start/Stop STT ──
  const startListening = useCallback(async () => {
    setStatus("listening");
    setRawText(""); setProcessedText("");

    if (isTauri) {
      // Real: spawn stt --json-mode via Tauri shell plugin
      let backendPath = "stt";
      try { backendPath = await invoke("get_backend_path"); } catch { /* use default */ }
      try {
        const { Command } = await import("@tauri-apps/plugin-shell");
        const cmd = Command.create("stt-json-spawn", [backendPath, "--json-mode"]);
        cmd.stdout.on("data", (line: string) => {
          try {
            const event = JSON.parse(line);
            switch (event.type) {
              case "state": setStatus(event.state); break;
              case "raw": setRawText(event.text); break;
              case "processed":
                setProcessedText(event.text);
                saveTranscript(rawText, event.text);
                break;
              case "mic": setMicLevel(event.level); break;
              case "error": console.error(event.message); break;
            }
          } catch { /* partial line */ }
        });
        await cmd.spawn();
      } catch { /* Tauri shell unavailable */ }
    } else {
      // Dev mode: simulate STT pipeline in browser
      const demos = [
        { raw: "um so I think we should refactor the config module",
          processed: "I think we should refactor the config module." },
        { raw: "hello this is a test of the speech to text system",
          processed: "Hello, this is a test of the speech-to-text system." },
        { raw: "please make sure to commit the changes before the deadline",
          processed: "Please make sure to commit the changes before the deadline." },
      ];
      let i = 0;
      _devTimer.current && clearInterval(_devTimer.current);
      _devTimer.current = setInterval(() => {
        setMicLevel(0.01 + Math.random() * 0.08);
      }, 250);
      // Simulate: listening → transcribing → processed
      setTimeout(() => setStatus("transcribing"), 1500);
      setTimeout(() => {
        const d = demos[i % demos.length]; i++;
        setRawText(d.raw);
        setStatus("rewriting");
      }, 2500);
      setTimeout(() => {
        const d = demos[i > 0 ? (i-1) % demos.length : 0];
        setProcessedText(d.processed);
        setStatus("idle");
        saveTranscript(d.raw, d.processed);
        _devTimer.current && clearInterval(_devTimer.current);
      }, 3500);
    }
  }, [rawText, saveTranscript, isTauri]);

  const stopListening = useCallback(() => {
    setStatus("idle");
    setMicLevel(0);
    if (_devTimer.current) { clearInterval(_devTimer.current); _devTimer.current = null; }
  }, []);

  // ── Toggle favorite ──
  const toggleFav = (id: number) => {
    setTranscripts(prev => prev.map(t => t.id === id ? { ...t, favorite: t.favorite ? 0 : 1 } : t));
  };

  // ── Get status badge class ──
  const statusClass = () => {
    switch (status) {
      case "listening": return "status-listening";
      case "transcribing": return "status-transcribing";
      case "rewriting": return "status-rewriting";
      case "error": return "status-error";
      default: return "status-idle";
    }
  };

  return (
    <div className={`paper-shell ${compactMode ? "compact" : ""}`}>
      {/* ── Header ── */}
      <header className="app-header">
        <h1>✎ stt-ui</h1>
        <div className="flex items-center gap-2">
          <span className={`status-badge ${statusClass()}`}>
            {status === "listening" ? "● listening" :
             status === "transcribing" ? "↻ transcribing" :
             status === "rewriting" ? "✎ rewriting" :
             status === "error" ? "⚠ error" : "○ idle"}
          </span>
          <SketchBtn small onClick={() => setCompactMode(!compactMode)}>
            {compactMode ? "□" : "▤"}
          </SketchBtn>
          <SketchBtn small onClick={() => setView("settings")}>⚙</SketchBtn>
        </div>
      </header>

      {/* ── Main Area ── */}
      <main className="main-area">
        {view === "settings" ? (
          <SettingsPanel transcripts={transcripts} onClose={() => setView("main")} />
        ) : view === "history" ? (
          <HistoryPanel
            transcripts={transcripts}
            onToggleFav={toggleFav}
            onClose={() => setView("main")}
          />
        ) : (
          <>
            {/* Mic level */}
            <div className="mic-bar-wrap">
              <div className="mic-bar-fill" style={{ width: `${Math.min(100, micLevel * 200)}%` }} />
            </div>

            {/* Current transcript */}
            {(rawText || processedText) && (
              <SketchCard>
                {rawText && (
                  <div className="transcript-raw">~ {rawText}</div>
                )}
                {processedText && (
                  <div className="transcript-clean">{processedText}</div>
                )}
                <div className="transcript-meta">
                  <span>{status === "rewriting" ? "rewriting..." : "done"}</span>
                </div>
              </SketchCard>
            )}

            {/* Empty state */}
            {!rawText && !processedText && status === "idle" && (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-[1.2rem] text-[color:var(--pencil-light)] [font-family:var(--font-sketch)]">
                  press start and speak →
                </p>
              </div>
            )}

            {/* Controls */}
            <div className="flex justify-center gap-2 p-4">
              {status === "idle" ? (
                <SketchBtn onClick={startListening}>▶ Start</SketchBtn>
              ) : (
                <SketchBtn recording={status === "listening"} onClick={stopListening}>
                  ■ Stop
                </SketchBtn>
              )}
              <SketchBtn onClick={() => setView("history")}>
                📋 History ({transcripts.length})
              </SketchBtn>
            </div>
          </>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="app-footer">
        <span>← sketched with ✎</span>
        <span className="note-chip">{compactMode ? "compact" : "full"} · {transcripts.length} notes</span>
      </footer>
    </div>
  );
}

// ── History Panel ──
function HistoryPanel({
  transcripts, onToggleFav, onClose,
}: {
  transcripts: Transcript[]; onToggleFav: (id: number) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = transcripts.filter(t =>
    !search || t.raw_text.toLowerCase().includes(search.toLowerCase()) ||
    t.processed_text.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="pb-2">
      <div className="m-2 flex items-center gap-2">
        <SketchBtn small onClick={onClose}>← Back</SketchBtn>
        <input
          className="sketch-input"
          placeholder="search transcripts..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      {filtered.length === 0 ? (
        <p className="mt-8 text-center text-[color:var(--pencil-light)]">
          {search ? "no matches" : "no transcripts yet — speak something!"}
        </p>
      ) : (
        filtered.map(t => (
          <SketchCard key={t.id}>
            <div className="transcript-meta">
              <span>{new Date(t.created_at).toLocaleTimeString()}</span>
              <span>{t.language} · {t.mode}</span>
            </div>
            {t.processed_text ? (
              <div className="transcript-clean">{t.processed_text}</div>
            ) : (
              <div className="transcript-raw">~ {t.raw_text}</div>
            )}
            <div className="transcript-actions">
              <button className={`icon-btn ${t.favorite ? "fav" : ""}`} onClick={() => onToggleFav(t.id)}>
                {t.favorite ? "★" : "☆"}
              </button>
              <button className="icon-btn" onClick={() => navigator.clipboard.writeText(t.processed_text || t.raw_text)}>
                📋 copy
              </button>
            </div>
          </SketchCard>
        ))
      )}
    </div>
  );
}

// ── Settings Panel ──
function SettingsPanel({
  transcripts, onClose,
}: {
  transcripts: Transcript[]; onClose: () => void;
}) {
  return (
    <div className="settings-panel">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="[font-family:var(--font-sketch)]">Settings</h2>
        <SketchBtn small onClick={onClose}>✕</SketchBtn>
      </div>

      <div className="settings-section">
        <label>ASR Model</label>
        <select className="sketch-input" defaultValue="auto">
          <option value="auto">Auto-detect (best)</option>
          <option value="speed">tiny.en — fastest</option>
          <option value="balanced">base.en — balanced</option>
          <option value="accuracy">small.en — accurate</option>
          <option value="distil">distil-large-v3 — GPU</option>
          <option value="turbo">large-v3-turbo — GPU fast</option>
        </select>
      </div>

      <div className="settings-section">
        <label>LLM Mode</label>
        <select className="sketch-input" defaultValue="cleanup">
          <option value="cleanup">Cleanup (default)</option>
          <option value="off">Off — raw only</option>
          <option value="bullet_list">Bullet List</option>
          <option value="email">Email</option>
          <option value="commit_message">Commit Message</option>
        </select>
      </div>

      <div className="settings-section">
        <label>
          <input type="checkbox" defaultChecked /> Auto-copy to clipboard
        </label>
      </div>

      <div className="settings-section">
        <p className="text-[0.8rem] text-[color:var(--pencil-light)]">
          {transcripts.length} transcripts stored · SQLite database
        </p>
      </div>
    </div>
  );
}

export default App;
