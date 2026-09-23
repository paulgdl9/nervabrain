import { NextRequest, NextResponse } from "next/server";
import {
  searchNotes,
  readNote,
  listNotes,
  createTask,
  createObjective,
  updateTaskStatus,
  updateNote,
  createCapture,
  processInbox,
  createWikiNote,
  noteHref,
  upsertVaultNote,
  listApplicationRecords,
  createApplication,
  createApplicationDocument,
  updateApplicationStage,
  linkApplicationDocument,
} from "@/lib/vault";
import {
  computeTrailStats,
  deleteTrainingSession,
  editTrainingSession,
  planDateIso,
  removePlanOverride,
  savePlanOverride,
  setTrainingWeek,
  saveTrailFeedback,
  type PlanSessionData,
  type PlanOverride,
  type SportKind,
  type TrailFeedback,
} from "@/lib/trail";
import { preflight, withCors } from "@/lib/cors";
import { authenticateRequest, type AuthContext } from "@/lib/auth";
import { readRequestText, RequestBodyError } from "@/lib/http-security";
import type { OAuthScope } from "@/lib/oauth-codes";
import { strengthProgramFor, type StrengthExercisePlan } from "@/lib/strength-program";

export const runtime = "nodejs";

const PROTOCOL_VERSION = "2024-11-05";

function trainingSessionInput(args: Record<string, unknown>): Omit<PlanSessionData, "id"> & { id?: string } {
  const sport = String(args.sport || "") as SportKind;
  const weekday = Number(args.weekday);
  const durationMin = Number(args.duration_min);
  const title = String(args.title || "").trim();
  const subtitle = String(args.subtitle || "").trim();
  const intensity = String(args.intensity || "").trim();
  const details = Array.isArray(args.details) ? args.details.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
  const strengthExercises = Array.isArray(args.strength_exercises) ? args.strength_exercises.map((raw) => {
    const item = raw as Record<string, unknown>;
    return {
      label: String(item.label || "").trim(),
      category: String(item.category || "").trim(),
      exerciseName: String(item.exercise_name || "").trim(),
      sets: Number(item.sets),
      ...(item.reps_min !== undefined ? { repsMin: Number(item.reps_min) } : {}),
      ...(item.reps_max !== undefined ? { repsMax: Number(item.reps_max) } : {}),
      ...(item.seconds !== undefined ? { seconds: Number(item.seconds) } : {}),
      ...(item.weight_kg !== undefined ? { weightKg: Number(item.weight_kg) } : {}),
      restSeconds: Number(item.rest_seconds),
      ...(item.rir ? { rir: String(item.rir).trim() } : {}),
    } satisfies StrengthExercisePlan;
  }) : undefined;
  if (!["run", "ride", "strength", "recovery"].includes(sport)
    || !Number.isInteger(weekday) || weekday < 0 || weekday > 6
    || !Number.isInteger(durationMin) || durationMin < 1
    || !title || !subtitle || !intensity || !details.length) throw new Error("Invalid training session");
  const id = String(args.session_id || "").trim();
  return {
    sport, weekday, title, subtitle, durationMin, intensity, details,
    ...(strengthExercises?.length ? { strengthExercises } : {}),
    ...(args.optional === true ? { optional: true } : {}),
    ...(id ? { id } : {}),
  };
}

function ok(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function err(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolFailureMessage(error: unknown) {
  if (error instanceof Error && /^[\p{L}\d][\p{L}\d .,:;()'’_-]{0,200}$/u.test(error.message)) return error.message;
  return "Tool execution failed.";
}

const TOOLS = [
  // "search" and "fetch" are the exact tool names ChatGPT connectors require
  // (OpenAI rejects MCP servers without them outside developer mode). They
  // return the JSON document shape OpenAI specifies, wrapped in text content.
  {
    name: "search",
    description: "Search vault notes. Returns a JSON object with a results array of {id, title, url}. Use fetch with a result id to read the full note.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query" } },
      required: ["query"],
    },
  },
  {
    name: "fetch",
    description: "Fetch the full content of a vault note by id (the relative path returned by search). Returns a JSON document {id, title, text, url, metadata}.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Note id (relative path) from search results" } },
      required: ["id"],
    },
  },
  {
    name: "search_vault",
    description: "Search notes in the vault by keyword",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query" } },
      required: ["query"],
    },
  },
  {
    name: "read_note",
    description: "Read the full content of a vault note by relative path (e.g. 06-Daily/2026-06-29.md)",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Relative path within vault" } },
      required: ["path"],
    },
  },
  {
    name: "list_tasks",
    description: "List tasks filtered by status (todo, doing, done, abandoned, archived)",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["todo", "doing", "done", "abandoned", "archived", "all"] },
      },
    },
  },
  {
    name: "list_objectives",
    description: "List objectives filtered by status (active, achieved, abandoned, all)",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "achieved", "abandoned", "all"] },
      },
    },
  },
  {
    name: "read_context",
    description: "Read the active system context (identity, projects, priorities)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_daily",
    description: "Read a daily brief note. Defaults to today.",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string", description: "ISO date YYYY-MM-DD, defaults to today" } },
    },
  },
  {
    name: "list_applications",
    description: "List tracked job applications and the document library, including the document paths linked to each application.",
    inputSchema: {
      type: "object",
      properties: {
        stage: { type: "string", enum: ["new", "preparing", "applied", "interview", "offer", "accepted", "rejected", "withdrawn", "ignored", "all"] },
      },
    },
  },
  {
    name: "get_training_status",
    description: "Read the live training plan, every planned session for a requested week, current-week Garmin matches, health signals, and feedback still needed.",
    inputSchema: {
      type: "object",
      properties: { week: { type: "integer", minimum: 1, description: "Plan week to inspect; defaults to the current week" } },
    },
  },
  {
    name: "capture_insight",
    description: "Capture an insight, idea, excerpt, or commitment. Nerva Brain immediately classifies it into a task, working note, durable knowledge, or archive.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The insight or excerpt to save (markdown allowed)" },
        title: { type: "string", description: "Optional short title; inferred if omitted" },
        url: { type: "string", description: "Optional source URL" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
      },
      required: ["text"],
    },
  },
  {
    name: "save_daily_chat_digest",
    description: "Save or replace one daily ChatGPT/Codex conversation digest in 02-Raw. This does not classify the digest or create tasks.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Digest date in ISO format YYYY-MM-DD" },
        body: { type: "string", description: "Full markdown digest without frontmatter or an H1 heading" },
      },
      required: ["date", "body"],
    },
  },
  {
    name: "save_wiki_note",
    description: "Save a substantial, standalone and durable knowledge draft in 03-Wiki. Use only for refined knowledge with likely future decision value, never for links, news, excerpts or raw captures.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string", description: "One-line summary" },
        body: { type: "string", description: "Full markdown body" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["title"],
    },
  },
  {
    name: "create_task",
    description: "Create a new task in the vault",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        area: { type: "string" },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        why: { type: "string", description: "Why this task matters" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task_status",
    description: "Update the status of an existing task.",
    inputSchema: {
      type: "object",
      properties: {
        task_path: { type: "string", description: "Task path returned by list_tasks" },
        status: { type: "string", enum: ["todo", "doing", "waiting", "done", "abandoned", "archived"] },
      },
      required: ["task_path", "status"],
    },
  },
  {
    name: "create_objective",
    description: "Create a new tracked objective.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        area: { type: "string" },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        horizon: { type: "string" },
        current_state: { type: "string" },
        next_step: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_objective_status",
    description: "Update the status of an existing objective without changing its content.",
    inputSchema: {
      type: "object",
      properties: {
        objective_path: { type: "string", description: "Objective path returned by search or fetch" },
        status: { type: "string", enum: ["active", "paused", "achieved", "abandoned", "archived"] },
      },
      required: ["objective_path", "status"],
    },
  },
  {
    name: "record_training_feedback",
    description: "Record or replace the user's explicit RPE, pain, feeling, and note for one synced Garmin activity.",
    inputSchema: {
      type: "object",
      properties: {
        activity_id: { type: "string", description: "Activity id returned by get_training_status" },
        rpe: { type: "integer", minimum: 1, maximum: 10 },
        pain: { type: "integer", minimum: 0, maximum: 10 },
        feeling: { type: "string", enum: ["great", "good", "neutral", "hard"] },
        note: { type: "string" },
      },
      required: ["activity_id", "rpe", "pain", "feeling"],
    },
  },
  {
    name: "adjust_training_session",
    description: "Add, replace, delete, restore, move, cancel, or validate a planned training session after an explicit user request. Use get_training_status first.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Required except when adding a session" },
        week: { type: "integer", minimum: 1 },
        action: { type: "string", enum: ["move", "cancel", "validate", "restore", "replace", "delete", "add"] },
        to_weekday: { type: "integer", minimum: 0, maximum: 6, description: "Required for move; Monday is 0 and Sunday is 6" },
        reason: { type: "string", description: "Required for cancel" },
        activity_id: { type: "string", description: "Optional Garmin activity id for validate" },
        sport: { type: "string", enum: ["run", "ride", "strength", "recovery"], description: "Required for add and replace" },
        weekday: { type: "integer", minimum: 0, maximum: 6, description: "Required for add and replace; Monday is 0 and Sunday is 6" },
        title: { type: "string", description: "Required for add and replace" },
        subtitle: { type: "string", description: "Required for add and replace" },
        duration_min: { type: "integer", minimum: 1, description: "Required for add and replace" },
        intensity: { type: "string", description: "Required for add and replace" },
        details: { type: "array", items: { type: "string" }, minItems: 1, description: "Ordered workout steps; required for add and replace" },
        strength_exercises: { type: "array", items: { type: "object" }, description: "Structured strength targets: label, category, exercise_name, sets, reps_min/reps_max or seconds, weight_kg, rest_seconds and optional rir" },
        optional: { type: "boolean" },
      },
      required: ["week", "action"],
    },
  },
  {
    name: "set_training_week",
    description: "Create the next training week or replace any existing week with a complete session plan in one call. This only updates NervaBrain; it does not publish workouts to Garmin.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1 },
        phase: { type: "integer", enum: [1, 2, 3], description: "Defaults to the existing or previous week phase" },
        dplus: { type: "integer", minimum: 0, description: "Weekly elevation target in metres" },
        sessions: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              session_id: { type: "string", description: "Optional stable id; matching weekday and sport ids are otherwise preserved when replacing" },
              sport: { type: "string", enum: ["run", "ride", "strength", "recovery"] },
              weekday: { type: "integer", minimum: 0, maximum: 6, description: "Monday is 0 and Sunday is 6" },
              title: { type: "string" },
              subtitle: { type: "string" },
              duration_min: { type: "integer", minimum: 1 },
              intensity: { type: "string" },
              details: { type: "array", items: { type: "string" }, minItems: 1 },
              strength_exercises: { type: "array", items: { type: "object" }, description: "Structured strength targets" },
              optional: { type: "boolean" },
            },
            required: ["sport", "weekday", "title", "subtitle", "duration_min", "intensity", "details"],
          },
        },
      },
      required: ["week", "sessions"],
    },
  },
  {
    name: "create_application",
    description: "Create a tracked job application without submitting it.",
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string" },
        role: { type: "string" },
        location: { type: "string" },
        offer_url: { type: "string" },
        stage: { type: "string", enum: ["new", "preparing", "applied", "interview", "offer", "accepted", "rejected", "withdrawn", "ignored"] },
        next_action: { type: "string" },
        next_action_date: { type: "string", description: "ISO date YYYY-MM-DD" },
        notes: { type: "string" },
      },
      required: ["role"],
    },
  },
  {
    name: "update_application_stage",
    description: "Update the stage of a tracked application. Setting applied or later stamps applied_on once.",
    inputSchema: {
      type: "object",
      properties: {
        application_path: { type: "string" },
        stage: { type: "string", enum: ["new", "preparing", "applied", "interview", "offer", "accepted", "rejected", "withdrawn", "ignored"] },
      },
      required: ["application_path", "stage"],
    },
  },
  {
    name: "create_application_document",
    description: "Add a Canva, Google Docs, portfolio, or other document link and optionally attach it to an application.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        kind: { type: "string", enum: ["cv", "cover_letter", "portfolio", "other"] },
        url: { type: "string" },
        version: { type: "string" },
        notes: { type: "string" },
        application_path: { type: "string" },
      },
      required: ["name", "url"],
    },
  },
  {
    name: "link_application_document",
    description: "Link or unlink an existing application document. One document may be reused by multiple applications.",
    inputSchema: {
      type: "object",
      properties: {
        application_path: { type: "string" },
        document_path: { type: "string" },
        linked: { type: "boolean", description: "True to link, false to unlink. Defaults to true." },
      },
      required: ["application_path", "document_path"],
    },
  },
];

const WRITE_TOOLS = new Set([
  "capture_insight",
  "save_daily_chat_digest",
  "save_wiki_note",
  "create_task",
  "update_task_status",
  "create_objective",
  "update_objective_status",
  "record_training_feedback",
  "adjust_training_session",
  "set_training_week",
  "create_application",
  "update_application_stage",
  "create_application_document",
  "link_application_document",
]);

function toolScope(name: string): OAuthScope {
  return WRITE_TOOLS.has(name) ? "write" : "read";
}

function noteUrl(relativePath: string) {
  const base = process.env.NEXT_PUBLIC_MCP_BASE_URL ?? "";
  return base ? `${base}${noteHref({ relativePath })}` : relativePath;
}

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "search": {
      const results = (await searchNotes(String(args.query || ""))).slice(0, 25);
      const payload = {
        results: results.map((n) => ({ id: n.relativePath, title: n.title, url: noteUrl(n.relativePath) })),
      };
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }

    case "fetch": {
      const id = String(args.id || "");
      const note = await readNote(id);
      const payload = note
        ? { id, title: note.title, text: note.content ?? "", url: noteUrl(id), metadata: null }
        : { id, title: "Not found", text: "Note not found.", url: null, metadata: null };
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }

    case "search_vault": {
      const results = await searchNotes(String(args.query || ""));
      const text = results.length
        ? results.map((n) => `[${n.relativePath}] ${n.title}\n${n.content?.slice(0, 300) ?? ""}`).join("\n---\n")
        : "No results found.";
      return { content: [{ type: "text", text }] };
    }

    case "read_note": {
      const note = await readNote(String(args.path || ""));
      if (!note) return { content: [{ type: "text", text: "Note not found." }] };
      return { content: [{ type: "text", text: `# ${note.title}\n\n${note.content ?? ""}` }] };
    }

    case "list_tasks": {
      const all = await listNotes("tasks");
      const filterStatus = String(args.status || "todo");
      const notes = filterStatus === "all" ? all : all.filter((n) => n.status === filterStatus);
      const text = notes.length
        ? notes.map((n) => `[${n.status}] ${n.title} (${n.relativePath})`).join("\n")
        : `No tasks with status "${filterStatus}".`;
      return { content: [{ type: "text", text }] };
    }

    case "list_objectives": {
      const all = await listNotes("objectives");
      const filterStatus = String(args.status || "active");
      const notes = filterStatus === "all" ? all : all.filter((n) => n.status === filterStatus);
      const text = notes.length
        ? notes.map((n) => `[${n.status}] ${n.title} (${n.relativePath})`).join("\n")
        : `No objectives with status "${filterStatus}".`;
      return { content: [{ type: "text", text }] };
    }

    case "read_context": {
      const note = await readNote("00-System/Context.md");
      if (!note) return { content: [{ type: "text", text: "Context note not found." }] };
      return { content: [{ type: "text", text: note.content ?? "" }] };
    }

    case "read_daily": {
      const date = String(args.date || new Date().toISOString().slice(0, 10));
      const note = await readNote(`06-Daily/${date}.md`);
      if (!note) return { content: [{ type: "text", text: `No daily brief for ${date}.` }] };
      return { content: [{ type: "text", text: note.content ?? "" }] };
    }

    case "list_applications": {
      const records = await listApplicationRecords();
      const applications = records.filter((note) => String(note.data.record_type || "") === "application");
      const documents = records.filter((note) => String(note.data.record_type || "") === "document");
      const documentByPath = new Map(documents.map((note) => [note.relativePath, note]));
      const paths = (value: unknown) => (Array.isArray(value) ? value : []).map(String);
      const stage = String(args.stage || "all");
      const selected = stage === "all" ? applications : applications.filter((note) => String(note.data.stage || "new") === stage);
      const payload = {
        applications: selected.map((note) => {
          const documentPaths = paths(note.data.document_paths);
          return {
            id: note.relativePath,
            title: note.title,
            company: String(note.data.company || ""),
            role: String(note.data.role || note.title),
            location: String(note.data.location || ""),
            stage: String(note.data.stage || "new"),
            offer_url: String(note.data.offer_url || ""),
            found_on: String(note.data.found_on || ""),
            applied_on: String(note.data.applied_on || ""),
            next_action: String(note.data.next_action || ""),
            next_action_date: String(note.data.next_action_date || ""),
            document_paths: documentPaths,
            documents: documentPaths.map((path) => documentByPath.get(path)).filter(Boolean).map((document) => ({
              id: document!.relativePath,
              name: document!.title,
              kind: String(document!.data.document_kind || "other"),
              url: String(document!.data.document_url || ""),
            })),
          };
        }),
        documents: documents.map((note) => ({
          id: note.relativePath,
          name: note.title,
          kind: String(note.data.document_kind || "other"),
          url: String(note.data.document_url || ""),
          version: String(note.data.version || ""),
          application_paths: applications.filter((application) => paths(application.data.document_paths).includes(note.relativePath)).map((application) => application.relativePath),
        })),
      };
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }

    case "get_training_status": {
      const stats = await computeTrailStats();
      const current = stats.weeks[stats.currentWeek - 1];
      const requestedWeek = args.week === undefined ? stats.currentWeek : Number(args.week);
      const planWeek = Number.isInteger(requestedWeek) ? stats.plan.weeks.find((item) => item.week === requestedWeek) : undefined;
      if (!planWeek) throw new Error("Training week not found");
      const start = new Date(`${stats.plan.objective.startDate}T00:00:00`);
      const overrideBySession = new Map(stats.planOverrides.map((item) => [item.sessionId, item]));
      const feedbackByActivity = new Map(stats.feedback.map((item) => [item.activityId, item]));
      const activity = (item: (typeof stats.allActivities)[number]) => ({
        id: item.id,
        date: item.date,
        sport: item.kind,
        name: item.name,
        distance_km: item.km,
        duration_min: Math.round(item.durS / 60),
        heart_rate: item.hr,
        elevation_m: item.dplus,
        strength_sets: item.strengthSets || [],
        feedback: feedbackByActivity.get(item.id) || null,
      });
      const payload = {
        source: "Nerva Training module",
        today: stats.today.toISOString().slice(0, 10),
        objective: stats.plan.objective,
        days_to_event: stats.daysToRace,
        plan_week: {
          number: planWeek.week,
          dates: planWeek.dates,
          sessions: planWeek.sessions.map((session) => {
            const override = overrideBySession.get(session.id);
            const weekday = override?.toWeekday ?? session.weekday;
            return {
              id: session.id,
              planned_date: planDateIso(planWeek.week, weekday, start),
              weekday,
              sport: session.sport,
              title: session.title,
              subtitle: session.subtitle,
              duration_min: session.durationMin,
              intensity: session.intensity,
              details: session.details,
              strength_exercises: session.sport === "strength" ? strengthProgramFor(session)?.exercises || [] : [],
              optional: Boolean(session.optional),
              override: override ? { action: override.action, reason: override.reason, activity_id: override.activityId } : null,
            };
          }),
        },
        current_week: current ? {
          number: current.plan.week,
          dates: current.plan.dates,
          phase: stats.phaseLabel,
          run_target_min: current.plan.runMinTarget,
          elevation_target_m: current.plan.dplus,
          run_done_km: current.runKm,
          run_done_min: Math.round(current.runMin),
          sessions: current.match.sessions.map((item) => ({
            id: item.session.id,
            planned_date: item.plannedIso,
            sport: item.session.sport,
            title: item.session.title,
            subtitle: item.session.subtitle,
            duration_min: item.session.durationMin,
            intensity: item.session.intensity,
            optional: Boolean(item.session.optional),
            outcome: item.outcome,
            activity: item.activity ? activity(item.activity) : null,
          })),
        } : null,
        recent_activities: stats.allActivities.slice(-8).map(activity),
        pending_feedback: stats.pendingFeedback.slice(0, 8).map(activity),
        latest_health: stats.health.days.at(-1) || null,
        readiness: stats.performance.readiness,
        insights: stats.insights,
        next_session: stats.nextSession,
      };
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }

    case "capture_insight": {
      const note = await createCapture({
        text: String(args.text || ""),
        title: args.title ? String(args.title) : undefined,
        url: args.url ? String(args.url) : undefined,
        source: "claude",
        tags: Array.isArray(args.tags) ? (args.tags as string[]) : undefined,
      });
      const derived = await processInbox(1, [note.relativePath]);
      const routed = await readNote(note.relativePath);
      const destination = String(routed?.data.route_destination || routed?.status || "needs-ai");
      const target = derived[0]?.relativePath ? ` → ${derived[0].relativePath}` : "";
      return { content: [{ type: "text", text: `Captured and classified as ${destination}${target}.` }] };
    }

    case "save_daily_chat_digest": {
      const date = String(args.date || "");
      const body = String(args.body || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
        throw new Error("Invalid digest date");
      }
      if (!body) throw new Error("Empty digest body");
      if (/^#\s/m.test(body)) throw new Error("Digest body must not contain an H1 heading");
      const note = await upsertVaultNote("raw", {
        title: `Conversations IA — ${date}`,
        filename: `${date}-conversations-ia.md`,
        overwrite: true,
        data: {
          status: "active",
          date,
          source: "chat-history",
          generated_by: "mcp:save_daily_chat_digest",
          tags: ["conversations-ia", "journal"],
        },
        body: `# Conversations IA — ${date}\n\n${body}`,
      });
      return { content: [{ type: "text", text: `Saved daily chat digest: ${note.relativePath}` }] };
    }

    case "save_wiki_note": {
      const note = await createWikiNote({
        title: String(args.title),
        summary: args.summary ? String(args.summary) : undefined,
        body: args.body ? String(args.body) : undefined,
        tags: Array.isArray(args.tags) ? (args.tags as string[]) : undefined,
      });
      return { content: [{ type: "text", text: `Saved wiki note: ${note.relativePath}` }] };
    }

    case "create_task": {
      const note = await createTask({
        title: String(args.title),
        area: String(args.area || ""),
        priority: String(args.priority || "medium"),
        why: args.why ? String(args.why) : undefined,
      });
      return { content: [{ type: "text", text: `Task created: ${note.relativePath}` }] };
    }

    case "update_task_status": {
      const status = String(args.status || "");
      if (!["todo", "doing", "waiting", "done", "abandoned", "archived"].includes(status)) throw new Error("Invalid task status");
      const note = await updateTaskStatus(String(args.task_path || ""), status);
      return { content: [{ type: "text", text: `Task updated: ${note?.relativePath || ""} (${note?.status || ""})` }] };
    }

    case "create_objective": {
      const title = String(args.title || "").trim();
      if (!title) throw new Error("Objective title is required");
      const note = await createObjective({
        title,
        area: args.area ? String(args.area) : undefined,
        priority: args.priority ? String(args.priority) : undefined,
        horizon: args.horizon ? String(args.horizon) : undefined,
        currentState: args.current_state ? String(args.current_state) : undefined,
        nextStep: args.next_step ? String(args.next_step) : undefined,
      });
      return { content: [{ type: "text", text: `Objective created: ${note.relativePath}` }] };
    }

    case "update_objective_status": {
      const status = String(args.status || "");
      if (!["active", "paused", "achieved", "abandoned", "archived"].includes(status)) throw new Error("Invalid objective status");
      const objective = await readNote(String(args.objective_path || ""));
      if (!objective || objective.kind !== "objective") throw new Error("Objective not found");
      const note = await updateNote({
        relativePath: objective.relativePath,
        title: objective.title,
        status,
        content: objective.content,
        expectedMtime: objective.mtime,
      });
      return { content: [{ type: "text", text: `Objective updated: ${note.relativePath} (${note.status})` }] };
    }

    case "record_training_feedback": {
      const feedback = await saveTrailFeedback({
        activityId: String(args.activity_id || ""),
        rpe: Number(args.rpe),
        pain: Number(args.pain),
        feeling: String(args.feeling || "neutral") as TrailFeedback["feeling"],
        note: String(args.note || "").trim(),
      });
      return { content: [{ type: "text", text: `Training feedback recorded: ${feedback.activityId}` }] };
    }

    case "adjust_training_session": {
      const action = String(args.action || "");
      const sessionId = String(args.session_id || "");
      const week = Number(args.week);
      if (!Number.isInteger(week) || week < 1) throw new Error("Invalid training week");
      if (action === "restore") {
        if (!sessionId) throw new Error("Missing session id");
        await removePlanOverride(sessionId);
        return { content: [{ type: "text", text: `Training session restored: ${sessionId}` }] };
      }
      if (action === "delete") {
        if (!sessionId) throw new Error("Missing session id");
        await deleteTrainingSession(week, sessionId);
        return { content: [{ type: "text", text: `Training session deleted: ${sessionId}` }] };
      }
      if (action === "add" || action === "replace") {
        if (action === "replace" && !sessionId) throw new Error("Missing session id");
        const session = await editTrainingSession(week, trainingSessionInput(args), action === "replace" ? sessionId : undefined);
        return { content: [{ type: "text", text: `Training session ${action === "add" ? "added" : "replaced"}: ${session.id}` }] };
      }
      if (!["move", "cancel", "validate"].includes(action) || !sessionId) throw new Error("Invalid training action");
      const override = await savePlanOverride({
        sessionId,
        week,
        action: action as PlanOverride["action"],
        toWeekday: args.to_weekday === undefined ? null : Number(args.to_weekday),
        reason: String(args.reason || ""),
        activityId: args.activity_id ? String(args.activity_id) : null,
      });
      return { content: [{ type: "text", text: `Training session adjusted: ${override.sessionId} (${override.action})` }] };
    }

    case "set_training_week": {
      const weekNumber = Number(args.week);
      const phase = args.phase === undefined ? undefined : Number(args.phase);
      const dplus = args.dplus === undefined ? undefined : Number(args.dplus);
      if (!Number.isInteger(weekNumber) || weekNumber < 1) throw new Error("Invalid training week");
      if (phase !== undefined && ![1, 2, 3].includes(phase)) throw new Error("Invalid training phase");
      if (dplus !== undefined && (!Number.isInteger(dplus) || dplus < 0)) throw new Error("Invalid elevation target");
      if (!Array.isArray(args.sessions) || !args.sessions.length) throw new Error("Missing training sessions");
      const sessions = args.sessions.map((item) => trainingSessionInput(item as Record<string, unknown>));
      const saved = await setTrainingWeek(weekNumber, {
        ...(phase === undefined ? {} : { phase: phase as 1 | 2 | 3 }),
        ...(dplus === undefined ? {} : { dplus }),
        sessions,
      });
      return { content: [{ type: "text", text: `Training week set: ${saved.week} (${saved.sessions.length} sessions)` }] };
    }

    case "create_application": {
      const note = await createApplication({
        company: args.company ? String(args.company) : undefined,
        role: String(args.role || ""),
        location: args.location ? String(args.location) : undefined,
        offerUrl: args.offer_url ? String(args.offer_url) : undefined,
        stage: args.stage ? String(args.stage) : undefined,
        nextAction: args.next_action ? String(args.next_action) : undefined,
        nextActionDate: args.next_action_date ? String(args.next_action_date) : undefined,
        notes: args.notes ? String(args.notes) : undefined,
        source: "mcp",
      });
      return { content: [{ type: "text", text: `Application created: ${note.relativePath}` }] };
    }

    case "update_application_stage": {
      const note = await updateApplicationStage(String(args.application_path || ""), String(args.stage || ""));
      return { content: [{ type: "text", text: `Application updated: ${note?.relativePath || ""}` }] };
    }

    case "create_application_document": {
      const note = await createApplicationDocument({
        name: String(args.name || ""),
        kind: args.kind ? String(args.kind) : undefined,
        url: String(args.url || ""),
        version: args.version ? String(args.version) : undefined,
        notes: args.notes ? String(args.notes) : undefined,
        applicationPath: args.application_path ? String(args.application_path) : undefined,
      });
      return { content: [{ type: "text", text: `Application document created: ${note.relativePath}` }] };
    }

    case "link_application_document": {
      const note = await linkApplicationDocument(
        String(args.application_path || ""),
        String(args.document_path || ""),
        args.linked !== false,
      );
      return { content: [{ type: "text", text: `Application documents updated: ${note?.relativePath || ""}` }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handle(id: unknown, method: string, params: Record<string, unknown>, auth: AuthContext) {
  if (method === "initialize") {
    const requested = (params as { protocolVersion?: string })?.protocolVersion;
    return ok(id, {
      protocolVersion: requested || PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "second-brain", version: "1.0.0" },
    });
  }

  if (method === "notifications/initialized") return null;

  if (method === "tools/list") {
    return ok(id, { tools: TOOLS.filter((tool) => auth.scopes.has(toolScope(tool.name))) });
  }

  if (method === "tools/call") {
    const p = params as { name?: string; arguments?: Record<string, unknown> };
    const toolName = p.name ?? "";
    const toolArgs = p.arguments ?? {};
    if (!auth.scopes.has(toolScope(toolName))) return err(id, -32001, "Insufficient OAuth scope");
    try {
      const result = await callTool(toolName, toolArgs);
      return ok(id, result);
    } catch (error) {
      return ok(id, {
        content: [{ type: "text", text: toolFailureMessage(error) }],
        isError: true,
      });
    }
  }

  return err(id, -32601, `Method not found: ${method}`);
}

export async function POST(req: NextRequest) {
  const auth = authenticateRequest(req, { scope: "read" })
    ?? authenticateRequest(req, { scope: "write" });
  if (!auth) {
    const base = process.env.NEXT_PUBLIC_MCP_BASE_URL ?? "";
    return withCors(NextResponse.json({ error: "unauthorized" }, {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer realm="second-brain", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      },
    }), req);
  }

  let body: unknown;
  try {
    if (req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new RequestBodyError("content-type must be application/json", 415);
    }
    body = JSON.parse(await readRequestText(req, 512 * 1024));
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return withCors(NextResponse.json(err(null, -32700, "Parse error"), { status }), req);
  }

  const parseMessage = (message: unknown) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return null;
    const value = message as Record<string, unknown>;
    if (typeof value.method !== "string" || value.method.length > 100) return null;
    const params = value.params === undefined
      ? {}
      : value.params && typeof value.params === "object" && !Array.isArray(value.params)
        ? value.params as Record<string, unknown>
        : null;
    return params ? { id: value.id, method: value.method, params } : null;
  };

  // Batch support
  if (Array.isArray(body)) {
    if (!body.length || body.length > 50) {
      return withCors(NextResponse.json(err(null, -32600, "Invalid batch"), { status: 400 }), req);
    }
    const results = await Promise.all(body.map((message) => {
      const parsed = parseMessage(message);
      return parsed ? handle(parsed.id, parsed.method, parsed.params, auth) : err(null, -32600, "Invalid Request");
    }));
    const filtered = results.filter(Boolean);
    return withCors(NextResponse.json(filtered), req);
  }

  if (!body || typeof body !== "object") {
    return withCors(NextResponse.json(err(null, -32600, "Invalid Request"), { status: 400 }), req);
  }

  const parsed = parseMessage(body);
  if (!parsed) return withCors(NextResponse.json(err(null, -32600, "Invalid Request"), { status: 400 }), req);
  const requestedSessionId = req.headers.get("mcp-session-id") ?? "";
  const sessionId = /^[A-Za-z0-9._~-]{1,128}$/.test(requestedSessionId) ? requestedSessionId : "second-brain-session";
  const result = await handle(parsed.id, parsed.method, parsed.params, auth);

  if (!result) {
    return withCors(new NextResponse(null, { status: 202, headers: { "Mcp-Session-Id": sessionId } }), req);
  }

  // Streamable HTTP: if the client accepts SSE, stream the JSON-RPC response as an event.
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream")) {
    const stream = `event: message\ndata: ${JSON.stringify(result)}\n\n`;
    const res = new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "Mcp-Session-Id": sessionId,
      },
    });
    return withCors(res, req);
  }

  const res = withCors(NextResponse.json(result), req);
  res.headers.set("Mcp-Session-Id", sessionId);
  return res;
}

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(req: NextRequest) {
  if (!authenticateRequest(req, { scope: "read" })) {
    const base = process.env.NEXT_PUBLIC_MCP_BASE_URL ?? "";
    return withCors(NextResponse.json({ error: "unauthorized" }, {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer realm="second-brain", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      },
    }), req);
  }
  // Streamable HTTP: this server offers no standalone SSE listen stream, so
  // the spec requires 405 here (a 200 JSON body breaks conforming clients).
  return withCors(new NextResponse(null, { status: 405, headers: { Allow: "POST, OPTIONS" } }), req);
}
