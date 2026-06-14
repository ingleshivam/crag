"use client";

import { useState } from "react";
import PipelineGraph from "./PipelineGraph";

export interface StepTrace {
  node: string;
  label: string;
  subtext?: string;
}

export interface SourceChunk {
  source: string;
  content: string;
}

interface Props {
  activeNode: string | null;
  steps: StepTrace[];
  sources: SourceChunk[];
  isStreaming: boolean;
}

const NODE_COLORS: Record<string, string> = {
  retrieve: "bg-blue-500",
  grade_documents: "bg-amber-500",
  transform_query: "bg-orange-500",
  generate: "bg-emerald-500",
};

const NODE_LABELS: Record<string, string> = {
  retrieve: "Retrieve",
  grade_documents: "Grade Documents",
  transform_query: "Rewrite Query",
  generate: "Generate",
  web_search: "Web Search",
};

export default function InfoPanel({
  activeNode,
  steps,
  sources,
  isStreaming,
}: Props) {
  const [graphOpen, setGraphOpen] = useState(true);
  const [stepsOpen, setStepsOpen] = useState(true);
  const [sourcesOpen, setSourcesOpen] = useState(true);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <Collapsible
        label="Pipeline"
        open={graphOpen}
        onToggle={() => setGraphOpen((v) => !v)}
        badge={isStreaming ? <PulsingDot /> : null}
      >
        <div className="px-3 pb-3">
          <PipelineGraph activeNode={activeNode} />
        </div>
      </Collapsible>

      <Collapsible
        label="Steps"
        open={stepsOpen}
        onToggle={() => setStepsOpen((v) => !v)}
        badge={
          steps.length ? (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {steps.length}
            </span>
          ) : null
        }
      >
        {steps.length === 0 ? (
          <p className="px-4 pb-3 text-xs text-gray-400 dark:text-gray-600 italic">
            No steps yet
          </p>
        ) : (
          <div className="px-3 pb-3 space-y-1.5">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span
                  className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                    NODE_COLORS[step.node] ?? "bg-gray-400"
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 leading-snug">
                    {NODE_LABELS[step.node] ?? step.label}
                  </p>
                  {step.subtext && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-snug truncate">
                      {step.subtext}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {isStreaming && (
              <div className="flex items-center gap-2.5 opacity-60">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  Generating…
                </p>
              </div>
            )}
          </div>
        )}
      </Collapsible>

      {sources.length > 0 && (
        <Collapsible
          label="Sources"
          open={sourcesOpen}
          onToggle={() => setSourcesOpen((v) => !v)}
          badge={
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {sources.length}
            </span>
          }
        >
          <div className="px-3 pb-3 space-y-2">
            {sources.map((chunk, i) => (
              <SourceCard key={i} chunk={chunk} />
            ))}
          </div>
        </Collapsible>
      )}
    </div>
  );
}

function Collapsible({
  label,
  open,
  onToggle,
  badge,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-gray-100 dark:border-gray-800">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
            {label}
          </span>
          {badge}
        </div>
        <svg
          className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? "" : "-rotate-90"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M19 9l-7 7-7-7" strokeLinecap="round" />
        </svg>
      </button>
      {open && children}
    </div>
  );
}

function SourceCard({ chunk }: { chunk: SourceChunk }) {
  const [expanded, setExpanded] = useState(false);
  const preview = chunk.content.slice(0, 120);
  const hasMore = chunk.content.length > 120;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800/60">
        <svg
          className="w-3 h-3 text-gray-400 flex-shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
            strokeLinecap="round"
          />
          <path d="M14 2v6h6" strokeLinecap="round" />
        </svg>
        <span
          className="text-[10px] font-medium text-gray-600 dark:text-gray-400 truncate flex-1"
          title={chunk.source}
        >
          {chunk.source}
        </span>
      </div>
      <div className="px-2.5 py-2">
        <p className="text-[10px] text-gray-500 dark:text-gray-500 leading-relaxed">
          {expanded ? chunk.content : preview}
          {!expanded && hasMore && "…"}
        </p>
        {hasMore && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-[9px] text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    </div>
  );
}

function PulsingDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
    </span>
  );
}
