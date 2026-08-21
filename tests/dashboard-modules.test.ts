import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDashboardModules } from "../src/lib/dashboard-modules";
import type { ActiveModuleEvidence, VaultNote } from "../src/lib/vault";
import type { TrailHealth, TrailStats } from "../src/lib/trail";

function note(relativePath: string, data: Record<string, unknown>, content = "# Note\n") : VaultNote {
  return {
    id: relativePath,
    title: String(data.title || relativePath.split("/").at(-1)?.replace(/\.md$/, "") || "Note"),
    relativePath,
    folder: relativePath.split("/")[0],
    kind: "note",
    data,
    content,
    excerpt: content.slice(0, 120),
    tags: [],
    links: [],
    status: String(data.status || "active"),
    mtime: "2026-07-21T12:00:00.000Z",
  };
}

test("dashboard module summaries use only local Markdown and keep currencies honest", () => {
  const evidence: ActiveModuleEvidence = Object.fromEntries(["finance", "budget", "business", "training", "revisions", "custom"].map((key) => [key, {
    state: "ready", total: 1, notes: [], ...(key === "custom" ? { pages: ["Lab"] } : {}),
  }])) as ActiveModuleEvidence;
  const notes = [
    note("10-Finance/etf.md", { type: "finance-position", asset_type: "etf", quantity: 2, unit_price: 100, currency: "EUR", market_change_percent: 10 }),
    note("10-Finance/savings.md", { type: "finance-position", asset_type: "savings", quantity: 1, unit_price: 100, currency: "EUR" }),
    note("10-Finance/usd.md", { type: "finance-position", asset_type: "stock", quantity: 50, unit_price: 100, currency: "USD" }),
    note("00-System/Budget.md", { role: "budget", income: 1000, savings_target: 300 }, [
      "# Budget", "```json", JSON.stringify({
        fixedItems: [{ category: "housing", price: "100", frequency: "monthly" }],
        variableItems: [{ category: "food", price: "200", frequency: "monthly" }],
        subscriptions: [{ service: "Assistant IA", category: "ai", price: "144", frequency: "yearly", nextDate: "12", decision: "cut" }],
      }), "```",
    ].join("\n")),
    note("12-Business/paid.md", { record_type: "invoice", status: "paid", amount: 500, currency: "EUR", paid_at: "2026-07-05" }),
    note("12-Business/sent.md", { record_type: "invoice", status: "sent", amount: 200, currency: "EUR", due_date: "2026-07-20" }),
    note("12-Business/lead.md", { record_type: "prospect", status: "active", stage: "qualified", value: 1000, probability: 50, currency: "EUR", next_action_date: "2026-07-21" }),
    note("08-Projects/Trail-Test/Plan.md", { type: "plan", readiness: 72, title: "Plan trail" }, [
      "### Semaine 4 · 20/07 - 26/07", "- [x] Séance faite", "- [ ] Séance suivante",
    ].join("\n")),
    note("08-Projects/Revisions/Programme-Revisions.md", { type: "revision_program", revision_title: "Droit", exam_date: "2026-07-31", revision_modules: ["droit|Droit|Droit|violet|Droit"] }),
    note("08-Projects/Revisions/Flashcards-Droit.md", { type: "revision_flashcards" }, "# Cartes\n\n**1. Question une** R — Réponse assez longue pour être utile.\n\n**2. Question deux** R — Autre réponse complète."),
    note("11-Custom/_registry/lab.md", { title: "Lab", slug: "lab", daily: true }),
    note("11-Custom/lab/Note.md", { title: "Expérience" }),
  ];

  const summary = summarizeDashboardModules(notes, evidence, "EUR", "2026-07-21");

  assert.deepEqual(summary.finance, {
    total: 300,
    positions: 2,
    excluded: 1,
    allocation: [{ label: "etf", value: 200 }, { label: "savings", value: 100 }],
    unvalued: 0,
  });
  assert.equal(summary.budget?.planned, 612);
  assert.equal(summary.budget?.available, 388);
  assert.equal(summary.budget?.subscriptionTotal, 12);
  assert.equal(summary.budget?.commitmentRate, 61.2);
  assert.equal(summary.budget?.subscriptionsToReview, 1);
  assert.equal(summary.budget?.cuttableMonthly, 12);
  assert.deepEqual(summary.budget?.nextSubscription, { service: "Assistant IA", dueDay: 12, monthlyAmount: 12 });
  // The dashboard donut charts the same four groups as the /budget page.
  assert.equal(summary.budget!.fixed + summary.budget!.variable + summary.budget!.savings + summary.budget!.subscriptionTotal, summary.budget!.planned);
  assert.equal(summary.business?.revenue, 500);
  assert.equal(summary.business?.pipeline, 500);
  assert.equal(summary.business?.dueNow, 2);
  assert.equal(summary.business?.outstandingInvoices, 200);
  assert.equal(summary.business?.overdueInvoices, 1);
  assert.equal(summary.business?.overdueAmount, 200);
  assert.equal(summary.business?.followUpsDue, 1);
  assert.deepEqual(summary.training, {
    nextSession: "Séance suivante", readiness: 72, done: 1, planned: 2, latestTitle: "Plan trail",
    weekNumber: null, weeksTotal: null, phaseLabel: "", days: [],
    sessions: [
      { title: "Séance faite", state: "done" },
      { title: "Séance suivante", state: "upcoming" },
    ],
    runKm: null, rideKm: null, elevationM: null,
    weekMovingMin: null, weekTargetMin: null, daysToObjective: null,
    missed: null, pendingFeedback: null,
  });
  assert.equal(summary.revisions?.cards, 2);
  assert.equal(summary.revisions?.daysToExam, 10);
  assert.equal(summary.revisions?.modules, 1);
  assert.equal(summary.revisions?.sourcesReady, 1);
  assert.equal(summary.revisions?.sourcesTotal, 6);
  assert.equal(summary.revisions?.emptySources, 5);
  assert.equal(summary.revisions?.progress, 17);
  assert.deepEqual(summary.custom, {
    pages: [{
      title: "Lab",
      slug: "lab",
      notes: 1,
      latestNote: {
        title: "Expérience",
        path: "11-Custom/lab/Note.md",
        updatedAt: "2026-07-21T12:00:00.000Z",
      },
    }],
    notes: 1,
  });
});

test("dashboard training summary prefers real trail stats over the checkbox heuristic when supplied", () => {
  const evidence: ActiveModuleEvidence = { training: { state: "ready", total: 1, notes: [] } } as ActiveModuleEvidence;
  const notes = [
    note("08-Projects/Trail-Test/Plan.md", { type: "plan", readiness: 72, title: "Plan trail" }, [
      "### Semaine 4 · 20/07 - 26/07", "- [x] Séance faite", "- [ ] Séance suivante",
    ].join("\n")),
  ];
  const trailStats = {
    currentWeek: 2,
    daysToRace: 12,
    phaseLabel: "Construction",
    plan: { weeks: [{}, {}, {}, {}] },
    health: { days: [{ date: "2026-07-21", readiness: 79 }] },
    weeks: [
      {},
      {
        runKm: 15.2,
        rideKm: 4.8,
        runDplus: 320,
        rideDplus: 40,
        totalMin: 132,
        runMin: 96,
        rideMin: 18,
        strengthMin: 18,
        match: {
          doneCount: 2,
          plannedCount: 4,
          sessions: [
            { outcome: "done", plannedWeekday: 0, session: { title: "Sortie facile", subtitle: "Z2", durationMin: 40 } },
            { outcome: "today", plannedWeekday: 1, session: { title: "Fractionné", subtitle: "6 x 800m", durationMin: 50 } },
            { outcome: "upcoming", plannedWeekday: 3, session: { title: "Sortie longue", subtitle: "90 min", durationMin: 90 } },
            { outcome: "missed", plannedWeekday: 4, session: { title: "Renforcement", subtitle: "20 min", durationMin: 20 } },
          ],
        },
      },
    ],
    pendingFeedback: [{ id: "activity-1" }],
  } as unknown as TrailStats;

  const summary = summarizeDashboardModules(notes, evidence, "EUR", "2026-07-21", trailStats);

  assert.deepEqual(summary.training, {
    nextSession: "Fractionné — 6 x 800m", readiness: 79, done: 2, planned: 4, latestTitle: "Plan trail",
    weekNumber: 2, weeksTotal: 4, phaseLabel: "Construction",
    days: [
      { weekday: 0, state: "done", title: "Sortie facile" },
      { weekday: 1, state: "today", title: "Fractionné" },
      { weekday: 2, state: "rest", title: "" },
      { weekday: 3, state: "upcoming", title: "Sortie longue" },
      { weekday: 4, state: "missed", title: "Renforcement" },
      { weekday: 5, state: "rest", title: "" },
      { weekday: 6, state: "rest", title: "" },
    ],
    sessions: [
      { title: "Sortie facile", state: "done" },
      { title: "Fractionné", state: "today" },
      { title: "Sortie longue", state: "upcoming" },
      { title: "Renforcement", state: "missed" },
    ],
    runKm: 15.2, rideKm: 4.8, elevationM: 360,
    weekMovingMin: 132, weekTargetMin: 200, daysToObjective: 12,
    missed: 1, pendingFeedback: 1,
  });
});

test("dashboard training summary reads health readiness without requiring a structured plan", () => {
  const evidence: ActiveModuleEvidence = { training: { state: "ready", total: 1, notes: [] } } as ActiveModuleEvidence;
  const notes = [
    note("08-Projects/Trail-Test/Plan.md", { type: "plan", readiness: 42, title: "Plan trail" }, [
      "### Semaine 4 · 20/07 - 26/07", "- [x] Séance faite", "- [ ] Séance suivante",
    ].join("\n")),
  ];
  const trailHealth: TrailHealth = {
    generatedAt: "2026-07-21T06:00:00.000Z",
    user: { maxHr: null, maxHrSource: null, lactateThresholdHr: null },
    days: [
      { date: "2026-07-20", sleepScore: null, sleepH: null, rhr: null, hrvAvg: null, bbMin: null, bbMax: null, readiness: 71 },
      { date: "2026-07-21", sleepScore: null, sleepH: null, rhr: null, hrvAvg: null, bbMin: null, bbMax: null, readiness: 79 },
    ],
  };

  const summary = summarizeDashboardModules(notes, evidence, "EUR", "2026-07-21", undefined, trailHealth);

  assert.equal(summary.training?.readiness, 79);
  assert.equal(summary.training?.nextSession, "Séance suivante");
  assert.deepEqual(summary.training?.sessions, [
    { title: "Séance faite", state: "done" },
    { title: "Séance suivante", state: "upcoming" },
  ]);
});

test("dashboard module action signals stay empty instead of inventing missing data", () => {
  const evidence: ActiveModuleEvidence = {
    finance: { state: "ready", total: 1, notes: [] },
    budget: { state: "ready", total: 1, notes: [] },
    business: { state: "ready", total: 1, notes: [] },
    revisions: { state: "ready", total: 1, notes: [] },
    custom: { state: "ready", total: 0, notes: [], pages: ["Journal"] },
  };
  const notes = [
    note("10-Finance/incomplete.md", { type: "finance-position", asset_type: "stock", currency: "EUR" }),
    note("00-System/Budget.md", { role: "budget" }),
    note("08-Projects/Revisions/Programme-Revisions.md", { type: "revision_program", revision_title: "Programme" }),
    note("11-Custom/_registry/journal.md", { title: "Journal", slug: "journal" }),
  ];

  const summary = summarizeDashboardModules(notes, evidence, "EUR", "2026-07-21");

  assert.equal(summary.finance?.total, 0);
  assert.equal(summary.finance?.unvalued, 1);
  assert.equal(summary.budget?.commitmentRate, null);
  assert.equal(summary.budget?.nextSubscription, null);
  assert.equal(summary.business?.overdueAmount, 0);
  assert.equal(summary.business?.followUpsDue, 0);
  assert.equal(summary.revisions?.sourcesTotal, 0);
  assert.equal(summary.revisions?.progress, 0);
  assert.deepEqual(summary.custom?.pages, [{ title: "Journal", slug: "journal", notes: 0, latestNote: null }]);
});
