import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { weeklyViewMetrics } from "../src/components/TrainingCharts";
import type { WeekStats } from "../src/lib/trail";

const weeks = [
  { plan: { week: 1 }, totalMin: 999, activities: [{}], runKm: 99, runMin: 999, runDplus: 999, rideKm: 99, rideMin: 999, rideDplus: 999, rides: [], strength: [], strengthMin: 999 },
  { plan: { week: 2 }, totalMin: 120, activities: [{}, {}], runKm: 10, runMin: 60, runDplus: 200, rideKm: 30, rideMin: 60, rideDplus: 300, rides: [], strength: [{ hr: 120 }], strengthMin: 45 },
] as unknown as WeekStats[];

test("load metrics use only the week selected in the page navigation", () => {
  assert.deepEqual(weeklyViewMetrics(weeks, "all", 2).map((metric) => metric.value), ["2h00", "2", "10,0 km", "30,0 km"]);
  assert.deepEqual(weeklyViewMetrics(weeks, "run", 2).map((metric) => metric.value), ["1h00", "10,0 km", "200 m", "6:00/km"]);
  assert.deepEqual(weeklyViewMetrics(weeks, "ride", 2).map((metric) => metric.value), ["1h00", "30,0 km", "300 m", "30,0 km/h"]);
  assert.deepEqual(weeklyViewMetrics(weeks, "strength", 2).map((metric) => metric.value), ["45'00", "1", "45'00", "120 bpm"]);
});

test("training metrics expose English labels and locale-aware numbers", () => {
  assert.deepEqual(
    weeklyViewMetrics(weeks, "ride", 2, "en").map((metric) => [metric.label, metric.value]),
    [
      ["Time", "1h00"],
      ["Distance", "30.0 km"],
      ["Elevation", "300 m"],
      ["Average speed", "30.0 km/h"],
    ],
  );
});

test("the multisport journal selects an icon for each activity discipline", async () => {
  const source = await readFile(new URL("../src/components/MultisportJournal.tsx", import.meta.url), "utf8");
  assert.match(source, /discipline === "run"\) return <Footprints/);
  assert.match(source, /discipline === "ride"\) return <Bike/);
  assert.match(source, /discipline === "strength"\) return <Dumbbell/);
  assert.match(source, /return <Activity/);
});

test("the average-speed SVG path cannot close into a black filled shape", async () => {
  const css = await readFile(new URL("../src/app/(shell)/training/training.css", import.meta.url), "utf8");
  assert.match(css, /\.chart-ride-line\s*\{[^}]*fill:\s*none;/);
});

test("the session validation picker stays bounded and its radios cannot stretch", async () => {
  const css = await readFile(new URL("../src/app/(shell)/training/training.css", import.meta.url), "utf8");
  const component = await readFile(new URL("../src/components/TodayBoard.tsx", import.meta.url), "utf8");
  assert.match(css, /\.validate-session-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 32px\)/);
  assert.match(css, /\.validate-activity-list\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.validate-activity-option > input\[type="radio"\]\s*\{[^}]*width:\s*18px/);
  assert.match(component, /createPortal\(children, document\.body\)/);
});

test("training links use the canonical route and the legacy redirect preserves its selection", async () => {
  const workspace = await readFile(new URL("../src/components/TrailWorkspace.tsx", import.meta.url), "utf8");
  const legacyRoute = await readFile(new URL("../src/app/(shell)/trail/page.tsx", import.meta.url), "utf8");

  assert.match(workspace, /return `\/training\$\{qs/);
  assert.match(legacyRoute, /params\.set\("week", legacy\.week\)/);
  assert.match(legacyRoute, /params\.set\("tab", legacy\.tab\)/);
  assert.match(legacyRoute, /redirect\(`\/training\$\{query/);
});
