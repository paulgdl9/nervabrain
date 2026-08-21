import assert from "node:assert/strict";
import test from "node:test";
import { mergeFeedState } from "../src/lib/vault";

// Regression: a feed larger than FEED_STATE_CAP (300) used to have its tail
// dropped from the seen-state every poll, re-importing those items forever
// (the OpenAI/HuggingFace inbox flood). The seen-state must retain every id
// currently in the feed so the next poll finds nothing fresh.
test("mergeFeedState keeps every current id even past the 300 cap", () => {
  const currentIds = Array.from({ length: 742 }, (_, i) => `id-${i}`);
  const next = mergeFeedState(currentIds, []);
  assert.equal(next.length, 742);
  for (const id of currentIds) assert.ok(next.includes(id), `${id} must stay seen`);

  // Second poll with the same feed: nothing is fresh.
  const seen = new Set(next);
  const fresh = currentIds.filter((id) => !seen.has(id));
  assert.equal(fresh.length, 0);
});

test("mergeFeedState keeps a history margin for items that briefly drop out", () => {
  const previous = Array.from({ length: 300 }, (_, i) => `old-${i}`);
  const currentIds = ["new-1", "new-2"];
  const next = mergeFeedState(currentIds, previous);
  // Small feed: falls back to the 300 cap, current ids stay at the front.
  assert.equal(next.length, 300);
  assert.deepEqual(next.slice(0, 2), ["new-1", "new-2"]);
});

test("mergeFeedState dedupes overlap between current and previous", () => {
  const next = mergeFeedState(["a", "b"], ["b", "c"]);
  assert.deepEqual(next, ["a", "b", "c"]);
});
