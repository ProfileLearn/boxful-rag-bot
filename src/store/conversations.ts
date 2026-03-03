import { randomUUID } from "node:crypto";

export type ConversationTurn = {
  user: string;
  assistant: string;
  createdAt: number;
};

type ConversationState = {
  updatedAt: number;
  turns: ConversationTurn[];
};

const conversations = new Map<string, ConversationState>();

function getEnvNum(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.trunc(raw));
}

const SESSION_TTL_MS = getEnvNum("CHAT_SESSION_TTL_MS", 1000 * 60 * 60 * 12);
const MAX_TURNS = getEnvNum("CHAT_HISTORY_MAX_TURNS", 8);
const ID_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;

function nowMs(): number {
  return Date.now();
}

function trimTurnText(raw: string, maxLen: number): string {
  const normalized = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length <= maxLen ? normalized : `${normalized.slice(0, maxLen)}…`;
}

function cleanupExpired(): void {
  const threshold = nowMs() - SESSION_TTL_MS;
  for (const [id, state] of conversations.entries()) {
    if (state.updatedAt >= threshold) continue;
    conversations.delete(id);
  }
}

export function normalizeConversationId(rawId: string | undefined): string | undefined {
  const candidate = String(rawId ?? "").trim();
  if (!candidate) return undefined;
  if (!ID_PATTERN.test(candidate)) return undefined;
  return candidate;
}

function createConversationId(): string {
  return randomUUID();
}

export function ensureConversationId(rawId: string | undefined): string {
  cleanupExpired();
  const normalized = normalizeConversationId(rawId);
  const id = normalized ?? createConversationId();
  const prev = conversations.get(id);
  conversations.set(id, {
    updatedAt: nowMs(),
    turns: prev?.turns ?? [],
  });
  return id;
}

export function getConversationTurns(conversationId: string): ConversationTurn[] {
  cleanupExpired();
  const state = conversations.get(conversationId);
  if (!state) return [];

  state.updatedAt = nowMs();
  return state.turns.map((turn) => ({ ...turn }));
}

export function appendConversationTurn(
  conversationId: string,
  userText: string,
  assistantText: string,
): void {
  cleanupExpired();

  const user = trimTurnText(userText, 1200);
  const assistant = trimTurnText(assistantText, 2200);
  if (!user && !assistant) return;

  const state = conversations.get(conversationId) ?? { updatedAt: nowMs(), turns: [] };
  state.turns.push({
    user,
    assistant,
    createdAt: nowMs(),
  });

  if (state.turns.length > MAX_TURNS) {
    state.turns.splice(0, state.turns.length - MAX_TURNS);
  }

  state.updatedAt = nowMs();
  conversations.set(conversationId, state);
}
