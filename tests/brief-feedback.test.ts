import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  generateDailyBrief,
  generateWeeklyReview,
  readNote,
  readSetupState,
  saveBriefFeedback,
  saveSetupState,
} from "../src/lib/vault";
import { todayISO } from "../src/lib/dates";

async function scratchVault(run: (root: string) => Promise<void>) {
  const keys = ["SECOND_BRAIN_VAULT", "SECOND_BRAIN_PLAN", "MEMO_BRIDGE_URL", "MEMO_TOKEN"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "memo-brief-feedback-"));
  process.env.SECOND_BRAIN_VAULT = root;
  try {
    await run(root);
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeBrief(
  root: string,
  relativePath: string,
  kind: "daily" | "weekly",
  period: string,
) {
  const fullPath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const periodLine = kind === "daily" ? `date: ${period}` : `week: ${period}`;
  await fs.writeFile(fullPath, [
    "---",
    `type: ${kind}`,
    `title: Test ${kind}`,
    periodLine,
    "status: draft",
    "generated_by: ai:test",
    "generated_at: 2026-07-20T07:00:00.000Z",
    "updated: 2026-07-20T07:00:00.000Z",
    "---",
    `## ${kind === "daily" ? "Daily Brief" : "Weekly Review"} — ${period}`,
    "",
    "### Résultat",
    "Contenu intact.",
    "",
  ].join("\n"), "utf8");
}

test("brief feedback persists in Markdown, remains editable, and does not alter the body", () => scratchVault(async (root) => {
  const relativePath = "06-Daily/2026-07-20.md";
  await writeBrief(root, relativePath, "daily", "2026-07-20");

  const first = await saveBriefFeedback(relativePath, "useful", "Enfin assez direct.");
  assert.equal(first.verdict, "useful");
  assert.equal(first.reason, "Enfin assez direct.");

  let note = await readNote(relativePath);
  assert.ok(note);
  assert.equal(note.data.brief_feedback, "useful");
  assert.equal(note.data.brief_feedback_reason, "Enfin assez direct.");
  assert.equal(note.data.updated, "2026-07-20T07:00:00.000Z");
  assert.match(note.content, /Contenu intact\./);

  await saveBriefFeedback(relativePath, "not_useful", "");
  note = await readNote(relativePath);
  assert.equal(note?.data.brief_feedback, "not_useful");
  assert.equal(note?.data.brief_feedback_reason, undefined);
  assert.match(await fs.readFile(path.join(root, relativePath), "utf8"), /brief_feedback: not_useful/);

  await assert.rejects(
    saveBriefFeedback("02-Raw/not-a-brief.md", "useful"),
    /Brief introuvable/,
  );
}));

test("Daily and Weekly prompts receive bounded feedback without technical paths", () => scratchVault(async (root) => {
  const previousFetch = globalThis.fetch;
  const payloads = new Map<string, Record<string, unknown>>();
  process.env.SECOND_BRAIN_PLAN = "pro";
  process.env.MEMO_BRIDGE_URL = "http://bridge.test";
  process.env.MEMO_TOKEN = "test-token";
  try {
    await writeBrief(root, "06-Daily/2026-07-20.md", "daily", "2026-07-20");
    await writeBrief(root, "07-Weekly/2026-W29.md", "weekly", "2026-W29");
    await saveBriefFeedback("06-Daily/2026-07-20.md", "not_useful", "Trop long.");
    await saveBriefFeedback("07-Weekly/2026-W29.md", "useful", "Décision claire.");

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
    await fs.mkdir(path.join(root, "09-Skills", "synthesize-weekly"), { recursive: true });
    await fs.writeFile(path.join(root, "09-Skills", "synthesize-weekly", "SKILL.md"), "# Weekly synthesis\n", "utf8");

    globalThis.fetch = (async (input, init) => {
      const endpoint = new URL(String(input)).pathname;
      payloads.set(endpoint, JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
      const body = endpoint === "/brief"
        ? {
            ok: true,
            engine: "codex",
            brief: `## 🗓️ Daily Brief — ${todayISO()}\n\n### 📌 Suivi\nRien à signaler.\n\n### ✅ Tâches du jour\nRien de nouveau.`,
          }
        : {
            ok: true,
            engine: "codex",
            review: "## 📊 Weekly Review\n\n### 📍 Résultats\nRien.\n\n### 📈 Tendances\nRien.\n\n### ⚠️ Risques\nRien.\n\n### ⚖️ Décisions\nRien.\n\n### 🎯 Semaine suivante\nRien.",
          };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await generateDailyBrief({ force: true });
    await generateWeeklyReview({ force: true });

    for (const endpoint of ["/brief", "/weekly"]) {
      const feedback = payloads.get(endpoint)?.synthesis_feedback;
      const serialized = JSON.stringify(feedback);
      assert.match(serialized, /Trop long\./);
      assert.match(serialized, /Décision claire\./);
      assert.doesNotMatch(serialized, /06-Daily|07-Weekly|\.md/);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
}));
