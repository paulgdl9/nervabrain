import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readDashboardLayoutPreference,
  readWorkspaceAppearancePreference,
  saveDashboardLayoutPreference,
  saveWorkspaceAppearancePreference,
} from "../src/lib/ui-preferences";

async function scratchVault(run: (root: string) => Promise<void>) {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "second-brain-ui-preferences-"));
  process.env.SECOND_BRAIN_VAULT = root;
  try {
    await run(root);
  } finally {
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("dashboard layout persists in the vault across reads", () => scratchVault(async (root) => {
  assert.equal(await readDashboardLayoutPreference(), null);

  await saveDashboardLayoutPreference({
    order: ["brief", "today"],
    hidden: ["areas"],
    custom: [{ id: "custom:focus", kind: "text", title: "Focus", body: "Ship it", value: "" }],
    sizes: { today: "wide", brief: "standard", unknown: "wide" },
  });

  const reloaded = await readDashboardLayoutPreference();
  assert.deepEqual(reloaded?.order.slice(0, 2), ["brief", "today"]);
  assert.equal(reloaded?.hidden.includes("areas"), true);
  assert.equal(reloaded?.custom[0]?.body, "Ship it");
  assert.deepEqual(reloaded?.sizes, { today: "wide", brief: "standard" });
  assert.equal(JSON.parse(await fs.readFile(path.join(root, ".second-brain-dashboard-layout.json"), "utf8")).version, 1);
}));

test("domain colors and area choices persist in the vault and reject invalid colors", () => scratchVault(async () => {
  assert.equal(await readWorkspaceAppearancePreference(), null);

  await saveWorkspaceAppearancePreference({
    customAreas: ["Research", "Research"],
    hiddenAreas: ["Finance"],
    areaColors: { Research: "#A855F7", Unsafe: "red", Finance: "#40c06d" },
  });

  assert.deepEqual(await readWorkspaceAppearancePreference(), {
    customAreas: ["Research"],
    hiddenAreas: ["Finance"],
    areaColors: { Research: "#a855f7", Finance: "#40c06d" },
  });
}));
