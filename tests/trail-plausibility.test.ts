import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAN,
  activityFitsSession,
  matchWeek,
  planDateIso,
  plannedSessionsFor,
  type TrailActivity,
} from "../src/lib/trail";

const WEEK2 = PLAN[1];
// Saturday of plan week 2: every weekday <= Wednesday is already past-due.
const SATURDAY = new Date(`${planDateIso(WEEK2.week, 5)}T00:00:00`);

// The lone ride of week 2 is Wednesday's "Vélo · Sweet spot" (55' planned).
const SWEET_SPOT = plannedSessionsFor(WEEK2, 2).find((session) => session.sport === "ride");

function ride(weekday: number, durMin: number, id: string): TrailActivity {
  return {
    id,
    date: planDateIso(WEEK2.week, weekday),
    week: WEEK2.week,
    weekday,
    kind: "ride",
    type: "cycling",
    name: id,
    km: 0,
    durS: durMin * 60,
    paceSPerKm: null,
    hr: 130,
    dplus: 0,
    avgPower: null,
    normalizedPower: null,
    calories: null,
    trainingLoad: null,
    maxHr: null,
    avgCadence: null,
    maxCadence: null,
    avgStrideLengthCm: null,
    verticalOscillationCm: null,
    verticalRatio: null,
    groundContactTimeMs: null,
    aerobicTrainingEffect: null,
    anaerobicTrainingEffect: null,
    trainingEffectLabel: null,
    staminaStart: null,
    staminaEnd: null,
    staminaMin: null,
    vo2Max: null,
    hrZones: [],
    powerZones: [],
    timeInZone2S: null,
  };
}

test("activityFitsSession: type must match, and duration must clear the floor when known", () => {
  assert.ok(SWEET_SPOT, "week 2 should have a sweet-spot ride session");
  assert.equal(SWEET_SPOT.durationMin, 55);
  // A run never fits a ride slot regardless of duration.
  assert.equal(activityFitsSession(SWEET_SPOT, { ...ride(2, 60, "x"), kind: "run" }), false);
  // A full-length ride fits; a short easy spin does not.
  assert.equal(activityFitsSession(SWEET_SPOT, ride(2, 55, "full")), true);
  assert.equal(activityFitsSession(SWEET_SPOT, ride(2, 25, "spin")), false);
  // Unknown target duration or unknown activity duration -> can't judge, allow.
  assert.equal(activityFitsSession({ ...SWEET_SPOT, durationMin: null }, ride(2, 25, "y")), true);
  assert.equal(activityFitsSession(SWEET_SPOT, { ...ride(2, 25, "z"), durS: 0 }), true);
});

test("a short spin does not auto-complete the sweet-spot slot; it stays for manual validation", () => {
  const match = matchWeek(WEEK2, [ride(2, 25, "short-spin")], SATURDAY, WEEK2.week);
  const slot = match.sessions.find((session) => session.session.sport === "ride");
  assert.ok(slot);
  assert.equal(slot.activity, null, "the too-short spin must not claim the quality slot");
  assert.notEqual(slot.outcome, "done");
  assert.notEqual(slot.outcome, "moved");
  assert.equal(match.doneCount, 0);
  assert.ok(match.extras.some((activity) => activity.id === "short-spin"), "the spin is bonus volume, not a completion");
});

test("a full-length ride still auto-completes the sweet-spot slot", () => {
  const match = matchWeek(WEEK2, [ride(2, 50, "real-ride")], SATURDAY, WEEK2.week);
  const slot = match.sessions.find((session) => session.session.sport === "ride");
  assert.ok(slot);
  assert.equal(slot.activity?.id, "real-ride");
  assert.equal(slot.outcome, "done");
});

// The reported bug: a full-length but *easy* ride (low Training Effect) was
// auto-validating the planned "Sweet spot" quality session. Intensity must gate.
const easyRide = (id: string) => ({ ...ride(2, 55, id), aerobicTrainingEffect: 1.8, anaerobicTrainingEffect: 0 });
const hardRide = (id: string) => ({ ...ride(2, 55, id), aerobicTrainingEffect: 3.6, anaerobicTrainingEffect: 1.2 });

test("a full-length EASY ride does not validate a quality (sweet-spot) session", () => {
  assert.ok(SWEET_SPOT);
  // Same discipline, full duration, but the effort data reads easy -> no fit.
  assert.equal(activityFitsSession(SWEET_SPOT, easyRide("easy")), false);
  // A genuinely hard ride of the same length fits.
  assert.equal(activityFitsSession(SWEET_SPOT, hardRide("hard")), true);
  // No effort data recorded -> we can't judge intensity, so don't block.
  assert.equal(activityFitsSession(SWEET_SPOT, ride(2, 55, "no-te")), true);
});

test("matchWeek leaves the sweet-spot slot open for an easy full-length ride", () => {
  const match = matchWeek(WEEK2, [easyRide("easy-long")], SATURDAY, WEEK2.week);
  const slot = match.sessions.find((session) => session.session.sport === "ride");
  assert.ok(slot);
  assert.equal(slot.activity, null, "an easy ride must not auto-claim the quality slot");
  assert.notEqual(slot.outcome, "done");
  assert.ok(match.extras.some((activity) => activity.id === "easy-long"), "the easy ride is bonus volume");
});
