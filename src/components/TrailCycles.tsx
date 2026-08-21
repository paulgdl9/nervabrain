"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Circle, Minus, X } from "lucide-react";
import { DifficultyBolts } from "@/components/DifficultyBolts";
import { useLanguage } from "@/components/LanguageProvider";
import { fmtMinutes } from "@/lib/trail-format";
import type { TranslationKey } from "@/lib/i18n";
// Type-only: @/lib/trail reads the vault with node:fs, which a client
// component must not pull in. Matched sessions arrive as a prop, computed by
// the server-side TrailWorkspace.
import type { WeekStats } from "@/lib/trail";

// How a session turned out (mirrors trail.ts SessionOutcome) plus "untracked"
// for recovery/prevention blocks Garmin never logs — never scored as missed.
export type CycleOutcome = "done" | "moved" | "today" | "missed" | "upcoming" | "untracked" | "cancelled";

// Serializable planned session for the week accordions, prepared server-side.
export type CycleSession = {
  title: string;
  subtitle: string;
  sport: string;
  durationMin: number | null;
  difficulty: number;
  dplus: number;
  outcome: CycleOutcome;
  // Short French date when the session was recorded on a shifted day.
  actualLabel: string | null;
  intensity: string;
  details: string[];
};

const OUTCOME_KEYS: Record<CycleOutcome, TranslationKey | null> = {
  done: "training.cycle.done",
  moved: "training.cycle.moved",
  today: "training.cycle.today",
  missed: "training.cycle.missed",
  upcoming: "training.cycle.upcoming",
  untracked: null,
  cancelled: "training.cycle.cancelled",
};

function OutcomeIcon({ outcome }: { outcome: CycleOutcome }) {
  if (outcome === "done" || outcome === "moved") return <Check size={13} aria-hidden />;
  if (outcome === "missed") return <Minus size={13} aria-hidden />;
  if (outcome === "cancelled") return <X size={13} aria-hidden />;
  return <Circle size={9} aria-hidden />;
}

// The plan's three phases presented as training blocks ("cycles"): a segmented
// arc gauge (one segment per week), the block's intent, its regularity and
// duration counters, then one collapsible row per week. Inspired by coaching
// apps' cycle screens, restyled for the dark glass theme.

// Presentation-only theme tokens: stay hardcoded client-side regardless of
// where the phase name/description come from.
const PHASE_COLORS: Record<1 | 2 | 3, string> = {
  1: "var(--run-color)",
  2: "var(--ride-color)",
  3: "var(--strength-color)",
};

// Used only if the loaded plan (stats.plan.phases, see @/lib/trail) is
// missing an entry for a given phase id.
const PHASE_FALLBACK_KEYS: Record<1 | 2 | 3, { name: TranslationKey; description: TranslationKey }> = {
  1: {
    name: "training.cycle.phaseBase",
    description: "training.cycle.phaseBaseDescription",
  },
  2: {
    name: "training.cycle.phaseSpecific",
    description: "training.cycle.phaseSpecificDescription",
  },
  3: {
    name: "training.cycle.phasePeak",
    description: "training.cycle.phasePeakDescription",
  },
};

// Weekly plan target in minutes, all disciplines (mirrors the load explorer).
function weekTarget(week: WeekStats): number {
  const ride = week.plan.phase === 1 ? 55 : 45;
  const strength = week.plan.week < 11 ? 180 : week.plan.week === 11 ? 120 : 60;
  return week.plan.runMinTarget + ride + strength;
}

function polar(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy - radius * Math.sin(rad) };
}

function sectorPath(cx: number, cy: number, r1: number, r2: number, a0: number, a1: number): string {
  const o0 = polar(cx, cy, r2, a0);
  const o1 = polar(cx, cy, r2, a1);
  const i1 = polar(cx, cy, r1, a1);
  const i0 = polar(cx, cy, r1, a0);
  const large = Math.abs(a0 - a1) > 180 ? 1 : 0;
  return [
    `M${o0.x.toFixed(2)},${o0.y.toFixed(2)}`,
    `A${r2},${r2} 0 ${large} 1 ${o1.x.toFixed(2)},${o1.y.toFixed(2)}`,
    `L${i1.x.toFixed(2)},${i1.y.toFixed(2)}`,
    `A${r1},${r1} 0 ${large} 0 ${i0.x.toFixed(2)},${i0.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

function CycleArc({ weeks, currentWeek, color, label }: { weeks: WeekStats[]; currentWeek: number; color: string; label: (week: number) => string }) {
  const width = 320;
  const height = 168;
  const cx = width / 2;
  const cy = 158;
  const r1 = 88;
  const r2 = 140;
  const span = 180;
  const gap = 5;
  const seg = (span - gap * (weeks.length - 1)) / weeks.length;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="cycle-arc" role="img" aria-label={label(0)}>
      <defs>
        {weeks.map((week, index) => {
          if (week.plan.week !== currentWeek) return null;
          // Liquid fill of the current week's segment: filled up to the share
          // of its weekly target already trained.
          const fraction = Math.max(0.06, Math.min(1, week.totalMin / Math.max(1, weekTarget(week))));
          return (
            <linearGradient key={index} id={`cycle-fill-${week.plan.week}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset={fraction} stopColor={color} />
              <stop offset={fraction} stopColor="transparent" />
            </linearGradient>
          );
        })}
      </defs>
      {weeks.map((week, index) => {
        const a0 = 180 - index * (seg + gap);
        const a1 = a0 - seg;
        const path = sectorPath(cx, cy, r1, r2, a0, a1);
        const isPast = week.plan.week < currentWeek;
        const isCurrent = week.plan.week === currentWeek;
        return (
          <path
            key={week.plan.week}
            d={path}
            className={`cycle-arc-seg${isPast ? " is-done" : ""}${isCurrent ? " is-current" : ""}`}
            style={{
              fill: isPast ? color : isCurrent ? `url(#cycle-fill-${week.plan.week})` : "transparent",
              stroke: isPast || isCurrent ? color : undefined,
            }}
          >
            <title>{`${label(week.plan.week)} · ${week.plan.dates}`}</title>
          </path>
        );
      })}
    </svg>
  );
}

function WeekRow({ week, currentWeek, selectedWeek, sessions, t }: { week: WeekStats; currentWeek: number; selectedWeek: number; sessions: CycleSession[]; t: ReturnType<typeof useLanguage>["t"] }) {
  const isCurrent = week.plan.week === currentWeek;
  const isSelected = week.plan.week === selectedWeek;
  const tracked = sessions.filter((session) => session.outcome !== "untracked" && session.outcome !== "cancelled");
  const doneCount = tracked.filter((session) => session.outcome === "done" || session.outcome === "moved").length;
  const hasActivity = week.totalMin > 0;
  return (
    <details className={`cycle-week${isSelected ? " is-current" : ""}`} open={isSelected}>
      <summary>
        <span className="cycle-week-name">
          {t("training.cycle.week").replace("{week}", String(week.plan.week))}
          {isSelected && <em>{t(isCurrent ? "training.cycle.current" : "training.cycle.selected")}</em>}
        </span>
        <span className="cycle-week-meta">
          {tracked.length > 0 && (
            <span className={`cycle-week-count${doneCount >= tracked.length ? " is-full" : ""}`}>{doneCount}/{tracked.length}</span>
          )}
          <span className="cycle-week-dates">{week.plan.dates}</span>
          <ChevronDown size={15} className="cycle-week-chevron" aria-hidden />
        </span>
      </summary>
      <div className="cycle-week-body">
        <div className="cycle-sessions">
          {sessions.map((session, index) => (
            <details className={`cycle-session is-${session.outcome}`} key={index}>
              <summary>
              <span className="cycle-session-state" title={OUTCOME_KEYS[session.outcome] ? t(OUTCOME_KEYS[session.outcome]!) : ""} aria-label={OUTCOME_KEYS[session.outcome] ? t(OUTCOME_KEYS[session.outcome]!) : ""}>
                <OutcomeIcon outcome={session.outcome} />
              </span>
              <div className="cycle-session-main">
                <strong>{session.title}</strong>
                <span>{session.actualLabel ? t("training.cycle.completedOn").replace("{date}", session.actualLabel) : session.subtitle}</span>
              </div>
              <div className="cycle-session-facts">
                {session.durationMin ? <span className="cycle-session-duration">
                  {session.subtitle.includes("estim") ? "≈ " : ""}{fmtMinutes(session.durationMin)}
                </span> : null}
                {session.dplus > 0 && (
                  <span className="cycle-session-dplus">{t("training.cycle.elevationRange").replace("{low}", String(Math.round(session.dplus * 0.9))).replace("{high}", String(Math.round(session.dplus * 1.1)))}<small> m D+</small></span>
                )}
                <DifficultyBolts level={session.difficulty} size={11} label={t("training.session.difficultyLevel").replace("{level}", String(session.difficulty))} />
              </div>
              <ChevronDown size={14} className="cycle-session-chevron" />
              </summary>
              <div className="cycle-session-detail"><strong>{session.intensity}</strong><ol>{session.details.map((detail) => <li key={detail}>{detail}</li>)}</ol></div>
            </details>
          ))}
        </div>
        <p className="cycle-week-target">
          {t("training.cycle.runTarget")} : <strong>{fmtMinutes(week.plan.runMinTarget)}</strong>
          {week.plan.dplus > 0 && <> · D+ : <strong>{week.plan.dplus} m</strong></>}
        </p>
        <p className="cycle-week-actual">
          {hasActivity
            ? <>{t("training.cycle.actual")} : <strong>{fmtMinutes(week.totalMin)}</strong> · {doneCount}/{tracked.length} {t(tracked.length === 1 ? "training.cycle.sessionOne" : "training.cycle.sessions").replace("{count}", "")}</>
            : week.plan.week < currentWeek ? t("training.cycle.noActivity") : t("training.cycle.upcomingSentence")}
        </p>
        {week.plan.gate && <p className="cycle-week-gate">◆ {week.plan.gate}</p>}
      </div>
    </details>
  );
}

export function TrailCycles({ weeks, currentWeek, selectedWeek = currentWeek, sessionsByWeek, phases: planPhases }: {
  weeks: WeekStats[];
  currentWeek: number;
  selectedWeek?: number;
  // Matched sessions per plan week (with per-session outcome), computed
  // server-side. Regularity counts derive from these so the block gauge,
  // the accordions and the heatmap can never disagree.
  sessionsByWeek: Record<number, CycleSession[]>;
  // Phase names/descriptions from the loaded plan (stats.plan.phases).
  phases: { id: number; name: string; description: string }[];
}) {
  const { t } = useLanguage();
  const phases = ([1, 2, 3] as const).map((phase) => {
    const fromPlan = planPhases.find((item) => item.id === phase);
    return {
      phase,
      meta: {
        name: fromPlan?.name ?? t(PHASE_FALLBACK_KEYS[phase].name),
        description: fromPlan?.description ?? t(PHASE_FALLBACK_KEYS[phase].description),
        color: PHASE_COLORS[phase],
      },
      weeks: weeks.filter((week) => week.plan.phase === phase),
    };
  }).filter((block) => block.weeks.length > 0);

  const currentPhaseIndex = Math.max(0, phases.findIndex((block) =>
    block.weeks.some((week) => week.plan.week === selectedWeek)));
  const [index, setIndex] = useState(currentPhaseIndex);
  const block = phases[Math.min(index, phases.length - 1)];
  if (!block) return null;

  const blockSessions = block.weeks.flatMap((week) => sessionsByWeek[week.plan.week] || []);
  const trackedSessions = blockSessions.filter((session) => session.outcome !== "untracked" && session.outcome !== "cancelled");
  const doneSessions = trackedSessions.filter((session) => session.outcome === "done" || session.outcome === "moved").length;
  const plannedSessions = trackedSessions.length;
  const doneMinutes = block.weeks.reduce((total, week) => total + week.totalMin, 0);
  const targetMinutes = block.weeks.reduce((total, week) => total + weekTarget(week), 0);

  const positionInBlock = block.weeks.findIndex((week) => week.plan.week === selectedWeek);
  const chip = positionInBlock >= 0
    ? t("training.cycle.position").replace("{current}", String(positionInBlock + 1)).replace("{total}", String(block.weeks.length))
    : block.weeks[block.weeks.length - 1].plan.week < selectedWeek ? t("training.cycle.finished") : t("training.cycle.upcomingBlock");

  return (
    <div className="cycle-explorer" style={{ "--cycle-color": block.meta.color } as React.CSSProperties}>
      <div className="cycle-nav">
        <button type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0} aria-label={t("training.cycle.previousBlock")}>
          <ChevronLeft size={16} />
        </button>
        <span className="cycle-nav-title">{t("training.cycle.blockPosition").replace("{current}", String(index + 1)).replace("{total}", String(phases.length))}</span>
        <button type="button" onClick={() => setIndex((value) => Math.min(phases.length - 1, value + 1))} disabled={index === phases.length - 1} aria-label={t("training.cycle.nextBlock")}>
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="cycle-hero">
        <CycleArc weeks={block.weeks} currentWeek={selectedWeek} color={block.meta.color} label={(week) => week === 0 ? t("training.cycle.progress") : t("training.cycle.week").replace("{week}", String(week))} />
        <div className="cycle-intro">
          <span className="cycle-chip">{chip}</span>
          <h3 className="cycle-name">{block.meta.name}</h3>
          <p className="cycle-desc">{block.meta.description}</p>
        </div>
      </div>

      <div className="cycle-stats">
        <div>
          <span>{t("training.cycle.consistency")}</span>
          <strong>{doneSessions}<small> /{plannedSessions} {t(plannedSessions === 1 ? "training.cycle.sessionOne" : "training.cycle.sessions").replace("{count}", "")}</small></strong>
        </div>
        <div>
          <span>{t("training.cycle.duration")}</span>
          <strong>{doneMinutes > 0 ? fmtMinutes(doneMinutes) : "0"}<small> /{fmtMinutes(targetMinutes)}</small></strong>
        </div>
      </div>

      <div className="cycle-weeks">
        {block.weeks.map((week) => (
          <WeekRow week={week} currentWeek={currentWeek} selectedWeek={selectedWeek} sessions={sessionsByWeek[week.plan.week] || []} t={t} key={week.plan.week} />
        ))}
      </div>
    </div>
  );
}
