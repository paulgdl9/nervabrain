import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manual Garmin resync uses the profile token volume shared with its worker", async () => {
  const [route, worker] = await Promise.all([
    readFile("src/app/api/trail/resync/route.ts", "utf8"),
    readFile("scripts/run-garmin-sync.sh", "utf8"),
  ]);
  assert.match(route, /"data", "garmin", "sync\.request"/);
  assert.match(worker, /request="\$GARMINTOKENS\/sync\.request"/);
});
