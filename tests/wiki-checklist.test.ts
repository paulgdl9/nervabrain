import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileWriteConflictError, readNote, setWikiChecklistState } from "../src/lib/vault";
import { setMarkdownChecklistState } from "../src/lib/markdown";

test("only the selected Markdown checklist marker changes", () => {
  const source = ["- [ ] Première", "```", "- [ ] Faux élément", "```", "- [x] Seconde"].join("\n");
  assert.equal(
    setMarkdownChecklistState(source, 1, false),
    ["- [ ] Première", "```", "- [ ] Faux élément", "```", "- [ ] Seconde"].join("\n"),
  );
  assert.equal(setMarkdownChecklistState(source, 9, true), null);
});

test("a stale Wiki checklist write is rejected without overwriting the newer state", async (t) => {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "memo-wiki-checklist-"));
  process.env.SECOND_BRAIN_VAULT = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
    await fs.rm(root, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(root, "03-Wiki"), { recursive: true });
  await fs.writeFile(path.join(root, "03-Wiki", "Guide.md"), "---\ntitle: Guide\nstatus: active\n---\n# Guide\n\n- [ ] Une\n- [ ] Deux\n");
  const original = await readNote("03-Wiki/Guide.md");
  assert.ok(original);

  const updated = await setWikiChecklistState({ relativePath: original.relativePath, index: 1, checked: true, expectedMtime: original.mtime });
  await assert.rejects(
    setWikiChecklistState({ relativePath: original.relativePath, index: 0, checked: true, expectedMtime: original.mtime }),
    FileWriteConflictError,
  );
  assert.equal((await readNote(original.relativePath))?.content, updated.content);
});
