import assert from "node:assert/strict";
import test from "node:test";
import { plannedStrengthTargets, type StrengthExercisePlan } from "../src/lib/strength-program";

const row: StrengthExercisePlan = {
  label: "Rowing", category: "ROW", exerciseName: "DUMBBELL_ROW", sets: 3,
  repsMin: 8, repsMax: 12, weightKg: 7, restSeconds: 120,
};

test("strength targets show the prescribed objective for every set", () => {
  assert.deepEqual(plannedStrengthTargets(row), [
    { repsMin: 8, repsMax: 12, weightKg: 7 },
    { repsMin: 8, repsMax: 12, weightKg: 7 },
    { repsMin: 8, repsMax: 12, weightKg: 7 },
  ]);
});

test("timed strength targets show the prescribed duration", () => {
  assert.deepEqual(plannedStrengthTargets({ ...row, sets: 2, repsMin: undefined, repsMax: undefined, seconds: 30, weightKg: 0 }), [
    { seconds: 30, weightKg: 0 }, { seconds: 30, weightKg: 0 },
  ]);
});
