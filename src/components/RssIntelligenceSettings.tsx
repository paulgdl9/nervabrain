"use client";

import { BrainCircuit, ChevronDown, Play, Plus, Power, Rss, Save, Trash2 } from "lucide-react";
import {
  removeFeedDigestProfileAction,
  removeFeedSourceAction,
  runFeedDigestAction,
  saveFeedDigestProfileAction,
  saveFeedSourceAction,
  toggleFeedsAction,
} from "@/app/actions";
import { useLanguage } from "@/components/LanguageProvider";
import type { FeedDigestCadence, FeedDigestProfile, FeedIntelligence, FeedSource } from "@/lib/vault";

const CADENCES: FeedDigestCadence[] = ["manual", "multiple_daily", "daily", "weekly"];

function topicsValue(source: FeedSource) {
  return source.topics.join(", ");
}

function ProfileFields({ profile, sources }: { profile?: FeedDigestProfile; sources: FeedSource[] }) {
  const { t } = useLanguage();
  const selected = new Set(profile?.sourceIds || []);
  const cadenceLabels: Record<FeedDigestCadence, string> = {
    manual: t("settings.rssCadenceManual"),
    multiple_daily: t("settings.rssCadenceMultipleDaily"),
    daily: t("settings.rssCadenceDaily"),
    weekly: t("settings.rssCadenceWeekly"),
  };

  return (
    <>
      {profile ? <input type="hidden" name="id" value={profile.id} /> : null}
      <div className="rss-profile-grid">
        <label className="is-wide">{t("settings.rssProfileTitle")}<input name="title" required maxLength={160} defaultValue={profile?.title || ""} /></label>
        <label>{t("settings.rssCadence")}
          <select name="cadence" defaultValue={profile?.cadence || "daily"}>
            {CADENCES.map((cadence) => <option value={cadence} key={cadence}>{cadenceLabels[cadence]}</option>)}
          </select>
        </label>
        <label>{t("settings.rssMaxItems")}<input name="maxItems" type="number" min="1" max="20" defaultValue={profile?.maxItems || 5} /></label>
        <label>{t("settings.rssLookback")}<input name="lookbackHours" type="number" min="1" max="720" defaultValue={profile?.lookbackHours || 48} /></label>
        <label className="is-wide">{t("settings.rssInstructions")}<textarea name="instructions" rows={4} maxLength={8000} defaultValue={profile?.instructions || ""} placeholder={t("settings.rssInstructionsHint")} /></label>
      </div>
      <fieldset className="rss-source-picker">
        <legend>{t("settings.rssSelectSources")}</legend>
        <p>{t("settings.rssAllSources")}</p>
        <div>
          {sources.map((source) => (
            <label key={source.id}>
              <input type="checkbox" name="sourceIds" value={source.id} defaultChecked={selected.has(source.id)} />
              <span>{source.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="rss-enabled-choice">
        <input type="checkbox" name="enabled" value="true" defaultChecked={profile?.enabled ?? true} />
        <span>{t("settings.rssProfileEnabled")}</span>
      </label>
    </>
  );
}

function ProfileEditor({ profile, sources }: { profile: FeedDigestProfile; sources: FeedSource[] }) {
  const { locale, t } = useLanguage();
  const formatDate = (value: string) => value
    ? new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : t("settings.rssNever");

  return (
    <details className="rss-profile-card">
      <summary>
        <span className={`rss-status-dot${profile.enabled ? " is-on" : ""}`} aria-hidden />
        <span><strong>{profile.title}</strong><small>{t("settings.rssLastRun")}: {formatDate(profile.lastRun)}</small></span>
        <span className="rss-profile-cadence">{profile.cadence === "multiple_daily" ? t("settings.rssCadenceMultipleDaily") : profile.cadence === "weekly" ? t("settings.rssCadenceWeekly") : profile.cadence === "manual" ? t("settings.rssCadenceManual") : t("settings.rssCadenceDaily")}</span>
        <ChevronDown size={16} aria-hidden />
      </summary>
      <form action={saveFeedDigestProfileAction} className="rss-profile-form">
        <ProfileFields profile={profile} sources={sources} />
        <div className="rss-run-meta">
          <span>{t("settings.rssNextDue")}: <strong>{formatDate(profile.nextDue)}</strong></span>
        </div>
        <div className="rss-profile-actions">
          <button className="button danger" type="submit" formAction={removeFeedDigestProfileAction} formNoValidate><Trash2 size={14} aria-hidden />{t("settings.rssDelete")}</button>
          <button className="button secondary" type="submit" formAction={runFeedDigestAction} formNoValidate><Play size={14} aria-hidden />{t("settings.rssRunNow")}</button>
          <button className="button primary" type="submit"><Save size={14} aria-hidden />{t("settings.rssSave")}</button>
        </div>
      </form>
    </details>
  );
}

export function RssIntelligenceSettings({ intelligence }: { intelligence: FeedIntelligence }) {
  const { t } = useLanguage();

  return (
    <div className="rss-intelligence-settings">
      <div className="rss-settings-toolbar">
        <div>
          <span className={`rss-status-dot${intelligence.enabled ? " is-on" : ""}`} aria-hidden />
          <strong>{intelligence.enabled ? t("feeds.on") : t("feeds.paused")}</strong>
          <small>{intelligence.sources.length} {t("settings.rssSources").toLocaleLowerCase()}</small>
        </div>
        <form action={toggleFeedsAction}>
          <input type="hidden" name="enabled" value={intelligence.enabled ? "false" : "true"} />
          <button className="button secondary" type="submit"><Power size={14} aria-hidden />{intelligence.enabled ? t("feeds.pause") : t("feeds.enable")}</button>
        </form>
      </div>

      <section className="rss-settings-subsection">
        <div className="rss-settings-subhead"><span><Rss size={16} aria-hidden /><strong>{t("settings.rssSources")}</strong></span><small>{intelligence.sources.length}</small></div>
        {intelligence.sources.length ? (
          <div className="rss-source-list">
            {intelligence.sources.map((source) => (
              <form action={saveFeedSourceAction} className="rss-source-row" key={source.id}>
                <input type="hidden" name="id" value={source.id} />
                <label>{t("settings.rssSourceLabel")}<input name="label" maxLength={120} defaultValue={source.label} required /></label>
                <label className="is-url">URL<input name="url" type="url" maxLength={2048} defaultValue={source.url} required /></label>
                <label>{t("settings.rssTopics")}<input name="topics" maxLength={720} defaultValue={topicsValue(source)} placeholder={t("settings.rssTopicsHint")} /></label>
                <label className="rss-enabled-choice is-compact"><input type="checkbox" name="enabled" value="true" defaultChecked={source.enabled} /><span>{t("settings.rssSourceEnabled")}</span></label>
                <div className="rss-source-actions">
                  <button className="icon-button" type="submit" aria-label={t("settings.rssSave")}><Save size={14} /></button>
                  <button className="icon-button is-danger" type="submit" formAction={removeFeedSourceAction} formNoValidate aria-label={t("settings.rssDelete")}><Trash2 size={14} /></button>
                </div>
                {intelligence.sourceState[source.id]?.error ? (
                  <p className="rss-source-error"><strong>{t("settings.rssSourceError")}</strong> {intelligence.sourceState[source.id].error}</p>
                ) : null}
              </form>
            ))}
          </div>
        ) : <p className="rss-settings-empty">{t("settings.rssNoSources")}</p>}

        <details className="rss-create-card">
          <summary><Plus size={15} aria-hidden />{t("settings.rssAddSource")}</summary>
          <form action={saveFeedSourceAction} className="rss-create-source-form">
            <label>{t("settings.rssSourceLabel")}<input name="label" maxLength={120} required /></label>
            <label>URL<input name="url" type="url" maxLength={2048} placeholder="https://example.com/feed.xml" required /></label>
            <label>{t("settings.rssTopics")}<input name="topics" maxLength={720} placeholder={t("settings.rssTopicsHint")} /></label>
            <label className="rss-enabled-choice"><input type="checkbox" name="enabled" value="true" defaultChecked /><span>{t("settings.rssSourceEnabled")}</span></label>
            <button className="button primary" type="submit"><Plus size={14} aria-hidden />{t("settings.rssAddSource")}</button>
          </form>
        </details>
      </section>

      <section className="rss-settings-subsection">
        <div className="rss-settings-subhead"><span><BrainCircuit size={16} aria-hidden /><strong>{t("settings.rssProfiles")}</strong></span><small>{intelligence.profiles.length}</small></div>
        {intelligence.profiles.length ? (
          <div className="rss-profile-list">{intelligence.profiles.map((profile) => <ProfileEditor profile={profile} sources={intelligence.sources} key={profile.id} />)}</div>
        ) : <p className="rss-settings-empty">{t("settings.rssNoProfiles")}</p>}
        <details className="rss-create-card">
          <summary><Plus size={15} aria-hidden />{t("settings.rssNewProfile")}</summary>
          <form action={saveFeedDigestProfileAction} className="rss-profile-form">
            <ProfileFields sources={intelligence.sources} />
            <div className="rss-profile-actions"><button className="button primary" type="submit"><BrainCircuit size={14} aria-hidden />{t("settings.rssCreate")}</button></div>
          </form>
        </details>
      </section>
    </div>
  );
}
