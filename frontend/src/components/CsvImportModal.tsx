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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div className="relative w-full max-w-lg rounded-2xl bg-[#0f1117] border border-white/10 shadow-2xl p-6 text-zinc-100 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Upload className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold font-mono">IMPORT CANONICAL CSV</h3>
              <p className="text-[11px] text-zinc-400">Raw UTF-8 byte stream processing</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Schema Notice */}
        <div className="mt-4 p-3 rounded-xl bg-zinc-900/60 border border-white/[0.06] text-[11px] space-y-1">
          <span className="font-mono text-zinc-400 font-bold block text-[10px] uppercase">
            // REQUIRED COLUMNS
          </span>
          <code className="text-indigo-300 font-mono text-[10px] block break-all">
            transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type
          </code>
          <p className="text-[10px] text-zinc-500 mt-1">
            Optional: <code className="text-zinc-400">currency</code>. Target/fraud labels and PaySim post-event balance columns are automatically stripped.
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
            className={`mt-4 border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              dragActive
                ? "border-indigo-500 bg-indigo-500/[0.05]"
                : "border-white/[0.1] hover:border-white/[0.2] bg-zinc-950/40"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              hidden
            />
            <div className="flex flex-col items-center gap-2">
              <div className="h-10 w-10 rounded-full bg-white/[0.04] flex items-center justify-center text-zinc-400">
                <FileText className="h-5 w-5" />
              </div>
              <p className="text-xs font-medium text-zinc-300">
                {selectedFile ? selectedFile.name : "Drag and drop your transaction CSV here"}
              </p>
              <span className="text-[10px] text-zinc-500 font-mono">
                {selectedFile
                  ? `${(selectedFile.size / 1024).toFixed(1)} KB selected`
                  : "or browse files (max 5 MiB)"}
              </span>
            </div>
          </div>
        )}

        {/* Error Callout */}
        {errorMsg && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <div className="break-all font-mono text-[11px] leading-relaxed">{errorMsg}</div>
          </div>
        )}

        {/* Result Breakdown Card */}
        {result && (
          <div className="mt-4 p-4 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/30 text-xs font-mono space-y-2">
            <div className="flex items-center gap-2 text-emerald-400 font-bold">
              <CheckCircle2 className="h-4 w-4" />
              <span>Import Successful: {result.transaction_count} rows processed</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-300 pt-1">
              <div>Run ID: <span className="text-white font-bold">{result.run_id.slice(0, 14)}…</span></div>
              <div>Cases Generated: <span className="text-indigo-400 font-bold">{result.case_count}</span></div>
            </div>

            {result.dropped_columns && result.dropped_columns.length > 0 && (
              <div className="text-[10px] text-amber-400 pt-1 flex items-center gap-1">
                <ShieldAlert className="h-3 w-3" />
                <span>Safeguard: Dropped {result.dropped_columns.length} label/balance column(s).</span>
              </div>
            )}

            {result.analysis_warnings && result.analysis_warnings.length > 0 && (
              <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[10px]">
                {result.analysis_warnings.join(" ")}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-white/[0.08] hover:bg-white/[0.04] text-zinc-400 text-xs font-medium"
          >
            {result ? "Close" : "Cancel"}
          </button>

          {!result && (
            <button
              type="button"
              disabled={!selectedFile || isUploading}
              onClick={handleUpload}
              className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all active:scale-[0.98] disabled:opacity-40"
            >
              {isUploading ? "Uploading & Analyzing…" : "Run Ingestion"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
