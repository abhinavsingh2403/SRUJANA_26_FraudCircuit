import { useState, useEffect, useCallback } from "react";
import { CommandBar } from "./components/CommandBar";
import { TriageQueue } from "./components/TriageQueue";
import { GraphTheater } from "./components/GraphTheater";
import { EvidenceInspector } from "./components/EvidenceInspector";
import { TransactionTimeline } from "./components/TransactionTimeline";
import { CsvImportModal } from "./components/CsvImportModal";
import { StatusStrip } from "./components/StatusStrip";
import { Play, ShieldCheck, Network, Lock, Upload, Sparkles } from "lucide-react";
import { api } from "./lib/api";
import type {
  CaseRecord,
  CaseStatus,
  ImportResponse,
  ReviewOutcome,
  Scenario,
} from "./types/domain";

export function App() {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const pageSize = 100;
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<CaseRecord | null>(null);

  const [priorityFilter, setPriorityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [viewMode, setViewMode] = useState<"all" | "run">("all");
  const [latestRunId, setLatestRunId] = useState<string | null>(null);

  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState("");

  const [apiConnected, setApiConnected] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [hoveredTransactionId, setHoveredTransactionId] = useState<string | null>(null);

  const [auditResult, setAuditResult] = useState<{
    valid: boolean;
    event_count: number;
    warning?: string;
  } | null>(null);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isReplayingScenario, setIsReplayingScenario] = useState(false);
  const [isReplayingAll, setIsReplayingAll] = useState(false);
  const [isSavingReview, setIsSavingReview] = useState(false);
  const [isVerifyingAudit, setIsVerifyingAudit] = useState(false);
  const [isLoadingCases, setIsLoadingCases] = useState(false);

  const [toast, setToast] = useState<{ message: string; isError?: boolean } | null>(null);

  const showToast = (message: string, isError = false) => {
    setToast({ message, isError });
    setTimeout(() => setToast(null), 5000);
  };

  // Check health and load scenarios once
  useEffect(() => {
    api
      .health()
      .then(() => setApiConnected(true))
      .catch(() => setApiConnected(false));

    api
      .scenarios()
      .then((res) => {
        setScenarios(res.scenarios || []);
        if (res.scenarios && res.scenarios.length > 0) {
          setSelectedScenarioId(res.scenarios[0].id);
        }
      })
      .catch((err) => console.error("Could not load scenarios:", err));
  }, []);

  // Fetch cases according to current filters
  const fetchCases = useCallback(
    async (keepSelection = true) => {
      setIsLoadingCases(true);
      try {
        const params: Record<string, any> = {
          limit: pageSize,
          offset,
        };
        if (priorityFilter) params.priority = priorityFilter;
        if (statusFilter) params.status = statusFilter;
        if (viewMode === "run" && latestRunId) params.run_id = latestRunId;

        const res = await api.cases(params);
        setCases(res.cases || []);
        setTotal(res.total || 0);
        setApiConnected(true);

        // Selection preservation / fallback
        if (keepSelection && selectedCaseId && res.cases.some((c) => c.case_id === selectedCaseId)) {
          // Keep current
        } else if (res.cases && res.cases.length > 0) {
          setSelectedCaseId(res.cases[0].case_id);
        } else {
          setSelectedCaseId(null);
          setSelectedCase(null);
        }
      } catch (err: unknown) {
        setApiConnected(false);
        showToast(err instanceof Error ? err.message : "Failed to load cases", true);
      } finally {
        setIsLoadingCases(false);
        setIsRefreshing(false);
      }
    },
    [offset, priorityFilter, statusFilter, viewMode, latestRunId, selectedCaseId]
  );

  useEffect(() => {
    fetchCases(true);
  }, [offset, priorityFilter, statusFilter, viewMode]);

  // Load detailed case dossier when selection changes
  useEffect(() => {
    if (!selectedCaseId) {
      setSelectedCase(null);
      setAuditResult(null);
      return;
    }

    setAuditResult(null);
    api
      .caseDetail(selectedCaseId)
      .then((data) => setSelectedCase(data))
      .catch((err) => {
        showToast(`Failed to load case detail: ${err.message}`, true);
      });
  }, [selectedCaseId]);

  // Actions
  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchCases(true);
  };

  const handleReplayScenario = async () => {
    if (!selectedScenarioId) return;
    setIsReplayingScenario(true);
    try {
      const res = await api.replayScenario(selectedScenarioId);
      setLatestRunId(res.run_id || null);
      setViewMode(res.case_count > 0 ? "run" : "all");
      setOffset(0);
      setPriorityFilter("");
      setStatusFilter("");
      showToast(
        `Replayed ${res.scenario_id}: ${res.transaction_count} txs → ${res.case_count} case(s).`
      );
      await fetchCases(false);
      if (res.cases && res.cases.length > 0) {
        setSelectedCaseId(res.cases[0].case_id);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Replay failed", true);
    } finally {
      setIsReplayingScenario(false);
    }
  };

  const handleReplayAll = async () => {
    setIsReplayingAll(true);
    try {
      const res = await api.replayAll();
      setLatestRunId(null);
      setViewMode("all");
      setOffset(0);
      setPriorityFilter("");
      setStatusFilter("");
      showToast(
        `Replayed all 14 scenarios: ${res.transaction_count} txs → ${res.case_count} cases.`
      );
      await fetchCases(false);
      if (res.cases && res.cases.length > 0) {
        setSelectedCaseId(res.cases[0].case_id);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Replay-all failed", true);
    } finally {
      setIsReplayingAll(false);
    }
  };

  const handleImportSuccess = async (result: ImportResponse) => {
    setLatestRunId(result.run_id || null);
    setViewMode(result.case_count > 0 ? "run" : "all");
    setOffset(0);
    setPriorityFilter("");
    setStatusFilter("");
    showToast(
      `Imported ${result.transaction_count} rows → generated ${result.case_count} case(s).`
    );
    await fetchCases(false);
    if (result.cases && result.cases.length > 0) {
      setSelectedCaseId(result.cases[0].case_id);
    }
  };

  const handleUpdateReview = async (body: {
    status: CaseStatus;
    outcome?: ReviewOutcome | null;
    reviewer: string;
    note: string;
  }) => {
    if (!selectedCaseId) return;
    setIsSavingReview(true);
    try {
      const updated = await api.updateReview(selectedCaseId, body);
      setSelectedCase(updated);
      showToast("Case review recorded and appended to audit chain.");
      await fetchCases(true);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Review update failed", true);
    } finally {
      setIsSavingReview(false);
    }
  };

  const handleVerifyAudit = async () => {
    if (!selectedCaseId) return;
    setIsVerifyingAudit(true);
    try {
      const res = await api.audit(selectedCaseId);
      setAuditResult(res);
      showToast(
        res.valid
          ? `Audit chain valid: ${res.event_count} events verified.`
          : `Audit chain integrity mismatch!`,
        !res.valid
      );
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Audit verification failed", true);
    } finally {
      setIsVerifyingAudit(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#080a10] text-zinc-100 select-none">
      {/* Top Command Bar */}
      <CommandBar
        cases={cases}
        totalCases={total}
        apiConnected={apiConnected}
        onOpenImport={() => setIsImportOpen(true)}
        onReplayAll={handleReplayAll}
        isReplayingAll={isReplayingAll}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />

      {/* Main Investigation Split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Triage Queue Rail */}
        <TriageQueue
          cases={cases}
          selectedCaseId={selectedCaseId}
          onSelectCase={(id) => setSelectedCaseId(id)}
          priorityFilter={priorityFilter}
          onPriorityFilterChange={(p) => {
            setPriorityFilter(p);
            setOffset(0);
          }}
          statusFilter={statusFilter}
          onStatusFilterChange={(s) => {
            setStatusFilter(s);
            setOffset(0);
          }}
          viewMode={viewMode}
          onViewModeChange={(m) => {
            setViewMode(m);
            setOffset(0);
          }}
          hasLatestRun={!!latestRunId}
          total={total}
          offset={offset}
          pageSize={pageSize}
          onPageChange={(newOffset) => setOffset(newOffset)}
          scenarios={scenarios}
          selectedScenarioId={selectedScenarioId}
          onScenarioSelect={(id) => setSelectedScenarioId(id)}
          onReplayScenario={handleReplayScenario}
          isReplayingScenario={isReplayingScenario}
          onReplayAll={handleReplayAll}
          isReplayingAll={isReplayingAll}
          isLoading={isLoadingCases}
        />

        {/* Center / Right Workspace */}
        {selectedCase ? (
          <main className="flex-1 flex overflow-hidden">
            {/* Center: Graph Theater (Hero) + Bottom Transaction Timeline */}
            <div className="flex-1 flex flex-col min-w-0 border-r border-white/[0.08]">
              <div className="flex-1 relative min-h-[300px]">
                <GraphTheater
                  caseData={selectedCase}
                  hoveredTransactionId={hoveredTransactionId}
                  onHoverTransaction={(txId) => setHoveredTransactionId(txId)}
                />
              </div>

              {/* Bottom Transaction Timeline Drawer */}
              <TransactionTimeline
                caseData={selectedCase}
                hoveredTransactionId={hoveredTransactionId}
                onHoverTransaction={(txId) => setHoveredTransactionId(txId)}
              />
            </div>

            {/* Right: Evidence & Review Inspector */}
            <EvidenceInspector
              caseData={selectedCase}
              onUpdateReview={handleUpdateReview}
              isSavingReview={isSavingReview}
              onVerifyAudit={handleVerifyAudit}
              auditResult={auditResult}
              isVerifyingAudit={isVerifyingAudit}
            />
          </main>
        ) : (
          /* Cozy Executive Workbench Empty State */
          <div className="relative flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#090b11] bg-grid-ambient overflow-hidden">
            <div className="relative z-10 flex flex-col items-center max-w-xl px-4">
              {/* Cozy Header Icon */}
              <div className="relative mb-6">
                <div className="absolute -inset-2 bg-indigo-500/15 rounded-3xl blur-xl" />
                <div className="relative h-16 w-16 rounded-2xl bg-[#121624] border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-xl">
                  <ShieldCheck className="h-8 w-8 text-indigo-400" />
                </div>
              </div>

              <h2 className="text-xl font-bold tracking-tight text-white font-sans">
                Investigation Workbench
              </h2>

              <p className="text-xs text-zinc-400 mt-2.5 max-w-md leading-relaxed font-sans">
                Select an investigation lead from the triage queue on the left to examine the connected money flow graph, evaluate contextual evidence, and log decisions.
              </p>

              {/* Quick Action Buttons */}
              <div className="flex items-center gap-3 mt-6">
                <button
                  type="button"
                  onClick={handleReplayAll}
                  disabled={isReplayingAll}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-2 transition-all active:scale-95 shadow-sm"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>{isReplayingAll ? "Replaying 14 Fixtures…" : "Replay Synthetic Scenarios"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsImportOpen(true)}
                  className="px-4 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1] text-zinc-200 font-semibold text-xs flex items-center gap-2 transition-all active:scale-95"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>Import CSV File</span>
                </button>
              </div>

              {/* 3 Executive Pillars */}
              <div className="grid grid-cols-3 gap-3.5 mt-8 w-full text-left">
                <div className="p-3.5 rounded-2xl bg-[#111420]/80 border border-white/[0.06] backdrop-blur-sm">
                  <div className="flex items-center gap-2 text-indigo-400 mb-1.5">
                    <Network className="h-4 w-4" />
                    <span className="text-xs font-semibold text-zinc-200">Account Graph</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug">
                    Concentric layout separating trigger and context transaction paths.
                  </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-[#111420]/80 border border-white/[0.06] backdrop-blur-sm">
                  <div className="flex items-center gap-2 text-amber-400 mb-1.5">
                    <Sparkles className="h-4 w-4" />
                    <span className="text-xs font-semibold text-zinc-200">Evidence Triage</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug">
                    Deterministic rule signals, baseline context, and explicit disclosures.
                  </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-[#111420]/80 border border-white/[0.06] backdrop-blur-sm">
                  <div className="flex items-center gap-2 text-emerald-400 mb-1.5">
                    <Lock className="h-4 w-4" />
                    <span className="text-xs font-semibold text-zinc-200">Audit Ledger</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug">
                    Cryptographic SHA-256 chain ensuring tamper-evident review trails.
                  </p>
                </div>
              </div>

              {/* Bottom Disclosures */}
              <div className="flex items-center gap-2 text-[11px] font-sans text-zinc-500 mt-7 pt-5 border-t border-white/[0.06]">
                <ShieldCheck className="h-3.5 w-3.5 text-zinc-500" />
                <span>Decision support prototype · Rules-only triage · Evaluation unconfigured</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Status Strip */}
      <StatusStrip
        totalCases={total}
        visibleCases={cases.length}
        latestRunId={latestRunId}
      />

      {/* CSV Import Modal */}
      <CsvImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImportSuccess={handleImportSuccess}
        onUploadFile={(file) => api.importCsv(file)}
      />

      {/* Toast Feedback Notification */}
      {toast && (
        <div
          className={`fixed bottom-12 right-6 z-50 px-4 py-2.5 rounded-xl border text-xs font-sans shadow-2xl backdrop-blur-md transition-all ${
            toast.isError
              ? "bg-rose-950/95 border-rose-500/40 text-rose-200"
              : "bg-[#141826]/95 border-indigo-500/40 text-indigo-200"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;
