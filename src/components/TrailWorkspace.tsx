import Link from "next/link";
import {
  Activity,
  Bike,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  Droplets,
  Dumbbell,
  Download,
  Footprints,
  Gauge,
  Mountain,
  Map as MapIcon,
  RefreshCw,
  Route,
  ShieldCheck,
  Timer,
  Utensils,
  Watch,
} from "lucide-react";
import { MultisportJournal } from "@/components/MultisportJournal";
import { TodayBoard, type PlanDay, type PlanDisplaySession } from "@/components/TodayBoard";
import { TrailCycles, type CycleSession } from "@/components/TrailCycles";
import { MetricCards, ProgressRing } from "@/components/ui/Analytics";
import { sessionDifficulty } from "@/lib/trail-difficulty";
import { HealthTrendChart, MultisportLoadSection } from "@/components/TrainingCharts";
import { WeeklyActivityMiniChart, type WeeklyActivityPoint } from "@/components/WeeklyActivityMiniChart";
import { CoachDecisionCard } from "@/components/CoachDecisionCard";
import type { Locale, TranslationKey } from "@/lib/i18n";
import {
  DAY_NAMES,
  fmtKm,
  fmtMinutes,
  planDateIso,
  plannedSessionsFor,
  type SportKind,
  type TrailActivity,
  type TrailStats,
} from "@/lib/trail";

function SportIcon({ sport, size = 18 }: { sport: SportKind; size?: number }) {
  if (sport === "run") return <Footprints size={size} aria-hidden />;
  if (sport === "ride") return <Bike size={size} aria-hidden />;
  if (sport === "strength") return <Dumbbell size={size} aria-hidden />;
  if (sport === "recovery") return <RefreshCw size={size} aria-hidden />;
  return <Activity size={size} aria-hidden />;
}

function WeekSchedule({ stats, days, selectedWeek, labels }: { stats: TrailStats; days: PlanDay[]; selectedWeek: number; labels: TrainingLabels }) {
  const weekday = selectedWeek === stats.currentWeek ? (stats.today.getDay() + 6) % 7 : -1;
  const weekElapsed = selectedWeek < stats.currentWeek;
  return (
    <div className="week-schedule">
      {DAY_NAMES.map((day, dayIndex) => {
        const localizedDay = labels[`training.weekday.long.${dayIndex}` as TranslationKey];
        const sessions = days[dayIndex]?.sessions || [];
        const tracked = sessions.filter((session) => !session.optional && session.sport !== "recovery" && !session.cancelledReason);
        const complete = tracked.length > 0 && tracked.every((session) => Boolean(session.matchedActivityId || session.manualValidated));
        const dayElapsed = weekElapsed || dayIndex < weekday;
        return (
          <details className={`week-day${dayIndex === weekday ? " is-today" : ""}${complete && dayElapsed ? " is-complete" : ""}`} key={day}>
            <summary>
              <span className="week-day-name">{localizedDay}<small>{dayIndex === weekday ? labels["training.day.today"] : ""}</small></span>
              <div className="week-day-sessions">
                {sessions.map((session) => <span className={`week-session sport-${session.sport}${session.cancelledReason ? " is-cancelled" : ""}`} key={session.id}><SportIcon sport={session.sport} size={13} />{session.title.replace("Musculation · ", "").replace("Course facile", "Course")}</span>)}
              </div>
              <span className="week-day-status">{complete && dayElapsed ? <Check size={15} /> : dayElapsed ? "—" : <ChevronRight size={15} />}</span>
            </summary>
            {sessions.length ? <div className="week-day-details">{sessions.map((session) => <article key={session.id}><strong>{session.title}</strong><span>{session.durationMin ? fmtMinutes(session.durationMin) : labels["training.session.freeDuration"]} · {session.intensity}</span><ul>{session.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>{session.sport !== "recovery" && (
              <div className="session-downloads">
                <a className="session-fit-download is-json" href={`/api/trail/workout?session=${encodeURIComponent(session.id)}&format=json`} download>
                  <Download size={14} /> JSON
                </a>
                <a className="session-fit-download" href={`/api/trail/workout?session=${encodeURIComponent(session.id)}&format=fit`} download>
                  <Download size={14} /> FIT
                </a>
              </div>
            )}</article>)}</div> : <p className="week-day-rest">{labels["training.lightRecovery"]}</p>}
          </details>
        );
      })}
    </div>
  );
}

function latest<T>(items: T[]): T | null {
  return items.length ? items[items.length - 1] : null;
}

type TrainingLabels = Record<TranslationKey, string>;

export type TrailTab = "semaine" | "analyse" | "plan";

// "semaine" is the default view, so its URL omits ?tab entirely; the other
// two tabs carry it. The selected week always travels with the tab so
// switching tabs never resets which week is being read.
function tabHref(target: TrailTab, selectedWeek: number, currentWeek: number): string {
  const params = new URLSearchParams();
  if (selectedWeek !== currentWeek) params.set("week", String(selectedWeek));
  if (target !== "semaine") params.set("tab", target);
  const qs = params.toString();
  return `/training${qs ? `?${qs}` : ""}`;
}

function carbTargetForMinutes(minutes: number) {
  if (minutes <= 60) return 0;
  if (minutes <= 90) return 30;
  if (minutes <= 150) return 45;
  if (minutes <= 180) return 60;
  return 75;
}

function FuelingStrategy({ stats, selectedWeek, labels }: { stats: TrailStats; selectedWeek: number; labels: TrainingLabels }) {
  const currentLongRun = Math.max(0, ...stats.plan.weeks[selectedWeek - 1]?.sessions.filter((session) => session.sport === "run").map((session) => session.durationMin || 0) || [0]);
  const currentCarbs = carbTargetForMinutes(currentLongRun);
  const currentTotalCarbs = currentCarbs ? Math.round(currentCarbs * currentLongRun / 60) : 0;
  const currentServings = currentTotalCarbs ? Math.max(1, Math.round(currentTotalCarbs / 25)) : 0;
  if (!currentCarbs) return null;

  return (
    <section className="trail-card fueling-card">
      <div className="trail-card-head">
        <div><span className="trail-card-kicker">{labels["training.fueling.longRun"]} · {labels["training.week"].toLowerCase()} {selectedWeek}</span><h2>{labels["training.fueling.plan"]}</h2></div>
        <Utensils size={18} />
      </div>
      <div className="fueling-brief">
        <div><Timer size={16} /><span>{labels["training.fueling.plannedDuration"]}<strong>{fmtMinutes(currentLongRun)}</strong></span></div>
        <div><Utensils size={16} /><span>{labels["training.fueling.toCarry"]}<strong>{currentTotalCarbs} g · {labels[currentServings === 1 ? "training.fueling.servingOne" : "training.fueling.servings"].replace("{count}", String(currentServings))}</strong></span></div>
        <div><Droplets size={16} /><span>{labels["training.fueling.drink"]}<strong>500–750 ml / h</strong></span></div>
      </div>
      <div className="fueling-instruction">
        <strong>{labels["training.fueling.concretePlan"]}</strong>
        <p>{labels["training.fueling.instructions"]
          .replace("{interval}", currentServings >= 3 ? "25–30" : "30–40")
          .replace("{repeat}", currentServings > 1 ? labels["training.fueling.repeat"] : "")}</p>
        <span><RefreshCw size={13} /> {labels["training.fueling.logTolerance"]}</span>
      </div>
    </section>
  );
}

function formatDecimal(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? "-" : value.toFixed(digits).replace(".", ",");
}

function statusLabel(phrase: string | null | undefined, labels: TrainingLabels): string {
  if (!phrase) return labels["training.performance.notProvided"];
  if (/PRODUCTIVE/i.test(phrase)) return labels["training.performance.productive"];
  if (/MAINTAINING/i.test(phrase)) return labels["training.performance.maintaining"];
  if (/RECOVERY/i.test(phrase)) return labels["training.sport.recovery"];
  if (/STRAINED/i.test(phrase)) return labels["training.performance.strained"];
  if (/UNPRODUCTIVE/i.test(phrase)) return labels["training.performance.unproductive"];
  if (/PEAKING/i.test(phrase)) return labels["training.performance.peaking"];
  return phrase.toLowerCase().replace(/_/g, " ");
}

function levelLabel(value: string | null | undefined, labels: TrainingLabels): string {
  if (!value) return labels["training.performance.notProvided"];
  if (value === "VERY_GOOD") return labels["training.performance.veryGood"];
  if (value === "GOOD") return labels["training.performance.good"];
  if (value === "MODERATE") return labels["training.performance.moderate"];
  if (value === "LOW") return labels["training.performance.low"];
  if (value === "HIGH") return labels["training.performance.high"];
  if (value === "OPTIMAL") return labels["training.performance.optimal"];
  return value.toLowerCase().replace(/_/g, " ");
}

function formatShortDate(value: string | null | undefined, locale: "fr" | "en"): string {
  if (!value) return locale === "fr" ? "historique" : "history";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return locale === "fr" ? "historique" : "history";
  return date.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { day: "2-digit", month: "2-digit" });
}

function activityChartPoint(activity: TrailActivity, value: number, formatted: string, locale: Locale): WeeklyActivityPoint {
  const detail = [
    fmtMinutes(activity.durS / 60),
    activity.km ? fmtKm(activity.km, 1, locale) : null,
    activity.dplus ? (locale === "fr" ? `${Math.round(activity.dplus)} m D+` : `${Math.round(activity.dplus)} m gain`) : null,
    activity.hr ? `${activity.hr} bpm` : null,
  ].filter(Boolean).join(" · ");
  return {
    id: activity.id,
    day: new Date(`${activity.date}T00:00:00`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { weekday: "short" }).replace(".", ""),
    date: localizedDay(activity.date, locale),
    name: activity.name,
    value,
    formatted,
    detail,
  };
}

function Vo2Sparkline({ points, labels, locale }: { points: TrailStats["performance"]["vo2History"]; labels: TrainingLabels; locale: Locale }) {
  const clean = points.filter((point) => point.precise !== null || point.value !== null).slice(-18);
  if (clean.length < 2) return <div className="performance-empty">{labels["training.performance.notEnoughPoints"]}</div>;
  const width = 220;
  const height = 58;
  const values = clean.map((point) => point.precise ?? point.value ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.1, max - min);
  const x = (index: number) => (index / (clean.length - 1)) * width;
  const y = (value: number) => height - ((value - min) / range) * (height - 8) - 4;
  const path = values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  return (
    <svg className="performance-sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={labels["training.performance.vo2Evolution"]}>
      <path d={path} />
      {values.map((value, index) => (
        <circle className={index === values.length - 1 ? "is-last" : ""} cx={x(index)} cy={y(value)} r={index === values.length - 1 ? 3.2 : 2.3} key={`${clean[index].date}-${index}`}>
          <title>{`${formatShortDate(clean[index].date, locale)} · VO2max ${formatDecimal(value)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

function GarminPerformanceCard({ stats, throughIso, labels, locale }: { stats: TrailStats; throughIso: string; labels: TrainingLabels; locale: Locale }) {
  const vo2Points = stats.performance.vo2History.filter((point) => point.date <= throughIso && (point.precise !== null || point.value !== null));
  const firstVo2 = vo2Points[0];
  const currentVo2 = latest(vo2Points);
  const currentVo2Value = currentVo2 ? currentVo2.precise ?? currentVo2.value : null;
  const firstVo2Value = firstVo2 ? firstVo2.precise ?? firstVo2.value : null;
  const vo2Delta = currentVo2Value !== null && firstVo2Value !== null ? currentVo2Value - firstVo2Value : null;
  const currentStatus = latest(stats.performance.trainingStatusHistory.filter((point) => point.date <= throughIso));
  const hasStatusData = Boolean(
    currentStatus && (
      currentStatus.phrase
      || currentStatus.acuteLoad !== null
      || currentStatus.acwr !== null
      || currentStatus.acwrStatus
    ),
  );
  const loadIsDerived = !stats.performance.generatedAt && Boolean(currentStatus);

  return (
    <section className="trail-card performance-status-card">
      <div className="trail-card-head">
        <div><span className="trail-card-kicker">{labels["training.performance.garmin"]}</span><h2>{labels["training.performance.vo2AndLoad"]}</h2></div>
        <Watch size={18} />
      </div>
      <div className="performance-panel-grid">
        {hasStatusData ? <>
        <article className="performance-panel">
          <div className="performance-panel-head">
            <span>{labels["training.performance.vo2Evolution"]}</span>
            <strong>{formatDecimal(currentVo2Value)}</strong>
          </div>
          <Vo2Sparkline points={vo2Points} labels={labels} locale={locale} />
          <p>
            {vo2Delta !== null
              ? labels["training.performance.vo2Since"].replace("{delta}", `${vo2Delta >= 0 ? "+" : ""}${formatDecimal(vo2Delta)}`).replace("{date}", formatShortDate(stats.performance.historyStart ?? firstVo2?.date, locale))
              : labels["training.performance.vo2Waiting"]}
          </p>
        </article>
        <article className="performance-panel">
          <div className="performance-panel-head">
            <span>{labels["training.performance.trainingStatus"]}</span>
            <strong>{statusLabel(currentStatus?.phrase, labels)}</strong>
          </div>
          <div className="performance-status-list">
            <div><span>{labels["training.performance.acuteLoad"]}</span><strong>{currentStatus?.acuteLoad ?? "-"}</strong></div>
            <div><span>{labels["training.performance.chronicLoad"]}</span><strong>{currentStatus?.chronicLoad ?? "-"}</strong></div>
            <div><span>ACWR</span><strong>{currentStatus?.acwr ? formatDecimal(currentStatus.acwr, 2) : "-"}</strong></div>
            <div><span>{labels["training.performance.acwrStatus"]}</span><strong>{levelLabel(currentStatus?.acwrStatus, labels)}</strong></div>
          </div>
          <p>{loadIsDerived ? labels["training.performance.derivedLoad"] : labels["training.performance.garminLoad"]}</p>
        </article>
        </> : <div className="performance-data-empty"><Gauge size={18} /><strong>{labels["training.performance.unavailable"]}</strong><p>{labels["training.performance.unavailableDetail"]}</p></div>}
      </div>
      <small className="performance-footnote">
        {labels["training.performance.lastUpdate"]}: {(stats.performance.generatedAt || stats.generatedAt) ? new Date(stats.performance.generatedAt || stats.generatedAt || "").toLocaleString(locale === "fr" ? "fr-FR" : "en-US") : labels["training.performance.toSync"]}{loadIsDerived ? ` · ${labels["training.performance.estimatedFromActivities"]}` : ""}.
      </small>
    </section>
  );
}

function localIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localizedDay(iso: string, locale: Locale): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { weekday: "short", day: "2-digit", month: "short" });
}

function sessionMatchesAdjustment(session: PlanDisplaySession, sport: SportKind) {
  if (session.sport === sport) return true;
  return sport === "recovery" && session.sport === "strength" && /récupération|prevention|prévention|elastiques|élastiques/i.test(`${session.title} ${session.subtitle}`);
}

// Every day of the plan with its planned sessions, serialized for the
// (client) TodayBoard so the arrows can browse past and coming days.
export function planDays(stats: TrailStats, locale: Locale): PlanDay[] {
  const start = new Date(`${stats.plan.objective.startDate}T00:00:00`);
  const days: PlanDay[] = stats.plan.weeks.flatMap((planWeek) =>
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
      const date = new Date(start);
      date.setDate(date.getDate() + (planWeek.week - 1) * 7 + weekday);
      return {
        iso: localIso(date),
        week: planWeek.week,
        label: date.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { weekday: "long", day: "numeric", month: "long" }),
        sessions: plannedSessionsFor(planWeek, weekday),
        adjustments: [],
      };
    }),
  );

  const byIso = new Map(days.map((day) => [day.iso, day]));
  for (const adjustment of stats.planAdjustments) {
    const from = byIso.get(adjustment.fromIso);
    if (!from) continue;
    const to = adjustment.toIso ? byIso.get(adjustment.toIso) : null;

    const moved: PlanDisplaySession[] = [];
    const remaining = from.sessions.filter((session) => {
      if (!sessionMatchesAdjustment(session, adjustment.sport)) return true;
      moved.push({
        ...session,
        rescheduledFromIso: adjustment.fromIso,
        adjustmentReason: adjustment.reason,
        adjustmentSource: adjustment.sourceLabel,
      });
      return false;
    });
    // A note-derived guess with nothing to actually move (wrong/no planned
    // session on that day) is noise, not signal: skip the banner entirely
    // rather than show "reported/moved" text next to nothing.
    if (!moved.length) continue;

    from.sessions = remaining;
    from.adjustments.push(adjustment);
    if (to && to.iso !== from.iso) to.adjustments.push(adjustment);
    if (adjustment.action === "reschedule" && to) to.sessions.push(...moved);
  }

  // Attach the authoritative one-to-one activity assignment before moving
  // cards around. The id travels with a moved session and prevents a single
  // Garmin activity from completing every card of the same sport on a day.
  for (const week of stats.weeks) {
    for (const matched of week.match.sessions) {
      if (!matched.activity) continue;
      for (const day of days) {
        const index = day.sessions.findIndex((session) => session.id === matched.session.id);
        if (index >= 0) day.sessions[index] = { ...day.sessions[index], matchedActivityId: matched.activity.id };
      }
    }
  }

  // Manual overrides (the athlete explicitly moved/cancelled/validated a
  // session), applied before the recorded-activity relocation below so a
  // session moved here can still travel again if it was actually recorded on
  // yet another day.
  for (const override of stats.planOverrides) {
    const planWeek = stats.plan.weeks.find((item) => item.week === override.week);
    const session = planWeek?.sessions.find((item) => item.id === override.sessionId);
    if (!planWeek || !session) continue;
    const from = byIso.get(planDateIso(override.week, session.weekday, start));
    if (!from) continue;

    if (override.action === "move" && override.toWeekday !== null) {
      const to = byIso.get(planDateIso(override.week, override.toWeekday, start));
      if (!to || to.iso === from.iso) continue;
      const index = from.sessions.findIndex((item) => item.id === session.id);
      if (index < 0) continue;
      const [movedSession] = from.sessions.splice(index, 1);
      to.sessions.push({ ...movedSession, userMovedFromIso: from.iso });
    } else if (override.action === "cancel") {
      const index = from.sessions.findIndex((item) => item.id === session.id);
      if (index >= 0) from.sessions[index] = { ...from.sessions[index], cancelledReason: override.reason };
    } else if (override.action === "validate") {
      const to = override.toWeekday === null
        ? from
        : byIso.get(planDateIso(override.week, override.toWeekday, start));
      if (!to) continue;
      const index = from.sessions.findIndex((item) => item.id === session.id);
      if (index < 0) continue;
      const validated = { ...from.sessions[index], manualValidated: true };
      if (to.iso === from.iso) {
        from.sessions[index] = validated;
      } else {
        from.sessions.splice(index, 1);
        to.sessions.push({ ...validated, userMovedFromIso: from.iso });
      }
    }
  }

  // Validating a session by hand is the athlete stating where it actually
  // happened, which outranks the matcher's guess: the relocation below pairs
  // planned slots with Garmin activities from the *original* plan weekdays and
  // knows nothing about manual moves, so without this it drags a session the
  // athlete just validated back to the day the plan had predicted.
  const manuallyValidated = new Set(
    stats.planOverrides.filter((override) => override.action === "validate").map((override) => override.sessionId),
  );

  // Authoritative relocation from recorded activities: a session actually done
  // on another day travels to that day, marked done + "décalée de …". This
  // wins over any note-derived guess, and the existing per-day activity match
  // in TodayBoard then lights it up as completed on its real day.
  for (const week of stats.weeks) {
    for (const matched of week.match.sessions) {
      if (matched.outcome !== "moved" || !matched.actualIso) continue;
      if (manuallyValidated.has(matched.session.id)) continue;
      const target = byIso.get(matched.actualIso);
      if (!target) continue;
      let session: PlanDisplaySession | undefined;
      for (const day of days) {
        const index = day.sessions.findIndex((item) => item.id === matched.session.id);
        if (index < 0) continue;
        [session] = day.sessions.splice(index, 1);
        break;
      }
      if (!session) continue;
      target.sessions.push({ ...session, movedFromIso: matched.plannedIso, rescheduledFromIso: undefined, adjustmentReason: undefined });
    }
  }

  return days;
}

function currentWeekDays(days: PlanDay[], currentWeek: number): PlanDay[] {
  return days.filter((day) => day.week === currentWeek);
}

// Serializable weekly session list for the (client) cycles card accordions:
// title, duration, difficulty, the long outing's D+ target, and the matched
// outcome so each row can render done/moved/missed. Sessions Garmin never logs
// (recovery/prevention) carry "untracked" and are never shown as missed.
function cycleSessionsByWeek(stats: TrailStats, locale: Locale): Record<number, CycleSession[]> {
  return Object.fromEntries(stats.weeks.map((week) => {
    const matchById = new Map(week.match.sessions.map((matched) => [matched.session.id, matched]));
    const planWeek = stats.plan.weeks[week.plan.week - 1] || week.plan;
    const sessions = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => plannedSessionsFor(planWeek, weekday))
      .map((session): CycleSession => {
        const matched = matchById.get(session.id);
        return {
          title: session.title,
          subtitle: session.subtitle,
          sport: session.sport,
          durationMin: session.durationMin,
          difficulty: sessionDifficulty(session),
          dplus: /sortie longue/i.test(session.title) ? week.plan.dplus : 0,
          outcome: matched ? matched.outcome : "untracked",
          actualLabel: matched && matched.outcome === "moved" && matched.actualIso ? localizedDay(matched.actualIso, locale) : null,
          intensity: session.intensity,
          details: session.details,
        };
      });
    return [week.plan.week, sessions];
  }));
}

// Session heatmap: one column per week, one cell per planned session, filled
// as sessions are actually recorded (matched tolerant of the day). Reads like
// a wall being built.
function RegularityHeatmap({ stats, selectedWeek, labels }: { stats: TrailStats; selectedWeek: number; labels: TrainingLabels }) {
  const maxRows = Math.max(1, ...stats.weeks.map((week) => week.match.plannedCount));
  const elapsed = stats.weeks.filter((week) => week.plan.week <= selectedWeek);
  const plannedToDate = elapsed.reduce((total, week) => total + week.match.plannedCount, 0);
  const doneToDate = elapsed.reduce((total, week) => total + week.match.doneCount, 0);
  const pct = plannedToDate ? Math.round((doneToDate / plannedToDate) * 100) : 0;

  return (
    <div className="reg-heatmap">
      <div className="reg-head">
        <strong className="reg-pct">{pct}%</strong>
        <span className="reg-chip">{labels["training.consistency.doneOfPlanned"].replace("{done}", String(doneToDate)).replace("{planned}", String(plannedToDate))}</span>
      </div>
      <div className="reg-grid" style={{ gridTemplateColumns: `repeat(${stats.weeks.length}, minmax(0, 1fr))` }}>
        {stats.weeks.map((week) => {
          const planned = week.match.plannedCount;
          const done = week.match.doneCount;
          return (
            <div className={`reg-col${week.plan.week === selectedWeek ? " is-selected" : ""}`} key={week.plan.week} title={labels["training.consistency.weekTitle"].replace("{week}", String(week.plan.week)).replace("{done}", String(done)).replace("{planned}", String(planned))}>
              {Array.from({ length: maxRows }, (_, cell) => {
                let state = "empty";
                if (cell < done) state = "done";
                else if (cell < planned) {
                  state = week.plan.week < stats.currentWeek ? "missed" : week.plan.week === stats.currentWeek ? "pending" : "upcoming";
                }
                return <i className={`reg-cell is-${state}`} key={cell} />;
              })}
            </div>
          );
        })}
      </div>
      <div className="reg-labels" style={{ gridTemplateColumns: `repeat(${stats.weeks.length}, minmax(0, 1fr))` }}>
        {stats.weeks.map((week) => (
          <span key={week.plan.week}>{week.plan.week % 2 === 0 ? `S${week.plan.week}` : ""}</span>
        ))}
      </div>
      <div className="reg-legend">
        <span><i className="reg-cell is-done" />{labels["training.consistency.done"]}</span>
        <span><i className="reg-cell is-missed" />{labels["training.consistency.missed"]}</span>
        <span><i className="reg-cell is-upcoming" />{labels["training.consistency.upcoming"]}</span>
      </div>
    </div>
  );
}

export function TrailWorkspace({ stats, labels, locale, selectedWeek, tab, coachStale, coachRunning }: { stats: TrailStats; labels: TrainingLabels; locale: Locale; selectedWeek: number; tab: TrailTab; coachStale: boolean; coachRunning: boolean }) {
  const selected = stats.weeks[selectedWeek - 1];
  const feedbackActivities = [...stats.allActivities].reverse();
  const lastRun = latest(stats.allRuns);
  const days = planDays(stats, locale);
  const weekDays = currentWeekDays(days, selectedWeek);
  const selectedPlanWeek = stats.plan.weeks[selectedWeek - 1];
  const plannedSessions = selectedPlanWeek ? [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => plannedSessionsFor(selectedPlanWeek, weekday)) : [];
  const plannedMinutes = (sport: SportKind) => plannedSessions.filter((session) => session.sport === sport).reduce((total, session) => total + (session.durationMin || 0), 0);
  const progress = (actual: number, target: number) => target ? Math.min(100, actual / target * 100) : 0;
  const selectedDone = selected?.match.doneCount || 0;
  const selectedPlanned = selected?.match.plannedCount || 0;
  const selectedCompletionPct = selectedPlanned ? Math.round(selectedDone / selectedPlanned * 100) : 0;
  const selectedPhase = stats.plan.phases.find((phase) => phase.id === selectedPlanWeek?.phase)?.name || stats.phaseLabel;
  const throughIso = weekDays[weekDays.length - 1]?.iso || localIso(stats.today);
  const activitiesThroughWeek = stats.allActivities.filter((activity) => activity.date <= throughIso);
  const selectedActivities = [...(selected?.activities || [])].sort((a, b) => a.date.localeCompare(b.date));
  const selectedRuns = selectedActivities.filter((activity) => activity.kind === "run");
  const selectedRides = selectedActivities.filter((activity) => activity.kind === "ride");
  const selectedStrength = selectedActivities.filter((activity) => activity.kind === "strength");
  const sportCompletion = [
    { label: labels["training.sport.run"], value: progress(selected?.runMin || 0, plannedMinutes("run")), detail: `${fmtMinutes(selected?.runMin || 0)} / ${fmtMinutes(plannedMinutes("run"))}`, tone: "positive" as const },
    { label: labels["training.sport.ride"], value: progress(selected?.rideMin || 0, plannedMinutes("ride")), detail: `${fmtMinutes(selected?.rideMin || 0)} / ${fmtMinutes(plannedMinutes("ride"))}`, tone: "info" as const },
    { label: labels["training.sport.strength"], value: progress(selected?.strengthMin || 0, plannedMinutes("strength")), detail: `${fmtMinutes(selected?.strengthMin || 0)} / ${fmtMinutes(plannedMinutes("strength"))}`, tone: "warning" as const },
  ];

  return (
    <div className="training-dashboard">
      <nav className="trail-tabs" aria-label={labels["training.tabs.aria"]}>
        {([
          { id: "semaine", label: labels["training.tab.week"], icon: <CalendarDays size={15} /> },
          { id: "analyse", label: labels["training.tab.analysis"], icon: <ChartNoAxesCombined size={15} /> },
          { id: "plan", label: labels["training.tab.plan"], icon: <MapIcon size={15} /> },
        ] as const).map((item) => (
          <Link
            key={item.id}
            href={tabHref(item.id, selectedWeek, stats.currentWeek)}
            scroll={false}
            className={`trail-tab${tab === item.id ? " is-active" : ""}`}
            aria-current={tab === item.id ? "page" : undefined}
          >
            {item.icon}<span>{item.label}</span>
          </Link>
        ))}
      </nav>

      <TodayBoard
        days={days}
        todayIso={localIso(stats.today)}
        activities={stats.allActivities}
        weeksTotal={stats.plan.objective.weeksTotal}
        nextSession={stats.nextSession}
        currentWeek={stats.currentWeek}
        selectedWeek={selectedWeek}
        navigationOnly={tab !== "semaine"}
      />

      {tab === "semaine" && (
        <section className="trail-chapter">
          <MetricCards className="training-metrics-modern" viewLabel={labels["common.view"]} items={[
          { tone: "neutral", icon: <Timer size={17} />, label: labels["training.metric.totalTime"], value: fmtMinutes(selected?.totalMin || 0), content: <WeeklyActivityMiniChart points={selectedActivities.map((activity) => activityChartPoint(activity, activity.durS / 60, fmtMinutes(activity.durS / 60), locale))} />, detail: labels["training.metric.allSportSessions"].replace("{count}", String(selected?.activities.length || 0)) },
          { tone: "positive", icon: <Route size={17} />, label: labels["training.metric.distance"], value: fmtKm(selected?.runKm || 0, 1, locale), content: <WeeklyActivityMiniChart points={selectedRuns.map((activity) => activityChartPoint(activity, activity.km, fmtKm(activity.km, 1, locale), locale))} />, detail: fmtMinutes(selected?.runMin || 0) },
          { tone: "warning", icon: <Mountain size={17} />, label: labels["training.metric.elevation"], value: `${Math.round(selected?.runDplus || 0)} m`, content: <WeeklyActivityMiniChart points={selectedRuns.map((activity) => activityChartPoint(activity, activity.dplus, locale === "fr" ? `${Math.round(activity.dplus)} m D+` : `${Math.round(activity.dplus)} m gain`, locale))} />, detail: `${labels["training.objective"]} · ${locale === "fr" ? `${Math.round(stats.plan.objective.eventElevationM || 0)} m D+` : `${Math.round(stats.plan.objective.eventElevationM || 0)} m gain`}` },
          { tone: "info", icon: <Bike size={17} />, label: labels["training.sport.ride"], value: fmtKm(selected?.rideKm || 0, 1, locale), content: <WeeklyActivityMiniChart points={selectedRides.map((activity) => activityChartPoint(activity, activity.km, fmtKm(activity.km, 1, locale), locale))} />, detail: `${fmtMinutes(selected?.rideMin || 0)} · ${labels[selected?.rides.length === 1 ? "training.metric.sessionOne" : "training.metric.sessionCount"].replace("{count}", String(selected?.rides.length || 0))}` },
          { tone: "accent", icon: <Dumbbell size={17} />, label: labels["training.sport.strength"], value: fmtMinutes(selected?.strengthMin || 0), content: <WeeklyActivityMiniChart points={selectedStrength.map((activity) => activityChartPoint(activity, activity.durS / 60, fmtMinutes(activity.durS / 60), locale))} />, detail: labels[selected?.strength.length === 1 ? "training.metric.sessionOne" : "training.metric.sessionCount"].replace("{count}", String(selected?.strength.length || 0)) },
          { tone: "positive", icon: <ShieldCheck size={17} />, label: labels["training.metric.completedSessions"], value: `${selectedCompletionPct}%`, detail: labels["training.metric.requiredDone"].replace("{done}", String(selectedDone)).replace("{planned}", String(selectedPlanned)), content: (
            <div className="training-completion-rings">
              {sportCompletion.map((item) => (
                <div key={item.label}>
                  <ProgressRing value={item.value} label={item.label} tone={item.tone} />
                  <span>{item.label}</span>
                  <small>{item.detail}</small>
                </div>
              ))}
            </div>
          ) },
          ]} />

          <section className="trail-card">
            <div className="trail-card-head"><div><span className="trail-card-kicker">{labels["training.week"]} {selectedWeek}</span><h2>{labels["training.fullSchedule"]}</h2></div><span className="week-phase">{selectedPhase}</span></div>
            <WeekSchedule stats={stats} days={weekDays} selectedWeek={selectedWeek} labels={labels} />
          </section>

          <FuelingStrategy stats={stats} selectedWeek={selectedWeek} labels={labels} />

          <CoachDecisionCard decision={stats.coachDecision} fallback={stats.insights} lastRun={lastRun} stale={coachStale} running={coachRunning} />

          <MultisportJournal key={selectedWeek} activities={feedbackActivities} initialFeedback={stats.feedback} currentWeek={stats.currentWeek} initialWeek={selectedWeek} />
        </section>
      )}

      {tab === "analyse" && (
        <section className="trail-chapter">
          <div className="analysis-layout">
            <div className="analysis-main">
              <HealthTrendChart days={stats.health.days.filter((day) => day.date <= throughIso)} />
              <GarminPerformanceCard stats={stats} throughIso={throughIso} labels={labels} locale={locale} />
            </div>
            <div className="analysis-side">
              <section className="trail-card">
                <div className="trail-card-head"><div><span className="trail-card-kicker">{labels["training.consistency.kicker"]}</span><h2>{labels["training.consistency.title"]}</h2></div><ShieldCheck size={18} /></div>
                <p className="cycle-card-sub">{labels["training.consistency.description"]}</p>
                <RegularityHeatmap stats={stats} selectedWeek={selectedWeek} labels={labels} />
              </section>
            </div>
          </div>
        </section>
      )}

      {tab === "plan" && (
        <section className="trail-chapter">
          <div className="training-main">
            <MultisportLoadSection weeks={stats.weeks} currentWeek={stats.currentWeek} selectedWeek={selectedWeek} activities={activitiesThroughWeek} />

            <section className="trail-card cycle-card">
              <div className="trail-card-head"><div><span className="trail-card-kicker">{labels["training.planCycles"]}</span><h2>{labels["training.trainingBlocks"]}</h2></div></div>
              <p className="cycle-card-sub">{labels["training.trainingBlocksDescription"]}</p>
              <TrailCycles key={selectedWeek} weeks={stats.weeks} currentWeek={stats.currentWeek} selectedWeek={selectedWeek} sessionsByWeek={cycleSessionsByWeek(stats, locale)} phases={stats.plan.phases} />
            </section>
          </div>
        </section>
      )}
    </div>
  );
}
