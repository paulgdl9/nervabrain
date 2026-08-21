import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { UI_PALETTE_IDS, normalizeUiPalette } from "../src/lib/ui-palette";

test("every supported interface palette survives preference normalization", () => {
  assert.deepEqual(
    UI_PALETTE_IDS.map((palette) => normalizeUiPalette(palette)),
    [...UI_PALETTE_IDS],
  );
});

test("missing and stale palette preferences fall back to the system palette", () => {
  assert.equal(normalizeUiPalette(null), "default");
  assert.equal(normalizeUiPalette("ocean"), "default");
  assert.equal(normalizeUiPalette(""), "default");
});

test("interface palettes leave the app background and wallpaper untouched", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const derivation = css.match(/\[data-palette\] \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.ok(derivation);
  assert.doesNotMatch(derivation, /--bg(?:-2)?\s*:/);
  assert.doesNotMatch(derivation, /--(?:bg-radial-color|grid-dot-color)\s*:/);
});

test("the default palette uses the nine macOS system colours", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const root = css.match(/:root \{([\s\S]*?)\n\}/)?.[1] || "";
  for (const color of ["#0a84ff", "#30d158", "#ffd60a", "#bf5af2", "#ff453a", "#64d2ff", "#ff9f0a", "#5e5ce6", "#ff375f"]) {
    assert.match(root, new RegExp(`--chart-\\d: ${color};`));
  }
});
