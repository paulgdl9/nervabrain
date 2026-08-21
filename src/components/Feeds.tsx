"use client";

import { Rss, Trash2, RefreshCw, Plus } from "lucide-react";
import { addFeedAction, removeFeedAction, toggleFeedsAction, refreshFeedsAction } from "@/app/actions";
import type { FeedsConfig } from "@/lib/vault";
import { useLanguage } from "@/components/LanguageProvider";

function feedHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatRun(value: string, locale: "fr" | "en", never: string) {
  if (!value) return never;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function FeedsManager({ config }: { config: FeedsConfig }) {
  const { locale, t } = useLanguage();
  const pollMinutes = Number(process.env.RSS_POLL_MINUTES ?? 30);

  return (
    <div className="feeds-manager">
      <section className="panel">
        <div className="panel-header">
          <h2>{t("feeds.status")}</h2>
          <div className="panel-actions">
            <form action={toggleFeedsAction}>
              <input type="hidden" name="enabled" value={config.enabled ? "false" : "true"} />
              <button className={`button ${config.enabled ? "secondary" : "primary"}`} type="submit">
                {config.enabled ? t("feeds.pause") : t("feeds.enable")}
              </button>
            </form>
            <form action={refreshFeedsAction}>
              <button className="button primary" type="submit">
                <RefreshCw size={15} aria-hidden />
                {t("feeds.refresh")}
              </button>
            </form>
          </div>
        </div>
        <p className="muted">
          {t("feeds.autoFetch")} <strong>{config.enabled ? t("feeds.on") : t("feeds.paused")}</strong>
          {` · ${pollMinutes > 0 ? t("feeds.pollsEvery").replace("{count}", String(pollMinutes)) : t("feeds.schedulerDisabled")}`}
          {` · ${t("feeds.lastRun")} `}
          {formatRun(config.lastRun, locale, t("feeds.never"))}
          {config.lastRun ? ` · ${config.lastCount} ${t("feeds.newItems")}` : ""}
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>{t("feeds.addTitle")}</h2>
        </div>
        <form action={addFeedAction} className="form compact-form">
          <div className="field-row">
            <label className="wide-field">
              {t("feeds.url")}
              <input name="url" type="url" placeholder="https://example.com/feed" required />
            </label>
            <button className="button primary" type="submit">
              <Plus size={15} aria-hidden />
              {t("feeds.add")}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>{t("feeds.list")} ({config.feeds.length})</h2>
        </div>
        {config.feeds.length === 0 ? (
          <p className="muted">{t("feeds.none")}</p>
        ) : (
          <ul className="feed-list">
            {config.feeds.map((url) => (
              <li className="feed-row" key={url}>
                <Rss size={15} className="feed-icon" aria-hidden />
                <div className="feed-meta">
                  <span className="feed-host">{feedHost(url)}</span>
                  <a className="feed-url muted" href={url} target="_blank" rel="noreferrer">
                    {url}
                  </a>
                </div>
                <form action={removeFeedAction}>
                  <input type="hidden" name="url" value={url} />
                  <button className="icon-button" type="submit" title={t("feeds.remove")} aria-label={`${t("feeds.remove")} ${url}`}>
                    <Trash2 size={15} aria-hidden />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
