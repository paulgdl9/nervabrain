import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { beginDailyBriefJob, finishDailyBriefJob, readDailyBriefJob } from "../src/lib/daily-brief-job";

test("daily brief job persists one running generation and its result", async (t) => {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "memo-daily-job-"));
  process.env.SECOND_BRAIN_VAULT = vault;
  t.after(async () => {
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
    await fs.rm(vault, { recursive: true, force: true });
  });

  const first = await beginDailyBriefJob();
  const duplicate = await beginDailyBriefJob();
  assert.equal(first.started, true);
  assert.equal(duplicate.started, false);
  assert.equal(duplicate.state.id, first.state.id);

  await finishDailyBriefJob(first.state.id!, { generatedBy: "ai:codex", path: "06-Daily/today.md" });
  const finished = await readDailyBriefJob();
  assert.equal(finished.status, "succeeded");
  assert.equal(finished.generatedBy, "ai:codex");
  assert.equal(finished.path, "06-Daily/today.md");
});
