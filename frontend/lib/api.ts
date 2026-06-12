import { StreamEvent, ChatHistoryEntry } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function* streamQuery(
  question: string,
  chatHistory: ChatHistoryEntry[],
  documentFilter: string[],
  token: string | null
): AsyncGenerator<StreamEvent> {
  const response = await fetch(`${API_BASE}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      question,
      chat_history: chatHistory,
      document_filter: documentFilter,
    }),
  });

  if (!response.body) throw new Error("No response body from server");

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
          yield JSON.parse(line.slice(6)) as StreamEvent;
        } catch {
          // skip malformed SSE lines
        }
      }
    }
  }
}

export async function fetchDocuments(token: string | null): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/api/documents`, {
      headers: authHeaders(token),
    });
    const data = await res.json();
    return (data.documents as string[]) ?? [];
  } catch {
    return [];
  }
}

export { authHeaders, API_BASE };
