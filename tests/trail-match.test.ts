import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PLAN,
  loadTrailData,
  loadPlanOverrides,
  loadTrailFeedback,
  matchWeek,
  planDateIso,
  removePlanOverride,
  savePlanOverride,
  trainingStatusFromActivities,
  type PlanOverride,
  type TrailActivity,
  type TrailFeedback,
} from "../src/lib/trail";

const WEEK2 = PLAN[1];

// A trackable activity on a given weekday of plan week 2.
function act(kind: TrailActivity["kind"], weekday: number, id = `${kind}-${weekday}`): TrailActivity {
  return {
    id,
    date: planDateIso(WEEK2.week, weekday),
    week: WEEK2.week,
    weekday,
    kind,
    type: kind,
    name: id,
    km: kind === "run" ? 8 : 0,
    durS: 3000,
    paceSPerKm: kind === "run" ? 420 : null,
    hr: 140,
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

// Saturday of plan week 2 (weekday 5), the day the real long run happened.
const SATURDAY = new Date(`${planDateIso(WEEK2.week, 5)}T00:00:00`);

test("a long run done Saturday fills the Sunday-planned slot as 'moved'", () => {
  const match = matchWeek(WEEK2, [act("run", 5, "long-run")], SATURDAY, WEEK2.week);
  const longRun = match.sessions.find((session) => session.plannedWeekday === 6 && session.session.sport === "run");
  assert.ok(longRun, "no Sunday long-run slot found");
  assert.equal(longRun.outcome, "moved");
  assert.equal(longRun.actualWeekday, 5);
  assert.equal(match.extras.length, 0, "the run should be consumed, not left as a bonus");
});

test("an activity recorded on its planned day is 'done', not 'moved'", () => {
  const match = matchWeek(WEEK2, [act("run", 1)], SATURDAY, WEEK2.week);
  const tue = match.sessions.find((session) => session.plannedWeekday === 1 && session.session.sport === "run");
  assert.equal(tue?.outcome, "done");
});

test("a past-due session with no activity is 'missed'; a future one is 'upcoming'", () => {
  const match = matchWeek(WEEK2, [], SATURDAY, WEEK2.week);
  const tue = match.sessions.find((session) => session.plannedWeekday === 1 && session.session.sport === "run");
  const sun = match.sessions.find((session) => session.plannedWeekday === 6 && session.session.sport === "run");
  assert.equal(tue?.outcome, "missed");
  assert.equal(sun?.outcome, "upcoming");
  assert.equal(match.doneCount, 0);
});

test("each activity claims the nearest free slot of its discipline", () => {
  // Two runs on Tue and Sat: Tue -> Tue slot (done), Sat -> Sunday slot (moved),
  // Thursday slot left missed. Greedy-by-activity keeps the long run on Sunday.
  const match = matchWeek(WEEK2, [act("run", 1, "r-tue"), act("run", 5, "r-sat")], SATURDAY, WEEK2.week);
  const outcomes = Object.fromEntries(
    match.sessions.filter((session) => session.session.sport === "run").map((session) => [session.plannedWeekday, session.outcome]),
  );
  assert.deepEqual(outcomes, { 1: "done", 3: "missed", 6: "moved" });
  assert.equal(match.doneCount, 2);
});

test("one Garmin strength activity completes exactly one planned strength session", () => {
  const match = matchWeek(WEEK2, [act("strength", 1, "strength-only")], SATURDAY, WEEK2.week);
  const strength = match.sessions.filter((session) => session.session.sport === "strength");
  assert.equal(strength.filter((session) => session.activity?.id === "strength-only").length, 1);
  assert.equal(strength.filter((session) => session.outcome === "done" || session.outcome === "moved").length, 1);
});

test("activity history provides a stable acute/chronic load fallback", () => {
  const first = { ...act("run", 0, "load-1"), date: "2026-07-01", trainingLoad: 50 };
  const second = { ...act("run", 1, "load-2"), date: "2026-07-09", trainingLoad: 70 };
  const history = trainingStatusFromActivities([first, second]);
  assert.equal(history.length, 2);
  assert.equal(history.at(-1)?.acuteLoad, 70);
  assert.equal(history.at(-1)?.chronicLoad, 93);
  assert.equal(history.at(-1)?.acwr, 0.75);
});

test("plannedCount counts only trackable sessions, not recovery/optional days", () => {
  const match = matchWeek(WEEK2, [], SATURDAY, WEEK2.week);
  // Week 2: 3 runs + 1 ride + 3 strength = 7 trackable planned sessions.
  assert.equal(match.plannedCount, 7);
});

// --- Manual plan overrides ---------------------------------------------------

function override(partial: Partial<PlanOverride> & Pick<PlanOverride, "sessionId" | "action">): PlanOverride {
  return {
    id: "test-override",
    createdAt: new Date().toISOString(),
    week: WEEK2.week,
    toWeekday: null,
    reason: "",
    activityId: null,
    ...partial,
  };
}

test("a moved session is re-evaluated on its new day: 'done' if recorded there, 'missed' if not", () => {
  // Tuesday's run session (w2-d1-run) moved to Friday (weekday 4), which the
  // legacy plan leaves as a non-trackable recovery day: no other run slot
  // competes for the effective weekday.
  const moved = override({ sessionId: "w2-d1-run", action: "move", toWeekday: 4 });

  const done = matchWeek(WEEK2, [act("run", 4, "run-fri")], SATURDAY, WEEK2.week, [moved]);
  const doneSession = done.sessions.find((session) => session.session.id === "w2-d1-run");
  assert.ok(doneSession);
  assert.equal(doneSession.plannedWeekday, 4);
  assert.equal(doneSession.outcome, "done");
  assert.equal(doneSession.overrideAction, "move");

  const missed = matchWeek(WEEK2, [], SATURDAY, WEEK2.week, [moved]);
  const missedSession = missed.sessions.find((session) => session.session.id === "w2-d1-run");
  assert.equal(missedSession?.outcome, "missed");
});

test("a cancelled session is excluded from planned/done counts; its would-be activity becomes an extra", () => {
  // Week 2 has exactly one ride session (Wednesday, w2-d2-ride): cancelling it
  // leaves no other ride slot for a same-week ride activity to fall into.
  const cancelled = override({ sessionId: "w2-d2-ride", action: "cancel", reason: "Douleur genou" });
  const baseline = matchWeek(WEEK2, [], SATURDAY, WEEK2.week);

  const match = matchWeek(WEEK2, [act("ride", 2, "ride-wed")], SATURDAY, WEEK2.week, [cancelled]);
  const cancelledSession = match.sessions.find((session) => session.session.id === "w2-d2-ride");
  assert.ok(cancelledSession);
  assert.equal(cancelledSession.outcome, "cancelled");
  assert.equal(cancelledSession.cancelReason, "Douleur genou");
  assert.equal(match.extras.some((activity) => activity.id === "ride-wed"), true, "the ride should fall through to extras, not be absorbed by the cancelled slot");
  assert.equal(match.plannedCount, baseline.plannedCount - 1);
  assert.equal(match.doneCount, baseline.doneCount);
});

test("a validate override forces 'done' with manual=true even without a matching activity", () => {
  const validated = override({ sessionId: "w2-d1-run", action: "validate" });
  const match = matchWeek(WEEK2, [], SATURDAY, WEEK2.week, [validated]);
  const session = match.sessions.find((item) => item.session.id === "w2-d1-run");
  assert.ok(session);
  assert.equal(session.outcome, "done");
  assert.equal(session.manual, true);
  assert.equal(session.activity, null);
  assert.equal(match.doneCount >= 1, true);
});

test("validating a moved session keeps its rescheduled weekday and date", () => {
  const validatedAfterMove = override({
    sessionId: "w2-d1-run",
    action: "validate",
    toWeekday: 4,
  });
  const match = matchWeek(WEEK2, [], SATURDAY, WEEK2.week, [validatedAfterMove]);
  const session = match.sessions.find((item) => item.session.id === "w2-d1-run");

  assert.ok(session);
  assert.equal(session.outcome, "done");
  assert.equal(session.manual, true);
  assert.equal(session.plannedWeekday, 4);
  assert.equal(session.plannedIso, planDateIso(WEEK2.week, 4));
});

test("a validate override with an activityId claims exactly that activity, not the nearest slot", () => {
  // Monday's activity would normally be claimed by the Tuesday run slot
  // (distance 1), the nearest free slot. Force-binding it to the Wednesday
  // slot via validate must keep the Tuesday slot unmatched.
  const monday = act("run", 0, "run-mon");
  const validated = override({ sessionId: "w2-d3-run", action: "validate", activityId: "run-mon" });

  const match = matchWeek(WEEK2, [monday], SATURDAY, WEEK2.week, [validated]);
  const wednesdaySlot = match.sessions.find((session) => session.session.id === "w2-d3-run");
  assert.ok(wednesdaySlot);
  assert.equal(wednesdaySlot.outcome, "done");
  assert.equal(wednesdaySlot.manual, true);
  assert.equal(wednesdaySlot.activity?.id, "run-mon");

  const tuesdaySlot = match.sessions.find((session) => session.session.id === "w2-d1-run");
  assert.equal(tuesdaySlot?.activity, null, "the pre-claimed activity must not also match the nearest slot");
  assert.equal(match.extras.length, 0, "the activity is claimed by validate, not left over as an extra");
});

async function withTempVault(run: () => Promise<void>) {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "memo-trail-overrides-"));
  process.env.SECOND_BRAIN_VAULT = root;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("loadTrailData parses enriched Garmin running metrics without requiring them on old sync files", async () => {
  await withTempVault(async () => {
    const syncPath = path.join(process.env.SECOND_BRAIN_VAULT as string, "08-Projects/Trail-26K/sync-data.json");
    await fs.mkdir(path.dirname(syncPath), { recursive: true });
    await fs.writeFile(syncPath, JSON.stringify({
      generated_at: "2026-07-12T08:00:00",
      activities: [{
        id: "23433044094",
        date: "2026-07-11",
        week: 2,
        weekday: 5,
        kind: "run",
        type: "trail_running",
        name: "Trail test",
        km: 8.049,
        dur_s: 3331.4,
        pace_s_per_km: 413.9,
        hr: 145,
        max_hr: 158,
        dplus: 38,
        avg_power: 194,
        normalized_power: 209,
        calories: 510,
        training_load: 32.1,
        avg_cadence: 150.1,
        max_cadence: 207,
        avg_stride_length_cm: 81.84,
        vertical_oscillation_cm: 7.61,
        vertical_ratio: 9.64,
        ground_contact_time_ms: 285.9,
        aerobic_training_effect: 2.3,
        anaerobic_training_effect: 0,
        training_effect_label: "Maintien",
        stamina_start: 99,
        stamina_end: 91,
        stamina_min: 91,
        vo2_max: 55,
        hr_zones: [
          { zone: 1, label: "Z1", seconds: 124.001, percent: 7.7, low_boundary: 93 },
          { zone: 2, label: "Z2", seconds: 779.429, percent: 48.4, low_boundary: 112 },
        ],
        power_zones: [{ zone: 1, label: "PZ1", seconds: 638.996, percent: 94.3 }],
      }],
    }));

    const data = await loadTrailData();
    assert.equal(data.activities[0].id, "23433044094");
    assert.equal(data.activities[0].maxHr, 158);
    assert.equal(data.activities[0].avgCadence, 150.1);
    assert.equal(data.activities[0].verticalOscillationCm, 7.61);
    assert.equal(data.activities[0].aerobicTrainingEffect, 2.3);
    assert.equal(data.activities[0].timeInZone2S, 779.429);
    assert.equal(data.activities[0].hrZones.length, 2);
    assert.equal(data.activities[0].powerZones[0].lowBoundary, null);
  });
});

test("savePlanOverride replaces any previous override for the same session; removePlanOverride clears it", async () => {
  await withTempVault(async () => {
    await savePlanOverride({ sessionId: "w2-d1-run", week: 2, action: "move", toWeekday: 4, reason: "", activityId: null });
    await savePlanOverride({ sessionId: "w2-d1-run", week: 2, action: "cancel", toWeekday: null, reason: "Douleur genou", activityId: null });

    const overrides = await loadPlanOverrides();
    assert.equal(overrides.length, 1, "the move override must be replaced, not accumulated");
    assert.equal(overrides[0].sessionId, "w2-d1-run");
    assert.equal(overrides[0].action, "cancel");
    assert.equal(overrides[0].reason, "Douleur genou");

    await removePlanOverride("w2-d1-run");
    assert.deepEqual(await loadPlanOverrides(), []);
  });
});

test("savePlanOverride carries a moved weekday into the validation that replaces it", async () => {
  await withTempVault(async () => {
    await savePlanOverride({
      sessionId: "w2-d1-run",
      week: 2,
      action: "move",
      toWeekday: 4,
      reason: "",
      activityId: null,
    });
    await savePlanOverride({
      sessionId: "w2-d1-run",
      week: 2,
      action: "validate",
      toWeekday: null,
      reason: "",
      activityId: null,
    });

    const overrides = await loadPlanOverrides();
    assert.equal(overrides.length, 1);
    assert.equal(overrides[0].action, "validate");
    assert.equal(overrides[0].toWeekday, 4);
  });
});

test("the same Garmin activity cannot manually validate two planned sessions", async () => {
  await withTempVault(async () => {
    const syncPath = path.join(process.env.SECOND_BRAIN_VAULT as string, "08-Projects/Trail-26K/sync-data.json");
    await fs.mkdir(path.dirname(syncPath), { recursive: true });
    await fs.writeFile(syncPath, JSON.stringify({ activities: [{
      id: "strength-one", date: planDateIso(2, 1), week: 2, weekday: 1,
      kind: "strength", type: "strength_training", name: "Musculation", km: 0, dur_s: 3600,
    }] }));

    await savePlanOverride({ sessionId: "w2-d0-strength", week: 2, action: "validate", toWeekday: null, reason: "", activityId: "strength-one" });
    await assert.rejects(
      savePlanOverride({ sessionId: "w2-d1-strength", week: 2, action: "validate", toWeekday: null, reason: "", activityId: "strength-one" }),
      /valide déjà une autre séance/,
    );
  });
});

test("loadTrailFeedback migrates legacy composite-keyed entries to the numeric activity id and is idempotent", async () => {
  await withTempVault(async () => {
    const vaultRoot = process.env.SECOND_BRAIN_VAULT as string;
    const syncPath = path.join(vaultRoot, "08-Projects/Trail-26K/sync-data.json");
    const feedbackPath = path.join(vaultRoot, "08-Projects/Trail-26K/feedback-data.json");
    await fs.mkdir(path.dirname(syncPath), { recursive: true });

    // Two activities from a Garmin sync that now writes a stable numeric id.
    await fs.writeFile(syncPath, JSON.stringify({
      generated_at: "2026-07-09T08:00:00",
      activities: [
        {
          id: "1111111111",
          date: "2026-07-08",
          week: 2,
          weekday: 1,
          kind: "strength",
          type: "strength_training",
          name: "Jambes + prevention",
          km: 0,
          dur_s: 2400,
        },
        {
          id: "2222222222",
          date: "2026-07-09",
          week: 2,
          weekday: 2,
          kind: "run",
          type: "trail_running",
          name: "Sortie",
          km: 10,
          dur_s: 3000,
        },
      ],
    }));

    const legacyEntry: TrailFeedback = {
      activityId: "2026-07-08::strength_training::Jambes + prevention",
      createdAt: "2026-07-08T20:00:00.000Z",
      rpe: 5,
      pain: 1,
      feeling: "good",
      note: "Jambes lourdes",
    };
    const currentEntry: TrailFeedback = {
      activityId: "2222222222",
      createdAt: "2026-07-09T20:00:00.000Z",
      rpe: 6,
      pain: 0,
      feeling: "great",
      note: "Bonne sortie",
    };
    const orphanEntry: TrailFeedback = {
      activityId: "2026-01-01::run::Nonexistent",
      createdAt: "2026-01-01T20:00:00.000Z",
      rpe: 3,
      pain: 0,
      feeling: "neutral",
      note: "Orpheline",
    };

    await fs.mkdir(path.dirname(feedbackPath), { recursive: true });
    await fs.writeFile(feedbackPath, `${JSON.stringify({ feedback: [legacyEntry, currentEntry, orphanEntry] }, null, 2)}\n`);

    const migrated = await loadTrailFeedback();
    assert.equal(migrated.length, 3, "no entry may be dropped or merged");

    const a = migrated.find((entry) => entry.note === "Jambes lourdes");
    assert.equal(a?.activityId, "1111111111", "legacy composite key must resolve to the activity's numeric id");

    const b = migrated.find((entry) => entry.note === "Bonne sortie");
    assert.equal(b?.activityId, "2222222222", "an already-numeric entry must be left untouched");

    const orphan = migrated.find((entry) => entry.note === "Orpheline");
    assert.equal(orphan?.activityId, "2026-01-01::run::Nonexistent", "a true orphan must be preserved verbatim");

    const onDisk = JSON.parse(await fs.readFile(feedbackPath, "utf-8")) as { feedback: TrailFeedback[] };
    assert.deepEqual(onDisk.feedback, [
      { ...legacyEntry, activityId: "1111111111" },
      currentEntry,
      orphanEntry,
    ]);

    const rawAfterFirstMigration = await fs.readFile(feedbackPath, "utf-8");
    await loadTrailFeedback();
    const rawAfterSecondMigration = await fs.readFile(feedbackPath, "utf-8");
    assert.equal(rawAfterSecondMigration, rawAfterFirstMigration, "a second load must find nothing left to migrate and must not rewrite the file");
  });
});

test("loadTrailFeedback keeps the most recent entry on the numeric id when a legacy and current entry collide, without touching the older one", async () => {
  await withTempVault(async () => {
    const vaultRoot = process.env.SECOND_BRAIN_VAULT as string;
    const syncPath = path.join(vaultRoot, "08-Projects/Trail-26K/sync-data.json");
    const feedbackPath = path.join(vaultRoot, "08-Projects/Trail-26K/feedback-data.json");
    await fs.mkdir(path.dirname(syncPath), { recursive: true });

    await fs.writeFile(syncPath, JSON.stringify({
      generated_at: "2026-07-09T08:00:00",
      activities: [{
        id: "3333333333",
        date: "2026-07-10",
        week: 2,
        weekday: 3,
        kind: "run",
        type: "trail_running",
        name: "Cotes",
        km: 6,
        dur_s: 1800,
      }],
    }));

    // Both entries would resolve to the same activity: an older entry still
    // under the legacy composite key, and a newer entry that was already
    // saved directly against the numeric id (e.g. the user gave fresh
    // feedback through the UI, which now resolves activityId() to the
    // numeric id, before the older composite entry was ever migrated).
    const olderLegacy: TrailFeedback = {
      activityId: "2026-07-10::trail_running::Cotes",
      createdAt: "2026-07-10T18:00:00.000Z",
      rpe: 4,
      pain: 0,
      feeling: "neutral",
      note: "Premiere note",
    };
    const newerNumeric: TrailFeedback = {
      activityId: "3333333333",
      createdAt: "2026-07-10T21:00:00.000Z",
      rpe: 7,
      pain: 2,
      feeling: "hard",
      note: "Note plus recente",
    };

    await fs.mkdir(path.dirname(feedbackPath), { recursive: true });
    await fs.writeFile(feedbackPath, `${JSON.stringify({ feedback: [olderLegacy, newerNumeric] }, null, 2)}\n`);

    const migrated = await loadTrailFeedback();
    assert.equal(migrated.length, 2, "neither entry may be dropped on a collision");

    const holder = migrated.filter((entry) => entry.activityId === "3333333333");
    assert.equal(holder.length, 1, "exactly one entry may hold the numeric id, never two");
    assert.equal(holder[0].note, "Note plus recente", "the most recent entry by createdAt keeps the numeric id");

    const untouched = migrated.find((entry) => entry.note === "Premiere note");
    assert.equal(untouched?.activityId, "2026-07-10::trail_running::Cotes", "the older, non-winning entry is left unmodified under its old legacy key rather than being migrated into a duplicate");
  });
});

test("matchWeek anchors plannedIso on a plan's own start date, not the legacy PLAN_START (regression: T4 objectives)", () => {
  // A generated plan can start on any Monday, not just PLAN_START (2026-06-29).
  // matchWeek's plannedIso must reflect the plan it was actually given.
  const customStart = new Date("2027-01-04T00:00:00"); // an arbitrary Monday
  const match = matchWeek(WEEK2, [], customStart, WEEK2.week, [], customStart);
  const tuesdayRun = match.sessions.find((session) => session.session.id === "w2-d1-run");
  assert.equal(tuesdayRun?.plannedIso, planDateIso(WEEK2.week, 1, customStart));
  assert.notEqual(tuesdayRun?.plannedIso, planDateIso(WEEK2.week, 1), "must not silently fall back to legacy PLAN_START for a non-legacy plan");
});
