import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  backgroundImagePath,
  readBackgroundSettings,
  removeBackground,
  saveBackgroundAppearance,
  saveBackgroundImage,
} from "../src/lib/background";

async function scratchVault(run: (root: string) => Promise<void>) {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "second-brain-background-"));
  process.env.SECOND_BRAIN_VAULT = root;
  try {
    await run(root);
  } finally {
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("wallpaper image and appearance persist in the vault", () => scratchVault(async (root) => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0x11, 0x22, 0xff, 0xd9]);
  const saved = await saveBackgroundImage(jpeg, 42, 7);

  assert.equal(saved.hasImage, true);
  assert.equal(saved.opacity, 42);
  assert.equal(saved.blur, 7);
  assert.ok(saved.version);
  assert.deepEqual(await fs.readFile(backgroundImagePath()), Buffer.from(jpeg));
  assert.equal(path.dirname(backgroundImagePath()), root);

  await saveBackgroundAppearance(105, -4);
  const bounded = await readBackgroundSettings();
  assert.equal(bounded.opacity, 100);
  assert.equal(bounded.blur, 0);
}));

test("removing a wallpaper clears both persistent files", () => scratchVault(async () => {
  await saveBackgroundImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), 30, 0);
  await removeBackground();
  assert.deepEqual(await readBackgroundSettings(), {
    hasImage: false,
    opacity: 30,
    blur: 0,
    version: "",
  });
}));
