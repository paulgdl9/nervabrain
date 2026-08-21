import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deleteNote, listAllNotes, moveNote, parseMarkdown, readNote, renameNote, resolveVaultPath, stringifyMarkdown } from "../src/lib/vault";
import { lintVaultNotes } from "../src/lib/vault-lint";

test("markdown frontmatter round-trips scalar and list values", () => {
  const raw = stringifyMarkdown({ title: "A note", status: "draft", tags: ["One", "Two"] }, "# A note\n\nBody\n");
  const parsed = parseMarkdown(raw);
  assert.equal(parsed.data.title, "A note");
  assert.deepEqual(parsed.data.tags, ["One", "Two"]);
  assert.match(parsed.content, /# A note/);
});

test("nested plugin frontmatter is preserved verbatim across a parse→stringify cycle", () => {
  // A note as an Obsidian plugin (Dataview / Linter `position:`) would leave it:
  // a nested mapping the limited parser does not model. It must survive untouched.
  const raw = [
    "---",
    "title: Plugin note",
    "status: draft",
    "position:",
    "  start:",
    "    line: 0",
    "    col: 0",
    "  end:",
    "    line: 4",
    "    col: 12",
    "tags:",
    "  - alpha",
    "  - beta",
    "---",
    "# Plugin note",
    "",
    "Body",
    "",
  ].join("\n");
  const parsed = parseMarkdown(raw);
  // Re-emitted without changing anything must be byte-identical.
  assert.equal(stringifyMarkdown(parsed.data, parsed.content), raw);
});

test("changing one key leaves an unmodelled nested block untouched", () => {
  const raw = [
    "---",
    "title: Old title",
    "position:",
    "  start:",
    "    line: 0",
    "---",
    "# Old title",
    "",
  ].join("\n");
  const parsed = parseMarkdown(raw);
  parsed.data.title = "New title";
  const out = stringifyMarkdown(parsed.data, parsed.content);
  assert.match(out, /title: "?New title"?/);
  // The nested block the parser cannot model stays verbatim.
  assert.match(out, /position:\n {2}start:\n {4}line: 0/);
  // The old title is gone from the frontmatter (the body heading is untouched).
  assert.doesNotMatch(out, /title: "?Old title"?/);
});

test("leading-zero identifiers stay strings, real numbers stay numbers", () => {
  const raw = [
    "---",
    "isin: 007123",
    "count: 42",
    "ratio: 0.5",
    "zero: 0",
    "---",
    "body",
  ].join("\n");
  const parsed = parseMarkdown(raw);
  assert.strictEqual(parsed.data.isin, "007123");
  assert.strictEqual(parsed.data.count, 42);
  assert.strictEqual(parsed.data.ratio, 0.5);
  assert.strictEqual(parsed.data.zero, 0);
});

test("vault paths cannot escape the configured root", () => {
  const previous = process.env.SECOND_BRAIN_VAULT;
  process.env.SECOND_BRAIN_VAULT = path.join(os.tmpdir(), "memo-vault-root");
  try {
    assert.equal(resolveVaultPath("03-Wiki/note.md"), path.join(process.env.SECOND_BRAIN_VAULT, "03-Wiki/note.md"));
    assert.throws(() => resolveVaultPath("../outside.md"), /escapes vault/);
  } finally {
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
  }
});

test("listAllNotes hides _Archive from navigation but exposes it so the linter can resolve rotated sources", async () => {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memo-vault-archive-"));
  process.env.SECOND_BRAIN_VAULT = root;
  const archived = "_Archive/06-Daily-2026-W30/2026-07-26.md";
  fs.mkdirSync(path.join(root, "_Archive/06-Daily-2026-W30"), { recursive: true });
  fs.mkdirSync(path.join(root, "06-Daily"), { recursive: true });
  fs.writeFileSync(path.join(root, archived), "---\ntitle: Rotated\ntype: daily\n---\n# Rotated\n");
  fs.writeFileSync(
    path.join(root, "06-Daily/2026-07-27.md"),
    `---\ntitle: Today\ntype: daily\nsources:\n  - ${archived}\n---\n# Today\n`,
  );

  try {
    const navigation = await listAllNotes();
    assert.ok(!navigation.some((note) => note.relativePath === archived), "navigation must skip _Archive");

    const complete = await listAllNotes({ includeArchive: true });
    assert.ok(complete.some((note) => note.relativePath === archived), "the linter listing must include _Archive");

    const missing = (notes: Awaited<ReturnType<typeof listAllNotes>>) =>
      lintVaultNotes(notes).issues.filter((issue) => issue.code === "source.missing");
    assert.equal(missing(navigation).length, 1, "the archive-blind listing reports a false positive");
    assert.deepEqual(missing(complete), [], "the archive-aware listing resolves the rotated source");
    // _Archive resolves as a target but stays out of the hygiene pass.
    assert.equal(lintVaultNotes(complete).noteCount, complete.length - 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
  }
});

test("readNote only reads visible Markdown files", async () => {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memo-vault-read-"));
  process.env.SECOND_BRAIN_VAULT = root;
  fs.writeFileSync(path.join(root, "visible.md"), "# Visible\n");
  fs.writeFileSync(path.join(root, "secret.json"), '{"secret":true}\n');
  fs.writeFileSync(path.join(root, ".hidden.md"), "# Hidden\n");

  try {
    assert.equal((await readNote("visible.md"))?.title, "Visible");
    assert.equal(await readNote("secret.json"), null);
    assert.equal(await readNote(".hidden.md"), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
  }
});

test("moveNote stays inside the vault and never overwrites a file", async () => {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memo-vault-move-"));
  process.env.SECOND_BRAIN_VAULT = root;
  fs.mkdirSync(path.join(root, "02-Raw"), { recursive: true });
  fs.mkdirSync(path.join(root, "00-System"), { recursive: true });
  fs.mkdirSync(path.join(root, "08-Projects/Test"), { recursive: true });
  fs.writeFileSync(path.join(root, "02-Raw/note.md"), "# Source\n");
  fs.writeFileSync(path.join(root, "00-System/Context.md"), "# Protected\n");
  fs.writeFileSync(path.join(root, "08-Projects/Test/note.md"), "# Existing\n");

  try {
    const moved = await moveNote("02-Raw/note.md", "08-Projects/Test");
    assert.equal(moved.relativePath, "08-Projects/Test/note-2.md");
    assert.equal((await readNote("08-Projects/Test/note.md"))?.title, "Existing");
    await assert.rejects(moveNote("08-Projects/Test/note-2.md", "../outside"), /Invalid vault move/);
    await assert.rejects(moveNote("00-System/Context.md", "02-Raw"), /Protected vault note/);
    await assert.rejects(deleteNote("00-System/Context.md"), /Protected vault note/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
  }
});

test("renameNote renames allowed files without overwriting or escaping", async () => {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memo-vault-rename-"));
  process.env.SECOND_BRAIN_VAULT = root;
  fs.mkdirSync(path.join(root, "02-Raw"), { recursive: true });
  fs.mkdirSync(path.join(root, "00-System"), { recursive: true });
  fs.writeFileSync(path.join(root, "02-Raw", "source.md"), "# Source\n");
  fs.writeFileSync(path.join(root, "02-Raw", "existing.md"), "# Existing\n");
  fs.writeFileSync(path.join(root, "00-System", "Context.md"), "# Protected\n");

  try {
    const renamed = await renameNote("02-Raw/source.md", "Nouveau nom");
    assert.equal(renamed.relativePath, "02-Raw/Nouveau nom.md");
    assert.equal(await readNote("02-Raw/source.md"), null);
    await assert.rejects(renameNote("02-Raw/Nouveau nom.md", "existing"), /already exists/);
    await assert.rejects(renameNote("02-Raw/Nouveau nom.md", "../outside"), /Invalid note filename/);
    await assert.rejects(renameNote("00-System/Context.md", "Contexte"), /Protected vault note/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
  }
});
