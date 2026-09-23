import assert from "node:assert/strict";
import test from "node:test";
import { nextStrengthTargets, type StrengthExercisePlan } from "../src/lib/strength-program";

const row: StrengthExercisePlan = {
  label: "Rowing", category: "ROW", exerciseName: "DUMBBELL_ROW", sets: 3,
  repsMin: 8, repsMax: 12, weightKg: 7, restSeconds: 120,
};

test("strength targets make one safe, measurable improvement from the latest full session", () => {
  assert.deepEqual(nextStrengthTargets(row, [
    { reps: 10, seconds: null, weightKg: 7 },
    { reps: 12, seconds: null, weightKg: 7 },
    { reps: 10, seconds: null, weightKg: 7 },
  ]), [
    { reps: 11, weightKg: 7 },
    { reps: 12, weightKg: 7 },
    { reps: 10, weightKg: 7 },
  ]);
});

test("a configured next load restarts at the bottom of the range", () => {
  assert.deepEqual(nextStrengthTargets({ ...row, nextWeightKg: 8 }, Array.from({ length: 3 }, () => ({ reps: 12, seconds: null, weightKg: 7 }))), [
    { reps: 8, weightKg: 8 }, { reps: 8, weightKg: 8 }, { reps: 8, weightKg: 8 },
  ]);
});
