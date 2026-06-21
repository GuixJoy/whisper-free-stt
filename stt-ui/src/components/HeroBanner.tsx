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
          "relative h-[190px] rounded-card overflow-hidden bg-app-surface-card",
          className,
        )}
        {...props}
      >
        {/* Layered warm glow */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Primary amber glow */}
          <div
            className="absolute"
            style={{
              width: "60%",
              height: "140%",
              top: "-20%",
              left: "30%",
              background:
                "radial-gradient(ellipse at 50% 50%, rgba(255,59,86,0.12) 0%, rgba(255,59,86,0.04) 35%, transparent 70%)",
              filter: "blur(35px)",
            }}
          />
          {/* Secondary warm bloom */}
          <div
            className="absolute"
            style={{
              width: "40%",
              height: "100%",
              top: "0%",
              left: "45%",
              background:
                "radial-gradient(ellipse at 50% 50%, rgba(255,59,86,0.08) 0%, transparent 65%)",
              filter: "blur(50px)",
            }}
          />
          {/* Cool teal accent bottom-right */}
          <div
            className="absolute"
            style={{
              width: "35%",
              height: "60%",
              bottom: "-10%",
              right: "5%",
              background:
                "radial-gradient(ellipse at 50% 50%, rgba(168,140,200,0.25) 0%, transparent 70%)",
              filter: "blur(40px)",
            }}
          />
        </div>

        {/* Noise grain */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.08] pointer-events-none">
          <filter id="banner-grain">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.65"
              numOctaves="3"
              stitchTiles="stitch"
            />
          </filter>
          <rect width="100%" height="100%" filter="url(#banner-grain)" />
        </svg>

        {/* Content */}
        <div className="relative z-10 flex items-center justify-between h-full p-8">
          <div className="max-w-[400px]">
            <h2 className="text-hero-heading text-text-primary mb-2">
              Make Flow sound like{" "}
              <em className="italic font-serif text-accent-warm">you</em>
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
