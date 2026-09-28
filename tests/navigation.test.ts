import assert from "node:assert/strict";
import test from "node:test";
import { CONFIGURABLE_NAV_HREFS, normalizeHiddenNavigation } from "../src/lib/navigation";

test("navigation visibility is opt-in for profiles without saved preferences", () => {
  assert.deepEqual(normalizeHiddenNavigation(undefined), []);
});

test("navigation visibility keeps supported unique routes and migrates retired destinations", () => {
  assert.deepEqual(normalizeHiddenNavigation(["/trail", "/trail", "/radio", "/not-real"]), ["/training", "/revisions"]);
  assert.deepEqual(normalizeHiddenNavigation([]), []);
});

test("Settings is never configurable or hideable so navigation can always be recovered", () => {
  assert.equal(CONFIGURABLE_NAV_HREFS.includes("/settings" as never), false);
  assert.deepEqual(normalizeHiddenNavigation(["/settings", "/feeds"]), ["/feeds"]);
});
