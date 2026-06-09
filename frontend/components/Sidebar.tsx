"use client";

import { useState, useRef } from "react";
import ThemeToggle from "./ThemeToggle";
import SessionList from "./SessionList";
import { Session } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface Props {
  sessions: Session[];
  activeSessionId: string | null;
  documents: string[];
  documentFilter: string[];
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onDocumentFilterChange: (filter: string[]) => void;
  onUploadComplete: () => void;
}

export default function Sidebar({
  sessions,
  activeSessionId,
  documents,
  documentFilter,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onDocumentFilterChange,
  onUploadComplete,
}: Props) {
  return (
    <div className="w-[260px] flex-shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0f0f1a] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-emerald-500 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-3.5 h-3.5 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 tracking-tight">
            CRAG
          </span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 hidden sm:inline">
            Corrective RAG
          </span>
        </div>
        <ThemeToggle />
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* New conversation button */}
        <div className="px-3 pt-3 pb-1">
          <button
            onClick={onNewSession}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-emerald-400 dark:hover:border-emerald-600 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors text-xs font-medium"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            New conversation
          </button>
        </div>

        {/* Conversation history */}
        <Section label="Conversations">
          <SessionList
            sessions={sessions}
            activeId={activeSessionId}
            onSelect={onSelectSession}
            onDelete={onDeleteSession}
          />
        </Section>

        <Divider />

        {/* Document collection filter */}
        {documents.length > 0 && (
          <>
            <Section label="Document Collection">
              <DocFilter
                documents={documents}
                selected={documentFilter}
                onChange={onDocumentFilterChange}
              />
            </Section>
            <Divider />
          </>
        )}

        {/* Quick upload */}
        <Section label="Quick Upload">
          <QuickUpload onComplete={onUploadComplete} />
        </Section>

        {/* spacer */}
        <div className="flex-1" />
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2">
      <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 mb-1.5">
        {label}
      </p>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="mx-3 border-t border-gray-100 dark:border-gray-800 my-0.5" />;
}

function DocFilter({
  documents,
  selected,
  onChange,
}: {
  documents: string[];
  selected: string[];
  onChange: (s: string[]) => void;
}) {
  const toggle = (doc: string) =>
    onChange(selected.includes(doc) ? selected.filter((d) => d !== doc) : [...selected, doc]);

  const rows: { label: string; active: boolean; onClick: () => void }[] = [
    { label: "All documents", active: selected.length === 0, onClick: () => onChange([]) },
    ...documents.map((doc) => ({
      label: doc,
      active: selected.includes(doc),
      onClick: () => toggle(doc),
    })),
  ];

  return (
    <div className="space-y-0.5">
      {rows.map(({ label, active, onClick }) => (
        <div
          key={label}
          onClick={onClick}
          className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-xs transition-colors ${
            active
              ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          }`}
        >
          <span
            className={`w-3.5 h-3.5 border rounded flex items-center justify-center flex-shrink-0 transition-colors ${
              active
                ? "border-emerald-500 bg-emerald-500"
                : "border-gray-300 dark:border-gray-600"
            }`}
          >
            {active && (
              <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span className="truncate" title={label}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

function QuickUpload({ onComplete }: { onComplete: () => void }) {
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setStatus("uploading");
    const body = new FormData();
    body.append("file", file);
    try {
      const resp = await fetch(`${API_BASE}/api/upload`, { method: "POST", body });
      if (!resp.body) { setStatus("error"); return; }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.status === "done") { setStatus("done"); onComplete(); setTimeout(() => setStatus("idle"), 2000); return; }
              if (evt.status === "error") { setStatus("error"); setTimeout(() => setStatus("idle"), 3000); return; }
            } catch { /* skip */ }
          }
        }
      }
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  return (
    <label
      className={`flex flex-col items-center gap-1.5 px-3 py-4 border border-dashed rounded-xl cursor-pointer transition-colors text-center ${
        status === "uploading"
          ? "border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-500/5 cursor-wait"
          : status === "done"
          ? "border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-500/5"
          : status === "error"
          ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-500/5"
          : "border-gray-300 dark:border-gray-700 hover:border-emerald-400 dark:hover:border-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/5"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.pptx,.html,.txt,.md"
        className="hidden"
        disabled={status === "uploading"}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      {status === "uploading" ? (
        <>
          <span className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Uploading…</span>
        </>
      ) : status === "done" ? (
        <>
          <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Done!</span>
        </>
      ) : status === "error" ? (
        <>
          <svg className="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
          <span className="text-[10px] text-red-500">Upload failed</span>
        </>
      ) : (
        <>
          <svg className="w-5 h-5 text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[10px] text-gray-500 dark:text-gray-400">Drop file or click to upload</span>
          <span className="text-[9px] text-gray-400 dark:text-gray-600">PDF · DOCX · TXT · MD</span>
        </>
      )}
    </label>
  );
}
