import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createWorkoutFit, createWorkoutGarminJson, findPlannedSession, validateWorkoutFit } from "../src/lib/fit-workout";
import type { PlannedSession } from "../src/lib/trail";

// findPlannedSession loads the vault training plan (auto-migrating it on first
// read), so point the whole file at a scratch vault, never the real one.
const VAULT = mkdtempSync(path.join(os.tmpdir(), "memo-fit-vault-"));
process.env.SECOND_BRAIN_VAULT = VAULT;
after(() => fs.rm(VAULT, { recursive: true, force: true }));

const CREATED_AT = new Date("2026-07-03T10:00:00Z");

test("FIT workout exports are structurally valid for running, cycling and strength", async () => {
  for (const id of ["w1-d1-run", "w1-d0-ride", "w1-d2-strength"]) {
    const session = await findPlannedSession(id);
    assert.ok(session, `missing planned session ${id}`);
    const workout = createWorkoutFit(session, CREATED_AT);
    const validation = validateWorkoutFit(workout.bytes);

    assert.equal(validation.valid, true);
    assert.deepEqual(validation.globalMessages, [0, 26, 27]);
    assert.equal(workout.bytes[0], 14);
    assert.equal(String.fromCharCode(...workout.bytes.slice(8, 12)), ".FIT");
    assert.match(workout.fileName, new RegExp(`^${id}-.*\\.fit$`));
    assert.ok(workout.steps.length > 0);
  }
});

test("sweet-spot cycling workout contains warmup, three work blocks, recoveries and cooldown", async () => {
  const session = await findPlannedSession("w1-d0-ride");
  assert.ok(session);
  const workout = createWorkoutFit(session, CREATED_AT);

  assert.equal(workout.steps.length, 7);
  assert.deepEqual(workout.steps.filter((step) => step.targetType === 4).map((step) => [step.targetLow, step.targetHigh]), [
    [1135, 1142],
    [1135, 1142],
    [1135, 1142],
  ]);
});

test("distance-based trail sessions are encoded as distance workout steps", async () => {
  const session = await findPlannedSession("w7-d6-run");
  assert.ok(session);
  const workout = createWorkoutFit(session, CREATED_AT);
  const mainStep = workout.steps[1];

  assert.equal(mainStep.durationType, 1);
  assert.equal(mainStep.durationValue, 11 * 1000 * 100);
});

test("Garmin Connect JSON exports are structurally valid for strength import", async () => {
  const session = await findPlannedSession("w1-d2-strength");
  assert.ok(session);
  const workout = createWorkoutGarminJson(session);
  const steps = workout.data.workoutSegments[0].workoutSteps;
  const exerciseNames = steps.flatMap((step) => (
    step.type === "RepeatGroupDTO"
      ? step.workoutSteps.map((child) => child.exerciseName).filter(Boolean)
      : step.exerciseName ? [step.exerciseName] : []
  ));

  assert.match(workout.fileName, /^w1-d2-strength-.*\.json$/);
  assert.equal(workout.data.sportType.sportTypeKey, "strength_training");
  assert.equal(workout.data.workoutSegments.length, 1);
  assert.equal(workout.data.workoutSegments[0].sportType.sportTypeKey, "strength_training");
  assert.equal(steps[0].type, "ExecutableStepDTO");
  assert.equal(steps[0].type === "ExecutableStepDTO" && steps[0].endCondition.conditionTypeKey, "time");
  assert.equal(steps[1].type, "RepeatGroupDTO");
  assert.ok(exerciseNames.includes("DUMBBELL_BULGARIAN_SPLIT_SQUAT"));
  assert.ok(exerciseNames.includes("WEIGHTED_HIP_RAISE"));
  assert.ok(exerciseNames.includes("SEATED_DUMBBELL_TOE_RAISE"));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(workout.data)));
});

test("Push Garmin Connect JSON uses exercise repeat groups from Garmin catalog", async () => {
  const session = await findPlannedSession("w1-d0-strength");
  assert.ok(session);
  const workout = createWorkoutGarminJson(session);
  const steps = workout.data.workoutSegments[0].workoutSteps;
  const groups = steps.filter((step) => step.type === "RepeatGroupDTO");
  const exerciseNames = groups.flatMap((group) => group.type === "RepeatGroupDTO" ? group.workoutSteps.map((step) => step.exerciseName) : []);

  assert.equal(workout.data.workoutName, "PUSH masse");
  assert.equal(steps[0].type === "ExecutableStepDTO" && steps[0].category, "CARDIO");
  assert.equal(groups.length, 6);
  assert.deepEqual(exerciseNames.filter(Boolean).slice(0, 4), ["DUMBBELL_BENCH_PRESS", "DUMBBELL_LATERAL_RAISE", "INCLINE_DUMBBELL_BENCH_PRESS", "SEATED_DUMBBELL_SHOULDER_PRESS"]);
  assert.deepEqual(groups.slice(0, 3).map((group) => group.type === "RepeatGroupDTO" ? group.workoutSteps[0].weightValue : null), [8, 4.5, 8.5]);
  assert.equal(groups.at(-1)?.type === "RepeatGroupDTO" && groups.at(-1)?.skipLastRestStep, true);
});

test("structured Garmin running recipe exports exact steps and duration", () => {
  const session: PlannedSession = {
    id: "w2-d3-run",
    sport: "run",
    title: "Endurance + lignes droites",
    subtitle: "45 min · 6 × 20 s",
    durationMin: 45,
    intensity: "Facile + vitesse gestuelle",
    details: [
      "Garmin: WU=10m;Z2=18m;REP=6x20s@OPEN/100s;CD=5m",
      "Accélérations fluides et jamais sprintées",
    ],
  };

  const fit = createWorkoutFit(session, CREATED_AT);
  const json = createWorkoutGarminJson(session);
  const seconds = fit.steps.reduce((sum, step) => sum + (step.durationType === 0 ? step.durationValue / 1000 : 0), 0);

  assert.equal(fit.steps.length, 15);
  assert.equal(seconds, 45 * 60);
  assert.equal(validateWorkoutFit(fit.bytes).valid, true);
  assert.equal(json.data.estimatedDurationInSecs, 45 * 60);
  assert.equal(json.data.workoutSegments[0].workoutSteps.length, 15);
  const zoneStep = json.data.workoutSegments[0].workoutSteps[1];
  assert.equal(zoneStep.type === "ExecutableStepDTO" && zoneStep.targetType.workoutTargetTypeKey, "heart.rate.zone");
  assert.equal(zoneStep.type === "ExecutableStepDTO" && zoneStep.zoneNumber, 2);
});

test("home-trainer Garmin recipe keeps warmup, open block and cooldown", () => {
  const accentedCoaching = "Cadence régulière, résistance légère et récupération maîtrisée. ".repeat(6);
  const session: PlannedSession = {
    id: "w2-d0-ride",
    sport: "ride",
    title: "Home trainer · endurance facile",
    subtitle: "40 min souples",
    durationMin: 40,
    intensity: "RPE 2–3 · respiration facile",
    details: [
      "Garmin: WU=10m;OPEN=20m;CD=10m",
      accentedCoaching,
    ],
  };

  const fit = createWorkoutFit(session, CREATED_AT);
  const json = createWorkoutGarminJson(session);
  const seconds = fit.steps.reduce((sum, step) => sum + (step.durationType === 0 ? step.durationValue / 1000 : 0), 0);

  assert.equal(fit.steps.length, 3);
  assert.equal(seconds, 40 * 60);
  assert.equal(validateWorkoutFit(fit.bytes).valid, true);
  assert.deepEqual(fit.steps.map((step) => step.intensity), [2, 0, 3]);
  assert.equal(json.data.estimatedDurationInSecs, 40 * 60);
  assert.ok(json.data.description.includes(accentedCoaching));
});

test("strength FIT workout contains repetition-counted exercise steps", async () => {
  const session = await findPlannedSession("w1-d2-strength");
  assert.ok(session);
  const workout = createWorkoutFit(session, CREATED_AT);

  assert.equal(validateWorkoutFit(workout.bytes).valid, true);
  assert.ok(workout.steps.some((step) => step.durationType === 29));
  assert.ok(workout.steps.some((step) => step.name.includes("Soulevé de terre roumain")));
});

test("FIT validation rejects a corrupted payload", async () => {
  const session = await findPlannedSession("w1-d1-run");
  assert.ok(session);
  const workout = createWorkoutFit(session, CREATED_AT);
  const corrupted = workout.bytes.slice();
  corrupted[corrupted.length - 3] ^= 0xff;

  assert.equal(validateWorkoutFit(corrupted).valid, false);
});
