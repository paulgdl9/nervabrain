import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// The watch reports distance and heart rate; pain, RPE and feeling only exist
// in feedback-data.json, written by the Journal multisport in the app. Until
// the sync joined them into Sync.md, every reader of the vault (including the
// daily brief) saw a training log with no pain data and concluded the sessions
// had never been rated.
async function scratchVault() {
  const root = await mkdtemp(path.join(tmpdir(), "garmin-sync-"));
  const project = path.join(root, "08-Projects/Trail-26K");
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, "feedback-data.json"), JSON.stringify({
    feedback: [
      { activityId: "111", rpe: 6, pain: 0, feeling: "good", note: "Aucune douleur\nau réveil", createdAt: "2026-08-02T16:18:51.274Z" },
      { activityId: "2026-08-01::trail_running::Sortie sans id", rpe: 4, pain: 2, feeling: "hard", note: "", createdAt: "2026-08-01T16:18:51.274Z" },
    ],
  }));
  return root;
}

async function writeActivityOverrides(vault: string) {
  await writeFile(path.join(vault, "08-Projects/Trail-26K/activity-overrides.json"), JSON.stringify({
    overrides: [
      {
        date: "2026-08-11",
        source_type: "trail_running",
        name: "Demo Trail",
        kind: "other",
        type: "hiking",
      },
    ],
  }));
}

function runPython(vault: string, source: string) {
  const probe = spawnSync("python3", ["-c", source], {
    env: { ...process.env, VAULT_PATH: vault },
    encoding: "utf8",
  });
  assert.equal(probe.status, 0, probe.stderr);
  return probe.stdout;
}

const activities = String.raw`
acts = [
    {"activityId": 111, "startTimeLocal": "2026-08-02 09:00:00", "activityName": "Sortie trail démo",
     "activityType": {"typeKey": "trail_running"}, "distance": 11010.0, "duration": 4680.0,
     "averageHR": 146, "elevationGain": 242.0},
    {"startTimeLocal": "2026-08-01 09:00:00", "activityName": "Sortie sans id",
     "activityType": {"typeKey": "trail_running"}, "distance": 5000.0, "duration": 1800.0,
     "averageHR": 140, "elevationGain": 50.0},
    {"activityId": 999, "startTimeLocal": "2026-07-30 09:00:00", "activityName": "Non notee",
     "activityType": {"typeKey": "trail_running"}, "distance": 6010.0, "duration": 2785.0,
     "averageHR": 161, "elevationGain": 254.0},
]
`;

test("generic profile sync writes pain and feeling columns", async () => {
  const vault = await scratchVault();
  const output = runPython(vault, String.raw`
import importlib.util
from datetime import date
spec = importlib.util.spec_from_file_location("sync", "scripts/garmin-sync-profile.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
goal = {"title": "", "race_day": None, "plan_start": None, "history_start": None, "distance": 10.0, "elevation": 0.0}
` + activities + String.raw`
print(module.build_sync_md(date(2026, 8, 3), acts, goal))
`);

  assert.match(output, /\| Douleur \| Ressenti \|/);
  assert.match(output, /Sortie trail démo .*\| 0\/10 \| Bien · RPE 6 · Aucune douleur au réveil \|/);
  assert.match(output, /Sortie sans id .*\| 2\/10 \| Difficile · RPE 4 \|/);
  assert.match(output, /Non notee .*\| \? \| \? \|/);
});

test("generic profile sync preserves Garmin activity ids", async () => {
  const vault = await scratchVault();
  const output = runPython(vault, String.raw`
import importlib.util
spec = importlib.util.spec_from_file_location("sync", "scripts/garmin-sync-profile.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
goal = {"title": "", "race_day": None, "plan_start": None, "history_start": None, "distance": 10.0, "elevation": 0.0}
` + activities + String.raw`
print(module.build_json(acts, goal))
`);

  assert.deepEqual(JSON.parse(output).activities.map((activity: { id: string | null }) => activity.id), ["999", null, "111"]);
});

test("generic profile sync stores detailed Garmin strength sets", async () => {
  const vault = await scratchVault();
  const output = runPython(vault, String.raw`
import importlib.util
spec = importlib.util.spec_from_file_location("sync", "scripts/garmin-sync-profile.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
activity = {"activityId": 24459229502, "activityName": "PULL masse", "activityType": {"typeKey": "strength_training"}}
payload = {"exerciseSets": [
  {"setType": "ACTIVE", "wktStepIndex": 1, "repetitionCount": 5, "weight": 0.0, "duration": 28.9},
  {"setType": "REST", "wktStepIndex": 2, "duration": 120.0},
  {"setType": "ACTIVE", "wktStepIndex": 4, "repetitionCount": 11, "weight": 4500.0, "duration": 43.3},
]}
import json
print(json.dumps(module.normalize_strength_sets(activity, payload), ensure_ascii=False))
`);
  const sets = JSON.parse(output);
  assert.deepEqual(sets, [
    { exercise: "Tractions", step_index: 1, reps: 5, weight_kg: 0, seconds: null },
    { exercise: "Oiseau assis, buste penché", step_index: 4, reps: 11, weight_kg: 4.5, seconds: null },
  ]);
});

test("generic profile sync applies activity overrides before classifying a run", async () => {
  const vault = await scratchVault();
  await writeActivityOverrides(vault);
  const output = runPython(vault, String.raw`
import importlib.util
spec = importlib.util.spec_from_file_location("sync", "scripts/garmin-sync-profile.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
goal = {"title": "", "race_day": None, "plan_start": None, "history_start": None, "distance": 10.0, "elevation": 0.0}
acts = [
    {"activityId": 811, "startTimeLocal": "2026-08-11 09:00:00", "activityName": "Demo Trail",
     "activityType": {"typeKey": "trail_running"}, "distance": 18000.0, "duration": 14400.0},
    {"activityId": 812, "startTimeLocal": "2026-08-12 09:00:00", "activityName": "Demo Trail",
     "activityType": {"typeKey": "trail_running"}, "distance": 5000.0, "duration": 1800.0},
]
print(module.build_json(acts, goal))
`);

  const rows = JSON.parse(output).activities as Array<{ id: string; kind: string; type: string }>;
  assert.deepEqual(rows.map(({ id, kind, type }) => ({ id, kind, type })), [
    { id: "811", kind: "other", type: "hiking" },
    { id: "812", kind: "run", type: "trail_running" },
  ]);
});

test("generic profile sync persists current stamina fields and legacy aliases", async () => {
  const vault = await scratchVault();
  const output = runPython(vault, String.raw`
import importlib.util
spec = importlib.util.spec_from_file_location("sync", "scripts/garmin-sync-profile.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
goal = {"title": "", "race_day": None, "plan_start": None, "history_start": None, "distance": 10.0, "elevation": 0.0}
acts = [
    {"activityId": 1, "startTimeLocal": "2026-08-01 09:00:00", "activityName": "Legacy",
     "activityType": {"typeKey": "trail_running"}, "staminaStart": 95, "staminaEnd": 40, "staminaMin": 35},
    {"activityId": 2, "startTimeLocal": "2026-08-02 09:00:00", "activityName": "Current",
     "activityType": {"typeKey": "trail_running"}, "beginPotentialStamina": 99,
     "endPotentialStamina": 16, "minAvailableStamina": 14},
]
print(module.build_json(acts, goal))
`);

  const rows = JSON.parse(output).activities as Array<{
    stamina_start: number;
    stamina_end: number;
    stamina_min: number;
  }>;
  assert.deepEqual(rows.map(({ stamina_start, stamina_end, stamina_min }) => ({
    stamina_start,
    stamina_end,
    stamina_min,
  })), [
    { stamina_start: 95, stamina_end: 40, stamina_min: 35 },
    { stamina_start: 99, stamina_end: 16, stamina_min: 14 },
  ]);
});

test("generic profile sync stores detailed stability sets", async () => {
  const vault = await scratchVault();
  const output = runPython(vault, String.raw`
import importlib.util
spec = importlib.util.spec_from_file_location("sync", "scripts/garmin-sync-profile.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
activity = {"activityId": 42, "activityName": "Stabilité trail", "activityType": {"typeKey": "strength_training"}}
payload = {"exerciseSets": [{"setType": "ACTIVE", "wktStepIndex": 1, "repetitionCount": 8, "weight": 0.0, "duration": 20.0}]}
import json
print(json.dumps(module.normalize_strength_sets(activity, payload), ensure_ascii=False))
`);
  assert.deepEqual(JSON.parse(output), [{ exercise: "Step-up", step_index: 1, reps: 8, weight_kg: 0, seconds: null }]);
});
