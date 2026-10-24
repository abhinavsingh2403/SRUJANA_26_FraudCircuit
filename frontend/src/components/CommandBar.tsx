import React from "react";
import { Upload, RefreshCw, Play, ShieldAlert, Activity } from "lucide-react";
import type { CaseRecord } from "../types/domain";
import { NumberTicker } from "./ui/NumberTicker";

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
    <header className="h-14 border-b border-white/[0.08] bg-[#0c0e17]/95 backdrop-blur-xl px-4 flex items-center justify-between select-none z-30 sticky top-0">
      {/* Brand & Mission Tag */}
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-sm shadow-sm">
          ◆
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-bold tracking-tight text-zinc-100 text-sm flex items-center gap-1.5 font-sans">
            TraceGuard
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              v1.0
            </span>
          </span>
          <span className="text-[11px] font-sans text-zinc-500 hidden sm:inline">
            // F-01 Fraud & Risk Workbench
          </span>
        </div>

        {/* API Health Indicator */}
        <div className="hidden sm:flex items-center gap-2 ml-3 pl-3 border-l border-white/[0.08] text-xs font-sans">
          <span
            className={`h-2 w-2 rounded-full transition-colors ${
              apiConnected ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" : "bg-rose-500"
            }`}
          />
          <span className="text-[11px] text-zinc-400 font-mono">
            {apiConnected ? "API LIVE" : "DISCONNECTED"}
          </span>
        </div>
      </div>

      {/* Center Intelligence Ribbon */}
      <div className="hidden md:flex items-center gap-3.5 px-4 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.08] text-xs shadow-inner font-sans">
        <div className="flex items-center gap-1.5 text-zinc-300">
          <Activity className="h-3.5 w-3.5 text-indigo-400" />
          <NumberTicker value={totalCases} className="font-bold text-zinc-100" />
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Cases</span>
        </div>
        <span className="text-zinc-700">·</span>
        <div className="flex items-center gap-1.5 text-rose-400">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          <NumberTicker value={highCount} className="font-bold text-rose-400" />
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">High</span>
        </div>
        <span className="text-zinc-700">·</span>
        <div className="flex items-center gap-1.5 text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          <NumberTicker value={medCount} className="font-bold text-amber-400" />
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Med</span>
        </div>
        <span className="text-zinc-700">·</span>
        <div className="flex items-center gap-1.5 text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
          <NumberTicker value={lowCount} className="font-bold text-zinc-300" />
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Low/Cue</span>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2.5">
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900/80 border border-white/[0.06] text-[11px] font-sans text-zinc-400 shadow-sm">
          <ShieldAlert className="h-3 w-3 text-zinc-500" />
          <span>Rules Engine</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-500">ML Unconfigured</span>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="h-8 px-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
          title="Refresh cases queue"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin text-indigo-400" : ""}`} />
          <span className="hidden sm:inline">Sync</span>
        </button>

        <button
          type="button"
          onClick={onReplayAll}
          disabled={isReplayingAll}
          className="h-8 px-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 text-xs font-medium flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
          title="Replay all 14 deterministic synthetic scenarios"
        >
          <Play className="h-3 w-3 fill-current" />
          <span>{isReplayingAll ? "Replaying 14…" : "Replay All"}</span>
        </button>

        <button
          type="button"
          onClick={onOpenImport}
          className="h-8 px-3 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 shadow-sm"
          title="Import raw UTF-8 canonical CSV bytes"
        >
          <Upload className="h-3.5 w-3.5 text-zinc-900" />
          <span>Import CSV</span>
        </button>
      </div>
    </header>
  );
};
