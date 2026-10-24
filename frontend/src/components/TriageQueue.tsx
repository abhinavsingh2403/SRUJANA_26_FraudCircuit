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

const PRIORITY_THEME: Record<Priority, { border: string; dot: string; text: string; label: string }> = {
  HIGH: {
    border: "border-l-rose-500",
    dot: "bg-rose-500",
    text: "text-rose-400",
    label: "HIGH",
  },
  MEDIUM: {
    border: "border-l-amber-500",
    dot: "bg-amber-500",
    text: "text-amber-400",
    label: "MEDIUM",
  },
  LOW: {
    border: "border-l-slate-400",
    dot: "bg-slate-400",
    text: "text-slate-300",
    label: "LOW",
  },
  INSUFFICIENT_HISTORY: {
    border: "border-l-zinc-500",
    dot: "bg-zinc-500",
    text: "text-zinc-400",
    label: "COVERAGE",
  },
};

const STATUS_THEME: Record<CaseStatus, { bg: string; text: string; border: string }> = {
  OPEN: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/25" },
  INVESTIGATING: { bg: "bg-indigo-500/10", text: "text-indigo-400", border: "border-indigo-500/25" },
  ESCALATED: { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/25" },
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
    <aside className="w-80 flex-shrink-0 border-r border-white/[0.08] bg-[#0c0e17] flex flex-col h-[calc(100vh-3.5rem-2rem)] z-20">
      {/* Panel Header */}
      <div className="p-3.5 border-b border-white/[0.06] flex flex-col gap-2.5 bg-[#0e111d]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-tight text-zinc-100 font-sans">
            <Filter className="h-3.5 w-3.5 text-indigo-400" />
            <span>Triage Queue</span>
          </div>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-white/[0.04] text-zinc-400 border border-white/[0.06]">
            {total} cases
          </span>
        </div>

        {/* View Mode Toggle */}
        {hasLatestRun && (
          <div className="grid grid-cols-2 p-1 rounded-xl bg-zinc-900/80 border border-white/[0.06] text-xs">
            <button
              type="button"
              onClick={() => onViewModeChange("all")}
              className={`py-1 rounded-lg text-[11px] font-sans transition-colors ${
                viewMode === "all"
                  ? "bg-indigo-600 text-white font-semibold shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              All Cases
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("run")}
              className={`py-1 rounded-lg text-[11px] font-sans transition-colors ${
                viewMode === "run"
                  ? "bg-indigo-600 text-white font-semibold shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Latest Run
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <select
            value={priorityFilter}
            onChange={(e) => onPriorityFilterChange(e.target.value)}
            className="h-8 px-2.5 rounded-xl bg-zinc-900 border border-white/[0.08] text-zinc-200 text-xs focus:outline-none focus:border-indigo-500 font-sans cursor-pointer transition-colors"
          >
            <option value="">All Priorities</option>
            <option value="HIGH">High Priority</option>
            <option value="MEDIUM">Medium Priority</option>
            <option value="LOW">Low / Context</option>
            <option value="INSUFFICIENT_HISTORY">Coverage Cue</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="h-8 px-2.5 rounded-xl bg-zinc-900 border border-white/[0.08] text-zinc-200 text-xs focus:outline-none focus:border-indigo-500 font-sans cursor-pointer transition-colors"
          >
            <option value="">All Statuses</option>
            <option value="OPEN">Open</option>
            <option value="INVESTIGATING">Investigating</option>
            <option value="ESCALATED">Escalated</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
      </div>

      {/* Case List Scroll Area */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {isLoading ? (
          <div className="p-8 text-center text-zinc-500 text-xs font-mono animate-pulse">
            Loading investigation cases…
          </div>
        ) : cases.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-xs flex flex-col items-center gap-2 font-sans">
            <span>No matching cases found.</span>
            <span className="text-[11px] text-zinc-600">Replay a scenario or import a CSV.</span>
          </div>
        ) : (
          cases.map((c) => {
            const isSelected = c.case_id === selectedCaseId;
            const style = PRIORITY_THEME[c.priority] || PRIORITY_THEME.MEDIUM;
            const statusStyle = STATUS_THEME[c.status] || STATUS_THEME.OPEN;

            return (
              <button
                key={c.case_id}
                type="button"
                onClick={() => onSelectCase(c.case_id)}
                className={`w-full text-left p-3 rounded-2xl border border-l-4 transition-all duration-150 cursor-pointer ${
                  style.border
                } ${
                  isSelected
                    ? "bg-[#161a29] border-indigo-500/50 shadow-sm"
                    : "bg-[#111420] border-white/[0.06] hover:bg-[#141926] hover:border-white/10 hover:-translate-y-[1px]"
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="font-mono text-xs text-zinc-200 font-medium truncate">
                    {c.case_id}
                  </span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                    <span className={`text-[10px] font-semibold tracking-wider uppercase font-sans ${style.text}`}>
                      {style.label}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed mb-2 font-sans">
                  {c.summary || "Review supporting evidence and context signals."}
                </p>

                <div className="flex items-center justify-between text-[11px] text-zinc-500 font-sans pt-1 border-t border-white/[0.04]">
                  <span className="truncate max-w-[140px] text-zinc-400 font-medium">
                    {c.source_scenario_id || "CSV import"}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
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
        <div className="px-3.5 py-2 border-t border-white/[0.06] flex items-center justify-between text-xs bg-[#0e111d]">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(Math.max(0, offset - pageSize))}
            className="p-1 rounded hover:bg-white/[0.08] disabled:opacity-30 disabled:hover:bg-transparent text-zinc-400 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[11px] font-sans text-zinc-400">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(offset + pageSize)}
            className="p-1 rounded hover:bg-white/[0.08] disabled:opacity-30 disabled:hover:bg-transparent text-zinc-400 transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Scenario Runner Section */}
      <div className="p-3.5 border-t border-white/[0.08] bg-[#0a0d16] flex flex-col gap-2">
        <label className="text-[11px] font-sans font-medium text-zinc-400 flex items-center justify-between">
          <span>Synthetic Scenarios</span>
          <span className="text-zinc-500 font-mono text-[10px]">{scenarios.length} Fixtures</span>
        </label>

        <select
          value={selectedScenarioId}
          onChange={(e) => onScenarioSelect(e.target.value)}
          className="h-8 px-2.5 rounded-xl bg-zinc-900 border border-white/[0.08] text-zinc-200 text-xs focus:outline-none focus:border-indigo-500 truncate font-sans cursor-pointer transition-colors"
        >
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title || s.id}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onReplayScenario}
            disabled={isReplayingScenario || !selectedScenarioId}
            className="flex-1 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50 shadow-sm"
          >
            <Play className="h-3 w-3 fill-current" />
            <span>{isReplayingScenario ? "Replaying…" : "Replay"}</span>
          </button>
          <button
            type="button"
            onClick={onReplayAll}
            disabled={isReplayingAll}
            className="h-8 px-3 rounded-xl border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 text-xs font-medium transition-all active:scale-95 disabled:opacity-50"
            title="Replay all 14 scenarios"
          >
            Run All
          </button>
        </div>
      </div>
    </aside>
  );
};
