import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  archivePendingRssCapturesBefore,
  archiveStaleInboxCaptures,
  createCapture,
  createObjective,
  createRawNote,
  listNotes,
  processInbox,
  readNote,
  readSetupState,
  saveSetupState,
  updateNote,
} from "../src/lib/vault";

test("completed Inbox captures rotate without breaking provenance", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerva-inbox-archive-"));
  const previousVault = process.env.SECOND_BRAIN_VAULT;
  process.env.SECOND_BRAIN_VAULT = root;
  t.after(async () => {
    if (previousVault === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previousVault;
    await fs.rm(root, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(root, "01-Inbox"), { recursive: true });
  await fs.mkdir(path.join(root, "03-Wiki"), { recursive: true });
  await fs.writeFile(path.join(root, "01-Inbox", "old.md"), [
    "---", "title: Old capture", "status: processed", "processed_at: 2026-07-01T10:00:00.000Z", "---", "# Old capture", "", "Source.", "",
  ].join("\n"));
  await fs.writeFile(path.join(root, "01-Inbox", "recent.md"), [
    "---", "title: Recent capture", "status: processed", "processed_at: 2026-08-03T10:00:00.000Z", "---", "# Recent capture", "", "Source.", "",
  ].join("\n"));
  await fs.writeFile(path.join(root, "03-Wiki", "derived.md"), [
    "---", "title: Derived", "status: active", "source_note: 01-Inbox/old.md", "sources:", "  - 01-Inbox/old.md", "---", "# Derived", "", "Capture: [[Old capture]]", "Path link: [[01-Inbox/old|Old]]", "Path: 01-Inbox/old.md", "",
  ].join("\n"));

  const moved = await archiveStaleInboxCaptures("2026-08-04");
  const archivedPath = moved.get("01-Inbox/old.md");
  assert.match(archivedPath || "", /^_Archive\/01-Inbox-2026-W27\/old\.md$/);
  await fs.access(path.join(root, archivedPath!));
  await fs.access(path.join(root, "01-Inbox", "recent.md"));
  await assert.rejects(fs.access(path.join(root, "01-Inbox", "old.md")));
  const derived = await readNote("03-Wiki/derived.md");
  assert.equal(derived?.data.source_note, archivedPath);
  assert.deepEqual(derived?.data.sources, [archivedPath]);
  assert.match(derived?.content || "", new RegExp(`Path: ${archivedPath}`));
  assert.match(derived?.content || "", new RegExp(`\\[\\[${archivedPath}\\|Old capture\\]\\]`));
  assert.match(derived?.content || "", /\[\[_Archive\/01-Inbox-2026-W27\/old\|Old\]\]/);
});

test("AI routes captures automatically without a commercial-plan gate", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerva-capture-routing-"));
  const keys = ["SECOND_BRAIN_VAULT", "SECOND_BRAIN_PLAN", "MEMO_BRIDGE_URL", "MEMO_TOKEN"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  process.env.SECOND_BRAIN_VAULT = root;
  process.env.SECOND_BRAIN_PLAN = "free";
  process.env.MEMO_BRIDGE_URL = "http://bridge.test";
  process.env.MEMO_TOKEN = "test-token";

  t.after(async () => {
    globalThis.fetch = previousFetch;
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(root, "09-Skills", "process-inbox"), { recursive: true });
  await fs.writeFile(
    path.join(root, "09-Skills", "process-inbox", "SKILL.md"),
    "# Automatic capture routing\n",
    "utf8",
  );
  const setup = await readSetupState();
  await saveSetupState({
    ...setup,
    ai: {
      ...setup.ai,
      primary: "codex",
      verified: ["codex"],
      models: { ...setup.ai.models, codex: "test-model" },
    },
  });
  await createObjective({ title: "Publier Nerva Brain", area: "Projects" });

  const captures = await Promise.all([
    createCapture({ title: "TASK route", text: "Je dois publier la page de vente demain." }),
    createCapture({ title: "RAW route", text: "Idée encore floue sur le positionnement." }),
    createCapture({ title: "WIKI route", text: "Principe durable et réutilisable sur la capture automatique." }),
    createCapture({ title: "ARCHIVE route", text: "Information temporaire sans utilité future." }),
  ]);

  globalThis.fetch = (async (_input, init) => {
    const payload = JSON.parse(String(init?.body || "{}")) as {
      capture?: { title?: string };
    };
    const title = payload.capture?.title || "";
    const destination = title.split(" ")[0].toLowerCase();
    return new Response(JSON.stringify({
      ok: true,
      engine: "codex",
      destination,
      keep: destination !== "archive",
      discard_reason: destination === "archive" ? "Information transitoire." : "",
      title: destination === "task" ? "Publier la page de vente" : `${title} classée`,
      summary: destination === "wiki"
        ? "Cette capture décrit un principe complet de routage automatique : préserver la source, choisir une seule destination selon la durée d’utilité, puis enregistrer une décision traçable avant de rendre le résultat visible."
        : `Synthèse ${destination}.`,
      insight: destination === "wiki"
        ? "Un seuil d’admission explicite évite que la bibliothèque devienne un flux d’actualités impossible à relire."
        : "",
      open_question: "",
      next_action: destination === "task" ? "Publier la page." : "",
      tags: ["automatique"],
      objective_titles: destination === "task" ? ["Publier Nerva Brain"] : [],
      duplicate_path: "",
      library_score: destination === "wiki" ? 5 : 0,
      library_reason: destination === "wiki"
        ? "Connaissance substantielle, autonome, durable, pertinente et nouvelle."
        : "",
      area: "Projects",
      priority: "high",
      exec_kind: "prepare",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const derived = await processInbox(10);
  assert.equal(derived.length, 3);

  const [task] = await listNotes("tasks");
  assert.equal(task.title, "Publier la page de vente");
  assert.equal(task.data.source, "ai-capture");
  assert.equal(task.data.source_note, captures[0].relativePath);
  assert.equal(task.data.objective, "Publier Nerva Brain");

  const [raw] = await listNotes("raw");
  assert.equal(raw.status, "active");
  assert.equal(raw.data.source_note, captures[1].relativePath);

  const [wiki] = await listNotes("wiki");
  assert.equal(wiki.status, "active");
  assert.equal(wiki.data.source_note, captures[2].relativePath);

  for (const [index, destination] of ["task", "raw", "wiki", "archive"].entries()) {
    const routed = await readNote(captures[index].relativePath);
    assert.equal(routed?.data.route_destination, destination);
    assert.equal(routed?.status, destination === "archive" ? "archived" : "processed");
  }
});

test("an explicit action appended to a manual Raw note creates a task", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerva-raw-action-"));
  const keys = ["SECOND_BRAIN_VAULT", "SECOND_BRAIN_PLAN", "MEMO_BRIDGE_URL", "MEMO_TOKEN"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  process.env.SECOND_BRAIN_VAULT = root;
  process.env.SECOND_BRAIN_PLAN = "free";
  process.env.MEMO_BRIDGE_URL = "http://bridge.test";
  process.env.MEMO_TOKEN = "test-token";
  t.after(async () => {
    globalThis.fetch = previousFetch;
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, "09-Skills", "process-inbox"), { recursive: true });
  await fs.writeFile(path.join(root, "09-Skills", "process-inbox", "SKILL.md"), "# Routing\n", "utf8");
  const setup = await readSetupState();
  await saveSetupState({ ...setup, ai: { ...setup.ai, primary: "codex", verified: ["codex"], models: { ...setup.ai.models, codex: "test-model" } } });
  globalThis.fetch = (async () => new Response(JSON.stringify({
    ok: true, engine: "codex", destination: "task", keep: true, title: "Envoyer le point d'équipe", summary: "Action explicite.",
    tags: [], objective_titles: [], duplicate_path: "", area: "Work", priority: "medium", exec_kind: "prepare",
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;

  const raw = await createRawNote({ title: "Compte rendu", body: "J'ai terminé les tests." });
  const before = await readNote(raw.relativePath);
  await updateNote({ relativePath: raw.relativePath, title: raw.title, content: `${before!.content}\n\nJe vais devoir envoyer le point d'équipe demain.`, expectedMtime: before!.mtime });

  const [task] = await listNotes("tasks");
  assert.equal(task.title, "Envoyer le point d'équipe");
  assert.equal((await readNote(raw.relativePath))?.content.includes("Je vais devoir envoyer"), true);
});

test("old pending RSS captures are archived in bulk while today's captures remain pending", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerva-rss-backlog-"));
  const previousVault = process.env.SECOND_BRAIN_VAULT;
  process.env.SECOND_BRAIN_VAULT = root;
  t.after(async () => {
    if (previousVault === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previousVault;
    await fs.rm(root, { recursive: true, force: true });
  });

  const old = await createCapture({ title: "Old RSS", text: "Old item", source: "rss" });
  const fresh = await createCapture({ title: "Fresh RSS", text: "Fresh item", source: "rss" });
  for (const [note, date] of [[old, "2026-07-25T10:00:00.000Z"], [fresh, "2026-07-26T10:00:00.000Z"]] as const) {
    const fullPath = path.join(root, note.relativePath);
    const raw = await fs.readFile(fullPath, "utf8");
    await fs.writeFile(fullPath, raw.replace(/^captured_at: .*$/m, `captured_at: ${date}`));
  }

  const archived = await archivePendingRssCapturesBefore("2026-07-26");
  assert.deepEqual(archived, [old.relativePath]);
  assert.equal((await readNote(old.relativePath))?.status, "archived");
  assert.equal((await readNote(fresh.relativePath))?.status, "inbox");
  assert.match(String((await readNote(old.relativePath))?.data.knowledge_decision_reason), /Ancien élément RSS/);
});

test("a weak AI wiki proposal is archived instead of polluting the library", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerva-library-gate-"));
  const keys = ["SECOND_BRAIN_VAULT", "SECOND_BRAIN_PLAN", "MEMO_BRIDGE_URL", "MEMO_TOKEN"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  process.env.SECOND_BRAIN_VAULT = root;
  process.env.SECOND_BRAIN_PLAN = "free";
  process.env.MEMO_BRIDGE_URL = "http://bridge.test";
  process.env.MEMO_TOKEN = "test-token";

  t.after(async () => {
    globalThis.fetch = previousFetch;
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(root, "09-Skills", "process-inbox"), { recursive: true });
  await fs.writeFile(path.join(root, "09-Skills", "process-inbox", "SKILL.md"), "# Strict library gate\n", "utf8");
  const setup = await readSetupState();
  await saveSetupState({
    ...setup,
    ai: {
      ...setup.ai,
      primary: "codex",
      verified: ["codex"],
      models: { ...setup.ai.models, codex: "test-model" },
    },
  });

  const capture = await createCapture({
    title: "Annonce passagère",
    text: "Une nouveauté intéressante vient de sortir, sans détail exploitable.",
  });
  globalThis.fetch = (async () => new Response(JSON.stringify({
    ok: true,
    engine: "codex",
    destination: "wiki",
    keep: true,
    title: "Une nouveauté intéressante",
    summary: "Une annonce évoque une nouveauté, mais ne donne aucun mécanisme ni détail réutilisable.",
    insight: "Cela pourrait être intéressant.",
    open_question: "",
    next_action: "",
    tags: ["actualité"],
    objective_titles: [],
    duplicate_path: "",
    library_score: 2,
    library_reason: "Information trop brève, transitoire et sans utilité future démontrée.",
    area: "Knowledge",
    priority: "low",
    exec_kind: "manual",
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;

  const derived = await processInbox(1, [capture.relativePath]);
  assert.deepEqual(derived, []);
  assert.equal((await listNotes("wiki")).length, 0);

  const routed = await readNote(capture.relativePath);
  assert.equal(routed?.status, "archived");
  assert.equal(routed?.data.route_destination, "archive");
  assert.equal(routed?.data.route_proposed, "wiki");
  assert.equal(routed?.data.library_score, 2);
  assert.match(String(routed?.data.knowledge_decision_reason), /trop brève/i);
});
