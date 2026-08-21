import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "@/lib/atomic-write";
import type { AssistantChatMessage } from "@/lib/vault";

// Assistant conversations are server-side app data, not vault notes: they are
// stored as plain JSON files outside `vault/` and never go through vault.ts.

export type StoredAssistantChat = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AssistantChatMessage[];
};

export type AssistantChatSummary = { id: string; title: string; updatedAt: string; messageCount: number };

const CHAT_ID_RE = /^chat-[a-z0-9-]{1,60}$/;
const MAX_MESSAGE_CHARS = 8000;
const MAX_MESSAGES = 60;
const MAX_TITLE_CHARS = 60;
const MAX_LISTED_CHATS = 50;

function chatsDir() {
  return process.env.ASSISTANT_CHATS_DIR?.trim() || path.join(process.cwd(), "data", "assistant-chats");
}

// The id doubles as the filename stem, so an invalid id is a path-traversal
// guard failure, not a normal "not found" case: every function throws on it.
function chatFilePath(id: string) {
  if (!CHAT_ID_RE.test(id)) throw new Error(`Invalid chat id: ${id}`);
  return path.join(chatsDir(), `${id}.json`);
}

function sanitizeMessages(messages: AssistantChatMessage[]): AssistantChatMessage[] {
  const clean = messages
    .filter((message): message is AssistantChatMessage =>
      Boolean(message) && (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
    .map((message) => ({ role: message.role, content: message.content.slice(0, MAX_MESSAGE_CHARS) }));
  return clean.slice(-MAX_MESSAGES);
}

function titleFrom(messages: AssistantChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user")?.content.trim();
  return firstUser ? firstUser.slice(0, MAX_TITLE_CHARS) : "Conversation";
}

export async function saveAssistantChat(id: string, messages: AssistantChatMessage[]): Promise<AssistantChatSummary[]> {
  const filePath = chatFilePath(id);
  const existing = await readAssistantChat(id);
  const sanitized = sanitizeMessages(messages);
  const now = new Date().toISOString();
  const chat: StoredAssistantChat = {
    id,
    title: titleFrom(sanitized),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    messages: sanitized,
  };
  // atomicWriteFile creates the directory lazily; no separate mkdir needed.
  await atomicWriteFile(filePath, JSON.stringify(chat, null, 2));
  return listAssistantChats();
}

export async function listAssistantChats(): Promise<AssistantChatSummary[]> {
  const dir = chatsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const summaries: AssistantChatSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, entry), "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredAssistantChat>;
      if (typeof parsed.id !== "string" || typeof parsed.updatedAt !== "string" || !Array.isArray(parsed.messages)) continue;
      summaries.push({
        id: parsed.id,
        title: typeof parsed.title === "string" ? parsed.title : "Conversation",
        updatedAt: parsed.updatedAt,
        messageCount: parsed.messages.length,
      });
    } catch {
      // Corrupt chat file: skip it rather than failing the whole list.
    }
  }
  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return summaries.slice(0, MAX_LISTED_CHATS);
}

export async function readAssistantChat(id: string): Promise<StoredAssistantChat | null> {
  const filePath = chatFilePath(id);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as StoredAssistantChat;
  } catch {
    // Missing or corrupt file both read as "no such conversation".
    return null;
  }
}

export async function deleteAssistantChat(id: string): Promise<AssistantChatSummary[]> {
  const filePath = chatFilePath(id);
  await fs.unlink(filePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
  return listAssistantChats();
}
