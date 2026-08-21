"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  Bike,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CornerDownRight,
  Clock3,
  Download,
  Dumbbell,
  Footprints,
  Gauge,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import {
  cancelTrainingSessionAction,
  moveTrainingSessionAction,
  undoTrainingOverrideAction,
  validateTrainingSessionAction,
} from "@/app/actions";
import { DifficultyBolts } from "@/components/DifficultyBolts";
import { useLanguage } from "@/components/LanguageProvider";
import { sessionDifficulty } from "@/lib/trail-difficulty";
import { activitySummary, fmtMinutes, sportLabel } from "@/lib/trail-format";
// Type-only: @/lib/trail reads the vault via node:fs. The per-day session
// plan arrives serialized from the server-side TrailWorkspace.
import type { PlannedSession, SportKind, TrailActivity, TrailPlanAdjustment } from "@/lib/trail";

function translatedToday(value: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((result, [name, replacement]) => result.replaceAll(`{${name}}`, String(replacement)), value);
}

// <form action> requires (formData) => void | Promise<void>; the server
// actions return an { ok, error } result for callers that want it, so these
// discard it (the page revalidates on success; a modal-level toast is not
// wired here).
async function moveAction(formData: FormData) { await moveTrainingSessionAction(formData); }
async function cancelAction(formData: FormData) { await cancelTrainingSessionAction(formData); }
async function validateAction(formData: FormData) { await validateTrainingSessionAction(formData); }
async function undoAction(formData: FormData) { await undoTrainingOverrideAction(formData); }

export type PlanDisplaySession = PlannedSession & {
  rescheduledFromIso?: string;
  adjustmentReason?: string;
  adjustmentSource?: string;
  // Set when the session was actually recorded on a different day than planned:
  // the card has travelled here from its planned day (this ISO).
  movedFromIso?: string;
  // Manual overrides (T3a data layer; T3b renders the affordances). Set when
  // the athlete explicitly moved, cancelled, or manually validated this
  // session via a PlanOverride, as opposed to movedFromIso above (an inferred
  // relocation from a recorded activity).
  userMovedFromIso?: string;
  cancelledReason?: string;
  manualValidated?: boolean;
  // Assigned by the server-side one-to-one week matcher. DaySession must use
  // this id instead of looking up "any activity of the same sport", otherwise
  // one Garmin strength workout can complete several planned strength cards.
  matchedActivityId?: string;
};

export type PlanDay = {
  iso: string;
  week: number;
  label: string;
  sessions: PlanDisplaySession[];
  adjustments: TrailPlanAdjustment[];
};

function SportIcon({ sport, size = 18 }: { sport: SportKind; size?: number }) {
  if (sport === "run") return <Footprints size={size} aria-hidden />;
  if (sport === "ride") return <Bike size={size} aria-hidden />;
  if (sport === "strength") return <Dumbbell size={size} aria-hidden />;
  if (sport === "recovery") return <RefreshCw size={size} aria-hidden />;
  return <Activity size={size} aria-hidden />;
}

function shortDate(iso: string, locale: "fr" | "en") {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { weekday: "short", day: "2-digit", month: "short" });
}

function relativeDayLabel(index: number, todayIndex: number, t: ReturnType<typeof useLanguage>["t"]) {
  const delta = index - todayIndex;
  if (delta === 0) return t("training.day.today");
  if (delta === 1) return t("training.day.tomorrow");
  if (delta === 2) return t("training.day.afterTomorrow");
  if (delta === -1) return t("training.day.yesterday");
  return delta > 0 ? `J+${delta}` : `J${delta}`;
}

type SessionModal = "validate" | "move" | "cancel" | null;

function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

function weekdayOfIso(iso: string): number {
  return (new Date(`${iso}T00:00:00`).getDay() + 6) % 7;
}

function SessionMenu({ session, week, dayIso, activities, claimedActivityIds, hasOverride }: { session: PlanDisplaySession; week: number; dayIso: string; activities: TrailActivity[]; claimedActivityIds: Set<string>; hasOverride: boolean }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<SessionModal>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div className="session-menu-root" ref={rootRef}>
      <button type="button" className="session-menu-button" aria-label={t("training.session.actions")} onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal size={16} aria-hidden />
      </button>
      {open && (
        <div className="session-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setModal("validate"); setOpen(false); }}>{t("training.session.validate")}…</button>
          <button type="button" role="menuitem" onClick={() => { setModal("move"); setOpen(false); }}>{t("training.session.move")}…</button>
          <button type="button" role="menuitem" onClick={() => { setModal("cancel"); setOpen(false); }}>{t("training.session.cancel")}…</button>
          {hasOverride && (
            <form action={undoAction}>
              <input type="hidden" name="session_id" value={session.id} />
              <button type="submit" role="menuitem" className="is-undo" onClick={() => setOpen(false)}>{t("training.session.restore")}</button>
            </form>
          )}
        </div>
      )}
      {modal && (
        <ModalPortal>
          {modal === "validate" && <ValidateModal session={session} week={week} activities={activities} claimedActivityIds={claimedActivityIds} onClose={() => setModal(null)} />}
          {modal === "move" && <MoveModal session={session} week={week} dayIso={dayIso} onClose={() => setModal(null)} />}
          {modal === "cancel" && <CancelModal session={session} week={week} onClose={() => setModal(null)} />}
        </ModalPortal>
      )}
    </div>
  );
}

function ValidateModal({ session, week, activities, claimedActivityIds, onClose }: { session: PlanDisplaySession; week: number; activities: TrailActivity[]; claimedActivityIds: Set<string>; onClose: () => void }) {
  const { locale, t } = useLanguage();
  const weekActivities = activities.filter((activity) => activity.week === week && (!claimedActivityIds.has(activity.id) || activity.id === session.matchedActivityId));
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="modal-dialog validate-session-dialog" action={validateAction} role="dialog" aria-modal="true" aria-labelledby="validate-session-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={onClose}>
        <input type="hidden" name="session_id" value={session.id} />
        <input type="hidden" name="week" value={week} />
        <h3 id="validate-session-title">{t("training.session.validateTitle")}</h3>
        <p className="muted">{t("training.session.validateHint")}</p>
        <div className="validate-activity-list">
          <label className="validate-activity-option">
            <input type="radio" name="activity_id" value="" defaultChecked />
            <span className="validate-activity-icon"><Check size={16} aria-hidden /></span>
            <span className="validate-activity-copy"><strong>{t("training.session.validateWithoutActivity")}</strong></span>
          </label>
          {weekActivities.map((activity) => (
            <label className="validate-activity-option" key={activity.id}>
              <input type="radio" name="activity_id" value={activity.id} />
              <span className={`validate-activity-icon sport-${activity.kind}`}><SportIcon sport={activity.kind} size={16} /></span>
              <span className="validate-activity-copy">
                <strong>{activity.name}</strong>
                <small>{shortDate(activity.date, locale)} · {activitySummary(activity, locale).join(" · ")}</small>
              </span>
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>{t("common.close")}</button>
          <button type="submit" className="button">{t("training.session.validate")}</button>
        </div>
      </form>
    </div>
  );
}

function MoveModal({ session, week, dayIso, onClose }: { session: PlanDisplaySession; week: number; dayIso: string; onClose: () => void }) {
  const { t } = useLanguage();
  const weekdayNames = [t("training.weekday.mon"), t("training.weekday.tue"), t("training.weekday.wed"), t("training.weekday.thu"), t("training.weekday.fri"), t("training.weekday.sat"), t("training.weekday.sun")];
  const currentWeekday = weekdayOfIso(dayIso);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="modal-dialog" action={moveAction} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()} onSubmit={onClose}>
        <input type="hidden" name="session_id" value={session.id} />
        <input type="hidden" name="week" value={week} />
        <h3>{t("training.session.moveTitle")}</h3>
        <p className="muted">{t("training.session.moveHint")}</p>
        <div className="move-day-picker">
          {weekdayNames.map((name, weekday) => (
            <label key={name} className={`move-day-chip${weekday === currentWeekday ? " is-disabled" : ""}`}>
              <input type="radio" name="to_weekday" value={weekday} disabled={weekday === currentWeekday} defaultChecked={weekday === (currentWeekday === 0 ? 1 : 0)} />
              <span>{name}</span>
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>{t("common.close")}</button>
          <button type="submit" className="button">{t("training.session.move")}</button>
        </div>
      </form>
    </div>
  );
}

function CancelModal({ session, week, onClose }: { session: PlanDisplaySession; week: number; onClose: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="modal-dialog" action={cancelAction} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()} onSubmit={onClose}>
        <input type="hidden" name="session_id" value={session.id} />
        <input type="hidden" name="week" value={week} />
        <h3>{t("training.session.cancelTitle")}</h3>
        <p className="muted">{t("training.session.cancelHint")}</p>
        <input type="text" name="reason" maxLength={240} placeholder={t("training.session.cancelReason")} required className="cancel-reason-input" />
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>{t("common.close")}</button>
          <button type="submit" className="button danger">{t("training.session.cancelTitle")}</button>
        </div>
      </form>
    </div>
  );
}

function DaySession({ session, activities, claimedActivityIds, dayIso, week }: { session: PlanDisplaySession; activities: TrailActivity[]; claimedActivityIds: Set<string>; dayIso: string; week: number }) {
  const { locale, t } = useLanguage();
  const [detailsOpen, setDetailsOpen] = useState(true);
  const matches = session.matchedActivityId
    ? activities.filter((activity) => activity.id === session.matchedActivityId)
    : [];
  const complete = matches.length > 0 || session.manualValidated;
  const cancelled = Boolean(session.cancelledReason);
  const hasOverride = Boolean(session.userMovedFromIso || session.cancelledReason || session.manualValidated);
  return (
    <article className={`today-session sport-border-${session.sport}${complete ? " is-complete" : ""}${cancelled ? " is-cancelled" : ""}`}>
      <div className="today-session-top">
        <span className={`sport-icon sport-${session.sport}`}><SportIcon sport={session.sport} /></span>
        <div className="today-session-title">
          <div className="today-session-meta">
            <span>{sportLabel(session.sport, locale)}</span>
            {session.optional && <span className="optional-label">{t("training.session.optional")}</span>}
            {session.rescheduledFromIso && <span className="optional-label is-rescheduled">{t("training.session.rescheduled")}</span>}
            {session.movedFromIso && <span className="optional-label is-rescheduled">{t("training.session.shifted")}</span>}
            {session.userMovedFromIso && <span className="optional-label is-rescheduled">{t("training.session.moved")}</span>}
          </div>
          <h3>{session.title}</h3>
          <p>{session.subtitle}</p>
        </div>
        <span className={`session-status${complete ? " is-done" : ""}${cancelled ? " is-cancelled" : ""}`}>
          {cancelled ? <X size={13} /> : complete ? <Check size={13} /> : <Circle size={10} />}
          {cancelled ? t("training.session.cancelled") : complete ? (session.manualValidated ? t("training.session.validated") : t("training.session.completed")) : t("training.session.todo")}
        </span>
        <SessionMenu session={session} week={week} dayIso={dayIso} activities={activities} claimedActivityIds={claimedActivityIds} hasOverride={hasOverride} />
      </div>
      <div className="session-prescription">
        <div><Clock3 size={15} /><span>{session.durationMin
          ? `${session.subtitle.includes("estim") ? "≈ " : ""}${fmtMinutes(session.durationMin)}`
          : session.sport === "recovery" ? t("training.session.rest") : t("training.session.freeDuration")}</span></div>
        <div><Gauge size={15} /><span>{session.intensity}</span></div>
        <div className="session-difficulty" title={t("training.session.difficulty")}><DifficultyBolts level={sessionDifficulty(session)} label={t("training.session.difficultyLevel").replace("{level}", String(sessionDifficulty(session)))} /></div>
        {!cancelled && ["run", "ride", "strength"].includes(session.sport) && (
          <div className="session-downloads">
            <a className="session-fit-download is-json" href={`/api/trail/workout?session=${encodeURIComponent(session.id)}&format=json`} download>
              <Download size={14} /> JSON
            </a>
            <a className="session-fit-download" href={`/api/trail/workout?session=${encodeURIComponent(session.id)}&format=fit`} download>
              <Download size={14} /> FIT
            </a>
          </div>
        )}
      </div>
      <button className="session-detail-toggle" type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((value) => !value)}><span>{detailsOpen ? t("training.session.hideDetails") : t("training.session.showDetails")}</span><ChevronDown size={15} /></button>
      {detailsOpen && <ol className="session-steps">
        {session.details.map((detail, index) => <li key={detail}><span>{index + 1}</span>{detail}</li>)}
      </ol>}
      {session.rescheduledFromIso && (
        <div className="session-adjustment">
          <CornerDownRight size={14} />
          <span>{translatedToday(t("training.session.rescheduledFrom"), { date: shortDate(session.rescheduledFromIso, locale) })} · {session.adjustmentReason}</span>
        </div>
      )}
      {session.movedFromIso && (
        <div className="session-adjustment">
          <CornerDownRight size={14} />
          <span>{translatedToday(t("training.session.plannedAndDone"), { date: shortDate(session.movedFromIso, locale) })}</span>
        </div>
      )}
      {session.userMovedFromIso && (
        <div className="session-adjustment">
          <CornerDownRight size={14} />
          <span>{translatedToday(t("training.session.movedFrom"), { date: shortDate(session.userMovedFromIso, locale) })}</span>
        </div>
      )}
      {session.manualValidated && (
        <div className="session-adjustment">
          <CornerDownRight size={14} />
          <span>{t("training.session.manuallyValidated")}</span>
        </div>
      )}
      {cancelled && (
        <div className="session-adjustment">
          <CornerDownRight size={14} />
          <span>{t("training.session.cancelled")} · {session.cancelledReason}</span>
        </div>
      )}
      {complete && matches.map((activity) => (
        <div className="session-result" key={activity.id}>
          <span>{t("training.session.done")}</span>
          <strong>{activitySummary(activity, locale).join(" · ")}</strong>
        </div>
      ))}
    </article>
  );
}

// The "session of the day" board, now browsable day by day with the arrows
// around the week badge. Defaults to today; the header keeps saying
// "Aujourd'hui" only when the shown day really is today.
export function TodayBoard({ days, todayIso, activities, weeksTotal, nextSession, currentWeek, selectedWeek, navigationOnly = false }: {
  days: PlanDay[];
  todayIso: string;
  activities: TrailActivity[];
  weeksTotal: number;
  nextSession: string;
  currentWeek: number;
  selectedWeek: number;
  navigationOnly?: boolean;
}) {
  const { locale, t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const todayIndex = Math.max(0, days.findIndex((day) => day.iso === todayIso));
  const todayWeekday = Math.max(0, todayIndex % 7);
  const selectedWeekStart = days.findIndex((day) => day.week === selectedWeek);
  const initialIndex = selectedWeek === currentWeek || selectedWeekStart < 0 ? todayIndex : selectedWeekStart + todayWeekday;
  const [index, setIndex] = useState(initialIndex);
  const day = days[Math.min(index, days.length - 1)];
  if (!day) return null;
  const isToday = day.iso === todayIso;
  const label = day.label.charAt(0).toUpperCase() + day.label.slice(1);
  const previousWeekIndex = index >= 7 ? index - 7 : -1;
  const nextWeekIndex = index + 7 < days.length ? index + 7 : -1;
  const dayName = relativeDayLabel(index, todayIndex, t);
  const nextTitle = (() => {
    for (let i = index + 1; i < days.length; i++) {
      const found = days[i].sessions.find((session) => !session.optional);
      if (found) return found.title;
    }
    return null;
  })();
  const claimedActivityIds = new Set(days.flatMap((item) => item.sessions.flatMap((session) => session.matchedActivityId ? [session.matchedActivityId] : [])));

  function navigate(nextIndex: number) {
    const safeIndex = Math.max(0, Math.min(days.length - 1, nextIndex));
    const nextWeek = days[safeIndex]?.week || currentWeek;
    setIndex(safeIndex);
    if (nextWeek === day.week) return;
    const params = new URLSearchParams(searchParams.toString());
    if (nextWeek === currentWeek) params.delete("week");
    else params.set("week", String(nextWeek));
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  const weekNavigation = (
    <div className="today-week-nav">
      <button type="button" onClick={() => previousWeekIndex >= 0 && navigate(previousWeekIndex)} disabled={previousWeekIndex < 0} aria-label={t("training.journal.prevWeek")}>
        <ChevronLeft size={16} />
      </button>
      <div className="today-week-badge"><span>{t("training.week")}</span><strong>{day.week}</strong><small>/ {weeksTotal}</small></div>
      <button type="button" onClick={() => nextWeekIndex >= 0 && navigate(nextWeekIndex)} disabled={nextWeekIndex < 0} aria-label={t("training.journal.nextWeek")}>
        <ChevronRight size={16} />
      </button>
    </div>
  );

  if (navigationOnly) return <div className="training-week-only-nav"><span>{t("training.displayedWeek")}</span>{weekNavigation}</div>;

  return (
    <section className="today-board">
      <div className="today-board-head">
        <div>
          <span className="today-label">
            <CalendarDays size={15} /> {isToday ? <>{t("training.day.today")} · {day.label}</> : label}
            {!isToday && (
              <button type="button" className="today-return" onClick={() => navigate(todayIndex)}>
                <Undo2 size={12} aria-hidden /> {t("training.day.today")}
              </button>
            )}
          </span>
          <div className="today-title-row">
            <h2>{isToday ? t("training.todaySession") : t("training.plannedSessions")}</h2>
            <div className="today-day-nav" aria-label={t("training.dayNavigation")}>
              <button type="button" onClick={() => navigate(index - 1)} disabled={index === 0} aria-label={t("training.previousDay")}>
                <ChevronLeft size={16} />
              </button>
              <div className="today-day-chip">
                <span>{dayName}</span>
                <strong>{shortDate(day.iso, locale)}</strong>
              </div>
              <button type="button" onClick={() => navigate(index + 1)} disabled={index === days.length - 1} aria-label={t("training.nextDay")}>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          <p>{day.sessions.length
            ? translatedToday(t(day.sessions.length === 1 ? "training.plannedBlockOne" : "training.plannedBlocks"), { count: day.sessions.length })
            : t("training.restDay")}</p>
        </div>
        <div className="today-nav">
          <div className="today-nav-label">{t("training.weekNavigation")}</div>
          {weekNavigation}
        </div>
      </div>
      {day.adjustments.length > 0 && (
        <div className="plan-adjustment-list">
          {day.adjustments.map((adjustment) => (
            <div className="plan-adjustment" key={adjustment.id}>
              <CornerDownRight size={14} />
              <span>
                {sportLabel(adjustment.sport, locale)} {adjustment.action === "cancel"
                  ? t("training.adjustment.cancelled")
                  : adjustment.toIso === day.iso
                    ? translatedToday(t("training.adjustment.rescheduledFrom"), { date: shortDate(adjustment.fromIso, locale) })
                    : adjustment.toIso
                      ? translatedToday(t("training.adjustment.movedTo"), { date: shortDate(adjustment.toIso, locale) })
                      : t("training.adjustment.toReschedule")}
                <small>{adjustment.sourceLabel} · {adjustment.reason}</small>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="today-session-grid">
        {day.sessions.length > 0 ? (
          day.sessions.map((session) => <DaySession session={session} activities={activities} claimedActivityIds={claimedActivityIds} dayIso={day.iso} week={day.week} key={session.id} />)
        ) : (
          <article className="today-session sport-border-recovery rest-card">
            <div className="today-session-top">
              <span className="sport-icon sport-recovery"><RefreshCw size={18} aria-hidden /></span>
              <div className="today-session-title">
                <div className="today-session-meta"><span>{t("training.sport.recovery")}</span></div>
                <h3>{t("training.session.rest")}</h3>
                <p>{t("training.activeRecovery")}</p>
              </div>
            </div>
            <ol className="session-steps">
              <li><span>1</span>{t("training.recovery.sleep")}</li>
              <li><span>2</span>{t("training.recovery.hydration")}</li>
              <li><span>3</span>{t("training.recovery.mobility")}</li>
              {nextTitle && <li><span>4</span>{t("training.recovery.prepare")}: {nextTitle}</li>}
            </ol>
          </article>
        )}
      </div>
      {isToday && (
        <div className="next-session-line"><Sparkles size={15} /><span>{t("training.day.tomorrow")}</span><strong>{nextSession.replace(/^.*? · /, "")}</strong></div>
      )}
    </section>
  );
}
