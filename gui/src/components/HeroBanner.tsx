import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

interface HeroBannerProps extends React.HTMLAttributes<HTMLDivElement> {}

export const HeroBanner = forwardRef<HTMLDivElement, HeroBannerProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "relative h-[190px] rounded-card bg-[#0B0B0D] border border-white/[0.05] overflow-hidden",
          className,
        )}
        {...props}
      >
        {/* Background image */}
        <div className="absolute inset-0">
          <img
            src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80"
            alt=""
            className="w-full h-full object-cover opacity-75"
          />
          <div className="absolute inset-0 bg-black/45" />
        </div>

        {/* Ambient glow behind hero */}
        <div className="absolute -top-20 -right-20 w-80 h-80 bg-accent/10 rounded-full blur-[150px] pointer-events-none" />

        {/* Content */}
        <div className="relative z-10 flex items-center justify-between h-full p-8">
          <div className="max-w-[400px]">
            <h2 className="text-hero-heading text-text-primary mb-2">
              Make Flow sound like <em className="italic font-serif text-accent-warm">you</em>
            </h2>
            <p className="text-[18px] text-text-secondary mb-4">
              Set up different writing styles for different apps.
            </p>
            <Button
              variant="secondary"
              className="h-[44px] w-[110px] rounded-button font-medium"
            >
              Start now
            </Button>
          </div>
        </div>
      </div>
    );
  },
);

HeroBanner.displayName = "HeroBanner";
