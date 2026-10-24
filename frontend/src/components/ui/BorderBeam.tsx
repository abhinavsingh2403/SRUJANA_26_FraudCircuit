import React from "react";
import { cn } from "../../lib/utils";

interface BorderBeamProps {
  className?: string;
  size?: number;
  duration?: number;
  borderWidth?: number;
  colorFrom?: string;
  colorTo?: string;
}

/**
 * BorderBeam — Magic UI inspired animated light beam traveling along card boundaries.
 * Highlights high-priority alerts, active dossiers, and critical triage items.
 */
export const BorderBeam: React.FC<BorderBeamProps> = ({
  className,
  size = 150,
  duration = 8,
  borderWidth = 1.5,
  colorFrom = "#ef4444",
  colorTo = "#818cf8",
}) => {
  return (
    <div
      style={
        {
          "--size": `${size}px`,
          "--duration": `${duration}s`,
          "--border-width": `${borderWidth}px`,
          "--color-from": colorFrom,
          "--color-to": colorTo,
        } as React.CSSProperties
      }
      className={cn(
        "pointer-events-none absolute inset-0 rounded-[inherit] [border:var(--border-width)_solid_transparent]",
        "![mask-clip:padding-box,border-box] ![mask-composite:intersect] [mask:linear-gradient(transparent,transparent),linear-gradient(white,white)]",
        "after:absolute after:aspect-square after:w-[calc(var(--size))] after:animate-border-beam after:[animation-delay:0s] after:[background:linear-gradient(to_left,var(--color-from),var(--color-to),transparent)] after:[offset-anchor:calc(var(--size)/2)_50%] after:[offset-path:rect(0_auto_auto_0_round_calc(var(--size)))]",
        className
      )}
    />
  );
};
