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
