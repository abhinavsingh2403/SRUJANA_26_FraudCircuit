import React from "react";
import { cn } from "../../lib/utils";

interface RadarScanProps {
  className?: string;
}

/**
 * RadarScan — Defense/Financial Intelligence observatory sweep animation.
 * Positions ambient concentric coordinate rings and a soft rotating radar beam.
 */
export const RadarScan: React.FC<RadarScanProps> = ({ className }) => {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden flex items-center justify-center opacity-25",
        className
      )}
    >
      {/* Concentric Coordinate Rings */}
      <div className="absolute w-[300px] h-[300px] rounded-full border border-indigo-500/20" />
      <div className="absolute w-[500px] h-[500px] rounded-full border border-indigo-500/15" />
      <div className="absolute w-[700px] h-[700px] rounded-full border border-indigo-500/10" />

      {/* Crosshair coordinate axes */}
      <div className="absolute w-full h-[1px] bg-gradient-to-r from-transparent via-indigo-500/15 to-transparent" />
      <div className="absolute h-full w-[1px] bg-gradient-to-b from-transparent via-indigo-500/15 to-transparent" />

      {/* Sweeping Radar Beam */}
      <div
        className="absolute w-[600px] h-[600px] rounded-full animate-radar-sweep origin-center"
        style={{
          background: "conic-gradient(from 0deg at 50% 50%, rgba(99, 102, 241, 0.12) 0deg, transparent 60deg, transparent 360deg)",
        }}
      />
    </div>
  );
};
