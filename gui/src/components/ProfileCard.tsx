import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Card } from "./Card";

interface ProfileCardProps extends React.HTMLAttributes<HTMLDivElement> {
  progress?: number;
  remainingText?: string;
}

export const ProfileCard = forwardRef<HTMLDivElement, ProfileCardProps>(
  ({ className, progress = 0, remainingText = "Unlocks in 2K words", ...props }, ref) => {
    return (
      <Card
        ref={ref}
        variant="stats"
        className={cn("p-6", className)}
        {...props}
      >
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
      </Card>
    );
  },
);

ProfileCard.displayName = "ProfileCard";
