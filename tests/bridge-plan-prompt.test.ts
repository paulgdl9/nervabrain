import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const BRIDGE = path.resolve("bridge/memo-bridge.py");

function planPrompt(sport: "run" | "trail") {
  const objective = {
    sport,
    title: sport === "trail" ? "Trail test" : "10 km test",
    event_date: "2026-10-18",
    start_date: "2026-08-03",
    weeks_total: 11,
    event_distance_km: sport === "trail" ? 90 : 10,
    event_elevation_m: sport === "trail" ? 6000 : 0,
    weekly_volume_km: 25,
    longest_session_km: 12,
    experience: "first",
    recent_reference: "10 km facile",
    level: "mesuré",
    days_per_week: 4,
    constraints: "indisponible le mercredi",
  };
  const script = [
    "import importlib.util, json, sys",
    "spec = importlib.util.spec_from_file_location('memo_bridge', sys.argv[1])",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "print(module.build_plan_prompt(json.loads(sys.argv[2]), 'fr', '', ''))",
  ].join("; ");
  return execFileSync("python3", ["-c", script, BRIDGE, JSON.stringify(objective)], { encoding: "utf8" });
}

function planShapeError(plan: object, daysPerWeek = 4) {
  const script = [
    "import importlib.util, json, sys",
    "spec = importlib.util.spec_from_file_location('memo_bridge', sys.argv[1])",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "plan = json.loads(sys.argv[2])",
    "print(module.check_plan_shape(plan, len(plan.get('weeks', [])), int(sys.argv[3]), plan.get('objective')))"
  ].join("; ");
  return execFileSync("python3", ["-c", script, BRIDGE, JSON.stringify(plan), String(daysPerWeek)], { encoding: "utf8" }).trim();
}

test("AI plan prompt encodes progressive coach-level road safeguards", () => {
  const prompt = planPrompt("run");
  for (const rule of [
    "never copy elite volume",
    "lighter deload week",
    "75-85%",
    "weekly_volume_km",
    "warm-up",
    "recovery between blocks",
    "cool-down",
    "at most one demanding quality workout",
    "actual event weekday",
  ]) {
    assert.ok(prompt.includes(rule), `missing prompt rule: ${rule}`);
  }
});

test("AI trail prompt requires terrain, hiking, descents, durability, fueling and strength", () => {
  const prompt = planPrompt("trail");
  for (const rule of [
    "terrain similar to the race",
    "power hiking",
    "controlled downhill technique",
    "durability sessions",
    "40-50 km training runs",
    "fueling/hydration rehearsal",
    "eccentric quadriceps/ankle",
  ]) {
    assert.ok(prompt.includes(rule), `missing prompt rule: ${rule}`);
  }
});

test("bridge rejects a vague run that is structurally valid but not an executable prescription", () => {
  const session = {
    id: "w1-d6-run",
    weekday: 6,
    sport: "run",
    title: "Sortie longue",
    subtitle: "30 min",
    duration_min: 30,
    intensity: "Z2",
    details: ["Courir facilement"],
    optional: false,
  };
  const plan = {
    version: 1,
    generated_by: "ai",
    objective: {
      sport: "run",
      title: "10 km test",
      event_date: "2026-10-18",
      start_date: "2026-10-12",
      weeks_total: 1,
      days_per_week: 4,
    },
    phases: [
      { id: 1, name: "Base", description: "Base" },
      { id: 2, name: "Spécifique", description: "Spécifique" },
      { id: 3, name: "Affûtage", description: "Affûtage" },
    ],
    weeks: [{
      week: 1,
      phase: 3,
      dates: "12/10 - 18/10",
      c1: "",
      c2: "",
      c3: "",
      run_min_target: 30,
      dplus: 0,
      gate: null,
      sessions: [session],
    }],
  };
  assert.match(planShapeError(plan), /complete five-part prescription/);

  const complete = structuredClone(plan);
  complete.weeks[0].sessions[0].details = ["Warm-up", "Main block", "Recovery", "Cool-down", "Intent"];
  assert.equal(planShapeError(complete), "");
});

function validPlan() {
  return {
    version: 1,
    generated_by: "ai",
    objective: {
      sport: "run",
      title: "10 km test",
      event_date: "2026-10-18",
      start_date: "2026-10-05",
      weeks_total: 2,
      days_per_week: 3,
    },
    phases: [
      { id: 1, name: "Base", description: "Base aérobie" },
      { id: 2, name: "Spécifique", description: "Développement spécifique" },
      { id: 3, name: "Affûtage", description: "Allègement final" },
    ],
    weeks: [1, 2].map((week) => ({
      week,
      phase: week === 1 ? 1 : 3,
      dates: week === 1 ? "05/10 - 11/10" : "12/10 - 18/10",
      c1: "",
      c2: "",
      c3: "",
      run_min_target: 30,
      dplus: 0,
      gate: null,
      sessions: [{
        id: `w${week}-d6-run`,
        weekday: 6,
        sport: "run",
        title: week === 2 ? "Objectif · 10 km test" : "Sortie facile",
        subtitle: "30 min",
        duration_min: 30,
        intensity: "Z2",
        details: ["Warm-up", "Main block", "Recovery", "Cool-down", "Intent"],
        optional: false,
      }],
    })),
  };
}

test("bridge rejects invalid plan version, phases, availability and finite-number contracts", () => {
  assert.equal(planShapeError(validPlan(), 3), "");

  const wrongVersion = validPlan();
  wrongVersion.version = 2;
  assert.match(planShapeError(wrongVersion), /version/);

  const wrongPhase = validPlan();
  wrongPhase.weeks[0].phase = 9;
  assert.match(planShapeError(wrongPhase), /unknown phase/);

  const invalidNumber = validPlan();
  invalidNumber.weeks[0].dplus = 1.5;
  assert.match(planShapeError(invalidNumber), /dplus/);

  const unavailable = validPlan();
  unavailable.weeks[0].sessions.push(...[0, 1, 2].map((weekday) => ({
    id: `w1-d${weekday}-strength`, weekday, sport: "strength", title: "Force", subtitle: "20 min",
    duration_min: 20, intensity: "Technique", details: ["Bloc"], optional: false,
  })));
  assert.match(planShapeError(unavailable, 3), /availability/);
});

test("bridge rejects cross-week adjacent runs and hard work the day before the event", () => {
  const adjacent = validPlan();
  adjacent.weeks[1].sessions.push({
    id: "w2-d0-run", weekday: 0, sport: "run", title: "Facile", subtitle: "20 min",
    duration_min: 20, intensity: "Z1", details: ["Warm-up", "Main", "Recovery", "Cool-down", "Intent"], optional: false,
  });
  adjacent.weeks[1].run_min_target = 50;
  assert.match(planShapeError(adjacent), /rest day between runs/);

  const hardEve = validPlan();
  hardEve.weeks[1].sessions.push({
    id: "w2-d5-strength", weekday: 5, sport: "strength", title: "Force", subtitle: "20 min",
    duration_min: 20, intensity: "Technique", details: ["Bloc"], optional: false,
  });
  assert.match(planShapeError(hardEve), /day before the event/);
});
