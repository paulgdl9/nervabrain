import assert from "node:assert/strict";
import test from "node:test";
import {
  ENDURANCE_EVENTS,
  eventsForSport,
  trainingLevelSummary,
  trainingPlanStartISO,
  trainingWeeksAvailable,
} from "../src/lib/endurance-events";

test("endurance event catalog has stable unique ids and official HTTPS sources", () => {
  assert.equal(new Set(ENDURANCE_EVENTS.map((event) => event.id)).size, ENDURANCE_EVENTS.length);
  assert.ok(ENDURANCE_EVENTS.some((event) => event.sport === "run"));
  assert.ok(ENDURANCE_EVENTS.some((event) => event.sport === "trail"));
  assert.ok(ENDURANCE_EVENTS.some((event) => event.sport === "ride"));
  for (const event of ENDURANCE_EVENTS) {
    assert.match(event.sourceUrl, /^https:\/\//);
    assert.ok(event.distanceKm > 0);
    assert.ok(event.elevationM >= 0);
  }
});

test("eventsForSport excludes past editions without an API call", () => {
  assert.ok(eventsForSport("ride", "2026-07-20").every((event) => event.date >= "2026-07-20"));
  assert.ok(eventsForSport("ride", "2026-07-20").some((event) => event.date.startsWith("2027-")));
  assert.ok(eventsForSport("run", "2026-07-20").every((event) => event.sport === "run" && event.date >= "2026-07-20"));
});

test("trainingPlanStartISO starts on Monday and includes the event week", () => {
  assert.equal(trainingPlanStartISO("2026-09-27", 12), "2026-07-06");
  assert.equal(trainingPlanStartISO("2026-08-28", 4), "2026-08-03");
  assert.equal(trainingPlanStartISO("2026-02-30", 12), "");
  assert.equal(trainingPlanStartISO("2026-09-27", 0), "");
});

test("trainingWeeksAvailable prevents a new plan from starting in the past", () => {
  assert.equal(trainingWeeksAvailable("2026-08-27", "2026-07-15"), 7);
  assert.equal(trainingWeeksAvailable("2026-07-16", "2026-07-15"), 1);
  assert.equal(trainingWeeksAvailable("2026-07-14", "2026-07-15"), 0);
  assert.equal(trainingWeeksAvailable("invalid", "2026-07-15"), 0);
});

test("trainingLevelSummary records measurable inputs instead of a vague level", () => {
  const summary = trainingLevelSummary({
    weeklyVolumeKm: 42,
    sessionsPerWeek: 4,
    longestSessionKm: 18,
    experience: "similar",
    recentReference: "10 km en 47 min",
  });
  assert.match(summary, /42 km\/semaine/);
  assert.match(summary, /4 séances\/semaine/);
  assert.match(summary, /18 km/);
  assert.match(summary, /épreuve comparable/);
  assert.match(summary, /10 km en 47 min/);
});
