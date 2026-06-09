"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Message } from "@/lib/types";

interface Props {
  messages: Message[];
  loading: boolean;
  onSubmit: (question: string) => void;
  onClearHistory: () => void;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      className="text-xs text-gray-600 hover:text-gray-400 transition-colors select-none"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export default function ChatPanel({ messages, loading, onSubmit, onClearHistory }: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    onSubmit(input.trim());
    setInput("");
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <p className="text-gray-500 text-sm text-center mt-20">
            Ask a question about your ingested documents.
          </p>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[82%] flex flex-col gap-1 ${
                msg.role === "user" ? "items-end" : "items-start"
              }`}
            >
              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-emerald-600 text-white"
                    : "bg-gray-800 text-gray-100"
                }`}
              >
                {/* Typing indicator for empty streaming assistant message */}
                {msg.role === "assistant" && !msg.content && loading ? (
                  <span className="inline-flex gap-1 items-center h-4">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                  </span>
                ) : msg.role === "assistant" ? (
                  <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:my-1 prose-headings:my-1">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  msg.content
                )}
              </div>

              {/* Footer: copy + sources */}
              {msg.role === "assistant" && msg.content && (
                <div className="flex items-center gap-3 px-1 flex-wrap">
                  <CopyButton text={msg.content} />
                  {msg.sources && msg.sources.length > 0 && (
                    <span className="text-xs text-gray-600">
                      {msg.sources.length === 1 ? "Source" : "Sources"}:{" "}
                      {msg.sources.join(", ")}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Clear history button */}
      {messages.length > 0 && (
        <div className="px-6 pb-1 flex justify-end">
          <button
            onClick={onClearHistory}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            Clear history
          </button>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-6 pb-6 pt-2 flex gap-3">
        <input
          className="flex-1 bg-gray-800 rounded-xl px-4 py-3 text-sm placeholder:text-gray-500 outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
          placeholder="Ask something about your documents..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-xl px-5 py-3 text-sm font-medium transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}
