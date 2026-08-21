"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { generateTrailCoachDecisionAction } from "@/app/actions";
import { useLanguage } from "@/components/LanguageProvider";
import { fmtKm, fmtPace } from "@/lib/trail-format";
import type { TranslationKey } from "@/lib/i18n";
import type { TrailActivity, TrailCoachDecision } from "@/lib/trail";

// The bridge classifies why no engine answered; anything else keeps the raw
// message, which is still more precise than a blanket failure string.
const AI_ERROR_KEYS: Record<string, TranslationKey> = {
  quota: "ai.error.quota",
  auth: "ai.error.auth",
  timeout: "ai.error.timeout",
  unavailable: "ai.error.unavailable",
};

export function CoachDecisionCard({ decision, fallback, lastRun = null, stale = false, running = false }: { decision: TrailCoachDecision | null; fallback: string[]; lastRun?: TrailActivity | null; stale?: boolean; running?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const { locale, t } = useLanguage();
  const items = decision?.decisions.length ? decision.decisions : fallback;
  // An analysis takes minutes and the click state lives only in this component,
  // so a reload used to look as if nothing had been launched. `running` comes
  // from the server and survives that reload.
  const busy = pending || running;

  return (
    <section className="trail-card coaching-card">
      <div className="trail-card-head">
        <div>
          <span className="trail-card-kicker">{t("training.coach.weeklyDecision")}</span>
          <h2>
            {t("training.coaching.title")}
            {busy ? <span className="coach-stale-badge">{t("training.coach.analysisPending")}</span>
              : stale ? <span className="coach-stale-badge">{t("training.coach.outdated")}</span>
              : null}
          </h2>
        </div>
        <ShieldCheck size={18} aria-hidden />
      </div>
      {lastRun ? (
        <div className="coach-lastrun">
          <div className="coach-lastrun-head">
            <span>{t("training.coach.lastRun")}</span>
            <strong>{lastRun.name}</strong>
            <small>{new Date(`${lastRun.date}T00:00:00`).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" })}</small>
          </div>
          <div className="coach-lastrun-metrics">
            <div><span>{t("training.coach.distance")}</span><strong>{fmtKm(lastRun.km, 1, locale)}</strong></div>
            <div><span>{t("training.coach.pace")}</span><strong>{lastRun.paceSPerKm ? fmtPace(lastRun.paceSPerKm) : "—"}</strong></div>
            <div><span>{t("training.coach.heartRate")}</span><strong>{lastRun.hr ? `${lastRun.hr} bpm` : "—"}</strong></div>
            <div><span>D+</span><strong>{Math.round(lastRun.dplus)} m</strong></div>
          </div>
        </div>
      ) : null}
      {decision ? <p className="coach-summary">{decision.summary}</p> : <p className="coach-summary">{t("training.coach.provisional")}</p>}
      <ul>{items.map((item) => <li key={item}><span /><p>{item}</p></li>)}</ul>
      {decision?.evidence.length ? (
        <details className="coach-evidence">
          <summary>{t("training.coach.evidence")}</summary>
          <ul>{decision.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
        </details>
      ) : null}
      {decision ? <div className="coach-next"><span>{t("training.coach.nextAction")}</span><strong>{decision.nextAction}</strong></div> : null}
      <div className="coach-actions">
        <button className="button secondary" type="button" disabled={busy} onClick={() => {
          setError("");
          startTransition(async () => {
            const result = await generateTrailCoachDecisionAction();
            if (!result.ok) {
              const key = result.code ? AI_ERROR_KEYS[result.code] : undefined;
              return setError(key ? t(key) : result.error);
            }
            router.refresh();
          });
        }}>
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} aria-hidden />
          {busy ? t("training.coach.analyzing") : decision ? t("training.coach.rerun") : t("training.coach.run")}
        </button>
        {decision ? <small>{new Date(decision.generatedAt).toLocaleString(locale)} · {decision.engine}</small> : null}
      </div>
      {error ? <p className="coach-error" role="alert">{error}</p> : null}
      <div className="coaching-rule"><ShieldCheck size={17} /><p><strong>{t("training.coach.safetyRule")}</strong>{t("training.coach.safetyText")}</p></div>
    </section>
  );
}
