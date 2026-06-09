import { Session } from "./types";

const KEY = "crag_sessions";

export function loadSessions(): Session[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveSessions(sessions: Session[]): void {
  localStorage.setItem(KEY, JSON.stringify(sessions));
}

export function createSession(): Session {
  return {
    id: crypto.randomUUID(),
    title: "New conversation",
    messages: [],
    history: [],
    documentFilter: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function upsertSession(sessions: Session[], updated: Session): Session[] {
  const idx = sessions.findIndex((s) => s.id === updated.id);
  if (idx === -1) return [updated, ...sessions];
  const copy = [...sessions];
  copy[idx] = updated;
  return copy;
}

export function deleteSession(sessions: Session[], id: string): Session[] {
  return sessions.filter((s) => s.id !== id);
}

export function sessionTitle(firstQuestion: string): string {
  return firstQuestion.length > 58
    ? firstQuestion.slice(0, 55) + "..."
    : firstQuestion;
}
