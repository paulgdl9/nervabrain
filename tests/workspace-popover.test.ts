import assert from "node:assert/strict";
import test from "node:test";
import { getWorkspacePopoverPosition } from "../src/components/WorkspacePopover";

test("workspace popover stays inside the viewport above and below its anchor", () => {
  const below = getWorkspacePopoverPosition({ top: 80, bottom: 112, left: 40, width: 100 }, 1000, 800);
  assert.deepEqual(below, { placement: "below", left: 40, width: 200, maxHeight: 360, top: 118, bottom: undefined });

  const above = getWorkspacePopoverPosition({ top: 700, bottom: 732, left: 280, width: 40 }, 320, 800);
  assert.deepEqual(above, { placement: "above", left: 108, width: 200, maxHeight: 360, top: undefined, bottom: 106 });

  const constrained = getWorkspacePopoverPosition({ top: 500, bottom: 532, left: 40, width: 100 }, 1000, 770);
  assert.equal(constrained.maxHeight, 220);
  assert.equal((constrained.top || 0) + constrained.maxHeight, 758);
});
