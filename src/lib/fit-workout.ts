import { Decoder, Encoder, Profile, Stream } from "@garmin/fitsdk";
import type { FileIdMesg, WorkoutMesg, WorkoutStepMesg } from "@garmin/fitsdk";
import { loadTrainingPlan, type PlannedSession, type SportKind } from "@/lib/trail";
import { strengthProgramFor, strengthTarget, type StrengthExercisePlan } from "@/lib/strength-program";

// Garmin FIT Profile 21.208 enum values. The official Encoder validates fields,
// writes definitions/header/CRCs, and the official Decoder validates every file.
const FIT = {
  file: { workout: 5 },
  manufacturer: { development: 255 },
  sport: { running: 1, cycling: 2, training: 10 },
  subSport: { generic: 0, trail: 3, indoorCycling: 6, strengthTraining: 20 },
  duration: { time: 0, distance: 1 },
  target: { heartRate: 1, open: 2, power: 4 },
  intensity: { active: 0, rest: 1, warmup: 2, cooldown: 3 },
} as const;

type Step = {
  name: string;
  notes: string;
  durationType: 0 | 1;
  /** Raw FIT value: milliseconds for time, 1/100 m for distance. */
  durationValue: number;
  targetType: 1 | 2 | 4;
  targetValue: number;
  targetLow: number;
  targetHigh: number;
  intensity: 0 | 1 | 2 | 3;
};

export type FitWorkout = {
  bytes: Uint8Array;
  fileName: string;
  session: PlannedSession;
  steps: Step[];
};

type GarminConnectSport = {
  sportTypeId: number;
  sportTypeKey: string;
  displayOrder: number;
};

type GarminConnectWorkoutStep = {
  type: "ExecutableStepDTO";
  stepId: null;
  stepOrder: number;
  childStepId: number | null;
  description: string | null;
  stepType: { stepTypeId: number; stepTypeKey: string; displayOrder: number };
  endCondition: { conditionTypeId: number; conditionTypeKey: string; displayOrder: number; displayable: boolean };
  endConditionValue: number;
  preferredEndConditionUnit?: null;
  endConditionCompare: null;
  endConditionZone: null;
  targetType: { workoutTargetTypeId: number; workoutTargetTypeKey: string; displayOrder: number };
  targetValueOne: null;
  targetValueTwo: number | null;
  targetValueUnit?: null;
  zoneNumber: null;
  secondaryTargetType?: null;
  secondaryTargetValueOne?: null;
  secondaryTargetValueTwo?: null;
  secondaryTargetValueUnit?: null;
  secondaryZoneNumber?: null;
  strokeType?: { strokeTypeId: number; strokeTypeKey: null; displayOrder: number };
  equipmentType?: { equipmentTypeId: number; equipmentTypeKey: null; displayOrder: number };
  category?: string | null;
  exerciseName?: string | null;
  workoutProvider?: null;
  providerExerciseSourceId?: null;
  weightValue?: number | null;
  weightUnit?: { unitId: number; unitKey: "kilogram"; factor: number } | null;
};

type GarminConnectRepeatGroup = {
  type: "RepeatGroupDTO";
  stepId: null;
  stepOrder: number;
  stepType: { stepTypeId: 6; stepTypeKey: "repeat"; displayOrder: 6 };
  childStepId: number;
  numberOfIterations: number;
  workoutSteps: GarminConnectWorkoutStep[];
  endConditionValue: number;
  preferredEndConditionUnit: null;
  endConditionCompare: null;
  endCondition: { conditionTypeId: 7; conditionTypeKey: "iterations"; displayOrder: 7; displayable: false };
  skipLastRestStep: boolean;
  smartRepeat: false;
};

type GarminConnectWorkoutNode = GarminConnectWorkoutStep | GarminConnectRepeatGroup;

export type GarminConnectWorkoutJson = {
  workoutId: null;
  ownerId: null;
  workoutName: string;
  description: string;
  sportType: GarminConnectSport;
  estimatedDurationInSecs: number;
  workoutSegments: Array<{
    segmentOrder: number;
    sportType: GarminConnectSport;
    workoutSteps: GarminConnectWorkoutNode[];
  }>;
};

export type GarminConnectWorkout = {
  data: GarminConnectWorkoutJson;
  fileName: string;
  session: PlannedSession;
  steps: Step[];
};

const KG_UNIT = { unitId: 8, unitKey: "kilogram", factor: 1000 } as const;

function parseDistanceKm(label: string): number | null {
  const range = label.match(/(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*km/i);
  if (range) return (Number(range[1].replace(",", ".")) + Number(range[2].replace(",", "."))) / 2;
  const value = label.match(/(\d+(?:[.,]\d+)?)\s*km/i);
  return value ? Number(value[1].replace(",", ".")) : null;
}

function timeStep(
  name: string,
  seconds: number,
  intensity: Step["intensity"],
  notes: string,
  targetType: Step["targetType"] = FIT.target.open,
  targetValue = 0,
  targetLow = 0,
  targetHigh = 0,
): Step {
  return {
    name,
    notes,
    durationType: FIT.duration.time,
    durationValue: Math.max(1, Math.round(seconds * 1000)),
    targetType,
    targetValue,
    targetLow,
    targetHigh,
    intensity,
  };
}

function sessionSteps(session: PlannedSession): Step[] {
  if (session.sport === "run") {
    const mainNotes = session.details.slice(1).join(" · ");
    const distanceKm = parseDistanceKm(session.subtitle);
    const main: Step = distanceKm
      ? {
          name: session.title,
          notes: mainNotes,
          durationType: FIT.duration.distance,
          durationValue: Math.round(distanceKm * 1000 * 100),
          targetType: FIT.target.heartRate,
          targetValue: 2,
          targetLow: 0,
          targetHigh: 0,
          intensity: FIT.intensity.active,
        }
      : timeStep(session.title, (session.durationMin || 30) * 60, FIT.intensity.active, mainNotes, FIT.target.heartRate, 2);
    return [timeStep("Echauffement", 5 * 60, FIT.intensity.warmup, session.details[0] || "Marche rapide"), main];
  }

  if (session.sport === "ride") {
    if (/sweet spot/i.test(session.title)) {
      const steps: Step[] = [timeStep("Echauffement", 10 * 60, FIT.intensity.warmup, "Progressif et souple")];
      for (let round = 1; round <= 3; round++) {
        // Absolute power targets are encoded with the FIT workoutPower +1000 offset.
        steps.push(timeStep(`Sweet spot ${round}/3`, 10 * 60, FIT.intensity.active, "Tenir 135-142 W", FIT.target.power, 0, 1135, 1142));
        if (round < 3) steps.push(timeStep(`Recuperation ${round}/2`, 5 * 60, FIT.intensity.rest, "Pedalage tres facile"));
      }
      steps.push(timeStep("Retour au calme", 10 * 60, FIT.intensity.cooldown, "Souple"));
      return steps;
    }
    return [timeStep(session.title, (session.durationMin || 45) * 60, FIT.intensity.active, session.details.join(" · "), FIT.target.heartRate, 2)];
  }

  if (session.sport === "strength") {
    const totalSeconds = (session.durationMin || 60) * 60;
    const warmupSeconds = 5 * 60;
    const workSeconds = Math.max(5 * 60, Math.floor((totalSeconds - warmupSeconds) / Math.max(1, session.details.length)));
    return [
      timeStep("Echauffement", warmupSeconds, FIT.intensity.warmup, "Mobilite et montee en charge progressive"),
      ...session.details.map((detail, index) => timeStep(`Bloc ${index + 1}`, workSeconds, FIT.intensity.active, detail)),
    ];
  }

  throw new Error("Cette séance ne peut pas être exportée au format FIT");
}

function sportProfile(session: PlannedSession): { sport: number; subSport: number } {
  if (session.sport === "run") {
    const isTrail = session.details.some((detail) => /D\+|pente/i.test(detail));
    return { sport: FIT.sport.running, subSport: isTrail ? FIT.subSport.trail : FIT.subSport.generic };
  }
  if (session.sport === "ride") return { sport: FIT.sport.cycling, subSport: /sweet spot/i.test(session.title) ? FIT.subSport.indoorCycling : FIT.subSport.generic };
  if (session.sport === "strength") return { sport: FIT.sport.training, subSport: FIT.subSport.strengthTraining };
  throw new Error("Sport FIT non pris en charge");
}

function garminConnectSport(session: PlannedSession): GarminConnectSport {
  if (session.sport === "run") return { sportTypeId: 1, sportTypeKey: "running", displayOrder: 1 };
  if (session.sport === "ride") return { sportTypeId: 2, sportTypeKey: "cycling", displayOrder: 2 };
  if (session.sport === "strength") return { sportTypeId: 5, sportTypeKey: "strength_training", displayOrder: 5 };
  throw new Error("Sport Garmin Connect non pris en charge");
}

function workoutName(session: PlannedSession) {
  const prefix = session.sport === "run" ? "RUN" : session.sport === "ride" ? "BIKE" : "MUSCU";
  return `${prefix} ${session.title.replace(/^Musculation · /, "").replace(/^Vélo · /, "")}`.slice(0, 31);
}

function fileSlug(session: PlannedSession) {
  return workoutName(session).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}

function workoutSerial(sessionId: string, createdAt: Date) {
  let hash = 2166136261;
  for (const char of sessionId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((Math.floor(createdAt.getTime() / 1000) ^ hash) >>> 0) || 1;
}

export async function findPlannedSession(sessionId: string): Promise<PlannedSession | null> {
  const match = /^w(\d+)-d([0-6])-(run|ride|strength|recovery)$/.exec(sessionId);
  if (!match) return null;
  const plan = await loadTrainingPlan();
  const week = plan.weeks[Number(match[1]) - 1];
  if (!week) return null;
  return week.sessions.find((session) => session.id === sessionId) || null;
}

function canExportFit(sport: SportKind): sport is "run" | "ride" | "strength" {
  return sport === "run" || sport === "ride" || sport === "strength";
}

export function createWorkoutFit(session: PlannedSession, createdAt = new Date()): FitWorkout {
  if (!canExportFit(session.sport)) throw new Error("Sport FIT non pris en charge");
  const steps = sessionSteps(session);
  const profile = sportProfile(session);
  const encoder = new Encoder();

  const fileId: FileIdMesg = {
    type: FIT.file.workout,
    manufacturer: FIT.manufacturer.development,
    product: 1,
    serialNumber: workoutSerial(session.id, createdAt),
    timeCreated: createdAt,
    productName: "NervaBrain",
  };
  encoder.onMesg(Profile.MesgNum.FILE_ID, fileId);

  const workout: WorkoutMesg = {
    sport: profile.sport,
    subSport: profile.subSport,
    numValidSteps: steps.length,
    wktName: workoutName(session),
    wktDescription: `${session.subtitle} · ${session.intensity}`,
  };
  encoder.onMesg(Profile.MesgNum.WORKOUT, workout);

  steps.forEach((step, index) => {
    const workoutStep: WorkoutStepMesg = {
      messageIndex: index,
      wktStepName: step.name,
      durationType: step.durationType,
      durationValue: step.durationValue,
      targetType: step.targetType,
      targetValue: step.targetValue,
      customTargetValueLow: step.targetLow,
      customTargetValueHigh: step.targetHigh,
      intensity: step.intensity,
      notes: step.notes,
    };
    encoder.onMesg(Profile.MesgNum.WORKOUT_STEP, workoutStep);
  });

  const bytes = encoder.close();
  return { bytes, fileName: `${session.id}-${fileSlug(session)}.fit`, session, steps };
}

function garminStepType(step: Step): GarminConnectWorkoutStep["stepType"] {
  if (step.intensity === FIT.intensity.warmup) return { stepTypeId: 1, stepTypeKey: "warmup", displayOrder: 1 };
  if (step.intensity === FIT.intensity.cooldown) return { stepTypeId: 2, stepTypeKey: "cooldown", displayOrder: 2 };
  if (step.intensity === FIT.intensity.rest) return { stepTypeId: 4, stepTypeKey: "recovery", displayOrder: 4 };
  return { stepTypeId: 3, stepTypeKey: "interval", displayOrder: 3 };
}

function garminEndCondition(step: Step): Pick<GarminConnectWorkoutStep, "endCondition" | "endConditionValue"> {
  if (step.durationType === FIT.duration.distance) {
    return {
      endCondition: { conditionTypeId: 3, conditionTypeKey: "distance", displayOrder: 3, displayable: true },
      endConditionValue: Math.round(step.durationValue / 100),
    };
  }
  return {
    endCondition: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true },
    endConditionValue: Math.round(step.durationValue / 1000),
  };
}

function garminJsonStep(step: Step, index: number): GarminConnectWorkoutStep {
  const condition = garminEndCondition(step);
  return {
    type: "ExecutableStepDTO",
    stepId: null,
    stepOrder: index + 1,
    childStepId: null,
    description: [step.name, step.notes].filter(Boolean).join(" · ") || null,
    stepType: garminStepType(step),
    ...condition,
    endConditionCompare: null,
    endConditionZone: null,
    targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 },
    targetValueOne: null,
    targetValueTwo: null,
    zoneNumber: null,
  };
}

function garminStrengthStepBase(
  stepOrder: number,
  childStepId: number | null,
  stepType: GarminConnectWorkoutStep["stepType"],
  endCondition: GarminConnectWorkoutStep["endCondition"],
  endConditionValue: number,
): Omit<GarminConnectWorkoutStep, "description" | "category" | "exerciseName" | "weightValue" | "weightUnit"> {
  return {
    type: "ExecutableStepDTO",
    stepId: null,
    stepOrder,
    stepType,
    childStepId,
    endCondition,
    endConditionValue,
    preferredEndConditionUnit: null,
    endConditionCompare: null,
    targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 },
    targetValueOne: null,
    targetValueTwo: childStepId === null ? null : 0,
    targetValueUnit: null,
    zoneNumber: null,
    secondaryTargetType: null,
    secondaryTargetValueOne: null,
    secondaryTargetValueTwo: null,
    secondaryTargetValueUnit: null,
    secondaryZoneNumber: null,
    endConditionZone: null,
    strokeType: { strokeTypeId: 0, strokeTypeKey: null, displayOrder: 0 },
    equipmentType: { equipmentTypeId: 0, equipmentTypeKey: null, displayOrder: 0 },
    workoutProvider: null,
    providerExerciseSourceId: null,
  };
}

function timeCondition(displayOrder = 2): GarminConnectWorkoutStep["endCondition"] {
  return { conditionTypeId: 2, conditionTypeKey: "time", displayOrder, displayable: true };
}

function repsCondition(): GarminConnectWorkoutStep["endCondition"] {
  return { conditionTypeId: 10, conditionTypeKey: "reps", displayOrder: 10, displayable: true };
}

function strengthWarmupStep(): GarminConnectWorkoutStep {
  return {
    ...garminStrengthStepBase(1, null, { stepTypeId: 1, stepTypeKey: "warmup", displayOrder: 1 }, timeCondition(), 300),
    description: "Échauffement général · 5 min",
    category: "CARDIO",
    exerciseName: "",
    weightValue: null,
    weightUnit: null,
  };
}

function strengthExerciseStep(exercise: StrengthExercisePlan, stepOrder: number, childStepId: number): GarminConnectWorkoutStep {
  const condition = exercise.seconds ? timeCondition() : repsCondition();
  const value = exercise.seconds || exercise.repsMax || exercise.repsMin || 1;
  return {
    ...garminStrengthStepBase(stepOrder, childStepId, { stepTypeId: 3, stepTypeKey: "interval", displayOrder: 3 }, condition, value),
    description: `${exercise.label} · ${strengthTarget(exercise)}`,
    category: exercise.category,
    exerciseName: exercise.exerciseName,
    weightValue: exercise.weightKg ?? null,
    weightUnit: KG_UNIT,
  };
}

function strengthRestStep(stepOrder: number, childStepId: number, seconds: number): GarminConnectWorkoutStep {
  return {
    ...garminStrengthStepBase(stepOrder, childStepId, { stepTypeId: 5, stepTypeKey: "rest", displayOrder: 5 }, timeCondition(), seconds),
    description: null,
    category: null,
    exerciseName: null,
    weightValue: -1,
    weightUnit: KG_UNIT,
  };
}

function createStrengthGarminJson(session: PlannedSession, sportType: GarminConnectSport): GarminConnectWorkoutJson {
  const preset = strengthProgramFor(session);
  if (!preset) throw new Error("Programme de musculation structuré introuvable");
  let stepOrder = 1;
  const workoutSteps: GarminConnectWorkoutNode[] = [strengthWarmupStep()];

  preset.exercises.forEach((exercise, index) => {
    const childStepId = index + 1;
    const restSeconds = exercise.restSeconds;
    const groupStepOrder = ++stepOrder;
    workoutSteps.push({
      type: "RepeatGroupDTO",
      stepId: null,
      stepOrder: groupStepOrder,
      stepType: { stepTypeId: 6, stepTypeKey: "repeat", displayOrder: 6 },
      childStepId,
      numberOfIterations: exercise.sets,
      workoutSteps: [
        strengthExerciseStep(exercise, ++stepOrder, childStepId),
        strengthRestStep(++stepOrder, childStepId, restSeconds),
      ],
      endConditionValue: exercise.sets,
      preferredEndConditionUnit: null,
      endConditionCompare: null,
      endCondition: { conditionTypeId: 7, conditionTypeKey: "iterations", displayOrder: 7, displayable: false },
      skipLastRestStep: index === preset.exercises.length - 1,
      smartRepeat: false,
    });
  });

  const estimatedDurationInSecs = 300 + preset.exercises.reduce((sum, exercise, index) => {
    const workSeconds = exercise.seconds ?? 30;
    const restSeconds = index === preset.exercises.length - 1 ? 0 : exercise.restSeconds;
    return sum + exercise.sets * workSeconds + Math.max(0, exercise.sets - 1) * restSeconds;
  }, 0);

  return {
    workoutId: null,
    ownerId: null,
    workoutName: preset.name,
    description: `${preset.description} · ${session.intensity}`,
    sportType,
    estimatedDurationInSecs,
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType,
        workoutSteps,
      },
    ],
  };
}

export function createWorkoutGarminJson(session: PlannedSession): GarminConnectWorkout {
  if (!canExportFit(session.sport)) throw new Error("Sport Garmin Connect non pris en charge");
  const steps = sessionSteps(session);
  const sportType = garminConnectSport(session);
  const data: GarminConnectWorkoutJson = session.sport === "strength" && strengthProgramFor(session)
    ? createStrengthGarminJson(session, sportType)
    : {
        workoutId: null,
        ownerId: null,
        workoutName: workoutName(session),
        description: `${session.subtitle} · ${session.intensity} · ${session.details.join(" · ")}`,
        sportType,
        estimatedDurationInSecs: Math.round((session.durationMin || steps.reduce((sum, step) => sum + (step.durationType === FIT.duration.time ? step.durationValue / 1000 : 0), 0) / 60) * 60),
        workoutSegments: [
          {
            segmentOrder: 1,
            sportType,
            workoutSteps: steps.map(garminJsonStep),
          },
        ],
      };
  return { data, fileName: `${session.id}-${fileSlug(session)}.json`, session, steps };
}

export function validateWorkoutFit(bytes: Uint8Array): { valid: boolean; dataSize: number; globalMessages: number[] } {
  const dataSize = bytes.length >= 8 ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) : 0;
  const integrityDecoder = new Decoder(Stream.fromByteArray([...bytes]));
  if (!integrityDecoder.isFIT() || !integrityDecoder.checkIntegrity()) return { valid: false, dataSize, globalMessages: [] };

  const globalMessages: number[] = [];
  const decoder = new Decoder(Stream.fromByteArray([...bytes]));
  const { messages, errors } = decoder.read({
    mesgDefinitionListener: (definition) => {
      if (!globalMessages.includes(definition.globalMessageNumber)) globalMessages.push(definition.globalMessageNumber);
    },
  });
  const valid = errors.length === 0
    && Boolean(messages.fileIdMesgs?.length)
    && Boolean(messages.workoutMesgs?.length)
    && Boolean(messages.workoutStepMesgs?.length)
    && messages.workoutMesgs?.[0]?.numValidSteps === messages.workoutStepMesgs?.length;
  return { valid, dataSize, globalMessages };
}
