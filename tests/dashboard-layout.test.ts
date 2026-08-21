import assert from "node:assert/strict";
import test from "node:test";
import {
  closestDashboardDropTarget,
  compactDashboardOrder,
  compactDashboardStateOrder,
  dashboardAutoScrollDelta,
  dashboardWidgetSize,
  deletePersonalDashboardBlock,
  defaultDashboardWidgetSize,
  hideDashboardBlock,
  moveAndCompactDashboardBlock,
  moveDashboardBlock,
  normalizeDashboardState,
  reconcileAvailableModules,
  resizeDashboardBlock,
  restoreDashboardBlock,
} from "../src/components/DashboardLayout";
import {
  DASHBOARD_WIDGET_IDS,
  MODULE_DASHBOARD_WIDGET_IDS,
  dashboardWidgetIdsForModules,
} from "../src/lib/dashboard-modules";

test("dashboard blocks move in either direction without losing entries", () => {
  const state = normalizeDashboardState({ order: ["today", "brief", "objectives"], hidden: [] });
  const down = moveDashboardBlock(state, "today", "objectives");
  assert.deepEqual(down.order.slice(0, 3), ["brief", "objectives", "today"]);

  const up = moveDashboardBlock(down, "today", "brief");
  assert.deepEqual(up.order.slice(0, 3), ["today", "brief", "objectives"]);
  assert.equal(new Set(up.order).size, state.order.length);
  assert.equal(moveDashboardBlock(up, "today", "today"), up);
  assert.equal(moveDashboardBlock(up, "missing", "brief"), up);
});

test("dashboard drag targeting stays stable across gaps and excludes the dragged widget", () => {
  const rects = [
    { id: "activity", left: 0, right: 600, top: 0, bottom: 300 },
    { id: "today", left: 620, right: 900, top: 0, bottom: 300 },
    { id: "objectives", left: 0, right: 280, top: 320, bottom: 600 },
  ];

  assert.equal(closestDashboardDropTarget("activity", 700, 120, rects), "today");
  assert.equal(closestDashboardDropTarget("activity", 300, 420, rects), "objectives");
  assert.equal(closestDashboardDropTarget("today", 100, 100, rects), "activity");
  assert.equal(closestDashboardDropTarget("activity", 100, 100, [rects[0]]), "");
});

test("dashboard packing fills compatible gaps while keeping DOM and visual order aligned", () => {
  const order = ["hero", "finance", "focus", "training", "wide"];
  const spans = { hero: 8, finance: 6, focus: 4, training: 6, wide: 12 };

  assert.deepEqual(compactDashboardOrder(order, spans), ["hero", "focus", "finance", "training", "wide"]);
  assert.deepEqual(compactDashboardOrder(["finance", "training", "focus"], spans), ["finance", "training", "focus"]);

  const state = { order: ["activity", "module:finance", "today"], hidden: [], custom: [], sizes: {} };
  const widgets = [
    { id: "activity", visual: "hero" },
    { id: "module:finance", visual: "module" },
    { id: "today", visual: "focus" },
  ] as const;
  assert.deepEqual(compactDashboardStateOrder(state, widgets).order.slice(0, 3), ["activity", "module:finance", "today"]);

  const withUnavailable = {
    order: ["module:finance", "brief", "activity", "today"],
    hidden: [],
    custom: [],
    sizes: {},
  };
  assert.deepEqual(
    compactDashboardStateOrder(withUnavailable, widgets).order,
    ["module:finance", "brief", "today", "activity"],
  );
});

test("dashboard drops compact immediately after applying the requested move", () => {
  const state = { order: ["activity", "today", "module:finance", "module:budget"], hidden: [], custom: [], sizes: {} };
  const widgets = [
    { id: "activity", visual: "hero" },
    { id: "today", visual: "focus" },
    { id: "module:finance", visual: "module" },
    { id: "module:budget", visual: "module" },
  ] as const;

  assert.deepEqual(
    moveAndCompactDashboardBlock(state, "module:budget", "module:finance", widgets).order,
    ["activity", "today", "module:budget", "module:finance"],
  );
});

test("dashboard drag auto-scroll only activates near viewport edges", () => {
  assert.equal(dashboardAutoScrollDelta(300, 800), 0);
  assert.ok(dashboardAutoScrollDelta(10, 800) < 0);
  assert.ok(dashboardAutoScrollDelta(790, 800) > 0);
});

test("dashboard layout drops the retired metrics widget from v6 layouts", () => {
  const state = normalizeDashboardState({ order: ["today", "metrics"], hidden: ["brief"] });

  assert.equal(state.order[0], "today");
  assert.equal(state.order.includes("metrics"), false);
  assert.deepEqual(state.hidden, ["brief"]);
  assert.equal(new Set([...state.order, ...state.hidden]).size, DASHBOARD_WIDGET_IDS.length);
});

test("dashboard layout keeps valid custom blocks restorable", () => {
  const state = normalizeDashboardState({
    order: [],
    hidden: ["custom:one"],
    custom: [{ id: "custom:one", kind: "text", title: "Note", body: "Body", value: "" }],
  });

  assert.equal(state.custom.length, 1);
  assert.deepEqual(state.hidden, ["custom:one"]);
  assert.equal(state.order.includes("custom:one"), false);
});

test("dashboard widget sizes use a two-state contract compatible with legacy widgets", () => {
  const legacy = normalizeDashboardState({ order: ["activity", "today"], hidden: [], custom: [] });

  assert.deepEqual(legacy.sizes, {});
  assert.equal(defaultDashboardWidgetSize({ wide: true }), "wide");
  assert.equal(defaultDashboardWidgetSize({ wide: false }), "standard");
  assert.equal(defaultDashboardWidgetSize({ size: "standard", wide: true }), "standard");
  assert.equal(dashboardWidgetSize(legacy, "activity", { wide: true }), "wide");
  assert.equal(dashboardWidgetSize(legacy, "today", { wide: false }), "standard");
});

test("dashboard widget size overrides survive hide, restore, reorder, and reload", () => {
  const initial = normalizeDashboardState({ order: ["today", "brief"], hidden: [], custom: [] });
  const resized = resizeDashboardBlock(initial, "today", "wide");
  assert.equal(dashboardWidgetSize(resized, "today", { wide: false }), "wide");

  const hidden = hideDashboardBlock(resized, "today");
  const restored = restoreDashboardBlock(hidden, "today");
  const moved = moveDashboardBlock(restored, "today", "brief");
  const reloaded = normalizeDashboardState(JSON.parse(JSON.stringify(moved)));

  assert.equal(reloaded.sizes.today, "wide");
  assert.equal(reloaded.order[0], "today");
  assert.equal(resizeDashboardBlock(reloaded, "today", "wide"), reloaded);
  assert.equal(resizeDashboardBlock(reloaded, "missing", "wide"), reloaded);
});

test("dashboard layout rejects invalid or orphaned stored sizes", () => {
  const state = normalizeDashboardState({
    order: ["today"],
    hidden: ["brief"],
    custom: [],
    sizes: { today: "wide", brief: "standard", activity: "compact", missing: "wide" },
  });

  assert.deepEqual(state.sizes, { today: "wide", brief: "standard" });
});

test("dashboard blocks hide, restore, delete, and survive a stored-state reload", () => {
  const initial = normalizeDashboardState({
    order: ["today", "custom:one"],
    hidden: [],
    custom: [{ id: "custom:one", kind: "text", title: "Note", body: "Body", value: "" }],
    sizes: { "custom:one": "wide" },
  });

  const connectedHidden = hideDashboardBlock(initial, "today");
  assert.equal(connectedHidden.order.includes("today"), false);
  assert.equal(connectedHidden.hidden.includes("today"), true);
  assert.equal(deletePersonalDashboardBlock(connectedHidden, "today"), connectedHidden);

  const connectedRestored = restoreDashboardBlock(connectedHidden, "today");
  assert.equal(connectedRestored.order.includes("today"), true);
  assert.equal(connectedRestored.hidden.includes("today"), false);

  const personalHidden = hideDashboardBlock(connectedRestored, "custom:one");
  const reloaded = normalizeDashboardState(JSON.parse(JSON.stringify(personalHidden)));
  assert.equal(reloaded.order.includes("custom:one"), false);
  assert.equal(reloaded.hidden.includes("custom:one"), true);
  assert.equal(reloaded.custom.some((block) => block.id === "custom:one"), true);

  const deletedWhileHidden = deletePersonalDashboardBlock(reloaded, "custom:one");
  assert.equal(deletedWhileHidden.hidden.includes("custom:one"), false);
  assert.equal(deletedWhileHidden.custom.some((block) => block.id === "custom:one"), false);
  assert.equal("custom:one" in deletedWhileHidden.sizes, false);

  const personalRestored = restoreDashboardBlock(reloaded, "custom:one");
  const deleted = deletePersonalDashboardBlock(personalRestored, "custom:one");
  assert.equal(deleted.order.includes("custom:one"), false);
  assert.equal(deleted.hidden.includes("custom:one"), false);
  assert.equal(deleted.custom.some((block) => block.id === "custom:one"), false);
});

test("reconcile appends newly available module blocks but not hidden or existing ones", () => {
  const stored = normalizeDashboardState({ order: ["today", "module:finance"], hidden: ["module:budget"] });
  const next = reconcileAvailableModules(stored, ["today", "module:finance", "module:budget", "module:business"]);
  // New block appended.
  assert.equal(next.order.includes("module:business"), true);
  // Already-present block keeps its slot, not duplicated.
  assert.equal(next.order.filter((id) => id === "module:finance").length, 1);
  // Deliberately hidden block is not resurrected into the order.
  assert.equal(next.order.includes("module:budget"), false);
  assert.equal(next.hidden.includes("module:budget"), true);
  // A no-op reconcile returns the same reference.
  assert.equal(reconcileAvailableModules(next, ["today", "module:finance", "module:budget", "module:business"]), next);
});

test("module availability changes do not erase stored placement or hidden state", () => {
  const financeId = MODULE_DASHBOARD_WIDGET_IDS.finance[0];
  const budgetId = MODULE_DASHBOARD_WIDGET_IDS.budget[0];
  const stored = normalizeDashboardState({ order: ["today", financeId, "brief"], hidden: [budgetId] });
  const originalIndex = stored.order.indexOf(financeId);

  const disabled = dashboardWidgetIdsForModules({ finance: false, budget: false, business: false, trail: false, revisions: false, custom: [] });
  assert.equal(disabled.includes(financeId), false);
  assert.equal(stored.order.indexOf(financeId), originalIndex);
  assert.equal(stored.hidden.includes(budgetId), true);

  const enabledAgain = dashboardWidgetIdsForModules({ finance: true, budget: true, business: false, trail: false, revisions: false, custom: [] });
  assert.equal(enabledAgain.includes(financeId), true);
  assert.equal(enabledAgain.includes(budgetId), true);
  const reloaded = normalizeDashboardState(JSON.parse(JSON.stringify(stored)));
  assert.equal(reloaded.order.indexOf(financeId), originalIndex);
  assert.equal(reloaded.hidden.includes(budgetId), true);
});

test("retired RSS widgets are removed from module availability and stored layouts", () => {
  const base = { finance: false, budget: false, business: false, trail: false, revisions: false, custom: [] };
  const available = dashboardWidgetIdsForModules(base);
  const legacy = normalizeDashboardState({ order: ["today", "module:feeds"], hidden: ["module:feeds"] });

  assert.equal(available.includes("module:feeds" as never), false);
  assert.equal(legacy.order.includes("module:feeds"), false);
  assert.equal(legacy.hidden.includes("module:feeds"), false);
});
