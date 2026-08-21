import { todayISO } from "@/lib/dates";
import type { TranslationKey } from "@/lib/i18n";
import {
  DEFAULT_REVISION_PROGRAM_FILE,
  DEFAULT_REVISION_PROJECT_DIR,
  readNote,
  type VaultNote,
} from "@/lib/vault";

type RevisionLocation = { projectDir?: string; programFile?: string };

export type RadioFlashcard = {
  id: string;
  question: string;
  answer: string;
};

export type RadioQuizQuestion = {
  id: string;
  title: string;
  prompt: string;
  options: { letter: string; text: string }[];
  answers: string[];
  explanation: string;
};

export type RadioModule = {
  id: string;
  label: string;
  shortLabel: string;
  accent: string;
  exhaustive: string;
  highYield: string;
  flashcards: RadioFlashcard[];
  quiz: RadioQuizQuestion[];
  palace: string;
  recall: string;
  sourcePaths: {
    exhaustive: string;
    highYield: string;
    flashcards: string;
    quiz: string;
    palace: string;
    recall: string;
  };
};

export type RadioDayPlan = {
  date: string;
  phase: "apprentissage" | "voyage" | "consolidation" | "simulation" | "exam";
  moduleIds: string[];
  titleKey: TranslationKey;
  detailKey: TranslationKey;
  minutes: number;
  flashcards: number;
  qcm: number;
  recall: number;
};

export type RadioDashboardData = {
  program: {
    id: string;
    title: string;
    description: string;
    examLabel: string;
    progressKey: string;
    legacyProgressKeys: string[];
  };
  examDate: string;
  today: string;
  daysToExam: number;
  modules: RadioModule[];
  schedule: RadioDayPlan[];
  todayPlan: RadioDayPlan;
};

export type RevisionSetupData = {
  title: string;
  examDate: string;
  moduleLabels: string[];
  modules: Array<{
    id: string;
    label: string;
    coursePath: string;
    flashcardsPath: string;
    quizPath: string;
    sourcesPath: string;
  }>;
};

type ModuleSource = {
  id: string;
  label: string;
  shortLabel: string;
  accent: string;
  exhaustive: string;
  highYield: string;
  flashcards: string;
  quiz: string;
  palace: string;
  recall: string;
};

type RadioScheduleConfig = {
  examDate: string;
  startDate: string;
  learningEnd: string;
  travelStart: string;
  travelEnd: string;
  consolidationStart: string;
  consolidationEnd: string;
  scheduleEnd: string;
  moduleOrder: string[];
  learningMinutes: number;
  travelMinutes: number;
  consolidationMinutes: number;
};

const ACCENTS = new Set(["violet", "blue", "amber", "green", "cyan", "red", "pink"]);

function revisionLocation(options: RevisionLocation = {}) {
  const projectDir = (options.projectDir || process.env.REVISION_PROJECT_DIR || DEFAULT_REVISION_PROJECT_DIR).replace(/^\/+|\/+$/g, "");
  const programFile = (options.programFile || process.env.REVISION_PROGRAM_FILE || DEFAULT_REVISION_PROGRAM_FILE).replace(/^\/+/, "");
  if (!projectDir || projectDir.split("/").includes("..") || programFile.split("/").includes("..")) return null;
  return { projectDir, programFile };
}

function relativePath(projectDir: string, filename: string) {
  return `${projectDir}/${filename}`;
}

async function readStudyNote(projectDir: string, filename: string): Promise<VaultNote | null> {
  return (await readNote(relativePath(projectDir, filename))) || null;
}

export function parseRevisionModuleSources(value: unknown): ModuleSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const [id, label, shortLabel, requestedAccent, suffix] = entry.split("|").map((part) => part.trim());
    if (!/^[a-z0-9-]+$/.test(id) || !label || !shortLabel || !/^[\p{L}\p{N}-]+$/u.test(suffix)) return [];
    const accent = ACCENTS.has(requestedAccent) ? requestedAccent : "violet";
    return [{
      id,
      label,
      shortLabel,
      accent,
      exhaustive: `Fiche-Exhaustive-${suffix}.md`,
      highYield: `Fiche-${suffix}.md`,
      flashcards: `Flashcards-${suffix}.md`,
      quiz: `QCM-${suffix}.md`,
      palace: `Palais-Mental-${suffix}.md`,
      recall: `Récitation-${suffix}.md`,
    }];
  });
}

export function markdownHasUsefulRevisionContent(content: string) {
  return content.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/).some((line) => {
    const clean = line.trim();
    return Boolean(clean
      && !/^#{1,6}(?:\s|$)/.test(clean)
      && !/^(?:---|___|\*\*\*)$/.test(clean));
  });
}

function cleanInline(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseRadioFlashcards(content: string, moduleId: string): RadioFlashcard[] {
  const cards: RadioFlashcard[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const match = line.match(/^\*\*(\d+)\.\s*(?:Q\s*[—-]\s*)?(.+?)\*\*\s*(?:R\s*[—-]\s*(.+))?$/i);
    if (!match) continue;
    let answer = match[3] || "";
    let cursor = index + 1;
    while (!answer && cursor < lines.length && !lines[cursor].trim()) cursor += 1;
    if (!answer && cursor < lines.length) {
      answer = lines[cursor].trim().replace(/^R\s*[—-]\s*/i, "");
    }
    if (!answer || answer.startsWith("#") || answer.startsWith("**")) continue;
    cards.push({
      id: `${moduleId}-f-${match[1]}`,
      question: cleanInline(match[2]),
      answer: cleanInline(answer),
    });
  }
  return cards;
}

function parseCorrectionMap(content: string) {
  const corrections = new Map<number, { answers: string[]; explanation: string }>();
  const tablePattern = /^\|\s*(\d+)\s*\|\s*([A-E](?:\s*,\s*[A-E])*)\s*\|\s*(.*?)\s*\|$/gm;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tablePattern.exec(content))) {
    corrections.set(Number(tableMatch[1]), {
      answers: tableMatch[2].split(",").map((value) => value.trim()),
      explanation: cleanInline(tableMatch[3]),
    });
  }

  const listPattern = /^[ \t]*(\d+)\.[ \t]+\*\*([A-E]+)\.?\*\*[ \t]*(.*)$/gm;
  let listMatch: RegExpExecArray | null;
  while ((listMatch = listPattern.exec(content))) {
    corrections.set(Number(listMatch[1]), {
      answers: listMatch[2].split(""),
      explanation: cleanInline(listMatch[3]),
    });
  }
  return corrections;
}

export function parseRadioQuiz(content: string, moduleId: string): RadioQuizQuestion[] {
  const corrections = parseCorrectionMap(content);
  const questionsStart = content.search(/^## Questions\s*$/m);
  const correctionsStart = content.search(/^## Correction/m);
  const source = questionsStart >= 0
    ? content.slice(questionsStart, correctionsStart > questionsStart ? correctionsStart : undefined)
    : content;
  const headingPattern = /^### Q(\d+)\s*[—-]\s*(.+)$/gm;
  const headings = [...source.matchAll(headingPattern)];
  return headings.flatMap((heading, index) => {
    const number = Number(heading[1]);
    const bodyStart = (heading.index || 0) + heading[0].length;
    const bodyEnd = index + 1 < headings.length ? headings[index + 1].index : source.length;
    const body = source.slice(bodyStart, bodyEnd || source.length).trim();
    const options: { letter: string; text: string }[] = [];
    const optionPattern = /^([A-E])\.\s+(.+)$/gm;
    let optionMatch: RegExpExecArray | null;
    while ((optionMatch = optionPattern.exec(body))) {
      options.push({ letter: optionMatch[1], text: cleanInline(optionMatch[2]) });
    }
    if (options.length < 2) return [];
    const firstOption = body.search(/^A\.\s+/m);
    const prompt = cleanInline(firstOption >= 0 ? body.slice(0, firstOption) : "");
    const correction = corrections.get(number) || { answers: [], explanation: "" };
    return [{
      id: `${moduleId}-q-${number}`,
      title: cleanInline(heading[2]),
      prompt,
      options,
      answers: correction.answers,
      explanation: correction.explanation,
    }];
  });
}

function dateRange(start: string, end: string) {
  const dates: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function scheduleConfig(note: VaultNote, moduleIds: string[]): RadioScheduleConfig {
  const data = note.data;
  const startDate = stringValue(data.start_date, todayISO());
  const examDate = stringValue(data.exam_date, startDate);
  const scheduleEnd = stringValue(data.schedule_end, shiftDate(examDate, -1));
  return {
    examDate,
    startDate,
    learningEnd: stringValue(data.learning_end, scheduleEnd),
    travelStart: stringValue(data.travel_start, examDate),
    travelEnd: stringValue(data.travel_end, examDate),
    consolidationStart: stringValue(data.consolidation_start, examDate),
    consolidationEnd: stringValue(data.consolidation_end, examDate),
    scheduleEnd,
    moduleOrder: Array.isArray(data.module_order)
      ? data.module_order.filter((value): value is string => typeof value === "string")
      : moduleIds,
    learningMinutes: numberValue(data.learning_minutes, 60),
    travelMinutes: numberValue(data.travel_minutes, 30),
    consolidationMinutes: numberValue(data.consolidation_minutes, 90),
  };
}

function buildSchedule(moduleIds: string[], config: RadioScheduleConfig): RadioDayPlan[] {
  const safeModules = moduleIds.length ? moduleIds : ["module"];
  const foundation = config.moduleOrder
    .filter((id) => safeModules.includes(id));
  const all = foundation.length ? foundation : safeModules;
  return dateRange(config.startDate, config.scheduleEnd).map((date, index) => {
    if (date <= config.learningEnd) {
      const moduleId = all[index % all.length];
      return {
        date,
        phase: "apprentissage",
        moduleIds: [moduleId],
        titleKey: "radio.schedule.learningTitle",
        detailKey: "radio.schedule.learningDetail",
        minutes: config.learningMinutes,
        flashcards: 30,
        qcm: 20,
        recall: 5,
      };
    }
    if (date >= config.travelStart && date <= config.travelEnd) {
      const moduleId = safeModules[index % safeModules.length];
      return {
        date,
        phase: "voyage",
        moduleIds: [moduleId],
        titleKey: "radio.schedule.travelTitle",
        detailKey: "radio.schedule.travelDetail",
        minutes: config.travelMinutes,
        flashcards: 20,
        qcm: 10,
        recall: 2,
      };
    }
    if (date >= config.consolidationStart && date <= config.consolidationEnd) {
      const first = safeModules[index % safeModules.length];
      const second = safeModules[(index + 3) % safeModules.length];
      return {
        date,
        phase: "consolidation",
        moduleIds: [first, second],
        titleKey: "radio.schedule.consolidationTitle",
        detailKey: "radio.schedule.consolidationDetail",
        minutes: config.consolidationMinutes,
        flashcards: 40,
        qcm: 30,
        recall: 6,
      };
    }
    return {
      date,
      phase: "simulation",
      moduleIds: safeModules,
      titleKey: index % 2 ? "radio.schedule.simulationTitle" : "radio.schedule.repairTitle",
      detailKey: index % 2
        ? "radio.schedule.simulationDetail"
        : "radio.schedule.repairDetail",
      minutes: index % 2 ? 100 : 70,
      flashcards: index % 2 ? 30 : 50,
      qcm: index % 2 ? 60 : 25,
      recall: 8,
    };
  });
}

async function revisionProgram(options: RevisionLocation = {}) {
  const location = revisionLocation(options);
  if (!location) return null;
  const note = await readStudyNote(location.projectDir, location.programFile);
  if (!note) return null;
  const sources = parseRevisionModuleSources(note.data.revision_modules);
  if (!sources.length) return null;
  const id = typeof note.data.revision_id === "string" && /^[a-z0-9-]+$/.test(note.data.revision_id)
    ? note.data.revision_id
    : "revision-program";
  const legacyProgressKeys = Array.isArray(note.data.revision_legacy_progress_keys)
    ? note.data.revision_legacy_progress_keys.filter((value): value is string => typeof value === "string")
    : [];
  return {
    ...location,
    note,
    sources,
    client: {
      id,
      title: typeof note.data.revision_title === "string" ? note.data.revision_title : note.title,
      description: typeof note.data.revision_description === "string" ? note.data.revision_description : "",
      examLabel: typeof note.data.revision_exam_label === "string" ? note.data.revision_exam_label : "Examen",
      progressKey: `second-brain:revisions:${id}:v1`,
      legacyProgressKeys,
    },
  };
}

export async function getRevisionSetup(options: RevisionLocation = {}): Promise<RevisionSetupData> {
  const location = revisionLocation(options);
  const today = todayISO();
  const defaultExam = shiftDate(today, 30);
  if (!location) return { title: "", examDate: defaultExam, moduleLabels: [], modules: [] };
  const note = await readStudyNote(location.projectDir, location.programFile);
  const sources = parseRevisionModuleSources(note?.data.revision_modules);
  return {
    title: typeof note?.data.revision_title === "string" ? note.data.revision_title : note?.title || "",
    examDate: stringValue(note?.data.exam_date, defaultExam),
    moduleLabels: sources.map((source) => source.label),
    modules: sources.map((source) => ({
      id: source.id,
      label: source.label,
      coursePath: relativePath(location.projectDir, source.highYield),
      flashcardsPath: relativePath(location.projectDir, source.flashcards),
      quizPath: relativePath(location.projectDir, source.quiz),
      sourcesPath: relativePath(location.projectDir, source.exhaustive),
    })),
  };
}

export async function getRevisionDashboard(options: RevisionLocation = {}): Promise<RadioDashboardData | null> {
  const program = await revisionProgram(options);
  if (!program) return null;
  const { projectDir, note: programNote, sources } = program;
  const loadedModules = await Promise.all(sources.map(async (source) => {
    const notes = await Promise.all([
      readStudyNote(projectDir, source.exhaustive),
      readStudyNote(projectDir, source.highYield),
      readStudyNote(projectDir, source.flashcards),
      readStudyNote(projectDir, source.quiz),
      readStudyNote(projectDir, source.palace),
      readStudyNote(projectDir, source.recall),
    ]);
    if (!notes[0] || !notes[1] || !notes[2] || !notes[3] || !notes[4] || !notes[5]) return null;
    return {
      id: source.id,
      label: source.label,
      shortLabel: source.shortLabel,
      accent: source.accent,
      exhaustive: notes[0].content,
      highYield: notes[1].content,
      flashcards: parseRadioFlashcards(notes[2].content, source.id),
      quiz: parseRadioQuiz(notes[3].content, source.id),
      palace: notes[4].content,
      recall: notes[5].content,
      sourcePaths: {
        exhaustive: relativePath(projectDir, source.exhaustive),
        highYield: relativePath(projectDir, source.highYield),
        flashcards: relativePath(projectDir, source.flashcards),
        quiz: relativePath(projectDir, source.quiz),
        palace: relativePath(projectDir, source.palace),
        recall: relativePath(projectDir, source.recall),
      },
      hasUsefulContent: notes.some((note) => Boolean(note && markdownHasUsefulRevisionContent(note.content))),
    } satisfies RadioModule & { hasUsefulContent: boolean };
  })).then((items) => items.filter((module): module is RadioModule & { hasUsefulContent: boolean } => Boolean(module)));
  if (!loadedModules.length || !loadedModules.some((module) => module.hasUsefulContent)) return null;
  const modules: RadioModule[] = loadedModules;

  const today = todayISO();
  const config = scheduleConfig(programNote, modules.map((module) => module.id));
  const examDate = config.examDate;
  const baseSchedule = buildSchedule(modules.map((module) => module.id), config);
  const examPlan: RadioDayPlan = {
    date: examDate,
    phase: "exam",
    moduleIds: [],
    titleKey: "radio.schedule.examTitle",
    detailKey: "radio.schedule.examDetail",
    minutes: 0,
    flashcards: 0,
    qcm: 0,
    recall: 0,
  };
  const schedule = baseSchedule.some((day) => day.date === examDate)
    ? baseSchedule
    : [...baseSchedule, examPlan];
  const todayPlan = schedule.find((day) => day.date === today) || {
    date: today,
    phase: "simulation" as const,
    moduleIds: modules.map((module) => module.id),
    titleKey: "radio.schedule.freeTitle",
    detailKey: "radio.schedule.freeDetail",
    minutes: 60,
    flashcards: 30,
    qcm: 20,
    recall: 5,
  };
  const daysToExam = Math.max(0, Math.ceil((Date.parse(`${examDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000));
  return { program: program.client, examDate, today, daysToExam, modules, schedule, todayPlan };
}
