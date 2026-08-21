import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getPlan,
  planAllowsAiSynthesis,
  planAllowsAssistant,
  planAllowsGarmin,
  assistantMonthlyQuota,
} from "../src/lib/plan";
import { recordUsage, usageCount, monthlyCostEstimateUsd, usageMonthKey } from "../src/lib/usage";

function withEnv(vars: Record<string, string | undefined>, run: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    previous[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    run();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("plan defaults to pro so existing single-tenant deploys keep every feature", () => {
  withEnv({ SECOND_BRAIN_PLAN: undefined }, () => {
    assert.equal(getPlan(), "pro");
    assert.equal(planAllowsAiSynthesis(), true);
    assert.equal(planAllowsAssistant(), true);
    assert.equal(planAllowsGarmin(), true);
  });
});

test("free self-hosting keeps core AI synthesis but still applies legacy assistant and garmin gates", () => {
  withEnv({ SECOND_BRAIN_PLAN: "free" }, () => {
    assert.equal(getPlan(), "free");
    assert.equal(planAllowsAiSynthesis(), true);
    assert.equal(planAllowsAssistant(), false);
    assert.equal(planAllowsGarmin(), false);
    assert.equal(assistantMonthlyQuota(), 0);
  });
});

test("plus plan allows hosted AI and assistant but not garmin", () => {
  withEnv({ SECOND_BRAIN_PLAN: "plus", ASSISTANT_MONTHLY_QUOTA: undefined }, () => {
    assert.equal(planAllowsAiSynthesis(), true);
    assert.equal(planAllowsAssistant(), true);
    assert.equal(planAllowsGarmin(), false);
    assert.equal(assistantMonthlyQuota(), 200);
  });
});

test("plus quota is overridable via env; pro is unmetered", () => {
  withEnv({ SECOND_BRAIN_PLAN: "plus", ASSISTANT_MONTHLY_QUOTA: "50" }, () => {
    assert.equal(assistantMonthlyQuota(), 50);
  });
  withEnv({ SECOND_BRAIN_PLAN: "pro" }, () => {
    assert.equal(assistantMonthlyQuota(), Infinity);
  });
});

test("an unknown plan string falls back to pro rather than locking features", () => {
  withEnv({ SECOND_BRAIN_PLAN: "enterprise" }, () => {
    assert.equal(getPlan(), "pro");
    assert.equal(planAllowsAiSynthesis(), true);
  });
});

test("usage counter increments and the monthly cost estimate reflects it", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memo-usage-"));
  const previous = process.env.USAGE_DIR;
  process.env.USAGE_DIR = dir;
  try {
    const month = usageMonthKey();
    assert.equal(await usageCount("assistant", month), 0);
    await recordUsage("assistant", month);
    await recordUsage("assistant", month);
    await recordUsage("brief", month);
    assert.equal(await usageCount("assistant", month), 2);
    assert.equal(await usageCount("brief", month), 1);
    // 2 * 0.075 + 1 * 0.09 = 0.24
    assert.equal(await monthlyCostEstimateUsd(month), 0.24);
  } finally {
    if (previous === undefined) delete process.env.USAGE_DIR;
    else process.env.USAGE_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
