import type { ActiveModuleEvidence, VaultNote } from "@/lib/vault";
import type { TrailHealth, TrailStats } from "@/lib/trail";

export const CORE_DASHBOARD_WIDGET_IDS = [
  "activity",
  "today",
  "objectives",
  "brief",
  "projects",
  "knowledge",
  "areas",
] as const;

// One consolidated visual block per module: a chart-led card beats three
// text stat cards the user has to scroll past.
export const MODULE_DASHBOARD_WIDGET_IDS = {
  finance: ["module:finance"],
  budget: ["module:budget"],
  business: ["module:business"],
  trail: ["module:training"],
  revisions: ["module:revisions"],
  custom: ["module:custom:notes"],
} as const;

export const DASHBOARD_WIDGET_IDS = [
  ...CORE_DASHBOARD_WIDGET_IDS,
  ...Object.values(MODULE_DASHBOARD_WIDGET_IDS).flat(),
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];
export type DashboardModuleFlags = {
  finance: boolean;
  budget: boolean;
  business: boolean;
  trail: boolean;
  revisions: boolean;
  custom: readonly string[];
};

export function dashboardWidgetIdsForModules(modules: DashboardModuleFlags): DashboardWidgetId[] {
  return [
    ...CORE_DASHBOARD_WIDGET_IDS,
    ...(modules.finance ? MODULE_DASHBOARD_WIDGET_IDS.finance : []),
    ...(modules.budget ? MODULE_DASHBOARD_WIDGET_IDS.budget : []),
    ...(modules.business ? MODULE_DASHBOARD_WIDGET_IDS.business : []),
    ...(modules.trail ? MODULE_DASHBOARD_WIDGET_IDS.trail : []),
    ...(modules.revisions ? MODULE_DASHBOARD_WIDGET_IDS.revisions : []),
    ...(modules.custom.length ? MODULE_DASHBOARD_WIDGET_IDS.custom : []),
  ];
}

export type DashboardSegment = { label: string; value: number };

export type DashboardModuleSummary = {
  finance?: {
    total: number;
    positions: number;
    excluded: number;
    allocation: DashboardSegment[];
    unvalued: number;
  };
  budget?: {
    income: number;
    planned: number;
    available: number;
    breakdown: DashboardSegment[];
    // The four groups the /budget page charts, so the dashboard shows the same
    // split instead of a second, different reading of the same budget.
    fixed: number;
    variable: number;
    savings: number;
    subscriptions: number;
    subscriptionTotal: number;
    nextDue: string;
    commitmentRate: number | null;
    subscriptionsToReview: number;
    cuttableMonthly: number;
    nextSubscription: { service: string; dueDay: number; monthlyAmount: number } | null;
  };
  business?: {
    revenue: number;
    pipeline: number;
    dueNow: number;
    excluded: number;
    outstandingInvoices: number;
    overdueInvoices: number;
    overdueAmount: number;
    followUpsDue: number;
  };
  training?: {
    nextSession: string;
    readiness: number | null;
    done: number;
    planned: number;
    latestTitle: string;
    weekNumber: number | null;
    weeksTotal: number | null;
    phaseLabel: string;
    days: Array<{
      weekday: number;
      state: "done" | "partial" | "today" | "missed" | "upcoming" | "rest";
      title: string;
    }>;
    sessions: Array<{
      title: string;
      state: "done" | "today" | "missed" | "upcoming";
    }>;
    runKm: number | null;
    rideKm: number | null;
    elevationM: number | null;
    weekMovingMin: number | null;
    weekTargetMin: number | null;
    daysToObjective: number | null;
    missed: number | null;
    pendingFeedback: number | null;
  };
  revisions?: {
    todayTitle: string;
    cards: number;
    daysToExam: number | null;
    progress: number;
    modules: number;
    sourcesReady: number;
    sourcesTotal: number;
    emptySources: number;
  };
  custom?: {
    pages: Array<{
      title: string;
      slug: string;
      notes: number;
      latestNote: { title: string; path: string; updatedAt: string } | null;
    }>;
    notes: number;
  };
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function amount(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(String(value || "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalAmount(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function isLiving(note: VaultNote) {
  return !["archived", "abandoned", "cancelled", "canceled"].includes(note.status.toLowerCase());
}

function sortSegments(values: Map<string, number>): DashboardSegment[] {
  return [...values].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function percentage(part: number, whole: number) {
  return whole > 0 ? Math.round(part / whole * 1_000) / 10 : null;
}

function monthly(item: Record<string, unknown>) {
  return amount(item.price) / (item.frequency === "yearly" ? 12 : 1);
}

function financePositionValue(note: VaultNote) {
  const direct = optionalAmount(note.data.value_base);
  if (direct !== null) return { value: direct, valued: true };
  const quantity = optionalAmount(note.data.quantity);
  const unitPrice = optionalAmount(note.data.unit_price);
  return quantity !== null && unitPrice !== null
    ? { value: quantity * unitPrice, valued: true }
    : { value: 0, valued: false };
}

function revisionSourceFilenames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const [id, label, shortLabel, , suffix] = entry.split("|").map((part) => part.trim());
    if (!/^[a-z0-9-]+$/.test(id) || !label || !shortLabel || !/^[\p{L}\p{N}-]+$/u.test(suffix)) return [];
    return [
      `Fiche-Exhaustive-${suffix}.md`,
      `Fiche-${suffix}.md`,
      `Flashcards-${suffix}.md`,
      `QCM-${suffix}.md`,
      `Palais-Mental-${suffix}.md`,
      `Récitation-${suffix}.md`,
    ];
  });
}

function hasRevisionContent(note: VaultNote | undefined) {
  return Boolean(note?.content.replace(/^#{1,6}\s+.*$/gm, "").trim());
}

function parseBudget(note: VaultNote | undefined) {
  const match = note?.content.match(/```json\r?\n([\s\S]*?)```/);
  if (!match) return { fixedItems: [], variableItems: [], subscriptions: [] };
  try {
    const value = JSON.parse(match[1]) as Record<string, unknown>;
    const list = (key: string) => Array.isArray(value[key])
      ? (value[key] as unknown[]).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      : [];
    return { fixedItems: list("fixedItems"), variableItems: list("variableItems"), subscriptions: list("subscriptions") };
  } catch {
    return { fixedItems: [], variableItems: [], subscriptions: [] };
  }
}

function currentTrainingSection(content: string, today: string) {
  const headings = [...content.matchAll(/^### Semaine[^\n]*?(\d{2})\/(\d{2})\s*-\s*(\d{2})\/(\d{2})[^\n]*$/gm)];
  const todayTime = Date.parse(`${today}T12:00:00Z`);
  const year = Number(today.slice(0, 4));
  const current = headings.find((heading) => {
    const start = Date.UTC(year, Number(heading[2]) - 1, Number(heading[1]), 12);
    let end = Date.UTC(year, Number(heading[4]) - 1, Number(heading[3]), 12);
    if (end < start) end = Date.UTC(year + 1, Number(heading[4]) - 1, Number(heading[3]), 12);
    return todayTime >= start && todayTime <= end;
  });
  if (!current) return content;
  const next = headings.find((heading) => (heading.index || 0) > (current.index || 0));
  return content.slice(current.index, next?.index);
}

function cleanTask(line: string) {
  return line.replace(/^\s*[-*]\s+\[[ xX]\]\s*/, "").replace(/\s+/g, " ").trim();
}

export function summarizeDashboardModules(
  allNotes: VaultNote[],
  evidence: ActiveModuleEvidence,
  currency: string,
  today: string,
  // Optional: the real weekly trail data (activities, plan, objective date).
  // Callers that don't need the training block (e.g. the daily-snapshot
  // writer, which only reads .readiness) can omit it; the training block
  // then falls back to the note-text heuristic it always used.
  trailStats?: TrailStats,
  trailHealth?: TrailHealth,
): DashboardModuleSummary {
  const notes = allNotes.filter(isLiving);
  const normalizedCurrency = currency.trim().toUpperCase() || "EUR";
  const result: DashboardModuleSummary = {};

  if (evidence.finance) {
    const positions = notes.filter((note) => note.data.type === "finance-position");
    const included = positions.filter((note) => (text(note.data.currency).toUpperCase() || normalizedCurrency) === normalizedCurrency);
    const allocation = new Map<string, number>();
    let total = 0;
    let unvalued = 0;
    for (const note of included) {
      const position = financePositionValue(note);
      const value = position.value;
      if (!position.valued) unvalued += 1;
      total += value;
      const type = text(note.data.asset_type) || "other";
      allocation.set(type, (allocation.get(type) || 0) + value);
    }
    const sortedAllocation = sortSegments(allocation);
    result.finance = {
      total,
      positions: included.length,
      excluded: positions.length - included.length,
      allocation: sortedAllocation,
      unvalued,
    };
  }

  if (evidence.budget) {
    const note = notes.find((item) => item.relativePath === "00-System/Budget.md" || item.data.role === "budget");
    const parsed = parseBudget(note);
    const fixed = parsed.fixedItems.reduce((sum, item) => sum + monthly(item), 0);
    const variable = parsed.variableItems.reduce((sum, item) => sum + monthly(item), 0);
    const subscriptionTotal = parsed.subscriptions.reduce((sum, item) => sum + monthly(item), 0);
    const savings = amount(note?.data.savings_target);
    const income = amount(note?.data.income);
    const categories = new Map<string, number>();
    for (const item of [...parsed.fixedItems, ...parsed.variableItems, ...parsed.subscriptions]) {
      const category = text(item.category) || "other";
      categories.set(category, (categories.get(category) || 0) + monthly(item));
    }
    if (savings) categories.set("savings", savings);
    const currentDay = Number(today.slice(8, 10));
    const upcomingSubscriptions = parsed.subscriptions
      .map((item, index) => ({ item, index, dueDay: Number(text(item.nextDate)) }))
      .filter((entry) => Number.isInteger(entry.dueDay) && entry.dueDay >= 1 && entry.dueDay <= 31)
      .sort((a, b) => ((a.dueDay - currentDay + 31) % 31) - ((b.dueDay - currentDay + 31) % 31) || a.index - b.index);
    const nextSubscription = upcomingSubscriptions[0];
    const planned = fixed + variable + subscriptionTotal + savings;
    const subscriptionsToReview = parsed.subscriptions.filter((item) => item.decision === "reduce" || item.decision === "cut").length;
    const cuttableMonthly = parsed.subscriptions
      .filter((item) => item.decision === "cut")
      .reduce((sum, item) => sum + monthly(item), 0);
    result.budget = {
      income,
      planned,
      available: income - planned,
      breakdown: sortSegments(categories),
      fixed,
      variable,
      savings,
      subscriptions: parsed.subscriptions.length,
      subscriptionTotal,
      nextDue: nextSubscription ? String(nextSubscription.dueDay) : "",
      commitmentRate: percentage(planned, income),
      subscriptionsToReview,
      cuttableMonthly,
      nextSubscription: nextSubscription ? {
        service: text(nextSubscription.item.service),
        dueDay: nextSubscription.dueDay,
        monthlyAmount: monthly(nextSubscription.item),
      } : null,
    };
  }

  if (evidence.business) {
    const records = notes.filter((note) => note.relativePath.startsWith("12-Business/") && ["prospect", "invoice"].includes(text(note.data.record_type)));
    const included = records.filter((note) => (text(note.data.currency).toUpperCase() || normalizedCurrency) === normalizedCurrency);
    const revenue = included.filter((note) => note.data.record_type === "invoice" && note.status === "paid" && text(note.data.paid_at || note.data.issue_date).slice(0, 7) === today.slice(0, 7)).reduce((sum, note) => sum + amount(note.data.amount), 0);
    const pipeline = included.filter((note) => note.data.record_type === "prospect" && !["won", "lost"].includes(text(note.data.stage))).reduce((sum, note) => sum + amount(note.data.value) * amount(note.data.probability) / 100, 0);
    const sentInvoices = included.filter((note) => note.data.record_type === "invoice" && note.status === "sent");
    const overdue = sentInvoices.filter((note) => Boolean(text(note.data.due_date) && text(note.data.due_date) < today));
    const followUpsDue = included.filter((note) => note.data.record_type === "prospect"
      && Boolean(text(note.data.next_action_date) && text(note.data.next_action_date) <= today)
      && !["won", "lost"].includes(text(note.data.stage))).length;
    const invoicesDue = sentInvoices.filter((note) => Boolean(text(note.data.due_date) && text(note.data.due_date) <= today)).length;
    result.business = {
      revenue,
      pipeline,
      dueNow: followUpsDue + invoicesDue,
      excluded: records.length - included.length,
      outstandingInvoices: sentInvoices.reduce((sum, note) => sum + amount(note.data.amount), 0),
      overdueInvoices: overdue.length,
      overdueAmount: overdue.reduce((sum, note) => sum + amount(note.data.amount), 0),
      followUpsDue,
    };
  }

  if (evidence.training) {
    const training = notes.filter((note) => /^08-Projects\/(?:Training|Trail(?:[-/]|$))/i.test(note.relativePath) || /^(?:training|trail)_/.test(text(note.data.type)));
    const latest = [...training].sort((a, b) => b.mtime.localeCompare(a.mtime))[0];
    const readinessNote = [...training].sort((a, b) => b.mtime.localeCompare(a.mtime)).find((note) => Number.isFinite(Number(note.data.readiness ?? note.data.training_readiness)));
    const readinessValue = Number(readinessNote?.data.readiness ?? readinessNote?.data.training_readiness);

    // computeTrailStats() (trail.ts) already matches this week's recorded
    // activities against the plan session by session (done/today/upcoming/
    // missed), so reuse that instead of re-deriving completion from raw
    // checkbox text. Fall back to the old markdown-checkbox heuristic only
    // when no trail stats were supplied (module on, no plan yet).
    const currentWeek = trailStats?.weeks[trailStats.currentWeek - 1];
    let done: number;
    let planned: number;
    let nextSession: string;
    let sessions: NonNullable<DashboardModuleSummary["training"]>["sessions"] = [];
    if (currentWeek) {
      done = currentWeek.match.doneCount;
      planned = currentWeek.match.plannedCount;
      const upcoming = currentWeek.match.sessions.find((session) => session.outcome === "today")
        ?? currentWeek.match.sessions.find((session) => session.outcome === "upcoming");
      nextSession = upcoming ? `${upcoming.session.title} — ${upcoming.session.subtitle}` : "";
      sessions = currentWeek.match.sessions
        .filter((session) => session.outcome !== "cancelled")
        .map((session) => ({
          title: session.session.title,
          state: ["done", "moved"].includes(session.outcome)
            ? "done" as const
            : session.outcome === "today"
              ? "today" as const
              : session.outcome === "missed"
                ? "missed" as const
                : "upcoming" as const,
        }));
    } else {
      const plan = [...training].sort((a, b) => b.mtime.localeCompare(a.mtime)).find((note) => /\[[ xX]\]/.test(note.content));
      const section = currentTrainingSection(plan?.content || "", today);
      const tasks = section.split(/\r?\n/).filter((line) => /^\s*[-*]\s+\[[ xX]\]/.test(line));
      done = tasks.filter((line) => /\[[xX]\]/.test(line)).length;
      planned = tasks.length;
      const next = tasks.find((line) => /\[ \]/.test(line));
      nextSession = next ? cleanTask(next) : "";
      sessions = tasks.map((line) => ({
        title: cleanTask(line),
        state: /\[[xX]\]/.test(line) ? "done" as const : "upcoming" as const,
      }));
    }

    const performanceReadiness = trailStats?.performance?.readiness?.score;
    const healthReadiness = [...(trailStats?.health?.days || trailHealth?.days || [])].reverse().find((day) => day.readiness !== null)?.readiness;
    const actualReadiness = Number.isFinite(Number(performanceReadiness))
      ? Number(performanceReadiness)
      : Number.isFinite(Number(healthReadiness))
        ? Number(healthReadiness)
        : Number.isFinite(readinessValue)
          ? readinessValue
          : null;
    const days = currentWeek ? Array.from({ length: 7 }, (_, weekday) => {
      const sessions = currentWeek.match.sessions.filter((session, index) => {
        const plannedWeekday = Number.isInteger(session.plannedWeekday)
          ? session.plannedWeekday
          : Number.isInteger((session.session as { weekday?: number }).weekday)
            ? Number((session.session as { weekday?: number }).weekday)
            : index;
        return plannedWeekday === weekday;
      });
      const active = sessions.filter((session) => session.outcome !== "cancelled");
      if (!active.length) return { weekday, state: "rest" as const, title: "" };
      const completed = active.filter((session) => ["done", "moved"].includes(session.outcome)).length;
      const state = completed === active.length
        ? "done" as const
        : completed > 0
          ? "partial" as const
          : active.some((session) => session.outcome === "today")
            ? "today" as const
            : active.some((session) => session.outcome === "missed")
              ? "missed" as const
              : "upcoming" as const;
      return { weekday, state, title: active.map((session) => session.session.title).join(" · ") };
    }) : [];
    const weekTargetMin = currentWeek
      ? currentWeek.match.sessions
          .filter((session) => session.outcome !== "cancelled")
          .reduce((sum, session) => sum + (session.session.durationMin || 0), 0)
      : null;

    result.training = {
      nextSession,
      readiness: actualReadiness,
      done,
      planned,
      latestTitle: latest?.title || "",
      weekNumber: trailStats?.currentWeek ?? null,
      weeksTotal: trailStats?.plan?.weeks?.length ?? null,
      phaseLabel: trailStats?.phaseLabel || "",
      days,
      sessions,
      runKm: currentWeek ? currentWeek.runKm : null,
      rideKm: currentWeek ? currentWeek.rideKm : null,
      elevationM: currentWeek ? currentWeek.runDplus + currentWeek.rideDplus : null,
      weekMovingMin: currentWeek ? currentWeek.totalMin : null,
      weekTargetMin,
      daysToObjective: trailStats?.daysToRace ?? null,
      missed: currentWeek ? currentWeek.match.sessions.filter((session) => session.outcome === "missed").length : null,
      pendingFeedback: trailStats ? trailStats.pendingFeedback.length : null,
    };
  }

  if (evidence.revisions) {
    const revisions = notes.filter((note) => note.relativePath.startsWith("08-Projects/Revisions/") || text(note.data.type).startsWith("revision_"));
    const program = revisions.find((note) => note.data.type === "revision_program");
    const examDate = text(program?.data.exam_date);
    const daysToExam = /^\d{4}-\d{2}-\d{2}$/.test(examDate)
      ? Math.max(0, Math.ceil((Date.parse(`${examDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000))
      : null;
    // ponytail: due/known state lives in browser localStorage; keep this server card honest as the
    // locally available review pool until revision progress has a vault-backed shared schema.
    const cards = revisions.reduce((sum, note) => sum + (note.content.match(/^\*\*\d+\.\s+/gm)?.length || 0), 0);
    const expectedSourceFilenames = revisionSourceFilenames(program?.data.revision_modules);
    const programDirectory = program?.relativePath.slice(0, program.relativePath.lastIndexOf("/") + 1) || "";
    const revisionByPath = new Map(revisions.map((note) => [note.relativePath, note]));
    const sourceNotes = revisions.filter((note) => note !== program);
    const sourcesTotal = expectedSourceFilenames.length || sourceNotes.length;
    const sourcesReady = expectedSourceFilenames.length
      ? expectedSourceFilenames.filter((filename) => hasRevisionContent(revisionByPath.get(`${programDirectory}${filename}`))).length
      : sourceNotes.filter(hasRevisionContent).length;
    result.revisions = {
      todayTitle: text(program?.data.revision_title) || program?.title || evidence.revisions.notes[0]?.title || "",
      cards,
      daysToExam,
      progress: sourcesTotal ? Math.round(sourcesReady / sourcesTotal * 100) : 0,
      modules: expectedSourceFilenames.length / 6,
      sourcesReady,
      sourcesTotal,
      emptySources: sourcesTotal - sourcesReady,
    };
  }

  if (evidence.custom) {
    const registries = notes.filter((note) => note.relativePath.startsWith("11-Custom/_registry/"));
    result.custom = {
      pages: (evidence.custom.pages || []).map((title) => {
        const registry = registries.find((note) => note.title.trim().toLowerCase() === title.trim().toLowerCase());
        const slug = text(registry?.data.slug) || registry?.relativePath.split("/").at(-1)?.replace(/\.md$/, "") || "";
        const pageNotes = notes
          .filter((note) => note.relativePath.startsWith(`11-Custom/${slug}/`))
          .sort((a, b) => b.mtime.localeCompare(a.mtime) || a.relativePath.localeCompare(b.relativePath));
        const latest = pageNotes[0];
        return {
          title,
          slug,
          notes: pageNotes.length,
          latestNote: latest ? {
            title: latest.title,
            path: latest.relativePath,
            updatedAt: text(latest.data.updated) || latest.mtime,
          } : null,
        };
      }).filter((page) => page.slug),
      notes: evidence.custom.total,
    };
  }

  return result;
}
