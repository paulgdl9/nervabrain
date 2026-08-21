import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  MODULE_EVIDENCE_CONTENT_LIMIT,
  MODULE_EVIDENCE_NOTE_LIMIT,
  activeModuleEvidence,
  askAssistant,
  generateDailyBrief,
  generateWeeklyReview,
  listAllNotes,
  readSetupState,
  saveSetupState,
  type SetupState,
  type VaultNote,
} from "../src/lib/vault";
import { todayISO } from "../src/lib/dates";

async function scratchVault(run: (root: string) => Promise<void>) {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "memo-modules-"));
  process.env.SECOND_BRAIN_VAULT = root;
  try {
    await run(root);
  } finally {
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeNote(root: string, relativePath: string, title: string, marker: string, extra = "") {
  const fullPath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, [
    "---", `title: ${title}`, /^status:/m.test(extra) ? "" : "status: active", extra, "---", `# ${title}`, marker, "",
  ].filter(Boolean).join("\n"), "utf8");
}

const allModules = (state: SetupState): SetupState["modules"] => ({
  ...state.modules,
  finance: true,
  budget: true,
  business: true,
  trail: true, trailSync: true,
  revisions: true,
  custom: ["Laboratoire"],
});

test("active module evidence covers every living Markdown folder, opt-in custom pages, disabled modules, and empty state", () => scratchVault(async (root) => {
  const sentinels = {
    finance: ["10-Finance/finance.md", "FINANCE-UNIQUE"],
    budget: ["00-System/Budget.md", "BUDGET-UNIQUE"],
    business: ["12-Business/business.md", "BUSINESS-UNIQUE"],
    training: ["08-Projects/Training/training.md", "TRAINING-UNIQUE"],
    revisions: ["08-Projects/Revisions/revisions.md", "REVISIONS-UNIQUE"],
    custom: ["11-Custom/laboratoire/custom.md", "CUSTOM-UNIQUE"],
  } as const;
  for (const [module, [relativePath, marker]] of Object.entries(sentinels)) {
    await writeNote(root, relativePath, module, marker);
  }
  await writeNote(root, "11-Custom/_registry/laboratoire.md", "Laboratoire", "registry", "slug: laboratoire\ndaily: true");
  await writeNote(root, "10-Finance/archive/old.md", "Archive", "ARCHIVE-FORBIDDEN");
  await writeNote(root, "12-Business/disabled.md", "Disabled", "DISABLED-BUSINESS", "status: archived");

  const state = await readSetupState();
  const modules = allModules(state);
  const notes = await listAllNotes();
  const evidence = activeModuleEvidence(notes, modules);

  assert.deepEqual(Object.keys(evidence).sort(), ["budget", "business", "custom", "finance", "revisions", "training"]);
  for (const [module, [, marker]] of Object.entries(sentinels)) {
    assert.match(JSON.stringify(evidence[module as keyof typeof evidence]), new RegExp(marker));
  }
  assert.deepEqual(evidence.custom?.pages, ["Laboratoire"]);
  assert.doesNotMatch(JSON.stringify(evidence), /ARCHIVE-FORBIDDEN|DISABLED-BUSINESS/);

  const withoutFinance = activeModuleEvidence(notes, { ...modules, finance: false });
  assert.equal(withoutFinance.finance, undefined);
  assert.doesNotMatch(JSON.stringify(withoutFinance), /FINANCE-UNIQUE/);

  const empty = activeModuleEvidence([], { ...state.modules, budget: true, custom: ["Vide"] });
  assert.deepEqual(empty.budget, { state: "empty", total: 0, notes: [] });
  assert.deepEqual(empty.custom, { state: "empty", total: 0, pages: ["Vide"], notes: [] });
}));

test("module evidence stays bounded on a large Markdown index", () => {
  const modules: SetupState["modules"] = {
    finance: true, budget: true, business: true, trail: true, trailSync: true, revisions: true, custom: [],
  };
  const prefixes = ["10-Finance", "12-Business", "08-Projects/Training", "08-Projects/Revisions"];
  const notes: VaultNote[] = Array.from({ length: 20_000 }, (_, index) => {
    const folder = prefixes[index % prefixes.length];
    const relativePath = `${folder}/note-${index}.md`;
    return {
      id: relativePath,
      title: `Note ${index}`,
      relativePath,
      folder: folder.split("/")[0],
      kind: "note",
      data: { updated: "2026-07-21" },
      content: "x".repeat(4_000),
      excerpt: "x".repeat(200),
      tags: [],
      links: [],
      status: "active",
      mtime: new Date(2026, 0, 1, 0, 0, index % 60).toISOString(),
    };
  });
  const started = performance.now();
  const evidence = activeModuleEvidence(notes, modules);
  const elapsed = performance.now() - started;

  for (const entry of Object.values(evidence)) assert.ok((entry?.notes.length || 0) <= MODULE_EVIDENCE_NOTE_LIMIT);
  // Bound the payload by the module budget itself, not a frozen byte count:
  // five enabled modules, each capped at its note and content limits plus
  // per-note metadata.
  assert.ok(Buffer.byteLength(JSON.stringify(evidence))
    < 5 * MODULE_EVIDENCE_NOTE_LIMIT * (MODULE_EVIDENCE_CONTENT_LIMIT + 900));
  assert.ok(elapsed < 5_000, `selector took ${elapsed.toFixed(1)} ms`);
});

test("module evidence preserves the newest entries at the end of chronological journals", () => {
  const relativePath = "08-Projects/Trail-26K/Sync.md";
  const note: VaultNote = {
    id: relativePath,
    title: "Trail - Sync Garmin",
    relativePath,
    folder: "08-Projects",
    kind: "note",
    data: { updated: "2026-07-26T21:42:32" },
    content: [
      "# Sync Garmin",
      "Objectif : Trail 42 km / 2300 m D+",
      "ANCIENNE-SEANCE",
      "DONNEES-INTERMEDIAIRES-ABSENTES ".repeat(MODULE_EVIDENCE_CONTENT_LIMIT / 10),
      "DERNIERE-SEANCE Sortie trail démo | 17,53 km | 2h11 | 144 bpm | 526 m D+",
    ].join("\n"),
    excerpt: "Journal Garmin synchronisé",
    tags: ["sport", "trail"],
    links: [],
    status: "active",
    mtime: "2026-07-26T21:42:32.000Z",
  };
  const evidence = activeModuleEvidence([note], {
    finance: false, budget: false, business: false, trail: true, trailSync: true, revisions: false, custom: [],
  });
  const content = evidence.training?.notes[0]?.content || "";

  assert.match(content, /Objectif : Trail 42 km/);
  assert.match(content, /DERNIERE-SEANCE Sortie trail démo/);
  assert.match(content, /contenu intermédiaire omis/);
  assert.ok(content.length <= MODULE_EVIDENCE_CONTENT_LIMIT);
});

test("the assistant can reach a module note that module_evidence dropped, without sending it twice", () => scratchVault(async (root) => {
  const keys = ["SECOND_BRAIN_PLAN", "MEMO_BRIDGE_URL", "MEMO_TOKEN"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  process.env.SECOND_BRAIN_PLAN = "pro";
  process.env.MEMO_BRIDGE_URL = "http://bridge.test";
  process.env.MEMO_TOKEN = "test-token";
  try {
    // More training notes than MODULE_EVIDENCE_NOTE_LIMIT, so the oldest is
    // reachable only through the question-relevant search.
    for (let index = 0; index < MODULE_EVIDENCE_NOTE_LIMIT + 2; index += 1) {
      await writeNote(root, `08-Projects/Training/seance-${index}.md`, `Seance ${index}`, `SEANCE-${index}-PAYLOAD`);
    }
    await writeNote(root, "00-System/Context.md", "System Context", "Contexte de test");
    const state = await readSetupState();
    await saveSetupState({
      ...state,
      modules: { ...state.modules, trail: true },
      ai: { ...state.ai, primary: "codex", verified: ["codex"], models: { ...state.ai.models, codex: "test-model" } },
    });

    let chat: Record<string, unknown> = {};
    globalThis.fetch = (async (_input, init) => {
      chat = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true, engine: "codex", reply: "ok" }), { status: 200 });
    }) as typeof fetch;

    await askAssistant([], "Analyse la Seance 0 de mon entrainement");

    const evidence = chat.evidence as Record<string, unknown>;
    const moduleNotes = (evidence.module_evidence as { training?: { notes: { path: string }[] } }).training?.notes || [];
    const searched = evidence.vault_notes as { path: string }[];
    const searchedPaths = new Set(searched.map((note) => note.path));

    assert.equal(moduleNotes.length, MODULE_EVIDENCE_NOTE_LIMIT, "module evidence still caps the module itself");
    assert.ok(searchedPaths.has("08-Projects/Training/seance-0.md"), "the dropped session must stay reachable");
    for (const note of moduleNotes) {
      assert.ok(!searchedPaths.has(note.path), `${note.path} was sent twice`);
    }
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}));

test("the assistant retrieves configured revision sources and the relevant middle of detailed course notes", () => scratchVault(async (root) => {
  const keys = [
    "SECOND_BRAIN_PLAN",
    "MEMO_BRIDGE_URL",
    "MEMO_TOKEN",
    "REVISION_PROJECT_DIR",
    "REVISION_SOURCE_CORPUS_DIR",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  const revisionProject = "08-Projects/Partiels-Radiologie-2026";
  const corpus = path.join(root, "source-corpus");
  process.env.SECOND_BRAIN_PLAN = "pro";
  process.env.MEMO_BRIDGE_URL = "http://bridge.test";
  process.env.MEMO_TOKEN = "test-token";
  process.env.REVISION_PROJECT_DIR = revisionProject;
  process.env.REVISION_SOURCE_CORPUS_DIR = corpus;
  try {
    await writeNote(root, "00-System/Context.md", "System Context", "Contexte de test");
    const detailedPath = `${revisionProject}/Fiche-Exhaustive-IRM.md`;
    await writeNote(
      root,
      detailedPath,
      "IRM - Fiche exhaustive",
      `${"INTRODUCTION-IRM ".repeat(300)} VLE-VA-TRAVAILLEURS-FEMMES-ENCEINTES ${"ANNEXE-IRM ".repeat(300)}`,
    );
    await fs.utimes(path.join(root, detailedPath), new Date("2020-01-01"), new Date("2020-01-01"));
    for (let index = 0; index < MODULE_EVIDENCE_NOTE_LIMIT + 1; index += 1) {
      await writeNote(root, `${revisionProject}/Document-${index}.md`, `Document ${index}`, `DOCUMENT-${index}`);
    }
    await fs.mkdir(path.join(corpus, "6- Module IRM - Niveau 1"), { recursive: true });
    await fs.writeFile(
      path.join(corpus, "6- Module IRM - Niveau 1", "Application du décret.docx.txt"),
      `${"SOURCE-IRM ".repeat(250)} VALEURS-ACTION-ET-VLE-SOURCE-ORIGINALE ${"SUITE-SOURCE ".repeat(250)}`,
      "utf8",
    );

    const state = await readSetupState();
    await saveSetupState({
      ...state,
      modules: { ...state.modules, revisions: true },
      ai: { ...state.ai, primary: "codex", verified: ["codex"], models: { ...state.ai.models, codex: "test-model" } },
    });

    let chat: Record<string, unknown> = {};
    globalThis.fetch = (async (_input, init) => {
      chat = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true, engine: "codex", reply: "ok" }), { status: 200 });
    }) as typeof fetch;

    await askAssistant(
      [{ role: "user", content: "Je révise le support détaillé IRM sur les travailleurs." }],
      "Quelles sont précisément les VLE et les valeurs d'action pour les travailleurs ?",
    );

    const evidence = chat.evidence as Record<string, unknown>;
    assert.match(JSON.stringify(evidence.vault_notes), /VLE-VA-TRAVAILLEURS-FEMMES-ENCEINTES/);
    assert.match(JSON.stringify(evidence.revision_sources), /VALEURS-ACTION-ET-VLE-SOURCE-ORIGINALE/);
    assert.match(JSON.stringify(evidence.revision_sources), /revision-source:\/\/6- Module IRM - Niveau 1/);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}));

test("Daily, Weekly, and Assistant share active module payloads and briefs retain their Markdown sources", () => scratchVault(async (root) => {
  const keys = ["SECOND_BRAIN_PLAN", "MEMO_BRIDGE_URL", "MEMO_TOKEN"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  const payloads = new Map<string, Record<string, unknown>>();
  process.env.SECOND_BRAIN_PLAN = "pro";
  process.env.MEMO_BRIDGE_URL = "http://bridge.test";
  process.env.MEMO_TOKEN = "test-token";
  try {
    const sentinels = [
      ["10-Finance/finance.md", "Finance", "FINANCE-PAYLOAD"],
      ["00-System/Budget.md", "Budget", "BUDGET-PAYLOAD"],
      ["12-Business/business.md", "Business", "BUSINESS-PAYLOAD"],
      ["08-Projects/Training/training.md", "Training", "TRAINING-PAYLOAD"],
      ["08-Projects/Revisions/revisions.md", "Revisions", "REVISIONS-PAYLOAD"],
      ["11-Custom/laboratoire/custom.md", "Custom", "CUSTOM-PAYLOAD"],
    ] as const;
    for (const [relativePath, title, marker] of sentinels) await writeNote(root, relativePath, title, marker);
    await writeNote(root, "11-Custom/_registry/laboratoire.md", "Laboratoire", "registry", "slug: laboratoire\ndaily: true");
    await writeNote(root, "03-Wiki/active.md", "Validated", "LIBRARY-ACTIVE", "status: active");
    await writeNote(root, "03-Wiki/draft.md", "Draft", "LIBRARY-DRAFT", "status: draft");
    await fs.mkdir(path.join(root, "09-Skills", "synthesize-weekly"), { recursive: true });
    await fs.writeFile(path.join(root, "09-Skills", "synthesize-weekly", "SKILL.md"), "# Weekly synthesis\n", "utf8");

    const state = await readSetupState();
    await saveSetupState({
      ...state,
      modules: allModules(state),
      ai: { ...state.ai, primary: "codex", verified: ["codex"], models: { ...state.ai.models, codex: "test-model" } },
    });
    globalThis.fetch = (async (input, init) => {
      const endpoint = new URL(String(input)).pathname;
      payloads.set(endpoint, JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
      const body = endpoint === "/brief"
        ? { ok: true, engine: "codex", brief: `## 🗓️ Daily Brief — ${todayISO()}\n\n### 📌 Suivi\nRien à signaler.\n\n### ✅ Tâches du jour\nRien de nouveau.` }
        : endpoint === "/weekly"
          ? { ok: true, engine: "codex", review: "## 📊 Weekly Review\n\n### 📍 Résultats\nRien.\n\n### 📈 Tendances\nRien.\n\n### ⚠️ Risques\nRien.\n\n### ⚖️ Décisions\nRien.\n\n### 🎯 Semaine suivante\nRien." }
          : { ok: true, engine: "codex", reply: "Réponse fondée sur les modules." };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const daily = await generateDailyBrief({ force: true });
    const weekly = await generateWeeklyReview({ force: true });
    await askAssistant([], "Que dit précisément LIBRARY-DRAFT ?");

    const dailyModules = payloads.get("/brief")?.module_evidence;
    const weeklyModules = payloads.get("/weekly")?.module_evidence;
    const chatEvidence = payloads.get("/chat")?.evidence as Record<string, unknown>;
    for (const payload of [dailyModules, weeklyModules, chatEvidence.module_evidence]) {
      const serialized = JSON.stringify(payload);
      for (const [, , marker] of sentinels) assert.match(serialized, new RegExp(marker));
      assert.doesNotMatch(serialized, /\.json\b/);
    }
    for (const [relativePath] of sentinels) {
      assert.ok((daily.data.sources as string[]).includes(relativePath));
      assert.ok((weekly.data.sources as string[]).includes(relativePath));
    }
    assert.match(JSON.stringify(payloads.get("/brief")?.wiki), /LIBRARY-ACTIVE/);
    assert.doesNotMatch(JSON.stringify(payloads.get("/brief")?.wiki), /LIBRARY-DRAFT/);
    assert.match(JSON.stringify(payloads.get("/weekly")?.library), /LIBRARY-ACTIVE/);
    assert.doesNotMatch(JSON.stringify(payloads.get("/weekly")?.library), /LIBRARY-DRAFT/);
    assert.doesNotMatch(JSON.stringify(chatEvidence.wiki), /LIBRARY-DRAFT/);
    assert.match(JSON.stringify(chatEvidence.vault_notes), /LIBRARY-DRAFT/);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}));
