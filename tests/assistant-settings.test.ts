import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveAssistantSettingsAction } from "../src/app/actions";
import { readSetupState } from "../src/lib/vault";

test("assistant settings save a manual brief with the full multiline default prompt", async () => {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerva-assistant-settings-"));
  process.env.SECOND_BRAIN_VAULT = root;
  try {
    const prompt = "x\n".repeat(5999) + "xx";
    const form = new FormData();
    for (const [key, value] of Object.entries({
      aiPrimary: "",
      aiFallback: "",
      aiClaudeModel: "",
      aiCodexModel: "",
      briefFrequency: "manual",
      briefTime: "07:00",
      briefTime2: "17:00",
      dailyBriefEngine: "inherit",
      dailyBriefPrompt: prompt.replace(/\n/g, "\r\n"),
      briefDetail: "0",
    })) form.set(key, value);

    await saveAssistantSettingsAction(form).catch(() => undefined);
    const saved = await readSetupState();
    assert.equal(saved.automation.briefFrequency, "manual");
    assert.equal(saved.automation.dailyBriefPrompt, prompt);
  } finally {
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});
