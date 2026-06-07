export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface PipelineStep {
  node: string;
  output: Record<string, unknown>;
}

export interface StreamEvent {
  node: string;
  output: Record<string, unknown>;
}
