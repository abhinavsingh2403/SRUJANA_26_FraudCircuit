import React, { useState } from "react";
import { ChevronDown, ChevronUp, Table, Clock } from "lucide-react";
import type { CaseRecord, Transaction } from "../types/domain";
import { formatAmount } from "../lib/utils";

interface TransactionTimelineProps {
  caseData: CaseRecord;
  hoveredTransactionId: string | null;
  onHoverTransaction: (txId: string | null) => void;
}

export const TransactionTimeline: React.FC<TransactionTimelineProps> = ({
  caseData,
  hoveredTransactionId,
  onHoverTransaction,
}) => {
  const [isOpen, setIsOpen] = useState(true);

  // Group and sort all unique transactions chronologically
  const txMap = new Map<string, Transaction>();
  [...(caseData.context_transactions || []), ...(caseData.trigger_transactions || [])].forEach((tx) => {
    if (tx && tx.transaction_id) txMap.set(tx.transaction_id, tx);
  });

  const transactions = Array.from(txMap.values()).sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp) || a.transaction_id.localeCompare(b.transaction_id)
  );

  const triggerSet = new Set(caseData.transaction_ids || []);

  return (
    <div className="border-t border-white/[0.08] bg-[#09090d] flex flex-col transition-all">
      {/* Drawer Toggle Header */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="h-8 px-4 flex items-center justify-between cursor-pointer hover:bg-white/[0.02] select-none text-xs font-mono border-b border-white/[0.04]"
      >
        <div className="flex items-center gap-2 text-zinc-300">
          <Table className="h-3.5 w-3.5 text-indigo-400" />
          <span className="font-bold">TRANSACTION TIMELINE</span>
          <span className="text-[10px] text-zinc-500">
            ({transactions.length} rows · {caseData.counts.trigger_transactions_total} triggers)
          </span>
        </div>

        <div className="flex items-center gap-1 text-zinc-400 text-[11px]">
          <span>{isOpen ? "Collapse" : "Expand"}</span>
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </div>
      </div>

      {/* Table Content */}
      {isOpen && (
        <div className="max-h-52 overflow-y-auto">
          <table className="w-full text-left text-xs font-mono border-collapse">
            <thead className="sticky top-0 bg-[#0c0d12] text-zinc-500 text-[10px] border-b border-white/[0.06] select-none">
              <tr>
                <th className="py-2 px-3 font-semibold">ROLE</th>
                <th className="py-2 px-3 font-semibold">TX ID / TYPE</th>
                <th className="py-2 px-3 font-semibold flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>TIME (UTC)</span>
                </th>
                <th className="py-2 px-3 font-semibold">FLOW (SENDER → RECIPIENT)</th>
                <th className="py-2 px-3 font-semibold text-right">AMOUNT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04] text-[11px]">
              {transactions.map((tx) => {
                const isTrigger = triggerSet.has(tx.transaction_id);
                const isHovered = hoveredTransactionId === tx.transaction_id;

                return (
                  <tr
                    key={tx.transaction_id}
                    onMouseEnter={() => onHoverTransaction(tx.transaction_id)}
                    onMouseLeave={() => onHoverTransaction(null)}
                    className={`transition-colors cursor-pointer ${
                      isHovered
                        ? "bg-indigo-500/10 text-white"
                        : "hover:bg-white/[0.02] text-zinc-300"
                    }`}
                  >
                    <td className="py-1.5 px-3 whitespace-nowrap">
                      {isTrigger ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                          TRIGGER
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">
                          CONTEXT
                        </span>
                      )}
                    </td>

                    <td className="py-1.5 px-3 whitespace-nowrap">
                      <span className="text-zinc-200 font-semibold">{tx.transaction_id}</span>
                      <span className="text-[9px] text-zinc-500 block">
                        {tx.transaction_type || "TRANSFER"}
                      </span>
                    </td>

                    <td className="py-1.5 px-3 whitespace-nowrap text-zinc-400 text-[10px]">
                      {tx.timestamp}
                    </td>

                    <td className="py-1.5 px-3 whitespace-nowrap">
                      <span className="text-zinc-300">{tx.sender_id}</span>
                      <span className="text-indigo-400 mx-1.5 font-bold">→</span>
                      <span className="text-zinc-300">{tx.recipient_id}</span>
                    </td>

                    <td className="py-1.5 px-3 whitespace-nowrap text-right font-bold text-zinc-100">
                      {formatAmount(tx.amount, tx.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
