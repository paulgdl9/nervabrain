"use client";

import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Rss } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { runFeedDigestAction } from "@/app/actions";
import { useLanguage } from "@/components/LanguageProvider";
import type { FeedDigest, FeedDigestProfile } from "@/lib/vault";

function digestIsStale(profile: FeedDigestProfile, digest?: FeedDigest) {
  if (!digest?.generatedAt || profile.cadence === "manual") return false;
  const generated = new Date(digest.generatedAt).getTime();
  if (!Number.isFinite(generated)) return false;
  const maxAgeHours = profile.cadence === "multiple_daily" ? 12 : profile.cadence === "daily" ? 36 : 216;
  return Date.now() - generated > maxAgeHours * 60 * 60 * 1000;
}

function safeDate(value: string, locale: "fr" | "en", withTime = false) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date);
}

function DigestRefreshButton() {
  const { pending } = useFormStatus();
  const { t } = useLanguage();
  return (
    <button type="submit" className="rss-digest-refresh" disabled={pending}>
      <RefreshCw size={13} className={pending ? "is-spinning" : ""} aria-hidden />
      {pending ? t("rssWidget.running") : t("rssWidget.retry")}
    </button>
  );
}

export function FeedDigestCarousel({ profile, digest }: { profile: FeedDigestProfile; digest?: FeedDigest }) {
  const { locale, t } = useLanguage();
  const [index, setIndex] = useState(0);
  const items = digest?.items || [];
  const visibleIndex = items.length ? Math.min(index, items.length - 1) : 0;
  const item = items[visibleIndex];
  const stale = digestIsStale(profile, digest);

  function step(direction: -1 | 1) {
    if (items.length < 2) return;
    setIndex((current) => (Math.min(current, items.length - 1) + direction + items.length) % items.length);
  }

  return (
    <section className="rss-digest-card" aria-label={profile.title}>
      <header className="rss-digest-head">
        <div>
          <span className="rss-digest-kicker"><Rss size={13} aria-hidden />{digest?.engine && digest.engine !== "none" ? digest.engine : t("rssWidget.aiDigest")}</span>
          <h2>{profile.title}</h2>
        </div>
        <div className="rss-digest-state">
          {digest?.partial ? <span className="is-warning">{t("rssWidget.partial")}</span> : null}
          {stale ? <span className="is-warning">{t("rssWidget.stale")}</span> : null}
          {digest?.generatedAt ? <small>{t("rssWidget.generated")} {safeDate(digest.generatedAt, locale, true)}</small> : null}
        </div>
      </header>

      {digest?.overview ? <p className="rss-digest-overview">{digest.overview}</p> : null}
      {digest?.error ? <p className="rss-digest-error">{t("rssWidget.unavailable")}</p> : null}
      {digest?.warning ? <p className="rss-digest-warning">{t("rssWidget.partialWarning")}</p> : null}

      {item ? (
        <article className="rss-digest-article" aria-live="polite">
          <div className="rss-digest-article-meta">
            <span>{item.source}</span>
            {item.published ? <time dateTime={item.published}>{safeDate(item.published, locale)}</time> : null}
          </div>
          <h3>{item.title}</h3>
          <p>{item.summary}</p>
          {item.whyItMatters ? <aside><strong>{t("rssWidget.whyItMatters")}</strong><p>{item.whyItMatters}</p></aside> : null}
          <a href={item.url} target="_blank" rel="noreferrer">{t("rssWidget.openArticle")}<ExternalLink size={13} aria-hidden /></a>
        </article>
      ) : (
        <div className="rss-digest-empty">
          <Rss size={22} aria-hidden />
          <p>{digest?.error ? t("rssWidget.unavailable") : t("rssWidget.empty")}</p>
        </div>
      )}

      <footer className="rss-digest-footer">
        <form action={runFeedDigestAction}>
          <input type="hidden" name="id" value={profile.id} />
          <DigestRefreshButton />
        </form>
        {items.length ? (
          <div className="rss-digest-pagination">
            <span>{visibleIndex + 1} / {items.length}</span>
            <button type="button" onClick={() => step(-1)} disabled={items.length < 2} aria-label={t("rssWidget.previous")}><ChevronLeft size={16} /></button>
            <button type="button" onClick={() => step(1)} disabled={items.length < 2} aria-label={t("rssWidget.next")}><ChevronRight size={16} /></button>
          </div>
        ) : null}
      </footer>
    </section>
  );
}

export function FeedDigestPreview({ digest }: { digest?: FeedDigest }) {
  const { t } = useLanguage();
  const count = digest?.items.length || 0;
  return (
    <div className="dashboard-preview-rss">
      <Rss size={18} aria-hidden />
      <strong>{count}</strong>
      <span>{count === 1 ? t("rssWidget.article") : t("rssWidget.articles")}</span>
      <i /><i /><i />
    </div>
  );
}
