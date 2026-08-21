"use client";

import Link from "next/link";
import { BookOpenText, BrainCircuit, CalendarDays, Link2, ListChecks, Sparkles } from "lucide-react";
import { configureRevisionProgramAction } from "@/app/actions";
import { useLanguage } from "@/components/LanguageProvider";
import type { RevisionSetupData } from "@/lib/radio";

function editHref(relativePath: string) {
  return `/edit/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

export function RevisionSetup({ data }: { data: RevisionSetupData }) {
  const { t } = useLanguage();
  return (
    <div className="radio-shell revision-setup">
      <header className="revision-setup-hero">
        <p className="radio-overline"><Sparkles size={15} /> {t("radio.setup.eyebrow")}</p>
        <h1>{t("radio.setup.title")}</h1>
        <p>{t("radio.setup.description")}</p>
      </header>

      <section className="revision-setup-card">
        <div className="revision-setup-heading">
          <CalendarDays size={20} />
          <div><h2>{t("radio.setup.program")}</h2><p>{t("radio.setup.programHint")}</p></div>
        </div>
        <form action={configureRevisionProgramAction} className="revision-setup-form">
          <label>
            <span>{t("radio.setup.name")}</span>
            <input name="title" type="text" maxLength={160} defaultValue={data.title} placeholder={t("radio.setup.namePlaceholder")} required />
          </label>
          <label>
            <span>{t("radio.setup.deadline")}</span>
            <input name="examDate" type="date" defaultValue={data.examDate} required />
          </label>
          <label className="revision-setup-modules">
            <span>{t("radio.setup.subjects")}</span>
            <textarea name="modules" rows={4} defaultValue={data.moduleLabels.join("\n")} placeholder={t("radio.setup.subjectsPlaceholder")} required />
            <small>{t("radio.setup.subjectsHint")}</small>
          </label>
          <button type="submit"><Sparkles size={16} /> {t("radio.setup.save")}</button>
        </form>
      </section>

      {data.modules.length ? (
        <section className="revision-setup-sources">
          <div className="revision-setup-heading">
            <BookOpenText size={20} />
            <div><h2>{t("radio.setup.addContent")}</h2><p>{t("radio.setup.readyHint")}</p></div>
          </div>
          <div className="revision-setup-module-list">
            {data.modules.map((module) => (
              <article key={module.id}>
                <h3>{module.label}</h3>
                <div>
                  <Link href={editHref(module.coursePath)}><BookOpenText size={15} /> {t("radio.setup.pasteCourse")}</Link>
                  <Link href={editHref(module.flashcardsPath)}><BrainCircuit size={15} /> {t("radio.setup.addCards")}</Link>
                  <Link href={editHref(module.quizPath)}><ListChecks size={15} /> {t("radio.setup.addQuiz")}</Link>
                  <Link href={editHref(module.sourcesPath)}><Link2 size={15} /> {t("radio.setup.addLinks")}</Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
