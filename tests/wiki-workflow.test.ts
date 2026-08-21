import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/notes/route";
import { readNote, type VaultNote } from "../src/lib/vault";

test("the notes API publishes then archives a Wiki draft", async (t) => {
  const previousVault = process.env.SECOND_BRAIN_VAULT;
  const previousToken = process.env.CAPTURE_TOKEN;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "memo-wiki-workflow-"));
  const token = "w".repeat(64);
  process.env.SECOND_BRAIN_VAULT = root;
  process.env.CAPTURE_TOKEN = token;
  t.after(async () => {
    if (previousVault === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previousVault;
    if (previousToken === undefined) delete process.env.CAPTURE_TOKEN;
    else process.env.CAPTURE_TOKEN = previousToken;
    await fs.rm(root, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(root, "03-Wiki"), { recursive: true });
  await fs.writeFile(path.join(root, "03-Wiki", "Guide.md"), "---\ntype: wiki\ntitle: Guide\nstatus: draft\ntags: []\n---\n# Guide\n\nContenu.\n");
  const draft = await readNote("03-Wiki/Guide.md");
  assert.ok(draft);

  async function setStatus(note: VaultNote, status: "active" | "archived") {
    return POST(new NextRequest("http://localhost/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-capture-token": token },
      body: JSON.stringify({
        action: "update",
        path: note.relativePath,
        title: note.title,
        status,
        area: "",
        priority: "",
        horizon: "",
        tags: note.tags,
        content: note.content,
        expectedMtime: note.mtime,
      }),
    }));
  }

  const publishResponse = await setStatus(draft, "active");
  assert.equal(publishResponse.status, 200);
  const published = (await publishResponse.json()).note as VaultNote;
  assert.equal(published.status, "active");

  const archiveResponse = await setStatus(published, "archived");
  assert.equal(archiveResponse.status, 200);
  assert.equal(((await archiveResponse.json()).note as VaultNote).status, "archived");
  assert.equal((await readNote(draft.relativePath))?.status, "archived");
});
