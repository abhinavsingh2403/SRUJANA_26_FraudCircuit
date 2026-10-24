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
    <aside className="w-88 flex-shrink-0 border-l border-white/[0.08] bg-[#0c0e17] flex flex-col h-[calc(100vh-3.5rem-2rem)] overflow-y-auto z-20">
      {/* Dossier Header */}
      <div className="p-4 border-b border-white/[0.06] bg-[#0e111d]">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[11px] font-mono tracking-wider text-indigo-400 font-semibold uppercase">
            Case Dossier
          </span>
          <span
            className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider font-sans ${
              caseData.priority === "HIGH"
                ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                : caseData.priority === "MEDIUM"
                ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                : "bg-slate-500/15 text-slate-300 border border-slate-500/30"
            }`}
          >
            {caseData.priority} Priority
          </span>
        </div>

        <h2 className="font-mono text-sm font-semibold text-zinc-100 truncate">
          {caseData.case_id}
        </h2>
        <div className="text-xs text-zinc-400 mt-0.5">
          Origin: <span className="text-zinc-200 font-medium">{caseData.source_scenario_id || "CSV import"}</span>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-2 mt-3.5">
          <div className="p-2.5 rounded-xl bg-zinc-900/60 border border-white/[0.06] text-center">
            <span className="block text-[10px] font-sans text-zinc-500 uppercase font-medium">Triggers</span>
            <span className="block text-base font-bold font-mono text-zinc-100 mt-0.5">
              {caseData.counts.trigger_transactions_total}
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-zinc-900/60 border border-white/[0.06] text-center">
            <span className="block text-[10px] font-sans text-zinc-500 uppercase font-medium">Accounts</span>
            <span className="block text-base font-bold font-mono text-zinc-100 mt-0.5">
              {caseData.counts.account_ids_total}
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-zinc-900/60 border border-white/[0.06] text-center">
            <span className="block text-[10px] font-sans text-zinc-500 uppercase font-medium">Evidence</span>
            <span className="block text-base font-bold font-mono text-zinc-100 mt-0.5">
              {caseData.counts.evidence_total}
            </span>
          </div>
        </div>
      </div>

      {/* Case Summary */}
      <div className="p-3.5 border-b border-white/[0.06] bg-[#0e111a]">
        <div className="text-[11px] font-sans font-medium text-zinc-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-indigo-400" />
          <span>Investigation Lead Summary</span>
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
            <div className="text-xs font-sans tracking-wide text-rose-400 font-semibold flex items-center justify-between mb-2">
              <span className="flex items-center gap-1.5">
                <AlertOctagon className="h-3.5 w-3.5 text-rose-400" />
                Risk Signals ({ruleSignals.length})
              </span>
              <span className="text-[11px] text-zinc-500 font-normal">Actionable</span>
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
            <div className="text-xs font-sans tracking-wide text-indigo-400 font-semibold flex items-center justify-between mb-2">
              <span className="flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-indigo-400" />
                Context Signals ({contextSignals.length})
              </span>
              <span className="text-[11px] text-zinc-500 font-normal">Baseline</span>
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
            <div className="text-xs font-sans tracking-wide text-zinc-400 font-semibold flex items-center justify-between mb-2">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-zinc-400" />
                Coverage Limitations ({coverageSignals.length})
              </span>
              <span className="text-[11px] text-zinc-500 font-normal">Not Rules</span>
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
          <div className="p-3.5 rounded-xl bg-[#10131d] border border-white/[0.06] text-xs space-y-2">
            <span className="text-[11px] font-sans font-semibold text-zinc-400 uppercase tracking-wider block">
              Limitations & Disclosures
            </span>
            <ul className="list-disc list-inside space-y-1 text-zinc-400 text-xs leading-relaxed">
              {caseData.limitations.map((limit, idx) => (
                <li key={idx}>{limit}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Review Workflow Form */}
        <div className="p-4 rounded-2xl bg-[#111420] border border-white/[0.08] space-y-3.5 shadow-sm">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
            <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
              Analyst Workflow
            </span>
            <span className="text-[10px] font-mono text-zinc-500">Human in Loop</span>
          </div>

          <form onSubmit={handleSubmitReview} className="space-y-3 text-xs">
            {/* Status Select */}
            <div>
              <label className="block text-[11px] font-sans font-medium text-zinc-400 mb-1">
                Workflow Status
              </label>
              <select
                value={reviewStatus}
                onChange={(e) => handleStatusChange(e.target.value as CaseStatus)}
                className="w-full h-8 px-2.5 rounded-lg bg-zinc-900 border border-white/[0.08] text-zinc-200 text-xs focus:outline-none focus:border-indigo-500 font-sans cursor-pointer"
              >
                <option value="OPEN">Open (Under Review)</option>
                <option value="INVESTIGATING">Investigating (In Progress)</option>
                <option value="ESCALATED">Escalated (Compliance Lead)</option>
                <option value="CLOSED">Closed (Resolved)</option>
              </select>
            </div>

            {/* Outcome Select (Conditional: Only active if CLOSED) */}
            <div>
              <label className="block text-[11px] font-sans font-medium text-zinc-400 mb-1">
                Review Outcome {reviewStatus !== "CLOSED" && "(Requires Closed Status)"}
              </label>
              <select
                disabled={reviewStatus !== "CLOSED"}
                value={reviewOutcome}
                onChange={(e) => setReviewOutcome(e.target.value as ReviewOutcome)}
                required={reviewStatus === "CLOSED"}
                className={`w-full h-8 px-2.5 rounded-lg border text-xs focus:outline-none font-sans transition-colors ${
                  reviewStatus === "CLOSED"
                    ? "bg-zinc-900 border-indigo-500/50 text-indigo-300 cursor-pointer"
                    : "bg-zinc-950/40 border-white/[0.04] text-zinc-600 cursor-not-allowed"
                }`}
              >
                <option value="">Select Outcome…</option>
                <option value="CONFIRMED_SUSPICIOUS">Confirmed Suspicious</option>
                <option value="FALSE_POSITIVE">False Positive</option>
                <option value="INCONCLUSIVE">Inconclusive</option>
              </select>
            </div>

            {/* Reviewer Field */}
            <div>
              <label className="block text-[11px] font-sans font-medium text-zinc-400 mb-1">
                Reviewer Handle
              </label>
              <input
                type="text"
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                maxLength={100}
                required
                className="w-full h-8 px-2.5 rounded-lg bg-zinc-900 border border-white/[0.08] text-zinc-200 text-xs focus:outline-none focus:border-indigo-500 font-mono"
                placeholder="analyst_name"
              />
            </div>

            {/* Note Field */}
            <div>
              <label className="block text-[11px] font-sans font-medium text-zinc-400 mb-1">
                Investigation Notes
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                rows={2}
                className="w-full p-2.5 rounded-lg bg-zinc-900 border border-white/[0.08] text-zinc-200 text-xs focus:outline-none focus:border-indigo-500 font-sans resize-none"
                placeholder="Record reasoning; omit sensitive personal data…"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={isSavingReview}
                className="flex-1 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center transition-colors disabled:opacity-50 shadow-sm"
              >
                {isSavingReview ? "Saving…" : "Save Review"}
              </button>

              <button
                type="button"
                onClick={onVerifyAudit}
                disabled={isVerifyingAudit}
                className="h-8 px-3 rounded-lg border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 font-sans text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
                title="Verify cryptographic SHA-256 chain integrity"
              >
                <Clock className={`h-3.5 w-3.5 text-cyan-400 ${isVerifyingAudit ? "animate-spin" : ""}`} />
                <span>{isVerifyingAudit ? "Verifying…" : "Verify Chain"}</span>
              </button>
            </div>
          </form>

          {/* Cryptographic Audit Result */}
          {auditResult && (
            <div
              className={`p-3 rounded-xl border text-xs font-sans flex items-start gap-2.5 ${
                auditResult.valid
                  ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-200"
                  : "bg-rose-500/10 border-rose-500/30 text-rose-200"
              }`}
            >
              {auditResult.valid ? (
                <CheckCircle2 className="h-4 w-4 text-cyan-400 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-4 w-4 text-rose-400 flex-shrink-0 mt-0.5" />
              )}
              <div className="text-xs leading-relaxed">
                <span className="font-semibold">
                  Chain {auditResult.valid ? "Valid" : "Broken"} ({auditResult.event_count} events verified)
                </span>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  {auditResult.warning || "Tamper-evident review log verified."}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Chronological Review History Ledger */}
        {caseData.review_history && caseData.review_history.length > 0 && (
          <div className="p-3.5 rounded-2xl bg-[#10131d] border border-white/[0.06] space-y-2">
            <span className="text-[11px] font-sans font-semibold text-zinc-400 uppercase tracking-wider block">
              Review Event Chain ({caseData.review_history.length})
            </span>
            <div className="space-y-2">
              {caseData.review_history.map((event) => (
                <div
                  key={event.id}
                  className="p-2.5 rounded-xl bg-zinc-900/60 border border-white/[0.04] text-xs font-sans space-y-1"
                >
                  <div className="flex items-center justify-between text-zinc-400 text-[11px]">
                    <span className="text-indigo-400 font-semibold">{event.reviewer}</span>
                    <span className="font-mono text-[10px]">{event.created_at.slice(11, 19)} UTC</span>
                  </div>
                  <div className="text-zinc-200 text-xs">
                    {event.previous_status} → <span className="font-semibold text-white">{event.new_status}</span>
                    {event.new_outcome && (
                      <span className="ml-1.5 text-amber-400 font-medium">[{event.new_outcome}]</span>
                    )}
                  </div>
                  {event.note && <div className="text-zinc-400 italic text-[11px]">"{event.note}"</div>}
                  <div className="text-zinc-600 font-mono text-[10px] truncate">
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
    rose: "border-l-rose-500 bg-[#141624] text-rose-300",
    indigo: "border-l-indigo-500 bg-[#121624] text-indigo-300",
    zinc: "border-l-zinc-500 bg-[#12141e] text-zinc-300",
  }[accent];

  return (
    <div className={`rounded-xl border border-white/[0.08] border-l-4 p-3 transition-colors ${accentClasses}`}>
      <div
        onClick={onToggle}
        className="cursor-pointer flex items-start justify-between gap-2"
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-zinc-200">
              {evidence.rule_id}
            </span>
          </div>
          <p className="text-xs text-zinc-200 font-medium mt-0.5 leading-snug">
            {evidence.title}
          </p>
        </div>
        <button type="button" className="text-zinc-400 hover:text-zinc-200 p-0.5">
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      <p className="text-xs text-zinc-400 mt-1 leading-relaxed font-sans">
        {evidence.description}
      </p>

      {/* Expandable Observed Parameters & Caveats */}
      {isExpanded && (
        <div className="mt-2.5 pt-2 border-t border-white/[0.06] space-y-2 text-xs">
          {/* Key numerical observations */}
          {Object.keys(evidence.observed || {}).length > 0 && (
            <div className="bg-zinc-950/80 p-2.5 rounded-lg border border-white/[0.04] space-y-1">
              <span className="text-zinc-500 block uppercase font-mono text-[10px] font-semibold">
                Observed Values
              </span>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[11px]">
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
            <div className="p-2.5 rounded-lg bg-amber-500/10 border-l-2 border-amber-500/50 text-amber-200/90 text-xs leading-relaxed font-sans">
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
