"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Activity, CalendarDays, Footprints, MapPin, Mountain, Sparkles } from "lucide-react";
import { generateTrainingPlanAction } from "@/app/actions";
import { CustomSelect } from "@/components/CustomSelect";
import { DatePicker } from "@/components/DatePicker";
import { useLanguage } from "@/components/LanguageProvider";
import {
  eventsForSport,
  trainingPlanStartISO,
  trainingWeeksAvailable,
  type EnduranceEvent,
  type EnduranceSport,
} from "@/lib/endurance-events";
import { todayISO } from "@/lib/dates";
import type { Locale, TranslationKey } from "@/lib/i18n";

const SPORT_ICONS = {
  run: <Footprints size={19} aria-hidden />,
  trail: <Mountain size={19} aria-hidden />,
};

type RunningSport = Extract<EnduranceSport, "run" | "trail">;

const ERROR_KEYS: Record<string, TranslationKey> = {
  sport: "sportSetup.errorSport",
  eventDate: "sportSetup.errorDate",
  pastDate: "sportSetup.errorPastDate",
  weeks: "sportSetup.errorSchedule",
  days: "sportSetup.errorSchedule",
  distance: "sportSetup.errorMeasurements",
  elevation: "sportSetup.errorMeasurements",
  weeklyVolume: "sportSetup.errorMeasurements",
  longestSession: "sportSetup.errorMeasurements",
  experience: "sportSetup.errorMeasurements",
  dateRange: "sportSetup.errorDate",
  generate: "sportSetup.error",
};

const PROGRESS_STEPS = [
  "sportSetup.progress.profile",
  "sportSetup.progress.course",
  "sportSetup.progress.structure",
  "sportSetup.progress.sessions",
  "sportSetup.progress.final",
] as const satisfies readonly TranslationKey[];

export function ObjectiveSetup({ onDone }: { onDone?: () => void }) {
  const { locale, t } = useLanguage();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [sport, setSport] = useState<RunningSport>("run");
  const [eventId, setEventId] = useState(() => eventsForSport("run", todayISO())[0]?.id || "custom");
  const [customTitle, setCustomTitle] = useState("");
  const [customDate, setCustomDate] = useState("");
  const [customDistance, setCustomDistance] = useState("");
  const [customElevation, setCustomElevation] = useState("0");
  const [weeksTotal, setWeeksTotal] = useState(12);
  const [progressStep, setProgressStep] = useState(0);
  const router = useRouter();

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => setProgressStep((current) => Math.min(PROGRESS_STEPS.length - 1, current + 1)), 1200);
    return () => window.clearInterval(timer);
  }, [pending]);

  const events = eventsForSport(sport, todayISO());
  const selectedEvent = events.find((event) => event.id === eventId);
  const eventDate = selectedEvent?.date || customDate;
  const availableWeeks = trainingWeeksAvailable(eventDate, todayISO());
  const maximumWeeks = availableWeeks || 52;
  const minimumWeeks = Math.min(4, maximumWeeks);
  const selectedWeeks = Math.max(minimumWeeks, Math.min(weeksTotal, maximumWeeks));
  const startDate = trainingPlanStartISO(eventDate, selectedWeeks);

  const eventOptions = [
    ...events.map((event) => ({
      value: event.id,
      label: event.name,
      hint: `${event.location[locale]} · ${event.distanceKm} km${event.elevationM ? ` · ${event.elevationM} ${t("sportSetup.elevationShort")}` : ""}`,
    })),
    { value: "custom", label: t("sportSetup.eventCustom"), hint: t("sportSetup.eventCustomHint") },
  ];

  function chooseSport(nextSport: RunningSport) {
    setSport(nextSport);
    const nextEvent = eventsForSport(nextSport, todayISO())[0];
    setEventId(nextEvent?.id || "custom");
    setCustomElevation(nextSport === "run" ? "0" : "");
  }

  function formatDate(value: string) {
    if (!value) return "—";
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${value}T00:00:00Z`));
  }

  return (
    <form
      className="objective-setup-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        setProgressStep(0);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await generateTrainingPlanAction(formData);
          if (!result?.ok) {
            setError(t(ERROR_KEYS[result?.error || "generate"] || "sportSetup.error"));
            return;
          }
          router.refresh();
          onDone?.();
        });
      }}
    >
      <header className="objective-setup-intro">
        <span className="objective-setup-icon"><Activity size={20} aria-hidden /></span>
        <div>
          <h2>{t("sportSetup.title")}</h2>
          <p>{t("sportSetup.description")}</p>
        </div>
      </header>

      <section className="objective-setup-step" aria-labelledby="sport-step-goal">
        <div className="objective-setup-step-heading">
          <span>1</span>
          <div>
            <h3 id="sport-step-goal">{t("sportSetup.goalTitle")}</h3>
            <p>{t("sportSetup.goalHint")}</p>
          </div>
        </div>

        <div className="objective-sport-grid" role="radiogroup" aria-label={t("sportSetup.sportLabel")}>
          {(["run", "trail"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={sport === value}
              className={`objective-sport-card ${sport === value ? "is-selected" : ""}`}
              onClick={() => chooseSport(value)}
            >
              <span>{SPORT_ICONS[value]}</span>
              <strong>{t(`sportSetup.sport.${value}`)}</strong>
              <small>{t(`sportSetup.sport.${value}Hint`)}</small>
            </button>
          ))}
        </div>
        <input type="hidden" name="sport" value={sport} />

        <label className="objective-setup-field">
          <span>{t("sportSetup.eventLabel")}</span>
          <CustomSelect name="event_catalog_id" options={eventOptions} value={eventId} onChange={setEventId} searchable searchPlaceholder={t("sportSetup.searchEvent")} />
        </label>

        {selectedEvent ? (
          <EventSummary event={selectedEvent} dateLabel={formatDate(selectedEvent.date)} sourceLabel={t("sportSetup.officialSource")} elevationLabel={t("sportSetup.elevationShort")} locale={locale} />
        ) : (
          <div className="objective-custom-event">
            <label className="objective-setup-field objective-setup-field-wide">
              <span>{t("sportSetup.eventName")}</span>
              <input name="title" value={customTitle} onChange={(event) => setCustomTitle(event.target.value)} placeholder={t("sportSetup.eventNamePlaceholder")} required />
            </label>
            <label className="objective-setup-field">
              <span>{t("sportSetup.eventDate")}</span>
              <DatePicker name="event_date" min={todayISO()} value={customDate} onChange={setCustomDate} locale={locale} placeholder={t("sportSetup.eventDate")} />
            </label>
            <label className="objective-setup-field">
              <span>{t("sportSetup.distance")}</span>
              <input name="event_distance_km" type="number" min="0.1" max="1000" step="0.1" value={customDistance} onChange={(event) => setCustomDistance(event.target.value)} placeholder="42.2" required />
            </label>
            <label className="objective-setup-field">
              <span>{t("sportSetup.elevation")}</span>
              <input name="event_elevation_m" type="number" min="0" max="20000" step="10" value={customElevation} onChange={(event) => setCustomElevation(event.target.value)} placeholder="0" required />
            </label>
          </div>
        )}

        {selectedEvent && (
          <>
            <input type="hidden" name="title" value={selectedEvent.name} />
            <input type="hidden" name="event_date" value={selectedEvent.date} />
            <input type="hidden" name="event_distance_km" value={selectedEvent.distanceKm} />
            <input type="hidden" name="event_elevation_m" value={selectedEvent.elevationM} />
          </>
        )}
      </section>

      <section className="objective-setup-step" aria-labelledby="sport-step-routine">
        <div className="objective-setup-step-heading">
          <span>2</span>
          <div>
            <h3 id="sport-step-routine">{t("sportSetup.routineTitle")}</h3>
            <p>{t("sportSetup.routineHint")}</p>
          </div>
        </div>
        <div className="objective-metric-grid">
          <label className="objective-setup-field">
            <span>{t("sportSetup.weeklyVolume")}</span>
            <input name="weekly_volume_km" type="number" min="0" max="1000" step="1" placeholder="30" required />
          </label>
          <label className="objective-setup-field">
            <span>{t("sportSetup.longestSession")}</span>
            <input name="longest_session_km" type="number" min="0" max="1000" step="0.1" placeholder="15" required />
          </label>
          <label className="objective-setup-field">
            <span>{t("sportSetup.frequency")}</span>
            <CustomSelect
              name="days_per_week"
              defaultValue="4"
              options={[2, 3, 4, 5, 6, 7].map((count) => ({
                value: String(count),
                label: t(count === 2 ? "sportSetup.frequency.two" : count === 3 ? "sportSetup.frequency.three" : count === 4 ? "sportSetup.frequency.four" : count === 5 ? "sportSetup.frequency.five" : count === 6 ? "sportSetup.frequency.six" : "sportSetup.frequency.seven"),
              }))}
            />
          </label>
          <label className="objective-setup-field">
            <span>{t("sportSetup.experience")}</span>
            <CustomSelect
              name="experience"
              defaultValue="first"
              options={(["first", "shorter", "similar", "several"] as const).map((value) => ({
                value,
                label: t(`sportSetup.experience.${value}`),
              }))}
            />
          </label>
        </div>
        <label className="objective-setup-field">
          <span>{t("sportSetup.reference")}</span>
          <input name="recent_reference" placeholder={t("sportSetup.referenceRunPlaceholder")} />
          <small>{t("sportSetup.optional")}</small>
        </label>
      </section>

      <section className="objective-setup-step" aria-labelledby="sport-step-plan">
        <div className="objective-setup-step-heading">
          <span>3</span>
          <div>
            <h3 id="sport-step-plan">{t("sportSetup.planTitle")}</h3>
            <p>{t("sportSetup.planHint")}</p>
          </div>
        </div>
        <div className="objective-plan-row">
          <label className="objective-setup-field">
            <span>{t("sportSetup.weeks")}</span>
            <input name="weeks_total" type="number" min={minimumWeeks} max={maximumWeeks} value={selectedWeeks} onChange={(event) => setWeeksTotal(Number(event.target.value))} required />
          </label>
          <div className="objective-start-date" aria-live="polite">
            <CalendarDays size={18} aria-hidden />
            <div>
              <small>{t("sportSetup.startDate")}</small>
              <strong>{formatDate(startDate)}</strong>
              <span>{t("sportSetup.startDateHint")}</span>
            </div>
          </div>
        </div>
        <label className="objective-setup-field">
          <span>{t("sportSetup.constraints")}</span>
          <textarea name="constraints" rows={3} placeholder={t("sportSetup.constraintsPlaceholder")} />
          <small>{t("sportSetup.optional")}</small>
        </label>
      </section>

      {error && <div className="form-error objective-setup-error" role="alert">{error}</div>}
      {pending ? (
        <div className="objective-generation-progress" role="status" aria-live="polite">
          <div className="objective-generation-head">
            <span className="objective-generation-orbit"><Sparkles size={16} aria-hidden /></span>
            <div><strong>{t("sportSetup.generating")}</strong><small>{t(PROGRESS_STEPS[progressStep])}</small></div>
            <span>{Math.min(94, 18 + progressStep * 19)}%</span>
          </div>
          <div className="objective-generation-track"><span style={{ width: `${Math.min(94, 18 + progressStep * 19)}%` }} /></div>
          <ol>{PROGRESS_STEPS.map((step, index) => <li className={index < progressStep ? "is-done" : index === progressStep ? "is-active" : ""} key={step}>{index < progressStep ? "✓" : index + 1}<span>{t(step)}</span></li>)}</ol>
        </div>
      ) : null}
      <button className="button primary objective-setup-submit" type="submit" disabled={pending || !startDate}>
        <Sparkles size={16} aria-hidden />
        {pending ? t("sportSetup.generating") : t("sportSetup.generate")}
      </button>
    </form>
  );
}

function EventSummary({ event, dateLabel, sourceLabel, elevationLabel, locale }: { event: EnduranceEvent; dateLabel: string; sourceLabel: string; elevationLabel: string; locale: Locale }) {
  return (
    <div className="objective-event-summary">
      <div><CalendarDays size={17} aria-hidden /><span>{dateLabel}</span></div>
      <div><MapPin size={17} aria-hidden /><span>{event.location[locale]}</span></div>
      <strong>{event.distanceKm} km{event.elevationM ? ` · ${event.elevationM.toLocaleString(locale)} ${elevationLabel}` : ""}</strong>
      <a href={event.sourceUrl} target="_blank" rel="noreferrer">{sourceLabel}</a>
    </div>
  );
}
