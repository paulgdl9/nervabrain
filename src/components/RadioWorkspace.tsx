"use client";

import Link from "next/link";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  BookOpenCheck,
  BrainCircuit,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  GraduationCap,
  ListChecks,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Target,
} from "lucide-react";
import { MarkdownView } from "@/components/MarkdownView";
import { useLanguage } from "@/components/LanguageProvider";
import type { RadioDashboardData, RadioDayPlan, RadioModule } from "@/lib/radio";

type MainView = "today" | "course" | "flashcards" | "quiz" | "planning";
type CourseView = "highYield" | "exhaustive" | "palace" | "recall";
type CardRating = "again" | "known";

type RadioProgress = {
  completed: string[];
  cards: Record<string, CardRating>;
  quiz: Record<string, { correct: boolean; selected: string[] }>;
};

const EMPTY_PROGRESS: RadioProgress = { completed: [], cards: {}, quiz: {} };
const MIXED_MODULE_ID = "mixed-daily-session";

function interleave<T>(groups: T[][]) {
  const result: T[] = [];
  const maxLength = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < maxLength; index += 1) {
    groups.forEach((group) => {
      const item = group[index];
      if (typeof item !== "undefined") result.push(item);
    });
  }
  return result;
}

function mergeModuleContent(modules: RadioModule[], key: "highYield" | "exhaustive" | "palace" | "recall") {
  return modules.map((module) => `# ${module.shortLabel}\n\n${module[key]}`).join("\n\n---\n\n");
}

function noteHref(relativePath: string) {
  return `/note/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function formatDate(date: string, locale: string, withYear = false) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: withYear ? "numeric" : undefined,
  });
}

function sameAnswers(selected: string[], answers: string[]) {
  return [...selected].sort().join("") === [...answers].sort().join("");
}

function moduleFor(plan: RadioDayPlan, modules: RadioModule[]) {
  return modules.find((module) => module.id === plan.moduleIds[0]) || modules[0];
}

export function RadioWorkspace({ data }: { data: RadioDashboardData }) {
  const { locale, t } = useLanguage();
  const [view, setView] = useState<MainView>("today");
  const [courseView, setCourseView] = useState<CourseView>("highYield");
  const [moduleId, setModuleId] = useState(data.todayPlan.moduleIds.length > 1 ? MIXED_MODULE_ID : data.todayPlan.moduleIds[0] || data.modules[0]?.id || "");
  const [progress, setProgress] = useState<RadioProgress>(EMPTY_PROGRESS);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const [cardRevealed, setCardRevealed] = useState(false);
  const [quizIndex, setQuizIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [validated, setValidated] = useState(false);

  useEffect(() => {
    try {
      const stored = [data.program.progressKey, ...data.program.legacyProgressKeys]
        .map((key) => window.localStorage.getItem(key))
        .find(Boolean);
      if (stored) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setProgress({ ...EMPTY_PROGRESS, ...(JSON.parse(stored) as RadioProgress) });
      }
    } catch {
      // Progress remains available for the current session if local storage is unavailable.
    } finally {
      setProgressLoaded(true);
    }
  }, [data.program.legacyProgressKeys, data.program.progressKey]);

  useEffect(() => {
    if (!progressLoaded) return;
    try {
      window.localStorage.setItem(data.program.progressKey, JSON.stringify(progress));
    } catch {
      // The study flow stays usable without persistence.
    }
  }, [data.program.progressKey, progress, progressLoaded]);

  const plannedModules = useMemo(() => {
    const planned = data.todayPlan.moduleIds
      .map((id) => data.modules.find((module) => module.id === id))
      .filter((module): module is RadioModule => Boolean(module));
    return planned.length ? planned : data.modules;
  }, [data.modules, data.todayPlan.moduleIds]);
  const mixedModule = useMemo<RadioModule | null>(() => {
    if (plannedModules.length < 2) return null;
    const first = plannedModules[0];
    return {
      id: MIXED_MODULE_ID,
      label: t("radio.mixedSession"),
      shortLabel: t("radio.mixedShort"),
      accent: "violet",
      exhaustive: mergeModuleContent(plannedModules, "exhaustive"),
      highYield: mergeModuleContent(plannedModules, "highYield"),
      flashcards: interleave(plannedModules.map((module) => module.flashcards)),
      quiz: interleave(plannedModules.map((module) => module.quiz)),
      palace: mergeModuleContent(plannedModules, "palace"),
      recall: mergeModuleContent(plannedModules, "recall"),
      sourcePaths: first.sourcePaths,
    };
  }, [plannedModules, t]);
  const availableModules = mixedModule ? [mixedModule, ...data.modules] : data.modules;
  const activeModule = moduleId === MIXED_MODULE_ID && mixedModule
    ? mixedModule
    : data.modules.find((module) => module.id === moduleId) || data.modules[0];
  const allCards = activeModule?.flashcards || [];
  const dueCards = allCards.filter((card) => progress.cards[card.id] !== "known");
  const cards = dueCards.length ? dueCards : allCards;
  const quiz = activeModule?.quiz || [];
  const currentCard = cards[cardIndex % Math.max(1, cards.length)];
  const currentQuestion = quiz[quizIndex % Math.max(1, quiz.length)];
  const knownCount = allCards.filter((card) => progress.cards[card.id] === "known").length;
  const dueCount = dueCards.length;
  const activeQuizIds = new Set(quiz.map((question) => question.id));
  const quizAttempts = Object.entries(progress.quiz).filter(([id]) => activeQuizIds.has(id));
  const quizCorrect = quizAttempts.filter(([, attempt]) => attempt.correct).length;
  const dailyKeys = ["course", "flashcards", "quiz", "recall"].map((kind) => `${data.today}:${kind}`);
  const dailyDone = dailyKeys.filter((key) => progress.completed.includes(key)).length;
  const moduleLabels = useMemo(() => new Map(data.modules.map((module) => [module.id, module.shortLabel])), [data.modules]);

  function selectModule(nextId: string) {
    setModuleId(nextId);
    setCardIndex(0);
    setCardRevealed(false);
    setQuizIndex(0);
    setSelected([]);
    setValidated(false);
  }

  function openStudy(nextView: MainView, nextModuleId?: string, nextCourseView?: CourseView) {
    if (nextModuleId) selectModule(nextModuleId);
    if (nextCourseView) setCourseView(nextCourseView);
    setView(nextView);
  }

  function toggleDaily(kind: string) {
    const key = `${data.today}:${kind}`;
    setProgress((current) => ({
      ...current,
      completed: current.completed.includes(key)
        ? current.completed.filter((item) => item !== key)
        : [...current.completed, key],
    }));
  }

  function rateCard(rating: CardRating) {
    if (!currentCard) return;
    setProgress((current) => ({ ...current, cards: { ...current.cards, [currentCard.id]: rating } }));
    setCardIndex((current) => rating === "known" && dueCards.length
      ? current % Math.max(1, cards.length - 1)
      : (current + 1) % Math.max(1, cards.length));
    setCardRevealed(false);
  }

  function validateQuiz() {
    if (!currentQuestion || !selected.length) return;
    const correct = sameAnswers(selected, currentQuestion.answers);
    setProgress((current) => ({
      ...current,
      quiz: { ...current.quiz, [currentQuestion.id]: { correct, selected } },
    }));
    setValidated(true);
  }

  function nextQuiz() {
    setQuizIndex((current) => (current + 1) % Math.max(1, quiz.length));
    setSelected([]);
    setValidated(false);
  }

  if (!activeModule) {
    return <div className="radio-empty">{t("radio.empty")}</div>;
  }

  return (
    <div className="radio-shell">
      <header className="radio-hero">
        <div className="radio-hero-copy">
          <p className="radio-overline"><GraduationCap size={15} /> {t("radio.eyebrow")}</p>
          <h1>{data.program.title}</h1>
          <p>{data.program.description || t("radio.description")}</p>
        </div>
        <div className="radio-hero-stats">
          <div><span>{data.program.examLabel}</span><strong>J-{data.daysToExam}</strong><small>{new Date(`${data.examDate}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}</small></div>
          <div><span>{t("radio.modules")}</span><strong>{data.modules.length}</strong><small>{data.modules.map((module) => module.shortLabel).join(" · ")}</small></div>
          <div><span>{t("radio.cards")}</span><strong>{data.modules.reduce((sum, module) => sum + module.flashcards.length, 0)}</strong><small>{data.modules.reduce((sum, module) => sum + module.quiz.length, 0)} {t("radio.questions")}</small></div>
        </div>
      </header>

      <nav className="radio-main-tabs" aria-label={data.program.title}>
        {([
          ["today", t("radio.today"), <Target size={17} key="today" />],
          ["course", t("radio.course"), <BookOpenCheck size={17} key="course" />],
          ["flashcards", t("radio.flashcards"), <BrainCircuit size={17} key="cards" />],
          ["quiz", t("radio.quiz"), <ListChecks size={17} key="quiz" />],
          ["planning", t("radio.planning"), <CalendarDays size={17} key="planning" />],
        ] as [MainView, string, React.ReactNode][]).map(([id, label, icon]) => (
          <button key={id} type="button" className={view === id ? "is-active" : ""} onClick={() => setView(id)}>
            {icon}<span>{label}</span>
          </button>
        ))}
      </nav>

      {view === "today" ? (
        <TodayPanel
          data={data}
          dailyDone={dailyDone}
          progress={progress}
          modules={data.modules}
          onOpen={openStudy}
          onToggle={toggleDaily}
          onReset={() => setProgress((current) => ({ ...current, completed: current.completed.filter((key) => !key.startsWith(`${data.today}:`)) }))}
        />
      ) : null}

      {view !== "today" && view !== "planning" ? (
        <div className="radio-study-layout">
          <aside className="radio-module-picker">
            <span>{t("radio.chooseModule")}</span>
            {availableModules.map((module) => (
              <button
                type="button"
                key={module.id}
                className={`${module.id === activeModule.id ? "is-active" : ""} tone-${module.accent}`}
                onClick={() => selectModule(module.id)}
              >
                <i aria-hidden />
                <span>{module.shortLabel}</span>
                <small>{module.flashcards.length} · {module.quiz.length}</small>
              </button>
            ))}
          </aside>

          <section className="radio-study-panel">
            <div className="radio-study-heading">
              <div><span>{activeModule.shortLabel}</span><h2>{activeModule.label}</h2></div>
              <Link href={noteHref(activeModule.sourcePaths.highYield)}><ExternalLink size={15} /> {t("radio.openSource")}</Link>
            </div>

            {view === "course" ? (
              <CoursePanel module={activeModule} mode={courseView} onMode={setCourseView} />
            ) : null}
            {view === "flashcards" ? (
              <FlashcardPanel
                cards={cards}
                card={currentCard}
                index={cardIndex}
                revealed={cardRevealed}
                known={knownCount}
                due={dueCount}
                onReveal={() => setCardRevealed((value) => !value)}
                onRate={rateCard}
                onPrevious={() => { setCardIndex((current) => (current - 1 + cards.length) % Math.max(1, cards.length)); setCardRevealed(false); }}
              />
            ) : null}
            {view === "quiz" ? (
              <QuizPanel
                quiz={quiz}
                question={currentQuestion}
                index={quizIndex}
                selected={selected}
                validated={validated}
                correct={currentQuestion ? sameAnswers(selected, currentQuestion.answers) : false}
                score={`${quizCorrect}/${quizAttempts.length}`}
                onToggle={(letter) => setSelected((current) => current.includes(letter) ? current.filter((item) => item !== letter) : [...current, letter])}
                onValidate={validateQuiz}
                onNext={nextQuiz}
              />
            ) : null}
          </section>
        </div>
      ) : null}

      {view === "planning" ? (
        <section className="radio-planning-panel">
          <div className="radio-section-title"><div><span>{t("radio.planning")}</span><h2>{t("radio.scheduleRange")}</h2></div><p>{t("radio.progressSaved")}</p></div>
          <div className="radio-calendar-list">
            {data.schedule.map((day) => {
              const done = ["course", "flashcards", "quiz", "recall"].every((kind) => progress.completed.includes(`${day.date}:${kind}`));
              return (
                <article key={day.date} className={`${day.date === data.today ? "is-today" : ""}${done ? " is-done" : ""}`}>
                  <time dateTime={day.date}><strong>{new Date(`${day.date}T12:00:00`).toLocaleDateString(locale, { day: "2-digit" })}</strong><span>{new Date(`${day.date}T12:00:00`).toLocaleDateString(locale, { month: "short" })}</span></time>
                  <div><span className={`radio-phase phase-${day.phase}`}>{t(`radio.phase.${day.phase}`)}</span><h3>{t(day.titleKey)}</h3><p>{t(day.detailKey)}</p></div>
                  <div className="radio-calendar-meta"><span><Clock3 size={14} /> {day.minutes} {t("radio.minutes")}</span><small>{day.moduleIds.map((id) => moduleLabels.get(id) || id).join(" · ")}</small></div>
                  {day.date === data.today ? <b>{t("radio.todayBadge")}</b> : done ? <b><Check size={14} /> {t("radio.doneBadge")}</b> : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function TodayPanel({
  data,
  dailyDone,
  progress,
  modules,
  onOpen,
  onToggle,
  onReset,
}: {
  data: RadioDashboardData;
  dailyDone: number;
  progress: RadioProgress;
  modules: RadioModule[];
  onOpen: (view: MainView, moduleId?: string, courseView?: CourseView) => void;
  onToggle: (kind: string) => void;
  onReset: () => void;
}) {
  const { locale, t } = useLanguage();
  const plannedModule = moduleFor(data.todayPlan, modules);
  const isExamDay = data.todayPlan.phase === "exam";
  const isMixedDay = data.todayPlan.moduleIds.length > 1;
  const plannedLabel = data.todayPlan.moduleIds
    .map((id) => modules.find((module) => module.id === id)?.shortLabel)
    .filter(Boolean)
    .join(" · ");
  const actions = [
    { id: "course", label: t("radio.course"), detail: t(data.todayPlan.detailKey), icon: <BookOpenCheck size={19} />, view: "course" as MainView, courseView: "highYield" as CourseView },
    { id: "flashcards", label: `${data.todayPlan.flashcards} ${t("radio.cards")}`, detail: `${plannedModule?.flashcards.length || 0} ${t("radio.available")}`, icon: <BrainCircuit size={19} />, view: "flashcards" as MainView, courseView: undefined },
    { id: "quiz", label: `${data.todayPlan.qcm} ${t("radio.questions")}`, detail: t("radio.selectAnswers"), icon: <ListChecks size={19} />, view: "quiz" as MainView, courseView: undefined },
    { id: "recall", label: `${data.todayPlan.recall} · ${t("radio.recall")}`, detail: t("radio.openRecall"), icon: <Sparkles size={19} />, view: "course" as MainView, courseView: "recall" as CourseView },
  ];
  return (
    <section className={`radio-today-grid${isExamDay ? " is-exam" : ""}`}>
      <div className="radio-today-main">
        <div className="radio-section-title">
          <div><span>{formatDate(data.today, locale)}</span><h2>{t("radio.todayProgram")}</h2></div>
          <div className="radio-time-pill"><Clock3 size={16} /> {data.todayPlan.minutes} {t("radio.minutes")}</div>
        </div>
        <div className="radio-plan-banner">
          <div><span className={`radio-phase phase-${data.todayPlan.phase}`}>{t(`radio.phase.${data.todayPlan.phase}`)}</span><h3>{isExamDay ? t(data.todayPlan.titleKey) : isMixedDay ? plannedLabel : plannedModule?.label}</h3><p>{isExamDay ? t(data.todayPlan.detailKey) : t(data.todayPlan.titleKey)}</p></div>
          {!isExamDay ? <div className="radio-ring" style={{ "--progress": `${dailyDone * 25}%` } as React.CSSProperties}><strong>{dailyDone}/4</strong><span>{t("radio.completed")}</span></div> : null}
        </div>
        {isExamDay ? (
          <div className="radio-exam-message"><GraduationCap size={24} /><div><strong>{t(data.todayPlan.titleKey)}</strong><span>{t(data.todayPlan.detailKey)}</span></div></div>
        ) : <div className="radio-action-list">
          {actions.map((action) => {
            const key = `${data.today}:${action.id}`;
            const done = progress.completed.includes(key);
            return (
              <article key={action.id} className={done ? "is-done" : ""}>
                <button type="button" className="radio-check" onClick={() => onToggle(action.id)} aria-label={done ? t("radio.completed") : t("radio.markDone")}>
                  {done ? <Check size={18} /> : null}
                </button>
                <span className="radio-action-icon">{action.icon}</span>
                <div><strong>{action.label}</strong><small>{action.detail}</small></div>
                <button type="button" className="radio-open-action" onClick={() => onOpen(action.view, isMixedDay ? MIXED_MODULE_ID : plannedModule?.id, action.courseView)}>
                  {action.id === "course" ? t("radio.startCourse") : action.id === "flashcards" ? t("radio.startCards") : action.id === "quiz" ? t("radio.startQuiz") : t("radio.openRecall")}
                  <ChevronRight size={16} />
                </button>
              </article>
            );
          })}
        </div>}
      </div>
      {!isExamDay ? <aside className="radio-today-side">
        <div className="radio-progress-card">
          <div className="radio-card-head"><div><span>{t("radio.dailyProgress")}</span><h3>{dailyDone * 25}%</h3></div><CheckCircle2 size={22} /></div>
          <div className="radio-progress-track"><i style={{ width: `${dailyDone * 25}%` }} /></div>
          <p>{t("radio.progressSaved")}</p>
          <button type="button" onClick={onReset}><RotateCcw size={15} /> {t("radio.resetDay")}</button>
        </div>
        <div className="radio-next-card">
          <span>{t("radio.tomorrow")}</span>
          <h3>{moduleFor(data.schedule.find((day) => day.date > data.today) || data.todayPlan, modules)?.label}</h3>
          <p>{t(data.schedule.find((day) => day.date > data.today)?.detailKey || "radio.schedule.freeDetail")}</p>
        </div>
      </aside> : null}
    </section>
  );
}

function CoursePanel({ module, mode, onMode }: { module: RadioModule; mode: CourseView; onMode: (mode: CourseView) => void }) {
  const { t } = useLanguage();
  const content = mode === "highYield" ? module.highYield : mode === "exhaustive" ? module.exhaustive : mode === "palace" ? module.palace : module.recall;
  return (
    <>
      <div className="radio-subtabs">
        {([
          ["highYield", t("radio.highYield")],
          ["exhaustive", t("radio.exhaustive")],
          ["palace", t("radio.palace")],
          ["recall", t("radio.openRecall")],
        ] as [CourseView, string][]).map(([id, label]) => <button type="button" key={id} className={mode === id ? "is-active" : ""} onClick={() => onMode(id)}>{label}</button>)}
      </div>
      <div className="radio-course-reader"><MarkdownView content={content} /></div>
    </>
  );
}

function FlashcardPanel({ cards, card, index, revealed, known, due, onReveal, onRate, onPrevious }: {
  cards: RadioModule["flashcards"];
  card: RadioModule["flashcards"][number] | undefined;
  index: number;
  revealed: boolean;
  known: number;
  due: number;
  onReveal: () => void;
  onRate: (rating: CardRating) => void;
  onPrevious: () => void;
}) {
  const { t } = useLanguage();
  if (!card) return <div className="radio-empty">{t("radio.noCards")}</div>;
  const progressLabel = t("radio.cardProgress").replace("{current}", String(index + 1)).replace("{total}", String(cards.length));
  return (
    <div className="radio-flashcard-panel">
      <div className="radio-session-meta"><span>{progressLabel}</span><span>{known} {t("radio.cardsKnown")} · {due} {t("radio.cardsDue")}</span></div>
      <div className={`radio-flashcard${revealed ? " is-revealed" : ""}`} role="group" aria-label={progressLabel}>
        <span>{t("radio.questionLabel")}</span><h3>{card.question}</h3>
        {revealed ? <div className="radio-card-answer"><span>{t("radio.answer")}</span><p>{card.answer}</p></div> : <button type="button" onClick={onReveal}><Sparkles size={18} /> {t("radio.reveal")}</button>}
      </div>
      <div className="radio-card-controls">
        <button type="button" onClick={onPrevious} aria-label={t("radio.previousCard")}><ChevronLeft size={18} /></button>
        {revealed ? <>
          <button type="button" className="is-again" onClick={() => onRate("again")}><RefreshCw size={17} /> {t("radio.again")}</button>
          <button type="button" className="is-known" onClick={() => onRate("known")}><Check size={17} /> {t("radio.known")}</button>
        </> : null}
        <button type="button" onClick={onReveal}>{revealed ? t("radio.hide") : t("radio.reveal")}</button>
      </div>
    </div>
  );
}

function QuizPanel({ quiz, question, index, selected, validated, correct, score, onToggle, onValidate, onNext }: {
  quiz: RadioModule["quiz"];
  question: RadioModule["quiz"][number] | undefined;
  index: number;
  selected: string[];
  validated: boolean;
  correct: boolean;
  score: string;
  onToggle: (letter: string) => void;
  onValidate: () => void;
  onNext: () => void;
}) {
  const { t } = useLanguage();
  if (!question) return <div className="radio-empty">{t("radio.noQuiz")}</div>;
  return (
    <div className="radio-quiz-panel">
      <div className="radio-session-meta"><span>Q{index + 1}/{quiz.length}</span><span>{t("radio.score")} · {score}</span></div>
      <div className="radio-question-card">
        <span>{question.title}</span>
        <h3>{question.prompt || t("radio.selectAnswers")}</h3>
        <p>{t("radio.selectAnswers")}</p>
        <div className="radio-options">
          {question.options.map((option) => {
            const isSelected = selected.includes(option.letter);
            const shouldBe = question.answers.includes(option.letter);
            const className = validated ? shouldBe ? "is-correct" : isSelected ? "is-wrong" : "" : isSelected ? "is-selected" : "";
            return <button type="button" disabled={validated} className={className} key={option.letter} onClick={() => onToggle(option.letter)}><b>{option.letter}</b><span>{option.text}</span>{isSelected ? <Check size={16} /> : null}</button>;
          })}
        </div>
        {validated ? <div className={`radio-feedback ${correct ? "is-correct" : "is-wrong"}`}>
          {correct ? <CheckCircle2 size={20} /> : <CircleAlert size={20} />}
          <div><strong>{correct ? t("radio.correct") : t("radio.incorrect")}</strong><p>{t("radio.expected")} : {question.answers.join(", ")}. {question.explanation}</p></div>
        </div> : null}
      </div>
      <div className="radio-quiz-actions">
        {!validated ? <button type="button" disabled={!selected.length} onClick={onValidate}>{t("radio.validate")} <Check size={17} /></button> : <button type="button" onClick={onNext}>{t("radio.next")} <ChevronRight size={17} /></button>}
      </div>
    </div>
  );
}
