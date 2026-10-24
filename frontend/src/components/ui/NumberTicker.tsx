import React, { useEffect, useState } from "react";
import { cn } from "../../lib/utils";

interface NumberTickerProps {
  value: number;
  className?: string;
  duration?: number; // duration in ms
}

/**
 * NumberTicker — Magic UI pattern for smoothly animating numerical metrics on update.
 */
export const NumberTicker: React.FC<NumberTickerProps> = ({
  value,
  className,
  duration = 800,
}) => {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    let startTime: number | null = null;
    const startVal = displayValue;
    const diff = value - startVal;

    if (diff === 0) return;

    let animId: number;

    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(startVal + diff * eased));

      if (progress < 1) {
        animId = requestAnimationFrame(step);
      }
    };

    animId = requestAnimationFrame(step);

    return () => cancelAnimationFrame(animId);
  }, [value, duration]);

  return <span className={cn("tabular-nums font-mono", className)}>{displayValue}</span>;
};
