import { PipelineStep } from "@/lib/types";

const NODE_META: Record<string, { label: string; color: string }> = {
  retrieve:         { label: "Retrieve",      color: "bg-blue-500" },
  grade_documents:  { label: "Grade Docs",    color: "bg-yellow-500" },
  transform_query:  { label: "Rewrite Query", color: "bg-orange-500" },
  generate:         { label: "Generate",      color: "bg-emerald-500" },
};

interface Props {
  steps: PipelineStep[];
}

export default function PipelineTrace({ steps }: Props) {
  return (
    <div className="border-b border-gray-800 p-4 flex-shrink-0 max-h-[45%] overflow-y-auto">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Pipeline Trace
      </h2>

      {steps.length === 0 ? (
        <p className="text-gray-600 text-xs">Steps appear here as the pipeline executes.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {steps.map((step, i) => {
            const meta = NODE_META[step.node] ?? { label: step.node, color: "bg-gray-500" };
            return (
              <li key={i} className="flex items-start gap-3">
                {/* Step dot + connector */}
                <div className="flex flex-col items-center gap-1 pt-0.5 flex-shrink-0">
                  <div className={`w-2.5 h-2.5 rounded-full ${meta.color}`} />
                  {i < steps.length - 1 && (
                    <div className="w-px h-4 bg-gray-700" />
                  )}
                </div>

                <div className="flex-1 min-w-0 -mt-0.5">
                  <span className="text-xs font-semibold text-gray-200">{meta.label}</span>

                  {step.node === "retrieve" && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {(step.output.documents as string[] | undefined)?.length ?? 0} chunk(s) retrieved
                    </p>
                  )}
                  {step.node === "grade_documents" && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {(step.output.documents as string[] | undefined)?.length ?? 0} relevant chunk(s) kept
                    </p>
                  )}
                  {step.node === "transform_query" && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      → {step.output.question as string}
                    </p>
                  )}
                  {step.node === "generate" && (
                    <p className="text-xs text-gray-500 mt-0.5">Answer ready</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
