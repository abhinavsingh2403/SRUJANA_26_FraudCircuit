import React, { useRef, useState, useCallback } from "react";
import { cn } from "../../lib/utils";

interface Card3DProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  intensity?: number; // Tilt intensity in degrees, default 6
  spotlightColor?: string; // Spotlight gradient color
  enableTilt?: boolean;
}

/**
 * Card3D — Aceternity / React Bits inspired 3D card tilt with mouse-following dynamic spotlight.
 * Pure CSS matrix & hardware-accelerated transforms without heavy dependencies.
 */
export const Card3D: React.FC<Card3DProps> = ({
  children,
  className,
  intensity = 6,
  spotlightColor = "rgba(99, 102, 241, 0.12)",
  enableTilt = true,
  ...props
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState("");
  const [spotlightPos, setSpotlightPos] = useState({ x: -100, y: -100, opacity: 0 });

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!cardRef.current) return;
      const rect = cardRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      setSpotlightPos({ x, y, opacity: 1 });

      if (enableTilt) {
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -intensity;
        const rotateY = ((x - centerX) / centerX) * intensity;
        setTransform(
          `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(1.01, 1.01, 1.01)`
        );
      }
    },
    [enableTilt, intensity]
  );

  const handleMouseLeave = useCallback(() => {
    setTransform("perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)");
    setSpotlightPos((prev) => ({ ...prev, opacity: 0 }));
  }, []);

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: transform || "perspective(1000px) rotateX(0deg) rotateY(0deg)",
        transition: transform ? "transform 0.1s ease-out" : "transform 0.5s ease-out",
        transformStyle: "preserve-3d",
      }}
      className={cn("relative overflow-hidden group will-change-transform", className)}
      {...props}
    >
      {/* Mouse Tracking Spotlight Gradient */}
      <div
        className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-300"
        style={{
          opacity: spotlightPos.opacity,
          background: `radial-gradient(circle 140px at ${spotlightPos.x}px ${spotlightPos.y}px, ${spotlightColor}, transparent 80%)`,
        }}
      />
      {children}
    </div>
  );
};
