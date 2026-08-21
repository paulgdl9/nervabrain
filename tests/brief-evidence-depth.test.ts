import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateDailyBrief, readSetupState, saveSetupState } from "../src/lib/vault";
import { todayISO } from "../src/lib/dates";

// The evidence bundle used to send objectives as a one-line excerpt and every
// other note truncated at 1800 chars. A recorded salary floor, a project's
// blocker or a task's success condition sitting below that line was absent from
// the brief while looking present in `sources:`, which reads as the model
// ignoring the vault rather than never having been shown it.
async function scratchVault(run: (root: string) => Promise<void>) {
  const keys = ["SECOND_BRAIN_VAULT", "SECOND_BRAIN_PLAN", "MEMO_BRIDGE_URL", "MEMO_TOKEN"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "memo-brief-depth-"));
  process.env.SECOND_BRAIN_VAULT = root;
  process.env.SECOND_BRAIN_PLAN = "pro";
  process.env.MEMO_BRIDGE_URL = "http://bridge.test";
  process.env.MEMO_TOKEN = "test-token";
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

async function writeNote(root: string, relativePath: string, frontmatter: string[], body: string) {
  const full = path.join(root, relativePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, ["---", ...frontmatter, "---", body, ""].join("\n"), "utf8");
}

const FILLER = "Contexte de remplissage qui pousse le fait décisif hors des 1800 premiers caractères. ".repeat(40);

test("the daily bundle carries whole objectives and untruncated note bodies", () => scratchVault(async (root) => {
  await writeNote(root, "04-Objectives/salaire.md", [
    "type: objective",
    'title: "Décrocher un meilleur poste"',
    "status: active",
    "area: Career",
    "priority: low",
  ], `# Décrocher un meilleur poste\n\n${FILLER}\n\n## Plancher\nPlancher réaliste: 39000 euros brut.\n`);

  await writeNote(root, "08-Projects/SampleProject/Process.md", [
    "type: project",
    'title: "Sample Project Process"',
    "status: active",
  ], `# Sample Project Process\n\n${FILLER}\n\n## Blocage\nAucun message LinkedIn envoyé depuis le 13 juillet.\n`);

  await writeNote(root, "05-Tasks/envoyer-messages.md", [
    "type: task",
    'title: "Envoyer 10 messages LinkedIn"',
    "status: todo",
    "area: Business",
    "priority: high",
  ], "# Envoyer 10 messages LinkedIn\n\nPremière ligne anodine.\n\nCondition de réussite: une conversation commerciale avant le 20 juillet.\n");

  const setup = await readSetupState();
  await saveSetupState({
    ...setup,
    ai: { ...setup.ai, primary: "codex", verified: ["codex"], models: { ...setup.ai.models, codex: "test-model" } },
  });

  let payload: Record<string, unknown> = {};
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    payload = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({
      ok: true,
      engine: "codex",
      brief: `## 🗓️ Daily Brief — ${todayISO()}\n\n### 📌 Suivi\nRien à signaler.\n\n### ✅ Tâches du jour\nRien de nouveau.`,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    await generateDailyBrief({ force: true, requireAi: true });
  } finally {
    globalThis.fetch = previousFetch;
  }

  const objectives = payload.objectives as { content?: string }[];
  assert.match(String(objectives[0].content), /Plancher réaliste: 39000 euros brut/);

  const projects = payload.projects as { content?: string }[];
  assert.match(String(projects[0].content), /Aucun message LinkedIn envoyé depuis le 13 juillet/);

  // The excerpt used to shadow the body entirely, so a task's success condition
  // never travelled with it.
  const tasks = payload.open_tasks as { why?: string }[];
  assert.match(String(tasks[0].why), /une conversation commerciale avant le 20 juillet/);
}));
