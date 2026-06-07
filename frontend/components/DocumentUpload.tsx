"use client";

import { useState, useRef, DragEvent } from "react";

type Status = "idle" | "saving" | "parsing" | "ingesting" | "done" | "error";

interface UploadEvent {
  status: string;
  message: string;
}

async function* streamUpload(file: File): AsyncGenerator<UploadEvent> {
  const body = new FormData();
  body.append("file", file);

  const response = await fetch("http://localhost:8000/api/upload", {
    method: "POST",
    body,
  });

  if (!response.body) throw new Error("No response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          yield JSON.parse(line.slice(6)) as UploadEvent;
        } catch {
          // skip malformed lines
        }
      }
    }
  }
}

export default function DocumentUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = (f: File) => {
    setFile(f);
    setStatus("idle");
    setMessage("");
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) pickFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    try {
      for await (const event of streamUpload(file)) {
        setStatus(event.status as Status);
        setMessage(event.message);
        if (event.status === "done" || event.status === "error") break;
      }
    } catch {
      setStatus("error");
      setMessage("Upload failed — is the backend running on port 8000?");
    }
  };

  const reset = () => {
    setFile(null);
    setStatus("idle");
    setMessage("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const busy = status !== "idle" && status !== "done" && status !== "error";

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
        Upload Document
      </h2>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors select-none ${
          dragging
            ? "border-emerald-500 bg-emerald-500/5"
            : "border-gray-700 hover:border-gray-500"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.pptx,.html,.txt,.md"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); }}
        />
        {file ? (
          <>
            <p className="text-sm text-gray-200 font-medium truncate">{file.name}</p>
            <p className="text-xs text-gray-500 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-400">Drop a file or click to browse</p>
            <p className="text-xs text-gray-600 mt-1">PDF · DOCX · PPTX · HTML · TXT · MD</p>
          </>
        )}
      </div>

      {/* Status banner */}
      {status !== "idle" && message && (
        <div
          className={`flex items-center gap-2 rounded-lg px-4 py-3 text-xs ${
            status === "done"
              ? "bg-emerald-900/30 text-emerald-400"
              : status === "error"
              ? "bg-red-900/30 text-red-400"
              : "bg-gray-800 text-gray-300"
          }`}
        >
          {busy && (
            <span className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          )}
          {status === "done" && <span>✓</span>}
          {status === "error" && <span>✗</span>}
          <span>{message}</span>
        </div>
      )}

      {/* Progress steps */}
      {status !== "idle" && (
        <ol className="flex flex-col gap-1.5 text-xs">
          {(["saving", "parsing", "ingesting", "done"] as const).map((step, i) => {
            const stepOrder = ["saving", "parsing", "ingesting", "done"];
            const currentIdx = stepOrder.indexOf(status === "error" ? "saving" : status);
            const stepIdx = stepOrder.indexOf(step);
            const done = stepIdx < currentIdx || status === "done";
            const active = stepIdx === currentIdx && status !== "done" && status !== "error";
            return (
              <li key={step} className={`flex items-center gap-2 ${done ? "text-emerald-400" : active ? "text-gray-200" : "text-gray-600"}`}>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${done ? "bg-emerald-500" : active ? "bg-gray-300 animate-pulse" : "bg-gray-700"}`} />
                {{ saving: "Save file", parsing: "Parse to markdown (LlamaCloud)", ingesting: "Embed & upload to Qdrant", done: "Complete" }[step]}
              </li>
            );
          })}
        </ol>
      )}

      {/* Buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleUpload}
          disabled={!file || busy}
          className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg py-2 text-sm font-medium transition-colors"
        >
          {busy ? "Processing..." : "Upload & Ingest"}
        </button>
        {(file || status !== "idle") && (
          <button
            onClick={reset}
            disabled={busy}
            className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-sm transition-colors"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
