import React from "react";
import { Filter, ChevronLeft, ChevronRight, Play } from "lucide-react";
import type { CaseRecord, Priority, CaseStatus, Scenario } from "../types/domain";

interface TriageQueueProps {
  cases: CaseRecord[];
  selectedCaseId: string | null;
  onSelectCase: (caseId: string) => void;
  priorityFilter: string;
  onPriorityFilterChange: (p: string) => void;
  statusFilter: string;
  onStatusFilterChange: (s: string) => void;
  viewMode: "all" | "run";
  onViewModeChange: (mode: "all" | "run") => void;
  hasLatestRun: boolean;
  total: number;
  offset: number;
  pageSize: number;
  onPageChange: (newOffset: number) => void;
  scenarios: Scenario[];
  selectedScenarioId: string;
  onScenarioSelect: (id: string) => void;
  onReplayScenario: () => void;
  isReplayingScenario: boolean;
  onReplayAll: () => void;
  isReplayingAll: boolean;
  isLoading: boolean;
}

const PRIORITY_ACCENT: Record<Priority, { border: string; dot: string; text: string }> = {
  HIGH: { border: "border-l-rose-500", dot: "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]", text: "text-rose-400" },
  MEDIUM: { border: "border-l-amber-500", dot: "bg-amber-500", text: "text-amber-400" },
  LOW: { border: "border-l-slate-400", dot: "bg-slate-400", text: "text-slate-300" },
  INSUFFICIENT_HISTORY: { border: "border-l-zinc-600", dot: "bg-zinc-600", text: "text-zinc-400" },
};

const STATUS_PILL: Record<CaseStatus, { bg: string; text: string; border: string }> = {
  OPEN: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
  INVESTIGATING: { bg: "bg-indigo-500/10", text: "text-indigo-400", border: "border-indigo-500/20" },
  ESCALATED: { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/20" },
  CLOSED: { bg: "bg-zinc-800", text: "text-zinc-400", border: "border-zinc-700" },
};

export const TriageQueue: React.FC<TriageQueueProps> = ({
  cases,
  selectedCaseId,
  onSelectCase,
  priorityFilter,
  onPriorityFilterChange,
  statusFilter,
  onStatusFilterChange,
  viewMode,
  onViewModeChange,
  hasLatestRun,
  total,
  offset,
  pageSize,
  onPageChange,
  scenarios,
  selectedScenarioId,
  onScenarioSelect,
  onReplayScenario,
  isReplayingScenario,
  onReplayAll,
  isReplayingAll,
  isLoading,
}) => {
  const totalPages = Math.ceil(total / pageSize) || 1;
  const currentPage = Math.floor(offset / pageSize) + 1;

  return (
    <aside className="w-72 sm:w-80 flex-shrink-0 border-r border-white/[0.08] bg-[#0a0a0f] flex flex-col h-[calc(100vh-3.5rem-2rem)]">
      {/* Panel Header & Toggles */}
      <div className="p-3 border-b border-white/[0.06] flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold tracking-tight text-zinc-200">
            <Filter className="h-3.5 w-3.5 text-indigo-400" />
            <span>TRIAGE QUEUE</span>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.04] text-zinc-400 border border-white/[0.06]">
            {total} MATCHING
          </span>
        </div>

        {/* View Mode Toggle: All vs Latest Run */}
        {hasLatestRun && (
          <div className="grid grid-cols-2 p-0.5 rounded-lg bg-zinc-900 border border-white/[0.06] text-xs">
            <button
              type="button"
              onClick={() => onViewModeChange("all")}
              className={`py-1 rounded-md text-[11px] font-medium transition-all ${
                viewMode === "all"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              All Cases
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("run")}
              className={`py-1 rounded-md text-[11px] font-medium transition-all ${
                viewMode === "run"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Latest Run
            </button>
          </div>
        )}

        {/* Filter Dropdowns */}
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          <select
            value={priorityFilter}
            onChange={(e) => onPriorityFilterChange(e.target.value)}
            className="h-7 px-2 rounded-md bg-zinc-900 border border-white/[0.08] text-zinc-300 text-[11px] focus:outline-none focus:border-indigo-500"
          >
            <option value="">All Priorities</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
            <option value="INSUFFICIENT_HISTORY">COVERAGE</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="h-7 px-2 rounded-md bg-zinc-900 border border-white/[0.08] text-zinc-300 text-[11px] focus:outline-none focus:border-indigo-500"
          >
            <option value="">All Statuses</option>
            <option value="OPEN">OPEN</option>
            <option value="INVESTIGATING">INVESTIGATING</option>
            <option value="ESCALATED">ESCALATED</option>
            <option value="CLOSED">CLOSED</option>
          </select>
        </div>
      </div>

      {/* Case List Scroll Area */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {isLoading ? (
          <div className="p-8 text-center text-zinc-500 text-xs font-mono animate-pulse">
            Loading investigation cases…
          </div>
        ) : cases.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-xs flex flex-col items-center gap-2">
            <span>No matching cases found.</span>
            <span className="text-[10px] text-zinc-600">Replay a scenario or import a CSV.</span>
          </div>
        ) : (
          cases.map((c) => {
            const isSelected = c.case_id === selectedCaseId;
            const style = PRIORITY_ACCENT[c.priority] || PRIORITY_ACCENT.MEDIUM;
            const statusStyle = STATUS_PILL[c.status] || STATUS_PILL.OPEN;

            return (
              <button
                key={c.case_id}
                type="button"
                onClick={() => onSelectCase(c.case_id)}
                className={`w-full text-left p-2.5 rounded-lg border border-l-4 transition-all ${
                  style.border
                } ${
                  isSelected
                    ? "bg-indigo-500/[0.08] border-indigo-500/40 ring-1 ring-indigo-500/20"
                    : "bg-[#0f1117]/60 border-white/[0.06] hover:bg-[#141820] hover:border-white/[0.12]"
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="font-mono text-[11px] text-zinc-300 font-semibold truncate">
                    {c.case_id}
                  </span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                    <span className={`text-[10px] font-bold ${style.text}`}>
                      {c.priority === "INSUFFICIENT_HISTORY" ? "CUE" : c.priority}
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed mb-2">
                  {c.summary || "Review supporting evidence and context signals."}
                </p>

                <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                  <span className="truncate max-w-[130px] text-zinc-400">
                    {c.source_scenario_id || "CSV import"}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded border text-[9px] font-semibold ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
                  >
                    {c.status}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="px-3 py-2 border-t border-white/[0.06] flex items-center justify-between text-xs bg-zinc-950/40">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(Math.max(0, offset - pageSize))}
            className="p-1 rounded hover:bg-white/[0.08] disabled:opacity-30 disabled:hover:bg-transparent text-zinc-400"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[10px] font-mono text-zinc-400">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(offset + pageSize)}
            className="p-1 rounded hover:bg-white/[0.08] disabled:opacity-30 disabled:hover:bg-transparent text-zinc-400"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Built-in Scenario Replayer Section (Bottom of Rail) */}
      <div className="p-3 border-t border-white/[0.08] bg-[#0d0e14] flex flex-col gap-2">
        <label className="text-[10px] font-mono tracking-wider uppercase text-zinc-400 flex items-center justify-between">
          <span>Synthetic Fixtures</span>
          <span className="text-zinc-600">{scenarios.length} sets</span>
        </label>

        <select
          value={selectedScenarioId}
          onChange={(e) => onScenarioSelect(e.target.value)}
          className="h-8 px-2 rounded-lg bg-zinc-900 border border-white/[0.1] text-zinc-200 text-xs focus:outline-none focus:border-indigo-500 truncate"
        >
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title || s.id}
            </option>
          ))}
        </select>

        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onReplayScenario}
            disabled={isReplayingScenario || !selectedScenarioId}
            className="flex-1 h-7 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold flex items-center justify-center gap-1 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <Play className="h-2.5 w-2.5 fill-current" />
            <span>{isReplayingScenario ? "Replaying…" : "Replay"}</span>
          </button>
          <button
            type="button"
            onClick={onReplayAll}
            disabled={isReplayingAll}
            className="h-7 px-2.5 rounded-md border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 text-[11px] font-medium transition-all active:scale-[0.98] disabled:opacity-50"
            title="Replay all 14 scenarios"
          >
            Run All
          </button>
        </div>
      </div>
    </aside>
  );
};
