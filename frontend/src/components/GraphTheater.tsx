import React, { useEffect, useRef, useState } from "react";
import cytoscape, { type Core, type EventObject } from "cytoscape";
import { Maximize2, ZoomIn, ZoomOut, AlertTriangle, Network, RotateCcw } from "lucide-react";
import type { CaseRecord, Transaction } from "../types/domain";
import { formatAmount, formatTimestamp } from "../lib/utils";

interface GraphTheaterProps {
  caseData: CaseRecord;
  hoveredTransactionId: string | null;
  onHoverTransaction: (txId: string | null) => void;
}

interface TooltipData {
  visible: boolean;
  x: number;
  y: number;
  title: string;
  subtitle: string;
  meta: string[];
  isTrigger?: boolean;
}

export const GraphTheater: React.FC<GraphTheaterProps> = ({
  caseData,
  hoveredTransactionId,
  onHoverTransaction,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData>({
    visible: false,
    x: 0,
    y: 0,
    title: "",
    subtitle: "",
    meta: [],
  });

  // Collect all unique transactions
  const allTxs: Transaction[] = [
    ...(caseData.context_transactions || []),
    ...(caseData.trigger_transactions || []),
  ];
  const triggerSet = new Set(caseData.transaction_ids || []);

  useEffect(() => {
    if (!containerRef.current) return;

    // Build unique accounts from transactions (commit 1de1b9f bound)
    const accountIds = Array.from(
      new Set(allTxs.flatMap((tx) => [tx.sender_id, tx.recipient_id]).filter(Boolean))
    ).slice(0, 30);

    const elements: cytoscape.ElementDefinition[] = [];

    // Nodes (exact alignment & labels from commit 1de1b9f)
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

    // Edges (exact original connections)
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

    // Cytoscape initialization with commit 1de1b9f layout alignment
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: "node",
          style: {
            shape: "ellipse",
            "background-color": "#1e293b",
            "border-color": "#6d80f5",
            "border-width": 2,
            width: 32,
            height: 32,
            label: "data(label)",
            color: "#94a3b8",
            "font-size": "10px",
            "font-family": "'JetBrains Mono', monospace",
            "text-valign": "bottom",
            "text-margin-y": 6,
            "text-background-opacity": 0,
            "transition-property": "background-color, border-color, shadow-blur",
            "transition-duration": 0.2,
          },
        },
        {
          selector: "node:hover",
          style: {
            shape: "ellipse",
            "background-color": "#334155",
            "border-color": "#818cf8",
            "border-width": 3,
            color: "#f8fafc",
            width: 34,
            height: 34,
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
          selector: "edge.highlighted",
          style: {
            "line-color": "#818cf8 !important",
            "target-arrow-color": "#818cf8 !important",
            width: 4,
            opacity: 1,
          },
        },
        {
          selector: "node.highlighted",
          style: {
            shape: "ellipse",
            width: 34,
            height: 34,
            "border-color": "#818cf8",
            "border-width": 3,
            color: "#f8fafc",
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
    cy.fit(undefined, 40);

    // Non-blocking side tooltip position helper
    const calculateSidePosition = (pos: { x: number; y: number }) => {
      const containerWidth = containerRef.current?.clientWidth || 700;
      const isRightSide = pos.x > containerWidth * 0.55;
      return {
        x: isRightSide ? Math.max(10, pos.x - 260) : pos.x + 35,
        y: Math.max(15, pos.y - 45),
      };
    };

    // Node hover
    cy.on("mouseover", "node", (evt: EventObject) => {
      const node = evt.target;
      const pos = node.renderedPosition();
      const sidePos = calculateSidePosition(pos);
      setTooltip({
        visible: true,
        x: sidePos.x,
        y: sidePos.y,
        title: node.data("fullId") || node.data("id"),
        subtitle: "Connected Account",
        meta: [`Connected in Case: ${caseData.case_id}`, "Click to isolate account flow"],
      });
    });

    cy.on("mouseout", "node", () => {
      setTooltip((prev) => ({ ...prev, visible: false }));
    });

    // Node click to isolate neighborhood
    cy.on("click", "node", (evt: EventObject) => {
      const node = evt.target;
      const neighborhood = node.neighborhood().add(node);
      cy.elements().removeClass("dimmed").removeClass("highlighted");
      cy.elements().difference(neighborhood).addClass("dimmed");
      neighborhood.addClass("highlighted");
    });

    cy.on("click", (evt: EventObject) => {
      if (evt.target === cy) {
        cy.elements().removeClass("dimmed").removeClass("highlighted");
      }
    });

    // Edge hover
    cy.on("mouseover", "edge", (evt: EventObject) => {
      const edge = evt.target;
      const data = edge.data();
      const pos = edge.renderedMidpoint();
      const sidePos = calculateSidePosition(pos);
      onHoverTransaction(data.id);
      setTooltip({
        visible: true,
        x: sidePos.x,
        y: sidePos.y,
        title: `${data.source} → ${data.target}`,
        subtitle: data.isTrigger ? "Trigger Transaction" : "Context Transaction",
        meta: [
          `Amount: ${formatAmount(data.amount, data.currency)}`,
          `Time: ${formatTimestamp(data.timestamp)}`,
          `Tx ID: ${data.id}`,
        ],
        isTrigger: data.isTrigger,
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

  // Synchronize timeline row hover with graph edge highlight
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    if (hoveredTransactionId) {
      cy.elements().addClass("dimmed");
      const targetEdge = cy.getElementById(hoveredTransactionId);
      targetEdge.removeClass("dimmed").addClass("highlighted");
      targetEdge.connectedNodes().removeClass("dimmed").addClass("highlighted");
    } else {
      cy.elements().removeClass("dimmed").removeClass("highlighted");
    }
  }, [hoveredTransactionId]);

  const handleZoomIn = () => cyRef.current?.zoom(cyRef.current.zoom() * 1.25);
  const handleZoomOut = () => cyRef.current?.zoom(cyRef.current.zoom() * 0.8);
  const handleFit = () => cyRef.current?.fit(undefined, 40);
  const handleReset = () => {
    if (!cyRef.current) return;
    cyRef.current.elements().removeClass("dimmed").removeClass("highlighted");
    handleFit();
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-[#090b11] bg-grid-ambient overflow-hidden select-none">
      {/* Top Meta Bar */}
      <div className="absolute top-3.5 left-4 right-4 z-10 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2.5 pointer-events-auto">
          <div className="px-3 py-1.5 rounded-xl bg-[#0e121d]/90 backdrop-blur-md border border-white/[0.08] text-xs font-sans text-zinc-300 flex items-center gap-2 shadow-sm">
            <Network className="h-3.5 w-3.5 text-indigo-400" />
            <span className="font-semibold text-zinc-200">Account Network Topology</span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-400 font-mono text-[11px]">
              {caseData.counts.account_ids_total} Accounts · {allTxs.length} Edges
            </span>
          </div>

          {caseData.truncation?.account_ids && (
            <span className="px-2.5 py-1.5 rounded-xl bg-amber-500/10 backdrop-blur-md border border-amber-500/30 text-[11px] font-sans text-amber-300 flex items-center gap-1.5 shadow-sm">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              <span>Bounded: Showing {caseData.account_ids.length} of {caseData.counts.account_ids_total}</span>
            </span>
          )}
        </div>

        {/* Viewport Action Controls */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0e121d]/90 backdrop-blur-md border border-white/[0.08] pointer-events-auto shadow-sm">
          <button
            type="button"
            onClick={handleZoomIn}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-all active:scale-95"
            title="Zoom In"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-all active:scale-95"
            title="Zoom Out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleFit}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-all active:scale-95"
            title="Fit to Center"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-all active:scale-95"
            title="Reset Isolation"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main Cytoscape Canvas */}
      <div ref={containerRef} className="cytoscape-container flex-1" />

      {/* Side-Docked Non-Blocking Tooltip Card */}
      {tooltip.visible && (
        <div
          className="absolute z-30 pointer-events-none px-3.5 py-2.5 rounded-2xl bg-[#111522]/95 border border-white/10 shadow-2xl backdrop-blur-xl text-xs font-sans transition-all duration-150 max-w-[250px]"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            {tooltip.isTrigger && <span className="h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]" />}
            <span className="font-semibold text-zinc-100 truncate">{tooltip.title}</span>
          </div>
          <div className="text-[11px] text-zinc-400 mb-1.5">{tooltip.subtitle}</div>
          <div className="space-y-0.5 font-mono text-[10px] text-zinc-300">
            {tooltip.meta.map((m, idx) => (
              <div key={idx}>{m}</div>
            ))}
          </div>
        </div>
      )}

      {/* Minimal Legend */}
      <div className="absolute bottom-3.5 left-4 z-10 flex items-center gap-3 px-3.5 py-1.5 rounded-full bg-[#0e121d]/90 backdrop-blur-md border border-white/[0.08] text-[11px] font-sans text-zinc-400 shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.5)]" />
          <span className="text-zinc-200 font-medium">Trigger Flow</span>
        </div>
        <span className="text-zinc-700">·</span>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-slate-500" />
          <span>Context Flow</span>
        </div>
        <span className="text-zinc-700">·</span>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-indigo-400 shadow-[0_0_6px_rgba(129,140,248,0.5)]" />
          <span>Account Node</span>
        </div>
      </div>
    </div>
  );
};
