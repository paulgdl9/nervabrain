import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { aiCredentialsPath, configuredAiCredentials, saveAiCredential } from "../src/lib/ai-credentials";

test("relative AI credential paths resolve inside the shared data volume", () => {
  const previous = process.env.AI_CREDENTIALS_FILE;
  const root = path.join(os.tmpdir(), "second-brain-project");
  try {
    process.env.AI_CREDENTIALS_FILE = "data/private/providers.env";
    assert.equal(aiCredentialsPath(root), path.join(root, "data", "private", "providers.env"));
    process.env.AI_CREDENTIALS_FILE = "../outside.env";
    assert.equal(aiCredentialsPath(root), path.join(root, "data", "ai-credentials.env"));
  } finally {
    if (previous === undefined) delete process.env.AI_CREDENTIALS_FILE;
    else process.env.AI_CREDENTIALS_FILE = previous;
  }
});

test("AI API keys stay in one private local file and are never returned", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "second-brain-ai-"));
  const previous = process.env.AI_CREDENTIALS_FILE;
  const target = path.join(root, "credentials.env");
  process.env.AI_CREDENTIALS_FILE = target;
  try {
    assert.deepEqual(await configuredAiCredentials(), { claude: false, codex: false });
    await Promise.all([
      saveAiCredential("claude", "sk-ant-test-value-long-enough"),
      saveAiCredential("codex", "sk-openai-test-value-long-enough"),
    ]);
    assert.deepEqual(await configuredAiCredentials(), { claude: true, codex: true });
    const stat = await fs.stat(target);
    assert.equal(stat.mode & 0o777, 0o600);
    assert.match(await fs.readFile(target, "utf8"), /^ANTHROPIC_API_KEY=.*\nOPENAI_API_KEY=.*\n$/);
  } finally {
    if (previous === undefined) delete process.env.AI_CREDENTIALS_FILE;
    else process.env.AI_CREDENTIALS_FILE = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("invalid AI API keys are rejected before creating a file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "second-brain-ai-"));
  const previous = process.env.AI_CREDENTIALS_FILE;
  const target = path.join(root, "credentials.env");
  process.env.AI_CREDENTIALS_FILE = target;
  try {
    await assert.rejects(saveAiCredential("claude", "too short"), /invalid_api_key/);
    await assert.rejects(fs.access(target));
  } finally {
    if (previous === undefined) delete process.env.AI_CREDENTIALS_FILE;
    else process.env.AI_CREDENTIALS_FILE = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});
