import assert from "node:assert/strict";
import test from "node:test";
import { planDays } from "../src/components/TrailWorkspace";
import { planDateIso, type PlanOverride, type TrailStats } from "../src/lib/trail";

const START = "2026-06-29"; // a Monday
const TUESDAY = 1;
const THURSDAY = 3;

/**
 * The smallest TrailStats planDays actually reads: the plan itself, the
 * note-derived adjustments, the manual overrides, and the week matches.
 */
function stats(overrides: PlanOverride[], matchOutcome: "moved" | "done"): TrailStats {
  const session = {
    id: "s1",
    weekday: TUESDAY,
    sport: "run" as const,
    title: "C1 — 18' plat",
    subtitle: "",
    durationMin: 18,
    intensity: "easy",
    details: [],
  };
  return {
    plan: {
      version: 1,
      generatedBy: "test",
      objective: {
        sport: "trail", title: "Test", eventDate: "2026-09-20", startDate: START,
        weeksTotal: 1, level: "beginner", daysPerWeek: 3, constraints: "",
      },
      phases: [],
      weeks: [{
        week: 1, dates: "29/06 - 05/07", phase: 1,
        c1: "18' plat", c2: "20' plat", c3: "22' plat",
        dplus: 0, runMinTarget: 60,
        sessions: [session],
      }],
    },
    planAdjustments: [],
    planOverrides: overrides,
    weeks: [{
      match: {
        sessions: [{
          session,
          plannedWeekday: TUESDAY,
          plannedIso: planDateIso(1, TUESDAY, new Date(`${START}T00:00:00`)),
          outcome: matchOutcome,
          activity: null,
          // The matcher only ever reasons from the plan's own weekdays, so it
          // points back at Tuesday even after the athlete moved the card.
          actualIso: planDateIso(1, TUESDAY, new Date(`${START}T00:00:00`)),
          actualWeekday: TUESDAY,
          manual: false,
        }],
        extras: [],
        doneCount: 0,
        plannedCount: 1,
      },
    }],
  } as unknown as TrailStats;
}

function dayOf(days: ReturnType<typeof planDays>, sessionId: string) {
  return days.find((day) => day.sessions.some((session) => session.id === sessionId))?.iso;
}

const tuesdayIso = planDateIso(1, TUESDAY, new Date(`${START}T00:00:00`));
const thursdayIso = planDateIso(1, THURSDAY, new Date(`${START}T00:00:00`));

function override(action: PlanOverride["action"], toWeekday: number | null): PlanOverride {
  return { id: "o1", createdAt: "2026-06-30T10:00:00.000Z", sessionId: "s1", week: 1, action, toWeekday, reason: "", activityId: null };
}

test("a session validated by hand on the day it was moved to stays there", () => {
  const days = planDays(stats([override("validate", THURSDAY)], "moved"), "fr");
  assert.equal(dayOf(days, "s1"), thursdayIso, "manual validation must outrank the matcher's guess");
  const moved = days.find((day) => day.iso === thursdayIso)!.sessions.find((s) => s.id === "s1")!;
  assert.equal(moved.manualValidated, true);
});

test("without a manual validation the recorded activity still relocates the session", () => {
  const days = planDays(stats([], "moved"), "fr");
  assert.equal(dayOf(days, "s1"), tuesdayIso);
});

test("a plain move still yields to recorded-activity evidence", () => {
  // A move is a plan, not a claim about what happened, so Garmin may correct it.
  const days = planDays(stats([override("move", THURSDAY)], "moved"), "fr");
  assert.equal(dayOf(days, "s1"), tuesdayIso);
});
