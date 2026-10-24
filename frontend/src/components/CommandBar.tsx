import React from "react";
import { Upload, RefreshCw, Play, ShieldAlert, Activity } from "lucide-react";
import type { CaseRecord } from "../types/domain";

interface CommandBarProps {
  cases: CaseRecord[];
  totalCases: number;
  apiConnected: boolean;
  onOpenImport: () => void;
  onReplayAll: () => void;
  isReplayingAll: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const CommandBar: React.FC<CommandBarProps> = ({
  cases,
  totalCases,
  apiConnected,
  onOpenImport,
  onReplayAll,
  isReplayingAll,
  onRefresh,
  isRefreshing,
}) => {
  const highCount = cases.filter((c) => c.priority === "HIGH").length;
  const medCount = cases.filter((c) => c.priority === "MEDIUM").length;
  const lowCount = cases.filter((c) => c.priority === "LOW" || c.priority === "INSUFFICIENT_HISTORY").length;

  return (
    <header className="h-14 border-b border-white/[0.08] bg-[#0a0a0f] px-4 flex items-center justify-between select-none">
      {/* Brand & Mission Tag */}
      <div className="flex items-center gap-3">
        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-indigo-500/20 to-indigo-600/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-sm shadow-[0_0_12px_rgba(99,102,241,0.2)]">
          ◆
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-bold tracking-tight text-zinc-100 text-sm">TraceGuard</span>
          <span className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase">
            // F-01 WORKBENCH
          </span>
        </div>

        {/* API Health Pulse */}
        <div className="hidden sm:flex items-center gap-1.5 ml-3 pl-3 border-l border-white/[0.06] text-xs">
          <span
            className={`h-2 w-2 rounded-full transition-colors ${
              apiConnected
                ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                : "bg-rose-500 animate-pulse"
            }`}
          />
          <span className="text-[11px] font-mono text-zinc-400">
            {apiConnected ? "API LIVE" : "DISCONNECTED"}
          </span>
        </div>
      </div>

      {/* Center Intelligence Ticker (Bloomberg terminal style) */}
      <div className="hidden md:flex items-center gap-3 px-3 py-1 rounded-full bg-white/[0.03] border border-white/[0.06] font-mono text-xs">
        <div className="flex items-center gap-1.5 text-zinc-300">
          <Activity className="h-3 w-3 text-indigo-400" />
          <span>{totalCases} CASES</span>
        </div>
        <span className="text-zinc-600">│</span>
        <div className="flex items-center gap-1.5 text-rose-400">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
          <span>{highCount} HIGH</span>
        </div>
        <span className="text-zinc-600">│</span>
        <div className="flex items-center gap-1.5 text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          <span>{medCount} MED</span>
        </div>
        <span className="text-zinc-600">│</span>
        <div className="flex items-center gap-1.5 text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
          <span>{lowCount} LOW / CUE</span>
        </div>
      </div>

      {/* Right Controls & Honest Status Pill */}
      <div className="flex items-center gap-2.5">
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900/80 border border-white/[0.06] text-[10px] font-mono text-zinc-400">
          <ShieldAlert className="h-3 w-3 text-zinc-500" />
          <span>RULES-ONLY MODE</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-500">ML UNCONFIGURED</span>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="h-8 px-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition-all active:scale-[0.98] disabled:opacity-50"
          title="Refresh cases queue"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin text-indigo-400" : ""}`} />
          <span className="hidden sm:inline">Sync</span>
        </button>

        <button
          type="button"
          onClick={onReplayAll}
          disabled={isReplayingAll}
          className="h-8 px-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 text-xs font-medium flex items-center gap-1.5 transition-all active:scale-[0.98] disabled:opacity-50 shadow-[0_0_12px_rgba(99,102,241,0.15)]"
          title="Replay all 14 deterministic synthetic scenarios"
        >
          <Play className={`h-3 w-3 fill-current ${isReplayingAll ? "animate-pulse" : ""}`} />
          <span>{isReplayingAll ? "Replaying 14..." : "Replay All"}</span>
        </button>

        <button
          type="button"
          onClick={onOpenImport}
          className="h-8 px-3 rounded-lg border border-white/10 bg-zinc-100 hover:bg-white text-zinc-900 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-[0.98] shadow-sm"
          title="Import raw UTF-8 canonical CSV bytes"
        >
          <Upload className="h-3.5 w-3.5" />
          <span>Import CSV</span>
        </button>
      </div>
    </header>
  );
};
