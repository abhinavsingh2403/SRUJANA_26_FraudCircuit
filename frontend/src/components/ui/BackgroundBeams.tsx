import React from "react";
import { cn } from "../../lib/utils";

interface BackgroundBeamsProps {
  className?: string;
}

/**
 * BackgroundBeams — Aceternity UI ambient ray mesh overlay for high-tech canvas depth.
 */
export const BackgroundBeams: React.FC<BackgroundBeamsProps> = ({ className }) => {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]",
        className
      )}
    >
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-500/10 rounded-full blur-[120px] animate-pulse" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-rose-500/5 rounded-full blur-[140px] animate-pulse" style={{ animationDelay: "2s" }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-600/[0.03] rounded-full blur-[160px]" />
    </div>
  );
};
