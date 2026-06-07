"use client";

import { useState, useRef, useCallback } from "react";
import { Message, PipelineStep } from "@/lib/types";
import { streamQuery } from "@/lib/api";
import ChatPanel from "@/components/ChatPanel";
import PipelineTrace from "@/components/PipelineTrace";
import ChunksPanel from "@/components/ChunksPanel";
import DocumentUpload from "@/components/DocumentUpload";

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [chunks, setChunks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [rightTab, setRightTab] = useState<"trace" | "docs">("trace");
  const idRef = useRef(0);

  const handleSubmit = useCallback(async (question: string) => {
    const userMsg: Message = { id: String(idRef.current++), role: "user", content: question };
    setMessages((prev) => [...prev, userMsg]);
    setSteps([]);
    setChunks([]);
    setLoading(true);

    const assistantId = String(idRef.current++);
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

    try {
      for await (const event of streamQuery(question)) {
        if (event.node === "__done__") break;

        setSteps((prev) => [...prev, { node: event.node, output: event.output }]);

        if (event.node === "retrieve") {
          const docs = event.output.documents as string[] | undefined;
          if (docs) setChunks(docs);
        }

        if (event.node === "generate") {
          const answer = event.output.generation as string | undefined;
          if (answer) {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: answer } : m))
            );
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "Error: could not reach the CRAG backend." }
            : m
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left — Chat (60%) */}
      <div className="flex-1 flex flex-col border-r border-gray-800 min-w-0">
        <header className="px-6 py-4 border-b border-gray-800 flex items-center gap-3 flex-shrink-0">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <h1 className="font-semibold text-base tracking-tight">CRAG</h1>
          <span className="text-xs text-gray-500">Corrective RAG</span>
        </header>
        <ChatPanel messages={messages} loading={loading} onSubmit={handleSubmit} />
      </div>

      {/* Right — Tabbed panel (40%) */}
      <div className="w-[40%] flex flex-col overflow-hidden flex-shrink-0">
        {/* Tab bar */}
        <div className="flex border-b border-gray-800 flex-shrink-0">
          {(["trace", "docs"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setRightTab(tab)}
              className={`flex-1 py-3 text-xs font-semibold tracking-wider uppercase transition-colors ${
                rightTab === tab
                  ? "text-emerald-400 border-b-2 border-emerald-500"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab === "trace" ? "Execution" : "Documents"}
            </button>
          ))}
        </div>

        {rightTab === "trace" ? (
          <>
            <PipelineTrace steps={steps} />
            <ChunksPanel chunks={chunks} />
          </>
        ) : (
          <DocumentUpload />
        )}
      </div>
    </div>
  );
}
