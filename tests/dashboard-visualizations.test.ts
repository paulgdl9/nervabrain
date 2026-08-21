import assert from "node:assert/strict";
import test from "node:test";
import { dashboardBudgetArcs, dashboardChartIndex } from "../src/components/DashboardVisualizations";

test("trading chart pointer selection clamps at both edges and supports one value", () => {
  assert.equal(dashboardChartIndex(-50, 100, 400, 5), 0);
  assert.equal(dashboardChartIndex(300, 100, 400, 5), 2);
  assert.equal(dashboardChartIndex(900, 100, 400, 5), 4);
  assert.equal(dashboardChartIndex(300, 100, 0, 1), 0);
  assert.equal(dashboardChartIndex(300, 100, 400, 0), 0);
});

test("budget arcs expose stable offsets and percentages", () => {
  const arcs = dashboardBudgetArcs([{ value: 50 }, { value: 30 }, { value: 20 }], 100, 100, 4);

  assert.deepEqual(arcs.map((arc) => arc.percent), [50, 30, 20]);
  assert.deepEqual(arcs.map((arc) => arc.visibleLength), [46, 26, 16]);
  assert.deepEqual(arcs.map((arc) => arc.dashOffset), [0, -50, -80]);
});

test("a zero budget never produces NaN or negative SVG arcs", () => {
  const arcs = dashboardBudgetArcs([{ value: 0 }, { value: 0 }], 0, 100);

  assert.deepEqual(arcs, [
    { length: 0, visibleLength: 0, dashOffset: 0, percent: 0 },
    { length: 0, visibleLength: 0, dashOffset: 0, percent: 0 },
  ]);
});
