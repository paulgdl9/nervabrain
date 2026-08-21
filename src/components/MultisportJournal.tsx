"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Activity, Bike, ChevronLeft, ChevronRight, Dumbbell, Footprints, LoaderCircle, MessageSquareText, Mountain, Waves, X } from "lucide-react";
import { GarminResyncButton } from "@/components/GarminResyncButton";
import { useLanguage } from "@/components/LanguageProvider";
import { activityDiscipline, fmtDur, fmtPace, heartRateZoneDistribution, type ActivityDiscipline } from "@/lib/trail-format";
import type { TrailActivity, TrailFeedback } from "@/lib/trail";

const FEELINGS: TrailFeedback["feeling"][] = ["great", "good", "neutral", "hard"];

function SportIcon({ discipline, size = 16 }: { discipline: ActivityDiscipline; size?: number }) {
  if (discipline === "ride") return <Bike size={size} aria-hidden data-sport={discipline} />;
  if (discipline === "strength") return <Dumbbell size={size} aria-hidden data-sport={discipline} />;
  if (discipline === "run") return <Footprints size={size} aria-hidden data-sport={discipline} />;
  if (discipline === "swim") return <Waves size={size} aria-hidden data-sport={discipline} />;
  if (discipline === "hike") return <Mountain size={size} aria-hidden data-sport={discipline} />;
  return <Activity size={size} aria-hidden data-sport={discipline} />;
}

function formatDate(date: string, locale: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "short" });
}

export function MultisportJournal({
  activities,
  initialFeedback,
  currentWeek,
  initialWeek = currentWeek,
}: {
  activities: TrailActivity[];
  initialFeedback: TrailFeedback[];
  currentWeek: number;
  initialWeek?: number;
}) {
  const { locale, t } = useLanguage();
  const router = useRouter();
  const [feedback, setFeedback] = useState(initialFeedback);
  const [week, setWeek] = useState(initialWeek);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rpe, setRpe] = useState(5);
  const [pain, setPain] = useState(0);
  const [feeling, setFeeling] = useState<TrailFeedback["feeling"]>("good");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const number = useMemo(() => new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: 1 }), [locale]);

  function text(key: Parameters<typeof t>[0], values: Record<string, string | number> = {}) {
    return Object.entries(values).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), t(key));
  }

  function activityKindLabel(discipline: ActivityDiscipline) {
    if (discipline === "run") return t("training.sport.run");
    if (discipline === "ride") return t("training.sport.ride");
    if (discipline === "strength") return t("training.sport.strength");
    if (discipline === "swim") return t("training.sport.swim");
    if (discipline === "hike") return t("training.sport.hike");
    return t("training.sport.other");
  }

  function summary(activity: TrailActivity) {
    const parts = [fmtDur(activity.durS)];
    if (activity.km) parts.push(`${number.format(activity.km)} km`);
    if (activity.kind === "run" && activity.paceSPerKm) parts.push(fmtPace(activity.paceSPerKm));
    if (activity.kind === "ride" && activity.km && activity.durS) {
      parts.push(`${number.format(activity.km / (activity.durS / 3600))} km/h`);
    }
    if (activity.hr) parts.push(`${activity.hr} bpm`);
    if (activity.dplus) parts.push(text("training.metric.elevationValue", { value: Math.round(activity.dplus) }));
    if (activity.avgPower) parts.push(`${Math.round(activity.avgPower)} W`);
    if (activity.trainingLoad) parts.push(text("training.metric.loadValue", { value: Math.round(activity.trainingLoad) }));
    if (activity.kind === "run" && activity.aerobicTrainingEffect) {
      parts.push(text("training.metric.aerobicEffectValue", { value: number.format(activity.aerobicTrainingEffect) }));
    }
    return parts;
  }

  function coachComment(activity: TrailActivity, saved?: TrailFeedback) {
    const discipline = activityDiscipline(activity);
    if (saved?.pain && saved.pain > 3) return text("training.coach.pain", { pain: saved.pain });
    if (saved?.rpe && saved.rpe >= 8) return text("training.coach.highEffort", { rpe: saved.rpe });
    if (discipline === "strength") return t("training.coach.strength");
    if (discipline === "ride") return t(activity.durS >= 5400 ? "training.coach.longRide" : "training.coach.ride");
    if (discipline === "swim") return t("training.coach.swim");
    if (discipline === "hike") return t("training.coach.hike");
    const zones = heartRateZoneDistribution(activity);
    if (zones) {
      if (zones.z2 >= 65) return text("training.coach.zone2Controlled", { percent: zones.z2 });
      if (zones.z3Plus !== null && zones.z3Plus > 35) return text("training.coach.zone3High", { percent: zones.z3Plus });
      if (zones.z1 !== null && zones.z1 + zones.z2 >= 65) return text("training.coach.zone1Easy", { z1: zones.z1, z2: zones.z2 });
      return text("training.coach.zoneMixed", { z2: zones.z2 });
    }
    if (activity.aerobicTrainingEffect && activity.aerobicTrainingEffect >= 3.5) {
      return text("training.coach.aerobicStimulus", { value: number.format(activity.aerobicTrainingEffect) });
    }
    return t("training.coach.default");
  }

  const feedbackById = useMemo(() => new Map(feedback.map((item) => [item.activityId, item])), [feedback]);
  const active = activities.find((activity) => activity.id === activeId) || null;
  const pendingCount = activities.filter((activity) => !feedbackById.has(activity.id)).length;
  const weekActivities = useMemo(() => activities.filter((activity) => activity.week === week), [activities, week]);
  const earliestWeek = useMemo(
    () => activities.reduce((min, activity) => Math.min(min, activity.week), currentWeek),
    [activities, currentWeek],
  );

  function open(activity: TrailActivity) {
    const saved = feedbackById.get(activity.id);
    setActiveId(activity.id);
    setRpe(saved?.rpe ?? 5);
    setPain(saved?.pain ?? 0);
    setFeeling(saved?.feeling ?? "good");
    setNote(saved?.note ?? "");
    setError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!active) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/trail/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activityId: active.id, rpe, pain, feeling, note }),
      });
      const result = await response.json() as { ok?: boolean; error?: string; feedback?: TrailFeedback };
      if (!response.ok || !result.feedback) throw new Error(result.error || t("training.feedback.saveError"));
      setFeedback((current) => [...current.filter((item) => item.activityId !== active.id), result.feedback as TrailFeedback]);
      setActiveId(null);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("training.feedback.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="trail-card activity-log-card">
      <div className="trail-card-head">
        <div>
          <span className="trail-card-kicker">{t("training.journal.kicker")}{pendingCount ? ` · ${pendingCount} ${t(pendingCount === 1 ? "training.journal.pendingOne" : "training.journal.pending")}` : ""}</span>
          <h2>{t("training.journal.title")}</h2>
        </div>
        <div className="journal-head-actions">
          <GarminResyncButton onError={setSyncError} />
        </div>
      </div>

      {syncError && <p className="feedback-error journal-sync-error">{syncError}</p>}
      <p className="feedback-intro">{t("training.journal.intro")}</p>

      <div className="cycle-nav">
        <button type="button" onClick={() => setWeek((value) => value - 1)} disabled={week <= earliestWeek} aria-label={t("training.journal.prevWeek")}>
          <ChevronLeft size={16} />
        </button>
        <span className="cycle-nav-title">{t("training.journal.week").replace("{week}", String(week))}{week === currentWeek && <small> · {t("training.journal.current")}</small>}</span>
        <button type="button" onClick={() => setWeek((value) => value + 1)} disabled={week >= currentWeek} aria-label={t("training.journal.nextWeek")}>
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="activity-log">
        {weekActivities.map((activity) => {
          const saved = feedbackById.get(activity.id);
          const discipline = activityDiscipline(activity);
          return (
            <button type="button" className="activity-log-row is-clickable" key={activity.id} onClick={() => open(activity)}>
              <span className={`sport-icon sport-${discipline}`}><SportIcon discipline={discipline} /></span>
              <div className="activity-log-name"><strong>{activity.name}</strong><small>{activityKindLabel(discipline)} · {formatDate(activity.date, locale)}</small></div>
              <div className="activity-log-data"><div className="activity-log-metrics">{summary(activity).slice(0, 4).map((metric) => <span key={metric}>{metric}</span>)}</div><p>{coachComment(activity, saved)}</p></div>
              <span className={`activity-feedback-status${saved ? " is-done" : ""}`}>{saved ? text("training.feedback.status", { rpe: saved.rpe, pain: saved.pain }) : t("training.feedback.rate")}</span>
            </button>
          );
        })}
        {!weekActivities.length && <p className="feedback-intro">{t("training.journal.emptyWeek")}</p>}
      </div>

      {/* Portalled to the body on purpose: .trail-card carries a backdrop-filter,
          which makes it the containing block for position:fixed descendants, so
          the sheet was sized and centred against the card (1392px tall) instead
          of the viewport and landed mostly off-screen on iOS. */}
      {active && createPortal((
        <div className="feedback-overlay" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
          <form className="feedback-sheet" onSubmit={submit}>
            <div className="feedback-sheet-head">
              <div>
                <span className="trail-card-kicker">{new Date(`${active.date}T00:00:00`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { weekday: "long", day: "numeric", month: "long" })}</span>
                <h2 id="feedback-title">{active.name}</h2>
              </div>
              <button className="feedback-close" type="button" onClick={() => setActiveId(null)} aria-label={t("common.close")}><X size={18} /></button>
            </div>

            {/* Only this middle band scrolls, so the save button stays anchored
                in view instead of sitting below the fold on a phone. */}
            <div className="feedback-sheet-body">
            <fieldset className="feedback-fieldset">
              <legend>{t("training.feedback.feeling")}</legend>
              <div className="feeling-options">
                {FEELINGS.map((option) => (
                  <button type="button" className={feeling === option ? "is-selected" : ""} onClick={() => setFeeling(option)} key={option}>{t(`training.feedback.feeling.${option}`)}</button>
                ))}
              </div>
            </fieldset>

            <div className="feedback-scales">
              <label>
                <span><b>{t("training.feedback.rpe")}</b><strong>{rpe}/10</strong></span>
                <input type="range" min="1" max="10" value={rpe} onChange={(event) => setRpe(Number(event.target.value))} />
                <small>{t("training.feedback.rpeMin")} <i /> {t("training.feedback.rpeMax")}</small>
              </label>
              <label>
                <span><b>{t("training.feedback.pain")}</b><strong className={pain > 3 ? "is-alert" : ""}>{pain}/10</strong></span>
                <input className="pain-range" type="range" min="0" max="10" value={pain} onChange={(event) => setPain(Number(event.target.value))} />
                <small>{t("training.feedback.painMin")} <i /> {t("training.feedback.painMax")}</small>
              </label>
            </div>

            {pain > 3 && <p className="feedback-warning">{t("training.feedback.painWarning")}</p>}

            <label className="feedback-note">
              <span>{t("training.feedback.note")} <small>{t("form.optional")}</small></span>
              <textarea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder={t("training.feedback.notePlaceholder")} />
            </label>
            </div>

            {error && <p className="feedback-error">{error}</p>}
            <button type="submit" className="trail-primary-action" disabled={saving}>
              {saving ? <LoaderCircle className="is-spinning" size={17} /> : <MessageSquareText size={17} />}
              {saving ? t("training.feedback.saving") : t("training.feedback.save")}
            </button>
          </form>
        </div>
      ), document.body)}
    </section>
  );
}
