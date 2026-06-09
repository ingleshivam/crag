"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Message, PipelineStep, ChatHistoryEntry } from "@/lib/types";
import { streamQuery, fetchDocuments } from "@/lib/api";
import ChatPanel from "@/components/ChatPanel";
import PipelineTrace from "@/components/PipelineTrace";
import ChunksPanel from "@/components/ChunksPanel";
import DocumentUpload from "@/components/DocumentUpload";
import DocumentFilter from "@/components/DocumentFilter";

const MESSAGES_KEY = "crag_messages";
const HISTORY_KEY = "crag_history";

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [chunks, setChunks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [rightTab, setRightTab] = useState<"trace" | "docs">("trace");
  const [documents, setDocuments] = useState<string[]>([]);
  const [documentFilter, setDocumentFilter] = useState<string[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatHistoryEntry[]>([]);
  const idRef = useRef(0);

  // Load persisted messages + history, then fetch document list
  useEffect(() => {
    try {
      const savedMessages = localStorage.getItem(MESSAGES_KEY);
      const savedHistory = localStorage.getItem(HISTORY_KEY);
      if (savedMessages) setMessages(JSON.parse(savedMessages));
      if (savedHistory) setChatHistory(JSON.parse(savedHistory));
    } catch {
      // ignore parse errors
    }
    fetchDocuments().then(setDocuments);
  }, []);

  // Persist messages whenever they change
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
    }
  }, [messages]);

  const refreshDocuments = useCallback(() => {
    fetchDocuments().then(setDocuments);
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    setChatHistory([]);
    setSteps([]);
    setChunks([]);
    localStorage.removeItem(MESSAGES_KEY);
    localStorage.removeItem(HISTORY_KEY);
  }, []);

  const handleSubmit = useCallback(
    async (question: string) => {
      const userMsg: Message = {
        id: String(idRef.current++),
        role: "user",
        content: question,
      };
      setMessages((prev) => [...prev, userMsg]);
      setSteps([]);
      setChunks([]);
      setLoading(true);

      const assistantId = String(idRef.current++);
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", sources: [] },
      ]);

      let finalAnswer = "";
      let currentSources: string[] = [];

      try {
        for await (const event of streamQuery(question, chatHistory, documentFilter)) {
          if (event.type === "done") break;

          if (event.type === "token" && event.token) {
            finalAnswer += event.token;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: finalAnswer } : m
              )
            );
          }

          if (event.type === "node" && event.node && event.output) {
            setSteps((prev) => [...prev, { node: event.node!, output: event.output! }]);

            if (event.node === "retrieve") {
              const docs = event.output.documents as string[] | undefined;
              const srcs = event.output.sources as string[] | undefined;
              if (docs) setChunks(docs);
              if (srcs) currentSources = srcs;
            }
          }
        }

        // Attach sources to the final assistant message
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, sources: currentSources } : m
          )
        );

        // Save Q&A pair to conversation memory
        if (finalAnswer) {
          setChatHistory((prev) => {
            const updated = [...prev, { question, answer: finalAnswer }];
            localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
            return updated;
          });
        }
      } catch {
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
    },
    [chatHistory, documentFilter]
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left — Chat */}
      <div className="flex-1 flex flex-col border-r border-gray-800 min-w-0">
        <header className="px-6 py-4 border-b border-gray-800 flex items-center gap-3 flex-shrink-0">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <h1 className="font-semibold text-base tracking-tight">CRAG</h1>
          <span className="text-xs text-gray-500">Corrective RAG</span>
        </header>
        <DocumentFilter
          documents={documents}
          selected={documentFilter}
          onChange={setDocumentFilter}
        />
        <ChatPanel
          messages={messages}
          loading={loading}
          onSubmit={handleSubmit}
          onClearHistory={clearHistory}
        />
      </div>

      {/* Right — Tabbed panel */}
      <div className="w-[40%] flex flex-col overflow-hidden flex-shrink-0">
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
          <DocumentUpload onUploadComplete={refreshDocuments} />
        )}
      </div>
    </div>
  );
}
