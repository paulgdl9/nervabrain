import assert from "node:assert/strict";
import test from "node:test";
import { normalizePastedMarkdown } from "../src/lib/note-paste";

test("pasted lines become blocks without splitting fenced code or tables", () => {
  assert.equal(normalizePastedMarkdown("Premier\nDeuxième"), "Premier\n\nDeuxième");
  assert.equal(normalizePastedMarkdown("```js\nconst a = 1;\nconst b = 2;\n```"), "```js\nconst a = 1;\nconst b = 2;\n```");
  assert.equal(normalizePastedMarkdown("| A | B |\n| - | - |\n| 1 | 2 |"), "| A | B |\n| - | - |\n| 1 | 2 |");
});
