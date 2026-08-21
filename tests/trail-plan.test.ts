import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PLAN,
  archiveTrainingPlan,
  clearPlanOverrides,
  fallbackTrainingPlan,
  generateAiTrainingPlan,
  loadPlanOverrides,
  loadTrailHealth,
  loadTrailPerformance,
  loadTrainingPlan,
  mondayOnOrBeforeIso,
  nextSessionLabel,
  plannedSessionsFor,
  saveTrainingPlan,
  saveTrainingPlanJson,
  savePlanOverride,
  validatePlanData,
  type PlanData,
  type PlanObjective,
} from "../src/lib/trail";
import { selectedTrailWeek } from "../src/lib/trail-format";

const PLAN_FILE = "08-Projects/Training/plan-data.json";
const HEALTH_FILE = "08-Projects/Trail-26K/health-data.json";
const PERFORMANCE_FILE = "08-Projects/Trail-26K/performance-data.json";

test("trail week selection defaults to today and clamps URL input to the plan", () => {
  assert.equal(selectedTrailWeek(undefined, 4, 12), 4);
  assert.equal(selectedTrailWeek("2", 4, 12), 2);
  assert.equal(selectedTrailWeek("0", 4, 12), 1);
  assert.equal(selectedTrailWeek("99", 4, 12), 12);
  assert.equal(selectedTrailWeek("oops", 4, 12), 4);
});

async function withTempVault(run: (root: string) => Promise<void>) {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "memo-trail-plan-"));
  process.env.SECOND_BRAIN_VAULT = root;
  try {
    await run(root);
  } finally {
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("first load migrates the legacy plan to plan-data.json; a second load is a stable read", async () => {
  await withTempVault(async (root) => {
    const filePath = path.join(root, PLAN_FILE);
    await assert.rejects(fs.stat(filePath), "plan file must not exist before the first load");

    const first = await loadTrainingPlan();
    const written = await fs.readFile(filePath, "utf-8");
    const mtime = (await fs.stat(filePath)).mtimeMs;
    assert.equal(first.version, 1);
    assert.equal(first.generatedBy, "migration");
    assert.equal(first.objective.weeksTotal, 12);
    assert.equal(first.weeks.length, 12);
    assert.equal(first.phases.length, 3);

    const second = await loadTrainingPlan();
    assert.deepEqual(second, first);
    assert.equal(await fs.readFile(filePath, "utf-8"), written, "a valid file must not be rewritten");
    assert.equal((await fs.stat(filePath)).mtimeMs, mtime, "a valid file must not be touched");
  });
});

test("migrated week-2 sessions equal the legacy switch output for every weekday", async () => {
  await withTempVault(async () => {
    const plan = await loadTrainingPlan();
    const migratedWeek2 = plan.weeks[1];
    // PLAN[1] has no sessions array, so plannedSessionsFor takes the legacy
    // switch: the exact pre-migration behavior, used here as the oracle.
    for (let weekday = 0; weekday <= 6; weekday++) {
      const expected = plannedSessionsFor(PLAN[1], weekday).map((session) => ({ ...session, weekday }));
      const actual = migratedWeek2.sessions.filter((session) => session.weekday === weekday);
      assert.deepEqual(actual, expected, `week 2 weekday ${weekday} diverges from the legacy plan`);
    }
  });
});

test("validatePlanData rejects structurally invalid plans", async () => {
  await withTempVault(async () => {
    const plan = await loadTrainingPlan();
    assert.ok(validatePlanData(plan), "the migrated plan itself must validate");

    const wrongVersion = { ...structuredClone(plan), version: 2 };
    assert.equal(validatePlanData(wrongVersion), null);

    const badWeekday: PlanData = structuredClone(plan);
    badWeekday.weeks[0].sessions[0].weekday = 7;
    assert.equal(validatePlanData(badWeekday), null);

    const duplicateIds: PlanData = structuredClone(plan);
    duplicateIds.weeks[0].sessions[1].id = duplicateIds.weeks[0].sessions[0].id;
    assert.equal(validatePlanData(duplicateIds), null);

    const weeksMismatch: PlanData = structuredClone(plan);
    weeksMismatch.objective.weeksTotal = 11;
    assert.equal(validatePlanData(weeksMismatch), null);

    const badMetrics: PlanData = structuredClone(plan);
    badMetrics.objective.weeklyVolumeKm = -1;
    assert.equal(validatePlanData(badMetrics), null);

    const strict = fallbackTrainingPlan(objective());
    const badSport = structuredClone(strict) as PlanData;
    badSport.objective.sport = "swim" as PlanObjective["sport"];
    assert.equal(validatePlanData(badSport), null);

    const badPhase = structuredClone(strict);
    badPhase.weeks[0].phase = 9 as PlanData["weeks"][number]["phase"];
    assert.equal(validatePlanData(badPhase), null);

    const nonFinite = structuredClone(strict);
    nonFinite.weeks[0].sessions[0].durationMin = Number.NaN;
    assert.equal(validatePlanData(nonFinite), null);

    const unavailable = structuredClone(strict);
    unavailable.weeks[0].sessions.push(...unavailable.weeks[0].sessions.slice(0, 2).map((session, index) => ({
      ...session,
      id: `extra-${index}`,
      sport: "strength" as const,
    })));
    assert.equal(validatePlanData(unavailable), null);
  });
});

test("saveTrainingPlanJson applies valid edits and invalidates the coach decision", async () => {
  await withTempVault(async (root) => {
    const plan = fallbackTrainingPlan(objective());
    await saveTrainingPlan(plan);
    const coachPath = path.join(root, "08-Projects/Training/coach-decision.json");
    await fs.writeFile(coachPath, "{}\n", "utf8");

    const edited = JSON.parse(
      await fs.readFile(path.join(root, PLAN_FILE), "utf8"),
    );
    edited.weeks[0].c1 = "42' facile";
    await saveTrainingPlanJson(edited);

    assert.equal((await loadTrainingPlan()).weeks[0].c1, "42' facile");
    await assert.rejects(fs.access(coachPath));
    await assert.rejects(saveTrainingPlanJson({}));
    assert.equal((await loadTrainingPlan()).weeks[0].c1, "42' facile");
  });
});

test("an invalid plan file is replaced by a fresh migration", async () => {
  await withTempVault(async (root) => {
    const filePath = path.join(root, PLAN_FILE);
    await saveTrainingPlan(fallbackTrainingPlan(objective()));
    const validDiskPlan = JSON.parse(await fs.readFile(filePath, "utf-8"));
    validDiskPlan.version = 99;
    await fs.writeFile(filePath, JSON.stringify(validDiskPlan));

    const plan = await loadTrainingPlan();
    assert.equal(plan.generatedBy, "migration");
    assert.equal(plan.weeks.length, 12);
    const onDisk = JSON.parse(await fs.readFile(filePath, "utf-8"));
    assert.equal(onDisk.version, 1);
    assert.equal(onDisk.generated_by, "migration");
  });
});

// --- T4: objective intake, AI generation, deterministic fallback ------------

function objective(overrides: Partial<PlanObjective> = {}): PlanObjective {
  return {
    sport: "run",
    title: "Objectif test",
    eventDate: "2026-12-20",
    startDate: "2026-09-01",
    weeksTotal: 10,
    level: "intermediaire",
    daysPerWeek: 4,
    constraints: "",
    ...overrides,
  };
}

for (const sport of ["trail", "run", "ride", "hybrid"] as const) {
  test(`fallbackTrainingPlan(${sport}) produces a structurally valid, weeksTotal-week plan`, () => {
    const plan = fallbackTrainingPlan(objective({ sport, weeksTotal: 10 }));
    assert.equal(plan.generatedBy, "fallback");
    assert.equal(plan.weeks.length, 10);
    assert.ok(validatePlanData(structuredClone(plan)), "fallback output must pass validatePlanData");
    assert.equal(plan.phases.length, 3);

    for (const week of plan.weeks) {
      const weekdays = week.sessions.map((session) => session.weekday);
      assert.ok(weekdays.includes(6), `week ${week.week} must have a session on the Sunday long-session slot`);
    }
  });
}

test("fallbackTrainingPlan(run) with at most 3 weekly runs keeps a rest day across week boundaries", () => {
  const plan = fallbackTrainingPlan(objective({ sport: "run", daysPerWeek: 4, weeksTotal: 6 }));
  const absoluteDays = plan.weeks.flatMap((week) => week.sessions
    .filter((session) => session.sport === "run")
    .map((session) => (week.week - 1) * 7 + session.weekday)).sort((a, b) => a - b);
  for (let index = 1; index < absoluteDays.length; index++) {
    assert.ok(absoluteDays[index] - absoluteDays[index - 1] > 1,
      `run sessions on consecutive calendar days ${absoluteDays[index - 1]}/${absoluteDays[index]}`);
  }
});

test("four weekly runs use exactly one explicit easy/easy adjacent pair", () => {
  const plan = fallbackTrainingPlan(objective({ sport: "run", daysPerWeek: 5, weeksTotal: 6 }));
  for (const week of plan.weeks.slice(0, -1)) {
    const runs = week.sessions.filter((session) => session.sport === "run").sort((left, right) => left.weekday - right.weekday);
    assert.equal(runs.length, 4);
    const adjacent = runs.slice(1).flatMap((run, index) => run.weekday - runs[index].weekday === 1 ? [[runs[index], run]] : []);
    assert.equal(adjacent.length, 1, `week ${week.week} must contain the unavoidable single adjacent pair`);
    assert.deepEqual(adjacent[0].map((session) => session.title), ["Endurance facile", "Endurance facile"]);
    assert.notEqual(runs[0].weekday, 0, "Sunday's long run must not be followed by a Monday run");
  }
});

test("fallbackTrainingPlan tapers: the final week's target is lower than the peak week", () => {
  const plan = fallbackTrainingPlan(objective({ sport: "run", weeksTotal: 10 }));
  const peak = plan.weeks[7]; // week 8: last non-taper week for a 10-week 40/40/20 split
  const last = plan.weeks[9]; // week 10: final taper week
  const eventMinutes = last.sessions.find((session) => session.title.startsWith("Objectif ·"))?.durationMin || 0;
  const taperTrainingMinutes = last.runMinTarget - eventMinutes;
  assert.ok(taperTrainingMinutes < peak.runMinTarget,
    `pre-event taper work (${taperTrainingMinutes}) must be lighter than the peak week (${peak.runMinTarget})`);
});

test("a zero or low baseline is not pulled toward ultra-distance training volume", () => {
  const zero = fallbackTrainingPlan(objective({
    sport: "trail", eventDistanceKm: 174, eventElevationM: 9900,
    weeklyVolumeKm: 0, longestSessionKm: 0, experience: "first", weeksTotal: 12,
  }));
  const low = fallbackTrainingPlan(objective({
    sport: "trail", eventDistanceKm: 174, eventElevationM: 9900,
    weeklyVolumeKm: 20, longestSessionKm: 10, experience: "first", weeksTotal: 12,
  }));
  assert.ok(zero.weeks[0].runMinTarget <= 120);
  assert.ok(Math.max(...zero.weeks[0].sessions.map((session) => session.durationMin || 0)) <= 60);
  assert.ok(low.weeks[0].runMinTarget <= 140);
});

test("fallbackTrainingPlan scales an UTMB objective beyond a 10 km road race without copying elite training volume", () => {
  const tenK = fallbackTrainingPlan(objective({
    sport: "run",
    eventDistanceKm: 10,
    eventElevationM: 0,
    weeklyVolumeKm: 20,
    longestSessionKm: 10,
    weeksTotal: 12,
  }));
  const utmb = fallbackTrainingPlan(objective({
    sport: "trail",
    eventDistanceKm: 174,
    eventElevationM: 9900,
    weeklyVolumeKm: 20,
    longestSessionKm: 10,
    weeksTotal: 12,
  }));
  const utmbTrainingWeeks = utmb.weeks.slice(0, -1);
  assert.ok(Math.max(...utmbTrainingWeeks.map((week) => week.runMinTarget)) > Math.max(...tenK.weeks.slice(0, -1).map((week) => week.runMinTarget)));
  assert.ok(Math.max(...utmbTrainingWeeks.map((week) => week.dplus)) <= 1000, "20 km/week must not produce an elite D+ target");
  assert.equal(Math.max(...tenK.weeks.map((week) => week.dplus)), 0);
});

test("fallbackTrainingPlan uses consolidation weeks before the peak", () => {
  const plan = fallbackTrainingPlan(objective({ sport: "run", weeksTotal: 12 }));
  assert.ok(plan.weeks[3].runMinTarget < plan.weeks[2].runMinTarget, "week 4 must unload after three loading weeks");
  assert.ok(plan.weeks[4].runMinTarget > plan.weeks[3].runMinTarget, "loading must resume after consolidation");
});

test("fallback road sessions are executable prescriptions and respect total availability", () => {
  const plan = fallbackTrainingPlan(objective({ sport: "run", weeksTotal: 12, daysPerWeek: 4 }));
  const quality = plan.weeks.flatMap((week) => week.sessions).find((session) => session.title === "Seuil contrôlé");
  assert.ok(quality, "the specific phase must contain a controlled quality workout");
  const prescription = quality.details.join(" ");
  for (const section of ["Échauffement", "Bloc principal", "Récupération", "Retour au calme", "Intention"]) {
    assert.match(prescription, new RegExp(section));
  }
  for (const week of plan.weeks.slice(0, -1)) {
    const mandatory = week.sessions.filter((session) => !session.optional);
    assert.equal(mandatory.length, 4, `week ${week.week} must fit four available sessions`);
    assert.ok(mandatory.filter((session) => session.intensity.includes("Z2-Z3")).length <= 1, "only one quality stimulus per week");
    assert.ok(mandatory.some((session) => session.sport === "strength"), "strength is part of availability, not an extra day");
    if (week.phase !== 3) {
      assert.ok(week.sessions.some((session) => session.sport === "ride" && session.optional), "an optional aerobic ride supports cross-training without reducing run availability");
    }
  }
});

test("quality prescription arithmetic always fits its declared duration", () => {
  const road = fallbackTrainingPlan(objective({ sport: "run", weeksTotal: 12, daysPerWeek: 5 }));
  const trail = fallbackTrainingPlan(objective({
    sport: "trail", eventDistanceKm: 90, eventElevationM: 6000, weeklyVolumeKm: 80,
    longestSessionKm: 35, experience: "several", weeksTotal: 12, daysPerWeek: 5,
  }));
  const minimums = new Map([
    ["Seuil contrôlé", 48],
    ["Montées & technique", 56],
    ["Durabilité trail spécifique", 64],
  ]);
  for (const session of [...road.weeks, ...trail.weeks].flatMap((week) => week.sessions)) {
    const minimum = minimums.get(session.title);
    if (minimum !== undefined) assert.ok((session.durationMin || 0) >= minimum,
      `${session.title} declares ${session.durationMin} min but its prescription needs at least ${minimum}`);
  }
  for (const title of minimums.keys()) {
    assert.ok([...road.weeks, ...trail.weeks].flatMap((week) => week.sessions).some((session) => session.title === title));
  }
});

test("fallback trail plan teaches terrain, power hiking, descents, durability and fueling at a scaled load", () => {
  const low = fallbackTrainingPlan(objective({
    sport: "trail",
    title: "UTMB",
    eventDate: "2026-08-28",
    startDate: "2026-06-08",
    eventDistanceKm: 174,
    eventElevationM: 9900,
    weeklyVolumeKm: 20,
    longestSessionKm: 10,
    experience: "first",
    weeksTotal: 12,
    daysPerWeek: 4,
  }));
  const high = fallbackTrainingPlan(objective({
    sport: "trail",
    title: "UTMB",
    eventDate: "2026-08-28",
    startDate: "2026-06-08",
    eventDistanceKm: 174,
    eventElevationM: 9900,
    weeklyVolumeKm: 90,
    longestSessionKm: 45,
    experience: "several",
    weeksTotal: 12,
    daysPerWeek: 5,
  }));
  const lowTraining = low.weeks.slice(0, -1);
  const allText = lowTraining.flatMap((week) => week.sessions).flatMap((session) => [session.title, ...session.details]).join(" ").toLowerCase();
  for (const principle of ["durabilité", "power hiking", "descente", "nutrition", "terrain"]) {
    assert.match(allText, new RegExp(principle));
  }
  const lowLongest = Math.max(...lowTraining.flatMap((week) => week.sessions).filter((session) => session.sport === "run").map((session) => session.durationMin || 0));
  const highLongest = Math.max(...high.weeks.slice(0, -1).flatMap((week) => week.sessions).filter((session) => session.sport === "run").map((session) => session.durationMin || 0));
  assert.ok(lowLongest < 180, "a first-time 20 km/week athlete must not receive elite-length training runs");
  assert.ok(highLongest > lowLongest, "a proven 90 km/week athlete may receive a larger specific load");
});

test("fallback event session has a coherent estimated duration, D+ and no hard session the day before", () => {
  const plan = fallbackTrainingPlan(objective({
    sport: "trail",
    title: "UTMB",
    eventDate: "2026-08-28",
    eventDistanceKm: 174,
    eventElevationM: 9900,
    weeksTotal: 12,
  }));
  const event = plan.weeks.at(-1)?.sessions.find((session) => session.title === "Objectif · UTMB");
  assert.equal(event?.weekday, 4, "2026-08-28 is a Friday (weekday 4 from Monday)");
  assert.ok(event?.durationMin && event.durationMin > 60 && event.durationMin <= 48 * 60);
  assert.match(event?.subtitle || "", /estimées/);
  const finalWeek = plan.weeks.at(-1)!;
  assert.equal(finalWeek.sessions.some((session) => session.weekday === 3
    && (session.sport === "run" || session.sport === "strength")), false);
  assert.equal(finalWeek.runMinTarget, finalWeek.sessions.filter((session) => session.sport === "run")
    .reduce((sum, session) => sum + (session.durationMin || 0), 0));
  assert.equal(finalWeek.dplus, 9900);
});

test("a Monday event removes hard work from the preceding Sunday", () => {
  const plan = fallbackTrainingPlan(objective({
    sport: "run",
    title: "10 km",
    eventDate: "2026-08-31",
    startDate: "2026-06-15",
    eventDistanceKm: 10,
    weeksTotal: 12,
  }));
  const previousWeek = plan.weeks.at(-2)!;
  assert.equal(previousWeek.sessions.some((session) => session.weekday === 6
    && (session.sport === "run" || session.sport === "strength")), false);
  assert.ok(validatePlanData(plan));
});

test("nextSessionLabel handles a recovery day without crashing", () => {
  const plan = fallbackTrainingPlan(objective({
    sport: "trail",
    startDate: "2026-07-13",
    eventDate: "2026-08-27",
    weeksTotal: 7,
  }));
  const week = structuredClone(plan.weeks[0]);
  week.sessions = week.sessions.filter((session) => session.weekday !== 3);
  assert.match(nextSessionLabel(new Date("2026-07-15T12:00:00Z"), [week], week), /jour sans séance planifiée/);
});

test("fallbackTrainingPlan uses current weekly volume and longest session", () => {
  const lowVolume = fallbackTrainingPlan(objective({
    eventDistanceKm: 10,
    eventElevationM: 0,
    weeklyVolumeKm: 10,
    longestSessionKm: 5,
    weeksTotal: 8,
  }));
  const highVolume = fallbackTrainingPlan(objective({
    eventDistanceKm: 10,
    eventElevationM: 0,
    weeklyVolumeKm: 80,
    longestSessionKm: 25,
    weeksTotal: 8,
  }));
  assert.ok(Math.max(...highVolume.weeks.map((week) => week.runMinTarget)) > Math.max(...lowVolume.weeks.map((week) => week.runMinTarget)));
});

test("generateAiTrainingPlan returns null (never throws) when the bridge is unreachable", async () => {
  const previousUrl = process.env.MEMO_BRIDGE_URL;
  const previousToken = process.env.MEMO_TOKEN;
  process.env.MEMO_BRIDGE_URL = "http://127.0.0.1:1"; // reserved port, connection refused immediately
  process.env.MEMO_TOKEN = "test-token";
  try {
    const result = await generateAiTrainingPlan(objective(), "");
    assert.equal(result, null);
  } finally {
    if (previousUrl === undefined) delete process.env.MEMO_BRIDGE_URL; else process.env.MEMO_BRIDGE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.MEMO_TOKEN; else process.env.MEMO_TOKEN = previousToken;
  }
});

test("generateAiTrainingPlan returns null when no bridge is configured (no throw)", async () => {
  const previousUrl = process.env.MEMO_BRIDGE_URL;
  const previousToken = process.env.MEMO_TOKEN;
  delete process.env.MEMO_BRIDGE_URL;
  delete process.env.MEMO_TOKEN;
  try {
    assert.equal(await generateAiTrainingPlan(objective(), ""), null);
  } finally {
    if (previousUrl !== undefined) process.env.MEMO_BRIDGE_URL = previousUrl;
    if (previousToken !== undefined) process.env.MEMO_TOKEN = previousToken;
  }
});

test("regenerating a plan archives the previous one and clears its overrides", async () => {
  await withTempVault(async (root) => {
    const original = fallbackTrainingPlan(objective({ sport: "run", weeksTotal: 6 }));
    await saveTrainingPlan(original);
    await savePlanOverride({ sessionId: original.weeks[0].sessions[0].id, week: 1, action: "cancel", toWeekday: null, reason: "Test", activityId: null });
    assert.equal((await loadPlanOverrides()).length, 1);

    const archivePath = await archiveTrainingPlan();
    assert.ok(archivePath, "archiveTrainingPlan must return a path when a plan already exists");
    const archived = JSON.parse(await fs.readFile(path.join(root, archivePath as string), "utf-8"));
    assert.equal(archived.generated_by, "fallback");
    assert.equal(archived.weeks.length, 6);

    await clearPlanOverrides();
    assert.deepEqual(await loadPlanOverrides(), []);

    const replacement = fallbackTrainingPlan(objective({ sport: "ride", weeksTotal: 8 }));
    await saveTrainingPlan(replacement);
    const reloaded = await loadTrainingPlan();
    assert.equal(reloaded.objective.sport, "ride");
    assert.equal(reloaded.weeks.length, 8);
  });
});

test("archiveTrainingPlan returns null when there is nothing to archive yet", async () => {
  await withTempVault(async () => {
    assert.equal(await archiveTrainingPlan(), null);
  });
});

test("mondayOnOrBeforeIso snaps any date to the Monday of its week (regression: T4 objective start dates)", () => {
  assert.equal(mondayOnOrBeforeIso("2026-07-12"), "2026-07-06", "2026-07-12 is a Sunday; its Monday is 2026-07-06");
  assert.equal(mondayOnOrBeforeIso("2026-06-29"), "2026-06-29", "a Monday snaps to itself");
  assert.equal(mondayOnOrBeforeIso("2026-07-08"), "2026-07-06", "a Wednesday snaps back to that week's Monday");
});

// --- E3: Garmin daily-health data (sleep, resting HR, HRV, body battery, readiness) ---

test("loadTrailHealth returns the empty shape when health-data.json does not exist yet", async () => {
  await withTempVault(async (root) => {
    const filePath = path.join(root, HEALTH_FILE);
    await assert.rejects(fs.stat(filePath), "health file must not exist before the first Garmin health sync");

    const health = await loadTrailHealth();
    assert.deepEqual(health, {
      generatedAt: null,
      user: { maxHr: null, maxHrSource: null, lactateThresholdHr: null },
      days: [],
    });
  });
});

test("loadTrailHealth parses a full fixture, mapping every snake_case field to its camelCase counterpart", async () => {
  await withTempVault(async (root) => {
    const filePath = path.join(root, HEALTH_FILE);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({
      generated_at: "2026-07-12T06:40:00",
      user: { max_hr: 191, max_hr_source: "MEASURED", lactate_threshold_hr: 172 },
      days: [
        { date: "2026-07-11", sleep_score: 78, sleep_h: 7.2, rhr: 49, hrv_avg: 62, bb_min: 18, bb_max: 96, readiness: 71 },
        { date: "2026-07-12", sleep_score: 82, sleep_h: 6.8, rhr: 47, hrv_avg: 65, bb_min: 22, bb_max: 98, readiness: 76 },
      ],
    }));

    const health = await loadTrailHealth();
    assert.equal(health.generatedAt, "2026-07-12T06:40:00");
    assert.deepEqual(health.user, { maxHr: 191, maxHrSource: "MEASURED", lactateThresholdHr: 172 });
    assert.equal(health.days.length, 2);
    assert.deepEqual(health.days[1], {
      date: "2026-07-12",
      sleepScore: 82,
      sleepH: 6.8,
      rhr: 47,
      hrvAvg: 65,
      bbMin: 22,
      bbMax: 98,
      readiness: 76,
    });
  });
});

test("loadTrailHealth tolerates partial days: missing fields become null instead of throwing", async () => {
  await withTempVault(async (root) => {
    const filePath = path.join(root, HEALTH_FILE);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({
      generated_at: "2026-07-12T06:40:00",
      user: { max_hr: null, max_hr_source: null, lactate_threshold_hr: null },
      days: [
        { date: "2026-07-12", sleep_score: null, sleep_h: null, rhr: 47, hrv_avg: null, bb_min: null, bb_max: null, readiness: null },
      ],
    }));

    const health = await loadTrailHealth();
    assert.deepEqual(health.user, { maxHr: null, maxHrSource: null, lactateThresholdHr: null });
    assert.deepEqual(health.days[0], {
      date: "2026-07-12",
      sleepScore: null,
      sleepH: null,
      rhr: 47,
      hrvAvg: null,
      bbMin: null,
      bbMax: null,
      readiness: null,
    });
  });
});

test("loadTrailHealth returns the empty shape when health-data.json is corrupt", async () => {
  await withTempVault(async (root) => {
    const filePath = path.join(root, HEALTH_FILE);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "{not valid json");

    const health = await loadTrailHealth();
    assert.deepEqual(health, {
      generatedAt: null,
      user: { maxHr: null, maxHrSource: null, lactateThresholdHr: null },
      days: [],
    });
  });
});

// --- E4: Garmin performance data (VO2max, training status, ACWR, readiness) ---

test("loadTrailPerformance returns the empty shape when performance-data.json does not exist yet", async () => {
  await withTempVault(async (root) => {
    const filePath = path.join(root, PERFORMANCE_FILE);
    await assert.rejects(fs.stat(filePath), "performance file must not exist before the first Garmin performance sync");

    const performance = await loadTrailPerformance();
    assert.deepEqual(performance, {
      generatedAt: null,
      historyStart: null,
      vo2History: [],
      trainingStatusHistory: [],
      readiness: null,
    });
  });
});

test("loadTrailPerformance parses VO2, training status and readiness fixtures", async () => {
  await withTempVault(async (root) => {
    const filePath = path.join(root, PERFORMANCE_FILE);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({
      generated_at: "2026-07-12T07:10:00",
      history_start: "2026-01-01",
      vo2_history: [
        { date: "2026-01-01", value: 48, precise: 48.2 },
        { date: "2026-07-12", value: 54, precise: 53.7 },
      ],
      training_status_history: [
        {
          date: "2026-07-12",
          phrase: "PRODUCTIVE",
          trainingStatus: 2,
          fitnessTrend: 1,
          acuteLoad: 612,
          chronicLoad: 534,
          acwr: 1.15,
          acwrStatus: "OPTIMAL",
        },
      ],
      readiness: {
        date: "2026-07-12",
        score: 78,
        level: "GOOD",
        sleepScore: 82,
        hrvWeeklyAverage: 64,
        recoveryTimeMinutes: 180,
      },
    }));

    const performance = await loadTrailPerformance();
    assert.equal(performance.generatedAt, "2026-07-12T07:10:00");
    assert.equal(performance.historyStart, "2026-01-01");
    assert.deepEqual(performance.vo2History[1], { date: "2026-07-12", value: 54, precise: 53.7 });
    assert.deepEqual(performance.trainingStatusHistory[0], {
      date: "2026-07-12",
      phrase: "PRODUCTIVE",
      trainingStatus: 2,
      fitnessTrend: 1,
      acuteLoad: 612,
      chronicLoad: 534,
      acwr: 1.15,
      acwrStatus: "OPTIMAL",
    });
    assert.deepEqual(performance.readiness, {
      date: "2026-07-12",
      score: 78,
      level: "GOOD",
      sleepScore: 82,
      hrvWeeklyAverage: 64,
      recoveryTimeMinutes: 180,
    });
  });
});

test("loadTrailPerformance ignores malformed points and returns empty shape when performance-data.json is corrupt", async () => {
  await withTempVault(async (root) => {
    const filePath = path.join(root, PERFORMANCE_FILE);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({
      vo2_history: [{ precise: 52 }, null, { date: "2026-07-12", precise: 53.4 }],
      training_status_history: [{ acwr: 1.1 }, { date: "2026-07-12", acwr: "1.2", acwr_status: "OPTIMAL" }],
      readiness: { score: "71", sleep_score: "80", hrv_weekly_average: "58", recovery_time: "240" },
    }));

    const partial = await loadTrailPerformance();
    assert.deepEqual(partial.vo2History, [{ date: "2026-07-12", value: null, precise: 53.4 }]);
    assert.deepEqual(partial.trainingStatusHistory, [{
      date: "2026-07-12",
      phrase: null,
      trainingStatus: null,
      fitnessTrend: null,
      acuteLoad: null,
      chronicLoad: null,
      acwr: 1.2,
      acwrStatus: "OPTIMAL",
    }]);
    assert.equal(partial.readiness?.score, 71);
    assert.equal(partial.readiness?.recoveryTimeMinutes, 240);

    await fs.writeFile(filePath, "{not valid json");
    const corrupt = await loadTrailPerformance();
    assert.deepEqual(corrupt, {
      generatedAt: null,
      historyStart: null,
      vo2History: [],
      trainingStatusHistory: [],
      readiness: null,
    });
  });
});
