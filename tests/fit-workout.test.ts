import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createWorkoutFit, createWorkoutGarminJson, findPlannedSession, validateWorkoutFit } from "../src/lib/fit-workout";

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
  assert.ok(exerciseNames.includes("BODY_WEIGHT_WALL_SQUAT"));
  assert.ok(exerciseNames.includes("ANKLE_DORSIFLEXION_WITH_BAND"));
  assert.ok(exerciseNames.includes("GLUTE_BRIDGE"));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(workout.data)));
});

test("Push Garmin Connect JSON uses exercise repeat groups from Garmin catalog", async () => {
  const session = await findPlannedSession("w1-d0-strength");
  assert.ok(session);
  const workout = createWorkoutGarminJson(session);
  const steps = workout.data.workoutSegments[0].workoutSteps;
  const groups = steps.filter((step) => step.type === "RepeatGroupDTO");
  const exerciseNames = groups.flatMap((group) => group.type === "RepeatGroupDTO" ? group.workoutSteps.map((step) => step.exerciseName) : []);

  assert.equal(workout.data.workoutName, "Push");
  assert.equal(steps[0].type === "ExecutableStepDTO" && steps[0].exerciseName, "STANDING_T_ROTATION_BALANCE");
  assert.equal(groups.length, 10);
  assert.deepEqual(exerciseNames.filter(Boolean).slice(0, 4), ["PUSH_UPS", "INCLINE_PUSH_UP", "CHEST_PRESS_WITH_BAND", "FLY"]);
  assert.equal(groups.at(-1)?.type === "RepeatGroupDTO" && groups.at(-1)?.skipLastRestStep, true);
});

test("FIT validation rejects a corrupted payload", async () => {
  const session = await findPlannedSession("w1-d1-run");
  assert.ok(session);
  const workout = createWorkoutFit(session, CREATED_AT);
  const corrupted = workout.bytes.slice();
  corrupted[corrupted.length - 3] ^= 0xff;

  assert.equal(validateWorkoutFit(corrupted).valid, false);
});
