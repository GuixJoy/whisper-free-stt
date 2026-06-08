// ── Full onboarding wizard: system checks → model download → mic → permissions → ready ──
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useOnboarding } from "../hooks/useOnboarding";
import { MODEL_CATALOG } from "../store";
import type { SystemCheck } from "../store";
import { detectPlatform } from "../utils/platform";

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="onboarding-steps">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className={`step-dot ${i <= step ? "step-dot-active" : ""} ${i < step ? "step-dot-done" : ""}`} />
      ))}
    </div>
  );
}

function Step1SystemCheck({ checks, onNext }: { checks: SystemCheck[]; onNext: () => void }) {
  const hasFailures = checks.some((c) => c.status === "fail");
  const allChecked = checks.every((c) => c.status !== "pending") && checks.length > 0;
  return (
    <div className="onboard-step">
      <h2>System Check</h2>
      <p>Making sure everything is ready...</p>
      <div className="check-list">
        {checks.map((check, i) => (
          <div key={i} className={`check-item check-${check.status}`}>
            <span className="check-icon">
              {check.status === "pass" ? "✅" : check.status === "warning" ? "⚠️" : check.status === "pending" ? "⏳" : "❌"}
            </span>
            <div className="check-body">
              <strong>{check.name}</strong>
              <span>{check.message}</span>
              {check.fixHint && <span className="check-hint">{check.fixHint}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="onboard-actions">
        {!allChecked ? (
          <button className="sketch-btn btn-start" onClick={onNext}>
            Run Checks
          </button>
        ) : (
          <button className="sketch-btn btn-start" onClick={onNext} disabled={hasFailures}>
            {hasFailures ? "Fix Issues Above" : "Continue"}
          </button>
        )}
      </div>
    </div>
  );
}

function Step2ModelDownload({
  progress,
  onDownload,
  onDone,
}: {
  progress: Record<string, { percent: number; status: string }>;
  onDownload: (models: string[]) => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(MODEL_CATALOG.filter((m) => m.recommended).map((m) => m.name))
  );
  const hasDownloads = Object.values(progress).some((p) => p.status === "done" || p.status === "downloading");

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const totalSize = MODEL_CATALOG
    .filter((m) => selected.has(m.name))
    .reduce((s, m) => s + m.size, "0 MB")
    .toString();

  return (
    <div className="onboard-step">
      <h2>Download Models</h2>
      <p>Choose which speech recognition models to install. Smaller = faster, larger = more accurate.</p>

      <div className="model-catalog">
        {MODEL_CATALOG.map((model) => (
          <label key={model.name} className={`model-card ${selected.has(model.name) ? "model-card-selected" : ""}`}>
            <input
              type="checkbox"
              checked={selected.has(model.name)}
              onChange={() => toggle(model.name)}
              disabled={progress[model.name]?.status === "downloading"}
            />
            <div className="model-card-body">
              <div className="model-card-header">
                <strong>{model.name}</strong>
                <span className="model-badge">{model.backend === "faster_whisper" ? "GPU" : "CPU"}</span>
              </div>
              <div className="model-card-meta">
                <span>{model.size}</span>
                <span>{model.speed}</span>
                <span>{model.accuracy}</span>
              </div>
              <p>{model.bestFor}</p>
              {progress[model.name] && (
                <div className="download-progress">
                  <div className="download-progress-bar" style={{ width: `${progress[model.name].percent}%` }} />
                  <span>{progress[model.name].status === "done" ? "✓ Done" : `${progress[model.name].percent}%`}</span>
                </div>
              )}
            </div>
          </label>
        ))}
      </div>

      <div className="onboard-actions">
        <button
          className="sketch-btn btn-start"
          onClick={() => onDownload(Array.from(selected))}
          disabled={selected.size === 0}
        >
          Download Selected (≈{totalSize})
        </button>
        <button className="sketch-btn btn-copy" onClick={onDone}>
          {hasDownloads ? "Continue" : "Skip"}
        </button>
      </div>
    </div>
  );
}

function Step3MicSetup({
  micLevel,
  onTest,
  onDone,
}: {
  micIndex: number | null;
  micLevel: number;
  onTest: () => void;
  onDone: () => void;
}) {
  return (
    <div className="onboard-step">
      <h2>Microphone Setup</h2>
      <p>Check your mic and adjust settings.</p>

      <div className="mic-setup-area">
        <div className="mic-meter-large">
          <div className="mic-meter-large-fill" style={{ width: `${Math.min(100, micLevel * 300)}%` }} />
        </div>

        <button className="sketch-btn" onClick={onTest}>
          Test Microphone
        </button>
      </div>

      <div className="onboard-actions">
        <button className="sketch-btn btn-start" onClick={onDone}>
          Mic Sounds Good
        </button>
      </div>
    </div>
  );
}

function Step4Permissions({
  clipboard,
  typing,
  onClipboard,
  onTyping,
  onDone,
}: {
  clipboard: boolean;
  typing: boolean;
  onClipboard: (v: boolean) => void;
  onTyping: (v: boolean) => void;
  onDone: () => void;
}) {
  const p = detectPlatform();
  return (
    <div className="onboard-step">
      <h2>Permissions</h2>
      <p>Control where your transcribed text goes.</p>

      <div className="perm-list">
        <label className="perm-item">
          <div>
            <strong>📋 Auto-copy to Clipboard</strong>
            <p className="perm-hint">Uses {p.clipboardTool} on {p.platform}</p>
          </div>
          <span className="toggle-wrap">
            <input type="checkbox" checked={clipboard} onChange={(e) => onClipboard(e.target.checked)} />
            <span className="toggle-track" />
          </span>
        </label>

        <label className="perm-item">
          <div>
            <strong>⌨️ Type into Focused Window</strong>
            <p className="perm-hint">Uses {p.typingTool} on {p.platform}</p>
          </div>
          <span className="toggle-wrap">
            <input type="checkbox" checked={typing} onChange={(e) => onTyping(e.target.checked)} />
            <span className="toggle-track" />
          </span>
        </label>
      </div>

      <div className="onboard-actions">
        <button className="sketch-btn btn-start" onClick={onDone}>
          Continue
        </button>
      </div>
    </div>
  );
}

function Step5Ready({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="onboard-step onboard-ready">
      <div className="ready-icon">🎙️</div>
      <h2>You're All Set!</h2>
      <p>Press <kbd>Space</kbd> to start/stop dictation anytime.</p>
      <div className="shortcut-cheat-sheet">
        <div><kbd>Space</kbd> Start / Stop</div>
        <div><kbd>Space</kbd> (hold) Talk, release to transcribe</div>
        <div><kbd>Esc</kbd> Cancel current</div>
      </div>
      <div className="onboard-actions">
        <button className="sketch-btn btn-start" onClick={onFinish}>
          Start Dictating
        </button>
      </div>
    </div>
  );
}

interface Props {
  onFinished: () => void;
}

export default function OnboardingWizard({ onFinished }: Props) {
  const { state, dispatch, runSystemChecks, downloadModels, testMic, nextStep, finish } = useOnboarding(onFinished);
  const { step, systemChecks, modelDownloadProgress, selectedMicIndex, micLevel, clipboardEnabled, typingEnabled, error } = state;
  const totalSteps = 5;

  return (
    <motion.div
      className="onboarding-wizard"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <StepIndicator step={step} total={totalSteps} />

      {error && (
        <div className="onboard-error-banner">
          <span>⚠</span> {error}
          <button className="error-dismiss" onClick={() => dispatch({ type: "CLEAR_ERROR" })}>×</button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div key="step0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
            <Step1SystemCheck
              checks={systemChecks.length > 0 ? systemChecks : [
                { name: "Running checks...", status: "pending", message: "Scanning system" },
              ]}
              onNext={() => runSystemChecks()}
            />
          </motion.div>
        )}
        {step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
            <Step2ModelDownload
              progress={modelDownloadProgress}
              onDownload={(models) => { downloadModels(models); }}
              onDone={() => nextStep()}
            />
          </motion.div>
        )}
        {step === 2 && (
          <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
            <Step3MicSetup micIndex={selectedMicIndex} micLevel={micLevel} onTest={testMic} onDone={() => nextStep()} />
          </motion.div>
        )}
        {step === 3 && (
          <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
            <Step4Permissions
              clipboard={clipboardEnabled}
              typing={typingEnabled}
              onClipboard={() => {}}
              onTyping={() => {}}
              onDone={() => nextStep()}
            />
          </motion.div>
        )}
        {step === 4 && (
          <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
            <Step5Ready onFinish={finish} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
