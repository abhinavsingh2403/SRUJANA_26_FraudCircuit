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
    <footer className="h-8 border-t border-white/[0.06] bg-[#090b11] px-4 flex items-center justify-between text-[11px] font-sans text-zinc-500 select-none">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-zinc-400">
          <Database className="h-3 w-3 text-indigo-400" />
          <span>Local SQLite Ledger</span>
          {latestRunId && (
            <span className="font-mono text-[10px] text-zinc-500">({latestRunId.slice(0, 10)}…)</span>
          )}
        </div>
        <span className="text-zinc-700">·</span>
        <span>
          Showing <span className="font-semibold text-zinc-300">{visibleCases}</span> of <span className="font-semibold text-zinc-300">{totalCases}</span> Cases
        </span>
      </div>

      <div className="hidden sm:flex items-center gap-3">
        <span className="text-zinc-500 text-[10px] font-mono">
          MODEL: NOT_CONFIGURED · EVALUATION: NOT_RUN
        </span>
        <span className="text-zinc-700">·</span>
        <div className="flex items-center gap-1 text-zinc-400 text-[11px]">
          <Shield className="h-3 w-3 text-emerald-400" />
          <span>Srujana 2026 Decision Support</span>
        </div>
      </div>
    </footer>
  );
};
