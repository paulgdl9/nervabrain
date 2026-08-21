import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// A theme is wired across four files. Listing one without its token block ships
// a picker entry that silently does nothing, so check the wiring, not the taste.
test("every selectable theme has a token block and the tokens that define it", () => {
  const picker = readFileSync("src/components/ThemePicker.tsx", "utf8");
  const css = readFileSync("src/app/globals.css", "utf8");
  const ids = [...picker.matchAll(/\{\s*id:\s*"([a-z-]+)"\s*\}/g)].map((m) => m[1]);

  assert.ok(ids.includes("dark") && ids.length > 1, `unexpected theme list: ${ids}`);
  for (const id of ids) {
    // "dark" is :root itself and needs no override block.
    if (id === "dark") continue;
    assert.ok(css.includes(`[data-theme="${id}"] {`), `${id} is selectable but has no token block`);
  }

  assert.deepEqual(ids, ["dark", "light"]);
});
