import React, { useState, useRef } from "react";
import { Upload, X, FileText, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import type { ImportResponse } from "../types/domain";

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (result: ImportResponse) => void;
  onUploadFile: (file: File) => Promise<ImportResponse>;
}

export const CsvImportModal: React.FC<CsvImportModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
  onUploadFile,
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  };

  const handleFileSelected = (file: File) => {
    setErrorMsg(null);
    setResult(null);

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setErrorMsg("Invalid file format. Please upload a canonical .csv file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg("File exceeds the 5 MiB upload safety limit.");
      return;
    }
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    setErrorMsg(null);

    try {
      const resp = await onUploadFile(selectedFile);
      setResult(resp);
      onImportSuccess(resp);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "CSV import failed.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md transition-opacity duration-200">
      <div className="relative w-full max-w-lg rounded-3xl bg-[#0f121d] border border-white/10 shadow-2xl p-6 text-zinc-100 overflow-hidden">
        {/* Subtle top glow highlight */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent" />

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Upload className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-tight">Import Canonical CSV</h3>
              <p className="text-[11px] text-zinc-400 font-sans">Raw UTF-8 transaction stream ingestion</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] active:scale-95 transition-all"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Schema Notice */}
        <div className="mt-4 p-3 rounded-2xl bg-zinc-900/60 border border-white/[0.06] text-[11px] space-y-1 font-sans">
          <span className="font-mono text-zinc-400 font-semibold block text-[10px] uppercase">
            Required Schema Columns
          </span>
          <code className="text-indigo-300 font-mono text-[10px] block break-all">
            transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type
          </code>
          <p className="text-[10px] text-zinc-500 mt-1">
            Optional: <code className="text-zinc-400">currency</code>. Target/fraud labels and PaySim post-event balance columns are automatically stripped by safeguards.
          </p>
        </div>

        {/* Drag & Drop Zone */}
        {!result && (
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`mt-4 relative border-2 border-dashed rounded-2xl p-7 text-center cursor-pointer transition-all duration-200 overflow-hidden ${
              dragActive
                ? "border-indigo-400 bg-indigo-500/10 shadow-lg scale-[1.01]"
                : "border-white/[0.12] hover:border-white/[0.22] bg-[#0c0e18] hover:bg-[#121624]"
            }`}
          >
            {isUploading && (
              <div className="absolute inset-0 bg-[#0c0e18]/80 backdrop-blur-sm flex items-center justify-center z-10">
                <div className="flex flex-col items-center gap-2 font-mono text-xs text-indigo-300">
                  <div className="h-6 w-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  <span>Ingesting and triaging transactions…</span>
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              hidden
            />
            <div className="flex flex-col items-center gap-2.5">
              <div className="h-11 w-11 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-zinc-300 shadow-inner">
                <FileText className="h-5 w-5 text-indigo-400" />
              </div>
              <p className="text-xs font-semibold text-zinc-200 font-sans">
                {selectedFile ? selectedFile.name : "Drag and drop your transaction CSV here"}
              </p>
              <span className="text-[10px] text-zinc-500 font-mono">
                {selectedFile
                  ? `${(selectedFile.size / 1024).toFixed(1)} KB ready for import`
                  : "or click to browse local files (max 5 MiB)"}
              </span>
            </div>
          </div>
        )}

        {/* Error Callout */}
        {errorMsg && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs flex items-start gap-2 shadow-lg font-sans">
            <AlertTriangle className="h-4 w-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <div className="break-all font-mono text-[11px] leading-relaxed">{errorMsg}</div>
          </div>
        )}

        {/* Result Breakdown Card */}
        {result && (
          <div className="mt-4 p-4 rounded-2xl bg-emerald-500/[0.08] border border-emerald-500/30 text-xs font-sans space-y-2 shadow-xl">
            <div className="flex items-center gap-2 text-emerald-400 font-bold">
              <CheckCircle2 className="h-4 w-4" />
              <span>Ingestion Complete: {result.transaction_count} rows processed</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-300 pt-1 font-mono">
              <div>Run ID: <span className="text-white font-bold">{result.run_id.slice(0, 14)}…</span></div>
              <div>Cases Generated: <span className="text-indigo-400 font-bold">{result.case_count}</span></div>
            </div>

            {result.dropped_columns && result.dropped_columns.length > 0 && (
              <div className="text-[10px] text-amber-400 pt-1 flex items-center gap-1.5 font-sans">
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>Safeguard: Dropped {result.dropped_columns.length} label/balance column(s).</span>
              </div>
            )}

            {result.analysis_warnings && result.analysis_warnings.length > 0 && (
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[10px] font-sans">
                {result.analysis_warnings.join(" ")}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-white/[0.08] hover:bg-white/[0.06] text-zinc-400 text-xs font-medium active:scale-95 transition-all"
          >
            {result ? "Close" : "Cancel"}
          </button>

          {!result && (
            <button
              type="button"
              disabled={!selectedFile || isUploading}
              onClick={handleUpload}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all active:scale-[0.96] disabled:opacity-40 shadow-sm"
            >
              {isUploading ? "Ingesting…" : "Import Transactions"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
