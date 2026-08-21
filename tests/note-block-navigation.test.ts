import assert from "node:assert/strict";
import test from "node:test";
import { verticalBlockNavigation } from "../src/lib/note-block-navigation";

test("vertical block navigation only leaves a collapsed cursor at a text boundary", () => {
  assert.equal(verticalBlockNavigation({ key: "ArrowUp", selectionStart: 0, selectionEnd: 0, textLength: 4 }), "previous");
  assert.equal(verticalBlockNavigation({ key: "ArrowDown", selectionStart: 4, selectionEnd: 4, textLength: 4 }), "next");
  assert.equal(verticalBlockNavigation({ key: "ArrowUp", selectionStart: 2, selectionEnd: 2, textLength: 4 }), null);
  assert.equal(verticalBlockNavigation({ key: "ArrowDown", selectionStart: 1, selectionEnd: 3, textLength: 4 }), null);
  assert.equal(verticalBlockNavigation({ key: "ArrowDown", selectionStart: 4, selectionEnd: 4, textLength: 4, isComposing: true }), null);
  assert.equal(verticalBlockNavigation({ key: "ArrowUp", selectionStart: 0, selectionEnd: 0, textLength: 4, hasModifier: true }), null);
});
