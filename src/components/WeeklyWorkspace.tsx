"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleDot,
  FileText,
  Hash,
  Lightbulb,
  type LucideIcon,
} from "lucide-react";
import { MarkdownView } from "@/components/MarkdownView";
import { BriefFeedback, type BriefFeedbackValue } from "@/components/BriefFeedback";
import { BriefSuggestions } from "@/components/BriefSuggestions";
import type { BriefSuggestion } from "@/lib/brief-suggestions";
import { useLanguage } from "@/components/LanguageProvider";
import { sanitizeBriefOutput } from "@/lib/markdown";

export type WeeklyReview = {
  id: string;
  path: string;
  week: string;
  start: string;
  end: string;
  href: string;
  content: string;
  feedback: BriefFeedbackValue;
  feedbackReason: string;
  suggestions: BriefSuggestion[];
};

type Section = { title: string; body: string; color: string; Icon: LucideIcon };

// Section tones are decoration, not data: they read the shared --chart-* ramp
// from globals.css so a colour scheme repaints the weekly review too. (The
// per-area colours in Tasks/Objectives stay literal hex — those are the user's
// own choices, persisted with the note.)
const GREEN = "var(--chart-2)";
const ORANGE = "var(--chart-3)";
const BLUE = "var(--chart-1)";
const PURPLE = "var(--chart-4)";
const RED = "var(--red)";
const GRAY = "var(--muted)";

function meta(title: string): { color: string; Icon: LucideIcon } {
  const k = title.toLowerCase();
  if (k.includes("scoreboard") || k.includes("score")) return { color: BLUE, Icon: BarChart3 };
  if (k.includes("completed") || k.includes("done")) return { color: GREEN, Icon: CheckCircle2 };
  if (k.includes("open") || k.includes("loop")) return { color: ORANGE, Icon: CircleDot };
  if (k.includes("thesis") || k.includes("emerging")) return { color: PURPLE, Icon: Lightbulb };
  if (k.includes("contradiction") || k.includes("risk") || k.includes("blind")) return { color: RED, Icon: AlertTriangle };
  if (k.includes("context")) return { color: GRAY, Icon: FileText };
  if (k.includes("next")) return { color: BLUE, Icon: ArrowRight };
  return { color: GRAY, Icon: Hash };
}

function parseSections(content: string): Section[] {
  const lines = content.split(/\r?\n/);
  const hasLevelThreeSections = lines.some((line) => /^###\s+\S/.test(line));
  const heading = hasLevelThreeSections ? /^###\s+(.*)/ : /^##\s+(.*)/;
  const out: { title: string; body: string[] }[] = [];
  let cur: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const match = line.match(heading);
    if (match) {
      if (cur) out.push(cur);
      cur = { title: match[1].trim(), body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ title: s.title, body: s.body.join("\n").trim(), ...meta(s.title) }));
}

function parseDate(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtRange(start: string, end: string, locale: "fr" | "en") {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s || !e) return "";
  const dateLocale = locale === "fr" ? "fr-FR" : "en-US";
  const sFmt = s.toLocaleDateString(dateLocale, { month: "short", day: "numeric" });
  const eFmt = e.toLocaleDateString(dateLocale, { month: "short", day: "numeric" });
  return `${sFmt} – ${eFmt}`;
}

function weekLabel(week: string, label: string) {
  const m = week.match(/W(\d+)/i);
  return m ? `${label} ${Number(m[1])}` : week;
}

export function WeeklyWorkspace({ reviews }: { reviews: WeeklyReview[] }) {
  const [selected, setSelected] = useState(reviews[0]?.id ?? "");
  const { locale, t } = useLanguage();

  if (!reviews.length) {
    return (
      <section className="card">
        <div className="dash-empty">{t("weekly.none")}</div>
      </section>
    );
  }

  const current = reviews.find((r) => r.id === selected) ?? reviews[0];
  const visibleContent = sanitizeBriefOutput(current.content);
  const sections = parseSections(visibleContent);

  return (
    <div className="daily-layout">
      <aside className="card daily-list-card">
        <div className="card-head">
          <div>
            <span className="card-eyebrow">{t("common.archive")}</span>
            <h2>{reviews.length} {t("weekly.reviews")}</h2>
          </div>
        </div>
        <div className="daily-list">
          {reviews.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`daily-item${r.id === current.id ? " is-active" : ""}`}
              onClick={() => setSelected(r.id)}
            >
              <span className="daily-item-date">{weekLabel(r.week, t("weekly.week"))}</span>
              <span className="daily-item-meta">{fmtRange(r.start, r.end, locale)}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="card daily-main">
        <div className="card-head">
          <div>
            <span className="card-eyebrow">{weekLabel(current.week, t("weekly.week"))}</span>
            <h2>{fmtRange(current.start, current.end, locale)}</h2>
          </div>
          <Link className="card-link" href={current.href}>
            {t("common.openNote")} <ArrowUpRight size={14} aria-hidden />
          </Link>
        </div>

        <div className="weekly-sections">
          {sections.map((s) => (
            <section className="weekly-section" key={s.title} style={{ "--tone": s.color } as React.CSSProperties}>
              <div className="weekly-section-head">
                <span className="weekly-section-icon"><s.Icon size={15} aria-hidden /></span>
                <h3>{s.title}</h3>
              </div>
              {s.body ? <MarkdownView content={s.body} /> : <div className="empty small-empty">{t("common.empty")}</div>}
            </section>
          ))}
          {!sections.length && <MarkdownView content={visibleContent} />}
        </div>
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
