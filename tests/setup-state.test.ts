import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  aiSetupPreferences,
  finalizeSetup,
  listCustomPages,
  listNotes,
  readNote,
  readFeeds,
  readSetupState,
  saveSetupState,
  setAiProviderVerified,
  VAULT_FOLDERS,
} from "../src/lib/vault";

async function scratchVault(run: (root: string) => Promise<void>) {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "second-brain-setup-"));
  process.env.SECOND_BRAIN_VAULT = root;
  try {
    await run(root);
  } finally {
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("a fresh seeded vault starts setup at the language step", () => scratchVault(async (root) => {
  const state = await readSetupState();
  assert.equal(state.status, "draft");
  assert.equal(state.currentStep, "language");
  assert.equal(state.automation.briefDetail, "concise");
  assert.deepEqual(
    {
      provider: state.automation.dailyBriefProvider,
      model: state.automation.dailyBriefModel,
      prompt: state.automation.dailyBriefPrompt,
    },
    { provider: "", model: "", prompt: "" },
  );
  assert.deepEqual(state.ai.models, { claude: "", codex: "" });
  assert.deepEqual(state.modules, { finance: false, budget: false, trail: false, trailSync: true, business: false, revisions: false, custom: [] });
  assert.equal((await listNotes("objectives")).length, 0);
  assert.equal((await listNotes("tasks")).length, 0);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, ".second-brain-setup.json"), "utf8")).version, 1);
}));

test("brief detail defaults safely and persists all three supported levels", () => scratchVault(async (root) => {
  const state = await readSetupState();
  for (const briefDetail of ["concise", "balanced", "detailed"] as const) {
    await saveSetupState({
      ...state,
      automation: { ...state.automation, briefDetail },
    });
    assert.equal((await readSetupState()).automation.briefDetail, briefDetail);
  }

  const stored = JSON.parse(await fs.readFile(path.join(root, ".second-brain-setup.json"), "utf8"));
  stored.automation.briefDetail = "unsupported";
  await fs.writeFile(path.join(root, ".second-brain-setup.json"), JSON.stringify(stored), "utf8");
  assert.equal((await readSetupState()).automation.briefDetail, "concise");
}));

test("theme defaults to dark, persists an explicit choice, and migrates a missing or invalid stored value back to dark", () => scratchVault(async (root) => {
  const setupFile = path.join(root, ".second-brain-setup.json");
  const state = await readSetupState();
  assert.equal(state.theme, "dark");

  await saveSetupState({ ...state, theme: "light" });
  assert.equal((await readSetupState()).theme, "light");

  const stored = JSON.parse(await fs.readFile(setupFile, "utf8"));
  delete stored.theme;
  await fs.writeFile(setupFile, JSON.stringify(stored), "utf8");
  assert.equal((await readSetupState()).theme, "dark");

  stored.theme = "purple";
  await fs.writeFile(setupFile, JSON.stringify(stored), "utf8");
  assert.equal((await readSetupState()).theme, "dark");

  stored.theme = "raycast";
  await fs.writeFile(setupFile, JSON.stringify(stored), "utf8");
  assert.equal((await readSetupState()).theme, "dark");
}));

test("legacy demo notes are removed without touching user notes", () => scratchVault(async (root) => {
  const objectives = path.join(root, VAULT_FOLDERS.objectives);
  const tasks = path.join(root, VAULT_FOLDERS.tasks);
  await fs.mkdir(objectives, { recursive: true });
  await fs.mkdir(tasks, { recursive: true });
  await fs.writeFile(path.join(root, ".second-brain-initialized"), "legacy", "utf8");
  await fs.writeFile(path.join(objectives, "demo.md"), [
    "---",
    "title: Build the Obsidian second brain",
    "status: active",
    "---",
    "# Build the Obsidian second brain",
    "",
    "## Current state",
    "A first local Next.js dashboard reads and writes a Markdown vault.",
    "",
    "## Next step",
    "Use the dashboard for real captures, then refine the daily brief loop.",
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(tasks, "demo.md"), [
    "---",
    "title: Launch the local dashboard",
    "source: seed",
    "---",
    "# Launch the local dashboard",
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(tasks, "mine.md"), [
    "---",
    "title: Launch the local dashboard",
    "source: manual",
    "---",
    "# Launch the local dashboard",
    "",
    "My own task must stay.",
  ].join("\n"), "utf8");

  await readSetupState();

  assert.deepEqual((await listNotes("objectives")).map((note) => note.title), []);
  assert.deepEqual((await listNotes("tasks")).map((note) => note.data.source), ["manual"]);
  assert.equal((await fs.readdir(path.join(root, ".trash"))).length, 2);
}));

test("a setup draft resumes from its saved step", () => scratchVault(async () => {
  const state = await readSetupState();
  await saveSetupState({
    ...state,
    currentStep: "feeds",
    locale: "en",
    modules: { finance: true, budget: false, trail: true, trailSync: true, business: true, revisions: true, custom: [] },
  });
  const resumed = await readSetupState();
  assert.equal(resumed.currentStep, "feeds");
  assert.equal(resumed.locale, "en");
  assert.deepEqual(resumed.modules, { finance: true, budget: false, trail: true, trailSync: true, business: true, revisions: true, custom: [] });
}));

test("an existing non-placeholder Context.md migrates as completed", () => scratchVault(async (root) => {
  const system = path.join(root, "00-System");
  await fs.mkdir(system, { recursive: true });
  await fs.writeFile(path.join(system, "Context.md"), "# System Context\n\n## Identity\nA real existing profile.\n", "utf8");
  const state = await readSetupState();
  assert.equal(state.status, "completed");
  assert.deepEqual(state.modules, { finance: true, budget: true, trail: true, trailSync: true, business: false, revisions: false, custom: [] });
}));

test("a Context.md completion marker wins even when its body is a placeholder", () => scratchVault(async (root) => {
  const system = path.join(root, "00-System");
  await fs.mkdir(system, { recursive: true });
  await fs.writeFile(path.join(system, "Context.md"), [
    "---",
    "setup_completed_at: 2026-01-01T00:00:00.000Z",
    "ai_primary: codex",
    "---",
    "# System Context",
    "",
    "## Identity",
    "Replace this with the durable context the assistant should know before every run.",
  ].join("\n"), "utf8");
  const state = await readSetupState();
  assert.equal(state.status, "completed");
  assert.equal(state.ai.primary, "codex");
}));

test("editing a completed legacy setup keeps access and preserves its context body", () => scratchVault(async (root) => {
  const body = [
    "# System Context",
    "",
    "## Identity",
    "A carefully maintained existing profile.",
    "",
    "## Custom section",
    "Keep this wording exactly.",
  ].join("\n");
  const system = path.join(root, "00-System");
  await fs.mkdir(system, { recursive: true });
  await fs.writeFile(path.join(system, "Context.md"), `${body}\n`, "utf8");
  const migrated = await readSetupState();
  await saveSetupState({
    ...migrated,
    currentStep: "feeds",
    modules: { finance: true, budget: false, trail: false, trailSync: true, business: false, revisions: false, custom: [] },
    ai: { primary: "codex", fallback: "", verified: [], models: { claude: "", codex: "" } },
  });

  assert.equal((await readSetupState()).status, "completed");
  await finalizeSetup();
  assert.equal((await readNote("00-System/Context.md"))?.content, body);
}));

test("finalization materializes choices once and marks setup completed", () => scratchVault(async () => {
  const state = await readSetupState();
  await saveSetupState({
    ...state,
    currentStep: "review",
    context: {
      ...state.context,
      identity: "Independent researcher",
      currentPriorities: ["Publish a useful note"],
    },
    feeds: { enabled: true, urls: ["https://example.com/feed.xml"] },
    modules: { ...state.modules, custom: ["Reading"] },
    ai: { primary: "codex", fallback: "", verified: ["codex"], models: { claude: "", codex: "gpt-5.5" } },
    goals: [{ title: "Publish a useful note", area: "Knowledge", nextStep: "Draft the outline" }],
  });

  await finalizeSetup();
  await finalizeSetup();

  const completed = await readSetupState();
  const objectives = await listNotes("objectives");
  const feeds = await readFeeds();
  const customPages = await listCustomPages();
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.ai, { primary: "codex", fallback: "", verified: ["codex"], models: { claude: "", codex: "gpt-5.5" } });
  assert.equal((await readNote("00-System/Context.md"))?.data.ai_codex_model, "gpt-5.5");
  assert.equal(objectives.filter((note) => note.title === "Publish a useful note").length, 1);
  assert.deepEqual(customPages.map((page) => page.title), ["Reading"]);
  assert.deepEqual(feeds.feeds, ["https://example.com/feed.xml"]);
}));

test("finalization leaves revision content to the guided setup", () => scratchVault(async (root) => {
  const state = await readSetupState();
  await saveSetupState({ ...state, modules: { ...state.modules, revisions: true } });

  await finalizeSetup();
  assert.equal(await readNote("08-Projects/Revisions/Programme-Revisions.md"), null);

  const project = path.join(root, "08-Projects", "Revisions");
  await fs.mkdir(project, { recursive: true });
  const program = path.join(project, "Programme-Revisions.md");
  await fs.writeFile(program, "---\ntype: revision_program\ntitle: Programme existant\n---\n# À préserver\n", "utf8");
  await finalizeSetup();
  assert.equal(await fs.readFile(program, "utf8"), "---\ntype: revision_program\ntitle: Programme existant\n---\n# À préserver\n");
}));

test("verified setup provider and model override legacy environment routing", () => scratchVault(async () => {
  const previousPrimary = process.env.MEMO_ENGINE_PRIMARY;
  const state = await readSetupState();
  process.env.MEMO_ENGINE_PRIMARY = "claude";
  try {
    await saveSetupState({
      ...state,
      ai: {
        primary: "codex",
        fallback: "",
        verified: ["codex"],
        models: { claude: "", codex: "gpt-5.5" },
      },
    });
    assert.deepEqual(await aiSetupPreferences("legacy-claude-model"), {
      engineOrder: ["codex"],
      models: { claude: "legacy-claude-model", codex: "gpt-5.5" },
    });
  } finally {
    if (previousPrimary === undefined) delete process.env.MEMO_ENGINE_PRIMARY;
    else process.env.MEMO_ENGINE_PRIMARY = previousPrimary;
  }
}));

test("failed AI re-verification removes the provider and repairs primary/fallback order", () => scratchVault(async () => {
  const state = await readSetupState();
  await saveSetupState({
    ...state,
    ai: {
      primary: "codex",
      fallback: "claude",
      verified: ["codex", "claude"],
      models: { claude: "sonnet", codex: "gpt-5.5" },
    },
  });

  const afterCodexFailure = await setAiProviderVerified("codex", false);
  assert.deepEqual(afterCodexFailure.ai, {
    primary: "claude",
    fallback: "",
    verified: ["claude"],
    models: { claude: "sonnet", codex: "gpt-5.5" },
  });
  assert.deepEqual((await aiSetupPreferences()).engineOrder, ["claude"]);

  const afterClaudeFailure = await setAiProviderVerified("claude", false);
  assert.deepEqual(afterClaudeFailure.ai, {
    primary: "",
    fallback: "",
    verified: [],
    models: { claude: "sonnet", codex: "gpt-5.5" },
  });
}));
