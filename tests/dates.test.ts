import assert from "node:assert/strict";
import test from "node:test";
import { todayISO, weekEndISO, weekId, weekStartISO } from "../src/lib/dates";

test("calendar helpers use Europe/Zurich independently from the host timezone", () => {
  const nearMidnight = new Date("2026-01-01T23:30:00.000Z");
  assert.equal(todayISO(nearMidnight, "Europe/Zurich"), "2026-01-02");
  assert.equal(todayISO(nearMidnight, "America/New_York"), "2026-01-01");
});

test("ISO week helpers handle year boundaries in the configured timezone", () => {
  const date = new Date("2026-01-01T23:30:00.000Z");
  assert.equal(weekStartISO(date, "Europe/Zurich"), "2025-12-29");
  assert.equal(weekEndISO(date, "Europe/Zurich"), "2026-01-04");
  assert.equal(weekId(date, "Europe/Zurich"), "2026-W01");
});
