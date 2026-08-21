"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BriefView } from "@/components/BriefView";
import { BriefFeedback, type BriefFeedbackValue } from "@/components/BriefFeedback";
import { BriefSuggestions } from "@/components/BriefSuggestions";
import type { BriefSuggestion } from "@/lib/brief-suggestions";
import { useLanguage } from "@/components/LanguageProvider";

export type DailyBrief = {
  id: string;
  path: string;
  date: string;
  href: string;
  content: string;
  feedback: BriefFeedbackValue;
  feedbackReason: string;
  suggestions: BriefSuggestion[];
};

function parseDate(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtLong(value: string, locale: "fr" | "en") {
  const d = parseDate(value);
  if (!d) return value;
  const s = d.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtRel(value: string, locale: "fr" | "en", labels: { brief: string; today: string; yesterday: string; daysAgo: string }) {
  const d = parseDate(value);
  if (!d) return labels.brief;
  const today = new Date();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const ref = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((ref.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return labels.today;
  if (diff === 1) return labels.yesterday;
  if (diff > 1 && diff < 7) return labels.daysAgo.replace("{count}", String(diff));
  return d.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { year: "numeric", month: "short" });
}

function sectionCount(content: string) {
  // Count every heading except the brief's own title, so a note written with
  // `##` sections is not reported as having none.
  return Math.max((content.match(/^#{1,3}\s+/gm) || []).length - 1, 0);
}

export function DailyWorkspace({ briefs }: { briefs: DailyBrief[] }) {
  const [selected, setSelected] = useState(briefs[0]?.id ?? "");
  const { locale, t } = useLanguage();
  const dateLabels = { brief: t("daily.brief"), today: t("common.today"), yesterday: t("common.yesterday"), daysAgo: t("common.daysAgo") };

  if (!briefs.length) {
    return (
      <section className="card">
        <div className="dash-empty">{t("daily.none")}</div>
      </section>
    );
  }

  const current = briefs.find((b) => b.id === selected) ?? briefs[0];

  return (
    <div className="daily-layout">
      <aside className="card daily-list-card">
        <div className="card-head">
          <div>
            <span className="card-eyebrow">{t("common.archive")}</span>
            <h2>{briefs.length} {t("daily.briefs")}</h2>
          </div>
        </div>
        <div className="daily-list">
          {briefs.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`daily-item${b.id === current.id ? " is-active" : ""}`}
              onClick={() => setSelected(b.id)}
            >
              <span className="daily-item-date">{fmtLong(b.date, locale)}</span>
              <span className="daily-item-meta">{fmtRel(b.date, locale, dateLabels)} · {sectionCount(b.content)} {t("daily.sections")}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="card daily-main brief-flat">
        <div className="card-head">
          <div>
            <span className="card-eyebrow">{fmtRel(current.date, locale, dateLabels)}</span>
            <h2>{fmtLong(current.date, locale)}</h2>
          </div>
          <Link className="card-link" href={current.href}>
            {t("common.openNote")} <ArrowUpRight size={14} aria-hidden />
          </Link>
        </div>
        <BriefView content={current.content} />
        <BriefSuggestions key={`${current.path}-suggestions`} path={current.path} initial={current.suggestions} />
        <BriefFeedback
          key={current.path}
          path={current.path}
          initialVerdict={current.feedback}
          initialReason={current.feedbackReason}
        />
      </section>
    </div>
  );
}
