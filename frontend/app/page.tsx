"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Message, ChatHistoryEntry, Session } from "@/lib/types";
import { StepTrace, SourceChunk } from "@/components/InfoPanel";
import { streamQuery, fetchDocuments } from "@/lib/api";
import {
  loadSessions,
  saveSessions,
  createSession,
  upsertSession,
  deleteSession,
  sessionTitle,
} from "@/lib/sessions";
import Sidebar from "@/components/Sidebar";
import ChatPanel from "@/components/ChatPanel";
import InfoPanel from "@/components/InfoPanel";

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Active session's state (derived + live-streamed)
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatHistoryEntry[]>([]);
  const [documentFilter, setDocumentFilter] = useState<string[]>([]);

  // Right panel
  const [steps, setSteps] = useState<StepTrace[]>([]);
  const [sources, setSources] = useState<SourceChunk[]>([]);
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  // Documents available in Qdrant
  const [documents, setDocuments] = useState<string[]>([]);

  const idRef = useRef(0);
  const lastQuestionRef = useRef<string | null>(null);

  // Init: load sessions + documents
  useEffect(() => {
    const saved = loadSessions();
    if (saved.length === 0) {
      const s = createSession();
      const initial = [s];
      setSessions(initial);
      saveSessions(initial);
      setActiveSessionId(s.id);
    } else {
      setSessions(saved);
      const first = saved[0];
      setActiveSessionId(first.id);
      setMessages(first.messages);
      setChatHistory(first.history);
      setDocumentFilter(first.documentFilter);
    }
    fetchDocuments().then(setDocuments);
  }, []);

  const refreshDocuments = useCallback(() => {
    fetchDocuments().then(setDocuments);
  }, []);

  // Switch session
  const handleSelectSession = useCallback(
    (id: string) => {
      // Save current session first
      if (activeSessionId) {
        setSessions((prev) => {
          const current = prev.find((s) => s.id === activeSessionId);
          if (!current) return prev;
          const updated = { ...current, messages, history: chatHistory, documentFilter, updatedAt: Date.now() };
          const next = upsertSession(prev, updated);
          saveSessions(next);
          return next;
        });
      }
      const target = sessions.find((s) => s.id === id);
      if (!target) return;
      setActiveSessionId(id);
      setMessages(target.messages);
      setChatHistory(target.history);
      setDocumentFilter(target.documentFilter);
      setSteps([]);
      setSources([]);
      setActiveNode(null);
    },
    [activeSessionId, sessions, messages, chatHistory, documentFilter]
  );

  const handleNewSession = useCallback(() => {
    // Persist current before creating new
    if (activeSessionId) {
      setSessions((prev) => {
        const current = prev.find((s) => s.id === activeSessionId);
        if (!current) return prev;
        const updated = { ...current, messages, history: chatHistory, documentFilter, updatedAt: Date.now() };
        const next = upsertSession(prev, updated);
        saveSessions(next);
        return next;
      });
    }
    const s = createSession();
    setSessions((prev) => {
      const next = [s, ...prev];
      saveSessions(next);
      return next;
    });
    setActiveSessionId(s.id);
    setMessages([]);
    setChatHistory([]);
    setDocumentFilter([]);
    setSteps([]);
    setSources([]);
    setActiveNode(null);
  }, [activeSessionId, messages, chatHistory, documentFilter]);

  const handleDeleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const next = deleteSession(prev, id);
        saveSessions(next);
        return next;
      });
      if (id === activeSessionId) {
        setSessions((prev) => {
          const remaining = prev.filter((s) => s.id !== id);
          if (remaining.length > 0) {
            const t = remaining[0];
            setActiveSessionId(t.id);
            setMessages(t.messages);
            setChatHistory(t.history);
            setDocumentFilter(t.documentFilter);
          } else {
            const s = createSession();
            const fresh = [s];
            saveSessions(fresh);
            setActiveSessionId(s.id);
            setMessages([]);
            setChatHistory([]);
            setDocumentFilter([]);
          }
          return remaining;
        });
      }
    },
    [activeSessionId]
  );

  const handleDocumentFilterChange = useCallback((filter: string[]) => {
    setDocumentFilter(filter);
  }, []);

  const handleClearHistory = useCallback(() => {
    setMessages([]);
    setChatHistory([]);
    setSteps([]);
    setSources([]);
    setActiveNode(null);
    lastQuestionRef.current = null;
    if (activeSessionId) {
      setSessions((prev) => {
        const current = prev.find((s) => s.id === activeSessionId);
        if (!current) return prev;
        const updated = { ...current, messages: [], history: [], updatedAt: Date.now() };
        const next = upsertSession(prev, updated);
        saveSessions(next);
        return next;
      });
    }
  }, [activeSessionId]);

  const handleSubmit = useCallback(
    async (question: string) => {
      lastQuestionRef.current = question;
      const userMsg: Message = {
        id: String(idRef.current++),
        role: "user",
        content: question,
      };
      setMessages((prev) => [...prev, userMsg]);
      setSteps([]);
      setSources([]);
      setActiveNode(null);
      setIsStreaming(true);

      const assistantId = String(idRef.current++);
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", sources: [] },
      ]);

      let finalAnswer = "";
      let currentSources: string[] = [];
      const newSteps: StepTrace[] = [];
      const newSourceChunks: SourceChunk[] = [];

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
            const node = event.node;
            setActiveNode(node);

            const step: StepTrace = {
              node,
              label: node,
              subtext: node === "retrieve"
                ? `${(event.output.documents as unknown[] | undefined)?.length ?? 0} chunks`
                : node === "grade_documents"
                ? `graded ${(event.output.documents as unknown[] | undefined)?.length ?? 0} docs`
                : undefined,
            };
            newSteps.push(step);
            setSteps([...newSteps]);

            if (node === "retrieve") {
              const docs = event.output.documents as string[] | undefined;
              const srcs = event.output.sources as string[] | undefined;
              if (srcs) currentSources = srcs;
              if (docs && srcs) {
                const chunks = docs.map((content, i) => ({
                  content,
                  source: srcs[i] ?? "unknown",
                }));
                newSourceChunks.push(...chunks);
                setSources([...newSourceChunks]);
              }
            }
          }
        }

        setActiveNode("generate");
        setTimeout(() => setActiveNode(null), 1500);

        // Attach sources to final message
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, sources: currentSources } : m
          )
        );

        // Update chat history
        if (finalAnswer) {
          const newHistory = [...chatHistory, { question, answer: finalAnswer }];
          setChatHistory(newHistory);

          // Persist session
          if (activeSessionId) {
            setSessions((prev) => {
              const current = prev.find((s) => s.id === activeSessionId);
              if (!current) return prev;
              const updatedMessages = [
                ...current.messages,
                userMsg,
                { id: assistantId, role: "assistant" as const, content: finalAnswer, sources: currentSources },
              ];
              const updated: Session = {
                ...current,
                title: current.messages.length === 0 ? sessionTitle(question) : current.title,
                messages: updatedMessages,
                history: newHistory,
                documentFilter,
                updatedAt: Date.now(),
              };
              const next = upsertSession(prev, updated);
              saveSessions(next);
              return next;
            });
          }
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
        setIsStreaming(false);
      }
    },
    [chatHistory, documentFilter, activeSessionId]
  );

  const handleRegen = useCallback(() => {
    if (!lastQuestionRef.current || isStreaming) return;
    // Remove the last assistant message before re-submitting
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant") return prev.slice(0, -1);
      return prev;
    });
    setChatHistory((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
    handleSubmit(lastQuestionRef.current);
  }, [isStreaming, handleSubmit]);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-[#09090f]">
      {/* Left sidebar */}
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        documents={documents}
        documentFilter={documentFilter}
        onNewSession={handleNewSession}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onDocumentFilterChange={handleDocumentFilterChange}
        onUploadComplete={refreshDocuments}
      />

      {/* Center chat */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-[#09090f]">
        <ChatPanel
          messages={messages}
          isStreaming={isStreaming}
          activeFilter={documentFilter}
          onSubmit={handleSubmit}
          onRegen={handleRegen}
          onClearHistory={handleClearHistory}
        />
      </div>

      {/* Right info panel */}
      <div className="w-[300px] flex-shrink-0 flex flex-col overflow-hidden bg-white dark:bg-[#0f0f1a] border-l border-gray-200 dark:border-gray-800">
        <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
            Information Panel
          </span>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          <InfoPanel
            activeNode={activeNode}
            steps={steps}
            sources={sources}
            isStreaming={isStreaming}
          />
        </div>
      </div>
    </div>
  );
}
