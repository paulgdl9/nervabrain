import assert from "node:assert/strict";
import test from "node:test";
import { snapshotSeries, upsertSnapshot, type DailySnapshot } from "../src/lib/snapshots";

test("upsertSnapshot replaces same-day entry and keeps date order", () => {
  const history = [
    { date: "2026-07-20", netWorth: 100 },
    { date: "2026-07-21", netWorth: 110 },
  ];
  const next = upsertSnapshot(history, { date: "2026-07-21", netWorth: 999 });
  assert.equal(next.length, 2);
  assert.equal(next[1].date, "2026-07-21");
  assert.equal(next[1].netWorth, 999);
  // Out-of-order insert lands in the right slot.
  const withOlder = upsertSnapshot(next, { date: "2026-07-19", netWorth: 90 });
  assert.deepEqual(withOlder.map((s) => s.date), ["2026-07-19", "2026-07-20", "2026-07-21"]);
});

test("upsertSnapshot bounds the series to the most recent N days", () => {
  let history: DailySnapshot[] = [];
  for (let day = 1; day <= 10; day += 1) {
    history = upsertSnapshot(history, { date: `2026-07-${String(day).padStart(2, "0")}`, netWorth: day }, 5);
  }
  assert.equal(history.length, 5);
  assert.deepEqual(history.map((s) => s.netWorth), [6, 7, 8, 9, 10]);
});

test("snapshotSeries returns only defined numeric points in order", () => {
  const history = [
    { date: "2026-07-20", netWorth: 100, readiness: 70 },
    { date: "2026-07-21", netWorth: 110 },
    { date: "2026-07-22", netWorth: 120, readiness: 80 },
  ];
  assert.deepEqual(snapshotSeries(history, "netWorth"), [100, 110, 120]);
  // Missing points are skipped, not zero-filled.
  assert.deepEqual(snapshotSeries(history, "readiness"), [70, 80]);
});
