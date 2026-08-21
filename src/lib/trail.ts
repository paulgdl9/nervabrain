import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "@/lib/atomic-write";
import { aiSetupPreferences, listNotes, VAULT_FOLDERS, vaultRoot, type VaultNote } from "@/lib/vault";
// Presentation helpers live in the client-safe trail-format module (no Node
// built-ins). Imported for internal use here and re-exported so existing
// server-side importers of @/lib/trail keep working unchanged.
import { activityDiscipline, fmtPace, fmtDur, fmtKm, fmtMinutes, sportLabel, activitySummary } from "@/lib/trail-format";

export { fmtPace, fmtDur, fmtKm, fmtMinutes, sportLabel, activitySummary };

// Data contract with the RPi cron script (trail-garmin-sync.py), which owns
// the activity JSON. Feedback is written by this app to a separate file so a
// Garmin refresh can never overwrite the athlete's notes.
const SYNC_JSON = "08-Projects/Trail-26K/sync-data.json";
const HEALTH_JSON = "08-Projects/Trail-26K/health-data.json";
const PERFORMANCE_JSON = "08-Projects/Trail-26K/performance-data.json";
const FEEDBACK_JSON = "08-Projects/Trail-26K/feedback-data.json";
const TRAINING_PLAN_JSON = "08-Projects/Training/plan-data.json";
const OVERRIDES_JSON = "08-Projects/Training/plan-overrides.json";
const COACH_DECISION_JSON = "08-Projects/Training/coach-decision.json";
const TRAINING_ARCHIVE_DIR = "08-Projects/Training/archive";

// Carries the bridge's failure classification (quota, auth, timeout,
// unavailable) so a caller can map it to a localized message.
export class AiEngineError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "AiEngineError";
    this.code = code;
  }
}

export const PLAN_START = new Date("2026-06-29T00:00:00");
export const RACE_DAY = new Date("2026-09-20T00:00:00");
export const WEEKS_TOTAL = 12;

export type SportKind = "run" | "ride" | "strength" | "recovery" | "other";

export type TrailActivityZone = {
  zone: number;
  label: string;
  seconds: number;
  percent: number | null;
  lowBoundary: number | null;
  highBoundary: number | null;
};

export type TrailActivity = {
  id: string;
  date: string; // YYYY-MM-DD
  week: number;
  weekday: number; // 0 = Monday
  kind: Exclude<SportKind, "recovery">;
  type: string;
  name: string;
  km: number;
  durS: number;
  paceSPerKm: number | null;
  hr: number | null;
  dplus: number;
  avgPower: number | null;
  normalizedPower: number | null;
  calories: number | null;
  trainingLoad: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  maxCadence: number | null;
  avgStrideLengthCm: number | null;
  verticalOscillationCm: number | null;
  verticalRatio: number | null;
  groundContactTimeMs: number | null;
  aerobicTrainingEffect: number | null;
  anaerobicTrainingEffect: number | null;
  trainingEffectLabel: string | null;
  staminaStart: number | null;
  staminaEnd: number | null;
  staminaMin: number | null;
  vo2Max: number | null;
  hrZones: TrailActivityZone[];
  powerZones: TrailActivityZone[];
  timeInZone2S: number | null;
};

export type TrailFeedback = {
  activityId: string;
  createdAt: string;
  rpe: number;
  pain: number;
  feeling: "great" | "good" | "neutral" | "hard";
  note: string;
};

export type TrailPlanAdjustment = {
  id: string;
  sourcePath: string;
  sourceDate: string;
  sourceLabel: string;
  action: "reschedule" | "cancel";
  sport: Exclude<SportKind, "other">;
  fromIso: string;
  toIso: string | null;
  reason: string;
};

// A user-initiated correction to a single planned session (as opposed to
// TrailPlanAdjustment, which is a best-effort guess mined from journal text).
// One override per session: savePlanOverride replaces any previous override
// for the same sessionId. A validation keeps the effective weekday from a
// previous move so completing a rescheduled session cannot snap it back.
export type PlanOverride = {
  id: string;
  createdAt: string; // ISO
  sessionId: string;
  week: number;
  action: "move" | "cancel" | "validate";
  toWeekday: number | null; // move target, also preserved by validate, 0-6
  reason: string; // cancel only, <=240 chars
  activityId: string | null; // validate only, optional link
};

export type PlannedSession = {
  id: string;
  sport: SportKind;
  title: string;
  subtitle: string;
  durationMin: number | null;
  intensity: string;
  details: string[];
  optional?: boolean;
};

export type TrailSyncData = {
  generatedAt: string | null;
  activities: TrailActivity[];
};

// Health data (sleep, resting HR, HRV, body battery, training readiness) is
// written by the same RPi cron script into a sibling file, kept separate from
// sync-data.json so a health-endpoint failure never touches the activities
// the rest of the dashboard depends on.
export type TrailHealthDay = {
  date: string;
  sleepScore: number | null;
  sleepH: number | null;
  rhr: number | null;
  hrvAvg: number | null;
  bbMin: number | null;
  bbMax: number | null;
  readiness: number | null;
};

export type TrailHealth = {
  generatedAt: string | null;
  user: {
    maxHr: number | null;
    maxHrSource: string | null;
    lactateThresholdHr: number | null;
  };
  days: TrailHealthDay[];
};

export type TrailVo2Point = {
  date: string;
  value: number | null;
  precise: number | null;
};

export type TrailTrainingStatusPoint = {
  date: string;
  phrase: string | null;
  trainingStatus: number | null;
  fitnessTrend: number | null;
  acuteLoad: number | null;
  chronicLoad: number | null;
  acwr: number | null;
  acwrStatus: string | null;
};

export type TrailReadiness = {
  date: string | null;
  score: number | null;
  level: string | null;
  sleepScore: number | null;
  hrvWeeklyAverage: number | null;
  recoveryTimeMinutes: number | null;
};

export type TrailPerformanceData = {
  generatedAt: string | null;
  historyStart: string | null;
  vo2History: TrailVo2Point[];
  trainingStatusHistory: TrailTrainingStatusPoint[];
  readiness: TrailReadiness | null;
};

export type TrailCoachDecision = {
  generatedAt: string;
  activityCount: number | null;
  engine: string;
  summary: string;
  decisions: string[];
  evidence: string[];
  nextAction: string;
};

export type PlanWeek = {
  week: number;
  dates: string;
  phase: 1 | 2 | 3;
  c1: string;
  c2: string;
  c3: string;
  dplus: number;
  runMinTarget: number;
  gate?: string;
};

// The vault-persisted training plan (see loadTrainingPlan below). PlanWeekData
// and PlanSessionData extend the legacy shapes so every existing consumer of
// PlanWeek/PlannedSession keeps working unchanged against the loaded data.
export type PlanObjective = {
  sport: "trail" | "run" | "ride" | "hybrid";
  title: string;
  eventDate: string;
  startDate: string;
  weeksTotal: number;
  eventDistanceKm?: number;
  eventElevationM?: number;
  weeklyVolumeKm?: number;
  longestSessionKm?: number;
  experience?: string;
  recentReference?: string;
  level: string;
  daysPerWeek: number;
  constraints: string;
};

export type PlanPhase = { id: number; name: string; description: string };

export type PlanSessionData = PlannedSession & { weekday: number };

export type PlanWeekData = PlanWeek & { sessions: PlanSessionData[] };

export type PlanData = {
  version: 1;
  generatedBy: string;
  objective: PlanObjective;
  phases: PlanPhase[];
  weeks: PlanWeekData[];
};

export const PLAN: PlanWeek[] = [
  { week: 1, dates: "29/06 - 05/07", phase: 1, c1: "18' plat", c2: "20' plat", c3: "22' plat", dplus: 0, runMinTarget: 60 },
  { week: 2, dates: "06/07 - 12/07", phase: 1, c1: "22' plat", c2: "25' plat", c3: "28' plat", dplus: 0, runMinTarget: 75 },
  { week: 3, dates: "13/07 - 19/07", phase: 1, c1: "25' plat", c2: "28' plat", c3: "32' plat", dplus: 0, runMinTarget: 85 },
  { week: 4, dates: "20/07 - 26/07", phase: 1, c1: "28'", c2: "32'", c3: "38'", dplus: 0, runMinTarget: 98 },
  { week: 5, dates: "27/07 - 02/08", phase: 1, c1: "30'", c2: "35'", c3: "45'", dplus: 0, runMinTarget: 110, gate: "Porte 1 : 40' continu sans douleur" },
  { week: 6, dates: "03/08 - 09/08", phase: 2, c1: "30' facile", c2: "35' vallonné", c3: "~50'", dplus: 300, runMinTarget: 115 },
  { week: 7, dates: "10/08 - 16/08", phase: 2, c1: "35' facile", c2: "40' montées/descente", c3: "10-12 km", dplus: 450, runMinTarget: 150 },
  { week: 8, dates: "17/08 - 23/08", phase: 2, c1: "35-40'", c2: "45' côtes", c3: "14-15 km", dplus: 600, runMinTarget: 177, gate: "Porte 2 : 14-15 km / 600 m D+ sans douleur le lendemain" },
  { week: 9, dates: "24/08 - 30/08", phase: 3, c1: "40'", c2: "50' descentes tech.", c3: "17-18 km", dplus: 800, runMinTarget: 205 },
  { week: 10, dates: "31/08 - 06/09", phase: 3, c1: "40'", c2: "50-55' vallonné", c3: "20 km (pic)", dplus: 1000, runMinTarget: 222 },
  { week: 11, dates: "07/09 - 13/09", phase: 3, c1: "35'", c2: "40' côtes allure course", c3: "14 km (réduit)", dplus: 600, runMinTarget: 165 },
  { week: 12, dates: "14/09 - 20/09", phase: 3, c1: "30' facile", c2: "20' + lignes droites", c3: "COURSE 26 km", dplus: 1400, runMinTarget: 65 },
];

export type WeekStats = {
  plan: PlanWeek;
  activities: TrailActivity[];
  runs: TrailActivity[];
  rides: TrailActivity[];
  strength: TrailActivity[];
  runKm: number;
  runMin: number;
  runDplus: number;
  rideKm: number;
  rideMin: number;
  rideDplus: number;
  strengthMin: number;
  totalMin: number;
  match: WeekMatch;
  status: "done" | "partial" | "current" | "upcoming" | "missed";
};

export type SportProgress = {
  sport: "run" | "ride" | "strength";
  done: number;
  planned: number;
  percent: number;
};

// How a planned session turned out, once the week's activities are matched to
// it tolerant of the day it actually happened.
//   done      – recorded on its planned day
//   moved     – recorded, but on a different day (e.g. Sunday long run done Sat)
//   today     – planned for today, not yet recorded
//   missed    – its day has passed with no matching activity
//   upcoming  – still in the future
//   cancelled – the athlete cancelled it via a PlanOverride; never "missed"
export type SessionOutcome = "done" | "moved" | "today" | "missed" | "upcoming" | "cancelled";

// The trackable disciplines: the only kinds Garmin logs and we can match. A
// recovery/prevention block has no activity and is never scored "missed".
export const TRACKABLE_SPORTS: Array<Exclude<SportKind, "other" | "recovery">> = ["run", "ride", "strength"];

export type MatchedSession = {
  session: PlannedSession;
  plannedWeekday: number;
  plannedIso: string;
  outcome: SessionOutcome;
  activity: TrailActivity | null;
  actualIso: string | null;
  actualWeekday: number | null;
  // True only when the "done" outcome was forced by a "validate" override
  // rather than earned by a matched activity.
  manual: boolean;
  // Present when a PlanOverride applies to this session, so the UI can badge it.
  overrideAction?: "move" | "cancel" | "validate";
  cancelReason?: string;
};

export type WeekMatch = {
  // Trackable planned sessions in weekday order, each resolved to an outcome.
  sessions: MatchedSession[];
  // Activities with no planned slot left to fill (bonus volume).
  extras: TrailActivity[];
  doneCount: number;
  plannedCount: number;
};

export type TrailStats = {
  generatedAt: string | null;
  today: Date;
  daysToRace: number;
  currentWeek: number;
  phaseLabel: string;
  plan: PlanData;
  weeks: WeekStats[];
  allActivities: TrailActivity[];
  allRuns: TrailActivity[];
  allRides: TrailActivity[];
  allStrength: TrailActivity[];
  feedback: TrailFeedback[];
  planAdjustments: TrailPlanAdjustment[];
  planOverrides: PlanOverride[];
  pendingFeedback: TrailActivity[];
  completionPct: number;
  sportProgress: SportProgress[];
  currentWeekActivitiesByDay: Map<number, TrailActivity[]>;
  todayActivities: TrailActivity[];
  todaySessions: PlannedSession[];
  insights: string[];
  nextSession: string;
  health: TrailHealth;
  performance: TrailPerformanceData;
  coachDecision: TrailCoachDecision | null;
};

const PHASE_LABELS: Record<number, string> = {
  1: "Retour à la course continue",
  2: "Construction trail + D+",
  3: "Pic de charge + affûtage",
};

export const DAY_NAMES = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export function plannedFor(week: PlanWeek, weekday: number): string {
  return plannedSessionsFor(week, weekday).map((session) => session.title).join(" + ");
}

function minutesFromLabel(label: string): number | null {
  const values = [...label.matchAll(/(\d+)/g)].map((match) => Number(match[1]));
  if (!values.length || /km/i.test(label)) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function runSession(id: string, title: string, label: string, long = false, dplus = 0): PlannedSession {
  const details = ["5' de marche rapide avant de courir", "Allure facile et conversationnelle", long ? "Raisonner en temps, marcher les pentes raides" : "Foulée relâchée, sans objectif de vitesse"];
  if (dplus) details.push(`Cible terrain : environ ${dplus} m D+`);
  return { id, sport: "run", title, subtitle: label, durationMin: minutesFromLabel(label), intensity: "Z2 · RPE 3–4", details };
}

// Data-driven when the week carries its loaded sessions (the normal, vault-backed
// path); falls back to the legacy hardcoded switch for plain PlanWeek objects
// (the exported PLAN array, and the legacy-parity check in tests/trail-plan.test.ts).
export function plannedSessionsFor(week: PlanWeek | PlanWeekData, weekday: number): PlannedSession[] {
  if ("sessions" in week) return week.sessions.filter((session) => session.weekday === weekday);
  return legacyPlannedSessionsFor(week, weekday);
}

function legacyPlannedSessionsFor(week: PlanWeek, weekday: number): PlannedSession[] {
  const easyBike = week.phase > 1;
  // From week 2 onward, quality bike (sweet spot) runs Wednesday, not Monday:
  // week 2 moved it there in practice (organisation, logged in Journal.md) and
  // the change was made permanent for the rest of phase 1 (see Décisions &
  // adaptations, 09/07). Week 1 stays on Monday since it already happened there.
  const mondayHasRide = easyBike || week.week === 1;
  switch (weekday) {
    case 0:
      return [
        { id: `w${week.week}-d0-strength`, sport: "strength", title: "Musculation · PUSH", subtitle: "Haut du corps", durationMin: 60, intensity: "Force contrôlée", details: ["Séance PUSH habituelle", "Garder 2–3 répétitions en réserve", "Priorité à la qualité d'exécution"] },
        ...(mondayHasRide
          ? [easyBike
              ? { id: `w${week.week}-d0-ride`, sport: "ride" as const, title: "Vélo récupération", subtitle: "Souple et facile", durationMin: 45, intensity: "Z1–Z2", details: ["Cadence fluide", "Aucune intensité", "Terminer plus frais qu'au départ"] }
              : { id: `w${week.week}-d0-ride`, sport: "ride" as const, title: "Vélo · Sweet spot", subtitle: "3 × 10' à 135–142 W", durationMin: 55, intensity: "88–93 % FTP", details: ["10' d'échauffement progressif", "3 × 10' à 135–142 W · récupération 5'", "8–10' de retour au calme"] }]
          : []),
      ];
    case 1:
      return [
        runSession(`w${week.week}-d1-run`, "Course facile", week.c1),
        { id: `w${week.week}-d1-strength`, sport: "strength", title: "Musculation · PULL", subtitle: "Dos et chaîne postérieure", durationMin: 60, intensity: "Force contrôlée", details: ["Séance PULL habituelle", "Garder 2–3 répétitions en réserve", "Pas de série à l'échec"] },
      ];
    case 2:
      return [
        { id: `w${week.week}-d2-strength`, sport: "strength", title: "Jambes + prévention", subtitle: "Force et renforcement tendineux", durationMin: 60, intensity: "Technique", details: ["Squat / Spanish squat · 3 × 12–15", "Mollets excentriques + fibulaires + tibialis", "Fessiers, proprioception et mobilité", ...(week.phase > 1 ? ["Step-downs excentriques · 3 × 8 / jambe"] : [])] },
        ...(!mondayHasRide
          ? [{ id: `w${week.week}-d2-ride`, sport: "ride" as const, title: "Vélo · Sweet spot", subtitle: "3 × 10' à 135–142 W (décalé du lundi)", durationMin: 55, intensity: "88–93 % FTP", details: ["10' d'échauffement progressif", "3 × 10' à 135–142 W · récupération 5'", "8–10' de retour au calme"] }]
          : []),
      ];
    case 3:
      return [runSession(`w${week.week}-d3-run`, week.phase === 1 ? "Course facile" : "Course vallonnée", week.c2)];
    case 4:
      return [{ id: `w${week.week}-d4-recovery`, sport: "recovery", title: "Récupération + prévention", subtitle: "Élastiques et mobilité", durationMin: 20, intensity: "Très facile", details: ["Éversion fibulaires · 2 × 15 / pied", "Flexion dorsale tibialis · 2 × 15 / pied", "Vélo Z2 possible seulement si les jambes sont fraîches"] }];
    case 5:
      return [{ id: `w${week.week}-d5-recovery`, sport: "recovery", title: "Repos", subtitle: "Spin très facile en option", durationMin: null, intensity: "Récupération", optional: true, details: ["Repos complet recommandé", "Option : 20–30' de spin Z1", "Préparer la sortie longue de demain"] }];
    default:
      return [runSession(`w${week.week}-d6-run`, "Sortie longue", week.c3, true, week.dplus)];
  }
}

// --- Vault-persisted training plan ------------------------------------------
// Disk JSON uses snake_case keys (mirrors sync-data.json/feedback-data.json).
// These *Json types describe only the on-disk shape; planToJson/planFromJson
// map between them and the camelCase PlanData used everywhere else.

type PlanObjectiveJson = {
  sport: string;
  title: string;
  event_date: string;
  start_date: string;
  weeks_total: number;
  event_distance_km?: number;
  event_elevation_m?: number;
  weekly_volume_km?: number;
  longest_session_km?: number;
  experience?: string;
  recent_reference?: string;
  level: string;
  days_per_week: number;
  constraints: string;
};

type PlanPhaseJson = { id: number; name: string; description: string };

type PlanSessionJson = {
  id: string;
  sport: string;
  title: string;
  subtitle: string;
  duration_min: number | null;
  intensity: string;
  details: string[];
  optional?: boolean;
  weekday: number;
};

type PlanWeekJson = {
  week: number;
  dates: string;
  phase: number;
  c1: string;
  c2: string;
  c3: string;
  dplus: number;
  run_min_target: number;
  gate?: string;
  sessions: PlanSessionJson[];
};

type PlanDataJson = {
  version: number;
  generated_by: string;
  objective: PlanObjectiveJson;
  phases: PlanPhaseJson[];
  weeks: PlanWeekJson[];
};

function planToJson(plan: PlanData): PlanDataJson {
  return {
    version: plan.version,
    generated_by: plan.generatedBy,
    objective: {
      sport: plan.objective.sport,
      title: plan.objective.title,
      event_date: plan.objective.eventDate,
      start_date: plan.objective.startDate,
      weeks_total: plan.objective.weeksTotal,
      ...(plan.objective.eventDistanceKm !== undefined ? { event_distance_km: plan.objective.eventDistanceKm } : {}),
      ...(plan.objective.eventElevationM !== undefined ? { event_elevation_m: plan.objective.eventElevationM } : {}),
      ...(plan.objective.weeklyVolumeKm !== undefined ? { weekly_volume_km: plan.objective.weeklyVolumeKm } : {}),
      ...(plan.objective.longestSessionKm !== undefined ? { longest_session_km: plan.objective.longestSessionKm } : {}),
      ...(plan.objective.experience !== undefined ? { experience: plan.objective.experience } : {}),
      ...(plan.objective.recentReference !== undefined ? { recent_reference: plan.objective.recentReference } : {}),
      level: plan.objective.level,
      days_per_week: plan.objective.daysPerWeek,
      constraints: plan.objective.constraints,
    },
    phases: plan.phases.map((phase) => ({ id: phase.id, name: phase.name, description: phase.description })),
    weeks: plan.weeks.map((week) => ({
      week: week.week,
      dates: week.dates,
      phase: week.phase,
      c1: week.c1,
      c2: week.c2,
      c3: week.c3,
      dplus: week.dplus,
      run_min_target: week.runMinTarget,
      ...(week.gate ? { gate: week.gate } : {}),
      sessions: week.sessions.map((session) => ({
        id: session.id,
        sport: session.sport,
        title: session.title,
        subtitle: session.subtitle,
        duration_min: session.durationMin,
        intensity: session.intensity,
        details: session.details,
        ...(session.optional ? { optional: true } : {}),
        weekday: session.weekday,
      })),
    })),
  };
}

// Best-effort mapping from parsed disk JSON to the domain shape. Deliberately
// permissive (a missing/mistyped field becomes "", 0 or [] rather than
// throwing) so any parseable JSON reaches validatePlanData, which is the
// single source of truth for "is this plan usable".
function planFromJson(value: unknown): PlanData | null {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  const objectiveRaw = root.objective;
  if (!objectiveRaw || typeof objectiveRaw !== "object" || !Array.isArray(root.phases) || !Array.isArray(root.weeks)) return null;

  try {
    const o = objectiveRaw as Record<string, unknown>;
    const objective: PlanObjective = {
      sport: String(o.sport ?? "") as PlanObjective["sport"],
      title: String(o.title ?? ""),
      eventDate: String(o.event_date ?? ""),
      startDate: String(o.start_date ?? ""),
      weeksTotal: Number(o.weeks_total ?? 0),
      ...(o.event_distance_km !== undefined ? { eventDistanceKm: Number(o.event_distance_km) } : {}),
      ...(o.event_elevation_m !== undefined ? { eventElevationM: Number(o.event_elevation_m) } : {}),
      ...(o.weekly_volume_km !== undefined ? { weeklyVolumeKm: Number(o.weekly_volume_km) } : {}),
      ...(o.longest_session_km !== undefined ? { longestSessionKm: Number(o.longest_session_km) } : {}),
      ...(o.experience !== undefined ? { experience: String(o.experience) } : {}),
      ...(o.recent_reference !== undefined ? { recentReference: String(o.recent_reference) } : {}),
      level: String(o.level ?? ""),
      daysPerWeek: Number(o.days_per_week ?? 0),
      constraints: String(o.constraints ?? ""),
    };

    const phases: PlanPhase[] = (root.phases as unknown[]).map((raw) => {
      const item = raw as Record<string, unknown>;
      return { id: Number(item.id), name: String(item.name ?? ""), description: String(item.description ?? "") };
    });

    const weeks: PlanWeekData[] = (root.weeks as unknown[]).map((raw) => {
      const item = raw as Record<string, unknown>;
      const sessionsRaw = Array.isArray(item.sessions) ? item.sessions : [];
      const sessions: PlanSessionData[] = sessionsRaw.map((rawSession) => {
        const session = rawSession as Record<string, unknown>;
        return {
          id: String(session.id ?? ""),
          sport: session.sport as SportKind,
          title: String(session.title ?? ""),
          subtitle: String(session.subtitle ?? ""),
          durationMin: session.duration_min === null || session.duration_min === undefined ? null : Number(session.duration_min),
          intensity: String(session.intensity ?? ""),
          details: Array.isArray(session.details) ? session.details.map(String) : [],
          ...(session.optional ? { optional: true } : {}),
          weekday: Number(session.weekday),
        };
      });
      return {
        week: Number(item.week),
        dates: String(item.dates ?? ""),
        phase: item.phase as PlanWeek["phase"],
        c1: String(item.c1 ?? ""),
        c2: String(item.c2 ?? ""),
        c3: String(item.c3 ?? ""),
        dplus: Number(item.dplus ?? 0),
        runMinTarget: Number(item.run_min_target ?? 0),
        ...(item.gate ? { gate: String(item.gate) } : {}),
        sessions,
      };
    });

    return {
      version: Number(root.version) as PlanData["version"],
      generatedBy: String(root.generated_by ?? ""),
      objective,
      phases,
      weeks,
    };
  } catch {
    return null;
  }
}

const VALID_SESSION_SPORTS: ReadonlySet<string> = new Set(["run", "ride", "strength", "recovery"]);
const VALID_OBJECTIVE_SPORTS: ReadonlySet<string> = new Set(["run", "trail", "ride", "hybrid"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const parsed = parseIsoDate(value);
  return Boolean(parsed && isoDate(parsed) === value);
}

// Strict structural gate the loaded (or hand-edited) plan must pass before it
// is allowed to drive the app: a plan that fails this is treated exactly like
// a missing file (loadTrainingPlan re-migrates the legacy plan over it).
export function validatePlanData(value: unknown): PlanData | null {
  if (!value || typeof value !== "object") return null;
  const plan = value as Partial<PlanData>;
  if (plan.version !== 1) return null;
  if (typeof plan.generatedBy !== "string") return null;

  const objective = plan.objective;
  if (!objective || typeof objective !== "object") return null;
  if (!VALID_OBJECTIVE_SPORTS.has(objective.sport)) return null;
  if (typeof objective.title !== "string" || !objective.title.trim()) return null;
  if (typeof objective.level !== "string") return null;
  if (typeof objective.constraints !== "string") return null;
  if (objective.experience !== undefined && typeof objective.experience !== "string") return null;
  if (objective.recentReference !== undefined && typeof objective.recentReference !== "string") return null;
  if (!isValidIsoDate(objective.eventDate) || !isValidIsoDate(objective.startDate)) return null;
  if (!Number.isInteger(objective.weeksTotal) || objective.weeksTotal < 1 || objective.weeksTotal > 52) return null;
  if (!Number.isInteger(objective.daysPerWeek) || objective.daysPerWeek < 1 || objective.daysPerWeek > 7) return null;
  if (objective.eventDistanceKm !== undefined && (!Number.isFinite(objective.eventDistanceKm) || objective.eventDistanceKm <= 0)) return null;
  if (objective.eventElevationM !== undefined && (!Number.isFinite(objective.eventElevationM) || objective.eventElevationM < 0)) return null;
  if (objective.weeklyVolumeKm !== undefined && (!Number.isFinite(objective.weeklyVolumeKm) || objective.weeklyVolumeKm < 0)) return null;
  if (objective.longestSessionKm !== undefined && (!Number.isFinite(objective.longestSessionKm) || objective.longestSessionKm < 0)) return null;

  if (!Array.isArray(plan.phases) || plan.phases.length !== 3) return null;
  const phaseIds = new Set<number>();
  for (const phase of plan.phases) {
    if (!phase || !Number.isInteger(phase.id) || typeof phase.name !== "string" || !phase.name.trim()
      || typeof phase.description !== "string" || !phase.description.trim()) return null;
    phaseIds.add(phase.id);
  }
  if (phaseIds.size !== 3 || ![1, 2, 3].every((id) => phaseIds.has(id))) return null;

  if (!Array.isArray(plan.weeks) || plan.weeks.length !== objective.weeksTotal) return null;

  const strictSchedule = plan.generatedBy !== "migration";
  const seenIds = new Set<string>();
  const runSlots: Array<{ day: number; week: number }> = [];
  const sessionSlots: Array<{ day: number; sport: SportKind }> = [];
  const runCounts = new Map<number, number>();
  for (let index = 0; index < plan.weeks.length; index++) {
    const week = plan.weeks[index];
    if (!week || week.week !== index + 1 || !phaseIds.has(week.phase) || !Array.isArray(week.sessions)) return null;
    if (typeof week.dates !== "string" || !week.dates.trim()) return null;
    if (typeof week.c1 !== "string" || typeof week.c2 !== "string" || typeof week.c3 !== "string") return null;
    if (!Number.isInteger(week.dplus) || week.dplus < 0) return null;
    if (!Number.isInteger(week.runMinTarget) || week.runMinTarget < 0) return null;
    if (week.gate !== undefined && (typeof week.gate !== "string" || !week.gate.trim())) return null;
    if (strictSchedule) {
      const optional = week.sessions.filter((session) => session?.optional === true);
      const mandatoryCount = week.sessions.length - optional.length;
      if (mandatoryCount > objective.daysPerWeek || week.sessions.length > objective.daysPerWeek + 1) return null;
      if (optional.length > 1 || optional.some((session) => !["recovery", "ride"].includes(session.sport))) return null;
    }
    let runMinutes = 0;
    let runCount = 0;
    for (const session of week.sessions) {
      if (!session) return null;
      if (!Number.isInteger(session.weekday) || session.weekday < 0 || session.weekday > 6) return null;
      if (!VALID_SESSION_SPORTS.has(session.sport)) return null;
      if (typeof session.id !== "string" || !session.id) return null;
      if (typeof session.title !== "string" || !session.title.trim()) return null;
      if (typeof session.subtitle !== "string" || !session.subtitle.trim()) return null;
      if (typeof session.intensity !== "string" || !session.intensity.trim()) return null;
      if (session.optional !== undefined && typeof session.optional !== "boolean") return null;
      if (session.durationMin === null) {
        if (strictSchedule && session.sport !== "recovery") return null;
      } else if (!Number.isInteger(session.durationMin) || session.durationMin <= 0) return null;
      if (!Array.isArray(session.details) || !session.details.length
        || session.details.some((detail) => typeof detail !== "string" || !detail.trim())) return null;
      if (seenIds.has(session.id)) return null;
      seenIds.add(session.id);
      const absoluteDay = index * 7 + session.weekday;
      sessionSlots.push({ day: absoluteDay, sport: session.sport });
      if (session.sport === "run") {
        runMinutes += session.durationMin || 0;
        runCount += 1;
        runSlots.push({ day: absoluteDay, week: index + 1 });
      }
    }
    runCounts.set(index + 1, runCount);
    if (strictSchedule && week.runMinTarget !== runMinutes) return null;
  }

  if (strictSchedule && (objective.sport === "run" || objective.sport === "trail")) {
    runSlots.sort((left, right) => left.day - right.day);
    for (let index = 1; index < runSlots.length; index++) {
      const previous = runSlots[index - 1];
      const current = runSlots[index];
      if (current.day - previous.day === 1
        && (runCounts.get(previous.week) || 0) <= 3
        && (runCounts.get(current.week) || 0) <= 3) return null;
    }
    const event = parseIsoDate(objective.eventDate);
    if (!event) return null;
    const eventWeekday = (event.getDay() + 6) % 7;
    const eventDay = (objective.weeksTotal - 1) * 7 + eventWeekday;
    if (!sessionSlots.some((slot) => slot.day === eventDay && slot.sport === "run")) return null;
    if (sessionSlots.some((slot) => slot.day === eventDay - 1 && (slot.sport === "run" || slot.sport === "strength"))) return null;
  }

  return plan as PlanData;
}

// --- AI-generated training plan (T4) ----------------------------------------
// Minimal bridge-config equivalent to vault.ts's memoBridgeConfig(): same env
// vars, deliberately without the
// MEMO_ENV_FILE fallback (that plumbing lives in vault.ts and is not needed
// here since the bridge is normally reachable via plain env vars in this
// deployment).
function planBridgeConfig(): { url: string; token: string } | null {
  const rawUrl = process.env.MEMO_BRIDGE_URL || process.env.AI_BRIEF_ENDPOINT || "";
  const token = process.env.MEMO_TOKEN || process.env.AI_BRIEF_TOKEN || "";
  if (!rawUrl || !token) return null;
  return { url: rawUrl, token };
}

// Calls the bridge's POST /plan endpoint and validates the result through the
// same structural gate as a hand-edited plan file. Never throws: any network
// error, non-2xx response, `ok:false`, or structurally invalid plan resolves
// to null so the caller can fall back to fallbackTrainingPlan.
export async function generateAiTrainingPlan(objective: PlanObjective, instructions: string): Promise<PlanData | null> {
  const config = planBridgeConfig();
  if (!config) return null;
  try {
    const ai = await aiSetupPreferences(process.env.PLAN_MODEL);
    if (!ai.engineOrder.length) return null;
    const response = await fetch(`${config.url.replace(/\/+$/, "")}/plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        objective: {
          sport: objective.sport,
          title: objective.title,
          event_date: objective.eventDate,
          start_date: objective.startDate,
          weeks_total: objective.weeksTotal,
          event_distance_km: objective.eventDistanceKm,
          event_elevation_m: objective.eventElevationM,
          weekly_volume_km: objective.weeklyVolumeKm,
          longest_session_km: objective.longestSessionKm,
          experience: objective.experience,
          recent_reference: objective.recentReference,
          level: objective.level,
          days_per_week: objective.daysPerWeek,
          constraints: objective.constraints,
        },
        language: "fr",
        system_context: "",
        instructions,
        engine_order: ai.engineOrder,
        models: ai.models,
      }),
      signal: AbortSignal.timeout(Number(process.env.AI_PLAN_TIMEOUT_MS || 120000)),
    });
    if (!response.ok) return null;
    const json = await response.json().catch(() => null) as { ok?: boolean; plan?: unknown } | null;
    if (!json?.ok || !json.plan) return null;
    const candidate = planFromJson(json.plan);
    return candidate ? validatePlanData(candidate) : null;
  } catch {
    return null;
  }
}

// --- Deterministic fallback training plan (no AI) ---------------------------

const FALLBACK_PHASE_NAMES: Record<PlanObjective["sport"], [string, string, string]> = {
  trail: ["Fondations & robustesse", "Spécifique trail & durabilité", "Affûtage"],
  run: ["Fondations aérobies", "Allure spécifique & endurance", "Affûtage"],
  ride: ["Base aérobie vélo", "Construction & puissance", "Affûtage course"],
  hybrid: ["Base multisport", "Construction croisée", "Affûtage course"],
};

const FALLBACK_PHASE_DESCRIPTIONS: Record<PlanObjective["sport"], [string, string, string]> = {
  trail: [
    "Installer une majorité d'endurance facile, la régularité et la robustesse musculaire avant d'ajouter du terrain exigeant.",
    "Développer progressivement le dénivelé, la marche active, les descentes contrôlées, la durabilité et la stratégie de ravitaillement.",
    "Réduire la charge tout en gardant de courts rappels spécifiques pour arriver frais et confiant le jour de l'objectif.",
  ],
  run: [
    "Installer une majorité d'endurance facile, une foulée relâchée et un volume compatible avec le niveau actuel.",
    "Développer l'allure de course et la sortie longue par blocs précis, avec des semaines de décharge régulières.",
    "Réduire le volume tout en gardant de courts rappels d'allure pour arriver frais le jour de l'objectif.",
  ],
  ride: [
    "Construire l'endurance de base à vélo avec un volume progressif et une séance de qualité par semaine.",
    "Développer la puissance spécifique et allonger la sortie longue du week-end.",
    "Réduire le volume pour arriver frais et affûté le jour de l'objectif.",
  ],
  hybrid: [
    "Poser une base aérobie croisée course et vélo, sans excès d'intensité.",
    "Construire la charge spécifique en alternant les disciplines et en allongeant la sortie longue.",
    "Affûtage : réduction du volume avant l'objectif.",
  ],
};

// Chooses `count` distinct weekday slots (0..poolSize-1) spread as evenly as
// possible, always including poolSize-1 (Sunday) as the last slot so the long
// session always lands on the weekend. Non-adjacent as long as count stays
// low enough for the pool to allow it (guaranteed up to 4 slots on a 7-day pool).
function evenlySpaced(count: number, poolSize: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [poolSize - 1];
  const positions = new Set<number>();
  for (let i = 0; i < count; i++) positions.add(Math.round((i * (poolSize - 1)) / (count - 1)));
  return [...positions].sort((a, b) => a - b);
}

// Running needs a cross-week rhythm, not just evenly spaced slots inside one
// week. Up to three runs always leave Monday free after Sunday's long run. A
// fourth run necessarily creates one adjacent pair in seven days; Tuesday +
// Wednesday is the least disruptive place for that easy/easy pair.
function runningWeekdays(count: number): number[] {
  if (count <= 1) return [6];
  if (count === 2) return [2, 6];
  if (count === 3) return [1, 3, 6];
  return [1, 2, 4, 6];
}

function legacyLevelFactor(level: string): number {
  const normalized = level.toLowerCase();
  if (normalized.includes("facile") || normalized.includes("debutant") || normalized.includes("débutant")) return 0.75;
  if (normalized.includes("avance") || normalized.includes("avancé") || normalized.includes("expert")) return 1.25;
  return 1;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function fallbackExperienceFactor(experience?: string) {
  if (experience === "several") return 1.2;
  if (experience === "similar") return 1.1;
  if (experience === "shorter") return 1;
  return 0.9;
}

function fallbackPeakDurations(objective: PlanObjective) {
  const legacy = objective.eventDistanceKm === undefined
    && objective.weeklyVolumeKm === undefined
    && objective.longestSessionKm === undefined;
  if (legacy) {
    const factor = legacyLevelFactor(objective.level);
    if (objective.sport === "ride") return { long: 90 * factor, easy: 50 * factor };
    if (objective.sport === "hybrid") return { long: 80 * factor, easy: 40 * factor };
    return { long: 75 * factor, easy: 40 * factor };
  }

  const distance = objective.eventDistanceKm || (objective.sport === "ride" ? 100 : 21.1);
  const weekly = objective.weeklyVolumeKm || 0;
  const longest = objective.longestSessionKm || 0;
  const days = Math.max(1, objective.daysPerWeek);
  const paceMinutesPerKm = objective.sport === "ride" ? 2.4 : objective.sport === "trail" ? 7.5 : 6;
  const eventFactor = objective.sport === "ride" ? 1.4 : objective.sport === "trail" ? 3 : 3.6;
  const minLong = objective.sport === "ride" ? 75 : 45;
  const maxLong = objective.sport === "ride" ? 360 : objective.sport === "trail" ? 300 : 180;
  const eventLong = clamp(distance * eventFactor, minLong, maxLong);
  const growthRoom = 1 + Math.min(1.25, objective.weeksTotal * 0.08);
  const measuredCapacity = Math.max(
    longest ? longest * paceMinutesPerKm * growthRoom * fallbackExperienceFactor(objective.experience) : 0,
    weekly ? weekly * paceMinutesPerKm * 0.55 : 0,
    minLong,
  );
  // The race defines specificity, not permission to jump to elite-length long
  // runs. The current longest run and weekly volume remain the safety ceiling.
  const long = clamp(Math.min(eventLong, measuredCapacity), minLong, maxLong);
  const easy = clamp(
    weekly ? (weekly / days) * paceMinutesPerKm * 0.85 : long * 0.42,
    objective.sport === "ride" ? 35 : 30,
    objective.sport === "ride" ? 100 : 75,
  );
  return { long, easy };
}

// Splits weeksTotal into base/build/taper (roughly 40/40/20), each at least
// one week whenever weeksTotal allows it.
function fallbackPhaseSplit(weeksTotal: number): [number, number, number] {
  if (weeksTotal <= 2) {
    const base = Math.max(1, weeksTotal - 1);
    return [base, weeksTotal - base, 0];
  }
  let base = Math.max(1, Math.round(weeksTotal * 0.4));
  let taper = Math.max(1, Math.round(weeksTotal * 0.2));
  let build = weeksTotal - base - taper;
  if (build < 1) {
    const deficit = 1 - build;
    if (base - deficit >= 1) base -= deficit;
    else taper = Math.max(1, taper - deficit);
    build = weeksTotal - base - taper;
  }
  build += weeksTotal - (base + build + taper);
  return [base, build, taper];
}

function fallbackPhaseOf(week: number, base: number, build: number): 1 | 2 | 3 {
  if (week <= base) return 1;
  if (week <= base + build) return 2;
  return 3;
}

// Progress factor in roughly [0.4, 1]: rises to 1 at the last non-taper week
// (the peak), then drops through the taper weeks so the final week is always
// lighter than the peak week.
function fallbackLoadFactor(week: number, weeksTotal: number, taperWeeks: number): number {
  const nonTaper = weeksTotal - taperWeeks;
  if (nonTaper <= 1 || week <= nonTaper) {
    const progressive = nonTaper <= 1 ? 1 : 0.55 + 0.45 * ((week - 1) / (nonTaper - 1));
    // Three loading weeks followed by a lighter consolidation week. Keep the
    // last non-taper week as the true peak even when its number is divisible by 4.
    return week % 4 === 0 && week < nonTaper ? progressive * 0.82 : progressive;
  }
  const taperIndex = week - nonTaper; // 1..taperWeeks
  return Math.max(0.4, 1 - 0.5 * (taperIndex / taperWeeks));
}

function fallbackWeekDates(startDate: Date, week: number): string {
  const monday = addDays(startDate, (week - 1) * 7);
  const sunday = addDays(monday, 6);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `${fmt(monday)} - ${fmt(sunday)}`;
}

type FallbackWeekSessions = { sessions: PlanSessionData[]; runMinTarget: number; dplus: number };

function fallbackQualityPrescription(phase: 1 | 2 | 3, trail: boolean, durationMin: number, durability: boolean): string[] {
  if (phase === 3) {
    const easy = Math.max(7, durationMin - 26);
    return [
      "Échauffement : 10 min très faciles avec mobilité dynamique",
      `Bloc principal : ${easy} min en Z1/Z2 puis 4 x 1 min à l'effort de course`,
      "Récupération : 1 min très facile après chaque répétition",
      "Retour au calme : 8 min faciles",
      "Intention : entretenir les sensations sans créer de fatigue résiduelle",
    ];
  }
  if (trail && durability) {
    const easy = Math.max(6, durationMin - 58);
    return [
      "Échauffement : 10 min faciles sur terrain progressif",
      `Bloc principal : ${easy} min en Z2 puis 2 x 12 min en haut de Z2 sur une pente proche de la course`,
      "Récupération : 4 min de marche active entre les deux blocs",
      "Technique : 12 min de descente fluide et contrôlée, sans chercher la vitesse maximale",
      "Retour au calme : 8 min faciles",
      "Intention : tenir une foulée et une lucidité stables sous fatigue, sans reproduire un volume élite",
    ];
  }
  if (trail && phase === 2) {
    const easy = Math.max(5, durationMin - 51);
    return [
      "Échauffement : 12 min faciles avec chevilles et gammes de course",
      `Bloc principal : ${easy} min en Z2 puis 3 x 5 min en montée à effort soutenu contrôlé`,
      "Récupération : 3 min de marche active ou trot facile entre les répétitions",
      "Technique : 10 min de descente contrôlée, appuis courts et regard loin",
      "Retour au calme : 8 min faciles",
      "Intention : développer la puissance de montée et l'aisance en descente sans dépasser le seuil",
    ];
  }
  if (trail) {
    const easy = Math.max(8, durationMin - 30);
    return [
      "Échauffement : 10 min faciles avec mobilité des chevilles",
      `Bloc principal : ${easy} min en Z2 puis 6 x 45 s en côte, foulée tonique`,
      "Récupération : 75 s en marche active après chaque répétition",
      "Retour au calme : 8 min faciles",
      "Intention : améliorer l'économie en montée sans accumuler de fatigue",
    ];
  }
  if (phase === 2) {
    const easy = Math.max(4, durationMin - 44);
    return [
      "Échauffement : 12 min faciles avec 3 accélérations progressives",
      `Bloc principal : ${easy} min en Z2 puis 3 x 6 min au seuil contrôlé`,
      "Récupération : 2 min de trot facile entre les blocs",
      "Retour au calme : 10 min faciles",
      "Intention : stabiliser une allure soutenue sans finir épuisé",
    ];
  }
  const easy = Math.max(6, durationMin - 26);
  return [
    "Échauffement : 10 min très faciles avec mobilité dynamique",
    `Bloc principal : ${easy} min en Z2 puis 6 x 20 s de lignes droites relâchées`,
    "Récupération : 60 s très faciles après chaque accélération",
    "Retour au calme : 8 min faciles",
    "Intention : améliorer l'économie de course sans transformer la séance en effort dur",
  ];
}

function fallbackStrengthSession(week: number, weekday: number, phase: 1 | 2 | 3, trail: boolean, second = false): PlanSessionData {
  const durationMin = phase === 3 ? 25 : second ? 30 : 40;
  return {
    id: `w${week}-d${weekday}-strength${second ? "-2" : ""}`,
    sport: "strength",
    title: second ? "Renforcement complémentaire" : "Force & prévention",
    subtitle: trail ? "Jambes, chevilles et résistance en descente" : "Jambes, mollets et stabilité",
    durationMin,
    intensity: "Technique · 2-3 répétitions en réserve",
    details: second
      ? [
          "Échauffement : 5 min de mobilité hanches, chevilles et tronc",
          "Bloc : 2 x 10 ponts fessiers une jambe + 2 x 12 mollets fléchis par côté",
          "Bloc : 2 x 30 s de gainage latéral par côté + équilibre unipodal",
          "Retour au calme : 5 min de mobilité douce",
          "Intention : consolider sans courbatures avant les séances de course",
        ]
      : [
          "Échauffement : 5 min de mobilité hanches, chevilles et squats au poids du corps",
          "Bloc : 3 x 8 fentes ou split squats par jambe, mouvement contrôlé",
          "Bloc : 3 x 10 soulevés de terre une jambe + 3 x 12 mollets tendus et fléchis",
          ...(trail ? ["Spécifique trail : 3 x 8 step-downs lents par jambe pour préparer les descentes"] : []),
          "Retour au calme : 5 min de mobilité douce",
          "Intention : développer la robustesse, jamais aller à l'échec",
        ],
    weekday,
  };
}

function fallbackRunningSessions(
  week: number,
  phase: 1 | 2 | 3,
  factor: number,
  objective: PlanObjective,
  trail: boolean,
  dplus = 0,
): FallbackWeekSessions {
  const strengthCount = objective.daysPerWeek >= 6 ? 2 : objective.daysPerWeek >= 3 ? 1 : 0;
  const runCount = Math.max(1, Math.min(4, objective.daysPerWeek - strengthCount));
  const weekdays = runningWeekdays(runCount);
  const longWeekday = weekdays[weekdays.length - 1];
  const { long: peakLong, easy: peakEasy } = fallbackPeakDurations(objective);
  const longMin = Math.max(35, Math.round(peakLong * factor));
  const easyMin = Math.max(25, Math.round(peakEasy * factor));
  const durability = trail && phase === 2 && week % 2 === 0 && longMin >= 90;
  const qualityIndex = runCount >= 4 ? 2 : runCount >= 3 ? 1 : runCount === 2 && phase === 2 ? 0 : -1;
  const prescriptionFloor = phase === 3
    ? 35
    : trail && phase === 2
      ? durability ? 64 : 56
      : phase === 2
        ? 48
        : 40;
  const qualityMin = phase === 3
    ? clamp(Math.max(prescriptionFloor, Math.round((peakEasy + 8) * factor)), prescriptionFloor, 50)
    : clamp(Math.max(prescriptionFloor, Math.round((peakEasy + (trail ? 20 : 15)) * factor)), prescriptionFloor, trail ? 80 : 70);
  const sessions: PlanSessionData[] = weekdays.map((weekday, index) => {
    const isLong = weekday === longWeekday;
    const isQuality = !isLong && index === qualityIndex;
    const durationMin = isLong ? longMin : isQuality ? qualityMin : easyMin;
    const mainEasyMinutes = Math.max(10, durationMin - (isLong ? 17 : 15));
    return {
      id: `w${week}-d${weekday}-run`,
      sport: "run",
      title: isLong
        ? trail ? "Sortie longue trail" : "Sortie longue"
        : isQuality
          ? phase === 3
            ? "Rappel d'allure"
            : durability
              ? "Durabilité trail spécifique"
              : trail
                ? phase === 2 ? "Montées & technique" : "Économie en côte"
                : phase === 2 ? "Seuil contrôlé" : "Économie de course"
          : "Endurance facile",
      subtitle: isLong
        ? trail ? `${durationMin} min sur terrain progressif · ${dplus} m D+ semaine` : `${durationMin} min en endurance fondamentale`
        : isQuality
          ? `${durationMin} min · blocs précis et contrôlés`
          : `${durationMin} min en aisance respiratoire`,
      durationMin,
      intensity: isLong ? "Z1-Z2 · endurance" : isQuality ? "Z2-Z3 · contrôlé" : "Z1-Z2 · RPE 2-4",
      details: isLong
        ? [
            "Échauffement : 10 min très faciles, marche autorisée au départ",
            `Bloc principal : ${mainEasyMinutes} min en Z1/Z2, allure conversationnelle et régulière`,
            "Récupération : marcher 2 min et réduire la cible si la foulée se dégrade",
            "Retour au calme : 5 min très faciles puis hydratation habituelle",
            trail
              ? "Terrain : choisir un profil proche de la course; power hiking (marche active) économique dans les pentes raides"
              : phase === 2 ? "Spécificité : finir par 10 min à l'effort de course seulement si les jambes restent fraîches" : "Rester facile du début à la fin",
            ...(trail && dplus > 0 ? [`Dénivelé : répartir environ ${dplus} m D+ sur la semaine, sans tout concentrer si la fatigue augmente`] : []),
            ...(trail ? ["Descentes : appuis courts, relâchés et contrôlés; aucune recherche de vitesse maximale"] : []),
            ...(durationMin > 75 ? ["Nutrition : tester progressivement boisson et glucides tolérés, ainsi que le matériel prévu le jour J"] : []),
            "Intention : construire l'endurance et terminer capable de poursuivre quelques minutes",
          ]
        : isQuality
          ? fallbackQualityPrescription(phase, trail, durationMin, durability)
          : [
              "Échauffement : 8 min très faciles avec mobilité dynamique",
              `Bloc principal : ${mainEasyMinutes} min en Z1/Z2, respiration conversationnelle`,
              "Récupération : 2 min de marche si nécessaire, sans compenser ensuite",
              "Retour au calme : 5 min très faciles",
              "Intention : accumuler du volume utile avec une foulée relâchée",
            ],
      weekday,
    };
  });

  const usedWeekdays = new Set(sessions.map((session) => session.weekday));
  const freeWeekdays = [1, 3, 5, 0, 2, 4, 6].filter((weekday) => !usedWeekdays.has(weekday));
  for (let index = 0; index < strengthCount; index++) {
    const weekday = freeWeekdays.shift() ?? (index ? 3 : 1);
    sessions.push(fallbackStrengthSession(week, weekday, phase, trail, index === 1));
    usedWeekdays.add(weekday);
  }
  if (objective.daysPerWeek >= 4 && phase !== 3) {
    const weekday = freeWeekdays.shift() ?? 5;
    const durationMin = clamp(Math.round((peakEasy + 8) * factor), 35, 60);
    sessions.push({
      id: `w${week}-d${weekday}-ride-optional`,
      sport: "ride",
      title: "Vélo aérobie optionnel",
      subtitle: `${durationMin} min souples · sans impact`,
      durationMin,
      intensity: "Z1-Z2 · RPE 2-3",
      details: [
        "10 min de mise en route avec une cadence fluide",
        `${Math.max(15, durationMin - 20)} min en endurance facile, sans forcer dans les côtes`,
        "10 min très souples pour terminer plus frais qu'au départ",
        "À supprimer en priorité si la fatigue, le sommeil ou une douleur se dégradent",
      ],
      optional: true,
      weekday,
    });
  }
  while (sessions.length < objective.daysPerWeek) {
    const weekday = freeWeekdays.shift() ?? 5;
    sessions.push({
      id: `w${week}-d${weekday}-recovery`,
      sport: "recovery",
      title: "Récupération & mobilité",
      subtitle: "20 min très faciles",
      durationMin: 20,
      intensity: "Récupération",
      details: [
        "10 min de marche facile ou repos complet selon la fatigue",
        "8 min de mobilité douce des chevilles, hanches et dos",
        "2 min de respiration calme",
        "Adapter la semaine : supprimer l'intensité si fatigue inhabituelle, douleur ou sommeil très dégradé",
      ],
      optional: true,
      weekday,
    });
  }
  sessions.sort((a, b) => a.weekday - b.weekday || a.id.localeCompare(b.id));
  return {
    sessions,
    runMinTarget: sessions.filter((session) => session.sport === "run").reduce((sum, session) => sum + (session.durationMin || 0), 0),
    dplus,
  };
}

function fallbackRunSessions(week: number, phase: 1 | 2 | 3, factor: number, objective: PlanObjective): FallbackWeekSessions {
  return fallbackRunningSessions(week, phase, factor, objective, false);
}

function fallbackRideSessions(week: number, factor: number, objective: PlanObjective): FallbackWeekSessions {
  const weekdays = evenlySpaced(objective.daysPerWeek, 7);
  const longWeekday = weekdays[weekdays.length - 1];
  const qualityWeekday = weekdays.length > 1 ? weekdays[0] : -1;
  const { long: peakLong, easy: peakEasy } = fallbackPeakDurations(objective);
  const sessions: PlanSessionData[] = weekdays.map((weekday) => {
    const isLong = weekday === longWeekday;
    const isQuality = !isLong && weekday === qualityWeekday;
    const durationMin = Math.round((isLong ? peakLong : isQuality ? peakEasy * 1.1 : peakEasy) * factor);
    return {
      id: `w${week}-d${weekday}-ride`,
      sport: "ride",
      title: isLong ? "Sortie longue vélo" : isQuality ? "Vélo · sweet spot" : "Vélo récupération",
      subtitle: isLong
        ? `${durationMin} min en endurance`
        : isQuality
          ? `${durationMin} min avec blocs au seuil`
          : `${durationMin} min souple`,
      durationMin,
      intensity: isLong ? "Z2 · endurance" : isQuality ? "88-93 % FTP" : "Z1-Z2",
      details: isLong
        ? ["Cadence régulière, terrain vallonné si possible", "Ravitaillement toutes les 45 minutes"]
        : isQuality
          ? ["10' d'échauffement progressif", "Blocs au seuil avec récupération entre chaque", "Retour au calme progressif"]
          : ["Cadence fluide, aucune intensité", "Terminer plus frais qu'au départ"],
      weekday,
    };
  });
  const runMinTarget = 0;
  return { sessions, runMinTarget, dplus: 0 };
}

function fallbackHybridSessions(week: number, factor: number, objective: PlanObjective): FallbackWeekSessions {
  const weekdays = evenlySpaced(objective.daysPerWeek, 7);
  const longWeekday = weekdays[weekdays.length - 1];
  const { long: peakLong, easy: peakEasy } = fallbackPeakDurations(objective);
  const sessions: PlanSessionData[] = weekdays.map((weekday, index) => {
    const isLong = weekday === longWeekday;
    const sport: "run" | "ride" = isLong ? "run" : index % 2 === 0 ? "run" : "ride";
    const durationMin = Math.round((isLong ? peakLong : peakEasy) * factor);
    return {
      id: `w${week}-d${weekday}-${sport}`,
      sport,
      title: isLong ? "Sortie longue" : sport === "run" ? "Course facile" : "Vélo facile",
      subtitle: isLong ? `${durationMin} min en endurance` : `${durationMin} min en aisance respiratoire`,
      durationMin,
      intensity: isLong ? "Z2 · endurance" : "Z2 · RPE 3-4",
      details: isLong
        ? ["Alterner course et vélo dans la semaine pour répartir la charge", "Raisonner en temps plutôt qu'en distance"]
        : sport === "run"
          ? ["Allure facile et conversationnelle", "Foulée relâchée, sans objectif de vitesse"]
          : ["Cadence fluide, aucune intensité", "Séance de récupération active"],
      weekday,
    };
  });
  const runMinTarget = sessions.filter((session) => session.sport === "run")
    .reduce((sum, session) => sum + (session.durationMin || 0), 0);
  return { sessions, runMinTarget, dplus: 0 };
}

// Run-dominant plus a weekly strength/prevention block on a day not already
// claimed by a run session when possible. From the build phase onward the
// long run carries a progressive D+ target, mirroring the legacy plan.
function fallbackTrailSessions(week: number, phase: 1 | 2 | 3, factor: number, objective: PlanObjective): FallbackWeekSessions {
  const legacy = objective.eventElevationM === undefined
    && objective.weeklyVolumeKm === undefined
    && objective.longestSessionKm === undefined;
  const eventElevation = objective.eventElevationM || 0;
  const weeklyVolume = objective.weeklyVolumeKm || 0;
  const longest = objective.longestSessionKm || 0;
  const elevationExperience = objective.experience === "several"
    ? 0.55
    : objective.experience === "similar"
      ? 0.45
      : objective.experience === "shorter"
        ? 0.35
        : 0.25;
  const measuredElevationCeiling = Math.max(300, weeklyVolume * 50, longest * 60);
  const dplusPeak = legacy
    ? 1000 * legacyLevelFactor(objective.level)
    : eventElevation > 0
      ? clamp(Math.min(eventElevation * elevationExperience, measuredElevationCeiling), 150, 5000)
      : 0;
  const dplus = phase >= 2 ? Math.round(dplusPeak * factor) : 0;
  return fallbackRunningSessions(week, phase, factor, objective, true, dplus);
}

function fallbackEventDurationMin(objective: PlanObjective): number {
  const distance = objective.eventDistanceKm || 0;
  const experienceFactor = objective.experience === "several"
    ? 0.95
    : objective.experience === "similar"
      ? 1
      : objective.experience === "shorter"
        ? 1.08
        : 1.15;
  const baseMinutes = objective.sport === "trail"
    ? distance * 7.5 + ((objective.eventElevationM || 0) / 100) * 6.5
    : distance * 6;
  return clamp(Math.max(20, baseMinutes * experienceFactor), 20, 48 * 60);
}

// Deterministic, no-AI training plan, used whenever the bridge is unreachable
// or returns a structurally invalid plan. Same three-phase shape (base/build/
// taper) as the legacy plan, sized to the requested objective instead of the
// hardcoded 12-week trail plan.
export function fallbackTrainingPlan(input: PlanObjective): PlanData {
  const weeksTotal = Math.max(1, Math.min(52, Math.round(input.weeksTotal) || 1));
  const daysPerWeek = Math.max(1, Math.min(7, Math.round(input.daysPerWeek) || 1));
  const objective: PlanObjective = { ...input, weeksTotal, daysPerWeek };
  const [baseWeeks, buildWeeks] = fallbackPhaseSplit(weeksTotal);
  const start = parseIsoDate(objective.startDate) || dateOnly(new Date());

  const baseGateWeek = Math.max(1, baseWeeks);
  const buildGateWeek = baseWeeks + Math.max(1, Math.round(buildWeeks / 2));

  const weeks: PlanWeekData[] = Array.from({ length: weeksTotal }, (_, index) => {
    const week = index + 1;
    const phase = fallbackPhaseOf(week, baseWeeks, buildWeeks);
    const factor = fallbackLoadFactor(week, weeksTotal, weeksTotal - baseWeeks - buildWeeks);

    let built: FallbackWeekSessions;
    if (objective.sport === "run") built = fallbackRunSessions(week, phase, factor, objective);
    else if (objective.sport === "ride") built = fallbackRideSessions(week, factor, objective);
    else if (objective.sport === "hybrid") built = fallbackHybridSessions(week, factor, objective);
    else built = fallbackTrailSessions(week, phase, factor, objective);

    if (week === weeksTotal && (objective.sport === "run" || objective.sport === "trail")) {
      const eventDate = parseIsoDate(objective.eventDate);
      const eventWeekday = eventDate ? (eventDate.getDay() + 6) % 7 : 6;
      const longSession = built.sessions.find((session) => session.sport === "run" && session.title.includes("Sortie longue"));
      const previousWeekday = eventWeekday - 1;
      const remaining = built.sessions.filter((session) => session !== longSession
        && session.weekday < eventWeekday
        && !(session.weekday === previousWeekday && (session.sport === "run" || session.sport === "strength")));
      const eventDurationMin = fallbackEventDurationMin(objective);
      const eventSession: PlanSessionData = {
        id: `w${week}-d${eventWeekday}-run-event`,
        sport: "run",
        title: `Objectif · ${objective.title}`,
        subtitle: [
          objective.eventDistanceKm ? `${objective.eventDistanceKm} km` : "Épreuve cible",
          objective.sport === "trail" && objective.eventElevationM ? `${objective.eventElevationM} m D+` : "",
          `≈ ${fmtMinutes(eventDurationMin)} estimées`,
        ].filter(Boolean).join(" · "),
        durationMin: eventDurationMin,
        intensity: "Effort de course maîtrisé",
        details: [
          "Échauffement : 10-15 min très faciles, puis quelques accélérations uniquement si elles font partie de la routine habituelle",
          objective.sport === "trail"
            ? "Bloc principal / stratégie : rester conservateur au départ, marcher activement les pentes raides et garder des descentes fluides"
            : "Bloc principal / stratégie : partir légèrement en dedans de l'allure cible et stabiliser l'effort avant d'accélérer",
          "Nutrition : suivre le protocole de boisson et de glucides validé pendant les sorties longues, sans nouveauté le jour J",
          "Récupération entre efforts : ralentir brièvement aux ravitaillements plutôt que subir une baisse brutale plus tard",
          "Retour au calme : marcher quelques minutes après l'arrivée, boire et manger selon la tolérance",
          "Intention : exécuter une stratégie régulière et adaptable, pas rattraper du temps dès le départ",
        ],
        weekday: eventWeekday,
      };
      const sessions = [...remaining, eventSession].sort((a, b) => a.weekday - b.weekday || a.id.localeCompare(b.id));
      built = {
        sessions,
        runMinTarget: sessions.filter((session) => session.sport === "run").reduce((sum, session) => sum + (session.durationMin || 0), 0),
        dplus: objective.sport === "trail" && objective.eventElevationM ? objective.eventElevationM : built.dplus,
      };
    }

    let gate: string | undefined;
    if (objective.sport === "trail" && week === baseGateWeek && baseGateWeek < weeksTotal) {
      gate = "Porte : 40 minutes de course continue sans douleur";
    } else if (objective.sport === "trail" && week === buildGateWeek && buildGateWeek > baseGateWeek && buildGateWeek < weeksTotal) {
      gate = "Porte : sortie longue avec dénivelé validée sans douleur le lendemain";
    }

    return {
      week,
      dates: fallbackWeekDates(start, week),
      phase,
      c1: "",
      c2: "",
      c3: "",
      dplus: built.dplus,
      runMinTarget: built.runMinTarget,
      ...(gate ? { gate } : {}),
      sessions: built.sessions,
    };
  });

  // A Monday event has its eve in the preceding plan week. Remove every hard
  // session from that Sunday as well; this cross-week edge cannot be handled
  // while building the final week in isolation.
  const eventDate = parseIsoDate(objective.eventDate);
  const eventWeekday = eventDate ? (eventDate.getDay() + 6) % 7 : -1;
  if ((objective.sport === "run" || objective.sport === "trail") && eventWeekday === 0 && weeks.length > 1) {
    const previousWeek = weeks[weeks.length - 2];
    previousWeek.sessions = previousWeek.sessions.filter((session) => session.weekday !== 6
      || (session.sport !== "run" && session.sport !== "strength"));
    previousWeek.runMinTarget = previousWeek.sessions
      .filter((session) => session.sport === "run")
      .reduce((sum, session) => sum + (session.durationMin || 0), 0);
  }

  const [name1, name2, name3] = FALLBACK_PHASE_NAMES[objective.sport];
  const [desc1, desc2, desc3] = FALLBACK_PHASE_DESCRIPTIONS[objective.sport];

  return {
    version: 1,
    generatedBy: "fallback",
    objective,
    phases: [
      { id: 1, name: name1, description: desc1 },
      { id: 2, name: name2, description: desc2 },
      { id: 3, name: name3, description: desc3 },
    ],
    weeks,
  };
}

// The plan as it has always been hardcoded, reshaped into PlanData. This is
// the one-time migration seed: PLAN and the legacy per-weekday switch are kept
// only to produce it, and to give tests/trail-plan.test.ts a legacy-parity
// oracle to check the migrated JSON against.
function legacyTrailPlan(): PlanData {
  const weeks: PlanWeekData[] = PLAN.map((week) => ({
    ...week,
    sessions: ([0, 1, 2, 3, 4, 5, 6] as const).flatMap((weekday) =>
      legacyPlannedSessionsFor(week, weekday).map((session): PlanSessionData => ({ ...session, weekday }))),
  }));

  return {
    version: 1,
    generatedBy: "migration",
    objective: {
      sport: "trail",
      title: "Trail 26 km / 1400 m D+",
      eventDate: "2026-09-20",
      startDate: "2026-06-29",
      weeksTotal: 12,
      level: "intermediaire",
      daysPerWeek: 6,
      constraints: "",
    },
    // Copied verbatim from TrailCycles.tsx's PHASE_META (name + description);
    // the colors stay in TrailCycles since they are presentation-only tokens.
    phases: [
      {
        id: 1,
        name: "Base sur plat",
        description:
          "Construire le volume de course sur plat, sans douleur. Le vélo entretient l'aérobie, la musculation pose les fondations. Porte de sortie : 40' de course continue.",
      },
      {
        id: 2,
        name: "Trail + dénivelé",
        description:
          "Le terrain devient spécifique : côtes, descentes techniques et sorties longues jusqu'à 14-15 km / 600 m D+ validées sans douleur le lendemain.",
      },
      {
        id: 3,
        name: "Pic & affûtage",
        description:
          "Pic de charge (20 km, 1 000 m D+ en semaine 10), puis réduction progressive du volume pour arriver frais sur la course de 26 km.",
      },
    ],
    weeks,
  };
}

// Writes the vault-persisted plan file. The single write path for a plan,
// used by the legacy migration below and by plan (re)generation (T4).
export async function saveTrainingPlan(plan: PlanData): Promise<void> {
  const filePath = path.join(vaultRoot(), TRAINING_PLAN_JSON);
  await fs.rm(path.join(vaultRoot(), COACH_DECISION_JSON), { force: true });
  await atomicWriteFile(filePath, `${JSON.stringify(planToJson(plan), null, 2)}\n`);
}

export async function saveTrainingPlanJson(value: unknown): Promise<void> {
  const candidate = planFromJson(value);
  const valid = candidate ? validatePlanData(candidate) : null;
  if (!valid) throw new Error("plan d'entraînement IA invalide");
  await saveTrainingPlan(valid);
}

// True if a plan file already exists, without loading or validating it (a
// bare existence check so the trail page can decide whether to show the
// objective setup form or the workspace).
export async function hasTrainingPlan(): Promise<boolean> {
  try {
    await fs.access(path.join(vaultRoot(), TRAINING_PLAN_JSON));
    return true;
  } catch {
    return false;
  }
}

// Archives the currently persisted plan file (if any) under
// 08-Projects/Training/archive before a regeneration overwrites it, so a past
// plan is never silently lost. Returns the archive's relative path, or null
// when there was no existing plan file to archive.
export async function archiveTrainingPlan(): Promise<string | null> {
  const filePath = path.join(vaultRoot(), TRAINING_PLAN_JSON);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
  const archivePath = `${TRAINING_ARCHIVE_DIR}/plan-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await atomicWriteFile(path.join(vaultRoot(), archivePath), raw);
  return archivePath;
}

// Loads the vault-persisted plan, migrating the hardcoded legacy plan into it
// the first time the file is missing or fails validation (e.g. hand-edited
// into an invalid shape). Once a valid file exists, this is a plain read.
export async function loadTrainingPlan(): Promise<PlanData> {
  const filePath = path.join(vaultRoot(), TRAINING_PLAN_JSON);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const candidate = planFromJson(JSON.parse(raw));
    const valid = candidate ? validatePlanData(candidate) : null;
    if (valid) return valid;
  } catch {
    // Missing file, unreadable, or malformed JSON: fall through to migration.
  }

  const migrated = legacyTrailPlan();
  await saveTrainingPlan(migrated);
  return migrated;
}

// --- Plan overrides ----------------------------------------------------------
// User-initiated moves/cancellations/manual validations of a single planned
// session. Stored separately from plan-data.json so a plan regeneration
// (clearPlanOverrides) never has to touch the sessions themselves.

type PlanOverrideJson = {
  id: string;
  created_at: string;
  session_id: string;
  week: number;
  action: string;
  to_weekday: number | null;
  reason: string;
  activity_id: string | null;
};

function overrideToJson(override: PlanOverride): PlanOverrideJson {
  return {
    id: override.id,
    created_at: override.createdAt,
    session_id: override.sessionId,
    week: override.week,
    action: override.action,
    to_weekday: override.toWeekday,
    reason: override.reason,
    activity_id: override.activityId,
  };
}

function overrideFromJson(value: unknown): PlanOverride | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.action !== "move" && raw.action !== "cancel" && raw.action !== "validate") return null;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (typeof raw.session_id !== "string" || !raw.session_id) return null;
  if (typeof raw.week !== "number") return null;
  return {
    id: raw.id,
    createdAt: typeof raw.created_at === "string" ? raw.created_at : "",
    sessionId: raw.session_id,
    week: raw.week,
    action: raw.action,
    toWeekday: typeof raw.to_weekday === "number" ? raw.to_weekday : null,
    reason: typeof raw.reason === "string" ? raw.reason : "",
    activityId: typeof raw.activity_id === "string" ? raw.activity_id : null,
  };
}

async function writePlanOverrides(overrides: PlanOverride[]): Promise<void> {
  const filePath = path.join(vaultRoot(), OVERRIDES_JSON);
  await atomicWriteFile(filePath, `${JSON.stringify({ overrides: overrides.map(overrideToJson) }, null, 2)}\n`);
}

export async function loadPlanOverrides(): Promise<PlanOverride[]> {
  try {
    const raw = await fs.readFile(path.join(vaultRoot(), OVERRIDES_JSON), "utf-8");
    const parsed = JSON.parse(raw) as { overrides?: unknown[] };
    if (!Array.isArray(parsed.overrides)) return [];
    return parsed.overrides
      .map((item) => overrideFromJson(item))
      .filter((item): item is PlanOverride => item !== null);
  } catch {
    return [];
  }
}

// Saves a manual correction to a single planned session, validating it against
// the currently loaded plan (and, for "validate", the synced activities).
// Replaces any previous override for the same session: one override per
// session, latest action wins.
export async function savePlanOverride(input: Omit<PlanOverride, "id" | "createdAt">): Promise<PlanOverride> {
  const plan = await loadTrainingPlan();
  const planWeek = plan.weeks.find((week) => week.week === input.week);
  if (!planWeek) throw new Error("Semaine introuvable dans le plan");
  const session = planWeek.sessions.find((item) => item.id === input.sessionId);
  if (!session) throw new Error("Séance introuvable dans le plan");
  const existing = await loadPlanOverrides();
  const previous = existing.find((item) => item.sessionId === input.sessionId);

  let toWeekday: number | null = null;
  let reason = "";
  let activityId: string | null = null;

  if (input.action === "move") {
    if (input.toWeekday === null || !Number.isInteger(input.toWeekday) || input.toWeekday < 0 || input.toWeekday > 6) {
      throw new Error("Jour cible invalide");
    }
    if (input.toWeekday === session.weekday) throw new Error("La séance est déjà prévue ce jour-là");
    toWeekday = input.toWeekday;
  } else if (input.action === "cancel") {
    reason = input.reason.trim().slice(0, 240);
    if (!reason) throw new Error("Un motif d'annulation est requis");
  } else if (input.action === "validate") {
    // Validation is a new state of the same calendar slot, not a request to
    // undo its rescheduling. Keep the target day saved by a previous move (or
    // by an earlier validation whose Garmin link is being changed).
    if (
      previous?.toWeekday !== null
      && previous?.toWeekday !== undefined
      && Number.isInteger(previous.toWeekday)
      && previous.toWeekday >= 0
      && previous.toWeekday <= 6
    ) {
      toWeekday = previous.toWeekday;
    }
    if (input.activityId) {
      const data = await loadTrailData();
      if (!data.activities.some((activity) => activity.id === input.activityId)) throw new Error("Activité introuvable");
      if (existing.some((item) => item.sessionId !== input.sessionId && item.action === "validate" && item.activityId === input.activityId)) {
        throw new Error("Cette activité Garmin valide déjà une autre séance");
      }
      activityId = input.activityId;
    }
  }

  const override: PlanOverride = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    sessionId: input.sessionId,
    week: input.week,
    action: input.action,
    toWeekday,
    reason,
    activityId,
  };

  const next = [...existing.filter((item) => item.sessionId !== input.sessionId), override];
  await writePlanOverrides(next);
  return override;
}

export async function removePlanOverride(sessionId: string): Promise<void> {
  const existing = await loadPlanOverrides();
  await writePlanOverrides(existing.filter((item) => item.sessionId !== sessionId));
}

// Used by plan regeneration: wipes every manual override so a freshly
// generated plan starts clean.
export async function clearPlanOverrides(): Promise<void> {
  await writePlanOverrides([]);
}

function dateOnly(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return dateOnly(next);
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  return dateOnly(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

// Snaps an ISO date back to the Monday of its own week. Every plan-week
// weekday slot is "days since the objective's start date" and is rendered
// with real calendar weekday names (DAY_NAMES, WEEKDAY_NAMES) that assume
// weekday 0 falls on a Monday — exactly like the legacy PLAN_START (a
// Monday). An objective whose start date is left as "today" (or any other
// day picked in ObjectiveSetup) would otherwise silently break that
// assumption for every non-legacy plan, so callers building a new objective
// must snap its start date through this before persisting the plan.
export function mondayOnOrBeforeIso(dateIso: string): string {
  const date = parseIsoDate(dateIso) || dateOnly(new Date());
  return isoDate(addDays(date, -((date.getDay() + 6) % 7)));
}

// ISO date of a given weekday (0 = Monday) in a plan week, anchored on the
// plan's own start date (defaults to the legacy PLAN_START for callers that
// still operate on the hardcoded trail plan, e.g. existing tests). Every
// caller working with a loaded PlanData MUST pass the objective's actual
// startDate — a generated (non-legacy) plan starts on a different Monday, and
// falling back to PLAN_START here silently breaks every date lookup keyed off
// it (overrides, "prévue depuis" labels) for any objective but the legacy one.
export function planDateIso(week: number, weekday: number, startDate: Date = PLAN_START): string {
  return isoDate(addDays(dateOnly(startDate), (week - 1) * 7 + weekday));
}

// An activity only auto-completes a planned session it plausibly *is*: same
// discipline is not enough, since a 25' easy spin would otherwise mark a 55'
// sweet-spot ride "done". We gate on duration: the activity must run at least
// PLAUSIBLE_DURATION_FLOOR of the planned minutes. When the plan gives no target
// duration (km-based long runs) or the activity carries none, we can't judge and
// don't block — a false "missed" is worse than an honest "to validate", and the
// manual "validate" override stays the real source of truth for those.
//
export const PLAUSIBLE_DURATION_FLOOR = 0.6;

// A "quality" session is one whose whole point is the intensity: sweet spot,
// threshold, VO2, intervals, tempo, race-pace. A same-duration *easy* ride must
// not be allowed to auto-complete one of these (the reported bug: an easy spin
// validating a planned "Sweet spot"). Keyword-detected from the plan's own
// wording so it needs no per-session config.
function isQualitySession(session: PlannedSession): boolean {
  const text = `${session.intensity} ${session.title} ${session.subtitle}`.toLowerCase();
  return /sweet ?spot|ftp|seuil|threshold|vo2|\bpma\b|intervalle|interval|fractionn|tempo|allure sp[eé]cifique|\bz[45]\b/.test(text);
}

// Did the activity actually involve hard effort? Garmin Training Effect is a
// per-athlete normalized load signal, so it works without knowing the user's
// FTP or HR zones. `null` = the device recorded no effort data, so we can't
// judge and must not block (manual "validate" stays the source of truth).
// ponytail: fixed TE thresholds (aerobic >= 3.0 "improving", or any anaerobic
// contribution). Tune if a user's device calibrates differently.
function activityShowsHardEffort(activity: TrailActivity): boolean | null {
  if (activity.aerobicTrainingEffect == null && activity.anaerobicTrainingEffect == null) return null;
  return (activity.aerobicTrainingEffect ?? 0) >= 3.0 || (activity.anaerobicTrainingEffect ?? 0) >= 1.0;
}

export function activityFitsSession(session: PlannedSession, activity: TrailActivity): boolean {
  if (session.sport !== activity.kind) return false;
  if (session.durationMin != null && activity.durS && activity.durS < session.durationMin * 60 * PLAUSIBLE_DURATION_FLOOR) {
    return false;
  }
  // Quality sessions additionally require the activity to read as hard effort.
  // When the activity carries effort data and it looks easy, this is not that
  // session: leave the slot open for the athlete's explicit manual validation.
  if (isQualitySession(session) && activityShowsHardEffort(activity) === false) return false;
  return true;
}

// Match a week's recorded activities to its planned sessions, tolerant of the
// day each one actually happened on. Each activity claims the nearest still
// free planned session of the same discipline it plausibly matches (so a Sunday
// long run done on Saturday fills the Sunday slot instead of leaving it "à
// faire", but a short spin never absorbs a longer quality session). Leftover
// activities are bonus volume; unfilled past-due sessions are "missed".
//
// `overrides` are the athlete's manual corrections (moves/cancels/manual
// validations); only the ones for this plan week are applied (callers may
// pass the whole vault-wide list or an already-filtered slice — both work).
export function matchWeek(
  plan: PlanWeek,
  activities: TrailActivity[],
  today: Date,
  currentWeek: number,
  overrides: PlanOverride[] = [],
  startDate: Date = PLAN_START,
): WeekMatch {
  const overrideBySession = new Map(
    overrides.filter((override) => override.week === plan.week).map((override) => [override.sessionId, override]),
  );

  const planned: Array<{ session: PlannedSession; weekday: number; override?: PlanOverride }> = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    for (const session of plannedSessionsFor(plan, weekday)) {
      if (session.optional) continue;
      if (!TRACKABLE_SPORTS.some((sport) => sport === session.sport)) continue;
      const override = overrideBySession.get(session.id);
      // A move relocates the slot itself. Validation may replace the move as
      // the latest action, but retains that target day so everything downstream
      // (matching, status and plannedIso) still operates on the new date.
      const keepsMovedDay = override?.action === "move" || override?.action === "validate";
      const movedWeekday = keepsMovedDay ? override?.toWeekday : null;
      const effectiveWeekday = movedWeekday ?? weekday;
      planned.push({ session, weekday: effectiveWeekday, override });
    }
  }

  const acts = activities
    .filter((activity) => TRACKABLE_SPORTS.some((sport) => sport === activity.kind))
    .slice()
    .sort((a, b) => a.weekday - b.weekday || a.date.localeCompare(b.date));

  const matchBySession = new Map<PlannedSession, TrailActivity>();
  const claimed = new Set<string>();

  // Manual validations with an explicit activity link claim it first, so the
  // nearest-slot pass below can never hand that same activity to another day.
  for (const { session, override } of planned) {
    if (override?.action !== "validate" || !override.activityId) continue;
    const activity = acts.find((item) => item.id === override.activityId);
    if (!activity || claimed.has(activity.id)) continue;
    matchBySession.set(session, activity);
    claimed.add(activity.id);
  }

  for (const activity of acts) {
    if (claimed.has(activity.id)) continue;
    let best: { session: PlannedSession; dist: number } | null = null;
    for (const candidate of planned) {
      if (!activityFitsSession(candidate.session, activity)) continue;
      if (matchBySession.has(candidate.session)) continue;
      // A cancelled slot never absorbs an activity: the activity falls
      // through to another free slot, or becomes an extra.
      if (candidate.override?.action === "cancel") continue;
      const dist = Math.abs(candidate.weekday - activity.weekday);
      if (!best || dist < best.dist) best = { session: candidate.session, dist };
    }
    if (best) {
      matchBySession.set(best.session, activity);
      claimed.add(activity.id);
    }
  }

  const todayWeekday = (today.getDay() + 6) % 7;
  const sessions: MatchedSession[] = planned.map(({ session, weekday, override }) => {
    const activity = matchBySession.get(session) || null;
    let outcome: SessionOutcome;
    let manual = false;
    if (override?.action === "cancel") {
      outcome = "cancelled";
    } else if (override?.action === "validate") {
      outcome = "done";
      manual = true;
    } else if (activity) {
      outcome = activity.weekday === weekday ? "done" : "moved";
    } else if (plan.week < currentWeek) {
      outcome = "missed";
    } else if (plan.week > currentWeek) {
      outcome = "upcoming";
    } else {
      outcome = weekday < todayWeekday ? "missed" : weekday === todayWeekday ? "today" : "upcoming";
    }
    return {
      session,
      plannedWeekday: weekday,
      plannedIso: planDateIso(plan.week, weekday, startDate),
      outcome,
      activity,
      actualIso: activity?.date ?? null,
      actualWeekday: activity?.weekday ?? null,
      manual,
      ...(override ? { overrideAction: override.action } : {}),
      ...(override?.action === "cancel" ? { cancelReason: override.reason } : {}),
    };
  });

  return {
    sessions,
    extras: acts.filter((activity) => !claimed.has(activity.id)),
    doneCount: sessions.filter((session) => session.outcome === "done" || session.outcome === "moved").length,
    plannedCount: sessions.filter((session) => session.outcome !== "cancelled").length,
  };
}

function samePlanWeekDate(anchor: Date, weekday: number): Date {
  const monday = addDays(anchor, -((anchor.getDay() + 6) % 7));
  return addDays(monday, weekday);
}

export function weekOf(d: Date): number {
  return Math.floor((dateOnly(d).getTime() - PLAN_START.getTime()) / 86400000 / 7) + 1;
}

const DAY_WORDS: Array<[RegExp, number]> = [
  [/\blundi\b|\blun\b/, 0],
  [/\bmardi\b|\bmar\b/, 1],
  [/\bmercredi\b|\bmer\b/, 2],
  [/\bjeudi\b|\bjeu\b/, 3],
  [/\bvendredi\b|\bven\b/, 4],
  [/\bsamedi\b|\bsam\b/, 5],
  [/\bdimanche\b|\bdim\b/, 6],
];

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function sportFromText(text: string): Exclude<SportKind, "other"> | null {
  if (/\b(velo|bike|zwift|sweet\s*spot|ftp|cycl)/i.test(text)) return "ride";
  if (/\b(course|courir|run|running|trail|c[123]|sortie longue)\b/i.test(text)) return "run";
  if (/\b(muscu|push|pull|jambes?|renfo|elastiques?|gainage)\b/i.test(text)) return "strength";
  if (/\b(repos|recuperation|mobilite)\b/i.test(text)) return "recovery";
  return null;
}

function compactReason(value: string): string {
  return value
    .replace(/^[-*]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function noteDate(note: VaultNote): Date | null {
  const date = typeof note.data.date === "string" ? parseIsoDate(note.data.date) : null;
  if (date) return date;
  const fromPath = note.relativePath.match(/(\d{4})-(\d{2})-(\d{2})/);
  return fromPath ? parseIsoDate(fromPath[0]) : null;
}

function dateFromFrenchShort(value: string): Date | null {
  const match = /\b(\d{1,2})\/(\d{1,2})\b/.exec(value);
  if (!match) return null;
  return dateOnly(new Date(PLAN_START.getFullYear(), Number(match[2]) - 1, Number(match[1])));
}

function sourceDateForLine(line: string, fallback: Date | null): Date | null {
  const explicit = dateFromFrenchShort(line);
  if (explicit) return explicit;
  if (!fallback) return null;
  const normalized = foldText(line);
  if (/\bhier\b/.test(normalized)) return addDays(fallback, -1);
  if (/\b(apres[- ]?demain)\b/.test(normalized)) return addDays(fallback, 2);
  if (/\bdemain\b/.test(normalized)) return addDays(fallback, 1);
  for (const [pattern, weekday] of DAY_WORDS) {
    if (pattern.test(normalized)) return samePlanWeekDate(fallback, weekday);
  }
  return fallback;
}

function targetDateForLine(line: string, fallback: Date): Date | null {
  const normalized = foldText(line);
  if (/\b(apres[- ]?demain)\b/.test(normalized)) return addDays(fallback, 2);
  if (/\bdemain\b/.test(normalized)) return addDays(fallback, 1);
  const targetDay = normalized.match(/\b(?:a|au|pour|sur)\s+(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/);
  if (targetDay) {
    const found = DAY_WORDS.find(([pattern]) => pattern.test(targetDay[1]));
    if (found) {
      const candidate = samePlanWeekDate(fallback, found[1]);
      return candidate.getTime() <= fallback.getTime() ? addDays(candidate, 7) : candidate;
    }
  }
  return null;
}

function nextRescheduleSlot(weeks: PlanWeekData[], start: Date, from: Date, sport: Exclude<SportKind, "other">): Date | null {
  const weekIndexOf = (d: Date) => Math.floor((dateOnly(d).getTime() - dateOnly(start).getTime()) / 86400000 / 7);
  const fromWeek = weeks[weekIndexOf(from)];
  if (!fromWeek) return null;

  for (let offset = 1; offset <= 6; offset++) {
    const candidate = addDays(from, offset);
    const week = weeks[weekIndexOf(candidate)];
    if (!week || week.week !== fromWeek.week) continue;
    const weekday = (candidate.getDay() + 6) % 7;
    const sessions = plannedSessionsFor(week, weekday);
    const hasSameSport = sessions.some((session) => session.sport === sport && !session.optional);
    const hasRun = sessions.some((session) => session.sport === "run");
    const hasHardStrength = sessions.some((session) => session.sport === "strength" && /jambes/i.test(session.title));

    if (sport === "ride") {
      if (!hasSameSport && !hasRun && !hasHardStrength) return candidate;
      continue;
    }
    if (sport === "run") {
      const previousHasRun = plannedSessionsFor(weeks[weekIndexOf(addDays(candidate, -1))] || week, (weekday + 6) % 7)
        .some((session) => session.sport === "run");
      const nextHasRun = plannedSessionsFor(weeks[weekIndexOf(addDays(candidate, 1))] || week, (weekday + 1) % 7)
        .some((session) => session.sport === "run");
      if (!hasSameSport && !previousHasRun && !nextHasRun) return candidate;
      continue;
    }
    if (!hasSameSport && sessions.length <= 1) return candidate;
  }
  return null;
}

function adjustmentFromLine(note: VaultNote, line: string, fallbackDate: Date | null, weeks: PlanWeekData[], start: Date): TrailPlanAdjustment | null {
  const reason = compactReason(line);
  if (!reason) return null;
  const normalized = foldText(reason);
  const sport = sportFromText(normalized);
  if (!sport) return null;

  const hasReschedule = /\b(report|reprogramm|decal|deplac|remet|recale|replace)\w*/.test(normalized);
  const hasCancel = /\b(annul|saute|skip|abandon)\w*/.test(normalized);
  const hasMissed = /\b(pas pu|peux pas|pourrai pas|impossible|pas possible|n['’]?ai pas pu)\b/.test(normalized);
  if (!hasReschedule && !hasCancel && !hasMissed) return null;

  const fromDate = sourceDateForLine(normalized, fallbackDate);
  if (!fromDate) return null;
  const action: TrailPlanAdjustment["action"] = hasCancel && !hasReschedule ? "cancel" : "reschedule";
  const explicitTarget = action === "reschedule" ? targetDateForLine(normalized, fromDate) : null;
  const inferredTarget = action === "reschedule" && /\bdans la semaine\b/.test(normalized)
    ? nextRescheduleSlot(weeks, start, fromDate, sport)
    : null;
  const target = explicitTarget || inferredTarget;
  const sourceDate = fallbackDate ? isoDate(fallbackDate) : isoDate(fromDate);

  return {
    id: `${note.relativePath}:${sourceDate}:${sport}:${reason}`,
    sourcePath: note.relativePath,
    sourceDate,
    sourceLabel: note.kind === "daily" ? "Daily" : note.folder === VAULT_FOLDERS.raw ? "Note brute" : "Trail",
    action,
    sport,
    fromIso: isoDate(fromDate),
    toIso: target ? isoDate(target) : null,
    reason,
  };
}

async function loadProjectTrailNotes(): Promise<VaultNote[]> {
  const root = path.join(vaultRoot(), "08-Projects/Trail-26K");
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const notes = await Promise.all(entries
      // Journal.md already has its own "Décisions & adaptations" table for resolved
      // history; re-mining it here double-counts past reschedules as new ones and the
      // "already happened" wording (e.g. "décalé au mercredi") throws off the from/to
      // date guesser, producing bogus future-dated adjustment cards.
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !["Sync.md", "Plan.md", "CLAUDE.md", "Journal.md"].includes(entry.name))
      .map(async (entry): Promise<VaultNote> => {
        const relativePath = `08-Projects/Trail-26K/${entry.name}`;
        const fullPath = path.join(root, entry.name);
        const content = await fs.readFile(fullPath, "utf-8");
        return {
          id: relativePath,
          title: entry.name.replace(/\.md$/, ""),
          relativePath,
          folder: "08-Projects/Trail-26K",
          kind: "project",
          data: {},
          content,
          excerpt: "",
          tags: [],
          links: [],
          status: "active",
          mtime: "",
        };
      }));
    return notes;
  } catch {
    return [];
  }
}

export async function loadTrailPlanAdjustments(weeks: PlanWeekData[], start: Date): Promise<TrailPlanAdjustment[]> {
  const [daily, raw, project] = await Promise.all([
    listNotes("daily"),
    listNotes("raw"),
    loadProjectTrailNotes(),
  ]);

  const candidates = [...daily, ...raw, ...project]
    .filter((note) => note.status !== "archived")
    .flatMap((note) => {
      const fallbackDate = noteDate(note);
      // Keep the parser focused on recent day notes plus explicit dated Trail
      // project decisions. Old raw notes about unrelated bike rides should not
      // keep reshuffling the plan forever.
      if (!fallbackDate && note.kind !== "project") return [];
      const lines = note.content
        .split(/\n+/)
        .flatMap((line) => line.split(/(?<=[.!?])\s+/))
        .map((line) => line.trim())
        .filter(Boolean);
      return lines
        .map((line) => adjustmentFromLine(note, line, fallbackDate, weeks, start))
        .filter(Boolean) as TrailPlanAdjustment[];
    });

  const seen = new Set<string>();
  return candidates
    .filter((adjustment) => {
      const key = `${adjustment.fromIso}:${adjustment.sport}:${adjustment.action}:${adjustment.toIso || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.sourceDate.localeCompare(a.sourceDate));
}

function activityId(act: Record<string, unknown>, index: number): string {
  if (typeof act.id === "string" && act.id) return act.id;
  return [String(act.date || "unknown"), String(act.type || "activity"), String(act.name || index)]
    .join("::")
    .slice(0, 240);
}

// Reconstructs the legacy composite id (date::type::name) an already-parsed
// TrailActivity would have had before the Garmin sync started emitting a
// stable numeric `id`, mirroring the fallback branch of activityId() above.
// Used only to migrate old feedback-data.json keys forward; see
// loadTrailFeedback().
function legacyActivityKey(activity: TrailActivity): string {
  return [activity.date || "unknown", activity.type || "activity", activity.name || ""].join("::").slice(0, 240);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function zonesFromJson(value: unknown): TrailActivityZone[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const zone = raw as Record<string, unknown>;
    const seconds = numberOrNull(zone.seconds);
    if (seconds === null || seconds <= 0) return [];
    return [{
      zone: Math.round(numberOrNull(zone.zone) ?? index + 1),
      label: typeof zone.label === "string" && zone.label.trim() ? zone.label.trim() : `Z${index + 1}`,
      seconds,
      percent: numberOrNull(zone.percent),
      lowBoundary: numberOrNull(zone.low_boundary),
      highBoundary: numberOrNull(zone.high_boundary),
    }];
  });
}

export async function loadTrailData(): Promise<TrailSyncData> {
  try {
    const raw = await fs.readFile(path.join(vaultRoot(), SYNC_JSON), "utf-8");
    const parsed = JSON.parse(raw) as { generated_at?: string; activities?: unknown[] };
    const activities: TrailActivity[] = (parsed.activities || []).map((a, index) => {
      const act = a as Record<string, unknown>;
      const hrZones = zonesFromJson(act.hr_zones);
      const powerZones = zonesFromJson(act.power_zones);
      return {
        id: activityId(act, index),
        date: String(act.date || ""),
        week: Number(act.week || 0),
        weekday: Number(act.weekday || 0),
        kind: (act.kind as TrailActivity["kind"]) || "other",
        type: String(act.type || ""),
        name: String(act.name || ""),
        km: Number(act.km || 0),
        durS: Number(act.dur_s || 0),
        paceSPerKm: act.pace_s_per_km ? Number(act.pace_s_per_km) : null,
        hr: act.hr ? Number(act.hr) : null,
        dplus: Number(act.dplus || 0),
        avgPower: numberOrNull(act.avg_power),
        normalizedPower: numberOrNull(act.normalized_power),
        calories: numberOrNull(act.calories),
        trainingLoad: numberOrNull(act.training_load),
        maxHr: numberOrNull(act.max_hr),
        avgCadence: numberOrNull(act.avg_cadence),
        maxCadence: numberOrNull(act.max_cadence),
        avgStrideLengthCm: numberOrNull(act.avg_stride_length_cm),
        verticalOscillationCm: numberOrNull(act.vertical_oscillation_cm),
        verticalRatio: numberOrNull(act.vertical_ratio),
        groundContactTimeMs: numberOrNull(act.ground_contact_time_ms),
        aerobicTrainingEffect: numberOrNull(act.aerobic_training_effect),
        anaerobicTrainingEffect: numberOrNull(act.anaerobic_training_effect),
        trainingEffectLabel: stringOrNull(act.training_effect_label),
        staminaStart: numberOrNull(act.stamina_start),
        staminaEnd: numberOrNull(act.stamina_end),
        staminaMin: numberOrNull(act.stamina_min),
        vo2Max: numberOrNull(act.vo2_max),
        hrZones,
        powerZones,
        timeInZone2S: numberOrNull(act.time_in_zone2_s) ?? hrZones.find((zone) => zone.zone === 2)?.seconds ?? null,
      };
    });
    return { generatedAt: parsed.generated_at || null, activities };
  } catch {
    return { generatedAt: null, activities: [] };
  }
}

function emptyTrailHealth(): TrailHealth {
  return { generatedAt: null, user: { maxHr: null, maxHrSource: null, lactateThresholdHr: null }, days: [] };
}

export async function loadTrailHealth(): Promise<TrailHealth> {
  try {
    const raw = await fs.readFile(path.join(vaultRoot(), HEALTH_JSON), "utf-8");
    const parsed = JSON.parse(raw) as {
      generated_at?: string;
      user?: Record<string, unknown>;
      days?: unknown[];
    };
    const user = (parsed.user && typeof parsed.user === "object" ? parsed.user : {}) as Record<string, unknown>;
    const days: TrailHealthDay[] = (Array.isArray(parsed.days) ? parsed.days : []).map((d) => {
      const day = d as Record<string, unknown>;
      return {
        date: String(day.date || ""),
        sleepScore: numberOrNull(day.sleep_score),
        sleepH: numberOrNull(day.sleep_h),
        rhr: numberOrNull(day.rhr),
        hrvAvg: numberOrNull(day.hrv_avg),
        bbMin: numberOrNull(day.bb_min),
        bbMax: numberOrNull(day.bb_max),
        readiness: numberOrNull(day.readiness),
      };
    });
    return {
      generatedAt: parsed.generated_at || null,
      user: {
        maxHr: numberOrNull(user.max_hr),
        maxHrSource: stringOrNull(user.max_hr_source),
        lactateThresholdHr: numberOrNull(user.lactate_threshold_hr),
      },
      days,
    };
  } catch {
    return emptyTrailHealth();
  }
}

function emptyTrailPerformance(): TrailPerformanceData {
  return { generatedAt: null, historyStart: null, vo2History: [], trainingStatusHistory: [], readiness: null };
}

function stringFieldOrNull(item: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = stringOrNull(item[key]);
    if (value) return value;
  }
  return null;
}

function numberFieldOrNull(item: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = numberOrNull(item[key]);
    if (value !== null) return value;
  }
  return null;
}

function vo2Point(raw: unknown): TrailVo2Point | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const date = stringFieldOrNull(item, "date");
  if (!date) return null;
  return {
    date,
    value: numberFieldOrNull(item, "value"),
    precise: numberFieldOrNull(item, "precise"),
  };
}

// performance-data.json (dedicated VO2max/training-status history) is not yet
// written by the RPi sync script. Every activity already carries its own
// Garmin vo2Max estimate, so fall back to that history instead of leaving the
// panel permanently empty.
function vo2HistoryFromActivities(activities: TrailActivity[]): TrailVo2Point[] {
  return activities
    .filter((activity): activity is TrailActivity & { vo2Max: number } => activity.vo2Max !== null)
    .map((activity) => ({ date: activity.date, value: activity.vo2Max, precise: activity.vo2Max }));
}

// The dedicated Garmin performance export is not available on every account,
// while the activity feed still carries Garmin's per-session training load.
// Rebuild the two useful load indicators from that feed instead of rendering
// an empty card. When an older activity has no load, duration + Training Effect
// provide a deliberately conservative estimate so the history remains usable.
export function trainingStatusFromActivities(activities: TrailActivity[]): TrailTrainingStatusPoint[] {
  const ordered = [...activities]
    .filter((activity) => parseIsoDate(activity.date))
    .sort((left, right) => left.date.localeCompare(right.date));
  if (!ordered.length) return [];

  const loadOf = (activity: TrailActivity) => activity.trainingLoad
    ?? Math.round((activity.durS / 3600) * (20 + (activity.aerobicTrainingEffect ?? 1.5) * 15));
  const dates = [...new Set(ordered.map((activity) => activity.date))];
  const firstDate = parseIsoDate(dates[0]) as Date;

  return dates.map((date) => {
    const current = parseIsoDate(date) as Date;
    const day = current.getTime();
    const within = (activity: TrailActivity, days: number) => {
      const activityDate = parseIsoDate(activity.date);
      if (!activityDate) return false;
      const age = (day - activityDate.getTime()) / 86400000;
      return age >= 0 && age < days;
    };
    const acuteLoad = Math.round(ordered.filter((activity) => within(activity, 7)).reduce((sum, activity) => sum + loadOf(activity), 0));
    const chronicTotal = ordered.filter((activity) => within(activity, 28)).reduce((sum, activity) => sum + loadOf(activity), 0);
    const observedDays = Math.min(28, Math.max(7, Math.round((day - firstDate.getTime()) / 86400000) + 1));
    const chronicLoad = Math.round(chronicTotal / (observedDays / 7));
    const acwr = chronicLoad > 0 ? acuteLoad / chronicLoad : null;
    const acwrStatus = acwr === null ? null : acwr > 1.5 ? "HIGH" : acwr >= 0.8 && acwr <= 1.3 ? "OPTIMAL" : acwr < 0.6 ? "LOW" : "MODERATE";
    const phrase = acwr === null ? null : acwr > 1.5 ? "STRAINED" : acwr >= 0.8 && acwr <= 1.3 ? "PRODUCTIVE" : "MAINTAINING";
    return {
      date,
      phrase,
      trainingStatus: null,
      fitnessTrend: null,
      acuteLoad,
      chronicLoad,
      acwr: acwr === null ? null : Math.round(acwr * 100) / 100,
      acwrStatus,
    };
  });
}

function trainingStatusPoint(raw: unknown): TrailTrainingStatusPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const date = stringFieldOrNull(item, "date");
  if (!date) return null;
  return {
    date,
    phrase: stringFieldOrNull(item, "phrase"),
    trainingStatus: numberFieldOrNull(item, "trainingStatus", "training_status"),
    fitnessTrend: numberFieldOrNull(item, "fitnessTrend", "fitness_trend"),
    acuteLoad: numberFieldOrNull(item, "acuteLoad", "acute_load"),
    chronicLoad: numberFieldOrNull(item, "chronicLoad", "chronic_load"),
    acwr: numberFieldOrNull(item, "acwr"),
    acwrStatus: stringFieldOrNull(item, "acwrStatus", "acwr_status"),
  };
}

function readinessFromJson(raw: unknown): TrailReadiness | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  return {
    date: stringFieldOrNull(item, "date"),
    score: numberFieldOrNull(item, "score"),
    level: stringFieldOrNull(item, "level"),
    sleepScore: numberFieldOrNull(item, "sleepScore", "sleep_score"),
    hrvWeeklyAverage: numberFieldOrNull(item, "hrvWeeklyAverage", "hrv_weekly_average"),
    recoveryTimeMinutes: numberFieldOrNull(item, "recoveryTimeMinutes", "recovery_time_minutes", "recoveryTime", "recovery_time"),
  };
}

export async function loadTrailPerformance(): Promise<TrailPerformanceData> {
  try {
    const raw = await fs.readFile(path.join(vaultRoot(), PERFORMANCE_JSON), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      generatedAt: stringFieldOrNull(parsed, "generated_at", "generatedAt"),
      historyStart: stringFieldOrNull(parsed, "history_start", "historyStart"),
      vo2History: Array.isArray(parsed.vo2_history)
        ? parsed.vo2_history.map(vo2Point).filter((item): item is TrailVo2Point => item !== null)
        : [],
      trainingStatusHistory: Array.isArray(parsed.training_status_history)
        ? parsed.training_status_history.map(trainingStatusPoint).filter((item): item is TrailTrainingStatusPoint => item !== null)
        : [],
      readiness: readinessFromJson(parsed.readiness),
    };
  } catch {
    return emptyTrailPerformance();
  }
}

export async function loadTrailCoachDecision(): Promise<TrailCoachDecision | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(vaultRoot(), COACH_DECISION_JSON), "utf-8")) as Record<string, unknown>;
    const generatedAt = stringFieldOrNull(parsed, "generated_at", "generatedAt");
    const activityCount = numberFieldOrNull(parsed, "activity_count", "activityCount");
    const engine = stringFieldOrNull(parsed, "engine");
    const summary = stringFieldOrNull(parsed, "summary");
    const nextAction = stringFieldOrNull(parsed, "next_action", "nextAction");
    const decisions = Array.isArray(parsed.decisions) ? parsed.decisions.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
    const evidence = Array.isArray(parsed.evidence) ? parsed.evidence.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
    if (!generatedAt || !engine || !summary || !nextAction || !decisions.length) return null;
    return { generatedAt, activityCount, engine, summary, decisions: decisions.slice(0, 3), evidence: evidence.slice(0, 4), nextAction };
  } catch {
    return null;
  }
}

export async function generateTrailCoachDecision(): Promise<TrailCoachDecision> {
  // Set before the first await so a concurrent caller in the same tick already
  // sees the run: a coach analysis costs minutes of AI budget, and the flag is
  // also what lets a reloaded page know one is still in flight.
  coachRefreshInFlight = true;
  try {
    return await runTrailCoachDecision();
  } finally {
    coachRefreshInFlight = false;
  }
}

// True while any coach analysis (manual or the automatic staleness refresh) is
// running in this server process.
export function trailCoachIsRunning(): boolean {
  return coachRefreshInFlight;
}

async function runTrailCoachDecision(): Promise<TrailCoachDecision> {
  const config = planBridgeConfig();
  if (!config) throw new Error("Bridge IA non configuré");
  const ai = await aiSetupPreferences(process.env.WEEKLY_MODEL);
  if (!ai.engineOrder.length) throw new Error("Aucun moteur IA connecté ou vérifié");
  const [sync, feedback, health, performance, plan] = await Promise.all([
    loadTrailData(),
    loadTrailFeedback(),
    loadTrailHealth(),
    loadTrailPerformance(),
    loadTrainingPlan(),
  ]);
  const now = new Date();
  const currentWeek = Math.max(1, Math.min(plan.weeks.length, Math.floor((now.getTime() - parseIsoDate(plan.objective.startDate)!.getTime()) / 604800000) + 1));
  const response = await fetch(`${config.url.replace(/\/+$/, "")}/coach`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
    body: JSON.stringify({
      objective: plan.objective,
      current_week: plan.weeks[currentWeek - 1] || null,
      recent_activities: sync.activities.slice(-14).map((activity) => ({
        ...activity,
        discipline: activityDiscipline(activity),
      })),
      feedback: feedback.slice(-14),
      health: health.days.slice(-14),
      performance: {
        training_status: performance.trainingStatusHistory.slice(-8),
        readiness: performance.readiness,
        vo2: performance.vo2History.slice(-8),
      },
      engine_order: ai.engineOrder,
      models: ai.models,
    }),
    signal: AbortSignal.timeout(Number(process.env.AI_WEEKLY_TIMEOUT_MS || 240000)),
  });
  const json = await response.json().catch(() => null) as {
    ok?: boolean;
    engine?: string;
    error?: string;
    error_code?: string;
    decision?: { summary?: string; decisions?: string[]; evidence?: string[]; next_action?: string };
  } | null;
  if (!response.ok || !json?.ok || !json.decision) {
    // The bridge classifies why no engine answered (quota, auth, timeout);
    // the code travels with the error so the UI can show a localized cause
    // instead of a generic failure.
    throw new AiEngineError(json?.error || `Bridge IA HTTP ${response.status}`, json?.error_code);
  }
  const summary = String(json.decision.summary || "").trim();
  const decisions = (json.decision.decisions || []).map(String).map((item) => item.trim()).filter(Boolean).slice(0, 3);
  const evidence = (json.decision.evidence || []).map(String).map((item) => item.trim()).filter(Boolean).slice(0, 4);
  const nextAction = String(json.decision.next_action || "").trim();
  if (!summary || !decisions.length || !nextAction) throw new Error("Décision coach IA incomplète");
  const result: TrailCoachDecision = {
    generatedAt: new Date().toISOString(),
    activityCount: sync.activities.length,
    engine: String(json.engine || "ai"),
    summary,
    decisions,
    evidence,
    nextAction,
  };
  await atomicWriteFile(path.join(vaultRoot(), COACH_DECISION_JSON), `${JSON.stringify({
    generated_at: result.generatedAt,
    activity_count: result.activityCount,
    engine: result.engine,
    summary: result.summary,
    decisions: result.decisions,
    evidence: result.evidence,
    next_action: result.nextAction,
  }, null, 2)}\n`);
  return result;
}

// The activity count catches multiple Garmin syncs on the same day. The date
// comparison keeps decisions written before activity_count was introduced
// working until their next refresh.
function coachDecisionIsStale(stats: Pick<TrailStats, "coachDecision" | "allActivities">): boolean {
  if (!stats.coachDecision) return true;
  if (stats.coachDecision.activityCount !== null) return stats.allActivities.length !== stats.coachDecision.activityCount;
  const latestActivityDate = stats.allActivities.reduce((max, activity) => (activity.date > max ? activity.date : max), "");
  return latestActivityDate > stats.coachDecision.generatedAt.slice(0, 10);
}

let coachRefreshInFlight = false;
let coachRefreshLastAttempt = 0;
const COACH_REFRESH_COOLDOWN_MS = 30 * 60 * 1000;

// Called from the page after computeTrailStats (never from inside it, since
// the daily brief also calls computeTrailStats and must not trigger AI runs
// as a side effect). Fires the regeneration without awaiting it — the page
// must not block on a 1-3 minute bridge call — and reports staleness so the
// UI can show a "still analyzing" badge over the previous decision.
// ponytail: single in-process guard, fine for this single-node deploy; a
// multi-instance deployment would need a shared lock instead.
export function maybeRefreshTrailCoachDecision(
  stats: Pick<TrailStats, "coachDecision" | "allActivities">,
): { stale: boolean; running: boolean } {
  const stale = coachDecisionIsStale(stats);
  const canAttempt = stale && !coachRefreshInFlight && Date.now() - coachRefreshLastAttempt > COACH_REFRESH_COOLDOWN_MS;
  if (canAttempt) {
    coachRefreshLastAttempt = Date.now();
    // generateTrailCoachDecision owns the in-flight flag on both its paths.
    generateTrailCoachDecision()
      .catch((error) => console.error("[trail] auto coach refresh failed", error));
  }
  return { stale, running: coachRefreshInFlight };
}

export async function loadTrailFeedback(): Promise<TrailFeedback[]> {
  let list: TrailFeedback[];
  try {
    const raw = await fs.readFile(path.join(vaultRoot(), FEEDBACK_JSON), "utf-8");
    const parsed = JSON.parse(raw) as { feedback?: TrailFeedback[] };
    list = Array.isArray(parsed.feedback) ? parsed.feedback : [];
  } catch {
    return [];
  }
  if (!list.length) return list;

  // One-time self-heal: the Garmin sync script started writing a stable
  // numeric `id` per activity, and activityId() now prefers it over the
  // legacy composite key (date::type::name). Feedback saved before that
  // change is still keyed under the composite form and would otherwise
  // silently stop matching any activity (its RPE/pain notes would vanish
  // from the Journal multisport). Rewrite those entries in place, once.
  const activities = (await loadTrailData()).activities;
  if (!activities.length) return list;

  const currentIds = new Set(activities.map((activity) => activity.id));
  const legacyMap = new Map(activities.map((activity) => [legacyActivityKey(activity), activity.id]));

  // Group every entry by the numeric id it would end up under (its own id if
  // already current, or the id its legacy key maps to). A group of size 1 is
  // migrated (or left alone) directly. A group of size >1 is a collision: an
  // already-numeric entry and a legacy entry (or two legacy entries) that
  // would land on the same activity. We never merge or drop feedback, so we
  // keep only the most recent entry (by createdAt) under the numeric id and
  // leave every other entry in the group completely unmodified under its old
  // key — it stays "unmatched" rather than silently overwriting newer notes.
  const byTarget = new Map<string, TrailFeedback[]>();
  for (const entry of list) {
    const target = currentIds.has(entry.activityId) ? entry.activityId : legacyMap.get(entry.activityId);
    if (!target) continue; // true orphan: no known activity, current or legacy
    const group = byTarget.get(target) ?? [];
    group.push(entry);
    byTarget.set(target, group);
  }

  const rewrites = new Map<TrailFeedback, string>();
  for (const [target, group] of byTarget) {
    const keep = group.length === 1 ? group[0] : [...group].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (keep.activityId !== target) rewrites.set(keep, target);
    // Any other member of the group (only possible when group.length > 1)
    // keeps its original activityId untouched, per the collision guard above.
  }

  if (!rewrites.size) return list;

  const next = list.map((entry) => {
    const migratedId = rewrites.get(entry);
    return migratedId ? { ...entry, activityId: migratedId } : entry;
  });
  await atomicWriteFile(path.join(vaultRoot(), FEEDBACK_JSON), `${JSON.stringify({ feedback: next }, null, 2)}\n`);
  return next;
}

export async function saveTrailFeedback(input: Omit<TrailFeedback, "createdAt">): Promise<TrailFeedback> {
  const activities = (await loadTrailData()).activities;
  if (!activities.some((activity) => activity.id === input.activityId)) throw new Error("Séance introuvable");
  if (!Number.isInteger(input.rpe) || input.rpe < 1 || input.rpe > 10) throw new Error("RPE invalide");
  if (!Number.isInteger(input.pain) || input.pain < 0 || input.pain > 10) throw new Error("Douleur invalide");
  if (!["great", "good", "neutral", "hard"].includes(input.feeling)) throw new Error("Ressenti invalide");

  const feedback: TrailFeedback = { ...input, note: input.note.slice(0, 1000), createdAt: new Date().toISOString() };
  const existing = await loadTrailFeedback();
  const next = [...existing.filter((item) => item.activityId !== input.activityId), feedback];
  await atomicWriteFile(path.join(vaultRoot(), FEEDBACK_JSON), `${JSON.stringify({ feedback: next }, null, 2)}\n`);
  return feedback;
}

function weekStatus(week: PlanWeek, match: WeekMatch, currentWeek: number): WeekStats["status"] {
  if (week.week < currentWeek) {
    if (match.plannedCount > 0 && match.doneCount >= match.plannedCount) return "done";
    return match.doneCount > 0 ? "partial" : "missed";
  }
  if (week.week === currentWeek) return "current";
  return "upcoming";
}

function buildInsights(stats: Omit<TrailStats, "insights" | "nextSession">): string[] {
  const out: string[] = [];
  const runs = stats.allRuns;
  const feedbackById = new Map(stats.feedback.map((item) => [item.activityId, item]));
  const recentFeedback = [...stats.feedback].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);
  const painful = stats.allActivities.filter((activity) => (feedbackById.get(activity.id)?.pain || 0) > 3);
  const current = stats.weeks[stats.currentWeek - 1];

  if (painful.length) {
    out.push(`Décision récupération : douleur > 3/10 sur ${painful.length} séance${painful.length > 1 ? "s" : ""}. Ne pas augmenter la charge avant un retour à ≤ 3/10 le lendemain.`);
  } else if (recentFeedback.some((feedback) => feedback.rpe >= 8)) {
    out.push("Décision assimilation : un effort récent est coté RPE 8/10 ou plus. Conserver la prochaine séance facile et ne pas rattraper un entraînement manqué.");
  } else if (stats.feedback.length) {
    out.push("Décision progression : aucun signal de douleur > 3/10 dans les feedbacks. Le plan peut avancer si le ressenti reste stable à 24 h.");
  }

  if (current) {
    const due = current.match.sessions.filter((session) => !["upcoming", "cancelled"].includes(session.outcome));
    const missed = due.filter((session) => session.outcome === "missed");
    if (missed.length) out.push(`${missed.length} séance${missed.length > 1 ? "s" : ""} non réalisée${missed.length > 1 ? "s" : ""} cette semaine : ne pas les empiler ; reprendre la prochaine séance prévue.`);
    else if (due.length) out.push(`Plan tenu : ${current.match.doneCount}/${due.length} séance${due.length > 1 ? "s" : ""} due${due.length > 1 ? "s" : ""} réalisée${due.length > 1 ? "s" : ""}.`);
  }

  if (!runs.length) {
    if (!out.length) out.push("Aucune course synchronisée pour le moment.");
    return out.slice(0, 4);
  }

  const recent = runs.slice(-3);
  const paces = recent.map((run) => run.paceSPerKm).filter((pace): pace is number => Boolean(pace));
  if (paces.length) {
    const avg = paces.reduce((a, b) => a + b, 0) / paces.length;
    if (avg >= 360 && avg <= 460) out.push(`Allure récente maîtrisée : ${fmtPace(avg)} de moyenne, cohérente avec une reprise facile.`);
    else if (avg < 360) out.push(`Allure récente rapide (${fmtPace(avg)}). Le facteur limitant reste la tolérance musculo-tendineuse, pas le cardio.`);
  }

  const zoneRuns = recent.filter((run) => run.hrZones.length || run.timeInZone2S !== null);
  if (zoneRuns.length) {
    const totalSeconds = zoneRuns.reduce((sum, run) => sum + run.durS, 0);
    const z2Seconds = zoneRuns.reduce((sum, run) => sum + (run.timeInZone2S || 0), 0);
    const z3PlusSeconds = zoneRuns.reduce((sum, run) =>
      sum + run.hrZones.filter((zone) => zone.zone >= 3).reduce((zoneSum, zone) => zoneSum + zone.seconds, 0), 0);
    const z2Pct = totalSeconds ? Math.round((z2Seconds / totalSeconds) * 100) : 0;
    const z3Pct = totalSeconds ? Math.round((z3PlusSeconds / totalSeconds) * 100) : 0;
    if (z2Pct >= 65 && z3Pct <= 25) out.push(`Zone 2 bien tenue sur les dernières courses : ${z2Pct}% du temps en Z2, seulement ${z3Pct}% en Z3+.`);
    else if (z3Pct > 35) out.push(`Intensité à surveiller : ${z3Pct}% du temps récent en Z3+. Pour l'endurance fondamentale, ralentir ou marcher plus tôt.`);
    else out.push(`Répartition cardio récente : ${z2Pct}% en Z2 et ${z3Pct}% en Z3+. Objectif : maximiser l'aisance respiratoire.`);
  }

  const aerobicEffects = recent.map((run) => run.aerobicTrainingEffect).filter((value): value is number => value !== null);
  if (aerobicEffects.length) {
    const avgAerobic = aerobicEffects.reduce((sum, value) => sum + value, 0) / aerobicEffects.length;
    const anaerobic = Math.max(...recent.map((run) => run.anaerobicTrainingEffect || 0));
    if (avgAerobic >= 2 && avgAerobic <= 3.5 && anaerobic <= 0.5) out.push(`Effet d'entraînement cohérent avec la base aérobie : TE aérobie ${avgAerobic.toFixed(1).replace(".", ",")} moyen, anaérobie quasi nul.`);
    else if (anaerobic > 1) out.push(`La composante anaérobie monte (${anaerobic.toFixed(1).replace(".", ",")}). À réserver aux séances qualité, pas aux sorties Z2.`);
  }

  const latestStatus = stats.performance.trainingStatusHistory.at(-1);
  const latestVo2 = stats.performance.vo2History.filter((point) => point.precise !== null || point.value !== null).at(-1);
  const latestReadiness = stats.performance.readiness;
  const performanceBits = [
    latestVo2 ? `VO2max ${latestVo2.precise ?? latestVo2.value}` : null,
    latestStatus?.acwr ? `ACWR ${latestStatus.acwr.toFixed(2)}` : null,
    latestReadiness?.score ? `readiness ${latestReadiness.score}` : null,
  ].filter(Boolean);
  if (performanceBits.length) out.push(`Garmin performance : ${performanceBits.join(" · ")}. À croiser avec la douleur et le sommeil avant d'ajouter de l'intensité.`);

  if (current && current.rides.length > 1) out.push(`${fmtKm(current.rideKm)} de vélo cette semaine : volume utile, mais l'intensité ne doit pas empiéter sur les jours de course.`);

  const activeAdjustments = stats.planAdjustments.filter((adjustment) => adjustment.action === "reschedule");
  if (activeAdjustments.length) {
    const latest = activeAdjustments[0];
    out.push(`Adaptation lue dans les notes : ${sportLabel(latest.sport)} du ${latest.fromIso} ${latest.toIso ? `reporté au ${latest.toIso}` : "à replanifier"} (${latest.sourceLabel}).`);
  }

  for (let i = 1; i < runs.length; i++) {
    const previous = new Date(`${runs[i - 1].date}T00:00:00`).getTime();
    const currentDate = new Date(`${runs[i].date}T00:00:00`).getTime();
    if (currentDate - previous === 86400000) {
      out.push("Deux courses ont été réalisées sur deux jours consécutifs : intercaler systématiquement une journée sans course.");
      break;
    }
  }

  return out.slice(0, 4);
}

// Cumulative plan-wide adherence, used only by the "Assiduité" metric card.
// Sums every week match up to and including the current week: a session is due
// once its day has passed or it is recorded, done once an activity is matched.
// Because it runs on the same matcher as every other widget, a session done on
// a shifted day counts here too, and pleasure/extra activities never inflate it.
// A cancelled session is neither due nor done: it drops out of both counts,
// same as it drops out of WeekMatch.plannedCount/doneCount.
function completionToDate(weeks: WeekStats[], currentWeek: number): { done: number; planned: number } {
  let done = 0;
  let planned = 0;
  for (const week of weeks) {
    if (week.plan.week > currentWeek) continue;
    for (const session of week.match.sessions) {
      if (session.outcome === "upcoming" || session.outcome === "cancelled") continue;
      planned += 1;
      if (session.outcome === "done" || session.outcome === "moved") done += 1;
    }
  }
  return { done, planned };
}

// Per-sport progress for the current week only (the "Progression par sport"
// card), read straight off the week match. A session counts as due once its
// day has passed or it is already recorded (so a long run done ahead of its
// planned day still lands in the numerator); still-future sessions are left
// out of both counts, and so are cancelled ones.
function sportProgressForWeek(match: WeekMatch | undefined): SportProgress[] {
  const sports = ["run", "ride", "strength"] as const;
  return sports.map((sport) => {
    const forSport = (match?.sessions ?? []).filter((session) => session.session.sport === sport);
    const due = forSport.filter((session) => session.outcome !== "upcoming" && session.outcome !== "cancelled");
    const done = due.filter((session) => session.outcome === "done" || session.outcome === "moved").length;
    const planned = due.length;
    return { sport, done, planned, percent: planned ? Math.min(100, Math.round((done / planned) * 100)) : 100 };
  });
}

export function nextSessionLabel(today: Date, weeks: PlanWeekData[], week: PlanWeekData | undefined): string {
  if (!week) return "Plan terminé · place à la course.";
  const weekday = (today.getDay() + 6) % 7;
  const tomorrow = weekday === 6 ? 0 : weekday + 1;
  const targetWeek = weekday === 6 ? weeks[week.week] : week;
  if (!targetWeek) return "Course le 20 septembre.";
  const session = plannedSessionsFor(targetWeek, tomorrow)[0];
  const date = new Date(today);
  date.setDate(date.getDate() + 1);
  if (!session) {
    return `${date.toLocaleDateString("fr-FR", { weekday: "long" })} · récupération ou jour sans séance planifiée.`;
  }
  return `${date.toLocaleDateString("fr-FR", { weekday: "long" })} · ${session.title} — ${session.subtitle}`;
}

export async function computeTrailStats(): Promise<TrailStats> {
  const plan = await loadTrainingPlan();
  const start = parseIsoDate(plan.objective.startDate) || PLAN_START;
  const raceDay = parseIsoDate(plan.objective.eventDate) || RACE_DAY;
  const weeksTotal = plan.objective.weeksTotal || WEEKS_TOTAL;

  const [data, health, performance, feedback, planAdjustments, planOverrides, coachDecision] = await Promise.all([
    loadTrailData(),
    loadTrailHealth(),
    loadTrailPerformance(),
    loadTrailFeedback(),
    loadTrailPlanAdjustments(plan.weeks, start),
    loadPlanOverrides(),
    loadTrailCoachDecision(),
  ]);
  const today = dateOnly(new Date());
  const daysToRace = Math.max(0, Math.round((raceDay.getTime() - today.getTime()) / 86400000));
  const currentWeek = Math.min(Math.max(Math.floor((today.getTime() - dateOnly(start).getTime()) / 86400000 / 7) + 1, 1), weeksTotal);

  const weeks: WeekStats[] = plan.weeks.map((planWeek) => {
    const activities = data.activities.filter((activity) => activity.week === planWeek.week);
    const runs = activities.filter((activity) => activity.kind === "run");
    const rides = activities.filter((activity) => activity.kind === "ride");
    const strength = activities.filter((activity) => activity.kind === "strength");
    const weekOverrides = planOverrides.filter((override) => override.week === planWeek.week);
    const match = matchWeek(planWeek, activities, today, currentWeek, weekOverrides, start);
    return {
      plan: planWeek,
      activities,
      runs,
      rides,
      strength,
      runKm: runs.reduce((sum, activity) => sum + activity.km, 0),
      runMin: runs.reduce((sum, activity) => sum + activity.durS, 0) / 60,
      runDplus: runs.reduce((sum, activity) => sum + activity.dplus, 0),
      rideKm: rides.reduce((sum, activity) => sum + activity.km, 0),
      rideMin: rides.reduce((sum, activity) => sum + activity.durS, 0) / 60,
      rideDplus: rides.reduce((sum, activity) => sum + activity.dplus, 0),
      strengthMin: strength.reduce((sum, activity) => sum + activity.durS, 0) / 60,
      totalMin: activities.reduce((sum, activity) => sum + activity.durS, 0) / 60,
      match,
      status: weekStatus(planWeek, match, currentWeek),
    };
  });

  const allActivities = [...data.activities].sort((a, b) => a.date.localeCompare(b.date));
  const allRuns = allActivities.filter((activity) => activity.kind === "run");
  const allRides = allActivities.filter((activity) => activity.kind === "ride");
  const allStrength = allActivities.filter((activity) => activity.kind === "strength");
  const weekday = (today.getDay() + 6) % 7;
  const sportProgress = sportProgressForWeek(weeks[currentWeek - 1]?.match);
  const cumulative = completionToDate(weeks, currentWeek);
  const completionPct = cumulative.planned ? Math.round((cumulative.done / cumulative.planned) * 100) : 100;

  const currentWeekActivitiesByDay = new Map<number, TrailActivity[]>();
  for (const activity of allActivities.filter((item) => item.week === currentWeek)) {
    const list = currentWeekActivitiesByDay.get(activity.weekday) || [];
    list.push(activity);
    currentWeekActivitiesByDay.set(activity.weekday, list);
  }

  const feedbackIds = new Set(feedback.map((item) => item.activityId));
  const pendingFeedback = [...allActivities].reverse().filter((activity) => !feedbackIds.has(activity.id));
  const currentPlanWeek = plan.weeks[currentWeek - 1];
  const performanceWithVo2 = performance.vo2History.length
    ? performance
    : { ...performance, vo2History: vo2HistoryFromActivities(allActivities) };
  const performanceWithFallback = performanceWithVo2.trainingStatusHistory.length
    ? performanceWithVo2
    : { ...performanceWithVo2, trainingStatusHistory: trainingStatusFromActivities(allActivities) };
  const base = {
    generatedAt: data.generatedAt,
    today,
    daysToRace,
    currentWeek,
    // The plan carries its own phase names, in whatever language it was
    // written; PHASE_LABELS only covers the legacy French plan.
    phaseLabel: plan.phases.find((phase) => phase.id === (currentPlanWeek?.phase ?? 1))?.name
      ?? PHASE_LABELS[currentPlanWeek?.phase ?? 1],
    plan,
    weeks,
    allActivities,
    allRuns,
    allRides,
    allStrength,
    feedback,
    planAdjustments,
    planOverrides,
    pendingFeedback,
    completionPct,
    sportProgress,
    currentWeekActivitiesByDay,
    todayActivities: currentWeekActivitiesByDay.get(weekday) || [],
    todaySessions: currentPlanWeek ? plannedSessionsFor(currentPlanWeek, weekday) : [],
    health,
    performance: performanceWithFallback,
    coachDecision,
  };

  return {
    ...base,
    insights: buildInsights(base),
    nextSession: nextSessionLabel(today, plan.weeks, currentPlanWeek),
  };
}
