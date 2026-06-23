import { Cpu, Zap, Gauge, Target, Rocket, Sparkles } from "lucide-react";

const PROFILE_INFO: Record<string, { label: string; model: string; icon: React.ReactNode; color: string }> = {
  auto:     { label: "Auto",      model: "Auto-select",       icon: <Sparkles size={10} />, color: "text-text-muted" },
  speed:    { label: "Speed",     model: "tiny.en",           icon: <Zap size={10} />,      color: "text-green-500" },
  balanced: { label: "Balanced",  model: "base.en",           icon: <Gauge size={10} />,     color: "text-blue-500" },
  accuracy: { label: "Accuracy",  model: "small.en",          icon: <Target size={10} />,    color: "text-purple-500" },
  "small-cuda": { label: "Small", model: "small.en · CUDA",  icon: <Cpu size={10} />,       color: "text-cyan-500" },
  distil:   { label: "Distil",    model: "distil-large-v3",   icon: <Rocket size={10} />,    color: "text-accent" },
  turbo:    { label: "Turbo",     model: "large-v3-turbo",    icon: <Rocket size={10} />,    color: "text-orange-500" },
};

interface ModelBadgeProps {
  profile: string;
  resolvedModel: { profile: string; model: string; backend: string; device: string } | null;
}

export default function ModelBadge({ profile, resolvedModel }: ModelBadgeProps) {
  // Use backend-resolved info when available, fall back to profile defaults
  const resolvedProfile = resolvedModel?.profile || profile;
  const info = PROFILE_INFO[resolvedProfile] ?? PROFILE_INFO.auto;
  const displayName = resolvedModel?.model || info.model;
  const deviceLabel = resolvedModel?.device === "cuda" ? "GPU" : "CPU";

  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/60 border border-[rgba(44,37,32,0.06)] backdrop-blur-sm">
      <span className={info.color}>{info.icon}</span>
      <span className="text-[10px] font-semibold text-text-primary tracking-wide uppercase">
        {resolvedModel ? (PROFILE_INFO[resolvedProfile]?.label ?? resolvedProfile) : info.label}
      </span>
      <span className="w-px h-2.5 bg-[rgba(44,37,32,0.12)]" />
      <span className="text-[10px] text-text-muted font-medium">{displayName}</span>
      {resolvedModel && (
        <>
          <span className="w-px h-2.5 bg-[rgba(44,37,32,0.12)]" />
          <span className="text-[10px] text-text-muted font-medium">{deviceLabel}</span>
        </>
      )}
    </div>
  );
}
