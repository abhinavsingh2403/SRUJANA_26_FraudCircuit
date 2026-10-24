import React from "react";
import { Shield, Database } from "lucide-react";

interface StatusStripProps {
  totalCases: number;
  visibleCases: number;
  latestRunId: string | null;
}

export const StatusStrip: React.FC<StatusStripProps> = ({
  totalCases,
  visibleCases,
  latestRunId,
}) => {
  return (
    <footer className="h-8 border-t border-white/[0.06] bg-[#07070b] px-4 flex items-center justify-between text-[10px] font-mono text-zinc-500 select-none">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-zinc-400">
          <Database className="h-3 w-3 text-indigo-400" />
          <span>LEDGER: SQLITE</span>
          {latestRunId && (
            <span className="text-zinc-600">({latestRunId.slice(0, 12)}…)</span>
          )}
        </div>
        <span className="text-zinc-700">│</span>
        <span>
          SHOWING {visibleCases} OF {totalCases} CASES
        </span>
      </div>

      <div className="hidden sm:flex items-center gap-3">
        <span className="text-zinc-600">
          MODEL: NOT_CONFIGURED · EVALUATION: NOT_RUN
        </span>
        <span className="text-zinc-700">│</span>
        <div className="flex items-center gap-1 text-zinc-400">
          <Shield className="h-3 w-3 text-emerald-400" />
          <span>SRUJANA 2026 · PROTOTYPE DECISION SUPPORT</span>
        </div>
      </div>
    </footer>
  );
};
