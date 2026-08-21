import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  saveAssistantChat,
  listAssistantChats,
  readAssistantChat,
  deleteAssistantChat,
} from "../src/lib/assistant-chats";

// The module reads ASSISTANT_CHATS_DIR fresh on every call, so each test can
// just point it at its own scratch directory before calling in.
async function scratchChats(run: (dir: string) => Promise<void>) {
  const previous = process.env.ASSISTANT_CHATS_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "second-brain-assistant-chats-"));
  process.env.ASSISTANT_CHATS_DIR = dir;
  try {
    await run(dir);
  } finally {
    if (previous === undefined) delete process.env.ASSISTANT_CHATS_DIR;
    else process.env.ASSISTANT_CHATS_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("saving a chat makes it listable with a title truncated to 60 chars", () => scratchChats(async () => {
  await saveAssistantChat("chat-one", [{ role: "user", content: "x".repeat(100) }]);
  const chats = await listAssistantChats();
  assert.equal(chats.length, 1);
  assert.equal(chats[0].id, "chat-one");
  assert.equal(chats[0].title, "x".repeat(60));
  assert.equal(chats[0].messageCount, 1);
}));

test("reading a chat returns its stored messages", () => scratchChats(async () => {
  const messages = [{ role: "user" as const, content: "hello" }, { role: "assistant" as const, content: "hi" }];
  await saveAssistantChat("chat-one", messages);
  const chat = await readAssistantChat("chat-one");
  assert.deepEqual(chat?.messages, messages);
}));

test("saving again preserves createdAt and bumps updatedAt", () => scratchChats(async () => {
  await saveAssistantChat("chat-one", [{ role: "user", content: "hello" }]);
  const first = await readAssistantChat("chat-one");
  await new Promise((resolve) => setTimeout(resolve, 5));
  await saveAssistantChat("chat-one", [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }]);
  const second = await readAssistantChat("chat-one");
  assert.equal(second?.createdAt, first?.createdAt);
  assert.notEqual(second?.updatedAt, first?.updatedAt);
}));

test("deleting a chat removes it", () => scratchChats(async () => {
  await saveAssistantChat("chat-one", [{ role: "user", content: "hello" }]);
  await deleteAssistantChat("chat-one");
  assert.equal(await readAssistantChat("chat-one"), null);
  assert.deepEqual(await listAssistantChats(), []);
}));

test("invalid chat ids are rejected everywhere the id names a file", () => scratchChats(async () => {
  for (const badId of ["../evil", "chat-UPPER", ""]) {
    await assert.rejects(() => saveAssistantChat(badId, []));
    await assert.rejects(() => readAssistantChat(badId));
    await assert.rejects(() => deleteAssistantChat(badId));
  }
}));

test("a corrupt chat file in the directory is skipped by list", () => scratchChats(async (dir) => {
  await saveAssistantChat("chat-good", [{ role: "user", content: "valid" }]);
  await fs.writeFile(path.join(dir, "chat-broken.json"), "{not json", "utf8");
  const chats = await listAssistantChats();
  assert.equal(chats.length, 1);
  assert.equal(chats[0].id, "chat-good");
}));
