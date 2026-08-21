"use client";

import {
  AlertTriangle,
  GraduationCap,
  HelpCircle,
  History,
  Link2,
  ListChecks,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { MarkdownView } from "@/components/MarkdownView";
import { useLanguage } from "@/components/LanguageProvider";
import { sanitizeBriefOutput } from "@/lib/markdown";

type BriefDay = {
  title: string;
  intro: string;
  sections: BriefSection[];
};

type BriefSection = {
  title: string;
  titleKey: string;
  body: string;
  tone: string;
  Icon: LucideIcon;
  label: string;
  priority: number;
};

export function BriefView({ content, compact = false }: { content: string; compact?: boolean }) {
  const { t } = useLanguage();
  const visibleContent = sanitizeBriefOutput(content);
  const days = parseDailyBrief(visibleContent);

  if (!days.length) {
    return <MarkdownView content={visibleContent} />;
  }

  const visibleDays = compact ? days.slice(0, 1) : days;

  return (
    <div className={`brief-view${compact ? " brief-view-compact" : ""}`}>
      {visibleDays.map((day) => (
        <article className="brief-day" key={day.title}>
          {day.intro && <MarkdownView content={day.intro} />}
          <div className="brief-section-grid">
            {(compact ? day.sections.slice(0, 4) : day.sections).map((section) => (
              <section
                className={`brief-section tone-${section.tone}`}
                key={`${day.title}-${section.title}`}
              >
                <div className="brief-section-top">
                  <span className="brief-section-icon">
                    {/* Keep the .nf wrapper: the tone color rules target
                        .brief-section-icon .nf, and SVG inherits currentColor. */}
                    <span className="nf" aria-hidden><section.Icon size={15} /></span>
                  </span>
                  <h3>{section.titleKey ? t(section.titleKey as Parameters<typeof t>[0]) : section.title}</h3>
                </div>
                {section.body ? <MarkdownView content={section.body} /> : <div className="empty small-empty">{t("common.empty")}</div>}
              </section>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function parseDailyBrief(content: string): BriefDay[] {
  const lines = content.split(/\r?\n/);
  const days: BriefDay[] = [];
  let currentDay: { title: string; intro: string[]; sections: Array<{ title: string; body: string[] }> } | null = null;
  let currentSection: { title: string; body: string[] } | null = null;

  function flushSection() {
    if (!currentDay || !currentSection) return;
    currentDay.sections.push(currentSection);
    currentSection = null;
  }

  function flushDay() {
    if (!currentDay) return;
    flushSection();
      days.push({
      title: cleanTitle(currentDay.title),
      intro: currentDay.intro.join("\n").trim(),
      sections: currentDay.sections
        .map((section) => {
          const title = cleanTitle(section.title);
          return {
            title,
            titleKey: sectionTitleKey(title),
            body: section.body.join("\n").trim(),
            tone: sectionTone(title),
            Icon: sectionIcon(title),
            label: sectionLabel(title),
            priority: sectionPriority(title),
          };
        })
        .sort((a, b) => a.priority - b.priority),
    });
    currentDay = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim() === "---" ? "" : rawLine;

    if (/^##\s+.*Daily Brief\b/i.test(line)) {
      flushDay();
      currentDay = { title: line.replace(/^##\s+/, "").trim(), intro: [], sections: [] };
      continue;
    }

    if (!currentDay) continue;

    if (/^###\s+/.test(line)) {
      flushSection();
      currentSection = { title: line.replace(/^###\s+/, "").trim(), body: [] };
      continue;
    }

    if (currentSection) {
      currentSection.body.push(line);
    } else {
      currentDay.intro.push(line);
    }
  }

  flushDay();
  return days;
}

function sectionTone(title: string) {
  const key = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (key.includes("connex")) return "blue";
  if (key.includes("task") || key.includes("tache")) return "green";
  if (key.includes("contradiction") || key.includes("blind") || key.includes("angle")) return "red";
  if (key.includes("learn") || key.includes("apprendre")) return "purple";
  if (key.includes("question")) return "amber";
  if (key.includes("follow") || key.includes("suivi")) return "neutral";
  return "default";
}

function sectionTitleKey(title: string): string {
  const key = normalized(title);
  if (key.includes("task") || key.includes("tache")) return "brief.section.tasks";
  if (key.includes("contradiction") || key.includes("blind") || key.includes("angle")) return "brief.section.blind";
  if (key.includes("connex")) return "brief.section.connections";
  if (key.includes("learn") || key.includes("apprendre")) return "brief.section.learn";
  if (key.includes("question")) return "brief.section.question";
  if (key.includes("follow") || key.includes("suivi")) return "brief.section.follow";
  return "";
}

function sectionLabel(title: string) {
  const key = normalized(title);
  if (key.includes("task") || key.includes("tache")) return "Exécution";
  if (key.includes("contradiction") || key.includes("blind") || key.includes("angle")) return "Attention";
  if (key.includes("connex")) return "Synthèse";
  if (key.includes("learn") || key.includes("apprendre")) return "Progression";
  if (key.includes("question")) return "Réflexion";
  if (key.includes("follow") || key.includes("suivi")) return "Contexte";
  return "Brief";
}

function sectionPriority(title: string) {
  const key = normalized(title);
  if (key.includes("task") || key.includes("tache")) return 0;
  if (key.includes("contradiction") || key.includes("blind") || key.includes("angle")) return 1;
  if (key.includes("follow") || key.includes("suivi")) return 2;
  if (key.includes("connex")) return 3;
  if (key.includes("learn") || key.includes("apprendre")) return 4;
  if (key.includes("question")) return 5;
  return 10;
}

function sectionIcon(title: string): LucideIcon {
  const key = normalized(title);

  if (key.includes("connex")) return Link2;
  if (key.includes("task") || key.includes("tache")) return ListChecks;
  if (key.includes("contradiction") || key.includes("blind") || key.includes("angle")) return AlertTriangle;
  if (key.includes("learn") || key.includes("apprendre")) return GraduationCap;
  if (key.includes("question")) return HelpCircle;
  if (key.includes("follow") || key.includes("suivi")) return History;
  return Sparkles;
}

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function cleanTitle(value: string) {
  return value
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\uFE0F?/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
