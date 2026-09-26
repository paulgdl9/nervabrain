export type StrengthExercisePlan = {
  label: string;
  category: string;
  exerciseName: string;
  sets: number;
  repsMin?: number;
  repsMax?: number;
  seconds?: number;
  weightKg?: number;
  restSeconds: number;
  rir?: string;
};

export type StrengthSetTarget = {
  repsMin?: number;
  repsMax?: number;
  seconds?: number;
  weightKg?: number;
};

export type StrengthProgram = {
  name: string;
  description: string;
  exercises: StrengthExercisePlan[];
};

const PROGRAMS: Record<"push" | "pull" | "legs" | "stability", StrengthProgram> = {
  push: {
    name: "PUSH masse",
    description: "Hypertrophie haut du corps · RIR 2 sur les développés, 1–2 sur l’isolation",
    exercises: [
      { label: "Développé couché haltères", category: "BENCH_PRESS", exerciseName: "DUMBBELL_BENCH_PRESS", sets: 3, repsMin: 6, repsMax: 10, weightKg: 8, restSeconds: 120, rir: "2" },
      { label: "Élévations latérales", category: "LATERAL_RAISE", exerciseName: "DUMBBELL_LATERAL_RAISE", sets: 3, repsMin: 12, repsMax: 20, weightKg: 4.5, restSeconds: 75, rir: "1–2" },
      { label: "Développé incliné haltères", category: "BENCH_PRESS", exerciseName: "INCLINE_DUMBBELL_BENCH_PRESS", sets: 3, repsMin: 8, repsMax: 12, weightKg: 8.5, restSeconds: 120, rir: "2" },
      { label: "Extension triceps au-dessus de la tête", category: "TRICEPS_EXTENSION", exerciseName: "", sets: 3, repsMin: 10, repsMax: 15, weightKg: 7, restSeconds: 75, rir: "1–2" },
      { label: "Développé épaules assis", category: "SHOULDER_PRESS", exerciseName: "SEATED_DUMBBELL_SHOULDER_PRESS", sets: 2, repsMin: 8, repsMax: 12, weightKg: 6, restSeconds: 120, rir: "2" },
      { label: "Pompes", category: "PUSH_UP", exerciseName: "PUSH_UP", sets: 2, repsMin: 10, repsMax: 12, weightKg: 0, restSeconds: 90 },
    ],
  },
  pull: {
    name: "PULL masse",
    description: "Hypertrophie dos, bras et gainage · RIR 2 sur les tirages, 1–2 sur les accessoires",
    exercises: [
      { label: "Tractions", category: "PULL_UP", exerciseName: "PULL_UP", sets: 4, repsMin: 4, repsMax: 10, weightKg: 0, restSeconds: 120, rir: "1–2" },
      { label: "Oiseau assis, buste penché", category: "FLYE", exerciseName: "DUMBBELL_FLYE", sets: 3, repsMin: 12, repsMax: 20, weightKg: 4.5, restSeconds: 75, rir: "1–2" },
      { label: "Rowing unilatéral haltère", category: "ROW", exerciseName: "DUMBBELL_ROW", sets: 3, repsMin: 8, repsMax: 12, weightKg: 7, restSeconds: 120, rir: "2" },
      { label: "Curl incliné haltères", category: "CURL", exerciseName: "DUMBBELL_BICEPS_CURL", sets: 3, repsMin: 8, repsMax: 12, weightKg: 4.5, restSeconds: 75, rir: "1–2" },
      { label: "Rowing buste penché", category: "ROW", exerciseName: "BENT_OVER_ROW_WITH_DUMBELL", sets: 2, repsMin: 10, repsMax: 15, weightKg: 6, restSeconds: 120, rir: "2" },
      { label: "Curl marteau", category: "CURL", exerciseName: "DUMBBELL_BICEPS_CURL", sets: 2, repsMin: 10, repsMax: 15, weightKg: 6, restSeconds: 75, rir: "1–2" },
      { label: "Hanging knee raises", category: "CORE", exerciseName: "TOES_TO_ELBOWS", sets: 3, repsMin: 8, repsMax: 15, weightKg: 0, restSeconds: 75 },
      { label: "Side plank", category: "PLANK", exerciseName: "SIDE_PLANK", sets: 3, seconds: 30, restSeconds: 60 },
    ],
  },
  legs: {
    name: "JAMBES masse",
    description: "Hypertrophie jambes compatible trail · RIR 2–3, sans échec ni pliométrie",
    exercises: [
      { label: "Bulgarian split squat", category: "LUNGE", exerciseName: "DUMBBELL_BULGARIAN_SPLIT_SQUAT", sets: 3, repsMin: 6, repsMax: 10, weightKg: 6, restSeconds: 120, rir: "2–3" },
      { label: "Soulevé de terre roumain (RDL)", category: "DEADLIFT", exerciseName: "", sets: 3, repsMin: 8, repsMax: 12, weightKg: 22, restSeconds: 120, rir: "2" },
      { label: "Step-up", category: "SQUAT", exerciseName: "ALTERNATING_BOX_DUMBBELL_STEP_UPS", sets: 2, repsMin: 8, repsMax: 12, weightKg: 5, restSeconds: 90, rir: "2–3" },
      { label: "Hip thrust", category: "HIP_RAISE", exerciseName: "WEIGHTED_HIP_RAISE", sets: 2, repsMin: 10, repsMax: 15, weightKg: 10, restSeconds: 90, rir: "2" },
      { label: "Mollets debout unilatéraux", category: "CALF_RAISE", exerciseName: "SINGLE_LEG_STANDING_DUMBBELL_CALF_RAISE", sets: 3, repsMin: 8, repsMax: 15, weightKg: 6, restSeconds: 75, rir: "1–2" },
      { label: "Mollets assis", category: "CALF_RAISE", exerciseName: "SEATED_CALF_RAISE", sets: 2, repsMin: 12, repsMax: 20, weightKg: 16, restSeconds: 60, rir: "1–2" },
      { label: "Tibialis raise", category: "CALF_RAISE", exerciseName: "SEATED_DUMBBELL_TOE_RAISE", sets: 3, repsMin: 15, repsMax: 25, weightKg: 0, restSeconds: 60 },
      { label: "Éversion du pied à l’élastique", category: "BANDED_EXERCISES", exerciseName: "", sets: 2, repsMin: 15, repsMax: 20, restSeconds: 60 },
    ],
  },
  stability: {
    name: "Stabilité trail",
    description: "Chevilles, mollets et gainage · technique propre, sans fatigue résiduelle",
    exercises: [
      { label: "Step-up", category: "SQUAT", exerciseName: "ALTERNATING_BOX_DUMBBELL_STEP_UPS", sets: 2, repsMin: 8, repsMax: 8, weightKg: 0, restSeconds: 45 },
      { label: "Soulevé de terre unipodal", category: "DEADLIFT", exerciseName: "SINGLE_LEG_DEADLIFT", sets: 2, repsMin: 8, repsMax: 8, weightKg: 0, restSeconds: 45 },
      { label: "Mollets isométriques", category: "CALF_RAISE", exerciseName: "SINGLE_LEG_STANDING_DUMBBELL_CALF_RAISE", sets: 2, seconds: 30, weightKg: 0, restSeconds: 45 },
      { label: "Éversion du pied à l’élastique", category: "BANDED_EXERCISES", exerciseName: "", sets: 2, repsMin: 15, repsMax: 15, restSeconds: 45 },
      { label: "Marche latérale à l’élastique", category: "BANDED_EXERCISES", exerciseName: "", sets: 2, repsMin: 10, repsMax: 10, restSeconds: 45 },
      { label: "Gainage latéral", category: "PLANK", exerciseName: "SIDE_PLANK", sets: 2, seconds: 30, weightKg: 0, restSeconds: 45 },
    ],
  },
};

export function strengthProgramFor(session: { title: string; subtitle?: string; strengthExercises?: StrengthExercisePlan[] }): StrengthProgram | null {
  const label = `${session.title} ${session.subtitle || ""}`;
  const base = /push/i.test(label) ? PROGRAMS.push : /pull/i.test(label) ? PROGRAMS.pull : /jambes?/i.test(label) ? PROGRAMS.legs : /stabilit/i.test(label) ? PROGRAMS.stability : null;
  if (!base) return null;
  return session.strengthExercises?.length ? { ...base, exercises: session.strengthExercises } : base;
}

export function strengthTarget(exercise: StrengthExercisePlan): string {
  const effort = exercise.seconds
    ? `${exercise.seconds} s`
    : `${exercise.repsMin ?? exercise.repsMax ?? "?"}${exercise.repsMax && exercise.repsMax !== exercise.repsMin ? `–${exercise.repsMax}` : ""} reps`;
  const load = exercise.weightKg === undefined ? "" : exercise.weightKg === 0 ? " · poids du corps" : ` · ${String(exercise.weightKg).replace(".", ",")} kg`;
  return `${exercise.sets} × ${effort}${load} · repos ${exercise.restSeconds} s${exercise.rir ? ` · RIR ${exercise.rir}` : ""}`;
}

export function plannedStrengthTargets(exercise: StrengthExercisePlan): StrengthSetTarget[] {
  return Array.from({ length: exercise.sets }, () => ({
    ...(exercise.seconds ? { seconds: exercise.seconds } : {
      repsMin: exercise.repsMin || exercise.repsMax || 1,
      repsMax: exercise.repsMax || exercise.repsMin || 1,
    }),
    ...(exercise.weightKg !== undefined ? { weightKg: exercise.weightKg } : {}),
  }));
}
