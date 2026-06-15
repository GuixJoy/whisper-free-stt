import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface ProfileCardProps extends React.HTMLAttributes<HTMLDivElement> {
  progress?: number;
  remainingText?: string;
}

export const ProfileCard = forwardRef<HTMLDivElement, ProfileCardProps>(
  ({ className, progress = 0, remainingText = "Unlocks in 2K words", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "relative rounded-card p-6 overflow-hidden border border-white/[0.06]",
          className,
        )}
        {...props}
      >
        {/* Background layers */}
        <div className="absolute inset-0 bg-app-surface-card" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_15%,rgba(200,138,50,0.10),transparent_65%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_85%,rgba(50,120,130,0.10),transparent_60%)]" />

        {/* Content */}
        <div className="relative z-10">
          <h3 className="text-card-heading font-semibold text-text-primary mb-1">
            Your Voice Profile
          </h3>
          <p className="text-[15px] text-text-secondary mb-4">
            Discover how you use your voice.
          </p>

          {/* Progress bar */}
          <div className="relative">
            <div className="h-1 bg-white/[0.08] rounded-full overflow-hidden">
              <div
                className="h-full progress-fill rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-[13px] text-text-muted mt-2 text-right">
              {remainingText}
            </p>
          </div>
        </div>
      </div>
    );
  },
);

ProfileCard.displayName = "ProfileCard";
