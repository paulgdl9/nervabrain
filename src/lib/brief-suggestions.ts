import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "@/lib/atomic-write";

// Brief suggestions are pending proposals, not vault content: a rejected one
// must leave no trace in the Markdown. They live as JSON beside the assistant
// chats, keyed by the brief note they belong to, and only become notes once the
// user accepts them.

export type BriefSuggestionKind =
  | "create_task" | "update_task" | "archive_task" | "capture_note" | "execute_task";
export type BriefSuggestionState = "pending" | "accepted" | "rejected";

/** One note rewrite an execute_task suggestion wants applied, shown before accept. */
export type BriefNoteEdit = { path: string; content: string };

export type BriefSuggestion = {
  id: string;
  kind: BriefSuggestionKind;
  title: string;
  why: string;
  /** Existing note the suggestion acts on. Required by update_task, archive_task and execute_task. */
  target?: string;
  patch?: { priority?: string; status?: string; area?: string; objective?: string };
  task?: { title: string; area?: string; objective?: string; execKind?: string; why?: string };
  note?: { title: string; body: string };
  /** execute_task: what the engine did or found, appended to the task on accept. */
  outcome?: string;
  /** execute_task: the concrete note rewrites, empty for a read-only verification. */
  edits?: BriefNoteEdit[];
  state: BriefSuggestionState;
  decidedAt?: string;
  resultPath?: string;
  error?: string;
};

export type RawBriefSuggestion = {
  kind?: unknown;
  title?: unknown;
  why?: unknown;
  target?: unknown;
  patch?: unknown;
  task?: unknown;
  note?: unknown;
  outcome?: unknown;
  edits?: unknown;
};

const KINDS = new Set<BriefSuggestionKind>([
  "create_task", "update_task", "archive_task", "capture_note", "execute_task",
]);

/**
 * Folders an execute_task rewrite may touch. Deliberately excludes 00-System
 * (Context.md is refresh-context's business alone), 06-Daily and 07-Weekly
 * (generated notes the user edits by hand), and _Archive (frozen history).
 */
const EXECUTABLE_EDIT_ROOTS = ["02-Raw/", "03-Wiki/", "05-Tasks/", "08-Projects/", "10-Finance/", "11-Custom/", "12-Business/"];
const MAX_EDITS = 4;
const MAX_EDIT_CONTENT = 20_000;
const PRIORITIES = new Set(["low", "medium", "high"]);
// A suggestion may park or close a task; it may never mark one `done` on the
// user's behalf, because only they know whether the work actually happened.
const PATCH_STATUSES = new Set(["todo", "doing", "waiting"]);
const MAX_SUGGESTIONS = 8;
const MAX_TEXT = 400;
const MAX_BODY = 4000;
const CLOSED_TASK_STATUSES = new Set(["done", "abandoned"]);

function vaultDir() {
  const configured = process.env.SECOND_BRAIN_VAULT?.trim();
  return configured && path.isAbsolute(configured)
    ? configured
    : path.join(process.cwd(), configured || "vault");
}

function suggestionsDir() {
  const explicit = process.env.BRIEF_SUGGESTIONS_DIR?.trim();
  if (explicit) return explicit;
  // Sibling of the *active* vault rather than of the process's cwd: a test that
  // points SECOND_BRAIN_VAULT at a scratch directory then generates a brief was
  // otherwise writing into the real profile's data and could wipe pending
  // proposals. In production (SECOND_BRAIN_VAULT=./vault, cwd=/app) this
  // resolves to the same /app/data/brief-suggestions as before.
  // Duplicates vault.ts's vaultRoot() on purpose: importing it here would make
  // vault.ts ⇄ brief-suggestions.ts circular.
  return path.join(path.dirname(vaultDir()), "data", "brief-suggestions");
}

/** The brief's vault path doubles as the filename stem, so it must not escape the directory. */
export function suggestionsFilePath(briefPath: string) {
  const key = briefPath.replace(/\.md$/i, "").replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!key || key.length > 120) throw new Error(`Invalid brief path: ${briefPath}`);
  return path.join(suggestionsDir(), `${key}.json`);
}

function text(value: unknown, limit = MAX_TEXT) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** A suggestion may only ever touch a task note, never an objective or a brief. */
function taskTarget(value: unknown) {
  const target = text(value, 300);
  return target.startsWith("05-Tasks/") && target.endsWith(".md") && !target.includes("..") ? target : "";
}

/** A rewrite target must be an existing-looking note inside an executable folder. */
function editTarget(value: unknown) {
  const target = text(value, 300);
  if (!target.endsWith(".md") || target.includes("..") || target.startsWith("/")) return "";
  return EXECUTABLE_EDIT_ROOTS.some((root) => target.startsWith(root)) ? target : "";
}

function normalizeEdits(value: unknown): BriefNoteEdit[] {
  if (!Array.isArray(value)) return [];
  const edits: BriefNoteEdit[] = [];
  for (const entry of value) {
    if (edits.length >= MAX_EDITS) break;
    const raw = record(entry);
    const target = editTarget(raw.path);
    const content = typeof raw.content === "string" ? raw.content.slice(0, MAX_EDIT_CONTENT) : "";
    // An empty rewrite would blank the note, which is never a legitimate result.
    if (!target || !content.trim()) continue;
    if (edits.some((edit) => edit.path === target)) continue;
    edits.push({ path: target, content });
  }
  return edits;
}

export function normalizeSuggestion(raw: RawBriefSuggestion, index: number): BriefSuggestion | null {
  const kind = text(raw.kind, 40) as BriefSuggestionKind;
  if (!KINDS.has(kind)) return null;
  const title = text(raw.title);
  if (!title) return null;
  const base = { id: `sug-${index + 1}`, kind, title, why: text(raw.why), state: "pending" as const };

  if (kind === "execute_task") {
    const target = taskTarget(raw.target);
    const outcome = text(raw.outcome, 2000);
    // Nothing to show and nothing to apply is not an execution.
    if (!target || !outcome) return null;
    return { ...base, target, outcome, edits: normalizeEdits(raw.edits) };
  }

  if (kind === "create_task") {
    const task = record(raw.task);
    const taskTitle = text(task.title) || title;
    return { ...base, task: {
      title: taskTitle,
      area: text(task.area, 60),
      objective: text(task.objective, 200),
      execKind: text(task.exec_kind ?? task.execKind, 20),
      why: text(task.why) || base.why,
    } };
  }

  if (kind === "update_task") {
    const target = taskTarget(raw.target);
    const patch = record(raw.patch);
    const priority = text(patch.priority, 20).toLowerCase();
    const status = text(patch.status, 20).toLowerCase();
    const next = {
      ...(PRIORITIES.has(priority) ? { priority } : {}),
      ...(PATCH_STATUSES.has(status) ? { status } : {}),
      ...(text(patch.area, 60) ? { area: text(patch.area, 60) } : {}),
      ...(text(patch.objective, 200) ? { objective: text(patch.objective, 200) } : {}),
    };
    // An update that changes nothing is noise, not a proposal.
    if (!target || !Object.keys(next).length) return null;
    return { ...base, target, patch: next };
  }

  if (kind === "archive_task") {
    const target = taskTarget(raw.target);
    return target ? { ...base, target } : null;
  }

  const note = record(raw.note);
  const body = text(note.body, MAX_BODY);
  if (!body) return null;
  return { ...base, note: { title: text(note.title, 160) || title, body } };
}

export function normalizeSuggestions(raw: unknown): BriefSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const out: BriefSuggestion[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_SUGGESTIONS) break;
    const suggestion = normalizeSuggestion(record(entry) as RawBriefSuggestion, out.length);
    // Two suggestions acting on the same task would race each other on accept.
    if (suggestion && !out.some((existing) => existing.target && existing.target === suggestion.target)) {
      out.push(suggestion);
    }
  }
  return out;
}

export async function readBriefSuggestions(briefPath: string): Promise<BriefSuggestion[]> {
  try {
    const raw = JSON.parse(await fs.readFile(suggestionsFilePath(briefPath), "utf8")) as { suggestions?: unknown };
    if (!Array.isArray(raw.suggestions)) return [];
    // Stored entries keep their decided state, so re-normalizing would reset them.
    const suggestions = raw.suggestions as BriefSuggestion[];
    const closed = await Promise.all(suggestions.map(async (suggestion) => {
      if (suggestion.state !== "pending" || !suggestion.target) return false;
      try {
        const task = await fs.readFile(path.join(vaultDir(), suggestion.target), "utf8");
        const status = task.match(/^status:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1]?.trim().toLowerCase();
        return status ? CLOSED_TASK_STATUSES.has(status) : false;
      } catch {
        // Keep a proposal whose target disappeared visible: accepting it shows
        // the actionable "task not found" error instead of silently hiding it.
        return false;
      }
    }));
    return suggestions.filter((_, index) => !closed[index]);
  } catch {
    return [];
  }
}

export async function writeBriefSuggestions(briefPath: string, suggestions: BriefSuggestion[]) {
  const file = suggestionsFilePath(briefPath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWriteFile(file, `${JSON.stringify({ briefPath, suggestions }, null, 2)}\n`);
  return suggestions;
}
