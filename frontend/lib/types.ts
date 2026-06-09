export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

export interface PipelineStep {
  node: string;
  output: Record<string, unknown>;
}

export interface StreamEvent {
  type: "node" | "token" | "done";
  node?: string;
  output?: Record<string, unknown>;
  token?: string;
}

export interface ChatHistoryEntry {
  question: string;
  answer: string;
}

export interface Session {
  id: string;
  title: string;
  messages: Message[];
  history: ChatHistoryEntry[];
  documentFilter: string[];
  createdAt: number;
  updatedAt: number;
}
