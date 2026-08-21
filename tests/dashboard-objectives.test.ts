import assert from "node:assert/strict";
import test from "node:test";
import {
  dashboardObjectivePriority,
  isSelectableDashboardObjective,
  keepDashboardObjectiveProgress,
  objectiveStaleDays,
} from "../src/lib/dashboard-objectives";

test("primary goal selection keeps every unfinished high-priority objective", () => {
  assert.equal(dashboardObjectivePriority("Priorité élevée"), "high");
  assert.equal(isSelectableDashboardObjective("paused", "high"), true);
  assert.equal(keepDashboardObjectiveProgress("high", 100), true);
  assert.equal(keepDashboardObjectiveProgress("medium", 100), false);
  assert.equal(isSelectableDashboardObjective("completed", "high"), false);
  assert.equal(isSelectableDashboardObjective("abandoned", "high"), false);
});

test("le badge d'inactivité compte les jours depuis le dernier mtime", () => {
  assert.equal(objectiveStaleDays("2026-08-05", "2026-07-29T10:00:00.000Z"), 7);
  // Une note touchée plus tard dans la journée ne rend pas l'objectif « en avance ».
  assert.equal(objectiveStaleDays("2026-08-05", "2026-08-05T18:20:00.000Z"), 0);
  assert.equal(objectiveStaleDays("2026-08-05", undefined), 0);
  assert.equal(objectiveStaleDays("2026-08-05", "pas une date"), 0);
});
