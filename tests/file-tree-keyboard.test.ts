import assert from "node:assert/strict";
import test from "node:test";
import { treeKeyTarget, type TreeRow } from "../src/components/ui/file-tree";

// 00-System (ouvert) > Context.md > 01-Inbox (fermé) > 02-Raw (ouvert) > note.md
const rows: TreeRow[] = [
  { level: 1, expanded: true },
  { level: 2 },
  { level: 1, expanded: false },
  { level: 1, expanded: true },
  { level: 2 },
];

test("les flèches verticales suivent les rangées visibles et s'arrêtent aux bords", () => {
  assert.deepEqual(treeKeyTarget("ArrowDown", rows, 0), { focus: 1 });
  assert.deepEqual(treeKeyTarget("ArrowUp", rows, 1), { focus: 0 });
  assert.equal(treeKeyTarget("ArrowUp", rows, 0), null);
  assert.equal(treeKeyTarget("ArrowDown", rows, rows.length - 1), null);
  assert.deepEqual(treeKeyTarget("Home", rows, 3), { focus: 0 });
  assert.deepEqual(treeKeyTarget("End", rows, 0), { focus: rows.length - 1 });
});

test("droite ouvre le dossier fermé puis descend dans l'arborescence", () => {
  assert.deepEqual(treeKeyTarget("ArrowRight", rows, 2), { toggle: true });
  assert.deepEqual(treeKeyTarget("ArrowRight", rows, 0), { focus: 1 });
  assert.deepEqual(treeKeyTarget("ArrowRight", rows, 1), { focus: 2 });
});

test("gauche referme le dossier ouvert puis remonte au parent", () => {
  assert.deepEqual(treeKeyTarget("ArrowLeft", rows, 3), { toggle: true });
  assert.deepEqual(treeKeyTarget("ArrowLeft", rows, 4), { focus: 3 });
  assert.equal(treeKeyTarget("ArrowLeft", rows, 2), null);
});

test("les autres touches et les index hors liste ne bougent rien", () => {
  assert.equal(treeKeyTarget("a", rows, 0), null);
  assert.equal(treeKeyTarget("ArrowDown", rows, -1), null);
});
