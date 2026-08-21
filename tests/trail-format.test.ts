import assert from "node:assert/strict";
import test from "node:test";
import { activityDiscipline, heartRateZoneDistribution } from "../src/lib/trail-format";
import type { TrailActivity } from "../src/lib/trail";

test("recognizes cross-training and distinguishes easy Z1 from hard Z3+", () => {
  assert.equal(activityDiscipline({ kind: "other", type: "lap_swimming", name: "Piscine" }), "swim");
  assert.equal(activityDiscipline({ kind: "other", type: "hiking", name: "Randonnée" }), "hike");

  const activity = {
    durS: 3600,
    timeInZone2S: 900,
    hrZones: [
      { zone: 1, seconds: 2100 },
      { zone: 2, seconds: 900 },
      { zone: 3, seconds: 600 },
    ],
  } as TrailActivity;
  assert.deepEqual(heartRateZoneDistribution(activity), { z1: 58, z2: 25, z3Plus: 17 });
  assert.deepEqual(heartRateZoneDistribution({
    ...activity,
    hrZones: activity.hrZones.map((zone, index) => ({ ...zone, seconds: [300, 900, 2400][index] })),
  }), { z1: 8, z2: 25, z3Plus: 67 });
  assert.equal(heartRateZoneDistribution({ ...activity, hrZones: [], timeInZone2S: null }), null);
});
