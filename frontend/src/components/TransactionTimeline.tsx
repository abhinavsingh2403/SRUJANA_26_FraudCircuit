import React, { useState } from "react";
import { ChevronDown, ChevronUp, Table, Clock, ArrowRight } from "lucide-react";
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
    <div className="border-t border-white/[0.08] bg-[#0c0e17]/95 backdrop-blur-xl flex flex-col transition-all duration-300 z-10 font-sans">
      {/* Drawer Toggle Header */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="h-8 px-4 flex items-center justify-between cursor-pointer hover:bg-white/[0.03] select-none text-xs border-b border-white/[0.04] transition-colors"
      >
        <div className="flex items-center gap-2 text-zinc-300">
          <Table className="h-3.5 w-3.5 text-indigo-400" />
          <span className="font-semibold tracking-tight">Transaction Timeline</span>
          <span className="text-[11px] text-zinc-500 font-normal">
            ({transactions.length} entries · {caseData.counts.trigger_transactions_total} triggers)
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-zinc-400 text-[11px]">
          <span className="text-[10px] tracking-wider uppercase font-semibold text-zinc-500">
            {isOpen ? "Collapse" : "Expand"}
          </span>
          {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-zinc-400" /> : <ChevronUp className="h-3.5 w-3.5 text-zinc-400" />}
        </div>
      </div>

      {/* Table Content with interactive hover feedback */}
      {isOpen && (
        <div className="max-h-52 overflow-y-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 bg-[#0e111d]/95 backdrop-blur-md text-zinc-500 text-[10px] border-b border-white/[0.06] select-none z-10 font-sans">
              <tr>
                <th className="py-2 px-3 font-semibold">ROLE</th>
                <th className="py-2 px-3 font-semibold">TRANSACTION ID</th>
                <th className="py-2 px-3 font-semibold flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>TIME (UTC)</span>
                </th>
                <th className="py-2 px-3 font-semibold">COUNTERPARTY FLOW</th>
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
                    className={`transition-colors duration-150 cursor-pointer ${
                      isHovered
                        ? "bg-indigo-500/15 text-white font-medium"
                        : "hover:bg-white/[0.03] text-zinc-300"
                    }`}
                  >
                    <td className="py-2 px-3 whitespace-nowrap">
                      {isTrigger ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                          TRIGGER
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">
                          CONTEXT
                        </span>
                      )}
                    </td>

                    <td className="py-2 px-3 whitespace-nowrap font-mono text-[11px]">
                      <span className="text-zinc-200 font-semibold">{tx.transaction_id}</span>
                      <span className="text-[10px] text-zinc-500 block font-sans">
                        {tx.transaction_type || "TRANSFER"}
                      </span>
                    </td>

                    <td className="py-2 px-3 whitespace-nowrap text-zinc-400 font-mono text-[10px]">
                      {tx.timestamp}
                    </td>

                    <td className="py-2 px-3 whitespace-nowrap font-mono text-[11px]">
                      <span className="text-zinc-300">{tx.sender_id}</span>
                      <ArrowRight className="inline h-3 w-3 text-indigo-400 mx-1.5" />
                      <span className="text-zinc-300">{tx.recipient_id}</span>
                    </td>

                    <td className="py-2 px-3 whitespace-nowrap text-right font-mono font-semibold text-zinc-100 tabular-nums">
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
