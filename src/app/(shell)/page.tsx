import "./dashboard.css";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  BookOpenCheck,
  BriefcaseBusiness,
  CheckCircle2,
  Dumbbell,
  Layers3,
  PiggyBank,
  Sparkles,
  Target,
  WalletCards,
} from "lucide-react";
import type { ReactNode } from "react";
import { ActionDialog } from "@/components/ActionDialog";
import {
  DashboardLayout,
  type DashboardWidget,
} from "@/components/DashboardLayout";
import { DashboardAreaChart } from "@/components/DashboardVisualizations";
import { DonutChart } from "@/components/ui/DonutChart";
import { budgetCategoryColor } from "@/lib/budget-categories";
import { RawNoteForm, TaskForm } from "@/components/Forms";
import { todayISO } from "@/lib/dates";
import {
  dashboardObjectivePriority,
  isSelectableDashboardObjective,
  keepDashboardObjectiveProgress,
  objectiveStaleDays,
} from "@/lib/dashboard-objectives";
import {
  dashboardWidgetIdsForModules,
  summarizeDashboardModules,
  type DashboardWidgetId,
} from "@/lib/dashboard-modules";
import { activeModuleEvidence, getDashboard, noteHref, readFinanceHistory, readSetupState } from "@/lib/vault";
import { computeTrailStats, fmtKm, fmtMinutes, hasTrainingPlan, loadTrailHealth } from "@/lib/trail";
import { getLocale, getTranslations } from "@/lib/i18n-server";
import { readDashboardLayoutPreference } from "@/lib/ui-preferences";

export const dynamic = "force-dynamic";

function isoNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayISO(d);
}

function priorityKey(raw: string): "high" | "medium" | "low" | "none" {
  return dashboardObjectivePriority(raw);
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };

function DashboardCardHead({
  icon,
  eyebrow,
  title,
  href,
  action,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  href: string;
  action: string;
}) {
  return (
    <div className="cockpit-card-head">
      <div className="cockpit-card-heading">
        <span className="cockpit-card-icon">{icon}</span>
        <div><span>{eyebrow}</span><h2>{title}</h2></div>
      </div>
      <Link className="cockpit-card-link" href={href}>{action}<ArrowUpRight size={14} aria-hidden /></Link>
    </div>
  );
}

function StatRail({ items }: { items: Array<{ label: string; value: string; alert?: boolean }> }) {
  return (
    <div className="cockpit-stat-rail">
      {items.map((item) => (
        <div className={item.alert ? "is-alert" : undefined} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}
function normKey(value: unknown): string {
  // Tasks reference an objective in whatever form Obsidian wrote it: a bare
  // title, a `[[wikilink]]`, a `Title.md` path, and with or without accents.
  // Fold all of those to one key so area/objective linking survives real data.
  return String(value ?? "")
    .replace(/\[\[|\]\]/g, "")
    .replace(/\.md$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

export default async function DashboardPage() {
  const [setup, t, locale, dashboardLayout] = await Promise.all([
    readSetupState(),
    getTranslations(),
    getLocale(),
    readDashboardLayoutPreference(),
  ]);
  const data = await getDashboard();
  const today = todayISO();
  const moduleEvidence = activeModuleEvidence(data.allNotes, setup.modules);
  // hasTrainingPlan() gates computeTrailStats() here for the same reason it
  // gates it on /trail: computeTrailStats() auto-migrates a legacy plan into
  // existence on first read, which the dashboard must not trigger for a
  // profile that never set up training.
  const trainingPlanReady = moduleEvidence.training ? await hasTrainingPlan() : false;
  const [trailStats, trailHealth] = await Promise.all([
    trainingPlanReady ? computeTrailStats() : Promise.resolve(undefined),
    moduleEvidence.training ? loadTrailHealth() : Promise.resolve(undefined),
  ]);
  const moduleSummary = summarizeDashboardModules(data.allNotes, moduleEvidence, setup.currency, today, trailStats, trailHealth);
  const financeHistory = moduleEvidence.finance ? await readFinanceHistory(setup.currency) : [];
  const openTasks = data.tasks.filter((note) => ["todo", "doing", "active"].includes(note.status));
  const activeObjectives = data.objectives.filter((note) =>
    isSelectableDashboardObjective(note.status, note.data.priority),
  );

  // --- Completed-task activity: bucket done tasks by their done_on date ---
  const doneByDay = new Map<string, number>();
  for (const task of data.tasks) {
    if (task.status !== "done") continue;
    const iso = String(task.data.done_on || "").slice(0, 10);
    if (iso) doneByDay.set(iso, (doneByDay.get(iso) || 0) + 1);
  }
  const week = Array.from({ length: 7 }, (_, i) => {
    const iso = isoNDaysAgo(6 - i);
    const label = new Date(iso).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { weekday: "narrow" }).toUpperCase();
    return { iso, label, count: doneByDay.get(iso) || 0, isToday: iso === today };
  });
  const weekMax = Math.max(1, ...week.map((d) => d.count));
  const weekTotal = week.reduce((sum, d) => sum + d.count, 0);
  let prevWeekTotal = 0;
  for (let i = 7; i < 14; i += 1) prevWeekTotal += doneByDay.get(isoNDaysAgo(i)) || 0;
  const weekDelta = weekTotal - prevWeekTotal;


  // --- Objective progression: linked by area (tasks carry `area`, not an
  // `objective` field), high priority first ---
  const objectiveProgress = activeObjectives
    .map((objective) => {
      const objArea = normKey(objective.data.area);
      const objTitle = normKey(objective.title);
      const linked = data.tasks.filter((task) => {
        if (["archived", "abandoned", "cancelled", "canceled"].includes(task.status)) return false;
        const taskArea = normKey(task.data.area);
        const taskObjective = normKey(task.data.objective);
        return (
          (objArea && taskArea === objArea) ||
          (taskObjective && (taskObjective === objTitle || taskObjective === objArea))
        );
      });
      const done = linked.filter((task) => ["done", "completed"].includes(task.status)).length;
      const tasks = linked
        .filter((task) => ["todo", "doing", "active"].includes(task.status))
        .sort((a, b) => PRIORITY_RANK[priorityKey(String(a.data.priority || ""))] - PRIORITY_RANK[priorityKey(String(b.data.priority || ""))])
        .map((task) => ({ id: task.relativePath, title: task.title, status: task.status, priority: priorityKey(String(task.data.priority || "")) }));
      const prio = priorityKey(String(objective.data.priority || ""));
      const total = linked.length;
      const progress = total ? Math.round(done / total * 100) : 0;
      // Dernier signe de vie : la note de l'objectif ou n'importe quelle tâche
      // qui lui est reliée. Les mtime sont ISO, donc comparables tels quels.
      const lastTouch = [objective.mtime, ...linked.map((task) => task.mtime)].filter(Boolean).sort().at(-1);
      const staleDays = objectiveStaleDays(today, lastTouch);
      return { id: objective.relativePath, title: objective.title, done, total, progress, prio, tasks, staleDays, nextAction: tasks[0]?.title || "" };
    })
    // A finished goal is history, not a dashboard priority. Status alone is
    // insufficient because older vaults can still contain an `active` goal
    // whose linked tasks are all done.
    .filter((objective) => keepDashboardObjectiveProgress(objective.prio, objective.progress))
    .sort((a, b) => PRIORITY_RANK[a.prio] - PRIORITY_RANK[b.prio] || b.total - a.total);

  // --- Focus du jour: open tasks ordered by priority (high first) ---
  const sortedOpenTasks = [...openTasks]
    .sort(
      (a, b) =>
        Number(b.status === "doing") - Number(a.status === "doing") ||
        PRIORITY_RANK[priorityKey(String(a.data.priority || ""))] -
        PRIORITY_RANK[priorityKey(String(b.data.priority || ""))],
    );
  const focusTasks = sortedOpenTasks.slice(0, 6).map((task) => ({ ...task, data: { ...task.data } }));

  const priorityTasks = sortedOpenTasks.filter((task) => priorityKey(String(task.data.priority || "")) === "high");
  const doingTasks = openTasks.filter((task) => task.status === "doing");
  const pendingInbox = data.inbox.filter((note) => note.status === "inbox");
  const recentKnowledge = data.wiki.slice(0, 3);
  const latestDaily = data.daily[0];
  const latestWeekly = data.weekly[0];
  const connectedModuleCount = [
    setup.modules.finance,
    setup.modules.budget,
    setup.modules.business,
    setup.modules.trail,
    setup.modules.revisions,
  ].filter(Boolean).length + setup.modules.custom.length;

  // --- Extra hero signals, deduplicated: avg/day is derived from the total
  // beside it and the objective count heads its own section below. ---
  const totalDone = data.tasks.filter((task) => task.status === "done").length;
  const completionRate =
    totalDone + openTasks.length > 0
      ? Math.round((totalDone / (totalDone + openTasks.length)) * 100)
      : 0;
  const longDate = new Date().toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const heroDate = longDate.charAt(0).toUpperCase() + longDate.slice(1);


  const money = (value: number, compact = false) => new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    style: "currency",
    currency: setup.currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value);
  const prettyLabel = (label: string) => label.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
  const financeAssetLabels: Record<string, string> = {
    etf: "ETF", stock: t["finance.asset.stock"], savings: t["finance.asset.savings"], life_insurance: t["finance.asset.lifeInsurance"],
    real_estate: t["finance.asset.realEstate"], bonds: t["finance.asset.bonds"], other: t["finance.asset.other"],
  };
  const financeAssetLabel = (label: string) => financeAssetLabels[label.trim().toLowerCase()] || prettyLabel(label);
  const budgetCategoryLabels: Record<string, string> = {
    housing: t["budget.category.housing"], insurance: t["budget.category.insurance"], credit: t["budget.category.credit"],
    health: t["budget.category.health"], transport: t["budget.category.transport"], taxes: t["budget.category.taxes"],
    food: t["budget.category.food"], leisure: t["budget.category.leisure"], shopping: t["budget.category.shopping"],
    savings: t["budget.savings"], subscriptions: t["budget.subscriptions"], other: t["budget.category.other"], autres: t["budget.category.other"],
    ai: t["budget.subscriptionCategory.ai"], banking: t["budget.subscriptionCategory.banking"], cloud: t["budget.subscriptionCategory.cloud"],
    dating: t["budget.subscriptionCategory.dating"], energy: t["budget.subscriptionCategory.energy"], fitness: t["budget.subscriptionCategory.fitness"],
    gaming: t["budget.subscriptionCategory.gaming"], mobility: t["budget.subscriptionCategory.mobility"], news: t["budget.subscriptionCategory.news"],
    productivity: t["budget.subscriptionCategory.productivity"], security: t["budget.subscriptionCategory.security"], streaming: t["budget.subscriptionCategory.streaming"],
    telecom: t["budget.subscriptionCategory.telecom"],
  };
  const budgetCategoryLabel = (label: string) => budgetCategoryLabels[label.trim().toLowerCase()] || prettyLabel(label);
  const openLabel = locale === "fr" ? "Ouvrir" : "Open";
  const availableWidgetIds = new Set(dashboardWidgetIdsForModules(setup.modules));
  const widgets: DashboardWidget[] = [];
  const addModule = (id: DashboardWidgetId, widget: Omit<DashboardWidget, "id">) => {
    if (availableWidgetIds.has(id)) widgets.push({ id, ...widget });
  };


  const knowledgeDays = Array.from({ length: 28 }, (_, index) => {
    const iso = isoNDaysAgo(27 - index);
    const count = data.allNotes.filter((note) => String(note.mtime).slice(0, 10) === iso).length;
    return { iso, count };
  });
  const knowledgeMax = Math.max(1, ...knowledgeDays.map((day) => day.count));

  widgets.push({
    id: "activity",
    href: "/tasks",
    title: locale === "fr" ? "Momentum" : "Momentum",
    description: locale === "fr" ? "Activité réelle des sept derniers jours." : "Actual activity over the last seven days.",
    preview: <div className="dashboard-preview-bars">{week.map((day) => <i key={day.iso} style={{ height: `${Math.max(12, Math.round((day.count / weekMax) * 100))}%` }} />)}</div>,
    visual: "module",
    content: (
      <section className="cockpit-card cockpit-activity">
        <DashboardCardHead
          icon={<Activity size={18} aria-hidden />}
          eyebrow={locale === "fr" ? "7 derniers jours" : "Last 7 days"}
          title={locale === "fr" ? "Rythme d’exécution" : "Execution rhythm"}
          href="/tasks"
          action={locale === "fr" ? "Voir les tâches" : "View tasks"}
        />
        <div className="cockpit-activity-summary">
          <div>
            <strong>{weekTotal}</strong>
            <span>{locale === "fr" ? "tâches terminées" : "tasks completed"}</span>
          </div>
          <p className={weekDelta > 0 ? "is-positive" : weekDelta < 0 ? "is-negative" : "is-neutral"}>
            {weekDelta > 0 ? "+" : ""}{weekDelta} {locale === "fr" ? "vs semaine précédente" : "vs previous week"}
          </p>
        </div>
        <div className="cockpit-chart-shell">
          <div className="cockpit-chart-visual">
            <DashboardAreaChart
              values={week.map((day) => day.count)}
              label={locale === "fr" ? "Tâches terminées par jour" : "Completed tasks by day"}
              details={week.map((day) => {
                const date = new Date(`${day.iso}T12:00:00`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { weekday: "long", day: "numeric", month: "short" });
                const count = `${day.count} ${locale === "fr" ? `tâche${day.count === 1 ? "" : "s"}` : `task${day.count === 1 ? "" : "s"}`}`;
                return { primary: count, secondary: date, ariaLabel: `${date}: ${count}` };
              })}
            />
          </div>
          <div className="cockpit-chart-labels" aria-hidden>{week.map((day) => <span className={day.isToday ? "is-today" : undefined} key={day.iso}>{day.label}</span>)}</div>
        </div>
        <StatRail items={[
          { label: locale === "fr" ? "Ouvertes" : "Open", value: String(openTasks.length) },
          { label: locale === "fr" ? "En cours" : "In progress", value: String(doingTasks.length) },
          { label: locale === "fr" ? "Objectifs actifs" : "Active goals", value: String(objectiveProgress.length) },
          { label: locale === "fr" ? "Taux global" : "Overall rate", value: `${completionRate}%` },
        ]} />
      </section>
    ),
  });

  widgets.push({
    id: "today",
    href: "/tasks",
    title: locale === "fr" ? "Focus du jour" : "Today’s focus",
    description: locale === "fr" ? "Les actions à terminer maintenant." : "The actions to finish now.",
    preview: <div className="dashboard-preview-tasks">{focusTasks.slice(0, 3).map((task) => <span key={task.relativePath}><i />{task.title}</span>)}</div>,
    visual: "focus",
    content: (
      <section className="cockpit-card cockpit-focus-card">
        <div className="cockpit-focus-topline">
          <span><Sparkles size={15} aria-hidden />{locale === "fr" ? "Maintenant" : "Now"}</span>
          <strong>{priorityTasks.length} {locale === "fr" ? "prioritaires" : priorityTasks.length === 1 ? "priority" : "priorities"}</strong>
        </div>
        <div className="cockpit-focus-title">
          <div><strong>{doingTasks.length || Math.min(openTasks.length, 3)}</strong><span>{locale === "fr" ? "actions en focus" : "actions in focus"}</span></div>
          <Link href="/tasks" aria-label={locale === "fr" ? "Ouvrir toutes les tâches" : "Open all tasks"}><ArrowUpRight size={19} aria-hidden /></Link>
        </div>
        <div className="cockpit-focus-list">
          {focusTasks.length
            ? <div className="cockpit-focus-tasks">
                {focusTasks.slice(0, 4).map((task, index) => {
                  const priority = priorityKey(String(task.data.priority || ""));
                  const detail = String(task.data.area || task.data.objective || "").trim();
                  return (
                    <Link href={noteHref(task)} key={task.relativePath}>
                      <span className="cockpit-focus-order">{String(index + 1).padStart(2, "0")}</span>
                      <span className="cockpit-focus-copy">
                        <strong>{task.title}</strong>
                        <small>{detail || (locale === "fr" ? "Tâche ouverte" : "Open task")}</small>
                      </span>
                      {priority !== "none" ? <em className={`is-${priority}`}>{priority === "high" ? (locale === "fr" ? "Haute" : "High") : priority === "medium" ? (locale === "fr" ? "Moyenne" : "Medium") : (locale === "fr" ? "Basse" : "Low")}</em> : null}
                      <ArrowUpRight size={15} aria-hidden />
                    </Link>
                  );
                })}
              </div>
            : <div className="cockpit-empty is-inverted"><CheckCircle2 size={22} aria-hidden />{locale === "fr" ? "Rien d’ouvert. Le terrain est net." : "Nothing open. The field is clear."}</div>}
        </div>
      </section>
    ),
  });

  widgets.push({
    id: "objectives",
    href: "/objectives",
    title: locale === "fr" ? "Objectifs" : "Goals",
    description: locale === "fr" ? "Le cap, sa progression et la prochaine action." : "Direction, progress and next action.",
    preview: <div className="dashboard-preview-progress"><span><b>{objectiveProgress.length}</b><small>{locale === "fr" ? "objectifs" : "goals"}</small></span><i><em style={{ width: `${completionRate}%` }} /></i></div>,
    visual: "compact",
    content: (
      <section className="cockpit-card cockpit-objectives">
        <DashboardCardHead
          icon={<Target size={18} aria-hidden />}
          eyebrow={locale === "fr" ? "Cap actuel" : "Current direction"}
          title={locale === "fr" ? "Objectifs" : "Goals"}
          href="/objectives"
          action={openLabel}
        />
        <div className="cockpit-objective-list">
          {objectiveProgress.length
            ? objectiveProgress.slice(0, 3).map((objective, index) => (
                <Link className={index === 0 ? "is-primary" : undefined} href="/objectives" key={objective.id}>
                  <span className="cockpit-objective-index">0{index + 1}</span>
                  <span className="cockpit-objective-copy">
                    <strong>{objective.title}</strong>
                    <small>{objective.nextAction || (locale === "fr" ? "Définir la prochaine action" : "Define the next action")}</small>
                  </span>
                  <span className="cockpit-objective-meter">
                    <i><b style={{ width: `${objective.progress}%` }} /></i>
                    <em>{objective.progress}%</em>
                  </span>
                </Link>
              ))
            : <div className="cockpit-empty">{locale === "fr" ? "Aucun objectif actif." : "No active goal."}</div>}
        </div>
      </section>
    ),
  });

  widgets.push({
    id: "knowledge",
    href: "/notes",
    title: locale === "fr" ? "Flux de connaissances" : "Knowledge flow",
    description: locale === "fr" ? "Le rythme de création et les notes qui demandent de l’attention." : "Creation rhythm and notes that need attention.",
    preview: <div className="dashboard-preview-list">{recentKnowledge.map((note) => <span key={note.relativePath}><i /><b>{note.title}</b></span>)}</div>,
    visual: "hero",
    content: (
      <section className="cockpit-card cockpit-knowledge">
        <DashboardCardHead
          icon={<Layers3 size={18} aria-hidden />}
          eyebrow={locale === "fr" ? "28 derniers jours" : "Last 28 days"}
          title={locale === "fr" ? "Pulse du second cerveau" : "Second brain pulse"}
          href="/notes"
          action={openLabel}
        />
        <div className="cockpit-knowledge-body">
          <div>
            <div className="cockpit-heatmap" role="img" aria-label={locale === "fr" ? "Notes modifiées sur 28 jours" : "Notes updated over 28 days"}>
              {knowledgeDays.map((day) => {
                const level = day.count ? Math.max(1, Math.ceil(day.count / knowledgeMax * 4)) : 0;
                return <i className={`is-level-${level}`} key={day.iso} title={`${day.iso}: ${day.count}`} />;
              })}
            </div>
            <div className="cockpit-knowledge-metrics">
              <div><strong>{pendingInbox.length}</strong><span>{locale === "fr" ? "à traiter" : "to process"}</span></div>
              <div><strong>{data.wiki.length}</strong><span>{locale === "fr" ? "notes wiki" : "wiki notes"}</span></div>
              <div><strong>{Number(Boolean(latestDaily)) + Number(Boolean(latestWeekly))}/2</strong><span>{locale === "fr" ? "rituels à jour" : "rituals current"}</span></div>
            </div>
          </div>
          <div className="cockpit-note-list">
            <span>{locale === "fr" ? "Dernières connexions" : "Latest connections"}</span>
            {recentKnowledge.length
              ? recentKnowledge.map((note) => <Link href={noteHref(note)} key={note.relativePath}><strong>{note.title}</strong><ArrowUpRight size={13} aria-hidden /></Link>)
              : <div className="cockpit-empty">{locale === "fr" ? "Pas encore de note wiki." : "No wiki note yet."}</div>}
          </div>
        </div>
      </section>
    ),
  });

  if (moduleSummary.finance) {
    const finance = moduleSummary.finance;
    const financeCurrentPoint = {
      date: today,
      currency: setup.currency,
      total: finance.total,
      byType: Object.fromEntries(finance.allocation.map((segment) => [segment.label, segment.value])),
    };
    const financePoints = [
      ...financeHistory.filter((point) => point.date !== today),
      financeCurrentPoint,
    ].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
    const currentFinancePoint = financePoints.at(-1);
    const financeDelta = (days: number) => {
      if (!currentFinancePoint || financePoints.length < 2) return null;
      const cutoff = isoNDaysAgo(days);
      const baseline = [...financePoints].reverse().find((point) => point.date <= cutoff);
      if (!baseline || baseline.date === currentFinancePoint.date || baseline.total === 0) return null;
      const amount = currentFinancePoint.total - baseline.total;
      return { amount, percent: amount / baseline.total * 100, baseline: baseline.date };
    };
    const financePeriods = [
      { label: "24H", delta: financeDelta(1) },
      { label: locale === "fr" ? "7J" : "7D", delta: financeDelta(7) },
      { label: locale === "fr" ? "30J" : "30D", delta: financeDelta(30) },
    ];
    const primaryFinanceDelta = financePeriods[1].delta || financePeriods[0].delta || financePeriods[2].delta;
    const signedMoney = (value: number) => new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", {
      style: "currency",
      currency: setup.currency,
      signDisplay: "always",
      maximumFractionDigits: 0,
    }).format(value);
    const signedPercent = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
    addModule("module:finance", {
      href: "/finances",
      title: locale === "fr" ? "Patrimoine" : "Net worth",
      description: locale === "fr" ? "Valeur, variation réelle et allocation." : "Value, actual change and allocation.",
      preview: <div className="dashboard-preview-attention"><strong>{money(finance.total, true)}</strong><span>{locale === "fr" ? "patrimoine" : "net worth"}</span></div>,
      visual: "module",
      content: (
        <section className="cockpit-card cockpit-module cockpit-finance">
          <DashboardCardHead icon={<WalletCards size={18} aria-hidden />} eyebrow={locale === "fr" ? "Finance" : "Finance"} title={locale === "fr" ? "Portefeuille" : "Portfolio"} href="/finances" action={openLabel} />
          <div className="cockpit-finance-balance">
            <div><span>{locale === "fr" ? "Patrimoine total" : "Total net worth"}</span><strong>{money(finance.total, true)}</strong></div>
            <div className={primaryFinanceDelta && primaryFinanceDelta.amount < 0 ? "is-negative" : "is-positive"}>
              <strong>{primaryFinanceDelta ? signedMoney(primaryFinanceDelta.amount) : "—"}</strong>
              <span>{primaryFinanceDelta ? signedPercent(primaryFinanceDelta.percent) : (locale === "fr" ? "Historique insuffisant" : "Not enough history")}</span>
            </div>
          </div>
          <div className="cockpit-finance-body">
            <div className="cockpit-finance-trend">
              <div className="cockpit-finance-periods" aria-label={locale === "fr" ? "Variations du patrimoine" : "Net worth changes"}>
                {financePeriods.map((period) => (
                  <span className={period.delta && period.delta.amount < 0 ? "is-negative" : period.delta ? "is-positive" : undefined} key={period.label} title={period.delta ? `${locale === "fr" ? "Depuis" : "Since"} ${period.delta.baseline}` : (locale === "fr" ? "Pas assez d’historique" : "Not enough history")}>
                    <small>{period.label}</small><strong>{period.delta ? signedPercent(period.delta.percent) : "—"}</strong>
                  </span>
                ))}
              </div>
              {financePoints.length >= 2 ? (
                <div className="cockpit-chart-visual is-finance">
                  <DashboardAreaChart
                    label={locale === "fr" ? "Évolution du patrimoine sur les trente derniers points" : "Net worth over the latest thirty points"}
                    details={financePoints.map((point) => {
                      const date = new Date(`${point.date}T12:00:00`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
                      const value = money(point.total);
                      return { primary: value, secondary: date, ariaLabel: `${date}: ${value}` };
                    })}
                    values={financePoints.map((point) => point.total)}
                    zeroBased={false}
                  />
                </div>
              ) : <div className="cockpit-empty is-compact">{locale === "fr" ? "La courbe apparaîtra après deux relevés." : "The chart appears after two snapshots."}</div>}
            </div>
            <div className="cockpit-finance-allocation">
              <span>{locale === "fr" ? "Allocation" : "Allocation"}</span>
              {finance.allocation.length ? finance.allocation.slice(0, 4).map((segment, index) => {
                const percent = finance.total ? segment.value / finance.total * 100 : 0;
                return (
                  <div key={segment.label}>
                    <i className={`is-tone-${index + 1}`} />
                    <span><strong>{financeAssetLabel(segment.label)}</strong><small>{percent.toFixed(1)}%</small></span>
                    <em>{money(segment.value, true)}</em>
                  </div>
                );
              }) : <div className="cockpit-empty is-compact">{locale === "fr" ? "Aucune position valorisée." : "No valued position."}</div>}
            </div>
          </div>
          <StatRail items={[
            { label: locale === "fr" ? "Positions" : "Positions", value: String(finance.positions) },
            { label: locale === "fr" ? "Classes d’actifs" : "Asset classes", value: String(finance.allocation.length) },
            { label: locale === "fr" ? "Non valorisées" : "Unvalued", value: String(finance.unvalued), alert: finance.unvalued > 0 },
          ]} />
        </section>
      ),
    });
  }

  if (moduleSummary.budget) {
    const budget = moduleSummary.budget;
    const sortedBudgetCategories = budget.breakdown.filter((segment) => segment.value > 0);
    const budgetCategories = sortedBudgetCategories.slice(0, 4);
    const otherBudget = sortedBudgetCategories.slice(4).reduce((sum, segment) => sum + segment.value, 0);
    if (otherBudget > 0) budgetCategories.push({ label: locale === "fr" ? "autres" : "other", value: otherBudget });
    addModule("module:budget", {
      href: "/budget",
      title: locale === "fr" ? "Budget" : "Budget",
      description: locale === "fr" ? "Enveloppes planifiées, marge et échéances." : "Planned envelopes, margin and due dates.",
      preview: <div className="dashboard-preview-attention"><strong>{money(budget.available, true)}</strong><span>{locale === "fr" ? "disponible" : "available"}</span></div>,
      visual: "module",
      content: (
        <section className="cockpit-card cockpit-module cockpit-budget">
          <DashboardCardHead icon={<PiggyBank size={18} aria-hidden />} eyebrow={locale === "fr" ? "Plan mensuel" : "Monthly plan"} title={locale === "fr" ? "Répartition du budget" : "Budget allocation"} href="/budget" action={openLabel} />
          <div className="cockpit-budget-summary">
            <div><span>{locale === "fr" ? "Reste à allouer" : "Left to allocate"}</span><strong className={budget.available < 0 ? "is-negative" : undefined}>{money(budget.available, true)}</strong></div>
            <span className={budget.available < 0 ? "is-negative" : undefined}>{budget.commitmentRate === null ? "—" : `${budget.commitmentRate}% ${locale === "fr" ? "du revenu engagé" : "of income committed"}`}</span>
          </div>
          {budget.planned > 0 ? (
            <DonutChart
              ariaLabel={`${locale === "fr" ? "Budget planifié" : "Planned budget"}: ${money(budget.planned, true)}`}
              centerSub={locale === "fr" ? "planifié" : "planned"}
              centerValue={money(budget.planned, true)}
              segments={budgetCategories.map((segment) => ({ label: budgetCategoryLabel(segment.label), value: segment.value, color: budgetCategoryColor(segment.label), formattedValue: money(segment.value, true) }))}
            />
          ) : <div className="cockpit-empty">{locale === "fr" ? "Renseigne le budget pour activer la répartition." : "Fill the budget to activate the split."}</div>}
          <StatRail items={[
            { label: locale === "fr" ? "Revenu" : "Income", value: money(budget.income, true) },
            { label: locale === "fr" ? "À revoir" : "To review", value: budget.subscriptionsToReview ? `${budget.subscriptionsToReview} · ${money(budget.cuttableMonthly, true)}` : "0", alert: budget.subscriptionsToReview > 0 },
            { label: locale === "fr" ? "Prochaine échéance" : "Next due", value: budget.nextSubscription ? `${budget.nextSubscription.service || "—"} · ${budget.nextSubscription.dueDay}` : "—" },
          ]} />
        </section>
      ),
    });
  }

  if (moduleSummary.business) {
    const business = moduleSummary.business;
    const businessScale = Math.max(1, business.revenue, business.pipeline, business.outstandingInvoices);
    addModule("module:business", {
      href: "/business",
      title: locale === "fr" ? "Business" : "Business",
      description: locale === "fr" ? "Encaissement, pipeline et relances." : "Revenue, pipeline and follow-ups.",
      preview: <div className="dashboard-preview-attention"><strong>{money(business.revenue, true)}</strong><span>{locale === "fr" ? "encaissé" : "collected"}</span></div>,
      visual: "module",
      content: (
        <section className="cockpit-card cockpit-module cockpit-business">
          <DashboardCardHead icon={<BriefcaseBusiness size={18} aria-hidden />} eyebrow={locale === "fr" ? "Mois en cours" : "Current month"} title={locale === "fr" ? "Activité commerciale" : "Business activity"} href="/business" action={openLabel} />
          <div className="cockpit-module-value"><strong>{money(business.revenue, true)}</strong><span>{locale === "fr" ? "encaissé" : "collected"}</span></div>
          <div className="cockpit-bullet-list">
            {[
              { label: locale === "fr" ? "Encaissé" : "Collected", value: business.revenue, tone: "is-primary" },
              { label: "Pipeline", value: business.pipeline, tone: "" },
              { label: locale === "fr" ? "Factures ouvertes" : "Open invoices", value: business.outstandingInvoices, tone: business.overdueInvoices ? "is-alert" : "" },
            ].map((item) => (
              <div key={item.label}><span><strong>{item.label}</strong><em>{money(item.value, true)}</em></span><i><b className={item.tone} style={{ width: `${Math.max(item.value ? 3 : 0, item.value / businessScale * 100)}%` }} /></i></div>
            ))}
          </div>
          <StatRail items={[
            { label: locale === "fr" ? "Relances" : "Follow-ups", value: String(business.followUpsDue), alert: business.followUpsDue > 0 },
            { label: locale === "fr" ? "En retard" : "Overdue", value: String(business.overdueInvoices), alert: business.overdueInvoices > 0 },
            { label: locale === "fr" ? "Montant en retard" : "Overdue amount", value: money(business.overdueAmount, true), alert: business.overdueAmount > 0 },
          ]} />
        </section>
      ),
    });
  }

  if (moduleSummary.training) {
    const training = moduleSummary.training;
    const compliance = training.planned ? Math.round(training.done / training.planned * 100) : 0;
    const volumeProgress = training.weekTargetMin ? Math.min(100, Math.round((training.weekMovingMin || 0) / training.weekTargetMin * 100)) : 0;
    const dayLabels = locale === "fr" ? ["L", "M", "M", "J", "V", "S", "D"] : ["M", "T", "W", "T", "F", "S", "S"];
    const firstPendingSession = training.sessions.findIndex((session) => session.state !== "done");
    const sessionStripStart = firstPendingSession === -1
      ? Math.max(0, training.sessions.length - 7)
      : Math.max(0, firstPendingSession - 6);
    const sessionStrip = training.sessions.slice(sessionStripStart, sessionStripStart + 7);
    addModule("module:training", {
      href: "/training",
      title: locale === "fr" ? "Entraînement" : "Training",
      description: locale === "fr" ? "Semaine, charge réelle et prochaine séance." : "Week, actual load and next session.",
      preview: <div className="dashboard-preview-attention"><strong>{compliance}%</strong><span>{locale === "fr" ? "du plan" : "of plan"}</span></div>,
      visual: "module",
      content: (
        <section className="cockpit-card cockpit-module cockpit-training">
          <DashboardCardHead icon={<Dumbbell size={18} aria-hidden />} eyebrow={locale === "fr" ? "Semaine active" : "Active week"} title={locale === "fr" ? "Plan d’entraînement" : "Training plan"} href="/training" action={openLabel} />
          <div className="cockpit-training-summary">
            <div>
              <span>{locale === "fr" ? "Progression du plan" : "Plan progress"}</span>
              <strong>{training.weekNumber && training.weeksTotal ? `${training.weekNumber}/${training.weeksTotal}` : `${compliance}%`}</strong>
              <small>{training.phaseLabel || (locale === "fr" ? "Semaine en cours" : "Current week")}</small>
            </div>
            <div><strong>{compliance}%</strong><span>{training.done}/{training.planned} {locale === "fr" ? "séances" : "sessions"}</span></div>
          </div>
          {training.days.length ? (
            <div className="cockpit-training-week" aria-label={locale === "fr" ? "État des séances de la semaine" : "Weekly session status"}>
              {training.days.map((day, index) => (
                <span className={`is-${day.state}`} key={day.weekday} title={day.title || (day.state === "rest" ? (locale === "fr" ? "Repos" : "Rest") : day.state)}>
                  <i>{day.state === "done" ? "✓" : day.state === "missed" ? "×" : day.state === "partial" ? "•" : ""}</i>
                  <small>{dayLabels[index]}</small>
                </span>
              ))}
            </div>
          ) : sessionStrip.length ? (
            <div className="cockpit-training-week is-session-strip" aria-label={locale === "fr" ? "État des séances du plan" : "Plan session status"}>
              {sessionStrip.map((session, index) => (
                <span className={`is-${session.state}`} key={`${session.title}:${index}`} title={session.title}>
                  <i>{session.state === "done" ? "✓" : session.state === "missed" ? "×" : ""}</i>
                  <small>S{sessionStripStart + index + 1}</small>
                </span>
              ))}
            </div>
          ) : null}
          <div className="cockpit-training-next">
            <span>{locale === "fr" ? "Prochaine séance" : "Next session"}</span>
            <strong>{training.nextSession || (locale === "fr" ? "Semaine terminée" : "Week complete")}</strong>
          </div>
          {training.weekTargetMin ? (
            <div className="cockpit-training-load">
              <span><strong>{locale === "fr" ? "Charge hebdomadaire" : "Weekly load"}</strong><em>{fmtMinutes(training.weekMovingMin || 0)} / {fmtMinutes(training.weekTargetMin)}</em></span>
              <i><b style={{ width: `${volumeProgress}%` }} /></i>
            </div>
          ) : null}
          <StatRail items={[
            { label: locale === "fr" ? "Complétion" : "Completion", value: `${compliance}%` },
            { label: locale === "fr" ? "Course" : "Run", value: training.runKm === null ? "—" : fmtKm(training.runKm, 1, locale === "fr" ? "fr" : "en") },
            { label: locale === "fr" ? "Vélo" : "Ride", value: training.rideKm === null ? "—" : fmtKm(training.rideKm, 1, locale === "fr" ? "fr" : "en") },
            { label: locale === "fr" ? "Dénivelé" : "Elevation", value: training.elevationM === null ? "—" : `${Math.round(training.elevationM)} m` },
            { label: locale === "fr" ? "Objectif" : "Goal", value: training.daysToObjective === null ? "—" : `${locale === "fr" ? "J" : "D"}-${training.daysToObjective}` },
            { label: locale === "fr" ? "Séances manquées" : "Missed sessions", value: String(training.missed || 0), alert: (training.missed || 0) > 0 },
          ]} />
        </section>
      ),
    });
  }

  if (moduleSummary.revisions) {
    const revisions = moduleSummary.revisions;
    const matrixSize = 12;
    const matrixReady = Math.round(revisions.progress / 100 * matrixSize);
    addModule("module:revisions", {
      href: "/revisions",
      title: locale === "fr" ? "Révisions" : "Study",
      description: locale === "fr" ? "Matière prête, cartes et compte à rebours." : "Ready material, cards and countdown.",
      preview: <div className="dashboard-preview-attention"><strong>{revisions.daysToExam === null ? `${revisions.progress}%` : `${locale === "fr" ? "J" : "D"}-${revisions.daysToExam}`}</strong><span>{locale === "fr" ? "révisions" : "study"}</span></div>,
      visual: "module",
      content: (
        <section className="cockpit-card cockpit-module cockpit-revisions">
          <DashboardCardHead icon={<BookOpenCheck size={18} aria-hidden />} eyebrow={locale === "fr" ? "Programme actif" : "Active program"} title={locale === "fr" ? "Préparation examen" : "Exam preparation"} href="/revisions" action={openLabel} />
          <div className="cockpit-module-value"><strong>{revisions.daysToExam === null ? `${revisions.progress}%` : `${locale === "fr" ? "J" : "D"}-${revisions.daysToExam}`}</strong><span>{revisions.todayTitle || (locale === "fr" ? "Progression des sources" : "Source progress")}</span></div>
          <div className="cockpit-source-matrix" role="img" aria-label={`${revisions.sourcesReady}/${revisions.sourcesTotal} ${locale === "fr" ? "sources prêtes" : "sources ready"}`}>
            {Array.from({ length: matrixSize }, (_, index) => <i className={index < matrixReady ? "is-ready" : undefined} key={index} />)}
          </div>
          <div className="cockpit-compliance"><i><b style={{ width: `${revisions.progress}%` }} /></i><span>{revisions.progress}% {locale === "fr" ? "du contenu prêt" : "content ready"}</span></div>
          <StatRail items={[
            { label: locale === "fr" ? "Sources" : "Sources", value: `${revisions.sourcesReady}/${revisions.sourcesTotal}`, alert: revisions.emptySources > 0 },
            { label: locale === "fr" ? "Cartes" : "Cards", value: String(revisions.cards) },
            { label: locale === "fr" ? "Modules" : "Modules", value: String(revisions.modules) },
          ]} />
        </section>
      ),
    });
  }

  if (moduleSummary.custom && availableWidgetIds.has("module:custom:notes")) {
    const custom = moduleSummary.custom;
    const latestCustomNote = custom.pages.flatMap((page) => page.latestNote ? [page.latestNote] : []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    widgets.push({
      id: "module:custom:notes",
      href: custom.pages[0] ? `/p/${custom.pages[0].slug}` : "/notes",
      title: locale === "fr" ? "Espaces personnalisés" : "Custom spaces",
      description: locale === "fr" ? "Volume et dernière activité des espaces libres." : "Volume and latest activity in custom spaces.",
      visual: "landscape",
      preview: <div className="dashboard-preview-attention"><strong>{custom.notes}</strong><span>{locale === "fr" ? "notes" : "notes"}</span></div>,
      content: (
        <section className="cockpit-card cockpit-module cockpit-custom">
          <DashboardCardHead icon={<Layers3 size={18} aria-hidden />} eyebrow={locale === "fr" ? "Espaces libres" : "Free-form spaces"} title={locale === "fr" ? "Modules personnalisés" : "Custom modules"} href={custom.pages[0] ? `/p/${custom.pages[0].slug}` : "/notes"} action={openLabel} />
          <div className="cockpit-custom-grid">
            {custom.pages.map((page) => (
              <Link href={`/p/${page.slug}`} key={page.slug}>
                <span><strong>{page.title}</strong><em>{page.notes} {locale === "fr" ? "notes" : "notes"}</em></span>
                <small>{page.latestNote?.title || (locale === "fr" ? "Aucune note" : "No note")}</small>
                <ArrowUpRight size={14} aria-hidden />
              </Link>
            ))}
          </div>
          <StatRail items={[
            { label: locale === "fr" ? "Espaces" : "Spaces", value: String(custom.pages.length) },
            { label: locale === "fr" ? "Notes" : "Notes", value: String(custom.notes) },
            { label: locale === "fr" ? "Dernière activité" : "Latest activity", value: latestCustomNote?.title || "—" },
          ]} />
        </section>
      ),
    });
  }

  return (
    <div className="home dashboard-cockpit">
      <header className="cockpit-page-head">
        <div>
          <span className="cockpit-page-date">{heroDate}</span>
          <h1>{locale === "fr" ? "Vue d’ensemble" : "Overview"}</h1>
          <p>{locale === "fr"
            ? `${priorityTasks.length} priorité${priorityTasks.length === 1 ? "" : "s"} · ${connectedModuleCount} module${connectedModuleCount === 1 ? "" : "s"} connecté${connectedModuleCount === 1 ? "" : "s"}`
            : `${priorityTasks.length} priorit${priorityTasks.length === 1 ? "y" : "ies"} · ${connectedModuleCount} connected module${connectedModuleCount === 1 ? "" : "s"}`}</p>
        </div>
        <div className="cockpit-page-actions">
          <ActionDialog title={t["dashboard.newNote"]} trigger={t["dashboard.note"]}>
            <RawNoteForm />
          </ActionDialog>
          <ActionDialog title={t["dashboard.newTask"]} trigger={t["dashboard.task"]}>
            <TaskForm />
          </ActionDialog>
        </div>
      </header>
      <DashboardLayout widgets={widgets} initialState={dashboardLayout} />
    </div>
  );
}
