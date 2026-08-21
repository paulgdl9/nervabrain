import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateDailyBrief, generateWeeklyReview, readSetupState, saveSetupState } from "../src/lib/vault";
import { todayISO, weekStartISO } from "../src/lib/dates";
import { sanitizeBriefOutput } from "../src/lib/markdown";

function assertNoVisibleReferences(content: string) {
  assert.doesNotMatch(content, /\.md\b/i);
  assert.doesNotMatch(content, /\[\[/);
  assert.doesNotMatch(content, /\[(?:Task|Journal|Daily Brief|Objective|Library)\s*:/i);
  assert.doesNotMatch(content, /task-meta/i);
  assert.doesNotMatch(content, /^\s*#{1,6}\s+[^\p{L}\p{N}]*(?:Sources?|Références?)\s*:?\s*$/imu);
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("visible brief output removes technical references and keeps prose", () => {
  const clean = sanitizeBriefOutput([
    "## Synthèse",
    "Le livrable est prêt [Task: Publier] selon [[05-Tasks/Publier.md|la tâche]].",
    "Le journal confirme ce point dans [la note](02-Raw/journal.md).",
    "Le détail vient de 08-Projects/Mon Projet/Project.md.",
    "- Publier. <!-- task-meta {\"objective\":\"Livrer\",\"exec_kind\":\"prepare\"} -->",
    "### Sources",
    "- [[02-Raw/journal.md]]",
    "### Décision",
    "La décision reste claire.",
  ].join("\n"));

  assertNoVisibleReferences(clean);
  assert.match(clean, /Le livrable est prêt/);
  assert.match(clean, /la tâche/);
  assert.match(clean, /### Décision/);
  assert.doesNotMatch(clean, /journal\.md/);
});

test("manual Daily and Weekly generation fail explicitly instead of writing local fallbacks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "memo-ai-brief-"));
  const keys = ["SECOND_BRAIN_VAULT", "MEMO_BRIDGE_URL", "MEMO_TOKEN", "AI_BRIEF_ENDPOINT", "AI_BRIEF_TOKEN", "MEMO_ENV_FILE"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.SECOND_BRAIN_VAULT = root;
  for (const key of keys.slice(1)) delete process.env[key];
  try {
    await assert.rejects(
      generateDailyBrief({ force: true, requireAi: true }),
      /Daily Brief IA indisponible : bridge IA non configuré/,
    );
    await assert.rejects(fs.access(path.join(root, "06-Daily", `${todayISO()}.md`)));
    await assert.rejects(
      generateWeeklyReview({ force: true, requireAi: true }),
      /Weekly Brief IA indisponible : bridge IA non configuré/,
    );
    assert.deepEqual(await fs.readdir(path.join(root, "07-Weekly")), []);
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Daily and Weekly bridge payloads carry the saved detail level and full journal", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "memo-detail-payload-"));
  const keys = ["SECOND_BRAIN_VAULT", "SECOND_BRAIN_PLAN", "MEMO_BRIDGE_URL", "MEMO_TOKEN"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  const payloads: Array<Record<string, unknown>> = [];
  process.env.SECOND_BRAIN_VAULT = root;
  process.env.SECOND_BRAIN_PLAN = "pro";
  process.env.MEMO_BRIDGE_URL = "http://bridge.test";
  process.env.MEMO_TOKEN = "test-token";
  try {
    const state = await readSetupState();
    await saveSetupState({
      ...state,
      ai: { ...state.ai, primary: "codex", verified: ["codex"], models: { ...state.ai.models, codex: "test-model" } },
      automation: {
        ...state.automation,
        briefDetail: "balanced",
        dailyBriefProvider: "codex",
        dailyBriefModel: "daily-test-model",
        dailyBriefPrompt: "CUSTOM-DAILY-INSTRUCTION",
      },
    });
    await fs.mkdir(path.join(root, "09-Skills", "synthesize-weekly"), { recursive: true });
    await fs.writeFile(path.join(root, "09-Skills", "synthesize-weekly", "SKILL.md"), "# Weekly synthesis\n", "utf8");
    await fs.mkdir(path.join(root, "02-Raw"), { recursive: true });
    await fs.writeFile(path.join(root, "02-Raw", `${todayISO()}-journal.md`), [
      "---", `date: ${todayISO()}`, "title: Long journal", "status: active", "---",
      "# Long journal", "A".repeat(2200), "END-OF-DAILY-JOURNAL", "",
    ].join("\n"));
    const previousWeekDate = addDays(weekStartISO(), -1);
    await fs.writeFile(path.join(root, "02-Raw", `${previousWeekDate}-journal.md`), [
      "---", `date: ${previousWeekDate}`, "title: Long weekly journal", "status: active", "---",
      "# Long weekly journal", "A".repeat(2200), "END-OF-WEEKLY-JOURNAL", "",
    ].join("\n"));

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      payloads.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
      const body = url.endsWith("/brief")
        ? { ok: true, engine: "codex", brief: `## 🗓️ Daily Brief — ${todayISO()}\n\n### 📌 Suivi\nRien à signaler.\n\n### ✅ Tâches du jour\nRien de nouveau.` }
        : { ok: true, engine: "codex", review: "## 📊 Weekly Review\n\n### 📍 Résultats\nRien.\n\n### 📈 Tendances\nRien.\n\n### ⚠️ Risques\nRien.\n\n### ⚖️ Décisions\nRien.\n\n### 🎯 Semaine suivante\nRien." };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    await generateDailyBrief({ force: true });
    await generateWeeklyReview({ force: true });

    assert.equal(payloads.length, 2);
    assert.deepEqual(payloads.map((payload) => payload.detail), ["balanced", "balanced"]);
    assert.equal((payloads[0].engine_order as string[])[0], "codex");
    assert.equal((payloads[0].models as Record<string, string>).codex, "daily-test-model");
    assert.match(String(payloads[0].instructions), /CUSTOM-DAILY-INSTRUCTION/);
    assert.equal((payloads[1].models as Record<string, string>).codex, "test-model");
    assert.match(String(payloads[0].context), /END-OF-DAILY-JOURNAL/);
    assert.match(JSON.stringify(payloads[1].journal), /END-OF-WEEKLY-JOURNAL/);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("local Daily and Weekly keep provenance only in frontmatter", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "memo-clean-brief-"));
  const keys = ["SECOND_BRAIN_VAULT", "SECOND_BRAIN_PLAN"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.SECOND_BRAIN_VAULT = root;
  process.env.SECOND_BRAIN_PLAN = "free";
  try {
    const today = todayISO();
    const previousWeekDate = addDays(weekStartISO(), -5);
    await fs.mkdir(path.join(root, "01-Inbox"), { recursive: true });
    await fs.mkdir(path.join(root, "06-Daily"), { recursive: true });
    await fs.writeFile(path.join(root, "01-Inbox", "signal.md"), [
      "---", "title: Signal utile", "status: inbox", `date: ${today}`, "tags:", "  - ai", "---",
      "# Signal utile", "Une information exploitable.", "",
    ].join("\n"));
    await fs.writeFile(path.join(root, "06-Daily", `${previousWeekDate}.md`), [
      "---", "type: daily", `date: ${previousWeekDate}`, "status: draft", "generated_by: local", "---",
      `# Daily Brief - ${previousWeekDate}`, "Un fait vérifié.", "",
    ].join("\n"));

    const daily = await generateDailyBrief({ force: true });
    assertNoVisibleReferences(daily.content);
    assert.doesNotMatch(daily.content, /### À apprendre/);
    assert.doesNotMatch(daily.content, /Trier/);
    assert.doesNotMatch(daily.content, /### À découvrir/);
    assert.match(daily.content, /n’utilise aucune capture brute non classée/);
    assert.ok(Array.isArray(daily.data.sources));
    assert.ok(!daily.data.sources.includes("01-Inbox/signal.md"));

    const weekly = await generateWeeklyReview({ force: true });
    assertNoVisibleReferences(weekly.content);
    assert.doesNotMatch(weekly.content, /## Context updates to consider/);
    assert.ok(Array.isArray(weekly.data.sources));
    assert.ok(weekly.data.sources.some((source) => String(source).endsWith(".md")));

    const state = await readSetupState();
    await saveSetupState({
      ...state,
      automation: { ...state.automation, briefDetail: "detailed" },
    });
    const detailedDaily = await generateDailyBrief({ force: true });
    const detailedWeekly = await generateWeeklyReview({ force: true });
    assert.match(detailedDaily.content, /### État de la synthèse/);
    assert.match(detailedWeekly.content, /### État de la synthèse/);
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("local Daily never surfaces unclassified feed captures or an inbox-triage nag", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "memo-feed-brief-"));
  const keys = ["SECOND_BRAIN_VAULT", "SECOND_BRAIN_PLAN"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.SECOND_BRAIN_VAULT = root;
  process.env.SECOND_BRAIN_PLAN = "free";
  try {
    const today = todayISO();
    await fs.mkdir(path.join(root, "01-Inbox"), { recursive: true });
    const items = [
      { file: "feed-1.md", title: "Le plus ancien article", host: "oldest.example", capturedAt: "2026-07-20T08:00:00.000Z" },
      { file: "feed-2.md", title: "Article intermédiaire", host: "middle.example", capturedAt: "2026-07-21T08:00:00.000Z" },
      { file: "feed-3.md", title: "Le plus récent article", host: "newest.example", capturedAt: "2026-07-22T08:00:00.000Z" },
    ];
    for (const item of items) {
      await fs.writeFile(path.join(root, "01-Inbox", item.file), [
        "---",
        `title: ${item.title}`,
        "status: inbox",
        "source: rss",
        `date: ${today}`,
        `captured_at: ${item.capturedAt}`,
        "tags:",
        "  - rss",
        `  - ${item.host}`,
        "---",
        `# ${item.title}`,
        "",
        "Résumé de l'article.",
        "",
      ].join("\n"));
    }

    const daily = await generateDailyBrief({ force: true });
    assertNoVisibleReferences(daily.content);
    assert.doesNotMatch(daily.content, /Trier/);
    assert.doesNotMatch(daily.content, /### À découvrir/);
    assert.doesNotMatch(daily.content, /Le plus récent article|Article intermédiaire|Le plus ancien article/);
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
