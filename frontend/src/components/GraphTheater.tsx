import React, { useEffect, useRef, useState } from "react";
import cytoscape, { type Core, type EventObject } from "cytoscape";
import { Maximize2, ZoomIn, ZoomOut, AlertTriangle, Layers } from "lucide-react";
import type { CaseRecord, Transaction } from "../types/domain";
import { formatAmount } from "../lib/utils";

interface GraphTheaterProps {
  caseData: CaseRecord;
  hoveredTransactionId: string | null;
  onHoverTransaction: (txId: string | null) => void;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  content: {
    type: "node" | "edge";
    title: string;
    details: string[];
  };
}

export const GraphTheater: React.FC<GraphTheaterProps> = ({
  caseData,
  hoveredTransactionId,
  onHoverTransaction,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    content: { type: "node", title: "", details: [] },
  });

  // Collect all unique transactions
  const allTxs: Transaction[] = [
    ...(caseData.context_transactions || []),
    ...(caseData.trigger_transactions || []),
  ];
  const triggerSet = new Set(caseData.transaction_ids || []);

  useEffect(() => {
    if (!containerRef.current) return;

    // Build unique accounts from transactions
    const accountIds = Array.from(
      new Set(allTxs.flatMap((tx) => [tx.sender_id, tx.recipient_id]).filter(Boolean))
    ).slice(0, 30); // Visualization safety bound

    const elements: cytoscape.ElementDefinition[] = [];

    // Nodes
    accountIds.forEach((acc) => {
      elements.push({
        group: "nodes",
        data: {
          id: acc,
          label: acc.length > 14 ? `${acc.slice(0, 11)}…` : acc,
          fullId: acc,
        },
      });
    });

    // Edges
    allTxs.forEach((tx) => {
      if (accountIds.includes(tx.sender_id) && accountIds.includes(tx.recipient_id)) {
        const isTrigger = triggerSet.has(tx.transaction_id);
        elements.push({
          group: "edges",
          data: {
            id: tx.transaction_id,
            source: tx.sender_id,
            target: tx.recipient_id,
            amount: tx.amount,
            currency: tx.currency,
            timestamp: tx.timestamp,
            isTrigger,
            type: tx.transaction_type || "TRANSFER",
          },
        });
      }
    });

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#1e293b",
            "border-color": "#475569",
            "border-width": 2,
            width: 32,
            height: 32,
            label: "data(label)",
            color: "#94a3b8",
            "font-size": "10px",
            "font-family": "monospace",
            "text-valign": "bottom",
            "text-margin-y": 6,
            "transition-property": "background-color, border-color, shadow-blur",
            "transition-duration": 0.2,
          },
        },
        {
          selector: "node:hover",
          style: {
            "background-color": "#334155",
            "border-color": "#818cf8",
            "border-width": 3,
            color: "#f8fafc",
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "#475569",
            "target-arrow-color": "#475569",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            opacity: 0.65,
            "arrow-scale": 0.9,
          },
        },
        {
          selector: "edge[?isTrigger]",
          style: {
            width: 2.8,
            "line-color": "#ef4444",
            "target-arrow-color": "#ef4444",
            opacity: 0.95,
          },
        },
        {
          selector: ".highlighted",
          style: {
            "line-color": "#818cf8 !important",
            "target-arrow-color": "#818cf8 !important",
            width: 4,
            opacity: 1,
          },
        },
        {
          selector: ".dimmed",
          style: {
            opacity: 0.15,
          },
        },
      ],
      layout: {
        name: "circle",
        padding: 50,
      },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
    });

    cyRef.current = cy;

    // Tooltip event handlers
    cy.on("mouseover", "node", (evt: EventObject) => {
      const node = evt.target;
      const pos = node.renderedPosition();
      setTooltip({
        visible: true,
        x: pos.x,
        y: pos.y - 40,
        content: {
          type: "node",
          title: node.data("fullId"),
          details: [`Connected in ${caseData.case_id}`],
        },
      });
    });

    cy.on("mouseout", "node", () => {
      setTooltip((prev) => ({ ...prev, visible: false }));
    });

    cy.on("mouseover", "edge", (evt: EventObject) => {
      const edge = evt.target;
      const data = edge.data();
      const pos = edge.renderedMidpoint();
      onHoverTransaction(data.id);
      setTooltip({
        visible: true,
        x: pos.x,
        y: pos.y - 50,
        content: {
          type: "edge",
          title: `${data.id} (${data.isTrigger ? "TRIGGER" : "CONTEXT"})`,
          details: [
            `${data.source} → ${data.target}`,
            `Amount: ${formatAmount(data.amount, data.currency)}`,
            `Time: ${data.timestamp}`,
          ],
        },
      });
    });

    cy.on("mouseout", "edge", () => {
      onHoverTransaction(null);
      setTooltip((prev) => ({ ...prev, visible: false }));
    });

    return () => {
      cy.destroy();
    };
  }, [caseData.case_id]);

  // Sync external hover with edge highlighting
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    if (hoveredTransactionId) {
      cy.elements().addClass("dimmed");
      const targetEdge = cy.getElementById(hoveredTransactionId);
      targetEdge.removeClass("dimmed").addClass("highlighted");
      targetEdge.connectedNodes().removeClass("dimmed");
    } else {
      cy.elements().removeClass("dimmed").removeClass("highlighted");
    }
  }, [hoveredTransactionId]);

  const handleZoomIn = () => cyRef.current?.zoom(cyRef.current.zoom() * 1.25);
  const handleZoomOut = () => cyRef.current?.zoom(cyRef.current.zoom() * 0.8);
  const handleFit = () => cyRef.current?.fit(undefined, 40);

  return (
    <div className="relative w-full h-full flex flex-col bg-[#050508] overflow-hidden select-none">
      {/* Top Overlay Strip: Graph Meta & Truncation Warnings */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          <span className="px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-md border border-white/[0.08] text-[11px] font-mono text-zinc-300 flex items-center gap-1.5 shadow-sm">
            <Layers className="h-3.5 w-3.5 text-indigo-400" />
            <span>CONNECTED ACCOUNT GRAPH</span>
          </span>

          {caseData.truncation?.account_ids && (
            <span className="px-2.5 py-1 rounded-md bg-amber-500/10 backdrop-blur-md border border-amber-500/30 text-[10px] font-mono text-amber-400 flex items-center gap-1 shadow-sm">
              <AlertTriangle className="h-3 w-3" />
              <span>Bounded: {caseData.account_ids.length} of {caseData.counts.account_ids_total} accounts</span>
            </span>
          )}
        </div>

        {/* Viewport Action Controls */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-black/60 backdrop-blur-md border border-white/[0.08] pointer-events-auto">
          <button
            type="button"
            onClick={handleZoomIn}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleFit}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
            title="Fit to Center"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main Cytoscape Canvas */}
      <div ref={containerRef} className="cytoscape-container flex-1" />

      {/* Dynamic Graph Tooltip */}
      {tooltip.visible && (
        <div
          className="absolute z-20 pointer-events-none transform -translate-x-1/2 px-3 py-2 rounded-lg bg-[#0f1117]/95 border border-white/10 shadow-xl backdrop-blur-md text-xs font-mono"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="font-bold text-zinc-200 mb-0.5">{tooltip.content.title}</div>
          {tooltip.content.details.map((detail, idx) => (
            <div key={idx} className="text-zinc-400 text-[11px]">
              {detail}
            </div>
          ))}
        </div>
      )}

      {/* Floating Bottom Legend */}
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-3 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/[0.08] text-[10px] font-mono text-zinc-400">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.6)]" />
          <span>TRIGGER FLOW</span>
        </div>
        <span className="text-zinc-600">·</span>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-slate-500" />
          <span>CONTEXT FLOW</span>
        </div>
        <span className="text-zinc-600">·</span>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-indigo-400" />
          <span>ACCOUNT NODE</span>
        </div>
      </div>
    </div>
  );
};
