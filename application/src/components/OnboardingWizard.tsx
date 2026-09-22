import { useEffect, useState } from "react";
import {
  CircleCheck,
  TriangleAlert,
  LoaderCircle,
  CircleX,
  Zap,
  Star,
  Check,
  X,
  ClipboardList,
  Keyboard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useOnboarding } from "../hooks/useOnboarding";
import { MODEL_CATALOG } from "../store";
import type { SystemCheck } from "../store";
import { usePermissions } from "../hooks/usePermissions";
import { micLevelEmitter } from "../utils/mic-emitter";

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-6 flex items-center justify-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            "h-2 w-2 rounded-full transition-colors duration-200",
            i <= step ? "bg-accent" : "border border-border bg-app-surface-secondary",
            i < step && "bg-accent/60",
          )}
        />
      ))}
    </div>
  );
}

function Step1SystemCheck({ checks, onNext }: { checks: SystemCheck[]; onNext: () => void }) {
  const hasFailures = checks.some((c) => c.status === "fail");
  const allChecked = checks.every((c) => c.status !== "pending") && checks.length > 0;
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <h2 className="text-balance text-heading text-text-primary">System Check</h2>
      <p className="text-body text-text-secondary">Making sure everything is ready…</p>
      <div className="flex w-full flex-col gap-2">
        {checks.map((check, i) => (
          <div
            key={i}
            className={cn(
              "flex items-start gap-3 rounded-card border px-4 py-3",
              check.status === "pass" && "border-border bg-app-surface",
              check.status === "warning" && "border-yellow-500/25 bg-app-surface",
              check.status === "pending" && "border-border bg-app-surface",
              check.status === "fail" && "border-red-500/20 bg-app-surface",
            )}
          >
            <span className="mt-0.5 shrink-0" aria-hidden="true">
              {check.status === "pass" ? (
                <CircleCheck size={18} className="text-green-600" />
              ) : check.status === "warning" ? (
                <TriangleAlert size={18} className="text-yellow-700" />
              ) : check.status === "pending" ? (
                <LoaderCircle size={18} className="animate-spin text-text-muted" />
              ) : (
                <CircleX size={18} className="text-red-600" />
              )}
            </span>
            <div className="flex flex-col gap-0.5 text-left">
              <strong className="text-body text-text-primary">{check.name}</strong>
              <span className="text-small text-text-secondary">{check.message}</span>
              {check.fixHint && <span className="text-small text-text-muted">{check.fixHint}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-3">
        {!allChecked ? (
          <button
            className={cn(
              "inline-flex h-11 items-center justify-center rounded-button px-4 py-2 text-body font-medium transition-colors duration-200",
              "bg-accent text-white shadow-accent-button hover:bg-accent-warm",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
            )}
            onClick={onNext}
          >
            Run Checks
          </button>
        ) : (
          <button
            className={cn(
              "inline-flex h-11 items-center justify-center rounded-button px-4 py-2 text-body font-medium transition-colors duration-200",
              "bg-accent text-white shadow-accent-button hover:bg-accent-warm",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
            onClick={onNext}
            disabled={hasFailures}
          >
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
    new Set(MODEL_CATALOG.filter((m) => m.recommended).map((m) => m.name)),
  );
  const hasDownloads = Object.values(progress).some(
    (p) => p.status === "done" || p.status === "downloading",
  );

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const totalSize = MODEL_CATALOG.filter((m) => selected.has(m.name))
    .reduce((s, m) => s + m.size, "0\u00A0MB")
    .toString();

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <h2 className="text-balance text-heading text-text-primary">Download Models</h2>
      <p className="text-body text-text-secondary">
        Choose which speech recognition models to install. Smaller = faster, larger = more accurate.
      </p>

      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
        {MODEL_CATALOG.map((model) => (
          <label
            key={model.name}
            className={cn(
              "flex cursor-pointer flex-col gap-2 rounded-card border p-4 text-left transition-colors duration-200",
              selected.has(model.name)
                ? "border-[rgba(255,59,86,0.15)] bg-accent-surface"
                : "border-border bg-app-surface-card hover:border-border-hover",
            )}
          >
            <input
              type="checkbox"
              checked={selected.has(model.name)}
              onChange={() => toggle(model.name)}
              disabled={progress[model.name]?.status === "downloading"}
              className="sr-only"
            />
            <div className="flex items-center justify-between">
              <strong className="text-body text-text-primary">{model.name}</strong>
              <span
                className={cn(
                  "inline-flex items-center rounded-badge px-2 py-0.5 text-label font-semibold",
                  model.recommended
                    ? "border border-accent-muted-border bg-accent-muted text-accent-active"
                    : "border border-border bg-app-surface text-text-secondary",
                )}
              >
                {model.profile}
              </span>
            </div>
            <div className="flex items-center gap-3 text-small text-text-muted">
              <span>{model.size}</span>
              <span className="inline-flex items-center gap-1">
                <Zap size={11} aria-hidden="true" />
                {model.speed}
              </span>
              <span className="inline-flex items-center gap-1">
                <Star size={11} aria-hidden="true" />
                {model.accuracy}
              </span>
            </div>
            <p className="text-small text-text-secondary">{model.bestFor}</p>
            {progress[model.name] && (
              <div className="flex flex-col gap-1.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-app-surface-secondary">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-150"
                    style={{ width: `${progress[model.name].percent}%` }}
                  />
                </div>
                <span className="inline-flex items-center gap-1 text-small text-text-secondary">
                  {progress[model.name].status === "done" ? (
                    <>
                      <Check size={13} aria-hidden="true" /> Done
                    </>
                  ) : (
                    `${progress[model.name].percent}%`
                  )}
                </span>
              </div>
            )}
          </label>
        ))}
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          className={cn(
            "inline-flex h-11 items-center justify-center rounded-button px-4 py-2 text-body font-medium transition-colors duration-200",
            "bg-accent text-white shadow-accent-button hover:bg-accent-warm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
          onClick={() => onDownload(Array.from(selected))}
          disabled={selected.size === 0}
        >
          Download Selected (≈{totalSize})
        </button>
        <button
          className={cn(
            "inline-flex h-11 items-center justify-center rounded-button px-4 py-2 text-body font-medium transition-colors duration-200",
            "border border-border bg-app-surface text-text-primary hover:bg-app-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
          )}
          onClick={onDone}
        >
          {hasDownloads ? "Continue" : "Skip"}
        </button>
      </div>
    </div>
  );
}

function Step3MicSetup({
  micLevel,
  testing,
  onTest,
  onDone,
}: {
  micLevel: number;
  testing: boolean;
  onTest: () => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <h2 className="text-balance text-heading text-text-primary">Microphone Setup</h2>
      <p className="text-body text-text-secondary">Check your mic and adjust settings.</p>

      <div className="flex w-full flex-col items-center gap-4">
        <div className="h-3 w-full overflow-hidden rounded-input border border-border bg-app-surface-secondary">
          <div
            className="h-full rounded-input bg-accent transition-[width] duration-75"
            style={{ width: `${Math.min(100, micLevel * 300)}%` }}
          />
        </div>

        <button
          className={cn(
            "inline-flex h-11 items-center justify-center rounded-button px-4 py-2 text-body font-medium transition-colors duration-200",
            "border border-border bg-app-surface text-text-primary hover:bg-app-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
          )}
          onClick={onTest}
        >
          {testing ? "Stop Test" : "Test Microphone"}
        </button>
      </div>

      <div className="flex items-center justify-center">
        <button
          className={cn(
            "inline-flex h-11 items-center justify-center rounded-button px-4 py-2 text-body font-medium transition-colors duration-200",
            "bg-accent text-white shadow-accent-button hover:bg-accent-warm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
          )}
          onClick={onDone}
        >
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
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <h2 className="text-balance text-heading text-text-primary">Permissions</h2>
      <p className="text-body text-text-secondary">Control where your transcribed text goes.</p>

      <div className="flex w-full flex-col gap-3">
        <label className="flex cursor-pointer items-center justify-between rounded-card border border-border bg-app-surface px-4 py-3">
          <div className="text-left">
            <strong className="flex items-center gap-2 text-body text-text-primary">
              <ClipboardList size={16} className="text-text-secondary" />
              Auto-copy to Clipboard
            </strong>
          </div>
          <span className="relative inline-flex h-5 w-9 items-center rounded-full border border-border bg-app-surface-secondary transition-colors">
            <input
              type="checkbox"
              checked={clipboard}
              onChange={(e) => onClipboard(e.target.checked)}
              className="peer sr-only"
            />
            <span className="ml-0.5 inline-block h-3.5 w-3.5 rounded-full bg-text-muted transition-transform peer-checked:translate-x-4 peer-checked:bg-accent" />
          </span>
        </label>

        <label className="flex cursor-pointer items-center justify-between rounded-card border border-border bg-app-surface px-4 py-3">
          <div className="text-left">
            <strong className="flex items-center gap-2 text-body text-text-primary">
              <Keyboard size={16} className="text-text-secondary" />
              Type into Focused Window
            </strong>
          </div>
          <span className="relative inline-flex h-5 w-9 items-center rounded-full border border-border bg-app-surface-secondary transition-colors">
            <input
              type="checkbox"
              checked={typing}
              onChange={(e) => onTyping(e.target.checked)}
              className="peer sr-only"
            />
            <span className="ml-0.5 inline-block h-3.5 w-3.5 rounded-full bg-text-muted transition-transform peer-checked:translate-x-4 peer-checked:bg-accent" />
          </span>
        </label>
      </div>

      <div className="flex items-center justify-center">
        <button
          className={cn(
            "inline-flex h-11 items-center justify-center rounded-button px-4 py-2 text-body font-medium transition-colors duration-200",
            "bg-accent text-white shadow-accent-button hover:bg-accent-warm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
          )}
          onClick={onDone}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function Step5Ready({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-accent">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </div>
      <h2 className="text-balance text-heading text-text-primary">You're All Set!</h2>
      <p className="text-body text-text-secondary">
        Press{" "}
        <kbd className="inline-flex items-center rounded-badge border border-border bg-app-surface-secondary px-2 py-0.5 text-label font-semibold text-text-primary">
          Space
        </kbd>{" "}
        to start/stop dictation anytime.
      </p>
      <div className="flex w-full flex-col gap-2 rounded-card border border-border bg-app-surface p-4 text-left text-body text-text-secondary">
        <div>
          <kbd className="mr-2 inline-flex items-center rounded-badge border border-border bg-app-surface-secondary px-2 py-0.5 text-label font-semibold text-text-primary">
            Space
          </kbd>{" "}
          Start / Stop
        </div>
        <div>
          <kbd className="mr-2 inline-flex items-center rounded-badge border border-border bg-app-surface-secondary px-2 py-0.5 text-label font-semibold text-text-primary">
            Space
          </kbd>{" "}
          (hold) Talk, release to transcribe
        </div>
        <div>
          <kbd className="mr-2 inline-flex items-center rounded-badge border border-border bg-app-surface-secondary px-2 py-0.5 text-label font-semibold text-text-primary">
            Esc
          </kbd>{" "}
          Cancel current
        </div>
      </div>
      <div className="flex items-center justify-center">
        <button
          className={cn(
            "inline-flex h-11 items-center justify-center rounded-button px-4 py-2 text-body font-medium transition-colors duration-200",
            "bg-accent text-white shadow-accent-button hover:bg-accent-warm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
          )}
          onClick={onFinish}
        >
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
  const { state, dispatch, runSystemChecks, downloadModels, nextStep, finish } =
    useOnboarding(onFinished);
  const { step, systemChecks, modelDownloadProgress, clipboardEnabled, typingEnabled, error } =
    state;
  const totalSteps = 5;

  // Live mic test: reuse the Settings capture path (usePermissions) and the
  // shared level emitter. The wizard reducer never carried a real level.
  const { isCapturingMic, requestMic, stopMic } = usePermissions();
  const [micLevel, setMicLevel] = useState(0);
  useEffect(() => micLevelEmitter.subscribe(setMicLevel), []);

  return (
    <div className="animate-wizard-in flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-lg">
        <StepIndicator step={step} total={totalSteps} />

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-card border border-red-500/20 bg-red-500/10 px-4 py-3 text-body text-red-600">
            <TriangleAlert size={16} className="shrink-0" /> {error}
            <button
              className="ml-auto flex items-center text-red-600 transition-colors hover:text-red-700"
              onClick={() => dispatch({ type: "CLEAR_ERROR" })}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="rounded-card border border-border bg-app-surface p-6">
          {/* Keyed by step so the CSS entrance animation replays on change. */}
          <div key={step} className="animate-step-in">
            {step === 0 && (
              <Step1SystemCheck
                checks={
                  systemChecks.length > 0
                    ? systemChecks
                    : [{ name: "Running checks…", status: "pending", message: "Scanning system" }]
                }
                onNext={() => runSystemChecks()}
              />
            )}
            {step === 1 && (
              <Step2ModelDownload
                progress={modelDownloadProgress}
                onDownload={(models) => {
                  downloadModels(models);
                }}
                onDone={() => nextStep()}
              />
            )}
            {step === 2 && (
              <Step3MicSetup
                micLevel={micLevel}
                testing={isCapturingMic}
                onTest={isCapturingMic ? stopMic : () => void requestMic()}
                onDone={() => {
                  stopMic();
                  nextStep();
                }}
              />
            )}
            {step === 3 && (
              <Step4Permissions
                clipboard={clipboardEnabled}
                typing={typingEnabled}
                onClipboard={(v) => dispatch({ type: "SET_CLIPBOARD", enabled: v })}
                onTyping={(v) => dispatch({ type: "SET_TYPING", enabled: v })}
                onDone={() => nextStep()}
              />
            )}
            {step === 4 && <Step5Ready onFinish={finish} />}
          </div>
        </div>
      </div>
    </div>
  );
}
