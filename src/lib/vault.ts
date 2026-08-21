import fs from "node:fs/promises";
import path from "node:path";
import { todayISO, weekEndISO, weekId, weekStartISO } from "@/lib/dates";
import { fetchFeed } from "@/lib/rss";
import { atomicWriteFile, withFileWriteLock } from "@/lib/atomic-write";
import { isSyncConflictPath } from "@/lib/vault-lint";
import { planAllowsAiSynthesis, planAllowsAssistant, assistantMonthlyQuota } from "@/lib/plan";
import { recordUsage, usageCount } from "@/lib/usage";
import { fetchFxRate, fetchMarketHistory, fetchMarketQuote, type MarketHistoryPoint, type MarketQuote } from "@/lib/finance-market";
import { sanitizeBriefOutput, setMarkdownChecklistState } from "@/lib/markdown";
import { isProtectedVaultPath } from "@/lib/vault-protection";
import {
  normalizeSuggestions,
  readBriefSuggestions,
  writeBriefSuggestions,
  type BriefSuggestion,
  type RawBriefSuggestion,
} from "@/lib/brief-suggestions";

export { FileWriteConflictError } from "@/lib/atomic-write";

export const VAULT_FOLDERS = {
  system: "00-System",
  inbox: "01-Inbox",
  raw: "02-Raw",
  wiki: "03-Wiki",
  objectives: "04-Objectives",
  tasks: "05-Tasks",
  daily: "06-Daily",
  weekly: "07-Weekly",
  finance: "10-Finance",
  business: "12-Business",
} as const;

export const DEFAULT_REVISION_PROJECT_DIR = "08-Projects/Revisions";
export const DEFAULT_REVISION_PROGRAM_FILE = "Programme-Revisions.md";

export type VaultFolder = keyof typeof VAULT_FOLDERS;

export type VaultNote = {
  id: string;
  title: string;
  relativePath: string;
  folder: string;
  kind: string;
  data: Record<string, unknown>;
  content: string;
  excerpt: string;
  tags: string[];
  links: string[];
  status: string;
  mtime: string;
};

export type BriefFeedbackVerdict = "useful" | "not_useful";

export type BriefFeedbackRecord = {
  kind: "daily" | "weekly";
  period: string;
  verdict: BriefFeedbackVerdict;
  reason: string;
  recordedAt: string;
};

export function noteForClient(note: VaultNote): VaultNote {
  return {
    ...note,
    // YAML parsers may attach internal symbol metadata. React Server Components
    // only accept plain serializable props, so keep public string-keyed fields.
    data: Object.fromEntries(Object.entries(note.data)),
  };
}

export type DashboardData = {
  vaultRoot: string;
  /** Complete Markdown index for this read; the cold _Archive tree is excluded by listAllNotes. */
  allNotes: VaultNote[];
  inbox: VaultNote[];
  raw: VaultNote[];
  objectives: VaultNote[];
  tasks: VaultNote[];
  daily: VaultNote[];
  weekly: VaultNote[];
  wiki: VaultNote[];
  system: VaultNote[];
  /** Custom pages the user opted into the daily via `daily: true` frontmatter. */
  custom: VaultNote[];
  /** Inputs/Process/Outputs/Feedback and other notes from 08-Projects/*, excluding _Template. */
  projects: VaultNote[];
};

type WriteInput = {
  title: string;
  data?: Record<string, unknown>;
  body: string;
  filename?: string;
};

type BriefTask = {
  title: string;
  area?: string;
  why?: string;
  objective?: string;
  exec_kind?: string;
};

// Classification from Agent-Operating-Guardrails.md ("Auto-execution des taches
// todo"): what an agent may do with the task without asking.
const EXEC_KINDS = new Set(["vault", "verify", "prepare", "manual"]);

function normalizeExecKind(value?: string) {
  const kind = (value || "").trim().toLowerCase();
  return EXEC_KINDS.has(kind) ? kind : "";
}

type AiBriefResponse = {
  ok?: boolean;
  brief?: string;
  engine?: string;
  tasks?: BriefTask[];
  suggestions?: unknown;
};

type AiProcessResponse = {
  ok?: boolean;
  engine?: string;
  keep?: boolean;
  discard_reason?: string;
  title?: string;
  summary?: string;
  insight?: string;
  open_question?: string;
  next_action?: string;
  tags?: string[];
  objective_titles?: string[];
  duplicate_path?: string;
  destination?: "archive" | "raw" | "wiki" | "task";
  library_score?: number;
  library_reason?: string;
  area?: string;
  priority?: string;
  exec_kind?: string;
};

type AiWeeklyResponse = {
  ok?: boolean;
  review?: string;
  engine?: string;
  suggestions?: unknown;
};

const FOLDER_KIND: Record<VaultFolder, string> = {
  system: "system",
  inbox: "capture",
  raw: "raw",
  wiki: "wiki",
  objectives: "objective",
  tasks: "task",
  daily: "daily",
  weekly: "weekly",
  finance: "finance-position",
  business: "business-record",
};

const FINANCE_ASSET_TYPES = new Set(["etf", "stock", "crypto", "savings", "life_insurance", "real_estate", "bonds", "other"]);
const FINANCE_HISTORY_FILE = "00-System/.finance-history.json";
export const BUSINESS_STAGES = ["lead", "contacted", "qualified", "proposal", "won", "lost"] as const;
export type BusinessStage = (typeof BUSINESS_STAGES)[number];
export const BUSINESS_INVOICE_STATUSES = ["draft", "sent", "paid"] as const;
export type BusinessInvoiceStatus = (typeof BUSINESS_INVOICE_STATUSES)[number];
export type BusinessSettings = { currency: string; monthlyRevenueGoal: number };
const BUSINESS_SETTINGS_NOTE = `${VAULT_FOLDERS.system}/Business.md`;

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const DECORATIVE_EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\uFE0F?/gu;
const OPEN_TASK_STATUSES = new Set(["todo", "doing", "active"]);
const DONE_TASK_STATUSES = new Set(["done"]);
const CLOSED_TASK_STATUSES = new Set(["done", "abandoned"]);
const BRIEF_READY_CAPTURE_STATUSES = new Set(["briefed", "processed"]);
const PROCESS_INBOX_SKILL = "09-Skills/process-inbox/SKILL.md";
const DAILY_SKILL = "09-Skills/synthesize-daily/SKILL.md";
const WEEKLY_SKILL = "09-Skills/synthesize-weekly/SKILL.md";

const BRIEF_DETAIL_CAPS: Record<BriefDetail, { links: number; risks: number; pages: number; completed: number; open: number }> = {
  concise: { links: 1, risks: 1, pages: 0, completed: 3, open: 3 },
  balanced: { links: 2, risks: 2, pages: 3, completed: 6, open: 6 },
  detailed: { links: 4, risks: 4, pages: 5, completed: 8, open: 10 },
};

const FEEDS_NOTE = `${VAULT_FOLDERS.system}/Feeds.md`;
const BUDGET_NOTE = `${VAULT_FOLDERS.system}/Budget.md`;
const FEED_STATE_FILE = ".rss-state.json";
const FEED_STATE_CAP = 300;
const SETUP_STATE_FILE = ".second-brain-setup.json";
const LEGACY_DEMO_CLEANUP_MARKER = ".second-brain-demo-cleanup-v1";
const SETUP_STATE_VERSION = 1 as const;
const DEFAULT_CONTEXT_BODY = [
  "# System Context",
  "",
  "## Identity",
  "Replace this with the durable context the assistant should know before every run.",
  "",
  "## Operating rules",
  "- Keep the vault as the source of truth.",
  "- Prefer small, linked notes over large documents.",
  "- Never delete source material without an explicit archive step.",
  "",
  "## Current priorities",
  "No priority configured yet.",
].join("\n");
const LEGACY_DEFAULT_CONTEXT_BODY = DEFAULT_CONTEXT_BODY.replace(
  "No priority configured yet.",
  "- [[Build the Obsidian second brain]]",
);
const LEGACY_DEMO_OBJECTIVE_BODY = [
  "# Build the Obsidian second brain",
  "",
  "## Current state",
  "A first local Next.js dashboard reads and writes a Markdown vault.",
  "",
  "## Next step",
  "Use the dashboard for real captures, then refine the daily brief loop.",
].join("\n");
// Deliberately empty: seeding personal feed choices into a generic install
// would invent a profile. First-run feeds come from WATCH_RSS_FEEDS or the
// dashboard's feed settings; the user's live list persists in 00-System/Feeds.md.
const DEFAULT_FEEDS: string[] = [];

export const SETUP_STEPS = ["language", "ai", "context", "modules", "feeds", "goals", "review"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export type SetupGoal = { title: string; area: string; nextStep: string };
export type AiProvider = "claude" | "codex";
export type AiModelPreferences = Record<AiProvider, string>;
export type BriefFrequency = "manual" | "daily" | "twice_daily" | "weekly" | "monthly";
export type BriefDetail = "concise" | "balanced" | "detailed";
export type SetupState = {
  version: typeof SETUP_STATE_VERSION;
  status: "draft" | "completed";
  currentStep: SetupStep;
  locale: "fr" | "en";
  theme: "dark" | "light";
  timezone: string;
  currency: string;
  context: {
    identity: string;
    focusAreas: string;
    weeklyRhythm: string;
    contactEmail: string;
    operatingRules: string[];
    currentPriorities: string[];
  };
  modules: { finance: boolean; budget: boolean; trail: boolean; trailSync: boolean; business: boolean; revisions: boolean; custom: string[] };
  feeds: { enabled: boolean; urls: string[] };
  ai: {
    primary: "" | AiProvider;
    fallback: "" | AiProvider;
    verified: AiProvider[];
    models: AiModelPreferences;
  };
  automation: {
    briefFrequency: BriefFrequency;
    briefTime: string;
    briefTime2: string;
    briefDetail: BriefDetail;
    dailyBriefProvider: "" | AiProvider;
    dailyBriefModel: string;
    dailyBriefPrompt: string;
  };
  goals: SetupGoal[];
};

export type ActiveModuleKey = "finance" | "budget" | "business" | "training" | "revisions" | "custom";
export type ActiveModuleEvidence = Partial<Record<ActiveModuleKey, {
  state: "ready" | "empty";
  total: number;
  pages?: string[];
  notes: Array<{
    title: string;
    status: string;
    tags: string[];
    path: string;
    date: string;
    updated: string;
    excerpt: string;
    content: string;
  }>;
}>>;

export type FeedsConfig = {
  feeds: string[];
  enabled: boolean;
  lastRun: string;
  lastCount: number;
  relativePath: string;
};

export type IngestResult = {
  ranAt: string;
  added: number;
  perFeed: Record<string, { added: number; error?: string }>;
};

let ingestRunning = false;

export function vaultRoot() {
  const configured = process.env.SECOND_BRAIN_VAULT;
  if (configured && path.isAbsolute(configured)) return configured;
  // Relative paths are part of the documented local-development contract and
  // are also commonly supplied by Compose through .env.
  return path.join(/*turbopackIgnore: true*/ process.cwd(), configured || "vault");
}

export function noteHref(note: Pick<VaultNote, "relativePath">) {
  return "/note/" + note.relativePath.split("/").map(encodeURIComponent).join("/");
}

export function editHref(note: Pick<VaultNote, "relativePath">) {
  return "/edit/" + note.relativePath.split("/").map(encodeURIComponent).join("/");
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "note";
}

export async function ensureVault() {
  const root = vaultRoot();
  await Promise.all(
    Object.values(VAULT_FOLDERS).map((folder) => fs.mkdir(path.join(root, folder), { recursive: true })),
  );

  await cleanupLegacyDemoContent();

  const marker = path.join(root, ".second-brain-initialized");
  if (await exists(marker)) return;

  const existingContext = path.join(root, VAULT_FOLDERS.system, "Context.md");
  if (await exists(existingContext)) {
    await atomicWriteFile(marker, new Date().toISOString());
    return;
  }

  await writeNote("system", {
    title: "System Context",
    filename: "Context.md",
    data: {
      type: "system",
      role: "identity",
      updated: new Date().toISOString(),
    },
    body: DEFAULT_CONTEXT_BODY,
  });

  await atomicWriteFile(marker, new Date().toISOString());
}

async function cleanupLegacyDemoContent() {
  const marker = path.join(vaultRoot(), LEGACY_DEMO_CLEANUP_MARKER);
  if (await exists(marker)) return;

  const folders = [VAULT_FOLDERS.objectives, VAULT_FOLDERS.tasks];
  const files = (await Promise.all(folders.map((folder) => walkMarkdown(path.join(vaultRoot(), folder))))).flat();
  for (const file of files) {
    const note = await readNoteFromFile(file);
    if (!note) continue;
    const isGeneratedTask = note.title === "Launch the local dashboard" && stringValue(note.data.source) === "seed";
    const isGeneratedObjective = note.title === "Build the Obsidian second brain"
      && note.content.trim() === LEGACY_DEMO_OBJECTIVE_BODY;
    if (isGeneratedTask || isGeneratedObjective) await deleteNote(note.relativePath);
  }

  const contextPath = `${VAULT_FOLDERS.system}/Context.md`;
  const context = await readNoteFromFile(resolveVaultPath(contextPath));
  if (context?.content.trim() === LEGACY_DEFAULT_CONTEXT_BODY.trim()) {
    await writeRawNote(contextPath, context.data, DEFAULT_CONTEXT_BODY);
  }
  await atomicWriteFile(marker, new Date().toISOString());
}

function defaultSetupState(): SetupState {
  return {
    version: SETUP_STATE_VERSION,
    status: "draft",
    currentStep: "language",
    locale: "fr",
    theme: "dark",
    timezone: process.env.TZ?.trim() || "UTC",
    currency: "EUR",
    context: {
      identity: "",
      focusAreas: "",
      weeklyRhythm: "",
      contactEmail: "",
      operatingRules: [],
      currentPriorities: [],
    },
    modules: { finance: false, budget: false, trail: false, trailSync: true, business: false, revisions: false, custom: [] },
    feeds: { enabled: false, urls: [] },
    ai: { primary: "", fallback: "", verified: [], models: { claude: "", codex: "" } },
    automation: {
      briefFrequency: "manual",
      briefTime: "07:00",
      briefTime2: "17:00",
      briefDetail: "concise",
      dailyBriefProvider: "",
      dailyBriefModel: "",
      dailyBriefPrompt: "",
    },
    goals: [],
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function setupLines(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n|,/) : [];
  return values.map(String).map((item) => item.trim()).filter(Boolean);
}

function setupEngine(value: unknown): SetupState["ai"]["primary"] {
  const clean = String(value || "").trim().toLowerCase();
  if (clean === "chatgpt" || clean === "openai") return "codex";
  return clean === "claude" || clean === "codex" ? clean : "";
}

function setupModel(value: unknown) {
  const model = String(value || "").trim();
  if (model === "default" || model === "none") return "";
  return model.length <= 160 && /^[a-zA-Z0-9._:/@-]*$/.test(model) ? model : "";
}

function setupUrls(value: unknown): string[] {
  const urls = setupLines(value);
  return [...new Set(urls.flatMap((url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? [parsed.toString()] : [];
    } catch {
      return [];
    }
  }))];
}

function normalizeSetupState(value: unknown, legacyCompleted = false): SetupState {
  const raw = record(value);
  const defaults = defaultSetupState();
  const context = record(raw.context);
  const modules = record(raw.modules);
  const feeds = record(raw.feeds);
  const ai = record(raw.ai);
  const aiModels = record(ai.models);
  const automation = record(raw.automation);
  const currentStep = SETUP_STEPS.includes(raw.currentStep as SetupStep)
    ? raw.currentStep as SetupStep
    : defaults.currentStep;
  const completed = legacyCompleted || raw.status === "completed" || raw.completed === true;
  const locale = raw.locale === "en" ? "en" : "fr";
  const theme = raw.theme === "light" ? "light" : "dark";
  const currency = String(raw.currency || defaults.currency).trim().toUpperCase();
  const rawGoals = Array.isArray(raw.goals) ? raw.goals : [];

  return {
    version: SETUP_STATE_VERSION,
    status: completed ? "completed" : "draft",
    currentStep: completed && legacyCompleted ? "review" : currentStep,
    locale,
    theme,
    timezone: String(raw.timezone || defaults.timezone).trim() || defaults.timezone,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : defaults.currency,
    context: {
      identity: String(context.identity ?? raw.identity ?? "").trim(),
      focusAreas: String(context.focusAreas ?? raw.focusAreas ?? "").trim(),
      weeklyRhythm: String(context.weeklyRhythm ?? raw.weeklyRhythm ?? "").trim(),
      contactEmail: String(context.contactEmail ?? raw.contactEmail ?? "").trim(),
      operatingRules: setupLines(context.operatingRules ?? raw.operatingRules),
      currentPriorities: setupLines(context.currentPriorities ?? raw.currentPriorities),
    },
    modules: {
      finance: typeof modules.finance === "boolean" ? modules.finance : completed,
      budget: typeof modules.budget === "boolean" ? modules.budget : completed,
      trail: typeof modules.trail === "boolean" ? modules.trail : completed,
      // Absent on profiles saved before the toggle existed: keep syncing.
      trailSync: typeof modules.trailSync === "boolean" ? modules.trailSync : true,
      business: typeof modules.business === "boolean" ? modules.business : false,
      revisions: typeof modules.revisions === "boolean"
        ? modules.revisions
        : Boolean(process.env.REVISION_PROJECT_DIR?.trim()
          && process.env.REVISION_PROJECT_DIR.trim().replace(/^\/+|\/+$/g, "") !== DEFAULT_REVISION_PROJECT_DIR),
      custom: setupLines(modules.custom),
    },
    feeds: {
      enabled: typeof feeds.enabled === "boolean" ? feeds.enabled : defaults.feeds.enabled,
      urls: setupUrls(feeds.urls ?? raw.feeds),
    },
    ai: {
      primary: setupEngine(ai.primary ?? raw.aiPrimary),
      fallback: setupEngine(ai.fallback ?? raw.aiFallback),
      verified: [...new Set(setupLines(ai.verified).map(setupEngine).filter(Boolean))] as AiProvider[],
      models: {
        claude: setupModel(aiModels.claude ?? ai.claudeModel ?? raw.aiClaudeModel),
        codex: setupModel(aiModels.codex ?? ai.codexModel ?? raw.aiCodexModel),
      },
    },
    automation: {
      briefFrequency: ["daily", "twice_daily", "weekly", "monthly"].includes(String(automation.briefFrequency))
        ? automation.briefFrequency as BriefFrequency
        : "manual",
      briefTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(automation.briefTime || ""))
        ? String(automation.briefTime)
        : "07:00",
      briefTime2: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(automation.briefTime2 || ""))
        ? String(automation.briefTime2)
        : "17:00",
      briefDetail: ["concise", "balanced", "detailed"].includes(String(automation.briefDetail))
        ? automation.briefDetail as BriefDetail
        : "concise",
      dailyBriefProvider: setupEngine(automation.dailyBriefProvider),
      dailyBriefModel: setupModel(automation.dailyBriefModel),
      dailyBriefPrompt: String(automation.dailyBriefPrompt || "").trim().slice(0, 12000),
    },
    goals: rawGoals.flatMap((value): SetupGoal[] => {
      const goal = record(value);
      const title = String(goal.title || "").trim();
      return title ? [{
        title,
        area: String(goal.area || "Projects").trim() || "Projects",
        nextStep: String(goal.nextStep || "").trim(),
      }] : [];
    }),
  };
}

function isPlaceholderContext(context: VaultNote | null) {
  const content = context?.content.trim();
  return content === DEFAULT_CONTEXT_BODY.trim() || content === LEGACY_DEFAULT_CONTEXT_BODY.trim();
}

function isLegacySetupComplete(context: VaultNote | null) {
  if (!context) return false;
  if (stringValue(context.data.setup_completed_at)) return true;
  return !isPlaceholderContext(context);
}

function legacyAiPreference(context: VaultNote | null, key: "ai_primary" | "ai_fallback", label: string) {
  const frontmatter = setupEngine(context?.data[key]);
  if (frontmatter) return frontmatter;
  return setupEngine(context?.content.match(new RegExp(`^-\\s*${label}:\\s*(.+)$`, "im"))?.[1]);
}

export function setupPath(step: SetupStep) {
  return `/setup/${step}`;
}

export async function saveSetupState(state: SetupState): Promise<SetupState> {
  await ensureVault();
  const normalized = normalizeSetupState(state);
  await atomicWriteFile(resolveVaultPath(SETUP_STATE_FILE), `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export async function setAiProviderVerified(provider: AiProvider, connected: boolean): Promise<SetupState> {
  const state = await readSetupState();
  const verified = connected
    ? [...new Set([...state.ai.verified, provider])]
    : state.ai.verified.filter((item) => item !== provider);
  const existingOrder = [state.ai.primary, state.ai.fallback].filter(
    (item): item is AiProvider => Boolean(item) && verified.includes(item as AiProvider),
  );
  const primary = existingOrder[0] || verified[0] || "";
  const fallback = verified.find((item) => item !== primary) || "";
  return saveSetupState({
    ...state,
    ai: { ...state.ai, verified, primary, fallback },
  });
}

export async function readSetupState(): Promise<SetupState> {
  await ensureVault();
  const file = resolveVaultPath(SETUP_STATE_FILE);
  let raw: unknown;
  let found = true;
  try {
    raw = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    found = (error as NodeJS.ErrnoException).code !== "ENOENT";
    raw = undefined;
  }
  if (found && raw !== undefined) return normalizeSetupState(raw);

  const context = await readNote(`${VAULT_FOLDERS.system}/Context.md`);
  const legacyCompleted = !found && isLegacySetupComplete(context);
  const migrated = normalizeSetupState(legacyCompleted ? {
    ai: {
      primary: legacyAiPreference(context, "ai_primary", "Primary"),
      fallback: legacyAiPreference(context, "ai_fallback", "Fallback"),
      models: {
        claude: setupModel(context?.data.ai_claude_model),
        codex: setupModel(context?.data.ai_codex_model),
      },
    },
  } : undefined, legacyCompleted);
  return saveSetupState(migrated);
}

export async function isSetupComplete() {
  return (await readSetupState()).status === "completed";
}

export async function saveSystemContext(input: {
  identity: string;
  operatingRules: string;
  currentPriorities: string;
  contactEmail?: string;
  aiPrimary?: string;
  aiFallback?: string;
  aiModels?: AiModelPreferences;
}) {
  const relativePath = `${VAULT_FOLDERS.system}/Context.md`;
  const note = await readNote(relativePath);
  const now = new Date().toISOString();
  const body = [
    "# System Context",
    "",
    "## Identity",
    input.identity.trim() || "Replace this with the durable context the assistant should know before every run.",
    "",
    input.contactEmail?.trim() ? `Contact email: ${input.contactEmail.trim()}` : "",
    input.contactEmail?.trim() ? "" : "",
    "## Operating rules",
    input.operatingRules.trim() || "- Keep the vault as the source of truth.",
    "",
    "## Current priorities",
    input.currentPriorities.trim() || "No priority configured yet.",
    "",
    "## AI preference",
    `- Primary: ${input.aiPrimary || "none"}`,
    `- Fallback: ${input.aiFallback || "none"}`,
    `- Claude model: ${input.aiModels?.claude || "default"}`,
    `- Codex model: ${input.aiModels?.codex || "default"}`,
  ].filter((line, index, lines) => line || lines[index - 1] !== "").join("\n");

  await writeRawNote(
    relativePath,
    {
      ...(note?.data || {}),
      type: "system",
      role: "identity",
      title: "System Context",
      updated: now,
      ai_primary: input.aiPrimary || "none",
      ai_fallback: input.aiFallback || "none",
      ai_claude_model: input.aiModels?.claude || "default",
      ai_codex_model: input.aiModels?.codex || "default",
    },
    body,
    note ? { expectedMtime: note.mtime } : {},
  );
}

export async function finalizeSetup(): Promise<SetupState> {
  const state = await readSetupState();
  const french = state.locale === "fr";
  const rules = state.context.operatingRules.map((line) => `- ${line.replace(/^[-*]\s*/, "")}`).join("\n");
  const priorities = state.context.currentPriorities.map((line) => `- ${line.replace(/^[-*]\s*/, "")}`).join("\n");
  const identity = [
    state.context.identity,
    state.context.focusAreas ? `${french ? "À améliorer" : "What to improve"}: ${state.context.focusAreas}` : "",
    state.context.weeklyRhythm ? `${french ? "Rythme souhaité" : "Desired review rhythm"}: ${state.context.weeklyRhythm}` : "",
  ].filter(Boolean).join("\n\n");
  const existingContext = await readNote(`${VAULT_FOLDERS.system}/Context.md`);
  const hasContextInput = Boolean(identity || rules || priorities || state.context.contactEmail);
  if (hasContextInput || !existingContext || isPlaceholderContext(existingContext)) {
    await saveSystemContext({
      identity,
      operatingRules: rules,
      currentPriorities: priorities,
      contactEmail: state.context.contactEmail,
      aiPrimary: state.ai.primary,
      aiFallback: state.ai.fallback,
      aiModels: state.ai.models,
    });
  } else {
    const data = carryRawFrontmatter(existingContext.data, {
      ...existingContext.data,
      updated: new Date().toISOString(),
      ai_primary: state.ai.primary || "none",
      ai_fallback: state.ai.fallback || "none",
      ai_claude_model: state.ai.models.claude || "default",
      ai_codex_model: state.ai.models.codex || "default",
    });
    await writeRawNote(existingContext.relativePath, data, existingContext.content, { expectedMtime: existingContext.mtime });
  }

  const existingGoals = new Set((await listNotes("objectives")).map((note) => note.title.trim().toLowerCase()));
  for (const goal of state.goals) {
    const key = goal.title.trim().toLowerCase();
    if (!key || existingGoals.has(key)) continue;
    existingGoals.add(key);
    await createObjective({
      title: goal.title,
      area: goal.area,
      priority: "high",
      horizon: "Now",
      currentState: french ? "Créé pendant le setup initial." : "Created during initial setup.",
      nextStep: goal.nextStep,
    });
  }

  const existingPages = new Set((await listCustomPages()).map((page) => page.title.trim().toLowerCase()));
  for (const title of state.modules.custom) {
    const key = title.trim().toLowerCase();
    if (!key || existingPages.has(key)) continue;
    existingPages.add(key);
    await createCustomPage(title);
  }

  for (const url of state.feeds.urls) await addFeed(url);
  await setFeedsEnabled(state.feeds.enabled);

  return saveSetupState({ ...state, status: "completed", currentStep: "review" });
}

export async function configureRevisionProgram(input: {
  title: string;
  examDate: string;
  modules: string[];
  locale: SetupState["locale"];
}) {
  const title = input.title.replace(/[\r\n|]+/g, " ").trim().slice(0, 160);
  const examDate = input.examDate.trim();
  const modules = [...new Map(input.modules
    .map((label) => label.replace(/[\r\n|]+/g, " ").trim().slice(0, 120))
    .filter(Boolean)
    .map((label) => [slugify(label), label] as const)).entries()].slice(0, 20);
  const parsedExamDate = new Date(`${examDate}T12:00:00Z`);
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(examDate) || Number.isNaN(parsedExamDate.getTime()) || parsedExamDate.toISOString().slice(0, 10) !== examDate || !modules.length) {
    throw new Error("Invalid revision program");
  }

  const projectDir = (process.env.REVISION_PROJECT_DIR?.trim() || DEFAULT_REVISION_PROJECT_DIR).replace(/^\/+|\/+$/g, "");
  const programFile = (process.env.REVISION_PROGRAM_FILE?.trim() || DEFAULT_REVISION_PROGRAM_FILE).replace(/^\/+/, "");
  const programPath = `${projectDir}/${programFile}`;
  const existing = await readNote(programPath);
  const french = input.locale === "fr";
  const accents = ["violet", "blue", "amber", "green", "cyan", "pink"];
  const revisionModules = modules.map(([id, label], index) => `${id}|${label}|${label}|${accents[index % accents.length]}|${id}`);
  const now = new Date().toISOString();
  await writeRawNote(programPath, carryRawFrontmatter(existing?.data || {}, {
    ...(existing?.data || {}),
    type: "revision_program",
    title,
    revision_id: typeof existing?.data.revision_id === "string" ? existing.data.revision_id : slugify(title),
    revision_title: title,
    revision_description: french ? "Cours, rappel actif et entraînement jusqu’à l’échéance." : "Notes, active recall and practice through the deadline.",
    revision_exam_label: french ? "Échéance" : "Deadline",
    start_date: typeof existing?.data.start_date === "string" ? existing.data.start_date : todayISO(),
    exam_date: examDate,
    revision_modules: revisionModules,
    updated: now,
  }), existing?.content || `# ${title}`, existing ? { expectedMtime: existing.mtime } : {});

  for (const [, label] of modules) {
    const suffix = slugify(label);
    const sources: Array<[string, string]> = [
      [`Fiche-Exhaustive-${suffix}.md`, french ? "Cours complet et liens sources" : "Full notes and source links"],
      [`Fiche-${suffix}.md`, french ? "À retenir" : "High-yield notes"],
      [`Flashcards-${suffix}.md`, "Flashcards"],
      [`QCM-${suffix}.md`, french ? "Questions" : "Quiz"],
      [`Palais-Mental-${suffix}.md`, french ? "Palais mental" : "Memory palace"],
      [`Récitation-${suffix}.md`, french ? "Récitation active" : "Active recall"],
    ];
    for (const [filename, sourceTitle] of sources) {
      const relativePath = `${projectDir}/${filename}`;
      if (!await readNote(relativePath)) {
        await writeRawNote(relativePath, { type: "revision_source", title: sourceTitle, created: now, updated: now }, `# ${label}\n\n## ${sourceTitle}`);
      }
    }
  }

  return readNote(programPath);
}

// Every page render calls getDashboard (twice: page + AppShell), each call
// re-reading the whole vault from an SD card on the Pi. A tiny TTL cache keyed
// by vault root absorbs the duplicate reads of one navigation while staying
// short enough that external edits (Obsidian, Syncthing) appear within seconds.
// Any write through this module invalidates it immediately.
const DASHBOARD_CACHE_TTL_MS = 3_000;
let dashboardCache: { root: string; at: number; data: Promise<DashboardData> } | null = null;
let allNotesCache: { root: string; at: number; data: Promise<VaultNote[]> } | null = null;

export function invalidateDashboardCache() {
  dashboardCache = null;
  allNotesCache = null;
}

export async function getDashboard(): Promise<DashboardData> {
  const root = vaultRoot();
  const now = Date.now();
  if (dashboardCache && dashboardCache.root === root && now - dashboardCache.at < DASHBOARD_CACHE_TTL_MS) {
    return dashboardCache.data;
  }
  const pending = readDashboard();
  dashboardCache = { root, at: now, data: pending };
  try {
    return await pending;
  } catch (error) {
    // Never cache a failure.
    if (dashboardCache?.data === pending) dashboardCache = null;
    throw error;
  }
}

async function readDashboard(): Promise<DashboardData> {
  await ensureVault();
  const notes = await listAllNotes();
  const inFolder = (folder: VaultFolder) => notes.filter((note) => note.folder === VAULT_FOLDERS[folder]);
  const inbox = inFolder("inbox");
  const raw = inFolder("raw");
  const objectives = inFolder("objectives");
  const tasks = inFolder("tasks");
  const daily = inFolder("daily");
  const weekly = inFolder("weekly");
  const wiki = inFolder("wiki");
  const system = inFolder("system");
  const customRegistry = notes.filter((note) => note.relativePath.startsWith(`${CUSTOM_REGISTRY_DIR}/`));
  const projects = notes.filter((note) => note.relativePath.startsWith(`${PROJECTS_ROOT}/`) && !note.relativePath.split("/").includes("_Template"));

  // Only pages the user explicitly opted into feed the daily, so scratch pages
  // don't drown the brief.
  const custom = customRegistry.filter((note) => note.data.daily === true && note.status !== "archived");

  return {
    vaultRoot: vaultRoot(),
    allNotes: notes,
    inbox: sortNotes(inbox, ["captured_at", "created", "updated"]),
    raw: sortNotes(raw, ["updated", "created"]),
    objectives: sortObjectives(objectives),
    tasks: sortTasks(tasks),
    daily: sortNotes(daily, ["date", "created", "updated"]),
    weekly: sortNotes(weekly, ["week_end", "created", "updated"]),
    wiki: sortNotes(wiki, ["updated", "created"]),
    system,
    custom: sortNotes(custom, ["updated", "created"]),
    projects: sortNotes(projects, ["updated", "created"]),
  };
}

export async function listNotes(folder: VaultFolder) {
  await ensureVault();
  const root = vaultRoot();
  const folderPath = path.join(root, VAULT_FOLDERS[folder]);
  const files = await walkMarkdown(folderPath);
  const notes = await Promise.all(files.map((file) => readNoteFromFile(file)));
  return notes.filter(Boolean) as VaultNote[];
}

export async function listAllNotes({ includeArchive = false } = {}) {
  await ensureVault();
  const root = vaultRoot();
  // lintVaultNotes resolves `sources:` and links against the full map, so the
  // linter must see _Archive or every rotated target reads as missing. It is a
  // one-shot CLI: walk uncached rather than putting cold notes in the cache
  // every page navigation then reads.
  if (includeArchive) {
    const files = await walkMarkdown(root);
    return (await Promise.all(files.map((file) => readNoteFromFile(file)))).filter(Boolean) as VaultNote[];
  }
  const now = Date.now();
  if (allNotesCache && allNotesCache.root === root && now - allNotesCache.at < DASHBOARD_CACHE_TTL_MS) return allNotesCache.data;
  // _Archive holds cold, rotated content (daily/raw archives, old captures) that
  // grows unbounded — 76k+ files here. No live view (dashboard, search, pinned,
  // AI bundle) reads it, so skip it: reading+parsing every archived note on each
  // navigation was the dominant page-nav latency on the Pi. The trash view uses
  // .trash (already skipped), not _Archive.
  const pending = walkMarkdown(root, new Set([DAILY_ARCHIVE_ROOT]))
    .then((files) => Promise.all(files.map((file) => readNoteFromFile(file))))
    .then((notes) => notes.filter(Boolean) as VaultNote[]);
  allNotesCache = { root, at: now, data: pending };
  try {
    return await pending;
  } catch (error) {
    if (allNotesCache?.data === pending) allNotesCache = null;
    throw error;
  }
}

export async function readNote(relativePath: string) {
  if (!relativePath.endsWith(".md") || relativePath.split(/[\\/]/).some((part) => part.startsWith("."))) return null;
  await ensureVault();
  const fullPath = resolveVaultPath(relativePath);
  return readNoteFromFile(fullPath);
}

export async function searchNotes(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const notes = await listAllNotes();
  return notes
    .map((note) => {
      const haystack = [
        note.title,
        note.relativePath,
        note.content,
        note.tags.join(" "),
        JSON.stringify(note.data),
      ].join("\n").toLowerCase();
      const score =
        (note.title.toLowerCase().includes(q) ? 5 : 0) +
        (note.tags.some((tag) => tag.toLowerCase().includes(q)) ? 3 : 0) +
        (note.content.toLowerCase().includes(q) ? 1 : 0);
      return { note, score, haystack };
    })
    .filter((item) => item.score > 0 || item.haystack.includes(q))
    .sort((a, b) => b.score - a.score || b.note.mtime.localeCompare(a.note.mtime))
    .map((item) => item.note);
}

export async function createCapture(input: {
  title?: string;
  source?: string;
  url?: string;
  text: string;
  tags?: string[];
}) {
  const text = input.text.trim();
  const title = input.title?.trim() || inferTitle(text, input.url);
  const now = new Date().toISOString();
  return writeNote("inbox", {
    title,
    data: {
      status: "inbox",
      source: input.source?.trim() || "manual",
      url: input.url?.trim() || undefined,
      tags: input.tags || [],
      captured_at: now,
    },
    body: [
      `# ${title}`,
      "",
      input.url ? `[Source](${input.url})` : "",
      input.url ? "" : "",
      text || "Empty capture.",
    ].filter((line) => line !== undefined).join("\n"),
  });
}

export async function createObjective(input: {
  title: string;
  area?: string;
  priority?: string;
  horizon?: string;
  currentState?: string;
  nextStep?: string;
}) {
  const title = input.title.trim();
  return writeNote("objectives", {
    title,
    data: {
      status: "active",
      area: input.area || "Projects",
      priority: input.priority || "medium",
      horizon: input.horizon || "",
    },
    body: [
      `# ${title}`,
      "",
      "## Current state",
      input.currentState || "",
      "",
      "## Next step",
      input.nextStep || "",
    ].join("\n"),
  });
}

export async function createTask(input: {
  title: string;
  area?: string;
  why?: string;
  objective?: string;
  priority?: string;
  source?: string;
  sourceNote?: string;
  execKind?: string;
}) {
  const title = input.title.trim();
  return writeNote("tasks", {
    title,
    data: {
      status: "todo",
      area: input.area || "Projects",
      priority: input.priority || "medium",
      objective: input.objective || "",
      source: input.source || "manual",
      source_note: input.sourceNote || "",
      proposed_on: todayISO(),
      exec_kind: normalizeExecKind(input.execKind),
    },
    body: [
      `# ${title}`,
      "",
      input.objective ? `Objectif : [[${input.objective}]]` : "",
      input.objective ? "" : "",
      "Pourquoi : " + (input.why || ""),
    ].filter(Boolean).join("\n"),
  });
}

export async function createFinancePosition(input: {
  title: string;
  assetType?: string;
  quantity: number;
  unitPrice?: number;
  currency?: string;
  identifier?: string;
  note?: string;
  tags?: string[];
}) {
  const title = input.title.trim();
  const assetType = FINANCE_ASSET_TYPES.has(input.assetType || "") ? (input.assetType as string) : "other";
  const quantity = Number.isFinite(input.quantity) ? input.quantity : 0;
  const identifier = input.identifier?.trim() || "";
  const autoPriced = assetType === "stock" || assetType === "etf" || assetType === "crypto";
  let quote: MarketQuote | null = null;
  if (autoPriced) {
    if (!identifier) throw new Error("Un ISIN, ticker ou identifiant CoinGecko est requis");
    quote = await fetchMarketQuote({ assetType, identifier, currency: input.currency || "EUR" });
  }
  const unitPrice = quote?.price ?? (Number.isFinite(input.unitPrice) ? input.unitPrice! : 0);
  const currency = quote?.currency || (input.currency || "EUR").trim().toUpperCase();
  return writeNote("finance", {
    title,
    data: {
      status: "active",
      asset_type: assetType,
      quantity,
      unit_price: unitPrice,
      currency,
      price_source: quote ? "auto" : "manual",
      price_updated_at: quote?.quotedAt || new Date().toISOString(),
      market_identifier: identifier,
      market_symbol: quote?.symbol || "",
      market_name: quote?.name || "",
      market_provider: quote?.provider || "manual",
      market_change_percent: quote?.changePercent ?? "",
      price_id: assetType === "crypto" ? identifier : "",
      tags: input.tags || [],
    },
    body: [`# ${title}`, "", input.note?.trim() || ""].join("\n"),
  });
}

export async function listFinancePositions() {
  const notes = await listNotes("finance");
  return [...notes].sort((a, b) => {
    const aOrder = Number(a.data.sort_order);
    const bOrder = Number(b.data.sort_order);
    const aRank = Number.isFinite(aOrder) ? aOrder : Number.POSITIVE_INFINITY;
    const bRank = Number.isFinite(bOrder) ? bOrder : Number.POSITIVE_INFINITY;
    return aRank - bRank || a.title.localeCompare(b.title);
  });
}

export async function reorderFinancePositions(relativePaths: string[]) {
  const paths = [...new Set(relativePaths.map((value) => value.trim()).filter(Boolean))];
  const positions = await listFinancePositions();
  const byPath = new Map(positions.map((position) => [position.relativePath, position]));
  if (paths.length !== positions.length || paths.some((relativePath) => !byPath.has(relativePath))) {
    throw new Error("La liste des positions a changé, actualisez puis réessayez");
  }
  await Promise.all(paths.map(async (relativePath, index) => {
    const note = byPath.get(relativePath)!;
    await writeRawNote(note.relativePath, carryRawFrontmatter(note.data, { ...note.data, sort_order: index }), note.content, { expectedMtime: note.mtime });
  }));
}

export async function updateFinancePosition(input: {
  relativePath: string;
  title: string;
  assetType: string;
  quantity: number;
  unitPrice?: number;
  currency?: string;
  identifier?: string;
}) {
  const note = await readNote(input.relativePath);
  if (!note || note.kind !== "finance-position") throw new Error("Position not found");
  const title = input.title.trim();
  if (!title) throw new Error("Le nom de l’actif est requis");
  if (!Number.isFinite(input.quantity) || input.quantity < 0) throw new Error("La quantité est invalide");

  const previousType = stringValue(note.data.asset_type);
  const assetType = FINANCE_ASSET_TYPES.has(input.assetType) ? input.assetType : "other";
  const identifier = input.identifier?.trim() || "";
  const previousIdentifier = financeIdentifier(note);
  const autoPriced = ["stock", "etf", "crypto"].includes(assetType);
  const marketChanged = assetType !== previousType || identifier !== previousIdentifier;
  let quote: MarketQuote | null = null;

  if (autoPriced) {
    if (!identifier) throw new Error("Un ISIN, ticker ou identifiant CoinGecko est requis");
    if (marketChanged) {
      quote = await fetchMarketQuote({ assetType, identifier, currency: stringValue(note.data.currency) || "EUR" });
    }
  } else if (!Number.isFinite(input.unitPrice) || input.unitPrice! < 0) {
    throw new Error("La valeur actuelle est invalide");
  }

  const unitPrice = autoPriced ? ((quote?.price ?? Number(note.data.unit_price)) || 0) : input.unitPrice!;
  const currency = autoPriced
    ? quote?.currency || stringValue(note.data.currency) || "EUR"
    : (input.currency || "EUR").trim().toUpperCase();
  const data: Record<string, unknown> = carryRawFrontmatter(note.data, {
    ...note.data,
    title,
    asset_type: assetType,
    quantity: input.quantity,
    unit_price: unitPrice,
    currency,
    price_source: autoPriced ? "auto" : "manual",
    price_updated_at: quote?.quotedAt || note.data.price_updated_at || new Date().toISOString(),
    market_identifier: autoPriced ? identifier : "",
    market_symbol: quote?.symbol || (marketChanged ? "" : note.data.market_symbol) || "",
    market_name: quote?.name || (marketChanged ? "" : note.data.market_name) || "",
    market_provider: quote?.provider || (autoPriced ? note.data.market_provider || "auto" : "manual"),
    market_change_percent: quote?.changePercent ?? (autoPriced ? note.data.market_change_percent || "" : ""),
    price_id: assetType === "crypto" ? identifier : "",
    updated: new Date().toISOString(),
  });
  const content = note.content.replace(/^#\s+.*$/m, `# ${title}`);
  await writeRawNote(note.relativePath, data, content, { expectedMtime: note.mtime });
  return readNote(note.relativePath);
}

function financeIdentifier(note: VaultNote) {
  return stringValue(note.data.market_identifier) || stringValue(note.data.price_id);
}

async function liveFinancePosition(note: VaultNote): Promise<VaultNote> {
  const assetType = stringValue(note.data.asset_type);
  const identifier = financeIdentifier(note);
  if (!identifier || !["stock", "etf", "crypto"].includes(assetType)) return note;
  try {
    const quote = await fetchMarketQuote({
      assetType,
      identifier,
      currency: stringValue(note.data.currency) || "EUR",
      knownSymbol: stringValue(note.data.market_symbol),
    });
    return {
      ...note,
      data: {
        ...note.data,
        unit_price: quote.price,
        currency: quote.currency,
        price_source: "auto",
        price_updated_at: quote.quotedAt,
        market_symbol: quote.symbol,
        market_name: quote.name,
        market_provider: quote.provider,
        market_change_percent: quote.changePercent ?? "",
        market_previous_close: quote.previousClose ?? "",
      },
    };
  } catch (error) {
    return {
      ...note,
      data: {
        ...note.data,
        market_error: error instanceof Error ? error.message : "Market data unavailable",
      },
    };
  }
}

export async function listFinancePositionsWithLivePrices(baseCurrency = "EUR") {
  const positions = await listFinancePositions();
  const live = await Promise.all(positions.map(liveFinancePosition));
  const currencies = [...new Set(live.map((note) => stringValue(note.data.currency) || baseCurrency))];
  const rates = new Map<string, number>([[baseCurrency, 1]]);
  // Currencies whose FX conversion failed: we fall back to a 1:1 rate to keep a
  // number on screen, but flag it so the UI/brief never treats it as real.
  const staleCurrencies = new Set<string>();
  await Promise.all(currencies.map(async (currency) => {
    if (currency === baseCurrency) return;
    try {
      rates.set(currency, await fetchFxRate(currency, baseCurrency));
    } catch (error) {
      // A silent 1:1 fallback made cross-currency totals wrong with no signal.
      // Keep the fallback but mark it stale and log the failure.
      console.error(`[vault] FX rate ${currency}->${baseCurrency} failed, using 1:1 (fx_stale):`, error);
      rates.set(currency, 1);
      staleCurrencies.add(currency);
    }
  }));
  return live.map((note) => {
    const currency = stringValue(note.data.currency) || baseCurrency;
    const quantity = Number(note.data.quantity) || 0;
    const price = Number(note.data.unit_price) || 0;
    const fxRate = rates.get(currency) || 1;
    const fxStale = staleCurrencies.has(currency);
    return {
      ...note,
      data: {
        ...note.data,
        base_currency: baseCurrency,
        fx_rate: fxRate,
        fx_stale: fxStale,
        value_base: quantity * price * fxRate,
      },
    };
  });
}

export type FinanceHistoryPoint = {
  date: string;
  currency: string;
  total: number;
  byType: Record<string, number>;
  byAsset?: Record<string, { value: number; unitPrice: number }>;
  estimated?: boolean;
};

function financePositionBaseValue(note: VaultNote) {
  const enriched = Number(note.data.value_base);
  if (Number.isFinite(enriched)) return enriched;
  return (Number(note.data.quantity) || 0) * (Number(note.data.unit_price) || 0);
}

function financeSnapshot(positions: VaultNote[], currency: string, previous = false): FinanceHistoryPoint {
  const byType: Record<string, number> = {};
  const byAsset: Record<string, { value: number; unitPrice: number }> = {};
  for (const position of positions) {
    const type = FINANCE_ASSET_TYPES.has(stringValue(position.data.asset_type)) ? stringValue(position.data.asset_type) : "other";
    const current = financePositionBaseValue(position);
    const percent = Number(position.data.market_change_percent);
    const value = previous && Number.isFinite(percent) && percent > -100 ? current / (1 + percent / 100) : current;
    const quantity = Number(position.data.quantity) || 0;
    const fxRate = Number(position.data.fx_rate) || 1;
    byType[type] = (byType[type] || 0) + value;
    byAsset[position.relativePath] = { value, unitPrice: quantity && fxRate ? value / quantity / fxRate : Number(position.data.unit_price) || 0 };
  }
  const date = new Date();
  if (previous) date.setDate(date.getDate() - 1);
  return {
    date: todayISO(date),
    currency,
    total: Object.values(byType).reduce((sum, value) => sum + value, 0),
    byType,
    byAsset,
    estimated: previous || undefined,
  };
}

function validFinanceHistoryPoint(value: unknown): value is FinanceHistoryPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<FinanceHistoryPoint>;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(point.date || ""))
    && typeof point.currency === "string"
    && typeof point.total === "number"
    && Number.isFinite(point.total)
    && Boolean(point.byType && typeof point.byType === "object");
}

async function readFinanceHistoryFile() {
  try {
    const parsed = JSON.parse(await fs.readFile(resolveVaultPath(FINANCE_HISTORY_FILE), "utf8")) as { points?: unknown };
    return Array.isArray(parsed.points) ? parsed.points.filter(validFinanceHistoryPoint) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("[vault] failed to read finance history", error);
    return [];
  }
}

/**
 * Read the persisted finance history without fetching market data or writing a
 * new snapshot. The dashboard uses this path so opening the homepage remains a
 * side-effect-free operation.
 */
export async function readFinanceHistory(currency = "EUR") {
  const normalizedCurrency = currency.trim().toUpperCase() || "EUR";
  return (await readFinanceHistoryFile())
    .filter((point) => point.currency === normalizedCurrency)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function recordFinanceSnapshot(positions: VaultNote[], currency = "EUR") {
  const normalizedCurrency = currency.trim().toUpperCase() || "EUR";
  if (!positions.length) return (await readFinanceHistoryFile()).filter((point) => point.currency === normalizedCurrency);
  const file = resolveVaultPath(FINANCE_HISTORY_FILE);
  return withFileWriteLock(`${file}.snapshot`, async () => {
    const all = await readFinanceHistoryFile();
    const current = financeSnapshot(positions, normalizedCurrency);
    const currencyPoints = all.filter((point) => point.currency === normalizedCurrency);
    if (!currencyPoints.length) all.push(financeSnapshot(positions, normalizedCurrency, true));
    const withoutToday = all.filter((point) => !(point.currency === normalizedCurrency && point.date === current.date));
    const points = [...withoutToday, current]
      .sort((a, b) => a.date.localeCompare(b.date))
      .filter((point, index, list) => list.slice(index + 1).filter((later) => later.currency === point.currency).length < 730);
    await atomicWriteFile(file, `${JSON.stringify({ version: 1, points }, null, 2)}\n`);
    return points.filter((point) => point.currency === normalizedCurrency);
  });
}

function marketPriceOnOrBefore(points: MarketHistoryPoint[], date: string) {
  let price: number | null = null;
  for (const point of points) {
    if (point.date > date) break;
    price = point.price;
  }
  return price;
}

export async function getFinanceHistory(positions: VaultNote[], currency = "EUR") {
  const snapshots = await recordFinanceSnapshot(positions, currency);
  const marketSeries = new Map<string, MarketHistoryPoint[]>();
  await Promise.all(positions.map(async (position) => {
    const assetType = stringValue(position.data.asset_type);
    const identifier = financeIdentifier(position);
    if (!identifier || !["stock", "etf", "crypto"].includes(assetType)) return;
    try {
      const points = await fetchMarketHistory({
        assetType,
        identifier,
        currency: stringValue(position.data.currency) || currency,
        knownSymbol: stringValue(position.data.market_symbol),
      });
      if (points.length) marketSeries.set(position.relativePath, points);
    } catch (error) {
      console.error(`[vault] finance history unavailable for ${position.title}:`, error);
    }
  }));
  if (!marketSeries.size) return snapshots;

  const dates = [...new Set([
    ...[...marketSeries.values()].flatMap((points) => points.map((point) => point.date)),
    ...snapshots.map((point) => point.date),
  ])].sort();
  const rebuilt = dates.map((date): FinanceHistoryPoint => {
    const byType: Record<string, number> = {};
    const byAsset: Record<string, { value: number; unitPrice: number }> = {};
    for (const position of positions) {
      const type = FINANCE_ASSET_TYPES.has(stringValue(position.data.asset_type)) ? stringValue(position.data.asset_type) : "other";
      const quantity = Number(position.data.quantity) || 0;
      const fxRate = Number(position.data.fx_rate) || 1;
      const unitPrice = marketPriceOnOrBefore(marketSeries.get(position.relativePath) || [], date) ?? (Number(position.data.unit_price) || 0);
      const value = quantity * unitPrice * fxRate;
      byType[type] = (byType[type] || 0) + value;
      byAsset[position.relativePath] = { value, unitPrice };
    }
    return { date, currency, total: Object.values(byType).reduce((sum, value) => sum + value, 0), byType, byAsset };
  });
  const byDate = new Map(rebuilt.map((point) => [point.date, point]));
  for (const snapshot of snapshots) byDate.set(snapshot.date, snapshot);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function updateFinancePositionPrice(
  relativePath: string,
  unitPrice: number,
  source: "manual" | "auto" = "manual",
) {
  const note = await readNote(relativePath);
  if (!note) throw new Error("Position not found");
  const data: Record<string, unknown> = {
    ...note.data,
    unit_price: Number.isFinite(unitPrice) ? unitPrice : note.data.unit_price,
    price_source: source,
    price_updated_at: todayISO(),
    updated: new Date().toISOString(),
  };
  carryRawFrontmatter(note.data, data);
  await writeRawNote(note.relativePath, data, note.content, { expectedMtime: note.mtime });
  return readNote(relativePath);
}

export async function refreshFinancePositionPrice(relativePath: string) {
  const note = await readNote(relativePath);
  if (!note) throw new Error("Position not found");
  const assetType = stringValue(note.data.asset_type);
  const identifier = financeIdentifier(note);
  if (!identifier) throw new Error("Ajoutez d’abord un ISIN, ticker ou identifiant CoinGecko");
  const quote = await fetchMarketQuote({
    assetType,
    identifier,
    currency: stringValue(note.data.currency) || "EUR",
    knownSymbol: stringValue(note.data.market_symbol),
  });
  const data: Record<string, unknown> = {
    ...note.data,
    unit_price: quote.price,
    currency: quote.currency,
    price_source: "auto",
    price_updated_at: quote.quotedAt,
    market_symbol: quote.symbol,
    market_name: quote.name,
    market_provider: quote.provider,
    market_change_percent: quote.changePercent ?? "",
    updated: new Date().toISOString(),
  };
  carryRawFrontmatter(note.data, data);
  await writeRawNote(note.relativePath, data, note.content, { expectedMtime: note.mtime });
  return readNote(relativePath);
}

export async function connectFinancePosition(relativePath: string, identifier: string) {
  const note = await readNote(relativePath);
  if (!note || note.kind !== "finance-position") throw new Error("Position not found");
  const data = {
    ...note.data,
    market_identifier: identifier.trim(),
    price_id: stringValue(note.data.asset_type) === "crypto" ? identifier.trim() : note.data.price_id,
    market_symbol: "",
    updated: new Date().toISOString(),
  };
  carryRawFrontmatter(note.data, data);
  await writeRawNote(note.relativePath, data, note.content, { expectedMtime: note.mtime });
  return refreshFinancePositionPrice(relativePath);
}

export async function refreshAllFinancePositionPrices() {
  const positions = await listFinancePositions();
  const connected = positions.filter((note) => financeIdentifier(note));
  const results = await Promise.allSettled(connected.map((note) => refreshFinancePositionPrice(note.relativePath)));
  return {
    refreshed: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
  };
}

export async function deleteFinancePosition(relativePath: string) {
  const note = await readNote(relativePath);
  if (!note || note.kind !== "finance-position") throw new Error("Position not found");
  await deleteNote(relativePath);
}

function businessDate(value?: string) {
  const clean = value?.trim() || "";
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : "";
}

function businessAmount(value: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error("Montant invalide");
  return Math.round(value * 100) / 100;
}

function businessCurrency(value?: string) {
  const clean = (value || "EUR").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(clean)) throw new Error("Devise invalide");
  return clean;
}

function defaultBusinessProbability(stage: BusinessStage) {
  if (stage === "won") return 100;
  if (stage === "lost") return 0;
  if (stage === "proposal") return 60;
  if (stage === "qualified") return 40;
  if (stage === "contacted") return 30;
  return 20;
}

function businessRecordType(note: VaultNote) {
  return stringValue(note.data.record_type);
}

function assertBusinessRecord(note: VaultNote | null, recordType?: "prospect" | "invoice") {
  if (!note || note.kind !== "business-record" || (recordType && businessRecordType(note) !== recordType)) {
    throw new Error("Fiche business introuvable");
  }
  return note;
}

export async function readBusinessSettings(): Promise<BusinessSettings> {
  const [note, setup] = await Promise.all([readNote(BUSINESS_SETTINGS_NOTE), readSetupState()]);
  const goal = Number(note?.data.monthly_revenue_goal);
  const currency = stringValue(note?.data.currency) || setup.currency || "EUR";
  return {
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "EUR",
    monthlyRevenueGoal: Number.isFinite(goal) && goal >= 0 ? goal : 0,
  };
}

export async function saveBusinessSettings(input: BusinessSettings): Promise<BusinessSettings> {
  const settings = {
    currency: businessCurrency(input.currency),
    monthlyRevenueGoal: businessAmount(input.monthlyRevenueGoal),
  };
  const existing = await readNote(BUSINESS_SETTINGS_NOTE);
  const now = new Date().toISOString();
  await writeRawNote(BUSINESS_SETTINGS_NOTE, carryRawFrontmatter(existing?.data || {}, {
    type: "business-settings",
    title: "Business",
    status: "active",
    currency: settings.currency,
    monthly_revenue_goal: settings.monthlyRevenueGoal,
    created: existing?.data.created || now,
    updated: now,
  }), ["# Business", "", "Paramètres du cockpit business."].join("\n"), { expectedMtime: existing?.mtime });
  return settings;
}

export async function listBusinessRecords() {
  const notes = await listNotes("business");
  return notes
    .filter((note) => businessRecordType(note) === "prospect" || businessRecordType(note) === "invoice")
    .sort((a, b) => stringValue(b.data.updated).localeCompare(stringValue(a.data.updated)) || a.title.localeCompare(b.title));
}

export async function createBusinessProspect(input: {
  company: string;
  contactName?: string;
  email?: string;
  source?: string;
  value: number;
  currency?: string;
  stage?: string;
  probability?: number;
  nextAction?: string;
  nextActionDate?: string;
  notes?: string;
}) {
  const company = input.company.trim();
  const contactName = input.contactName?.trim() || "";
  if (!company && !contactName) throw new Error("Société ou contact requis");
  const stage = BUSINESS_STAGES.includes(input.stage as BusinessStage) ? input.stage as BusinessStage : "lead";
  const probability = Math.max(0, Math.min(100, Number.isFinite(input.probability) ? Math.round(input.probability!) : defaultBusinessProbability(stage)));
  const title = company || contactName;
  return writeNote("business", {
    title,
    data: {
      record_type: "prospect",
      status: "active",
      company,
      contact_name: contactName,
      email: input.email?.trim() || "",
      source: input.source?.trim() || "",
      value: businessAmount(input.value),
      currency: businessCurrency(input.currency),
      stage,
      probability,
      next_action: input.nextAction?.trim() || "",
      next_action_date: businessDate(input.nextActionDate),
    },
    body: [
      `# ${title}`,
      "",
      "## Notes",
      input.notes?.trim() || "",
    ].join("\n"),
  });
}

export async function updateBusinessProspectStage(relativePath: string, stageValue: string) {
  const note = assertBusinessRecord(await readNote(relativePath), "prospect");
  if (!BUSINESS_STAGES.includes(stageValue as BusinessStage)) throw new Error("Étape invalide");
  const stage = stageValue as BusinessStage;
  const previousStage = stringValue(note.data.stage);
  const reopened = previousStage === "won" || previousStage === "lost";
  const data: Record<string, unknown> = carryRawFrontmatter(note.data, {
    ...note.data,
    stage,
    probability: stage === "won" || stage === "lost" || reopened
      ? defaultBusinessProbability(stage)
      : note.data.probability,
    updated: new Date().toISOString(),
  });
  await writeRawNote(note.relativePath, data, note.content, { expectedMtime: note.mtime });
  return readNote(note.relativePath);
}

export async function createBusinessInvoice(input: {
  number?: string;
  client: string;
  email?: string;
  amount: number;
  currency?: string;
  issueDate?: string;
  dueDate?: string;
  status?: string;
  notes?: string;
}) {
  const client = input.client.trim();
  if (!client) throw new Error("Client requis");
  const status = BUSINESS_INVOICE_STATUSES.includes(input.status as BusinessInvoiceStatus) ? input.status as BusinessInvoiceStatus : "draft";
  const invoices = (await listBusinessRecords()).filter((note) => businessRecordType(note) === "invoice");
  const issueDate = businessDate(input.issueDate) || todayISO();
  const dueDate = businessDate(input.dueDate);
  if (dueDate && dueDate < issueDate) throw new Error("La date d’échéance doit suivre la date d’émission");
  const requestedNumber = input.number?.trim() || "";
  const usedNumbers = new Set(invoices.map((note) => stringValue(note.data.invoice_number)));
  if (requestedNumber && usedNumbers.has(requestedNumber)) throw new Error("Numéro de facture déjà utilisé");
  const prefix = `FAC-${issueDate.slice(0, 4)}-`;
  const nextSerial = invoices.reduce((highest, note) => {
    const number = stringValue(note.data.invoice_number);
    const serial = number.startsWith(prefix) ? Number(number.slice(prefix.length)) : 0;
    return Number.isInteger(serial) ? Math.max(highest, serial) : highest;
  }, 0) + 1;
  const number = requestedNumber || `${prefix}${String(nextSerial).padStart(3, "0")}`;
  return writeNote("business", {
    title: `${number} · ${client}`,
    data: {
      record_type: "invoice",
      status,
      invoice_number: number,
      client,
      client_email: input.email?.trim() || "",
      amount: businessAmount(input.amount),
      currency: businessCurrency(input.currency),
      issue_date: issueDate,
      due_date: dueDate,
      paid_at: status === "paid" ? new Date().toISOString() : "",
    },
    body: [
      `# ${number} · ${client}`,
      "",
      "## Notes",
      input.notes?.trim() || "",
    ].join("\n"),
  });
}

export async function updateBusinessInvoiceStatus(relativePath: string, statusValue: string) {
  const note = assertBusinessRecord(await readNote(relativePath), "invoice");
  if (!BUSINESS_INVOICE_STATUSES.includes(statusValue as BusinessInvoiceStatus)) throw new Error("Statut invalide");
  const status = statusValue as BusinessInvoiceStatus;
  const data: Record<string, unknown> = carryRawFrontmatter(note.data, {
    ...note.data,
    status,
    updated: new Date().toISOString(),
  });
  if (status === "paid") data.paid_at = stringValue(note.data.paid_at) || new Date().toISOString();
  else delete data.paid_at;
  await writeRawNote(note.relativePath, data, note.content, { expectedMtime: note.mtime });
  return readNote(note.relativePath);
}

export async function deleteBusinessRecord(relativePath: string) {
  assertBusinessRecord(await readNote(relativePath));
  await deleteNote(relativePath);
}

export async function createRawNote(input: {
  title?: string;
  body: string;
  tags?: string[];
}) {
  const date = todayISO();
  const title = input.title?.trim() || `Note du ${date}`;
  const note = await writeNote("raw", {
    title,
    filename: `${date}-${slugify(title)}.md`,
    data: {
      status: "active",
      source: "manual",
      date,
      tags: input.tags || [],
    },
    body: [`# ${title}`, "", input.body.trim() || ""].join("\n"),
  });
  await routeManualRawAction(note, input.body);
  return note;
}

const RAW_ACTION_RE = /\b(?:je\s+vais\s+devoir|je\s+dois|il\s+faut|à\s+faire|a\s+faire|préparer|envoyer|relancer|appeler|vérifier|terminer)\b/i;

function noteBody(content: string) {
  return content.replace(/^#\s+.*(?:\r?\n|$)/, "").trim();
}

async function routeManualRawAction(note: VaultNote, text: string) {
  const action = text.trim();
  if (!RAW_ACTION_RE.test(action)) return;
  const capture = await createCapture({
    title: `Action · ${note.title}`,
    source: "raw-note",
    text: `${action}\n\nSource : ${note.relativePath}`,
  });
  await processInbox(1, [capture.relativePath]);
}

export async function createWikiNote(input: {
  title: string;
  summary?: string;
  body?: string;
  tags?: string[];
}) {
  const title = input.title.trim();
  return writeNote("wiki", {
    title,
    data: {
      status: "draft",
      tags: input.tags || [],
      updated: new Date().toISOString(),
    },
    body: [`# ${title}`, "", input.summary || "", "", input.body || ""].join("\n"),
  });
}

export async function updateNote(input: {
  relativePath: string;
  title: string;
  status?: string;
  area?: string;
  priority?: string;
  horizon?: string;
  objective?: string;
  order?: number;
  tags?: string[];
  content: string;
  expectedMtime?: string;
}) {
  const note = await readNote(input.relativePath);
  if (!note) throw new Error("Note not found");

  const title = input.title.trim() || note.title;
  const data: Record<string, unknown> = carryRawFrontmatter(note.data, {
    ...note.data,
    title,
    updated: new Date().toISOString(),
  });

  const nextStatus = normalizeStatus(input.status || note.status);
  const nextContent = syncHeading(input.content, title, note.title);
  setOptional(data, "status", nextStatus);
  setOptional(data, "area", input.area);
  setOptional(data, "priority", input.priority);
  setOptional(data, "horizon", input.horizon);
  setOptional(data, "objective", input.objective);
  if (typeof input.order === "number" && Number.isFinite(input.order)) {
    data.order = input.order;
  }
  // Only touch tags when the caller explicitly provides them; an omitted `tags`
  // must not wipe the note's existing tags (a client sending a partial update).
  if (input.tags !== undefined) {
    data.tags = input.tags;
  }
  // Centralized task-completion bookkeeping so every write path (table/board via
  // /api/notes → updateNote, and updateTaskStatus) stays consistent: a task
  // entering `done` gets today's done_on; leaving `done` clears it.
  applyDoneOn(data, note.kind, nextStatus);

  await writeRawNote(
    note.relativePath,
    data,
    nextContent,
    { expectedMtime: input.expectedMtime || note.mtime },
  );
  const updated = await readNote(note.relativePath);
  if (!updated) throw new Error("Updated note could not be read");
  if (note.kind === "raw" && note.data.source === "manual") {
    const previousBody = noteBody(note.content);
    const currentBody = noteBody(nextContent);
    const appended = currentBody.startsWith(previousBody) ? currentBody.slice(previousBody.length).trim() : "";
    await routeManualRawAction(updated, appended);
  }
  return updated;
}

export async function setWikiChecklistState(input: {
  relativePath: string;
  index: number;
  checked: boolean;
  expectedMtime: string;
}) {
  const note = await readNote(input.relativePath);
  if (!note || note.kind !== "wiki") throw new Error("Editable Wiki note not found");
  const content = setMarkdownChecklistState(note.content, input.index, input.checked);
  if (content === null) throw new Error("Checklist item not found");
  await writeRawNote(note.relativePath, note.data, content, { expectedMtime: input.expectedMtime });
  const updated = await readNote(note.relativePath);
  if (!updated) throw new Error("Updated Wiki note could not be read");
  return updated;
}

/**
 * Pinning is the mechanism behind custom dashboard pages: any note (typically
 * a freeform Wiki note, e.g. "Prospect research") can be pinned so it
 * shows up as a page in the sidebar nav, without introducing a new storage
 * mechanism or note type.
 */
export async function setNotePinned(relativePath: string, pinned: boolean) {
  const note = await readNote(relativePath);
  if (!note) throw new Error("Note not found");

  const data: Record<string, unknown> = carryRawFrontmatter(note.data, {
    ...note.data,
    updated: new Date().toISOString(),
  });
  if (pinned) {
    data.pinned = true;
  } else {
    delete data.pinned;
  }

  await writeRawNote(note.relativePath, data, `${note.content}\n`, { expectedMtime: note.mtime });
  const updated = await readNote(note.relativePath);
  if (!updated) throw new Error("Updated note could not be read");
  return updated;
}

export async function listPinnedNotes() {
  await ensureVault();
  const notes = await listAllNotes();
  return notes
    .filter((note) => note.data.pinned === true)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function upsertVaultNote(
  folder: VaultFolder,
  input: WriteInput & { overwrite?: boolean },
) {
  await ensureVaultDirsOnly();
  const folderName = VAULT_FOLDERS[folder];
  const filename = input.filename || `${slugify(input.title)}.md`;
  const relativePath = input.overwrite
    ? `${folderName}/${filename}`
    : await uniqueRelativePath(`${folderName}/${filename}`);
  const now = new Date().toISOString();
  const existing = input.overwrite ? await readNote(relativePath) : null;
  const data = compactObject({
    type: FOLDER_KIND[folder],
    created: existing?.data.created || now,
    updated: now,
    ...(input.data || {}),
    title: input.title,
  });
  await writeRawNote(relativePath, data, input.body, { expectedMtime: existing?.mtime });
  const note = await readNoteFromFile(resolveVaultPath(relativePath));
  if (!note) throw new Error("Imported note write failed");
  return note;
}

/**
 * Custom pages let a user create brand-new top-level nav entries at runtime,
 * without a code change. Each custom page is a small registry note under
 * 11-Custom/_registry/<slug>.md (its own namespace, so it never collides with
 * the hardcoded VAULT_FOLDERS kinds), plus a backing folder 11-Custom/<slug>/
 * that holds one generic note per entry the user adds to that page.
 */
const CUSTOM_ROOT = "11-Custom";
const CUSTOM_REGISTRY_DIR = `${CUSTOM_ROOT}/_registry`;

export type CustomPage = {
  slug: string;
  title: string;
  icon: string;
  status: string;
  created: string;
  updated: string;
  tags: string[];
  relativePath: string;
};

function customPageFromNote(note: VaultNote): CustomPage {
  return {
    slug: stringValue(note.data.slug) || path.basename(note.relativePath, ".md"),
    title: note.title,
    icon: stringValue(note.data.icon),
    status: note.status || "active",
    created: stringValue(note.data.created),
    updated: stringValue(note.data.updated),
    tags: note.tags,
    relativePath: note.relativePath,
  };
}

const PROJECTS_ROOT = "08-Projects";

async function listCustomPageRegistryNotes(): Promise<VaultNote[]> {
  await ensureVaultDirsOnly();
  const dir = resolveVaultPath(CUSTOM_REGISTRY_DIR);
  const files = await walkMarkdown(dir);
  const notes = await Promise.all(files.map((file) => readNoteFromFile(file)));
  return notes.filter(Boolean) as VaultNote[];
}

export async function createCustomPage(title: string, icon?: string): Promise<CustomPage> {
  const clean = title.trim();
  if (!clean) throw new Error("Title is required");
  const baseSlug = slugify(clean);
  const registryPath = await uniqueRelativePath(`${CUSTOM_REGISTRY_DIR}/${baseSlug}.md`);
  const slug = path.basename(registryPath, ".md");
  const now = new Date().toISOString();
  const data = compactObject({
    type: "custom-page",
    title: clean,
    slug,
    icon: icon?.trim() || "",
    status: "active",
    created: now,
    updated: now,
    tags: [],
  });
  await writeRawNote(registryPath, data, `# ${clean}\n`);
  await fs.mkdir(path.join(vaultRoot(), CUSTOM_ROOT, slug), { recursive: true });
  const note = await readNoteFromFile(resolveVaultPath(registryPath));
  if (!note) throw new Error("Custom page write failed");
  return customPageFromNote(note);
}

export async function listCustomPages(): Promise<CustomPage[]> {
  const notes = await listCustomPageRegistryNotes();
  return notes
    .filter((note) => note.status !== "archived")
    .map(customPageFromNote)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function listAllCustomPages(): Promise<CustomPage[]> {
  const notes = await listCustomPageRegistryNotes();
  return notes.map(customPageFromNote).sort((a, b) => a.title.localeCompare(b.title));
}

export async function getCustomPage(slug: string): Promise<CustomPage | null> {
  const notes = await listCustomPageRegistryNotes();
  const note = notes.find((candidate) => stringValue(candidate.data.slug) === slug);
  if (!note || note.status === "archived") return null;
  return customPageFromNote(note);
}

// Archiving only hides the registry entry from nav/routing; the backing
// folder and its notes are kept on disk (no source material is deleted).
export async function archiveCustomPage(slug: string): Promise<void> {
  const notes = await listCustomPageRegistryNotes();
  const note = notes.find((candidate) => stringValue(candidate.data.slug) === slug);
  if (!note) throw new Error("Custom page not found");
  const data = carryRawFrontmatter(note.data, { ...note.data, status: "archived", updated: new Date().toISOString() });
  await writeRawNote(note.relativePath, data, note.content, { expectedMtime: note.mtime });
}

// Opt a custom page into (or out of) the daily brief. The flag lives in the
// registry note frontmatter so it round-trips through the editor's saves.
export async function setCustomPageDaily(slug: string, enabled: boolean): Promise<void> {
  const notes = await listCustomPageRegistryNotes();
  const note = notes.find((candidate) => stringValue(candidate.data.slug) === slug);
  if (!note) throw new Error("Custom page not found");
  const data: Record<string, unknown> = carryRawFrontmatter(note.data, { ...note.data, updated: new Date().toISOString() });
  if (enabled) data.daily = true;
  else delete data.daily;
  await writeRawNote(note.relativePath, data, note.content, { expectedMtime: note.mtime });
}

// Set the emoji/glyph shown for a custom page in the sidebar. Stored on the
// registry note frontmatter so it survives editor saves.
export async function setCustomPageIcon(slug: string, icon: string): Promise<void> {
  const notes = await listCustomPageRegistryNotes();
  const note = notes.find((candidate) => stringValue(candidate.data.slug) === slug);
  if (!note) throw new Error("Custom page not found");
  const data: Record<string, unknown> = carryRawFrontmatter(note.data, { ...note.data, icon: icon.slice(0, 8), updated: new Date().toISOString() });
  await writeRawNote(note.relativePath, data, note.content, { expectedMtime: note.mtime });
}

export async function createCustomPageEntry(slug: string, title: string, body: string): Promise<VaultNote> {
  const page = await getCustomPage(slug);
  if (!page) throw new Error("Custom page not found");
  const clean = title.trim() || "Untitled";
  const now = new Date().toISOString();
  const relativePath = await uniqueRelativePath(
    `${CUSTOM_ROOT}/${slug}/${timestampSlug()}-${slugify(clean)}.md`,
  );
  const data = compactObject({
    type: "custom-entry",
    title: clean,
    status: "active",
    created: now,
    updated: now,
    tags: [],
  });
  await writeRawNote(relativePath, data, [`# ${clean}`, "", body.trim()].join("\n"));
  const note = await readNoteFromFile(resolveVaultPath(relativePath));
  if (!note) throw new Error("Custom page entry write failed");
  return note;
}

export async function listCustomPageEntries(slug: string): Promise<VaultNote[]> {
  await ensureVaultDirsOnly();
  const dir = resolveVaultPath(`${CUSTOM_ROOT}/${slug}`);
  const files = await walkMarkdown(dir);
  const notes = await Promise.all(files.map((file) => readNoteFromFile(file)));
  return sortNotes(notes.filter(Boolean) as VaultNote[], ["created", "updated"]);
}

const TRASH_DIR = ".trash";

export type TrashItem = {
  trashPath: string;
  from: string;
  title: string;
  kind: string;
  excerpt: string;
  trashedAt: string;
};

// Soft delete: move the note into .trash (recoverable) instead of unlinking.
export async function deleteNote(relativePath: string): Promise<void> {
  if (isProtectedVaultPath(relativePath)) throw new Error("Protected vault note");
  const fullPath = resolveVaultPath(relativePath);
  await withFileWriteLock(fullPath, async () => {
    const note = await readNoteFromFile(fullPath);
    if (!note) {
      await fs.unlink(fullPath).catch(() => undefined);
      return;
    }
    const stamp = Date.now().toString(36);
    const flat = relativePath.replace(/[\\/]/g, "__");
    const trashPath = `${TRASH_DIR}/${stamp}__${flat}`;
    const data = carryRawFrontmatter(note.data, { ...note.data, trashed_from: relativePath, trashed_at: new Date().toISOString() });
    await writeRawNote(trashPath, data, note.content);
    await fs.unlink(fullPath);
    invalidateDashboardCache();
  });
}

export async function moveNote(relativePath: string, folder: string): Promise<VaultNote> {
  if (!relativePath.endsWith(".md") || !folder || path.isAbsolute(folder) || folder.split(/[\\/]/).some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new Error("Invalid vault move");
  }
  if (isProtectedVaultPath(relativePath) || isProtectedVaultPath(`${folder}/placeholder.md`)) throw new Error("Protected vault note");
  const source = resolveVaultPath(relativePath);
  const note = await readNote(relativePath);
  if (!note) throw new Error("Note not found");
  const target = await uniqueRelativePath(`${folder.replace(/\\/g, "/")}/${path.basename(relativePath)}`);
  if (target === relativePath) return note;
  await withFileWriteLock(source, async () => {
    await fs.mkdir(path.dirname(resolveVaultPath(target)), { recursive: true });
    await fs.rename(source, resolveVaultPath(target));
    invalidateDashboardCache();
  });
  const moved = await readNote(target);
  if (!moved) throw new Error("Moved note could not be read");
  return moved;
}

export async function renameNote(relativePath: string, filename: string): Promise<VaultNote> {
  const stem = filename.trim().replace(/\.md$/i, "").trim();
  if (!relativePath.endsWith(".md") || !stem || stem.length > 180 || stem === "." || stem === ".." || stem.startsWith(".") || stem.endsWith(".") || /[\\/<>:"|?*\u0000-\u001f]/.test(stem)) {
    throw new Error("Invalid note filename");
  }
  const cleanPath = relativePath.replace(/\\/g, "/");
  const folder = path.posix.dirname(cleanPath);
  const target = folder === "." ? `${stem}.md` : `${folder}/${stem}.md`;
  if (isProtectedVaultPath(cleanPath) || isProtectedVaultPath(target)) throw new Error("Protected vault note");
  const source = resolveVaultPath(cleanPath);
  const note = await readNote(cleanPath);
  if (!note) throw new Error("Note not found");
  if (target === cleanPath) return note;
  if (await exists(resolveVaultPath(target))) throw new Error("Note filename already exists");
  await withFileWriteLock(source, async () => {
    await fs.rename(source, resolveVaultPath(target));
    invalidateDashboardCache();
  });
  const renamed = await readNote(target);
  if (!renamed) throw new Error("Renamed note could not be read");
  return renamed;
}

export async function listTrash(): Promise<TrashItem[]> {
  const dir = path.join(vaultRoot(), TRASH_DIR);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const items = await Promise.all(
    entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map(async (e) => {
        const note = await readNoteFromFile(path.join(dir, e.name));
        if (!note) return null;
        return {
          trashPath: `${TRASH_DIR}/${e.name}`,
          from: stringValue(note.data.trashed_from),
          title: note.title,
          kind: stringValue(note.data.type) || note.kind,
          excerpt: note.excerpt,
          trashedAt: stringValue(note.data.trashed_at) || note.mtime,
        } as TrashItem;
      }),
  );
  return (items.filter(Boolean) as TrashItem[]).sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
}

export async function restoreNote(trashPath: string): Promise<string> {
  if (!trashPath.startsWith(`${TRASH_DIR}/`)) throw new Error("Not a trash path");
  const full = resolveVaultPath(trashPath);
  return withFileWriteLock(full, async () => {
    const note = await readNoteFromFile(full);
    if (!note) throw new Error("Trash item not found");
    const from = stringValue(note.data.trashed_from) || `${VAULT_FOLDERS.raw}/${path.basename(trashPath)}`;
    const dest = await uniqueRelativePath(from);
    const data = carryRawFrontmatter(note.data, { ...note.data });
    delete data.trashed_from;
    delete data.trashed_at;
    await writeRawNote(dest, data, note.content);
    await fs.unlink(full);
    invalidateDashboardCache();
    return dest;
  });
}

export async function purgeNote(trashPath: string): Promise<void> {
  if (!trashPath.startsWith(`${TRASH_DIR}/`)) throw new Error("Not a trash path");
  const full = resolveVaultPath(trashPath);
  await withFileWriteLock(full, () => fs.unlink(full).catch(() => undefined));
}

export async function emptyTrash(): Promise<number> {
  const items = await listTrash();
  await Promise.all(items.map((it) => purgeNote(it.trashPath)));
  return items.length;
}

export async function updateTaskStatus(relativePath: string, status: string) {
  const note = await readNote(relativePath);
  if (!note) throw new Error("Task not found");
  const normalized = normalizeStatus(status);
  const data: Record<string, unknown> = carryRawFrontmatter(note.data, {
    ...note.data,
    status: normalized,
    updated: new Date().toISOString(),
  });
  applyDoneOn(data, "task", normalized);
  await writeRawNote(note.relativePath, data, note.content, { expectedMtime: note.mtime });
  return readNote(relativePath);
}

export async function updateCaptureStatus(relativePath: string, status: string) {
  const note = await readNote(relativePath);
  if (!note) throw new Error("Capture not found");
  const data: Record<string, unknown> = carryRawFrontmatter(note.data, { ...note.data, status, updated: new Date().toISOString() });
  if (status === "briefed") data.briefed_at = new Date().toISOString();
  if (status === "processed") data.processed_at = new Date().toISOString();
  await writeRawNote(note.relativePath, data, note.content, { expectedMtime: note.mtime });
  return readNote(relativePath);
}

export async function saveBriefFeedback(
  relativePath: string,
  verdict: BriefFeedbackVerdict,
  reason = "",
): Promise<BriefFeedbackRecord> {
  if (verdict !== "useful" && verdict !== "not_useful") throw new Error("Retour invalide");
  const note = await readNote(relativePath);
  if (!note || (note.kind !== "daily" && note.kind !== "weekly")) {
    throw new Error("Brief introuvable");
  }
  const recordedAt = new Date().toISOString();
  const cleanReason = reason.trim().slice(0, 280);
  const data: Record<string, unknown> = carryRawFrontmatter(note.data, {
    ...note.data,
    brief_feedback: verdict,
    brief_feedback_at: recordedAt,
  });
  if (cleanReason) data.brief_feedback_reason = cleanReason;
  else delete data.brief_feedback_reason;
  // Do not touch `updated`: feedback is metadata about the generated brief,
  // not a manual edit to its body. This keeps regeneration safeguards honest.
  await writeRawNote(note.relativePath, data, note.content, { expectedMtime: note.mtime });
  return {
    kind: note.kind,
    period: stringValue(note.data.date) || stringValue(note.data.week) || note.title,
    verdict,
    reason: cleanReason,
    recordedAt,
  };
}

const AI_BRIEF_MARKERS = new Set(["ai", "local", "local-fallback"]);

/**
 * True when an existing daily brief should be treated as user-owned content and
 * must not be regenerated (even when the caller passes `force`). We consider a
 * brief manually edited when:
 *   - it has no `generated_by` marker (a hand-written or imported daily), or
 *   - the marker is not one the generator emits, or
 *   - its body was saved after it was generated (`updated` > `generated_at`),
 *     which means the editor touched it since the last generation.
 */
function isManuallyEditedBrief(existing: VaultNote, generatedBy: string): boolean {
  const isGeneratorMarker = generatedBy.startsWith("ai:") || AI_BRIEF_MARKERS.has(generatedBy);
  if (!isGeneratorMarker) return true;
  const generatedAt = stringValue(existing.data.generated_at);
  const updated = stringValue(existing.data.updated);
  const generatedMs = Date.parse(generatedAt);
  const updatedMs = Date.parse(updated);
  // Older generator builds wrote `updated` at the end of a long synthesis,
  // after `generated_at`; accept that short self-write gap.
  return Boolean(generatedAt && updated && (
    Number.isNaN(generatedMs) || Number.isNaN(updatedMs)
      ? updated > generatedAt
      : updatedMs - generatedMs > 5 * 60_000
  ));
}

export async function generateDailyBrief(options: { force?: boolean; requireAi?: boolean } = {}) {
  await ensureVault();
  const date = todayISO();
  await archiveStaleInboxCaptures(date);
  await archiveStaleTasks(date);
  const relativePath = `${VAULT_FOLDERS.daily}/${date}.md`;
  if (await exists(resolveVaultPath(relativePath))) {
    const existing = await readNote(relativePath);
    const generatedBy = stringValue(existing?.data.generated_by);
    // A brief the app itself generated carries a `generated_by` marker
    // (`ai:*`, `ai`, `local`, or `local-fallback`). Anything else — a missing
    // marker, a hand-written daily, or a note whose body was edited after
    // generation — is treated as user content and preserved EVEN under force,
    // so the automation never silently overwrites a manually edited brief.
    // (R2 — automation `force=true` used to clobber manual edits.)
    if (existing && isManuallyEditedBrief(existing, generatedBy)) {
      if (options.requireAi) {
        throw new Error("Le brief du jour contient des modifications manuelles et n'a pas été remplacé.");
      }
      return existing;
    }
    if (!options.force) {
      // Preserve a completed AI brief, but retry a deterministic fallback after
      // the bridge recovers instead of leaving the daily timer degraded forever.
      if (existing && generatedBy !== "local" && generatedBy !== "local-fallback") return existing;
    }
  }

  const [dashboard, setup] = await Promise.all([getDashboard(), readSetupState()]);
  const briefDetail = setup.automation.briefDetail;
  const detailCaps = BRIEF_DETAIL_CAPS[briefDetail];
  const inputs = dailyAiInputs(dashboard, date, activeModuleEvidence(dashboard.allNotes, setup.modules));
  const briefGeneratedAt = new Date().toISOString();
  // Free tenants get the deterministic brief below; hosted AI synthesis spends
  // the operator's budget and is reserved for paid plans. A manual "generate
  // AI now" request (requireAi) surfaces the paywall instead of silently
  // falling back.
  const hostedAi = planAllowsAiSynthesis();
  if (options.requireAi && !hostedAi) {
    throw new Error("Le brief synthétisé par l'IA est réservé aux offres payantes.");
  }
  let aiFailure: unknown;
  const aiBrief = hostedAi
    ? await generateAiDailyBrief(dashboard, date, inputs, briefDetail).catch((error) => {
        aiFailure = error;
        console.error(options.requireAi
          ? "[vault] Manual AI daily brief failed:"
          : "[vault] AI daily brief bridge failed, falling back to local brief:", error);
        return null;
      })
    : null;
  if (aiBrief?.brief) {
    await recordUsage("brief");
    // The brief proposes; only an explicit accept writes to the vault. The
    // model's own `suggestions` come first because they can act on existing
    // tasks; the parsed task list only ever yields creations.
    const suggestions = normalizeSuggestions([
      ...(Array.isArray(aiBrief.suggestions) ? aiBrief.suggestions : []),
      ...proposeBriefTasks(
        aiBrief.tasks || extractBriefTasks(aiBrief.brief),
        dashboard.tasks,
        dashboard.objectives.filter(isActiveObjective),
      ),
    ]);
    const persistedBrief = sanitizeBriefOutput(aiBrief.brief);
    await writeBriefSuggestions(`${VAULT_FOLDERS.daily}/${date}.md`, suggestions);
    return upsertVaultNote("daily", {
      title: `Daily Brief - ${date}`,
      filename: `${date}.md`,
      overwrite: true,
      data: {
        date,
        week: weekId(),
        status: "draft",
        generated_by: aiBrief.engine ? `ai:${aiBrief.engine}` : "ai",
        // Must equal `updated` below so isManuallyEditedBrief() does not treat this
        // fresh write as a post-generation edit (updated is always set at or after
        // generated_at, since upsertVaultNote timestamps it after this object is built).
        generated_at: briefGeneratedAt,
        updated: briefGeneratedAt,
        inbox_count: dashboard.inbox.filter(isInboxCapture).length,
        signal_count: dashboard.inbox.filter(isBriefReadyCapture).length,
        open_task_count: dashboard.tasks.filter(isOpenTask).length,
        objective_count: dashboard.objectives.filter(isActiveObjective).length,
        created_task_count: 0,
        suggestion_count: suggestions.length,
        skills: [DAILY_SKILL],
        generation_status: "ai",
        sources: uniqueStrings([
          ...sourcePaths([
            ...inputs.captures,
            ...inputs.rawContext,
            ...inputs.openTasks,
            ...inputs.completedTasks,
            ...inputs.objectives,
            ...inputs.wikiSignals,
            ...inputs.projectNotes,
            inputs.previousBrief,
            dashboard.system.find((note) => note.relativePath.endsWith("Context.md")),
          ]),
          ...moduleEvidencePaths(inputs.moduleEvidence),
        ]),
      },
      body: persistedBrief,
    });
  }

  if (options.requireAi) {
    const reason = aiFailure instanceof Error ? aiFailure.message : "le bridge IA n'a renvoyé aucun brief valide";
    throw new Error(`Daily Brief IA indisponible : ${reason}`);
  }

  const activeObjectives = dashboard.objectives.filter((note) => note.status === "active");
  const openTasks = dashboard.tasks.filter(isOpenTask);
  const inbox = dashboard.inbox.filter(isInboxCapture);
  const captureSignals = dashboard.inbox.filter(isBriefReadyCapture);
  const latestPreviousBrief = dashboard.daily.find((note) => stringValue(note.data.date) !== date);
  const priorityTask = rankTasks(openTasks)[0];
  const blindSpots = detectBlindSpots(dashboard).slice(0, detailCaps.risks);
  const recentlyCompleted = completedTasksInDateWindow(
    dashboard.tasks,
    isoDaysBefore(date, 1),
    date,
  ).slice(0, 3);
  const rankedToday = rankTasks(openTasks).slice(0, 3);

  const lines = [
    `## Daily Brief — ${date}`,
    "",
    "### Priorité",
    priorityTask
      ? `La priorité enregistrée est « ${priorityTask.title} ». Termine son prochain livrable observable avant d’ouvrir un nouveau chantier.`
      : "Aucune priorité exploitable n’est enregistrée. Choisis un seul résultat observable pour aujourd’hui.",
    "",
    "### Ce qui a changé",
    ...(recentlyCompleted.length
      ? recentlyCompleted.map((note) => `- « ${note.title} » est enregistrée comme terminée.`)
      : ["Aucune tâche terminée n’est enregistrée depuis hier."]),
    "",
    ...(blindSpots.length ? ["### À vérifier", ...blindSpots.map((item) => `- ${item}`), ""] : []),
    "### Plan du jour",
    ...(rankedToday.length
      ? rankedToday.map((note, index) => `${index + 1}. ${note.title}.`)
      : ["Aucune tâche ouverte n’est enregistrée."]),
    "",
    "### État de la synthèse",
    "L’IA n’était pas disponible pendant cette génération. Ce fallback reste volontairement factuel et n’utilise aucune capture brute non classée.",
    ...(detailCaps.pages && dashboard.custom.length
      ? [
          "### Pages",
          ...dashboard.custom.slice(0, detailCaps.pages).map((note) => `- ${note.title}`),
          "",
        ]
      : []),
  ];

  return upsertVaultNote("daily", {
    title: `Daily Brief - ${date}`,
    filename: `${date}.md`,
    overwrite: true,
    data: {
      date,
      week: weekId(),
      status: "draft",
      generated_by: "local",
      generation_status: "fallback",
      generated_at: briefGeneratedAt,
      updated: briefGeneratedAt,
      inbox_count: inbox.length,
      signal_count: captureSignals.length,
      open_task_count: openTasks.length,
      objective_count: activeObjectives.length,
      sources: sourcePaths([...rankedToday, ...recentlyCompleted, latestPreviousBrief]),
    },
    body: sanitizeBriefOutput(lines.join("\n")),
  });
}

const DAILY_ARCHIVE_ROOT = "_Archive";

/**
 * Daily briefs from closed calendar weeks get moved out of 06-Daily
 * entirely (not into a subfolder there) because listNotes("daily") walks
 * 06-Daily recursively: a subfolder is still inside the scanned tree and the
 * date-sorted slice(0, 7) would keep surfacing them as if they were still
 * fresh. Moving them to a sibling root folder is what actually removes them
 * from the daily view.
 */
async function archiveStaleDailies(dailyNotes: VaultNote[]) {
  const currentWeekStart = weekStartISO();
  const stale = dailyNotes.filter((note) => {
    const date = stringValue(note.data.date) || path.basename(note.relativePath, ".md");
    // Keep malformed or undated notes visible: silent archival would be much
    // harder to understand than asking the user to fix their metadata.
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < currentWeekStart;
  });
  if (!stale.length) return { summaries: [] as VaultNote[], moved: new Map<string, string>() };

  const groups = new Map<string, VaultNote[]>();
  for (const note of stale) {
    const dateValue = stringValue(note.data.date) || note.relativePath;
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? `${dateValue}T12:00:00.000Z` : dateValue);
    const week = weekId(Number.isNaN(parsed.getTime()) ? new Date() : parsed, "UTC");
    if (!groups.has(week)) groups.set(week, []);
    groups.get(week)!.push(note);
  }

  const summaries: VaultNote[] = [];
  const movedByOldPath = new Map<string, string>();
  for (const [week, notes] of groups) {
    const archiveDir = `${DAILY_ARCHIVE_ROOT}/06-Daily-${week}`;
    await fs.mkdir(resolveVaultPath(archiveDir), { recursive: true });
    const movedPaths: string[] = [];
    for (const note of notes) {
      const filename = path.basename(note.relativePath);
      const targetRelative = `${archiveDir}/${filename}`;
      const to = resolveVaultPath(targetRelative);
      if (await exists(to)) continue;
      await fs.rename(resolveVaultPath(note.relativePath), to);
      invalidateDashboardCache();
      movedPaths.push(targetRelative);
      movedByOldPath.set(note.relativePath, targetRelative);
    }
    if (!movedPaths.length) continue;

    const summaryLines = notes
      .sort((a, b) => stringValue(a.data.date).localeCompare(stringValue(b.data.date)))
      .map((note) => {
        const date = stringValue(note.data.date) || path.basename(note.relativePath, ".md");
        const firstLine = note.content
          .split(/\r?\n/)
          .find((line) => line.trim() && !line.startsWith("#"));
        return `- **${date}**: ${firstLine ? firstLine.trim() : "(voir source archivée)"}`;
      });

    const indexPath = `${archiveDir}/INDEX.md`;
    await writeRawNote(
      indexPath,
      { type: "archive-index", title: `Daily Briefs Archive - ${week}`, status: "archived", week, sources: movedPaths },
      [
        `# Daily Briefs Archive - ${week}`,
        "",
        `Daily briefs from ${week}, archived automatically by the weekly review once ` +
          `the calendar week was closed. Sources moved to ` +
          `\`vault/${archiveDir}/\` without deletion.`,
        "",
        ...summaryLines,
      ].join("\n"),
    );
    const summary = await readNote(indexPath);
    if (summary) summaries.push(summary);
  }

  // Moving a daily invalidates its path everywhere it is cited. Weekly notes
  // reference dailies in their `sources:` frontmatter for lint-checked
  // provenance, so rewrite those entries to the archive location instead of
  // leaving dangling paths behind.
  await rewriteMovedPaths(movedByOldPath);
  return { summaries, moved: movedByOldPath };
}

/**
 * Repoint every `sources:` entry that names a note this rotation just moved.
 *
 * Weekly reviews are not the only citers: each daily brief cites the previous
 * day's brief and the raw journal notes it read, so restricting this to
 * `07-Weekly` left a dangling path in the newest daily every single week.
 * Notes that cite nothing moved are never rewritten, which keeps frontmatter
 * the house parser cannot model away from a round-trip.
 */
async function rewriteMovedPaths(movedByOldPath: Map<string, string>, titlesByOldPath = new Map<string, string>()) {
  if (!movedByOldPath.size) return;
  for (const note of await listAllNotes()) {
    let changed = false;
    const rewritten = { ...note.data };
    for (const key of ["sources", "source_note", "source_notes", "derived_notes"]) {
      const value = rewritten[key];
      if (typeof value === "string" && movedByOldPath.has(value)) {
        rewritten[key] = movedByOldPath.get(value)!;
        changed = true;
      } else if (Array.isArray(value)) {
        rewritten[key] = value.map((entry) => {
          const moved = typeof entry === "string" ? movedByOldPath.get(entry) : undefined;
          if (moved) {
            changed = true;
          }
          return moved ?? entry;
        });
      }
    }
    let content = note.content;
    for (const [from, to] of movedByOldPath) {
      const next = content
        .replaceAll(from, to)
        .replaceAll(`[[${from.replace(/\.md$/, "")}`, `[[${to.replace(/\.md$/, "")}`);
      const title = titlesByOldPath.get(from);
      const linked = title ? next.replaceAll(`[[${title}]]`, `[[${to}|${title}]]`) : next;
      if (linked !== content) {
        content = linked;
        changed = true;
      }
    }
    if (!changed) continue;
    await writeRawNote(
      note.relativePath,
      rewritten,
      content,
      { expectedMtime: note.mtime },
    );
  }
}

export async function archiveStaleInboxCaptures(date = todayISO()) {
  const cutoff = isoDaysBefore(date, 7);
  const dashboard = await getDashboard();
  const stale = dashboard.inbox.filter((note) => {
    if (!BRIEF_READY_CAPTURE_STATUSES.has(note.status) && note.status !== "archived") return false;
    const processedDate = noteDate(note, ["processed_at", "processing_attempted_at", "updated", "captured_at", "created"]).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(processedDate) && processedDate < cutoff;
  });
  const moved = new Map<string, string>();
  const titles = new Map<string, string>();
  for (const note of stale) {
    const processedDate = noteDate(note, ["processed_at", "processing_attempted_at", "updated", "captured_at", "created"]);
    const parsed = new Date(`${processedDate.slice(0, 10)}T12:00:00.000Z`);
    const week = weekId(Number.isNaN(parsed.getTime()) ? new Date() : parsed, "UTC");
    const archiveDir = `${DAILY_ARCHIVE_ROOT}/01-Inbox-${week}`;
    await fs.mkdir(resolveVaultPath(archiveDir), { recursive: true });
    const target = await uniqueRelativePath(`${archiveDir}/${path.basename(note.relativePath)}`);
    await fs.rename(resolveVaultPath(note.relativePath), resolveVaultPath(target));
    invalidateDashboardCache();
    moved.set(note.relativePath, target);
    titles.set(note.relativePath, note.title);
  }
  await rewriteMovedPaths(moved, titles);
  return moved;
}

export async function archiveStaleTasks(date = todayISO()) {
  const cutoff = isoDaysBefore(date, 7);
  const dashboard = await getDashboard();
  const stale = dashboard.tasks.filter((note) => {
    if (!["done", "archived", "abandoned", "cancelled", "canceled"].includes(note.status)) return false;
    const closedDate = noteDate(note, ["done_on", "updated", "created"]).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(closedDate) && closedDate < cutoff;
  });
  const moved = new Map<string, string>();
  const titles = new Map<string, string>();
  for (const note of stale) {
    const closedDate = noteDate(note, ["done_on", "updated", "created"]);
    const parsed = new Date(`${closedDate.slice(0, 10)}T12:00:00.000Z`);
    const week = weekId(Number.isNaN(parsed.getTime()) ? new Date() : parsed, "UTC");
    const archiveDir = `${DAILY_ARCHIVE_ROOT}/05-Tasks-${week}`;
    await fs.mkdir(resolveVaultPath(archiveDir), { recursive: true });
    const target = await uniqueRelativePath(`${archiveDir}/${path.basename(note.relativePath)}`);
    await fs.rename(resolveVaultPath(note.relativePath), resolveVaultPath(target));
    invalidateDashboardCache();
    moved.set(note.relativePath, target);
    titles.set(note.relativePath, note.title);
  }
  await rewriteMovedPaths(moved, titles);
  return moved;
}

async function archiveStaleRawNotes(rawNotes: VaultNote[]) {
  const currentWeekStart = weekStartISO();
  // The daily brief reads the journal of the last three days (dailyAiInputs).
  // This rotation runs with the Monday weekly review, so a week boundary alone
  // moved the weekend's journal out of 02-Raw while the brief still needed it:
  // Monday's brief lost Saturday and Sunday every single week.
  const briefWindowStart = isoDaysBefore(todayISO(), 2);
  const cutoff = currentWeekStart < briefWindowStart ? currentWeekStart : briefWindowStart;
  const stale = rawNotes.filter((note) => {
    const date = stringValue(note.data.date);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < cutoff;
  });
  const moved = new Map<string, string>();
  const groups = new Map<string, VaultNote[]>();
  for (const note of stale) {
    const week = weekId(new Date(`${stringValue(note.data.date)}T12:00:00.000Z`), "UTC");
    if (!groups.has(week)) groups.set(week, []);
    groups.get(week)!.push(note);
  }
  const summaries: VaultNote[] = [];
  for (const [week, notes] of groups) {
    const archiveDir = `${DAILY_ARCHIVE_ROOT}/02-Raw-${week}`;
    await fs.mkdir(resolveVaultPath(archiveDir), { recursive: true });
    const movedPaths: string[] = [];
    for (const note of notes) {
      const target = `${archiveDir}/${path.basename(note.relativePath)}`;
      if (await exists(resolveVaultPath(target))) continue;
      await fs.rename(resolveVaultPath(note.relativePath), resolveVaultPath(target));
      invalidateDashboardCache();
      moved.set(note.relativePath, target);
      movedPaths.push(target);
    }
    if (!movedPaths.length) continue;
    const indexPath = `${archiveDir}/INDEX.md`;
    await writeRawNote(
      indexPath,
      { type: "archive-index", title: `Raw Notes Archive - ${week}`, status: "archived", week, sources: movedPaths },
      [
        `# Raw Notes Archive - ${week}`,
        "",
        "Temporary dated notes archived automatically after the weekly synthesis. The originals were moved, not deleted.",
        "",
        ...notes.map((note) => `- **${stringValue(note.data.date)}**: [[${note.title}]] (${moved.get(note.relativePath) || note.relativePath})`),
      ].join("\n"),
    );
    const summary = await readNote(indexPath);
    if (summary) summaries.push(summary);
  }
  await rewriteMovedPaths(moved);
  return { summaries, moved };
}

function weeklyReviewWindow(now = new Date()) {
  // A weekly review always covers the last fully closed calendar week. Manual
  // runs therefore have the same semantics as the Monday automation.
  const currentStart = weekStartISO(now);
  const anchor = new Date(`${currentStart}T12:00:00.000Z`);
  anchor.setUTCDate(anchor.getUTCDate() - 1);
  return {
    id: weekId(anchor, "UTC"),
    start: weekStartISO(anchor, "UTC"),
    end: weekEndISO(anchor, "UTC"),
  };
}

export async function generateWeeklyReview(options: { force?: boolean; requireAi?: boolean } = {}) {
  await ensureVault();
  const reviewWindow = weeklyReviewWindow();
  const week = reviewWindow.id;
  const relativePath = `${VAULT_FOLDERS.weekly}/${week}.md`;
  if (!options.force && await exists(resolveVaultPath(relativePath))) {
    const existing = await readNote(relativePath);
    const generatedBy = stringValue(existing?.data.generated_by);
    if (existing && generatedBy !== "local" && generatedBy !== "local-fallback") return existing;
  }

  const dashboard = await getDashboard();
  const recentDaily = notesInDateWindow(dashboard.daily, reviewWindow.start, reviewWindow.end, ["date", "created", "updated"]).slice(0, 7);
  const recentRaw = notesInDateWindow(dashboard.raw, reviewWindow.start, reviewWindow.end, ["date", "created", "updated"]).slice(0, 20);
  const archiveResult = await archiveStaleDailies(dashboard.daily);
  const rawArchiveResult = await archiveStaleRawNotes(dashboard.raw);
  const archivedDailySummaries = archiveResult.summaries;
  const archivedRawSummaries = rawArchiveResult.summaries;
  const dailySources = recentDaily.map((note) => ({
    ...note,
    relativePath: archiveResult.moved.get(note.relativePath) || note.relativePath,
  }));
  const rawSources = recentRaw.map((note) => ({
    ...note,
    relativePath: rawArchiveResult.moved.get(note.relativePath) || note.relativePath,
  }));
  const doneTasks = completedTasksInDateWindow(dashboard.tasks, reviewWindow.start, reviewWindow.end);
  const openTasks = dashboard.tasks.filter(isOpenTask);
  const inbox = dashboard.inbox.filter((note) => note.status === "inbox");
  const activeObjectives = dashboard.objectives.filter((note) => note.status === "active");
  const blindSpots = detectBlindSpots(dashboard);
  const briefLoop = aiTaskCompletion(dashboard.tasks);
  const reviewGeneratedAt = new Date().toISOString();
  const setup = await readSetupState();
  const briefDetail = setup.automation.briefDetail;
  const detailCaps = BRIEF_DETAIL_CAPS[briefDetail];
  const moduleEvidence = activeModuleEvidence(dashboard.allNotes, setup.modules);
  const hostedAi = planAllowsAiSynthesis();
  if (options.requireAi && !hostedAi) {
    throw new Error("La revue synthétisée par l'IA est réservée aux offres payantes.");
  }
  let aiFailure: unknown;
  const aiReview = hostedAi
    ? await generateAiWeeklyReview(dashboard, reviewWindow, moduleEvidence, briefDetail).catch((error) => {
        aiFailure = error;
        console.error(options.requireAi
          ? "[vault] Manual AI weekly review failed:"
          : "[vault] AI weekly review bridge failed, falling back to local review:", error);
        return null;
      })
    : null;
  if (aiReview?.review) {
    await recordUsage("weekly");
    // The weekly skill proposes maintenance rather than applying it, so its
    // suggestions follow the same accept/reject gate as the daily brief's.
    const weeklySuggestions = normalizeSuggestions(aiReview.suggestions);
    await writeBriefSuggestions(`${VAULT_FOLDERS.weekly}/${week}.md`, weeklySuggestions);
    return upsertVaultNote("weekly", {
      title: `Weekly Review - ${week}`,
      filename: `${week}.md`,
      overwrite: true,
      data: {
        week,
        week_start: reviewWindow.start,
        week_end: reviewWindow.end,
        status: "draft",
        generated_by: aiReview.engine ? `ai:${aiReview.engine}` : "ai",
        generation_status: "ai",
        // Must equal `updated` so isManuallyEditedBrief-style checks (generated_by !== local*)
        // don't get confused by a later `updated` timestamp on the very write that created it.
        generated_at: reviewGeneratedAt,
        updated: reviewGeneratedAt,
        inbox_count: inbox.length,
        open_task_count: openTasks.length,
        done_task_count: doneTasks.length,
        daily_count: recentDaily.length,
        archived_daily_count: archiveResult.moved.size,
        archived_raw_count: rawArchiveResult.moved.size,
        objective_count: activeObjectives.length,
        ai_task_completion_7d: briefLoop.label,
        suggestion_count: weeklySuggestions.length,
        skills: [WEEKLY_SKILL],
        sources: sourcePaths([
          ...dailySources,
          ...rawSources,
          ...archivedDailySummaries,
          ...archivedRawSummaries,
          ...doneTasks.slice(0, 8),
          ...openTasks.slice(0, 8),
          ...activeObjectives.slice(0, 8),
          ...generalAiNotes(dashboard.projects).slice(0, 16),
          ...generalAiNotes(dashboard.wiki).filter((note) => note.status === "active").slice(0, 12),
          ...dashboard.inbox.filter(isBriefReadyCapture).slice(0, 12),
          dashboard.system.find((note) => note.relativePath.endsWith("Context.md")),
        ]).concat(moduleEvidencePaths(moduleEvidence)),
      },
      body: sanitizeBriefOutput(aiReview.review),
    });
  }

  if (options.requireAi) {
    const reason = aiFailure instanceof Error ? aiFailure.message : "le bridge IA n'a renvoyé aucune revue valide";
    throw new Error(`Weekly Brief IA indisponible : ${reason}`);
  }

  const lines = [
    `## Weekly Review — ${reviewWindow.start} au ${reviewWindow.end}`,
    "",
    "### Bilan factuel",
    `${doneTasks.length} tâche(s) ont été enregistrées comme terminées et ${openTasks.length} restent ouvertes. ${recentDaily.length} Daily ont été produits pendant la semaine.`,
    "",
    "### Ce qui a réellement avancé",
    ...(doneTasks.length
      ? doneTasks.slice(0, detailCaps.completed).map((note) => `- ${note.title}.`)
      : ["Aucune réalisation terminée n’est enregistrée pour cette période."]),
    "",
    "### Ce qui reste ouvert",
    ...(openTasks.length
      ? rankTasks(openTasks).slice(0, detailCaps.open).map((note) => `- ${note.title}.`)
      : ["Aucun engagement ouvert n’est enregistré."]),
    "",
    ...(blindSpots.length
      ? ["### Points à vérifier", ...blindSpots.slice(0, detailCaps.risks).map((item) => `- ${item}`), ""]
      : []),
    "### La semaine prochaine",
    activeObjectives[0]
      ? `Choisis un résultat mesurable lié à « ${activeObjectives[0].title} » et termine-le avant d’ouvrir un nouveau chantier.`
      : "Aucun objectif prioritaire exploitable n’est enregistré.",
    "",
    "### État de la synthèse",
    "L’IA n’était pas disponible. Cette revue de secours reste factuelle et ne transforme aucune capture brute en recommandation.",
  ];

  return upsertVaultNote("weekly", {
    title: `Weekly Review - ${week}`,
    filename: `${week}.md`,
    overwrite: true,
    data: {
      week,
      week_start: reviewWindow.start,
      week_end: reviewWindow.end,
      status: "draft",
      generated_by: "local",
      generation_status: "fallback",
      generated_at: reviewGeneratedAt,
      updated: reviewGeneratedAt,
      inbox_count: inbox.length,
      open_task_count: openTasks.length,
      done_task_count: doneTasks.length,
      daily_count: recentDaily.length,
      archived_daily_count: archiveResult.moved.size,
      archived_raw_count: rawArchiveResult.moved.size,
      objective_count: activeObjectives.length,
      ai_task_completion_7d: briefLoop.label,
      sources: uniqueStrings([
        ...[...dailySources, ...rawSources, ...archivedDailySummaries, ...archivedRawSummaries].map((note) => note.relativePath),
      ]),
    },
    body: sanitizeBriefOutput(lines.join("\n")),
  });
}

export async function processInbox(limit = 5, onlyPaths: string[] = []) {
  await ensureVault();
  const dashboard = await getDashboard();
  const requestedPaths = new Set(onlyPaths);
  // needs-ai captures are deliberately retried: a local fallback is useful but is
  // not considered the final processing result. Interactive/manual captures
  // rank before the RSS backlog so a fresh thought is never trapped behind
  // thousands of feed items.
  const captures = dashboard.inbox
    .filter((note) => (
      note.status === "inbox"
      || note.status === "needs-ai"
      || stringValue(note.data.processing_engine) === "local-fallback"
    ))
    .filter((note) => requestedPaths.size === 0 || requestedPaths.has(note.relativePath))
    .sort((a, b) => {
      const sourceDiff = Number(a.data.source === "rss") - Number(b.data.source === "rss");
      if (sourceDiff) return sourceDiff;
      return b.mtime.localeCompare(a.mtime);
    })
    .slice(0, limit);
  const processed: VaultNote[] = [];
  const instructions = await readSkillInstructions(PROCESS_INBOX_SKILL);
  const concurrency = Math.min(Math.max(Number(process.env.AI_PROCESS_CONCURRENCY) || 2, 1), 4);
  const aiResults = planAllowsAiSynthesis()
    ? await mapWithConcurrency(captures, concurrency, (capture) =>
        generateAiInboxNote(capture, dashboard, instructions)
          .then((result) => ({ result, error: "" }))
          .catch((error) => ({
            result: null,
            error: error instanceof Error ? error.message : "AI processing unavailable",
          })))
    : captures.map(() => ({ result: null, error: "AI synthesis disabled" }));

  for (const [index, capture] of captures.entries()) {
    const { result: aiResult, error: processingError } = aiResults[index];
    if (!aiResult) {
      await writeRawNote(capture.relativePath, {
        ...capture.data,
        status: "needs-ai",
        derived_notes: [],
        processing_engine: "unavailable",
        processing_state: "awaiting-ai",
        processing_error: processingError || "AI processing unavailable",
        processing_attempted_at: new Date().toISOString(),
        processing_skill: PROCESS_INBOX_SKILL,
        updated: new Date().toISOString(),
      }, capture.content, { expectedMtime: capture.mtime });
      continue;
    }

    await recordUsage("inbox");

    const proposedDestination = aiResult.keep === false
      ? "archive"
      : aiResult.destination || "archive";
    const destination = proposedDestination === "wiki" && !passesLibraryAdmission(aiResult)
      ? "archive"
      : proposedDestination;
    if (destination === "archive") {
      const rejectedLibrary = proposedDestination === "wiki";
      await writeRawNote(capture.relativePath, {
        ...capture.data,
        status: "archived",
        processed_at: new Date().toISOString(),
        derived_notes: [],
        route_destination: "archive",
        route_proposed: rejectedLibrary ? "wiki" : undefined,
        processing_engine: aiResult.engine ? `ai:${aiResult.engine}` : "ai",
        processing_state: "classified",
        library_score: rejectedLibrary ? normalizedLibraryScore(aiResult.library_score) : undefined,
        knowledge_decision_reason: rejectedLibrary
          ? aiResult.library_reason || "Contenu insuffisamment substantiel, durable ou pertinent pour la Bibliothèque."
          : aiResult.discard_reason || "La capture ne nécessite aucun artefact durable.",
        processing_attempted_at: new Date().toISOString(),
        processing_skill: PROCESS_INBOX_SKILL,
        updated: new Date().toISOString(),
      }, capture.content, { expectedMtime: capture.mtime });
      continue;
    }

    const objectiveTitles = new Set(aiResult?.objective_titles || []);
    const matchedObjectives = dashboard.objectives
      .filter((objective) => objectiveTitles.has(objective.title)).slice(0, 5);
    const title = aiResult.title?.trim() || capture.title;
    const tags = uniqueStrings(["processed-capture", ...capture.tags, ...(aiResult.tags || [])]);
    const generatedBy = aiResult.engine ? `ai:${aiResult.engine}` : "ai";
    let derived: VaultNote;

    if (destination === "task") {
      const duplicateTask = dashboard.tasks.find((note) =>
        isOpenTask(note) && isLikelyDuplicateTask(title, note.title));
      derived = duplicateTask || await createTask({
        title,
        area: normalizeCaptureArea(aiResult.area),
        priority: normalizeCapturePriority(aiResult.priority),
        objective: matchedObjectives[0]?.title || "",
        why: aiResult.summary || aiResult.insight || "Action détectée dans une capture.",
        source: "ai-capture",
        sourceNote: capture.relativePath,
        execKind: normalizeExecKind(aiResult.exec_kind) || "manual",
      });
    } else if (destination === "raw") {
      derived = await writeNote("raw", {
        title,
        data: {
          status: "active",
          source: "inbox",
          source_note: capture.relativePath,
          tags,
          generated_by: generatedBy,
          skill: PROCESS_INBOX_SKILL,
          updated: new Date().toISOString(),
        },
        body: buildAiRoutedBody(title, capture, aiResult, matchedObjectives),
      });
    } else {
      const body = buildAiWikiBody(title, capture, aiResult, matchedObjectives);
      const isPendingAi = capture.status === "needs-ai"
        || stringValue(capture.data.processing_engine) === "local-fallback";
      const fallbackWikiPath = isPendingAi ? stringValue(capture.data.wiki_note) : "";
      const fallbackWiki = fallbackWikiPath
        ? dashboard.wiki.find((note) => note.relativePath === fallbackWikiPath)
        : undefined;
      const duplicate = fallbackWiki || (aiResult?.duplicate_path
        ? dashboard.wiki.find((note) => note.relativePath === aiResult.duplicate_path)
        : undefined);

      if (duplicate) {
        const previousSources = Array.isArray(duplicate.data.source_notes)
          ? duplicate.data.source_notes.map(String)
          : [stringValue(duplicate.data.source_note)].filter(Boolean);
        const isPendingFallback = duplicate.data.ai_pending === true
          || stringValue(duplicate.data.generated_by) === "local-fallback";
        const update = body.replace(/^#\s+.+?\r?\n+/, "").trim();
        await writeRawNote(duplicate.relativePath, {
          ...duplicate.data,
          status: "active",
          source_notes: uniqueStrings([...previousSources, capture.relativePath]),
          tags: uniqueStrings([...duplicate.tags, ...tags]),
          generated_by: generatedBy,
          ai_pending: false,
          skill: PROCESS_INBOX_SKILL,
          updated: new Date().toISOString(),
        }, isPendingFallback
          ? body
          : `${duplicate.content.trim()}\n\n---\n\n## Update from [[${capture.relativePath}|${capture.title}]]\n\n${update}`, {
          expectedMtime: duplicate.mtime,
        });
        const updated = await readNote(duplicate.relativePath);
        if (!updated) throw new Error("Processed Wiki update failed");
        derived = updated;
      } else {
        derived = await writeNote("wiki", {
          title,
          data: {
            status: "active",
            source: "inbox",
            source_note: capture.relativePath,
            source_notes: [capture.relativePath],
            tags,
            generated_by: generatedBy,
            ai_pending: false,
            library_score: normalizedLibraryScore(aiResult.library_score),
            library_reason: aiResult.library_reason?.trim() || undefined,
            skill: PROCESS_INBOX_SKILL,
            updated: new Date().toISOString(),
          },
          body,
        });
      }
    }

    const data: Record<string, unknown> = {
      ...capture.data,
      status: "processed",
      processed_at: new Date().toISOString(),
      route_destination: destination,
      wiki_note: destination === "wiki" ? derived.relativePath : undefined,
      derived_notes: [derived.relativePath],
      processing_engine: generatedBy,
      processing_state: "complete",
      processing_error: undefined,
      processing_attempted_at: new Date().toISOString(),
      processing_skill: PROCESS_INBOX_SKILL,
      library_score: destination === "wiki" ? normalizedLibraryScore(aiResult.library_score) : undefined,
      knowledge_decision_reason: destination === "wiki" ? aiResult.library_reason?.trim() || undefined : undefined,
      updated: new Date().toISOString(),
    };
    await writeRawNote(capture.relativePath, data, capture.content, { expectedMtime: capture.mtime });
    processed.push(derived);
  }

  return processed;
}

export async function archivePendingRssCapturesBefore(beforeDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(beforeDate)) throw new Error("Invalid archive cutoff");
  const dashboard = await getDashboard();
  const candidates = dashboard.inbox.filter((note) => {
    const pending = note.status === "inbox"
      || note.status === "needs-ai"
      || stringValue(note.data.processing_engine) === "local-fallback";
    const capturedAt = stringValue(note.data.captured_at);
    return pending && note.data.source === "rss" && capturedAt.slice(0, 10) < beforeDate;
  });
  const archivedAt = new Date().toISOString();
  await mapWithConcurrency(candidates, 12, async (capture) => {
    await writeRawNote(capture.relativePath, {
      ...capture.data,
      status: "archived",
      processed_at: archivedAt,
      derived_notes: [],
      route_destination: "archive",
      processing_engine: "rss-backlog-cleanup",
      processing_state: "classified",
      processing_error: undefined,
      knowledge_decision_reason: `Ancien élément RSS antérieur au ${beforeDate}, archivé sans polluer les tâches, les briefs ou la Bibliothèque.`,
      processing_attempted_at: archivedAt,
      processing_skill: PROCESS_INBOX_SKILL,
      updated: archivedAt,
    }, capture.content, { expectedMtime: capture.mtime });
  });
  return candidates.map((capture) => capture.relativePath);
}

export async function readFeeds(): Promise<FeedsConfig> {
  await ensureVault();
  const existing = await readNote(FEEDS_NOTE);
  if (existing) {
    return {
      feeds: normalizeFeedList(existing.data.feeds),
      enabled: existing.data.enabled !== false,
      lastRun: stringValue(existing.data.last_run),
      lastCount: Number(existing.data.last_count) || 0,
      relativePath: FEEDS_NOTE,
    };
  }
  const seeded = await defaultFeeds();
  await writeFeedsNote({ feeds: seeded, enabled: true, lastRun: "", lastCount: 0 });
  return { feeds: seeded, enabled: true, lastRun: "", lastCount: 0, relativePath: FEEDS_NOTE };
}

export async function addFeed(url: string): Promise<FeedsConfig> {
  const clean = url.trim();
  if (!clean) return readFeeds();
  let parsed: string;
  try {
    parsed = new URL(clean).toString();
  } catch {
    throw new Error("Invalid feed URL");
  }
  const config = await readFeeds();
  if (config.feeds.some((feed) => feed === parsed)) return config;
  const next = { ...config, feeds: [...config.feeds, parsed] };
  await writeFeedsNote(next);
  return next;
}

export async function removeFeed(url: string): Promise<FeedsConfig> {
  const config = await readFeeds();
  const next = { ...config, feeds: config.feeds.filter((feed) => feed !== url) };
  await writeFeedsNote(next);
  return next;
}

export async function setFeedsEnabled(enabled: boolean): Promise<FeedsConfig> {
  const config = await readFeeds();
  const next = { ...config, enabled };
  await writeFeedsNote(next);
  return next;
}

export async function ingestFeeds(options: { force?: boolean } = {}): Promise<IngestResult> {
  const ranAt = new Date().toISOString();
  if (ingestRunning) return { ranAt, added: 0, perFeed: {} };
  ingestRunning = true;
  try {
    const config = await readFeeds();
    if (!config.enabled && !options.force) return { ranAt, added: 0, perFeed: {} };

    const state = await readFeedState();
    const initialCap = Number(process.env.RSS_INITIAL_IMPORT ?? 3);
    const recurringCap = Math.min(Math.max(Number(process.env.RSS_MAX_IMPORT_PER_FEED ?? 3), 0), 20);
    const perFeed: IngestResult["perFeed"] = {};
    let added = 0;

    for (const url of config.feeds) {
      try {
        const items = await fetchFeed(url);
        const firstRun = !(url in state);
        const seen = new Set(state[url] || []);
        const fresh = items.filter((item) => item.id && !seen.has(item.id));
        // A busy feed must not flood the personal Inbox between two polls.
        // Keep only its newest bounded sample; AI routing will decide whether
        // those few items deserve a task, note, Wiki entry, or archive.
        const toImport = fresh.slice(0, firstRun ? Math.max(0, initialCap) : recurringCap);
        const host = feedHost(url);
        for (const item of toImport) {
          await createFeedCapture(item, url, host);
        }
        const ids = items.map((item) => item.id).filter(Boolean);
        state[url] = mergeFeedState(ids, state[url] || []);
        perFeed[url] = { added: toImport.length };
        added += toImport.length;
      } catch (error) {
        perFeed[url] = { added: 0, error: error instanceof Error ? error.message : "fetch failed" };
      }
    }

    await writeFeedState(state);
    await writeFeedsNote({ ...config, lastRun: ranAt, lastCount: added });
    return { ranAt, added, perFeed };
  } finally {
    ingestRunning = false;
  }
}

async function createFeedCapture(item: { title: string; link: string; summary?: string; published?: string }, feedUrl: string, host: string) {
  const title = item.title?.trim() || `New item from ${host}`;
  return writeNote("inbox", {
    title,
    data: {
      status: "inbox",
      source: "rss",
      feed: feedUrl,
      url: item.link || undefined,
      tags: ["rss", host],
      captured_at: item.published || new Date().toISOString(),
    },
    body: [
      `# ${title}`,
      "",
      item.link ? `[Source](${item.link})` : "",
      "",
      item.summary || "",
    ].filter((line) => line !== undefined).join("\n"),
  });
}

async function writeFeedsNote(config: Omit<FeedsConfig, "relativePath">) {
  const existing = await readNote(FEEDS_NOTE);
  const data = compactObject({
    type: "system",
    role: "feeds",
    title: "RSS Feeds",
    created: existing?.data.created || new Date().toISOString(),
    updated: new Date().toISOString(),
    enabled: config.enabled,
    last_run: config.lastRun,
    last_count: config.lastCount,
    feeds: config.feeds,
  });
  const body = [
    "# RSS Feeds",
    "",
    "Managed from the Feeds page. When enabled, each URL is polled on a schedule and new items enter the automatic capture history.",
  ].join("\n");
  await writeRawNote(FEEDS_NOTE, data, body, { expectedMtime: existing?.mtime });
}

export type BudgetLineItem = {
  id: string;
  label: string;
  category: string;
  price: string;
  frequency: string;
};

export type BudgetSubscriptionRecord = {
  id: string;
  service: string;
  usage: string;
  category: string;
  domain: string;
  price: string;
  frequency: string;
  nextDate: string;
  payment: string;
  decision: string;
};

export type MonthlyBudgetState = {
  month: string;
  income: string;
  fixedItems: BudgetLineItem[];
  variableItems: BudgetLineItem[];
  savingsTarget: string;
  subscriptions: BudgetSubscriptionRecord[];
};

export type MonthlyBudgetConfig = MonthlyBudgetState & { relativePath: string };

const DEFAULT_MONTHLY_BUDGET: MonthlyBudgetState = {
  month: "",
  income: "",
  fixedItems: [],
  variableItems: [],
  savingsTarget: "",
  subscriptions: [],
};

function parseBudgetLineItems(value: unknown): BudgetLineItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item, index) => ({
      id: stringValue(item.id) || `item-${index}`,
      label: stringValue(item.label),
      category: stringValue(item.category) || "other",
      price: stringValue(item.price),
      frequency: item.frequency === "yearly" ? "yearly" : "monthly",
    }));
}

function parseBudgetSubscriptions(value: unknown): BudgetSubscriptionRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item, index) => ({
      id: stringValue(item.id) || `sub-${index}`,
      service: stringValue(item.service),
      usage: stringValue(item.usage),
      category: stringValue(item.category) || "other",
      domain: stringValue(item.domain),
      price: stringValue(item.price),
      frequency: item.frequency === "yearly" ? "yearly" : "monthly",
      nextDate: stringValue(item.nextDate),
      payment: stringValue(item.payment),
      decision: item.decision === "reduce" || item.decision === "cut" ? String(item.decision) : "keep",
    }));
}

// Charges fixes, budget variable and abonnements are all lists of objects,
// which the vault's deliberately limited YAML parser cannot round-trip in
// frontmatter (it only understands scalars and flat arrays). They live as a
// single JSON block in the note body instead; only the scalar budget fields
// (month, income, savings target) go in frontmatter.
function parseBudgetBody(content: string): { fixedItems: BudgetLineItem[]; variableItems: BudgetLineItem[]; subscriptions: BudgetSubscriptionRecord[] } {
  const match = content.match(/```json\r?\n([\s\S]*?)```/);
  if (!match) return { fixedItems: [], variableItems: [], subscriptions: [] };
  try {
    const parsed = JSON.parse(match[1]);
    return {
      fixedItems: parseBudgetLineItems(parsed?.fixedItems),
      variableItems: parseBudgetLineItems(parsed?.variableItems),
      subscriptions: parseBudgetSubscriptions(parsed?.subscriptions),
    };
  } catch {
    return { fixedItems: [], variableItems: [], subscriptions: [] };
  }
}

function budgetNoteBody(input: Pick<MonthlyBudgetState, "fixedItems" | "variableItems" | "subscriptions">): string {
  return [
    "# Budget mensuel",
    "",
    "Géré depuis la page Budget de l’application. Charges fixes, budget variable et abonnements sont stockés en JSON ci-dessous ; ne pas éditer à la main.",
    "",
    "```json",
    JSON.stringify(input, null, 2),
    "```",
  ].join("\n");
}

export async function readMonthlyBudget(): Promise<MonthlyBudgetConfig> {
  await ensureVault();
  const existing = await readNote(BUDGET_NOTE);
  if (!existing) return { ...DEFAULT_MONTHLY_BUDGET, relativePath: BUDGET_NOTE };
  const body = parseBudgetBody(existing.content);
  return {
    month: stringValue(existing.data.month),
    income: stringValue(existing.data.income),
    savingsTarget: stringValue(existing.data.savings_target),
    ...body,
    relativePath: BUDGET_NOTE,
  };
}

export async function writeMonthlyBudget(input: MonthlyBudgetState): Promise<MonthlyBudgetConfig> {
  const existing = await readNote(BUDGET_NOTE);
  const data = compactObject({
    type: "system",
    role: "budget",
    title: "Budget mensuel",
    created: existing?.data.created || new Date().toISOString(),
    updated: new Date().toISOString(),
    month: input.month,
    income: input.income,
    savings_target: input.savingsTarget,
  });
  await writeRawNote(BUDGET_NOTE, data, budgetNoteBody(input), { expectedMtime: existing?.mtime });
  return { ...input, relativePath: BUDGET_NOTE };
}

// Remember every id currently in the feed, plus a margin of recent history.
// Capping below the feed size (FEED_STATE_CAP) drops still-present items from
// the seen-set, so a feed larger than the cap re-imports its tail on every
// poll. Keeping at least ids.length guarantees a present item is never
// forgotten and re-imported.
export function mergeFeedState(currentIds: string[], previous: string[]): string[] {
  return uniqueStrings([...currentIds, ...previous]).slice(0, Math.max(FEED_STATE_CAP, currentIds.length));
}

async function readFeedState(): Promise<Record<string, string[]>> {
  const filePath = path.join(vaultRoot(), FEED_STATE_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeFeedState(state: Record<string, string[]>) {
  const filePath = path.join(vaultRoot(), FEED_STATE_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteFile(filePath, JSON.stringify(state));
}

async function defaultFeeds(): Promise<string[]> {
  const fromEnv = process.env.WATCH_RSS_FEEDS;
  const envFile = process.env.MEMO_ENV_FILE || "";
  const fromFile = await envFileValue(envFile, "WATCH_RSS_FEEDS");
  const list = splitFeedList(fromEnv) ?? splitFeedList(fromFile);
  return list && list.length ? list : [...DEFAULT_FEEDS];
}

function splitFeedList(value?: string): string[] | null {
  if (!value) return null;
  const list = value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  return list.length ? list : null;
}

function normalizeFeedList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return splitFeedList(value) || [];
  return [];
}

function feedHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "rss";
  }
}

async function writeNote(folder: VaultFolder, input: WriteInput) {
  await ensureVaultDirsOnly();
  const root = vaultRoot();
  const folderName = VAULT_FOLDERS[folder];
  const now = new Date().toISOString();
  const fileName = input.filename || `${timestampSlug()}-${slugify(input.title)}.md`;
  const relativePath = await uniqueRelativePath(`${folderName}/${fileName}`);
  const data = compactObject({
    type: FOLDER_KIND[folder],
    created: now,
    updated: now,
    ...(input.data || {}),
    title: input.title,
  });
  await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
  await writeRawNote(relativePath, data, input.body);
  const note = await readNoteFromFile(resolveVaultPath(relativePath));
  if (!note) throw new Error("Note write failed");
  return note;
}

export async function writeRawNote(
  relativePath: string,
  data: Record<string, unknown>,
  body: string,
  options: { expectedMtime?: string } = {},
) {
  const fullPath = resolveVaultPath(relativePath);
  const raw = stringifyMarkdown(compactObject(data), `${body.trim()}\n`);
  // Vault Markdown is shared with the host-side `secondbrain` group. Atomic
  // replacement must not silently revert files to owner-only mode.
  await atomicWriteFile(fullPath, raw, { ...options, mode: 0o660 });
  invalidateDashboardCache();
}

async function ensureVaultDirsOnly() {
  const root = vaultRoot();
  await Promise.all(
    Object.values(VAULT_FOLDERS).map((folder) => fs.mkdir(path.join(root, folder), { recursive: true })),
  );
}

async function walkMarkdown(start: string, skipDirs?: Set<string>): Promise<string[]> {
  const entries = await fs.readdir(start, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name.startsWith(".")) return [];
      if (entry.isDirectory() && skipDirs?.has(entry.name)) return [];
      const fullPath = path.join(start, entry.name);
      if (entry.isDirectory()) return walkMarkdown(fullPath, skipDirs);
      if (entry.isFile() && entry.name.endsWith(".md")) return [fullPath];
      return [];
    }),
  );
  return files.flat();
}

async function readNoteFromFile(fullPath: string): Promise<VaultNote | null> {
  try {
    const root = vaultRoot();
    const raw = await fs.readFile(fullPath, "utf8");
    const parsed = parseMarkdown(raw);
    const stat = await fs.stat(fullPath);
    const relativePath = path.relative(root, fullPath).split(path.sep).join("/");
    const folder = relativePath.split("/")[0] || "";
    const title = titleFor(relativePath, parsed.data, parsed.content);
    const tags = normalizeTags(parsed.data.tags);
    return {
      id: relativePath,
      title,
      relativePath,
      folder,
      kind: stringValue(parsed.data.type) || kindFromFolder(folder),
      data: parsed.data,
      content: parsed.content.trim(),
      excerpt: excerpt(parsed.content),
      tags,
      links: extractLinks(parsed.content),
      status: normalizeStatus(stringValue(parsed.data.status)) || "",
      mtime: stat.mtime.toISOString(),
    };
  } catch (error) {
    // A note that cannot be read (bad encoding, permissions, corrupted file)
    // used to vanish from every listing with no trace. Log it so an unreadable
    // note is discoverable instead of silently dropped.
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      console.error(`[vault] failed to read note ${fullPath}:`, error);
    }
    return null;
  }
}

export function resolveVaultPath(relativePath: string) {
  const root = vaultRoot();
  const clean = relativePath.replace(/^\/+/, "");
  const fullPath = path.resolve(root, clean);
  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
    throw new Error("Path escapes vault");
  }
  return fullPath;
}

async function uniqueRelativePath(relativePath: string) {
  const parsed = path.parse(relativePath);
  let candidate = relativePath;
  let index = 2;
  while (await exists(resolveVaultPath(candidate))) {
    candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`).split(path.sep).join("/");
    index += 1;
  }
  return candidate.split(path.sep).join("/");
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function titleFor(relativePath: string, data: Record<string, unknown>, content: string) {
  const frontmatterTitle = stringValue(data.title);
  if (frontmatterTitle) return frontmatterTitle;
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return path.basename(relativePath, ".md").replace(/-/g, " ");
}

function normalizeTags(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    return value.split(",").map((tag) => tag.trim()).filter(Boolean);
  }
  return [];
}

function extractLinks(content: string) {
  return [...content.matchAll(WIKILINK_RE)].map((match) => match[1].trim()).filter(Boolean);
}

function excerpt(content: string) {
  return content
    .replace(/^---[\s\S]*?---/, "")
    .replace(/^#+\s+/gm, "")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => alias || target)
    .replace(/^-\s+\[[ xX]\]\s+/gm, "")
    .replace(DECORATIVE_EMOJI_RE, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function stringValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}

function normalizeStatus(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Keep `done_on` consistent for task notes regardless of which write path runs.
 * When a task reaches `done`, stamp today's date (unless one is already present);
 * when it leaves `done`, drop the stamp. No-op for non-task notes.
 */
function applyDoneOn(data: Record<string, unknown>, kind: string, status: string) {
  if (kind !== "task") return;
  if (status === "done") {
    if (!stringValue(data.done_on)) data.done_on = new Date().toISOString();
  } else {
    delete data.done_on;
  }
}

function setOptional(data: Record<string, unknown>, key: string, value?: string) {
  const clean = value?.trim();
  if (clean) {
    data[key] = clean;
  } else {
    delete data[key];
  }
}

function syncHeading(content: string, title: string, previousTitle: string) {
  const body = content.trim();
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (!body) return `# ${title}\n`;
  if (!heading) return `# ${title}\n\n${body}\n`;
  if (heading === previousTitle || heading === title) {
    return body.replace(/^#\s+.+$/m, `# ${title}`) + "\n";
  }
  return body + "\n";
}

function noteDate(note: VaultNote, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(note.data[key]);
    if (value) return value;
  }
  return note.mtime;
}

function isoDaysBefore(value: string, days: number) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function valueInDateWindow(value: string, start: string, end: string) {
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= start && date <= end;
}

export function notesInDateWindow(notes: VaultNote[], start: string, end: string, keys: string[]) {
  return notes.filter((note) => {
    const frontmatterDate = keys
      .map((key) => stringValue(note.data[key]))
      .find((value) => /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10)));
    const pathDate = note.relativePath.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || "";
    return valueInDateWindow(frontmatterDate || pathDate || note.mtime, start, end);
  });
}

export function completedTasksInDateWindow(notes: VaultNote[], start: string, end: string) {
  return notes.filter((note) => isDoneTask(note)
    && valueInDateWindow(stringValue(note.data.done_on), start, end));
}

function sortNotes(notes: VaultNote[], keys: string[]) {
  return [...notes].sort((a, b) => noteDate(b, keys).localeCompare(noteDate(a, keys)));
}

function sortTasks(notes: VaultNote[]) {
  const weight: Record<string, number> = { doing: 0, active: 0, todo: 1, done: 2, abandoned: 3 };
  return [...notes].sort((a, b) => {
    const statusDiff = (weight[a.status] ?? 4) - (weight[b.status] ?? 4);
    if (statusDiff) return statusDiff;
    // Completed tasks rank by when they were done (newest first) so a freshly
    // checked-off task lands at the top of Done, not the bottom.
    const keys =
      a.status === "done" && b.status === "done"
        ? ["done_on", "updated", "created"]
        : ["proposed_on", "updated", "created"];
    return noteDate(b, keys).localeCompare(noteDate(a, keys));
  });
}

function sortObjectives(notes: VaultNote[]) {
  const priority: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const orderOf = (n: VaultNote) => {
    const raw = n.data.order;
    const num = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(num) ? num : Number.POSITIVE_INFINITY;
  };
  return [...notes].sort((a, b) => {
    const orderDiff = orderOf(a) - orderOf(b);
    if (orderDiff) return orderDiff;
    const priorityDiff = (priority[stringValue(a.data.priority)] ?? 3) - (priority[stringValue(b.data.priority)] ?? 3);
    if (priorityDiff) return priorityDiff;
    return a.title.localeCompare(b.title);
  });
}

function kindFromFolder(folder: string) {
  const found = Object.entries(VAULT_FOLDERS).find(([, name]) => name === folder);
  return found ? FOLDER_KIND[found[0] as VaultFolder] : "note";
}

function timestampSlug() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function inferTitle(text: string, url?: string) {
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (firstLine) return firstLine.slice(0, 90);
  if (url) {
    try {
      return `To read - ${new URL(url).hostname.replace(/^www\./, "")}`;
    } catch {
      return "Captured link";
    }
  }
  return "Capture";
}

function compactObject(obj: Record<string, unknown>) {
  const result = Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
  // Carry the (non-enumerable) round-trip metadata across compaction so
  // stringifyMarkdown can still re-emit untouched keys verbatim.
  return carryRawFrontmatter(obj, result);
}

/**
 * Copy the non-enumerable frontmatter round-trip metadata from `source` onto
 * `target`. Callers that build a new frontmatter object by spreading a parsed
 * note's `data` (which strips the symbol) use this to keep verbatim preservation
 * working for keys they did not change.
 */
function carryRawFrontmatter<T extends Record<string, unknown>>(source: Record<string, unknown>, target: T): T {
  const raw = getRawFrontmatter(source);
  if (raw) {
    Object.defineProperty(target, RAW_FRONTMATTER, {
      value: raw,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  return target;
}

function rankTasks(notes: VaultNote[]) {
  const priority: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const status: Record<string, number> = { doing: 0, active: 0, todo: 1 };
  return [...notes].sort((a, b) => {
    const statusDiff = (status[a.status] ?? 3) - (status[b.status] ?? 3);
    if (statusDiff) return statusDiff;
    const priorityDiff =
      (priority[stringValue(a.data.priority).toLowerCase()] ?? 3) -
      (priority[stringValue(b.data.priority).toLowerCase()] ?? 3);
    if (priorityDiff) return priorityDiff;
    return noteDate(b, ["proposed_on", "updated", "created"]).localeCompare(
      noteDate(a, ["proposed_on", "updated", "created"]),
    );
  });
}

/**
 * Closed-loop metric: of the tasks the AI brief proposed in the last 7 days,
 * how many actually got done? The daily brief proposes and the weekly review
 * reflects, but nothing measured whether proposals turn into execution — this
 * is that measure.
 */
export function aiTaskCompletion(tasks: VaultNote[], now = new Date()) {
  const windowStart = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const proposed = tasks.filter((note) =>
    stringValue(note.data.source) === "ai-brief"
    && stringValue(note.data.proposed_on).slice(0, 10) >= windowStart,
  );
  const done = proposed.filter(isDoneTask);
  return {
    proposed: proposed.length,
    done: done.length,
    label: proposed.length
      ? `${done.length}/${proposed.length} (${Math.round((done.length / proposed.length) * 100)}%)`
      : "0/0",
  };
}

function detectBlindSpots(data: DashboardData) {
  const spots: string[] = [];
  const conflictFiles = [
    ...data.inbox, ...data.raw, ...data.objectives, ...data.tasks,
    ...data.daily, ...data.weekly, ...data.wiki, ...data.system,
  ].filter((note) => isSyncConflictPath(note.relativePath));
  if (conflictFiles.length) {
    spots.push(
      `${conflictFiles.length} fichier(s) de conflit de synchronisation sont présents, donc le coffre a divergé `
      + `pendant une édition concurrente : ${conflictFiles.map((note) => note.relativePath).join(", ")}.`,
    );
  }
  const openTasks = data.tasks.filter(isOpenTask);
  const orphanTasks = openTasks.filter((note) => !stringValue(note.data.objective));
  const activeObjectives = data.objectives.filter((note) => note.status === "active");
  const context = data.system.find((note) => note.relativePath.endsWith("Context.md"));

  if (context?.content.includes("Replace this with the durable context")) {
    spots.push("Le contexte système contient encore le texte d’amorçage, donc la mémoire doit être complétée "
      + "avant de faire confiance à une synthèse.");
  }
  if (orphanTasks.length) {
    spots.push(`${orphanTasks.length} tâche(s) ouverte(s) ne sont rattachées à aucun objectif, `
      + "donc leur contribution n’est pas mesurable.");
  }
  if (activeObjectives.length > 8) {
    spots.push(`${activeObjectives.length} objectifs sont actifs en même temps, ce qui dilue la concentration `
      + "sur l’exécution.");
  }
  return spots;
}

async function generateAiInboxNote(
  capture: VaultNote,
  data: DashboardData,
  instructions: string,
): Promise<AiProcessResponse | null> {
  const config = await memoBridgeConfig();
  if (!config || !instructions.trim()) return null;
  const ai = await aiSetupPreferences(process.env.PROCESS_MODEL);
  if (!ai.engineOrder.length) return null;
  const systemContext = data.system.find((note) => note.relativePath.endsWith("Context.md"))?.content || "";
  const response = await fetch(`${config.url.replace(/\/+$/, "")}/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({
      capture: { ...noteForAi(capture), content: capture.content.slice(0, 6000) },
      system_context: systemContext,
      objectives: data.objectives.filter(isActiveObjective).slice(0, 16).map(objectiveForAi),
      existing_wiki: data.wiki.filter((note) => note.status !== "archived").slice(0, 24).map(noteForAi),
      open_tasks: rankTasks(data.tasks.filter(isOpenTask)).slice(0, 16).map(taskForAi),
      instructions,
      context_source: "obsidian",
      engine_order: ai.engineOrder,
      models: ai.models,
    }),
    signal: AbortSignal.timeout(Number(process.env.AI_PROCESS_TIMEOUT_MS || 180000)),
  });
  if (!response.ok) return null;
  const json = await response.json().catch(() => null) as AiProcessResponse | null;
  return json?.ok && json.summary ? json : null;
}

// A module's own data file is often its only real evidence (the Garmin sync
// journal runs to ~14 KB). At 6 notes x 900 chars a nine-note training project
// lost three notes outright and showed ~7% of the journal, so questions about
// training sessions had nothing to answer from.
export const MODULE_EVIDENCE_NOTE_LIMIT = 16;
export const MODULE_EVIDENCE_CONTENT_LIMIT = 6000;
const MODULE_EVIDENCE_PAGE_LIMIT = 12;
const MODULE_EVIDENCE_OMISSION = "\n\n[... contenu intermédiaire omis ...]\n\n";

function isLivingModuleNote(note: VaultNote) {
  return note.status !== "archived"
    && !note.relativePath.split("/").some((part) => part.toLowerCase() === "archive" || part === "_Archive");
}

function moduleKeyForNote(note: VaultNote): ActiveModuleKey | "" {
  const relativePath = note.relativePath;
  const type = stringValue(note.data.type).toLowerCase();
  const revisionProjectDir = (process.env.REVISION_PROJECT_DIR?.trim() || DEFAULT_REVISION_PROJECT_DIR)
    .replace(/^\/+|\/+$/g, "");
  if (relativePath === BUDGET_NOTE) return "budget";
  if (relativePath === BUSINESS_SETTINGS_NOTE || relativePath.startsWith(`${VAULT_FOLDERS.business}/`)) return "business";
  if (relativePath.startsWith(`${VAULT_FOLDERS.finance}/`)) return "finance";
  if (relativePath.startsWith(`${CUSTOM_ROOT}/`)) return "custom";
  if (relativePath.startsWith(`${revisionProjectDir}/`) || type.startsWith("revision_")) return "revisions";
  if (/^08-Projects\/(?:Training|Trail(?:[-/]|$))/i.test(relativePath) || /^(?:training|trail)_/.test(type)) return "training";
  return "";
}

function moduleEvidenceContent(content: string, limit = MODULE_EVIDENCE_CONTENT_LIMIT) {
  if (content.length <= limit) return content;
  const available = limit - MODULE_EVIDENCE_OMISSION.length;
  const headLength = Math.floor(available * 0.4);
  const tailLength = available - headLength;
  return `${content.slice(0, headLength)}${MODULE_EVIDENCE_OMISSION}${content.slice(-tailLength)}`;
}

function moduleEvidenceItem(note: VaultNote) {
  return {
    title: note.title.slice(0, 160),
    status: note.status.slice(0, 40),
    tags: note.tags.slice(0, 8).map((tag) => tag.slice(0, 60)),
    path: note.relativePath,
    date: stringValue(note.data.date).slice(0, 40),
    updated: stringValue(note.data.updated).slice(0, 40),
    excerpt: note.excerpt.slice(0, 300),
    // Generated journals are chronological: their newest and most useful
    // entries live at the end. Preserve both ends so questions about the
    // latest activity do not receive only the oldest rows.
    content: moduleEvidenceContent(note.content),
  };
}

function boundedModule(notes: VaultNote[], pages?: string[]): NonNullable<ActiveModuleEvidence[ActiveModuleKey]> {
  const sorted = [...notes].sort((a, b) => b.mtime.localeCompare(a.mtime) || a.relativePath.localeCompare(b.relativePath));
  return {
    state: sorted.length ? "ready" : "empty",
    total: sorted.length,
    ...(pages ? { pages: pages.slice(0, MODULE_EVIDENCE_PAGE_LIMIT).map((page) => page.slice(0, 160)) } : {}),
    notes: sorted.slice(0, MODULE_EVIDENCE_NOTE_LIMIT).map(moduleEvidenceItem),
  };
}

export function activeModuleEvidence(allNotes: VaultNote[], modules: SetupState["modules"]): ActiveModuleEvidence {
  const living = allNotes.filter(isLivingModuleNote);
  const byModule = (module: ActiveModuleKey) => living.filter((note) => moduleKeyForNote(note) === module);
  const evidence: ActiveModuleEvidence = {};
  if (modules.finance) evidence.finance = boundedModule(byModule("finance"));
  if (modules.budget) evidence.budget = boundedModule(byModule("budget"));
  if (modules.business) evidence.business = boundedModule(byModule("business"));
  if (modules.trail) evidence.training = boundedModule(byModule("training"));
  if (modules.revisions) evidence.revisions = boundedModule(byModule("revisions"));

  const configuredCustomPages = new Set(modules.custom.map((title) => title.trim().toLowerCase()).filter(Boolean));
  const customRegistries = living.filter((note) =>
    note.relativePath.startsWith(`${CUSTOM_REGISTRY_DIR}/`)
    && (note.data.daily === true || configuredCustomPages.has(note.title.trim().toLowerCase())));
  const customPageNames = uniqueStrings([...modules.custom, ...customRegistries.map((note) => note.title)]);
  if (customPageNames.length) {
    const slugs = new Set(customRegistries.map((note) => stringValue(note.data.slug) || path.basename(note.relativePath, ".md")));
    const customNotes = living.filter((note) => {
      const match = note.relativePath.match(/^11-Custom\/([^/]+)\//);
      return Boolean(match && match[1] !== "_registry" && slugs.has(match[1]));
    });
    evidence.custom = boundedModule(customNotes, customPageNames);
  }
  return evidence;
}

function moduleEvidencePaths(evidence: ActiveModuleEvidence) {
  return uniqueStrings(Object.values(evidence).flatMap((module) => module?.notes.map((note) => note.path) || []));
}

function generalAiNotes(notes: VaultNote[]) {
  return notes.filter((note) => isLivingModuleNote(note) && !moduleKeyForNote(note));
}

function synthesisFeedback(data: DashboardData): BriefFeedbackRecord[] {
  return [...data.daily, ...data.weekly]
    .flatMap((note): BriefFeedbackRecord[] => {
      const verdict = stringValue(note.data.brief_feedback);
      if (verdict !== "useful" && verdict !== "not_useful") return [];
      return [{
        kind: note.kind === "weekly" ? "weekly" : "daily",
        period: stringValue(note.data.date) || stringValue(note.data.week) || note.title,
        verdict,
        reason: stringValue(note.data.brief_feedback_reason).slice(0, 600),
        recordedAt: stringValue(note.data.brief_feedback_at),
      }];
    })
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    // Every recorded verdict is a standing correction, not a mood: truncating
    // the history to a fortnight made the brief re-earn the same complaint.
    .slice(0, 30);
}

function dailyAiInputs(data: DashboardData, date: string, moduleEvidence: ActiveModuleEvidence) {
  const recentStart = isoDaysBefore(date, 2);
  return {
    // Raw Inbox material is not evidence yet. Only feed the brief captures
    // that the routing workflow classified during the same three-day window.
    captures: notesInDateWindow(
      data.inbox.filter(isBriefReadyCapture),
      recentStart,
      date,
      ["processed_at", "processing_attempted_at", "updated", "captured_at", "created"],
    ).slice(0, 24),
    rawContext: notesInDateWindow(data.raw, recentStart, date, ["date", "created", "updated"]),
    wikiSignals: generalAiNotes(data.wiki).filter((note) => note.status === "active").slice(0, 16),
    openTasks: rankTasks(data.tasks.filter(isOpenTask)).slice(0, 20),
    completedTasks: completedTasksInDateWindow(data.tasks, recentStart, date).slice(0, 16),
    objectives: data.objectives.filter(isActiveObjective).slice(0, 24),
    projectNotes: generalAiNotes(data.projects).slice(0, 40),
    moduleEvidence,
    previousBrief: data.daily.find((note) => stringValue(note.data.date) !== date),
  };
}

async function generateAiDailyBrief(
  data: DashboardData,
  date: string,
  inputs: ReturnType<typeof dailyAiInputs>,
  detail: BriefDetail,
): Promise<AiBriefResponse | null> {
  const config = await memoBridgeConfig();
  if (!config) throw new Error("bridge IA non configuré");
  const state = await readSetupState();
  const ai = await aiSetupPreferences(process.env.BRIEF_MODEL);
  const selectedProvider = state.automation.dailyBriefProvider;
  if (selectedProvider && state.ai.verified.includes(selectedProvider) && state.automation.dailyBriefModel) {
    ai.engineOrder = uniqueStrings([selectedProvider, ...ai.engineOrder]) as AiProvider[];
    ai.models[selectedProvider] = state.automation.dailyBriefModel;
  }
  if (!ai.engineOrder.length) throw new Error("aucun moteur IA connecté ou vérifié");
  // Settings pre-fills the prompt field with this same base skill text, so a
  // saved value already contains it — using both would send it twice.
  const instructions = state.automation.dailyBriefPrompt || await readSkillInstructions(DAILY_SKILL);
  const systemContext = data.system.find((note) => note.relativePath.endsWith("Context.md"))?.content || "";
  // The brief prompt asks the model to compare against "previous commitments";
  // without the actual prior brief text it has nothing to check against and
  // free-associates continuity instead of verifying task/project status.
  if (!systemContext.trim()) throw new Error("contexte système vide");

  const response = await fetch(`${config.url.replace(/\/+$/, "")}/brief`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({
      date,
      detail,
      system_context: systemContext,
      context: formatNotesForContext(inputs.rawContext),
      items: inputs.captures.map(noteForAi),
      objectives: inputs.objectives.map(objectiveForAi),
      open_tasks: inputs.openTasks.map(taskForAi),
      completed_tasks: inputs.completedTasks.map(taskForAi),
      wiki: inputs.wikiSignals.map(noteForAi),
      projects: inputs.projectNotes.map(noteForAi),
      module_evidence: inputs.moduleEvidence,
      synthesis_feedback: synthesisFeedback(data),
      previous_brief: inputs.previousBrief
        ? { date: stringValue(inputs.previousBrief.data.date), path: inputs.previousBrief.relativePath, content: inputs.previousBrief.content.slice(0, 8000) }
        : null,
      instructions,
      context_source: "obsidian",
      engine_order: ai.engineOrder,
      models: ai.models,
    }),
    signal: AbortSignal.timeout(Number(process.env.AI_BRIEF_TIMEOUT_MS || 240000)),
  });

  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(failure?.error || `bridge IA HTTP ${response.status}`);
  }
  const json = await response.json().catch(() => null) as AiBriefResponse | null;
  if (!json?.ok || !json.brief) throw new Error("réponse IA vide ou invalide");
  return json;
}

async function generateAiWeeklyReview(
  data: DashboardData,
  reviewWindow: { start: string; end: string },
  moduleEvidence: ActiveModuleEvidence,
  detail: BriefDetail,
): Promise<AiWeeklyResponse | null> {
  const config = await memoBridgeConfig();
  if (!config) throw new Error("bridge IA non configuré");
  const ai = await aiSetupPreferences(process.env.WEEKLY_MODEL);
  if (!ai.engineOrder.length) throw new Error("aucun moteur IA connecté ou vérifié");
  const instructions = await readSkillInstructions(WEEKLY_SKILL);
  const systemContext = data.system.find((note) => note.relativePath.endsWith("Context.md"))?.content || "";
  if (!instructions.trim()) throw new Error("instructions Weekly introuvables");
  if (!systemContext.trim()) throw new Error("contexte système vide");
  const weekStart = reviewWindow.start;
  const weekEnd = reviewWindow.end;
  const completedTasks = completedTasksInDateWindow(data.tasks, weekStart, weekEnd);
  const dailyBriefs = notesInDateWindow(data.daily, weekStart, weekEnd, ["date", "created", "updated"]);
  const journal = notesInDateWindow(data.raw, weekStart, weekEnd, ["date", "created", "updated"]);
  const response = await fetch(`${config.url.replace(/\/+$/, "")}/weekly`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({
      week_start: weekStart,
      week_end: weekEnd,
      detail,
      language: "French",
      system_context: systemContext,
      daily_briefs: dailyBriefs.slice(0, 7).map(noteForAi),
      journal: journal.map((note) => ({ ...noteForAi(note), content: note.content })),
      todos: rankTasks(data.tasks.filter(isOpenTask)).slice(0, 20).map(taskForAi),
      objectives: data.objectives.filter(isActiveObjective).slice(0, 20).map(objectiveForAi),
      completed_tasks: completedTasks.map(taskForAi),
      tasks: data.tasks.filter((note) => !isDoneTask(note)).slice(0, 30).map(taskForAi),
      library: generalAiNotes(data.wiki).filter((note) => note.status === "active").slice(0, 20).map(noteForAi),
      projects: generalAiNotes(data.projects).slice(0, 30).map(noteForAi),
      inbox: data.inbox.filter(isBriefReadyCapture).slice(0, 20).map(noteForAi),
      module_evidence: moduleEvidence,
      synthesis_feedback: synthesisFeedback(data),
      memory_lint: {
        blind_spots: detectBlindSpots(data),
        ai_task_completion_7d: aiTaskCompletion(data.tasks).label,
        inbox_pending: data.inbox.filter(isInboxCapture).length,
        inbox_processed: data.inbox.filter((note) => note.status === "processed").length,
        objectives_without_next_step: data.objectives
          .filter(isActiveObjective)
          .filter((note) => !/## Next step\s+\S/i.test(note.content))
          .map((note) => note.title),
      },
      instructions,
      context_source: "obsidian",
      engine_order: ai.engineOrder,
      models: ai.models,
    }),
    signal: AbortSignal.timeout(Number(process.env.AI_WEEKLY_TIMEOUT_MS || 240000)),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(failure?.error || `bridge IA HTTP ${response.status}`);
  }
  const json = await response.json().catch(() => null) as AiWeeklyResponse | null;
  if (!json?.ok || !json.review) throw new Error("réponse IA vide ou invalide");
  return json;
}

export type AssistantChatMessage = { role: "user" | "assistant"; content: string };
export type AssistantChatReply = { reply: string; engine: string };
export type AssistantChatOptions = { engine?: "claude" | "codex"; model?: string; effort?: string };

type AiChatResponse = {
  ok?: boolean;
  reply?: string;
  engine?: string;
  edits?: unknown;
};

const MODEL_ID_RE = /^[a-zA-Z0-9._:/@-]{1,160}$/;
const ASSISTANT_EDIT_ROOTS = ["02-Raw/", "03-Wiki/", "05-Tasks/", "08-Projects/", "10-Finance/", "11-Custom/", "12-Business/"];
const TRAINING_PLAN_PATH = "08-Projects/Training/plan-data.json";

export function assistantEditRequested(question: string) {
  const plain = question.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const unambiguousAction = /\b(mets?|mettez|mettre|modifi\w*|appliqu\w*|enregistr\w*|sauvegard\w*|update|edit|change|fix|apply|save)\b/.test(plain);
  const correctionAction = /\bcorrig(?:e|er|ez)\s+(?:le|la|les|ce|cet|cette|mon|ma|mes|ton|ta|tes|notre|nos|dans|directement)\b/.test(plain);
  return unambiguousAction || correctionAction;
}

function assistantTrainingPlanRequested(question: string) {
  const plain = question.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /\b(plan|entrainement|training|trail|course|seance)\b/.test(plain);
}

async function applyAssistantEdits(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("modification IA absente");
  }
  const edits = value.slice(0, 4).map((entry) => {
    const raw = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    return {
      path: typeof raw.path === "string" ? raw.path.trim() : "",
      content: typeof raw.content === "string" ? raw.content : "",
    };
  }).filter((edit) =>
    (edit.path === TRAINING_PLAN_PATH || edit.path.endsWith(".md"))
    && !edit.path.includes("..")
    && !edit.path.startsWith("/")
    && (edit.path === TRAINING_PLAN_PATH || ASSISTANT_EDIT_ROOTS.some((root) => edit.path.startsWith(root)))
    && edit.content.trim(),
  );
  if (edits.some((edit) => edit.content.length > (edit.path === TRAINING_PLAN_PATH ? 100_000 : 20_000))) {
    throw new Error("modification IA trop volumineuse");
  }
  if (value.length && !edits.length) throw new Error("modification IA refusée");
  if (new Set(edits.map((edit) => edit.path)).size !== edits.length) throw new Error("modification IA dupliquée");
  const planEdit = edits.find((edit) => edit.path === TRAINING_PLAN_PATH);
  if (planEdit) {
    if (edits.length !== 1) throw new Error("le plan d'entraînement doit être modifié seul");
    const { saveTrainingPlanJson } = await import("@/lib/trail");
    await saveTrainingPlanJson(JSON.parse(planEdit.content));
    return;
  }
  const notes = await Promise.all(edits.map(async (edit) => ({ edit, note: await readNote(edit.path) })));
  if (notes.some(({ note }) => !note)) throw new Error("une note proposée par l'assistant est introuvable");
  for (const { edit, note } of notes) {
    await writeRawNote(edit.path, { ...note!.data, updated: new Date().toISOString() }, edit.content, { expectedMtime: note!.mtime });
  }
}

// The chat evidence payload must stay several times smaller than the brief's
// (same Pi, ~1/3 the time budget). noteForAi's `content` field alone can run
// to AI_NOTE_CONTENT_LIMIT chars; cap it here rather than adding a second
// full-note mapper.
function compactForChat(note: ReturnType<typeof noteForAi>) {
  return note.content.length > 700 ? { ...note, content: note.content.slice(0, 700) } : note;
}

const ASSISTANT_STOP_WORDS = new Set(["avec", "dans", "pour", "que", "qui", "quoi", "mais", "mes", "mon", "une", "des", "les", "the", "and", "for", "what", "with"]);

function normalizedAssistantText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function assistantSearchTerms(question: string) {
  return [...new Set(normalizedAssistantText(question).match(/[a-z0-9]{3,}/g) || [])]
    .filter((term) => !ASSISTANT_STOP_WORDS.has(term));
}

export function relevantAssistantNotes(notes: VaultNote[], question: string, limit = 12) {
  const terms = assistantSearchTerms(question);
  if (!terms.length) return notes.slice().sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, limit);
  return notes.map((note) => {
    const title = normalizedAssistantText(note.title);
    const path = normalizedAssistantText(note.relativePath);
    const tags = normalizedAssistantText(note.tags.join(" "));
    const content = normalizedAssistantText(note.content);
    const score = terms.reduce((sum, term) => sum
      + (title.includes(term) ? 8 : 0)
      + (tags.includes(term) ? 5 : 0)
      + (path.includes(term) ? 3 : 0)
      + (content.includes(term) ? 1 : 0), 0);
    return { note, score };
  }).filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.note.mtime.localeCompare(a.note.mtime))
    .slice(0, limit)
    .map((entry) => entry.note);
}

function assistantEvidenceExcerpt(content: string, question: string, limit = 2400) {
  if (content.length <= limit) return content;
  const normalized = normalizedAssistantText(content);
  const terms = assistantSearchTerms(question);
  const hits = terms.flatMap((term) => {
    const indexes: number[] = [];
    let from = 0;
    while (indexes.length < 8) {
      const index = normalized.indexOf(term, from);
      if (index < 0) break;
      indexes.push(index);
      from = index + term.length;
    }
    return indexes;
  });
  if (!hits.length) return moduleEvidenceContent(content, limit);

  const candidates = hits.map((hit) => Math.max(0, Math.min(
    content.length - limit,
    hit - Math.floor(limit * 0.3),
  )));
  const bestStart = candidates
    .map((start) => {
      const window = normalized.slice(start, start + limit);
      const score = terms.reduce((sum, term) => {
        let occurrences = 0;
        let from = 0;
        while (occurrences < 6) {
          const index = window.indexOf(term, from);
          if (index < 0) break;
          occurrences += 1;
          from = index + term.length;
        }
        return sum + occurrences;
      }, 0);
      return { start, score };
    })
    .sort((a, b) => b.score - a.score || a.start - b.start)[0]?.start || 0;
  return `${bestStart ? "[...]\n" : ""}${content.slice(bestStart, bestStart + limit)}${bestStart + limit < content.length ? "\n[...]" : ""}`;
}

type AssistantRevisionSource = {
  path: string;
  title: string;
  content: string;
};

async function listRevisionSourceFiles(root: string, limit = 600) {
  const files: string[] = [];
  async function visit(directory: string) {
    if (files.length >= limit) return;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= limit) break;
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && /\.(?:txt|md)$/i.test(entry.name)) files.push(fullPath);
    }
  }
  await visit(root);
  return files;
}

async function relevantRevisionSources(question: string, limit = 8): Promise<AssistantRevisionSource[]> {
  const configured = process.env.REVISION_SOURCE_CORPUS_DIR?.trim();
  if (!configured) return [];
  const root = path.resolve(configured);
  if (root === path.parse(root).root) return [];
  const terms = assistantSearchTerms(question);
  if (!terms.length) return [];
  const files = await listRevisionSourceFiles(root);
  const ranked = await mapWithConcurrency(files, 12, async (fullPath) => {
    const content = await fs.readFile(fullPath, "utf8").catch(() => "");
    if (!content) return null;
    const relativePath = path.relative(root, fullPath).replaceAll(path.sep, "/");
    const title = path.basename(relativePath).replace(/\.(?:txt|md)$/i, "");
    const normalizedTitle = normalizedAssistantText(relativePath);
    const normalizedContent = normalizedAssistantText(content);
    const score = terms.reduce((sum, term) => sum
      + (normalizedTitle.includes(term) ? 10 : 0)
      + (normalizedContent.includes(term) ? 1 : 0), 0);
    return score > 0 ? {
      score,
      source: {
        path: `revision-source://${relativePath}`,
        title,
        content: assistantEvidenceExcerpt(content, question, 3200),
      } satisfies AssistantRevisionSource,
    } : null;
  });
  return ranked.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => b.score - a.score || a.source.path.localeCompare(b.source.path))
    .slice(0, limit)
    .map((entry) => entry.source);
}

export async function askAssistant(
  history: AssistantChatMessage[],
  question: string,
  options: AssistantChatOptions = {},
): Promise<AssistantChatReply> {
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) throw new Error("question vide");
  // The in-app assistant spends the operator's budget. Free tenants use their
  // own Claude through the MCP connector instead; paid tenants share a monthly
  // fair-use ceiling.
  if (!planAllowsAssistant()) {
    throw new Error("L'assistant intégré est réservé aux offres payantes. Utilisez le connecteur MCP avec votre propre Claude.");
  }
  const quota = assistantMonthlyQuota();
  if (Number.isFinite(quota) && (await usageCount("assistant")) >= quota) {
    throw new Error("Quota mensuel de l'assistant atteint pour votre offre.");
  }
  const safeHistory = history
    .filter((entry): entry is AssistantChatMessage =>
      Boolean(entry) && (entry.role === "user" || entry.role === "assistant") && typeof entry.content === "string")
    .slice(-12);
  const engine = options.engine === "claude" || options.engine === "codex" ? options.engine : undefined;
  const model = options.model && MODEL_ID_RE.test(options.model) ? options.model : "";
  const effort = options.effort && ["low", "medium", "high", "xhigh", "max"].includes(options.effort) ? options.effort : "";
  const config = await memoBridgeConfig();
  if (!config) throw new Error("bridge IA non configuré");
  const ai = await aiSetupPreferences(process.env.CHAT_MODEL);
  // An explicit engine choice must not silently fall back to the other
  // provider, even when setup has no verified engine list.
  const engineOrder = engine ? [engine] : ai.engineOrder;
  if (!engineOrder.length) throw new Error("aucun moteur IA connecté ou vérifié");
  const models = engine && model ? { ...ai.models, [engine]: model } : ai.models;
  const [data, setup] = await Promise.all([getDashboard(), readSetupState()]);
  const date = todayISO();
  const inputs = dailyAiInputs(data, date, activeModuleEvidence(data.allNotes, setup.modules));
  const systemContext = data.system.find((note) => note.relativePath.endsWith("Context.md"))?.content || "";
  if (!systemContext.trim()) throw new Error("contexte système vide");
  const moduleEvidencePathSet = new Set(moduleEvidencePaths(inputs.moduleEvidence));
  const retrievalQuestion = [
    ...safeHistory.filter((entry) => entry.role === "user").slice(-4).map((entry) => entry.content),
    trimmedQuestion,
  ].join("\n").slice(-12_000);
  const revisionSources = setup.modules.revisions
    ? await relevantRevisionSources(retrievalQuestion)
    : [];
  const trainingPlan = assistantEditRequested(trimmedQuestion) && assistantTrainingPlanRequested(trimmedQuestion)
    ? await fs.readFile(resolveVaultPath(TRAINING_PLAN_PATH), "utf8").then(JSON.parse).catch(() => undefined)
    : undefined;

  // Re-sliced and truncated relative to dailyAiInputs (which stays sized for
  // the brief's 400s budget): the chat gets a leaner bundle to fit its
  // shorter time budget.
  const evidence = {
    date,
    objectives: inputs.objectives.map(objectiveForAi),
    open_tasks: inputs.openTasks.map(taskForAi),
    completed_tasks: inputs.completedTasks.slice(0, 6).map(taskForAi),
    projects: inputs.projectNotes.slice(0, 10).map((note) => compactForChat(noteForAi(note))),
    wiki: inputs.wikiSignals.slice(0, 6).map((note) => compactForChat(noteForAi(note))),
    module_evidence: inputs.moduleEvidence,
    ...(trainingPlan ? { training_plan: trainingPlan } : {}),
    captures: inputs.captures.slice(0, 8).map((note) => compactForChat(noteForAi(note))),
    journal: formatNotesForContext(inputs.rawContext).slice(0, 6000),
    revision_sources: revisionSources,
    // Module notes belong in this search too: module_evidence only carries the
    // newest MODULE_EVIDENCE_NOTE_LIMIT of them, so a question about an older
    // training analysis could otherwise reach nothing. Notes already in
    // module_evidence are dropped here rather than sent twice.
    vault_notes: relevantAssistantNotes(
      data.allNotes.filter((note) => isLivingModuleNote(note) && !moduleEvidencePathSet.has(note.relativePath)),
      retrievalQuestion,
    ).map((note) => ({
      path: note.relativePath,
      title: note.title,
      content: assistantEvidenceExcerpt(note.content, retrievalQuestion),
    })),
  };

  const response = await fetch(`${config.url.replace(/\/+$/, "")}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({
      question: trimmedQuestion,
      history: safeHistory,
      system_context: systemContext,
      evidence,
      engine_order: engineOrder,
      models,
      allow_edits: assistantEditRequested(trimmedQuestion),
      ...(effort ? { effort } : {}),
    }),
    signal: AbortSignal.timeout(Number(process.env.AI_CHAT_TIMEOUT_MS || 330000)),
  });

  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(failure?.error || `bridge IA HTTP ${response.status}`);
  }
  const json = await response.json().catch(() => null) as AiChatResponse | null;
  if (!json?.ok || !json.reply) throw new Error("réponse IA vide ou invalide");
  if (assistantEditRequested(trimmedQuestion)) await applyAssistantEdits(json.edits);
  await recordUsage("assistant");
  return { reply: json.reply, engine: json.engine || "none" };
}

async function readSkillInstructions(relativePath: string) {
  try {
    const raw = await fs.readFile(resolveVaultPath(relativePath), "utf8");
    return parseMarkdown(raw).content.trim().slice(0, 12000);
  } catch {
    return "";
  }
}

export async function getDailyBriefBasePrompt() {
  return readSkillInstructions(DAILY_SKILL);
}

function normalizeEngineName(value: string) {
  const clean = value.trim().toLowerCase();
  if (clean === "chatgpt" || clean === "openai") return "codex";
  return clean === "claude" || clean === "codex" ? clean : "";
}

export async function aiSetupPreferences(legacyClaudeModel = "") {
  const state = await readSetupState();
  const verified = state.ai.verified;
  const stateOrder = [state.ai.primary, state.ai.fallback].filter(
    (provider): provider is AiProvider => Boolean(provider) && (!verified.length || verified.includes(provider as AiProvider)),
  );
  const envOrder = [
    normalizeEngineName(process.env.MEMO_ENGINE_PRIMARY || ""),
    normalizeEngineName(process.env.MEMO_ENGINE_FALLBACK || ""),
  ].filter((provider): provider is AiProvider => Boolean(provider));
  return {
    engineOrder: uniqueStrings(stateOrder.length ? stateOrder : verified.length ? [] : envOrder) as AiProvider[],
    models: {
      claude: state.ai.models.claude || setupModel(legacyClaudeModel),
      codex: state.ai.models.codex,
    } satisfies AiModelPreferences,
  };
}

async function memoBridgeConfig() {
  const envFile = process.env.MEMO_ENV_FILE || "";
  const fileUrl = await envFileValue(envFile, "MEMO_BRIDGE_URL");
  const fileToken = await envFileValue(envFile, "MEMO_TOKEN");
  const url = process.env.MEMO_BRIDGE_URL || process.env.AI_BRIEF_ENDPOINT || normalizeMemoBridgeUrl(fileUrl) || (fileToken ? "http://127.0.0.1:8089" : "");
  const token = process.env.MEMO_TOKEN || process.env.AI_BRIEF_TOKEN || fileToken;
  if (!url || !token) return null;
  return { url, token };
}

function normalizeMemoBridgeUrl(value: string) {
  if (!value) return "";
  return value.replace("host.docker.internal", "127.0.0.1");
}

async function envFileValue(filePath: string, key: string) {
  if (!filePath) return "";
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const line = raw.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") || "";
  } catch {
    return "";
  }
}

function formatNotesForContext(notes: VaultNote[]) {
  return notes
    .map((note) => `### ${note.title} (${note.relativePath})\n${note.content}`)
    .join("\n\n");
}

// A whole vault of this shape is ~90k tokens, so the old 1800-char slice was
// spending a context budget it did not need to save: a project note stating a
// price, a blocker or a recorded number lost it past the third paragraph and
// the brief then "missed" facts that were sitting in the bundle, truncated.
const AI_NOTE_CONTENT_LIMIT = 6000;

function noteForAi(note: VaultNote) {
  return {
    title: note.title,
    status: note.status,
    source: stringValue(note.data.source),
    url: stringValue(note.data.url),
    tags: note.tags,
    path: note.relativePath,
    date: stringValue(note.data.date),
    created: stringValue(note.data.created),
    updated: stringValue(note.data.updated),
    excerpt: note.excerpt,
    content: note.content.slice(0, AI_NOTE_CONTENT_LIMIT),
  };
}

function taskForAi(note: VaultNote) {
  return {
    title: note.title,
    status: note.status,
    area: stringValue(note.data.area),
    priority: stringValue(note.data.priority),
    objective: stringValue(note.data.objective),
    exec_kind: stringValue(note.data.exec_kind),
    // The excerpt is the first line or two; a task's real reason, its success
    // condition and its history live further down the body.
    why: note.content.slice(0, 2000) || note.excerpt,
    proposed_on: stringValue(note.data.proposed_on),
    done_on: stringValue(note.data.done_on),
    path: note.relativePath,
  };
}

function objectiveForAi(note: VaultNote) {
  return {
    name: note.title,
    status: note.status,
    area: stringValue(note.data.area),
    priority: stringValue(note.data.priority),
    horizon: stringValue(note.data.horizon),
    current_state: note.excerpt,
    // The prompt calls the objectives "the compass that drives the brief", yet
    // they used to be the only section sent as an excerpt: a salary floor, a
    // revised target or a dated decision recorded below the first paragraph
    // never reached the model.
    content: note.content.slice(0, AI_NOTE_CONTENT_LIMIT),
    path: note.relativePath,
  };
}

/**
 * Turn the AI's task list into pending proposals instead of writing them
 * straight into the vault. Creation used to be silent and irreversible, so it
 * had to drop anything with an invented objective or an unknown execution
 * class; a proposal the user reviews can surface those instead of losing them.
 * Only the duplicate guard still filters, because a repeat is never worth a
 * decision.
 */
export function proposeBriefTasks(
  tasks: BriefTask[],
  existingTasks: VaultNote[],
  activeObjectives: VaultNote[] = [],
): RawBriefSuggestion[] {
  const openTasks = existingTasks.filter((note) => !CLOSED_TASK_STATUSES.has(note.status));
  const seen: string[] = [];
  const proposals: RawBriefSuggestion[] = [];
  for (const task of tasks.slice(0, 5)) {
    const title = task.title?.trim();
    if (!title || !normalizeKey(title)) continue;
    if (openTasks.some((note) => isLikelyDuplicateTask(title, note.title))) continue;
    if (seen.some((candidate) => isLikelyDuplicateTask(title, candidate))) continue;
    seen.push(title);
    proposals.push({
      kind: "create_task",
      title,
      why: task.why || "",
      task: {
        title,
        area: task.area || "Knowledge",
        // An objective the model invented is not an objective: keep only a name
        // that matches an active one, and let the user fill the gap on accept.
        objective: activeObjectives.find((note) => note.title === task.objective?.trim())?.title || "",
        exec_kind: normalizeExecKind(task.exec_kind),
        why: task.why || "",
      },
    });
  }
  return proposals;
}

async function applyBriefSuggestion(suggestion: BriefSuggestion): Promise<string> {
  if (suggestion.kind === "create_task") {
    const task = suggestion.task;
    if (!task?.title) throw new Error("Proposition de tâche incomplète");
    const note = await createTask({
      title: task.title,
      area: task.area || "Projects",
      priority: "medium",
      why: task.why || "",
      source: "ai-brief",
      objective: task.objective || "",
      execKind: task.execKind,
    });
    return note.relativePath;
  }

  if (suggestion.kind === "capture_note") {
    if (!suggestion.note?.body) throw new Error("Note proposée vide");
    const note = await writeNote("raw", {
      title: suggestion.note.title,
      data: { status: "draft", source: "ai-brief", tags: ["ai-brief"] },
      body: `# ${suggestion.note.title}\n\n${suggestion.note.body}\n`,
    });
    return note.relativePath;
  }

  const target = await readNote(suggestion.target || "");
  if (!target) throw new Error("Tâche introuvable");
  if (suggestion.kind === "archive_task") {
    await updateTaskStatus(target.relativePath, "archived");
    return target.relativePath;
  }

  if (suggestion.kind === "execute_task") {
    // The execution class is read from the task itself, never taken from the
    // suggestion: otherwise labelling a `manual` task `vault` would be enough
    // to get an automation to act on the user's behalf (failure mode 14).
    const execKind = normalizeExecKind(stringValue(target.data.exec_kind));
    if (execKind !== "vault" && execKind !== "verify" && execKind !== "prepare") {
      throw new Error(`Exécution refusée : cette tâche est « ${execKind || "non classée"} », seules « vault », « verify » et « prepare » sont exécutables`);
    }
    const edits = suggestion.edits || [];
    // Only `vault` may rewrite other notes. `verify` is the read-only class by
    // definition, and `prepare` means draft everything and send nothing — its
    // draft belongs in the task itself, so a write elsewhere under either label
    // is a misclassification, not a permission.
    if (execKind !== "vault" && edits.length) {
      throw new Error(`Exécution refusée : une tâche « ${execKind} » ne peut rien écrire hors de la tâche elle-même`);
    }
    for (const edit of edits) {
      const note = await readNote(edit.path);
      // Only rewrite notes that already exist: creating one from here would
      // bypass writeNote's slug and frontmatter conventions.
      if (!note) throw new Error(`Note introuvable : ${edit.path}`);
      await updateNote({
        relativePath: note.relativePath,
        title: note.title,
        content: edit.content,
        expectedMtime: note.mtime,
      });
    }
    // The outcome is recorded on the task, but the status is left alone: only
    // the user knows whether this closes the task, and a verification that
    // found a problem must not read as completed.
    const stamp = todayISO();
    await updateNote({
      relativePath: target.relativePath,
      title: target.title,
      content: `${target.content.trimEnd()}\n\n## Exécution IA (${stamp})\n\n${suggestion.outcome || ""}\n${
        edits.length ? `\nNotes modifiées : ${edits.map((edit) => edit.path).join(", ")}\n` : ""}`,
      expectedMtime: target.mtime,
    });
    return target.relativePath;
  }

  await updateNote({
    relativePath: target.relativePath,
    title: target.title,
    status: suggestion.patch?.status || target.status,
    priority: suggestion.patch?.priority,
    area: suggestion.patch?.area,
    objective: suggestion.patch?.objective,
    content: target.content,
    expectedMtime: target.mtime,
  });
  return target.relativePath;
}

export async function decideBriefSuggestion(
  briefPath: string,
  id: string,
  decision: "accepted" | "rejected",
): Promise<BriefSuggestion[]> {
  const suggestions = await readBriefSuggestions(briefPath);
  const suggestion = suggestions.find((entry) => entry.id === id);
  if (!suggestion) throw new Error("Proposition introuvable");
  // Deciding twice must not apply twice: a double-click or a replayed request
  // would otherwise create the same task again.
  if (suggestion.state !== "pending") return suggestions;

  if (decision === "rejected") {
    suggestion.state = "rejected";
    suggestion.decidedAt = new Date().toISOString();
    return writeBriefSuggestions(briefPath, suggestions);
  }

  try {
    suggestion.resultPath = await applyBriefSuggestion(suggestion);
    suggestion.state = "accepted";
    suggestion.decidedAt = new Date().toISOString();
    delete suggestion.error;
  } catch (error) {
    // A failed apply leaves the proposal pending so the user can retry once the
    // cause is fixed, rather than silently swallowing it as decided.
    suggestion.error = error instanceof Error ? error.message : "application impossible";
  }
  return writeBriefSuggestions(briefPath, suggestions);
}

export function extractBriefTasks(markdown: string): BriefTask[] {
  const tasks: BriefTask[] = [];
  let inSection = false;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#")) {
      inSection = /today'?s tasks|t[aâ]ches du jour/i.test(line);
      continue;
    }
    if (!inSection) continue;
    // Two accepted shapes, because the daily skill now mandates numbered prose
    // ("1. Sentence.") while older briefs used dash bullets with an area chip
    // ("- **[Area]** title — why"). Numbered items may keep the area chip.
    const match = line.match(/^(?:-|\d+[.)])\s+(?:\*\*\[([^\]]+)\]\*\*\s+)?(.+)$/);
    if (!match) continue;
    const [, area] = match;
    let rest = match[2];
    let objective = "";
    let execKind = "";
    const metadataMatch = rest.match(/\s*<!--\s*task-meta\s+(\{.*\})\s*-->\s*$/);
    if (metadataMatch) {
      try {
        const metadata = JSON.parse(metadataMatch[1]) as { objective?: unknown; exec_kind?: unknown };
        objective = typeof metadata.objective === "string" ? metadata.objective.trim() : "";
        execKind = typeof metadata.exec_kind === "string" ? normalizeExecKind(metadata.exec_kind) : "";
      } catch {
        // Legacy and manually edited briefs remain readable without metadata.
      }
      rest = rest.slice(0, metadataMatch.index).trim();
    }
    const reasonMatch = rest.match(/^(.*?)\.\s+(?:Pourquoi|Why)\s*:\s*(.+)$/i);
    let [title, why = ""] = reasonMatch
      ? [reasonMatch[1], reasonMatch[2]]
      : rest.split(/\s+[—-]\s+/, 2);
    if (!why) {
      // Numbered prose has no dash separator: use the first clause as the
      // title and keep the rest of the sentence as the rationale.
      const clause = rest.match(/^(.{10,120}?[.,;])\s+(.*)$/);
      if (clause) [, title, why] = clause;
    }
    title = title.trim().replace(/[.,;]$/, "");
    if (!title) continue;
    tasks.push({
      area: area?.trim() || "",
      title,
      why: why.trim().replace(/\.$/, ""),
      objective,
      exec_kind: execKind,
    });
  }
  return tasks;
}

function isOpenTask(note: VaultNote) {
  return OPEN_TASK_STATUSES.has(note.status);
}

function isDoneTask(note: VaultNote) {
  return DONE_TASK_STATUSES.has(note.status);
}

function isActiveObjective(note: VaultNote) {
  return note.status === "active";
}

function isInboxCapture(note: VaultNote) {
  return note.status === "inbox";
}

function isBriefReadyCapture(note: VaultNote) {
  return BRIEF_READY_CAPTURE_STATUSES.has(note.status);
}

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isLikelyDuplicateTask(left: string, right: string) {
  const leftKey = normalizeKey(left);
  const rightKey = normalizeKey(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  if (Math.min(leftKey.length, rightKey.length) >= 20
    && (leftKey.includes(rightKey) || rightKey.includes(leftKey))) return true;

  const leftTokens = keywords(left);
  const rightTokens = keywords(right);
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const smaller = Math.min(leftTokens.size, rightTokens.size);
  const jaccard = union ? shared / union : 0;
  const overlap = smaller ? shared / smaller : 0;
  if (shared >= 3 && (jaccard >= 0.58 || overlap >= 0.78)) return true;

  const leftTrigrams = trigrams(leftKey);
  const rightTrigrams = trigrams(rightKey);
  const commonTrigrams = [...leftTrigrams].filter((item) => rightTrigrams.has(item)).length;
  const dice = leftTrigrams.size + rightTrigrams.size
    ? (2 * commonTrigrams) / (leftTrigrams.size + rightTrigrams.size)
    : 0;
  return dice >= 0.8;
}

function trigrams(value: string) {
  const result = new Set<string>();
  for (let index = 0; index <= value.length - 3; index += 1) {
    result.add(value.slice(index, index + 3));
  }
  return result;
}

function sourcePaths(notes: Array<VaultNote | undefined>) {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const note of notes) {
    if (!note || seen.has(note.relativePath)) continue;
    seen.add(note.relativePath);
    paths.push(note.relativePath);
  }
  return paths;
}

function firstParagraph(content: string) {
  return content
    .replace(/^#\s+.+$/m, "")
    .replace(/^\[[^\]]*\]\([^)]*\)\s*$/m, "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .find(Boolean) || "";
}

function captureSections(content: string) {
  const sections = new Map<string, string>();
  let current = "";
  let buffer: string[] = [];
  const flush = () => {
    if (current) sections.set(current.toLowerCase(), buffer.join("\n").trim());
    buffer = [];
  };
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^#{2,}\s+(.+?)\s*$/);
    if (heading) {
      flush();
      current = heading[1].trim();
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  return sections;
}

function captureSourceUrl(capture: VaultNote) {
  const fromData = stringValue(capture.data.url).trim();
  if (fromData) return fromData;
  const match = capture.content.match(/\((https?:\/\/[^)\s]+)\)/);
  return match?.[1] || "";
}

function buildWikiBody(capture: VaultNote, objectives: VaultNote[], related: VaultNote[] = []) {
  const sections = captureSections(capture.content);
  const summary = sections.get("summary") || firstParagraph(capture.content) || capture.excerpt || "Digest this capture manually.";
  const insight = sections.get("insight") || "";
  const nextAction = sections.get("next action") || sections.get("next actions") || "";
  const sourceUrl = captureSourceUrl(capture);
  const body = [`# ${capture.title}`, "", "## Summary", summary];
  if (insight) body.push("", "## Insight", insight);
  if (nextAction) body.push("", "## Next action", nextAction);
  if (objectives.length) {
    body.push("", "## Relevant objectives", ...objectives.map((objective) => `- [[${objective.title}]]`));
  }
  if (related.length) {
    body.push("", "## Related", ...related.map((note) => `- [[${note.title}]]`));
  }
  body.push("", "## Source", sourceUrl ? `- [${sourceUrl}](${sourceUrl})` : `- [[${capture.relativePath}|${capture.title}]]`);
  return body.join("\n");
}

// Deterministic auto-linking: pick existing notes related to the capture by
// keyword overlap, plus any candidate whose exact title appears in the capture
// text. No AI, no network. Returns real candidate titles only.
function relatedNotes(capture: VaultNote, candidates: VaultNote[], limit = 5) {
  const ownKey = normalizeKey(capture.title);
  const captureText = `${capture.title} ${capture.content} ${capture.tags.join(" ")}`.toLowerCase();
  const seenTitles = new Set<string>();
  const scored: Array<{ note: VaultNote; score: number }> = [];

  for (const candidate of candidates) {
    const title = candidate.title.trim();
    if (title.length < 3) continue;
    const titleKey = normalizeKey(title);
    if (!titleKey || titleKey === ownKey) continue; // no self-link, skip duplicate titles
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);

    let score = sharedKeywords(capture, candidate).length;
    if (captureText.includes(title.toLowerCase())) score += 5;
    if (score <= 0) continue;
    scored.push({ note: candidate, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title))
    .slice(0, limit)
    .map((item) => item.note);
}

function buildAiWikiBody(
  title: string,
  capture: VaultNote,
  result: AiProcessResponse,
  objectives: VaultNote[],
) {
  const sourceUrl = captureSourceUrl(capture);
  const body = [`# ${title}`, "", "## Summary", result.summary?.trim() || capture.excerpt];
  if (result.insight?.trim()) body.push("", "## Insight", result.insight.trim());
  if (result.open_question?.trim()) body.push("", "## Open question", result.open_question.trim());
  if (result.next_action?.trim()) body.push("", "## Next action", result.next_action.trim());
  if (objectives.length) {
    body.push("", "## Relevant objectives", ...objectives.map((objective) => `- [[${objective.title}]]`));
  }
  body.push(
    "",
    "## Provenance",
    `- Capture: [[${capture.relativePath}|${capture.title}]]`,
    `- Path: ${capture.relativePath}`,
  );
  if (sourceUrl) body.push(`- External source: [${sourceUrl}](${sourceUrl})`);
  return body.join("\n");
}

const LIBRARY_MIN_SCORE = 4;
const LIBRARY_MIN_SUMMARY_LENGTH = 180;
const LIBRARY_MIN_INSIGHT_LENGTH = 60;

function normalizedLibraryScore(value: unknown) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(5, Math.round(score)));
}

function passesLibraryAdmission(result: AiProcessResponse) {
  return normalizedLibraryScore(result.library_score) >= LIBRARY_MIN_SCORE
    && (result.summary?.trim().length || 0) >= LIBRARY_MIN_SUMMARY_LENGTH
    && (result.insight?.trim().length || 0) >= LIBRARY_MIN_INSIGHT_LENGTH;
}

const CAPTURE_TASK_AREAS = new Set(["Work", "Projects", "Finance", "Health", "Learning", "Personal", "Knowledge"]);

function normalizeCaptureArea(value?: string) {
  const area = value?.trim() || "";
  return CAPTURE_TASK_AREAS.has(area) ? area : "Personal";
}

function normalizeCapturePriority(value?: string) {
  const priority = value?.trim().toLowerCase() || "";
  return ["high", "medium", "low"].includes(priority) ? priority : "medium";
}

function buildAiRoutedBody(
  title: string,
  capture: VaultNote,
  result: AiProcessResponse,
  objectives: VaultNote[],
) {
  const sourceUrl = captureSourceUrl(capture);
  const body = [`# ${title}`, "", "## Synthèse", result.summary?.trim() || capture.excerpt];
  if (result.insight?.trim()) body.push("", "## Ce que cela implique", result.insight.trim());
  if (result.open_question?.trim()) body.push("", "## Question ouverte", result.open_question.trim());
  if (result.next_action?.trim()) body.push("", "## Prochaine action possible", result.next_action.trim());
  if (objectives.length) {
    body.push("", "## Objectifs liés", ...objectives.map((objective) => `- [[${objective.title}]]`));
  }
  body.push("", "## Provenance", `- Capture : [[${capture.relativePath}|${capture.title}]]`);
  if (sourceUrl) body.push(`- Source externe : [${sourceUrl}](${sourceUrl})`);
  return body.join("\n");
}

export async function reprocessWikiNotes() {
  await ensureVault();
  const dashboard = await getDashboard();
  const rebuilt: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  for (const wiki of dashboard.wiki) {
    const generatedBy = stringValue(wiki.data.generated_by);
    // AI-authored text cannot be faithfully regenerated by the deterministic
    // fallback. Skipping it protects both its contents and its provenance.
    if (generatedBy.startsWith("ai:") || generatedBy === "ai") {
      skipped.push({ path: wiki.relativePath, reason: `AI provenance (${generatedBy})` });
      continue;
    }
    const sourcePath = stringValue(wiki.data.source_note).trim();
    if (!sourcePath) {
      skipped.push({ path: wiki.relativePath, reason: "no source_note" });
      continue;
    }
    const capture = await readNote(sourcePath);
    if (!capture) {
      skipped.push({ path: wiki.relativePath, reason: `missing source ${sourcePath}` });
      continue;
    }
    const matchedObjectives = dashboard.objectives
      .filter((objective) => sharedKeywords(capture, objective).length > 0)
      .slice(0, 3);
    const wikiCandidates = dashboard.wiki.filter(
      (note) => note.status !== "archived" && note.relativePath !== wiki.relativePath,
    );
    const related = relatedNotes(capture, wikiCandidates);
    const data = {
      ...wiki.data,
      generated_by: generatedBy || "local-reprocess",
      ai_pending: generatedBy === "local-fallback" || wiki.data.ai_pending === true,
      reprocessed_by: "local-deterministic",
      reprocessed_at: new Date().toISOString(),
      updated: new Date().toISOString(),
    };
    await writeRawNote(
      wiki.relativePath,
      data,
      buildWikiBody(capture, matchedObjectives, related),
      { expectedMtime: wiki.mtime },
    );
    rebuilt.push(wiki.relativePath);
  }

  return { rebuilt, skipped };
}

function sharedKeywords(a: VaultNote, b: VaultNote) {
  const left = keywords([a.title, a.excerpt, a.tags.join(" ")].join(" "));
  const right = keywords([b.title, b.excerpt, b.tags.join(" "), JSON.stringify(b.data)].join(" "));
  return [...left].filter((item) => right.has(item));
}

function keywords(value: string) {
  const stop = new Set([
    "avec",
    "dans",
    "pour",
    "that",
    "this",
    "from",
    "into",
    "mon",
    "mes",
    "tes",
    "des",
    "les",
    "une",
    "the",
    "and",
    "mais",
    "plus",
  ]);
  return new Set(
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3 && !stop.has(word)),
  );
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/**
 * Round-trip metadata attached (non-enumerably) to the `data` object returned by
 * `parseMarkdown`. It lets `stringifyMarkdown` re-emit frontmatter that the
 * limited parser does not fully understand — nested blocks, plugin metadata
 * (Dataview, Templater, Linter `position:`), unusual quoting — VERBATIM, so a
 * parse→stringify cycle over an untouched note is byte-identical and only keys
 * the caller actually changed get reformatted.
 */
const RAW_FRONTMATTER = Symbol("rawFrontmatter");

type RawFrontmatter = {
  /** Ordered top-level keys as they appeared in the source. */
  order: string[];
  /** Verbatim source lines (block, including children) for each top-level key. */
  blocks: Map<string, string[]>;
  /**
   * Parsed value for keys the parser fully understood and can safely round-trip
   * from structure. Keys absent here were preserved verbatim only (their raw
   * value is opaque to us) and must never be re-serialized from `data`.
   */
  parsed: Map<string, unknown>;
};

function getRawFrontmatter(data: Record<string, unknown>): RawFrontmatter | undefined {
  return (data as { [RAW_FRONTMATTER]?: RawFrontmatter })[RAW_FRONTMATTER];
}

export function parseMarkdown(raw: string): { data: Record<string, unknown>; content: string } {
  if (!raw.startsWith("---\n")) {
    return { data: {}, content: raw };
  }
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { data: {}, content: raw };

  const frontmatter = raw.slice(4, end);
  const contentStart = raw.indexOf("\n", end + 4);
  const content = contentStart === -1 ? "" : raw.slice(contentStart + 1);
  const data: Record<string, unknown> = {};

  const rawLines = frontmatter.split(/\r?\n/);
  const order: string[] = [];
  const blocks = new Map<string, string[]>();
  const parsed = new Map<string, unknown>();

  // First pass: split the frontmatter into top-level key blocks, keeping every
  // source line (including indented children) attached to its owning key. A line
  // starts a new top-level block when it is a non-indented `key:` line.
  let currentKey = "";
  for (const line of rawLines) {
    const topLevel = line.match(/^([^\s:#][^:]*):(?:\s.*|)$/);
    const isIndentedOrList = /^\s/.test(line) || /^\s*-\s/.test(line);
    if (topLevel && !isIndentedOrList) {
      currentKey = topLevel[1];
      if (!blocks.has(currentKey)) {
        order.push(currentKey);
        blocks.set(currentKey, []);
      }
      blocks.get(currentKey)!.push(line);
    } else if (currentKey && (line.trim() === "" || /^\s/.test(line))) {
      // Indented child (nested map, block list, folded/literal scalar) or a
      // blank line inside the current block: keep it with the current key.
      blocks.get(currentKey)!.push(line);
    } else if (currentKey) {
      blocks.get(currentKey)!.push(line);
    }
    // Lines before any key (e.g. comments) are dropped, matching prior behaviour.
  }

  // Second pass: interpret each block. Only "simple" blocks (a flat scalar, or a
  // key with a block/inline array of scalars) are lifted into `data` and marked
  // as safely round-trippable. Anything else (nested maps, indented children the
  // parser does not model) is preserved verbatim and left out of `parsed`, so
  // stringify re-emits its original lines untouched.
  for (const key of order) {
    const lines = blocks.get(key)!;
    const interpreted = interpretBlock(key, lines);
    if (interpreted.understood) {
      data[key] = interpreted.value;
      parsed.set(key, interpreted.value);
    } else {
      // Preserve the value so consumers still see the key, but do NOT put it in
      // `parsed`: stringify will keep the verbatim block instead of reformatting.
      data[key] = interpreted.value;
    }
  }

  Object.defineProperty(data, RAW_FRONTMATTER, {
    value: { order, blocks, parsed } satisfies RawFrontmatter,
    enumerable: false,
    writable: true,
    configurable: true,
  });

  return { data, content };
}

/**
 * Decide whether a top-level frontmatter block is one the limited parser fully
 * understands (and can therefore reformat losslessly). "Understood" blocks:
 *   - `key: scalar`            → scalar value
 *   - `key:` + indented `- x`  → array of scalars
 *   - `key: [a, b]`            → inline array of scalars
 *   - `key:` with no children  → empty (treated as empty array, legacy behaviour)
 * Blocks with a nested mapping (indented `child: value`) or any structure we do
 * not model are NOT understood: their value is exposed best-effort but the raw
 * lines are kept for verbatim re-emission.
 */
function interpretBlock(key: string, lines: string[]): { understood: boolean; value: unknown } {
  const first = lines[0] ?? `${key}:`;
  const sep = first.indexOf(":");
  const inlineValue = sep === -1 ? "" : first.slice(sep + 1).trim();
  const children = lines.slice(1);
  const nonBlankChildren = children.filter((line) => line.trim() !== "");

  if (inlineValue) {
    // A scalar or inline array on the same line, with no children.
    if (nonBlankChildren.length === 0) {
      return { understood: true, value: parseYamlScalar(inlineValue) };
    }
    // Inline value followed by indented children is unusual/nested: preserve.
    return { understood: false, value: parseYamlScalar(inlineValue) };
  }

  // No inline value: either an empty key, a block array, or a nested mapping.
  if (nonBlankChildren.length === 0) {
    // Legacy behaviour: a bare `key:` becomes an empty array.
    return { understood: true, value: [] };
  }

  // A block array: every non-blank child is an indented list item `- item`.
  if (nonBlankChildren.every((line) => /^\s+-\s+/.test(line) || /^\s+-$/.test(line.trimEnd() + " -"))) {
    if (nonBlankChildren.every((line) => /^\s+-(\s+.*|)$/.test(line))) {
      const value = nonBlankChildren
        .map((line) => parseYamlScalar(line.replace(/^\s+-\s*/, "")))
        .filter((item) => item !== "");
      return { understood: true, value };
    }
  }

  // A nested mapping or anything else the parser does not model: keep verbatim.
  // Expose a shallow best-effort object so `data[key]` is at least truthy, but
  // mark it not-understood so stringify preserves the original lines.
  const nested: Record<string, unknown> = {};
  for (const line of nonBlankChildren) {
    const m = line.match(/^\s+([^:\s][^:]*):(?:\s+(.*)|)$/);
    if (m) nested[m[1].trim()] = m[2] !== undefined ? parseYamlScalar(m[2]) : "";
  }
  return { understood: false, value: Object.keys(nested).length ? nested : inlineValue };
}

export function stringifyMarkdown(data: Record<string, unknown>, content: string) {
  const rawMeta = getRawFrontmatter(data);
  const lines = ["---"];
  const emitted = new Set<string>();

  const emitFresh = (key: string, value: unknown) => {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${formatYamlScalar(item)}`);
    } else {
      lines.push(`${key}: ${formatYamlScalar(value)}`);
    }
  };

  const emitKey = (key: string) => {
    if (emitted.has(key) || !(key in data)) return;
    emitted.add(key);
    const value = data[key];
    if (rawMeta) {
      const wasUnderstood = rawMeta.parsed.has(key);
      // Verbatim re-emission when the value is untouched: either the parser did
      // not fully understand the block (always preserve), or it did and the
      // current value still deep-equals what we parsed (nothing changed).
      if (!wasUnderstood || deepEqual(rawMeta.parsed.get(key), value)) {
        const block = rawMeta.blocks.get(key);
        if (block) {
          for (const line of block) lines.push(line);
          return;
        }
      }
    }
    emitFresh(key, value);
  };

  // Preserve original key order first, then append any newly added keys.
  if (rawMeta) {
    for (const key of rawMeta.order) emitKey(key);
  }
  for (const key of Object.keys(data)) emitKey(key);

  lines.push("---", content);
  return lines.join("\n");
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    return ak.length === bk.length
      && ak.every((key) => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  return false;
}

function parseYamlScalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  // Integers/decimals are numbers, EXCEPT leading-zero forms (e.g. "0123",
  // "007") which are identifiers (ISIN, tickers, codes) and must stay strings to
  // avoid corrupting them. A lone "0" and "0.5" are still numbers.
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    if (/^-?0\d+$/.test(trimmed)) return trimmed;
    return Number(trimmed);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => parseYamlScalar(item))
      .filter((item) => item !== "");
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function formatYamlScalar(value: unknown) {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[A-Za-z0-9_./:@-]+$/.test(text) && !["true", "false", "null"].includes(text.toLowerCase())) {
    return text;
  }
  return JSON.stringify(text);
}
