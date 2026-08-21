import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  normalizeSuggestions,
  readBriefSuggestions,
  writeBriefSuggestions,
  suggestionsFilePath,
} from "../src/lib/brief-suggestions";
import { createTask, decideBriefSuggestion, listNotes, readNote, updateTaskStatus, upsertVaultNote } from "../src/lib/vault";

async function scratch(run: (root: string) => Promise<void>) {
  const previousVault = process.env.SECOND_BRAIN_VAULT;
  const previousDir = process.env.BRIEF_SUGGESTIONS_DIR;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "memo-suggestions-"));
  process.env.SECOND_BRAIN_VAULT = root;
  process.env.BRIEF_SUGGESTIONS_DIR = path.join(root, ".suggestions");
  try {
    await run(root);
  } finally {
    for (const [key, value] of [["SECOND_BRAIN_VAULT", previousVault], ["BRIEF_SUGGESTIONS_DIR", previousDir]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("normalizeSuggestions drops anything that could write outside 05-Tasks or change nothing", () => {
  const suggestions = normalizeSuggestions([
    { kind: "update_task", title: "Escape", target: "05-Tasks/../00-System/Context.md", patch: { priority: "low" } },
    { kind: "update_task", title: "Wrong folder", target: "04-Objectives/goal.md", patch: { priority: "low" } },
    { kind: "update_task", title: "Empty patch", target: "05-Tasks/real.md", patch: { priority: "urgent" } },
    { kind: "update_task", title: "Cannot complete for me", target: "05-Tasks/real.md", patch: { status: "done" } },
    { kind: "delete_vault", title: "Unknown kind", target: "05-Tasks/real.md" },
    { kind: "create_task", title: "" },
    { kind: "capture_note", title: "No body", note: { title: "x", body: "" } },
    { kind: "update_task", title: "Valid", target: "05-Tasks/real.md", patch: { priority: "low", status: "waiting" } },
  ]);

  assert.deepEqual(suggestions.map((entry) => entry.title), ["Valid"]);
  assert.deepEqual(suggestions[0].patch, { priority: "low", status: "waiting" });
  assert.equal(suggestions[0].state, "pending");
});

test("suggestionsFilePath keeps every brief path inside its own directory", () => {
  assert.equal(path.basename(suggestionsFilePath("06-Daily/2026-07-27.md")), "06-Daily-2026-07-27.json");
  // Traversal is neutralized rather than rejected: separators and dots are not
  // in the allowed character set, so the result can only ever be one file deep.
  for (const hostile of ["../../etc/passwd", "06-Daily/../../secret.md", "/etc/shadow"]) {
    const resolved = suggestionsFilePath(hostile);
    assert.equal(path.dirname(resolved), path.dirname(suggestionsFilePath("06-Daily/x.md")));
  }
  assert.throws(() => suggestionsFilePath("..."), /Invalid brief path/);
});

test("accepting applies the change once; rejecting leaves the vault untouched", () => scratch(async () => {
  const task = await createTask({ title: "Tâche à repriorer", area: "Projects", priority: "high" });
  const brief = "06-Daily/2026-07-27.md";
  await writeBriefSuggestions(brief, normalizeSuggestions([
    { kind: "update_task", title: "Baisser la priorité", target: task.relativePath, patch: { priority: "medium" } },
    { kind: "create_task", title: "Nouvelle tâche proposée", task: { title: "Nouvelle tâche proposée" } },
    { kind: "capture_note", title: "Constat", note: { title: "Constat", body: "Contenu du constat." } },
  ]));

  const before = (await listNotes("tasks")).length;
  await decideBriefSuggestion(brief, "sug-1", "accepted");
  assert.equal((await readNote(task.relativePath))?.data.priority, "medium");

  // A replayed accept must not create a second task.
  await decideBriefSuggestion(brief, "sug-2", "accepted");
  await decideBriefSuggestion(brief, "sug-2", "accepted");
  assert.equal((await listNotes("tasks")).length, before + 1);

  await decideBriefSuggestion(brief, "sug-3", "rejected");
  assert.equal((await listNotes("raw")).length, 0, "a rejected note must never reach the vault");

  const stored = await readBriefSuggestions(brief);
  assert.deepEqual(stored.map((entry) => entry.state), ["accepted", "accepted", "rejected"]);
  assert.ok(stored[1].resultPath?.startsWith("05-Tasks/"));
}));

test("a suggestion pointing at a missing task stays pending with its error", () => scratch(async () => {
  const brief = "06-Daily/2026-07-28.md";
  await writeBriefSuggestions(brief, normalizeSuggestions([
    { kind: "update_task", title: "Cible absente", target: "05-Tasks/inexistante.md", patch: { priority: "low" } },
  ]));

  const [suggestion] = await decideBriefSuggestion(brief, "sug-1", "accepted");
  assert.equal(suggestion.state, "pending");
  assert.match(suggestion.error || "", /introuvable/);
}));

test("pending suggestions disappear when their task is already closed", () => scratch(async () => {
  const done = await createTask({ title: "Déjà terminée" });
  const open = await createTask({ title: "Encore ouverte" });
  const brief = "07-Weekly/2026-W30.md";
  await writeBriefSuggestions(brief, normalizeSuggestions([
    { kind: "update_task", title: "Suggestion périmée", target: done.relativePath, patch: { priority: "low" } },
    { kind: "update_task", title: "Suggestion actuelle", target: open.relativePath, patch: { priority: "high" } },
  ]));

  await updateTaskStatus(done.relativePath, "done");

  const visible = await readBriefSuggestions(brief);
  assert.deepEqual(visible.map((entry) => entry.title), ["Suggestion actuelle"]);
}));

test("execute_task only ever rewrites notes in executable folders", () => {
  // Distinct targets, because two suggestions on the same task are deduplicated
  // and would hide whether the edit filter did any work.
  const suggestions = normalizeSuggestions([
    // Context.md belongs to refresh-context alone; briefs are user-edited.
    { kind: "execute_task", title: "A", outcome: "fait", target: "05-Tasks/a.md",
      edits: [{ path: "00-System/Context.md", content: "pwned" }] },
    { kind: "execute_task", title: "B", outcome: "fait", target: "05-Tasks/b.md",
      edits: [{ path: "06-Daily/2026-07-27.md", content: "pwned" }] },
    { kind: "execute_task", title: "C", outcome: "fait", target: "05-Tasks/c.md",
      edits: [{ path: "../../etc/passwd", content: "pwned" }] },
    { kind: "execute_task", title: "D", outcome: "fait", target: "05-Tasks/d.md",
      edits: [{ path: "03-Wiki/note.md", content: "   " }] },
    { kind: "execute_task", title: "E", outcome: "", target: "05-Tasks/e.md" },
    // The one legal shape: an executable folder and real content.
    { kind: "execute_task", title: "F", outcome: "fait", target: "05-Tasks/f.md",
      edits: [{ path: "03-Wiki/note.md", content: "contenu réel" }] },
  ]);

  // A-D survive as proposals but with every illegal edit stripped; E has no
  // outcome so it is not an execution at all; F keeps its legal edit.
  assert.deepEqual(suggestions.map((s) => s.title), ["A", "B", "C", "D", "F"]);
  for (const title of ["A", "B", "C", "D"]) {
    assert.deepEqual(suggestions.find((s) => s.title === title)!.edits, [], `${title} kept an illegal edit`);
  }
  assert.deepEqual(suggestions.find((s) => s.title === "F")!.edits, [{ path: "03-Wiki/note.md", content: "contenu réel" }]);
});

test("execute_task refuses a manual task, and lets only `vault` write outside the task", () => scratch(async () => {
  const manual = await createTask({ title: "Envoyer un mail", execKind: "manual" });
  const verify = await createTask({ title: "Vérifier le déploiement", execKind: "verify" });
  const brief = "06-Daily/2026-07-29.md";

  await writeBriefSuggestions(brief, normalizeSuggestions([
    // The suggestion cannot lie its way past the gate: the class is re-read
    // from the task note at apply time.
    { kind: "execute_task", title: "Envoyer le mail", outcome: "envoyé", target: manual.relativePath },
    { kind: "execute_task", title: "Écrire sous couvert de verify", outcome: "fait", target: verify.relativePath,
      edits: [{ path: "03-Wiki/x.md", content: "contenu" }] },
  ]));

  const [refused, writeUnderVerify] = await decideBriefSuggestion(brief, "sug-1", "accepted");
  assert.equal(refused.state, "pending");
  assert.match(refused.error || "", /manual/);
  assert.equal((await readNote(manual.relativePath))?.content.includes("Exécution IA"), false);

  await decideBriefSuggestion(brief, "sug-2", "accepted");
  const after = (await readBriefSuggestions(brief))[1];
  assert.equal(after.state, "pending", writeUnderVerify.error);
  assert.match(after.error || "", /verify/);
}));

test("accepting a vault task applies its edits and records the outcome without closing it", () => scratch(async () => {
  const task = await createTask({ title: "Cocher les séances faites", execKind: "vault" });
  const target = await writeBriefSuggestions("06-Daily/2026-07-30.md", []);
  assert.deepEqual(target, []);

  const note = await upsertVaultNote("wiki", {
    title: "Plan", filename: "Plan.md", overwrite: true,
    data: { status: "active" }, body: "# Plan\n\n- [ ] C1\n",
  });
  const brief = "06-Daily/2026-07-30.md";
  await writeBriefSuggestions(brief, normalizeSuggestions([
    { kind: "execute_task", title: "Cocher C1", outcome: "C1 cochée d'après le journal Garmin.",
      target: task.relativePath, edits: [{ path: note.relativePath, content: "# Plan\n\n- [x] C1\n" }] },
  ]));

  const [done] = await decideBriefSuggestion(brief, "sug-1", "accepted");
  assert.equal(done.state, "accepted");
  assert.match((await readNote(note.relativePath))!.content, /- \[x\] C1/);

  const updated = await readNote(task.relativePath);
  assert.match(updated!.content, /## Exécution IA/);
  assert.match(updated!.content, /C1 cochée d'après le journal Garmin/);
  // Only the user decides a task is finished; a verification that found a
  // problem must never read as completed.
  assert.equal(updated!.status, "todo");
}));

test("a brief generated against a scratch vault never touches the real profile's suggestions", async () => {
  const keys = ["SECOND_BRAIN_VAULT", "BRIEF_SUGGESTIONS_DIR"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "memo-isolation-"));
  try {
    // No BRIEF_SUGGESTIONS_DIR on purpose: this is exactly the shape of the
    // brief/weekly tests, which used to write into ./data of the real checkout.
    delete process.env.BRIEF_SUGGESTIONS_DIR;
    process.env.SECOND_BRAIN_VAULT = path.join(root, "vault");
    const file = suggestionsFilePath("06-Daily/2026-07-27.md");
    assert.ok(file.startsWith(root), `${file} escaped the scratch root`);
    assert.ok(!file.startsWith(path.join(process.cwd(), "data")), "must not resolve into the real data dir");
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a prepare task drafts inside the task and is refused any outside write", () => scratch(async () => {
  const prep = await createTask({ title: "Relancer les 5 prospects", execKind: "prepare" });
  const brief = "06-Daily/2026-07-31.md";
  await writeBriefSuggestions(brief, normalizeSuggestions([
    { kind: "execute_task", title: "Rédiger la relance", target: prep.relativePath,
      outcome: "Prêt à exécuter : brouillon du mail de relance ci-dessous.\n\nBonjour…" },
  ]));

  const [drafted] = await decideBriefSuggestion(brief, "sug-1", "accepted");
  assert.equal(drafted.state, "accepted");
  const note = await readNote(prep.relativePath);
  assert.match(note!.content, /Prêt à exécuter/);
  // Drafting is not doing: nothing was sent and the task stays open.
  assert.equal(note!.status, "todo");

  // The same class may not rewrite another note under cover of "preparing".
  const brief2 = "06-Daily/2026-08-01.md";
  await writeBriefSuggestions(brief2, normalizeSuggestions([
    { kind: "execute_task", title: "Écrire ailleurs", target: prep.relativePath, outcome: "fait",
      edits: [{ path: "03-Wiki/x.md", content: "contenu" }] },
  ]));
  const [refused] = await decideBriefSuggestion(brief2, "sug-1", "accepted");
  assert.equal(refused.state, "pending");
  assert.match(refused.error || "", /prepare/);
}));
