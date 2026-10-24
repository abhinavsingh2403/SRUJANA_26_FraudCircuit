import React, { useState } from "react";
import {
  ShieldCheck,
  AlertOctagon,
  Info,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { CaseRecord, CaseStatus, ReviewOutcome, Evidence } from "../types/domain";

interface EvidenceInspectorProps {
  caseData: CaseRecord;
  onUpdateReview: (body: {
    status: CaseStatus;
    outcome?: ReviewOutcome | null;
    reviewer: string;
    note: string;
  }) => Promise<void>;
  isSavingReview: boolean;
  onVerifyAudit: () => Promise<void>;
  auditResult: { valid: boolean; event_count: number; warning?: string } | null;
  isVerifyingAudit: boolean;
}

export const EvidenceInspector: React.FC<EvidenceInspectorProps> = ({
  caseData,
  onUpdateReview,
  isSavingReview,
  onVerifyAudit,
  auditResult,
  isVerifyingAudit,
}) => {
  const [reviewStatus, setReviewStatus] = useState<CaseStatus>(caseData.status);
  const [reviewOutcome, setReviewOutcome] = useState<ReviewOutcome | "">(
    caseData.review_outcome || ""
  );
  const [reviewer, setReviewer] = useState("analyst");
  const [note, setNote] = useState("");
  const [expandedEvidence, setExpandedEvidence] = useState<Record<string, boolean>>({});

  const toggleEvidence = (id: string) => {
    setExpandedEvidence((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleStatusChange = (newStatus: CaseStatus) => {
    setReviewStatus(newStatus);
    if (newStatus !== "CLOSED") {
      setReviewOutcome("");
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateReview({
      status: reviewStatus,
      outcome: reviewStatus === "CLOSED" && reviewOutcome ? reviewOutcome : null,
      reviewer: reviewer.trim() || "analyst",
      note: note.trim(),
    });
    setNote("");
  };

  const ruleSignals = caseData.evidence.filter((e) => e.kind === "RULE_SIGNAL");
  const contextSignals = caseData.evidence.filter((e) => e.kind === "CONTEXT_SIGNAL");
  const coverageSignals = caseData.evidence.filter((e) => e.kind === "COVERAGE_LIMITATION");

  return (
    <aside className="w-80 sm:w-96 flex-shrink-0 border-l border-white/[0.08] bg-[#0a0a0f] flex flex-col h-[calc(100vh-3.5rem-2rem)] overflow-y-auto">
      {/* Case Header Banner */}
      <div className="p-4 border-b border-white/[0.06] bg-[#0d0e14]">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[10px] font-mono tracking-widest text-indigo-400 font-bold uppercase">
            // CASE DOSSIER
          </span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono ${
              caseData.priority === "HIGH"
                ? "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                : caseData.priority === "MEDIUM"
                ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                : "bg-slate-500/10 text-slate-300 border border-slate-500/30"
            }`}
          >
            {caseData.priority} PRIORITY
          </span>
        </div>

        <h2 className="font-mono text-sm font-bold text-zinc-100 truncate">
          {caseData.case_id}
        </h2>
        <div className="text-[11px] text-zinc-400 mt-0.5">
          Origin: <span className="text-zinc-300">{caseData.source_scenario_id || "CSV import"}</span>
        </div>

        {/* 3 Metrics Chips */}
        <div className="grid grid-cols-3 gap-1.5 mt-3">
          <div className="p-2 rounded-lg bg-zinc-900/60 border border-white/[0.06] text-center">
            <span className="block text-[9px] font-mono text-zinc-500 uppercase">Triggers</span>
            <span className="block text-sm font-bold font-mono text-zinc-100 mt-0.5">
              {caseData.counts.trigger_transactions_total}
            </span>
          </div>
          <div className="p-2 rounded-lg bg-zinc-900/60 border border-white/[0.06] text-center">
            <span className="block text-[9px] font-mono text-zinc-500 uppercase">Accounts</span>
            <span className="block text-sm font-bold font-mono text-zinc-100 mt-0.5">
              {caseData.counts.account_ids_total}
            </span>
          </div>
          <div className="p-2 rounded-lg bg-zinc-900/60 border border-white/[0.06] text-center">
            <span className="block text-[9px] font-mono text-zinc-500 uppercase">Evidence</span>
            <span className="block text-sm font-bold font-mono text-zinc-100 mt-0.5">
              {caseData.counts.evidence_total}
            </span>
          </div>
        </div>
      </div>

      {/* Case Summary */}
      <div className="p-3.5 border-b border-white/[0.06] bg-[#0c0d12]">
        <div className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider mb-1 flex items-center gap-1">
          <FileText className="h-3 w-3 text-indigo-400" />
          <span>INVESTIGATION LEAD SUMMARY</span>
        </div>
        <p className="text-xs text-zinc-300 leading-relaxed font-sans">
          {caseData.summary}
        </p>
      </div>

      {/* Categorized Evidence Sections */}
      <div className="p-3.5 space-y-4 flex-1">
        {/* 1. Risk Signals */}
        {ruleSignals.length > 0 && (
          <div>
            <div className="text-[10px] font-mono tracking-wider text-rose-400 uppercase font-bold flex items-center justify-between mb-2">
              <span className="flex items-center gap-1.5">
                <AlertOctagon className="h-3.5 w-3.5 text-rose-400" />
                RISK SIGNALS ({ruleSignals.length})
              </span>
              <span className="text-[9px] text-zinc-500 font-normal">Actionable Leads</span>
            </div>

            <div className="space-y-2">
              {ruleSignals.map((ev) => (
                <EvidenceCard
                  key={ev.evidence_id}
                  evidence={ev}
                  isExpanded={!!expandedEvidence[ev.evidence_id]}
                  onToggle={() => toggleEvidence(ev.evidence_id)}
                  accent="rose"
                />
              ))}
            </div>
          </div>
        )}

        {/* 2. Context Signals */}
        {contextSignals.length > 0 && (
          <div>
            <div className="text-[10px] font-mono tracking-wider text-indigo-400 uppercase font-bold flex items-center justify-between mb-2">
              <span className="flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-indigo-400" />
                CONTEXT SIGNALS ({contextSignals.length})
              </span>
              <span className="text-[9px] text-zinc-500 font-normal">Non-Suppressive</span>
            </div>

            <div className="space-y-2">
              {contextSignals.map((ev) => (
                <EvidenceCard
                  key={ev.evidence_id}
                  evidence={ev}
                  isExpanded={!!expandedEvidence[ev.evidence_id]}
                  onToggle={() => toggleEvidence(ev.evidence_id)}
                  accent="indigo"
                />
              ))}
            </div>
          </div>
        )}

        {/* 3. Coverage Limitations */}
        {coverageSignals.length > 0 && (
          <div>
            <div className="text-[10px] font-mono tracking-wider text-zinc-400 uppercase font-bold flex items-center justify-between mb-2">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-zinc-400" />
                COVERAGE LIMITATIONS ({coverageSignals.length})
              </span>
              <span className="text-[9px] text-zinc-500 font-normal">Not Fraud Rules</span>
            </div>

            <div className="space-y-2">
              {coverageSignals.map((ev) => (
                <EvidenceCard
                  key={ev.evidence_id}
                  evidence={ev}
                  isExpanded={!!expandedEvidence[ev.evidence_id]}
                  onToggle={() => toggleEvidence(ev.evidence_id)}
                  accent="zinc"
                />
              ))}
            </div>
          </div>
        )}

        {/* Explicit Limitations Box */}
        {caseData.limitations.length > 0 && (
          <div className="p-3 rounded-lg bg-zinc-950/60 border border-white/[0.06] text-[11px] space-y-1.5">
            <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase block">
              // LIMITATIONS & DISCLOSURES
            </span>
            <ul className="list-disc list-inside space-y-1 text-zinc-400 text-[10px] leading-relaxed">
              {caseData.limitations.map((limit, idx) => (
                <li key={idx}>{limit}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Review Workflow Form */}
        <div className="p-3.5 rounded-xl bg-[#0f1117] border border-white/[0.08] space-y-3">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
            <span className="text-xs font-bold font-mono tracking-wider text-zinc-200 uppercase">
              ANALYST WORKFLOW
            </span>
            <span className="text-[9px] font-mono text-zinc-500">HUMAN IN THE LOOP</span>
          </div>

          <form onSubmit={handleSubmitReview} className="space-y-2.5 text-xs">
            {/* Status Select */}
            <div>
              <label className="block text-[10px] font-mono text-zinc-400 uppercase mb-1">
                Workflow Status
              </label>
              <select
                value={reviewStatus}
                onChange={(e) => handleStatusChange(e.target.value as CaseStatus)}
                className="w-full h-8 px-2.5 rounded-lg bg-zinc-900 border border-white/[0.08] text-zinc-200 text-xs focus:outline-none focus:border-indigo-500 font-mono"
              >
                <option value="OPEN">OPEN (Under Triage)</option>
                <option value="INVESTIGATING">INVESTIGATING (In Progress)</option>
                <option value="ESCALATED">ESCALATED (Compliance Lead)</option>
                <option value="CLOSED">CLOSED (Resolved)</option>
              </select>
            </div>

            {/* Outcome Select (Conditional: Only active if CLOSED) */}
            <div>
              <label className="block text-[10px] font-mono text-zinc-400 uppercase mb-1">
                Outcome Label {reviewStatus !== "CLOSED" && "(Requires Closed Status)"}
              </label>
              <select
                disabled={reviewStatus !== "CLOSED"}
                value={reviewOutcome}
                onChange={(e) => setReviewOutcome(e.target.value as ReviewOutcome)}
                required={reviewStatus === "CLOSED"}
                className={`w-full h-8 px-2.5 rounded-lg border text-xs focus:outline-none font-mono transition-all ${
                  reviewStatus === "CLOSED"
                    ? "bg-zinc-900 border-indigo-500/40 text-indigo-300"
                    : "bg-zinc-950/40 border-white/[0.04] text-zinc-600 cursor-not-allowed"
                }`}
              >
                <option value="">Choose Outcome…</option>
                <option value="CONFIRMED_SUSPICIOUS">CONFIRMED_SUSPICIOUS</option>
                <option value="FALSE_POSITIVE">FALSE_POSITIVE</option>
                <option value="INCONCLUSIVE">INCONCLUSIVE</option>
              </select>
            </div>

            {/* Reviewer Field */}
            <div>
              <label className="block text-[10px] font-mono text-zinc-400 uppercase mb-1">
                Reviewer Callout
              </label>
              <input
                type="text"
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                maxLength={100}
                required
                className="w-full h-8 px-2.5 rounded-lg bg-zinc-900 border border-white/[0.08] text-zinc-200 text-xs focus:outline-none focus:border-indigo-500 font-mono"
                placeholder="analyst_handle"
              />
            </div>

            {/* Note Field */}
            <div>
              <label className="block text-[10px] font-mono text-zinc-400 uppercase mb-1">
                Investigation Findings Note
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                rows={2}
                className="w-full p-2 rounded-lg bg-zinc-900 border border-white/[0.08] text-zinc-200 text-xs focus:outline-none focus:border-indigo-500 font-sans resize-none"
                placeholder="Record reasoning; omit sensitive personal data…"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={isSavingReview}
                className="flex-1 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {isSavingReview ? "Recording…" : "Save Review"}
              </button>

              <button
                type="button"
                onClick={onVerifyAudit}
                disabled={isVerifyingAudit}
                className="h-8 px-3 rounded-lg border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.06] text-zinc-300 font-mono text-xs flex items-center gap-1.5 transition-all active:scale-[0.98] disabled:opacity-50"
                title="Verify cryptographic SHA-256 chain integrity"
              >
                <Clock className="h-3.5 w-3.5 text-cyan-400" />
                <span>{isVerifyingAudit ? "Checking…" : "Audit"}</span>
              </button>
            </div>
          </form>

          {/* Cryptographic Audit Result Pill */}
          {auditResult && (
            <div
              className={`p-2.5 rounded-lg border text-xs font-mono flex items-start gap-2 ${
                auditResult.valid
                  ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300"
                  : "bg-rose-500/10 border-rose-500/30 text-rose-300"
              }`}
            >
              {auditResult.valid ? (
                <CheckCircle2 className="h-4 w-4 text-cyan-400 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-4 w-4 text-rose-400 flex-shrink-0 mt-0.5" />
              )}
              <div className="text-[11px] leading-tight">
                <span className="font-bold">
                  Chain {auditResult.valid ? "VALID" : "INVALID"} ({auditResult.event_count} events)
                </span>
                <p className="text-[10px] text-zinc-400 mt-1">
                  {auditResult.warning || "Tamper-evident chain verification."}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Chronological Review History Ledger */}
        {caseData.review_history && caseData.review_history.length > 0 && (
          <div className="p-3 rounded-xl bg-zinc-950/60 border border-white/[0.06] space-y-2">
            <span className="text-[10px] font-mono tracking-wider uppercase text-zinc-400 font-bold block">
              // AUDIT EVENT CHAIN ({caseData.review_history.length})
            </span>
            <div className="space-y-2">
              {caseData.review_history.map((event) => (
                <div
                  key={event.id}
                  className="p-2 rounded bg-zinc-900/60 border border-white/[0.04] text-[10px] font-mono space-y-1"
                >
                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="text-indigo-400 font-bold">{event.reviewer}</span>
                    <span>{event.created_at.slice(11, 19)} UTC</span>
                  </div>
                  <div className="text-zinc-300">
                    {event.previous_status} → <span className="text-white font-bold">{event.new_status}</span>
                    {event.new_outcome && (
                      <span className="ml-1.5 text-amber-400 font-semibold">[{event.new_outcome}]</span>
                    )}
                  </div>
                  {event.note && <div className="text-zinc-400 italic">"{event.note}"</div>}
                  <div className="text-zinc-600 text-[9px] truncate">
                    Hash: {event.event_hash}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

interface EvidenceCardProps {
  evidence: Evidence;
  isExpanded: boolean;
  onToggle: () => void;
  accent: "rose" | "indigo" | "zinc";
}

const EvidenceCard: React.FC<EvidenceCardProps> = ({
  evidence,
  isExpanded,
  onToggle,
  accent,
}) => {
  const accentClasses = {
    rose: "border-l-rose-500 bg-rose-500/[0.03] text-rose-400",
    indigo: "border-l-indigo-500 bg-indigo-500/[0.03] text-indigo-400",
    zinc: "border-l-zinc-500 bg-zinc-500/[0.03] text-zinc-400",
  }[accent];

  return (
    <div
      className={`rounded-lg border border-white/[0.08] border-l-4 p-2.5 transition-all ${accentClasses}`}
    >
      <div
        onClick={onToggle}
        className="cursor-pointer flex items-start justify-between gap-2"
      >
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] font-bold text-zinc-200">
              {evidence.rule_id}
            </span>
          </div>
          <p className="text-[11px] text-zinc-300 font-medium mt-0.5 leading-snug">
            {evidence.title}
          </p>
        </div>
        <button type="button" className="text-zinc-500 hover:text-zinc-300 p-0.5">
          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      <p className="text-[10px] text-zinc-400 mt-1 leading-relaxed">
        {evidence.description}
      </p>

      {/* Expandable Observed Parameters & Caveats */}
      {isExpanded && (
        <div className="mt-2.5 pt-2 border-t border-white/[0.06] space-y-2 text-[10px] font-mono">
          {/* Key numerical observations */}
          {Object.keys(evidence.observed || {}).length > 0 && (
            <div className="bg-zinc-950/80 p-2 rounded border border-white/[0.04] space-y-1">
              <span className="text-zinc-500 block uppercase text-[9px]">// Observed Values</span>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px]">
                {Object.entries(evidence.observed).map(([key, value]) => (
                  <div key={key} className="truncate">
                    <span className="text-zinc-500">{key}: </span>
                    <span className="text-zinc-200 font-semibold">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Caveats Callout */}
          {evidence.caveats.length > 0 && (
            <div className="p-2 rounded bg-amber-500/10 border-l-2 border-amber-500/50 text-amber-300/90 text-[10px] leading-relaxed font-sans">
              {evidence.caveats.map((cav, idx) => (
                <div key={idx}>{cav}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
