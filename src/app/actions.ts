"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { LOCALE_COOKIE } from "@/lib/i18n";
import {
  createCapture,
  createFinancePosition,
  updateFinancePosition,
  createObjective,
  createRawNote,
  createTask,
  createWikiNote,
  editHref,
  noteHref,
  generateDailyBrief,
  generateWeeklyReview,
  processInbox,
  updateCaptureStatus,
  updateNote,
  updateTaskStatus,
  addFeed,
  removeFeed,
  setFeedsEnabled,
  ingestFeeds,
  setNotePinned,
  refreshFinancePositionPrice,
  refreshAllFinancePositionPrices,
  reorderFinancePositions,
  connectFinancePosition,
  deleteFinancePosition,
  createBusinessProspect,
  updateBusinessProspectStage,
  createBusinessInvoice,
  updateBusinessInvoiceStatus,
  deleteBusinessRecord,
  saveBusinessSettings,
  createCustomPage,
  archiveCustomPage,
  createCustomPageEntry,
  setCustomPageDaily,
  setCustomPageIcon,
  writeMonthlyBudget,
  type BudgetLineItem,
  type BudgetSubscriptionRecord,
  SETUP_STEPS,
  finalizeSetup,
  readSetupState,
  saveSetupState,
  setAiProviderVerified,
  setupPath,
  type SetupGoal,
  type SetupState,
  type SetupStep,
  askAssistant,
  configureRevisionProgram,
} from "@/lib/vault";
import {
  saveAssistantChat,
  readAssistantChat,
  deleteAssistantChat,
  type AssistantChatSummary,
  type StoredAssistantChat,
} from "@/lib/assistant-chats";
import {
  AiEngineError,
  savePlanOverride,
  removePlanOverride,
  archiveTrainingPlan,
  clearPlanOverrides,
  fallbackTrainingPlan,
  generateAiTrainingPlan,
  generateTrailCoachDecision,
  saveTrainingPlan,
  type PlanObjective,
} from "@/lib/trail";
import { todayISO } from "@/lib/dates";
import { trainingLevelSummary, trainingPlanStartISO, type TrainingExperience } from "@/lib/endurance-events";
import { saveAiCredential, type AiProvider } from "@/lib/ai-credentials";
import { beginDailyBriefJob, finishDailyBriefJob, readDailyBriefJob } from "@/lib/daily-brief-job";

function text(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

function aiProvider(value: string): AiProvider | null {
  return value === "claude" || value === "codex" ? value : null;
}

export async function saveAiCredentialAction(providerValue: string, apiKey: string) {
  const provider = aiProvider(providerValue);
  if (!provider) return { ok: false as const, error: "invalid" as const };
  try {
    await saveAiCredential(provider, apiKey);
    await setAiProviderVerified(provider, false);
    revalidatePath("/setup");
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "invalid" as const };
  }
}

// Reasons the UI can turn into actionable copy. "bridge" covers both an
// unreachable bridge and a CLI it can't run; the bridge's own "unreachable"
// collapses into it here so the app only has to branch on four cases.
export type VerifyFailureReason = "bridge" | "quota" | "auth" | "unknown";

function mapVerifyReason(value: unknown): VerifyFailureReason {
  if (value === "quota" || value === "auth") return value;
  if (value === "unreachable") return "bridge";
  return "unknown";
}

export async function verifyAiConnectionAction(providerValue: string) {
  const provider = aiProvider(providerValue);
  const url = process.env.MEMO_BRIDGE_URL?.trim().replace(/\/+$/, "");
  const token = process.env.MEMO_TOKEN?.trim();
  if (!provider) return { ok: false as const, error: "bridge" as const, reason: "bridge" as VerifyFailureReason, stillVerified: false };
  const state = await readSetupState();
  const wasVerified = state.ai.verified.includes(provider);
  if (!url || !token) {
    // A failed check must never downgrade a connection that was already
    // verified: only clear it when it genuinely was never connected.
    if (!wasVerified) await setAiProviderVerified(provider, false).catch(() => undefined);
    return { ok: false as const, error: "bridge" as const, reason: "bridge" as VerifyFailureReason, stillVerified: wasVerified };
  }
  try {
    const response = await fetch(`${url}/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ engine: provider, model: state.ai.models[provider] }),
      cache: "no-store",
      signal: AbortSignal.timeout(50_000),
    });
    const result = await response.json().catch(() => null) as { ok?: boolean; reason?: string } | null;
    if (result?.ok !== true) {
      const reason = mapVerifyReason(result?.reason);
      if (!wasVerified) await setAiProviderVerified(provider, false);
      revalidatePath("/setup");
      return { ok: false as const, error: "authentication" as const, reason, stillVerified: wasVerified };
    }
    await setAiProviderVerified(provider, true);
    revalidatePath("/setup");
    return { ok: true as const };
  } catch {
    if (!wasVerified) await setAiProviderVerified(provider, false).catch(() => undefined);
    revalidatePath("/setup");
    return { ok: false as const, error: "bridge" as const, reason: "bridge" as VerifyFailureReason, stillVerified: wasVerified };
  }
}

export async function saveAssistantSettingsAction(formData: FormData) {
  const state = await readSetupState();
  const primary = engine(text(formData, "aiPrimary"), "");
  const fallback = engine(text(formData, "aiFallback"), "");
  const claudeModel = text(formData, "aiClaudeModel");
  const codexModel = text(formData, "aiCodexModel");
  const briefFrequency = text(formData, "briefFrequency");
  const briefTime = text(formData, "briefTime");
  const briefTime2 = text(formData, "briefTime2");
  const dailyBriefEngine = text(formData, "dailyBriefEngine");
  const dailyBriefPrompt = text(formData, "dailyBriefPrompt");
  const briefDetail = (["concise", "balanced", "detailed"] as const)[Number(text(formData, "briefDetail"))];
  const separator = dailyBriefEngine.indexOf(":");
  const dailyBriefProvider = dailyBriefEngine === "inherit" ? "" : aiProvider(dailyBriefEngine.slice(0, separator));
  const dailyBriefModel = dailyBriefProvider ? dailyBriefEngine.slice(separator + 1) : "";
  if (![claudeModel, codexModel].every((model) => model.length <= 160 && /^[a-zA-Z0-9._:/@-]*$/.test(model))) return;
  if (dailyBriefEngine !== "inherit" && (!dailyBriefProvider || !dailyBriefModel || dailyBriefModel.length > 160 || !/^[a-zA-Z0-9._:/@-]+$/.test(dailyBriefModel))) return;
  if (dailyBriefPrompt.length > 12000) return;
  if (!["manual", "daily", "twice_daily", "weekly", "monthly"].includes(briefFrequency)) return;
  if (![briefTime, briefTime2].every((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value))) return;
  if (!briefDetail) return;
  await saveSetupState({
    ...state,
    ai: { ...state.ai, primary, fallback: fallback === primary ? "" : fallback, models: { claude: claudeModel, codex: codexModel } },
    automation: {
      ...state.automation,
      briefFrequency: briefFrequency as SetupState["automation"]["briefFrequency"],
      briefTime,
      briefTime2,
      briefDetail,
      dailyBriefProvider: dailyBriefProvider || "",
      dailyBriefModel,
      dailyBriefPrompt,
    },
  });
  revalidatePath("/settings");
  revalidatePath("/assistant");
  redirect("/settings#assistant");
}

export async function saveModuleSettingsAction(formData: FormData) {
  const state = await readSetupState();
  await saveSetupState({
    ...state,
    modules: {
      ...state.modules,
      finance: checkbox(formData, "finance"),
      budget: checkbox(formData, "budget"),
      trail: checkbox(formData, "trail"),
      trailSync: checkbox(formData, "trailSync"),
      business: checkbox(formData, "business"),
      revisions: checkbox(formData, "revisions"),
    },
  });
  revalidateApp();
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true as const };
}

// Persists the theme/locale UI preference into the vault-backed setup state
// so it survives Safari ITP wiping localStorage and capping client-set
// cookies. Called fire-and-forget from ThemePicker/LanguageProvider, which
// already apply the choice client-side for instant feedback.
export async function saveUiPreferenceAction(next: { theme?: string; locale?: string }) {
  const state = await readSetupState();
  const theme = next.theme === "light" || next.theme === "dark" ? next.theme : state.theme;
  const locale = next.locale === "en" || next.locale === "fr" ? next.locale : state.locale;
  if (theme === state.theme && locale === state.locale) return;
  await saveSetupState({ ...state, theme, locale });
  if (next.locale === "en" || next.locale === "fr") {
    (await cookies()).set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: 31_536_000,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
}

function csv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function lines(value: string) {
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

type SetupObjective = { title: string; area?: string; nextStep?: string };

function starterPackItems(formData: FormData) {
  const objectives = new Map<string, SetupObjective>();
  const feeds = new Set<string>();
  for (const value of formData.getAll("starterPacks")) {
    try {
      const parsed = JSON.parse(String(value)) as { objectives?: unknown; feeds?: unknown };
      if (Array.isArray(parsed.objectives)) {
        for (const item of parsed.objectives) {
          const title = typeof item === "string" ? item : typeof item === "object" && item ? String((item as { title?: unknown }).title || "") : "";
          if (!title.trim()) continue;
          objectives.set(title.trim().toLowerCase(), {
            title: title.trim(),
            area: typeof item === "object" && item ? String((item as { area?: unknown }).area || "") : "",
            nextStep: typeof item === "object" && item ? String((item as { nextStep?: unknown }).nextStep || "") : "",
          });
        }
      }
      if (Array.isArray(parsed.feeds)) {
        for (const feed of parsed.feeds) {
          if (typeof feed === "string" && feed.trim()) feeds.add(feed.trim());
        }
      }
    } catch {
      // A malformed local setup pack should not block saving the rest of setup.
    }
  }
  return { objectives: [...objectives.values()], feeds: [...feeds] };
}

function engine(value: string, fallback: "claude" | "codex" | ""): "claude" | "codex" | "" {
  const clean = value.toLowerCase();
  if (clean === "chatgpt" || clean === "openai") return "codex";
  return clean === "claude" || clean === "codex" ? clean : fallback;
}

function revalidateApp() {
  revalidatePath("/");
  revalidatePath("/inbox");
  revalidatePath("/tasks");
  revalidatePath("/objectives");
  revalidatePath("/daily");
  revalidatePath("/weekly");
  revalidatePath("/notes");
  revalidatePath("/wiki");
  revalidatePath("/feeds");
  revalidatePath("/finances");
  revalidatePath("/budget");
  revalidatePath("/business");
  revalidatePath("/revisions");
  revalidatePath("/setup");
}

export async function saveSetupAction(formData: FormData) {
  const starter = starterPackItems(formData);
  const aiPrimary = engine(text(formData, "aiPrimary"), "");
  const aiFallback = engine(text(formData, "aiFallback"), "");
  const requestedObjectives: SetupObjective[] = [
    { title: text(formData, "objective"), area: text(formData, "objectiveArea"), nextStep: text(formData, "objectiveNextStep") },
    ...formData.getAll("suggestedObjectives").map((value) => ({ title: String(value).trim(), area: text(formData, "objectiveArea"), nextStep: text(formData, "objectiveNextStep") })),
    ...starter.objectives,
  ].filter((objective) => objective.title);
  const state = await readSetupState();
  await saveSetupState({
    ...state,
    currentStep: "review",
    context: {
      identity: text(formData, "identity"),
      focusAreas: text(formData, "focusAreas"),
      weeklyRhythm: text(formData, "weeklyRhythm"),
      contactEmail: text(formData, "contactEmail"),
      operatingRules: lines(text(formData, "operatingRules")),
      currentPriorities: lines(text(formData, "currentPriorities")),
    },
    feeds: { enabled: text(formData, "feedsEnabled") !== "false", urls: [...starter.feeds, ...lines(text(formData, "feeds"))] },
    ai: { ...state.ai, primary: aiPrimary, fallback: aiFallback === aiPrimary ? "" : aiFallback },
    goals: requestedObjectives.map((objective) => ({
      title: objective.title,
      area: objective.area || text(formData, "objectiveArea") || "Projects",
      nextStep: objective.nextStep || text(formData, "objectiveNextStep"),
    })),
  });
  await finalizeSetup();

  revalidateApp();
  redirect("/");
}

function checkbox(formData: FormData, key: string) {
  const value = formData.get(key);
  return value === "true" || value === "1" || value === "on" || value === "yes" || value === key;
}

function setupStep(value: string): SetupStep | null {
  return SETUP_STEPS.includes(value as SetupStep) ? value as SetupStep : null;
}

function nextSetupStep(step: SetupStep): SetupStep {
  return SETUP_STEPS[Math.min(SETUP_STEPS.indexOf(step) + 1, SETUP_STEPS.length - 1)];
}

function setupError(step: SetupStep, error: "invalid" | "required"): never {
  redirect(`${setupPath(step)}?error=${error}`);
}

function validTimezone(value: string) {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function setupFeeds(formData: FormData) {
  const values = formData.getAll("feeds").flatMap((value) => lines(String(value)));
  const urls: string[] = [];
  for (const value of values) {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      urls.push(url.toString());
    } catch {
      return null;
    }
  }
  return [...new Set(urls)];
}

function setupGoals(formData: FormData): SetupGoal[] | null {
  const goals: SetupGoal[] = [];
  const raw = text(formData, "goals");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return null;
      for (const item of parsed) {
        if (!item || typeof item !== "object") return null;
        const goal = item as { title?: unknown; area?: unknown; nextStep?: unknown };
        const title = String(goal.title || "").trim();
        if (!title) continue;
        goals.push({ title, area: String(goal.area || "Projects").trim() || "Projects", nextStep: String(goal.nextStep || "").trim() });
      }
    } catch {
      return null;
    }
  }
  const title = text(formData, "goalTitle") || text(formData, "objective");
  if (title) goals.push({
    title,
    area: text(formData, "goalArea") || text(formData, "objectiveArea") || "Projects",
    nextStep: text(formData, "goalNextStep") || text(formData, "objectiveNextStep"),
  });
  for (const suggestion of formData.getAll("suggestedObjectives")) {
    const suggestedTitle = String(suggestion).trim();
    if (suggestedTitle) goals.push({ title: suggestedTitle, area: "Projects", nextStep: "" });
  }
  return [...new Map(goals.map((goal) => [goal.title.toLowerCase(), goal])).values()];
}

function setupCustomModules(formData: FormData) {
  const raw = text(formData, "customModules");
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return null;
    if (value.some((item) => typeof item !== "string" || item.length > 80)) return null;
    return [...new Set(value.map((item) => item.trim()).filter(Boolean))].slice(0, 8);
  } catch {
    return null;
  }
}

export async function saveSetupStepAction(formData: FormData) {
  const step = setupStep(text(formData, "step"));
  if (!step) redirect(setupPath("language"));
  const state = await readSetupState();
  let next: SetupState = { ...state, currentStep: nextSetupStep(step) };

  if (step === "language") {
    const locale = text(formData, "locale");
    const timezone = text(formData, "timezone");
    if ((locale !== "fr" && locale !== "en") || !validTimezone(timezone)) setupError(step, "invalid");
    next = { ...next, locale, timezone };
    (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 31_536_000, sameSite: "lax" });
  } else if (step === "context") {
    const contactEmail = text(formData, "contactEmail");
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) setupError(step, "invalid");
    next = { ...next, context: {
      identity: text(formData, "identity"),
      focusAreas: text(formData, "focusAreas"),
      weeklyRhythm: text(formData, "weeklyRhythm"),
      contactEmail,
      operatingRules: lines(text(formData, "operatingRules")),
      currentPriorities: lines(text(formData, "currentPriorities")),
    } };
  } else if (step === "modules") {
    const custom = setupCustomModules(formData);
    if (!custom) setupError(step, "invalid");
    const finance = checkbox(formData, "finance");
    const budget = checkbox(formData, "budget");
    const business = checkbox(formData, "business");
    const currency = text(formData, "currency").toUpperCase() || state.currency;
    if ((finance || budget || business) && !/^[A-Z]{3}$/.test(currency)) setupError(step, "invalid");
    next = { ...next, modules: {
      finance,
      budget,
      trail: checkbox(formData, "trail"),
      trailSync: state.modules.trailSync,
      business,
      revisions: checkbox(formData, "revisions"),
      custom,
    }, currency };
  } else if (step === "feeds") {
    const urls = setupFeeds(formData);
    if (!urls) setupError(step, "invalid");
    next = { ...next, feeds: { enabled: checkbox(formData, "feedsEnabled"), urls } };
  } else if (step === "ai") {
    const skip = checkbox(formData, "skip");
    const requestedPrimary = skip ? "" : engine(text(formData, "aiPrimary"), "");
    const requestedFallback = skip ? "" : engine(text(formData, "aiFallback"), "");
    const primary = skip ? "" : state.ai.verified.length
      ? state.ai.verified.includes(requestedPrimary as AiProvider) ? requestedPrimary : state.ai.verified[0]
      : requestedPrimary;
    const fallback = skip ? "" : state.ai.verified.includes(requestedFallback as AiProvider) && requestedFallback !== primary
      ? requestedFallback
      : state.ai.verified.find((provider) => provider !== primary) || "";
    const claudeModel = text(formData, "aiClaudeModel");
    const codexModel = text(formData, "aiCodexModel");
    if (![claudeModel, codexModel].every((model) => model.length <= 160 && /^[a-zA-Z0-9._:/@-]*$/.test(model))) setupError(step, "invalid");
    next = {
      ...next,
      ai: {
        ...state.ai,
        primary,
        fallback: fallback === primary ? "" : fallback,
        models: { claude: claudeModel, codex: codexModel },
      },
    };
  } else if (step === "goals") {
    const goals = setupGoals(formData);
    if (!goals) setupError(step, "invalid");
    next = { ...next, goals };
  }

  await saveSetupState(next);
  revalidatePath("/setup");
  redirect(setupPath(next.currentStep));
}

export async function completeSetupAction() {
  await finalizeSetup();
  revalidateApp();
  redirect("/");
}

export async function createCaptureAction(formData: FormData) {
  const body = text(formData, "text");
  if (!body) return;
  const note = await createCapture({
    title: text(formData, "title"),
    source: "manual",
    url: text(formData, "url"),
    text: body,
  });
  await processInbox(1, [note.relativePath]).catch((error) => {
    console.error("[capture] automatic AI routing failed:", error);
  });
  revalidateApp();
}

export async function createObjectiveAction(formData: FormData) {
  const title = text(formData, "title");
  if (!title) return;
  await createObjective({
    title,
    area: text(formData, "area") || "Projects",
    priority: text(formData, "priority") || "medium",
    horizon: text(formData, "horizon"),
    currentState: text(formData, "currentState"),
    nextStep: text(formData, "nextStep"),
  });
  revalidateApp();
}

export async function createTaskAction(formData: FormData) {
  const title = text(formData, "title");
  if (!title) return;
  await createTask({
    title,
    area: text(formData, "area") || "Projects",
    priority: text(formData, "priority") || "medium",
    objective: text(formData, "objective"),
    why: text(formData, "why"),
  });
  revalidateApp();
}

export async function createFinancePositionAction(formData: FormData) {
  const title = text(formData, "title");
  const quantity = Number(text(formData, "quantity"));
  const unitPriceText = text(formData, "unitPrice");
  const unitPrice = unitPriceText ? Number(unitPriceText) : undefined;
  if (!title || !Number.isFinite(quantity)) return { ok: false, error: "Nom et quantité requis" };
  try {
    await createFinancePosition({
      title,
      assetType: text(formData, "assetType") || "other",
      quantity,
      unitPrice,
      currency: text(formData, "currency") || "EUR",
      identifier: text(formData, "identifier"),
      note: text(formData, "note"),
    });
    revalidateApp();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Impossible d’ajouter la position" };
  }
}

export async function createBusinessProspectAction(formData: FormData) {
  try {
    await createBusinessProspect({
      company: text(formData, "company"),
      contactName: text(formData, "contactName"),
      email: text(formData, "email"),
      source: text(formData, "source"),
      value: Number(text(formData, "value") || 0),
      currency: text(formData, "currency") || "EUR",
      stage: text(formData, "stage") || "lead",
      probability: Number(text(formData, "probability") || 20),
      nextAction: text(formData, "nextAction"),
      nextActionDate: text(formData, "nextActionDate"),
      notes: text(formData, "notes"),
    });
    revalidatePath("/business");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Impossible d’ajouter le prospect" };
  }
}

export async function updateBusinessProspectStageAction(formData: FormData) {
  try {
    await updateBusinessProspectStage(text(formData, "path"), text(formData, "stage"));
    revalidatePath("/business");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Impossible de modifier le prospect" };
  }
}

export async function createBusinessInvoiceAction(formData: FormData) {
  try {
    await createBusinessInvoice({
      number: text(formData, "number"),
      client: text(formData, "client"),
      email: text(formData, "email"),
      amount: Number(text(formData, "amount") || 0),
      currency: text(formData, "currency") || "EUR",
      issueDate: text(formData, "issueDate"),
      dueDate: text(formData, "dueDate"),
      status: text(formData, "status") || "draft",
      notes: text(formData, "notes"),
    });
    revalidatePath("/business");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Impossible d’ajouter la facture" };
  }
}

export async function updateBusinessInvoiceStatusAction(formData: FormData) {
  try {
    await updateBusinessInvoiceStatus(text(formData, "path"), text(formData, "status"));
    revalidatePath("/business");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Impossible de modifier la facture" };
  }
}

export async function deleteBusinessRecordAction(formData: FormData) {
  try {
    await deleteBusinessRecord(text(formData, "path"));
    revalidatePath("/business");
    revalidatePath("/trash");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Impossible de supprimer la fiche" };
  }
}

export async function saveBusinessSettingsAction(formData: FormData) {
  try {
    await saveBusinessSettings({
      currency: text(formData, "currency") || "EUR",
      monthlyRevenueGoal: Number(text(formData, "monthlyRevenueGoal") || 0),
    });
    revalidatePath("/business");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Impossible d’enregistrer l’objectif" };
  }
}

export async function refreshFinancePositionPriceAction(formData: FormData) {
  const relativePath = text(formData, "path");
  if (!relativePath) return { ok: false, error: "Missing position path" };
  try {
    await refreshFinancePositionPrice(relativePath);
    revalidateApp();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Refresh failed" };
  }
}

function jsonArray<T>(formData: FormData, key: string): T[] | null {
  try {
    const parsed = JSON.parse(text(formData, key) || "[]");
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function updateMonthlyBudgetAction(formData: FormData) {
  const fixedItems = jsonArray<BudgetLineItem>(formData, "fixedItems");
  const variableItems = jsonArray<BudgetLineItem>(formData, "variableItems");
  const subscriptions = jsonArray<BudgetSubscriptionRecord>(formData, "subscriptions");
  if (!fixedItems || !variableItems || !subscriptions) return { ok: false, error: "Données de budget invalides" };
  try {
    await writeMonthlyBudget({
      month: text(formData, "month"),
      income: text(formData, "income"),
      fixedItems,
      variableItems,
      savingsTarget: text(formData, "savingsTarget"),
      subscriptions,
    });
    revalidatePath("/budget");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Impossible d’enregistrer le budget" };
  }
}

export async function moveTrainingSessionAction(formData: FormData) {
  const sessionId = text(formData, "session_id");
  const week = Number(text(formData, "week"));
  const toWeekday = Number(text(formData, "to_weekday"));
  if (!sessionId || !Number.isInteger(week) || !Number.isInteger(toWeekday)) {
    return { ok: false, error: "Données de déplacement invalides" };
  }
  try {
    await savePlanOverride({ sessionId, week, action: "move", toWeekday, reason: "", activityId: null });
    revalidatePath("/training");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Impossible de déplacer la séance" };
  }
}

export async function cancelTrainingSessionAction(formData: FormData) {
  const sessionId = text(formData, "session_id");
  const week = Number(text(formData, "week"));
  const reason = text(formData, "reason");
  if (!sessionId || !Number.isInteger(week)) return { ok: false, error: "Données d’annulation invalides" };
  try {
    await savePlanOverride({ sessionId, week, action: "cancel", toWeekday: null, reason, activityId: null });
    revalidatePath("/training");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Impossible d’annuler la séance" };
  }
}

export async function validateTrainingSessionAction(formData: FormData) {
  const sessionId = text(formData, "session_id");
  const week = Number(text(formData, "week"));
  const activityId = text(formData, "activity_id");
  if (!sessionId || !Number.isInteger(week)) return { ok: false, error: "Données de validation invalides" };
  try {
    await savePlanOverride({ sessionId, week, action: "validate", toWeekday: null, reason: "", activityId: activityId || null });
    revalidatePath("/training");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Impossible de valider la séance" };
  }
}

export async function undoTrainingOverrideAction(formData: FormData) {
  const sessionId = text(formData, "session_id");
  if (!sessionId) return { ok: false, error: "Séance manquante" };
  try {
    await removePlanOverride(sessionId);
    revalidatePath("/training");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Impossible d’annuler la modification" };
  }
}

const PLAN_SPORTS = new Set<PlanObjective["sport"]>(["trail", "run", "ride", "hybrid"]);
const TRAINING_EXPERIENCES = new Set<TrainingExperience>(["first", "shorter", "similar", "several"]);

// Builds a full training plan for a new (or changed) objective: archives
// whatever plan currently exists, clears its manual overrides (a fresh plan
// starts clean), tries the AI bridge, and falls back to a deterministic plan
// when the bridge is down or returns something invalid.
export async function generateTrainingPlanAction(formData: FormData) {
  const sport = text(formData, "sport");
  const title = text(formData, "title") || "Objectif d’entraînement";
  const eventDate = text(formData, "event_date");
  const weeksTotal = Number(text(formData, "weeks_total"));
  const daysPerWeek = Number(text(formData, "days_per_week"));
  const eventDistanceKm = Number(text(formData, "event_distance_km"));
  const eventElevationM = Number(text(formData, "event_elevation_m"));
  const weeklyVolumeKm = Number(text(formData, "weekly_volume_km"));
  const longestSessionKm = Number(text(formData, "longest_session_km"));
  const experience = text(formData, "experience") as TrainingExperience;
  const recentReference = text(formData, "recent_reference");
  const constraints = text(formData, "constraints");

  if (!PLAN_SPORTS.has(sport as PlanObjective["sport"])) return { ok: false, error: "sport" as const };
  if (!eventDate) return { ok: false, error: "eventDate" as const };
  if (eventDate < todayISO()) return { ok: false, error: "pastDate" as const };
  if (!Number.isInteger(weeksTotal) || weeksTotal < 1 || weeksTotal > 52) {
    return { ok: false, error: "weeks" as const };
  }
  if (!Number.isInteger(daysPerWeek) || daysPerWeek < 1 || daysPerWeek > 7) {
    return { ok: false, error: "days" as const };
  }
  if (!Number.isFinite(eventDistanceKm) || eventDistanceKm <= 0 || eventDistanceKm > 1000) {
    return { ok: false, error: "distance" as const };
  }
  if (!Number.isFinite(eventElevationM) || eventElevationM < 0 || eventElevationM > 20000) {
    return { ok: false, error: "elevation" as const };
  }
  if (!Number.isFinite(weeklyVolumeKm) || weeklyVolumeKm < 0 || weeklyVolumeKm > 1000) {
    return { ok: false, error: "weeklyVolume" as const };
  }
  if (!Number.isFinite(longestSessionKm) || longestSessionKm < 0 || longestSessionKm > 1000) {
    return { ok: false, error: "longestSession" as const };
  }
  if (!TRAINING_EXPERIENCES.has(experience)) return { ok: false, error: "experience" as const };
  const startDate = trainingPlanStartISO(eventDate, weeksTotal);
  if (!startDate) return { ok: false, error: "dateRange" as const };
  const level = trainingLevelSummary({ weeklyVolumeKm, sessionsPerWeek: daysPerWeek, longestSessionKm, experience, recentReference });

  const objective: PlanObjective = {
    sport: sport as PlanObjective["sport"],
    title,
    eventDate,
    startDate,
    weeksTotal,
    eventDistanceKm,
    eventElevationM,
    weeklyVolumeKm,
    longestSessionKm,
    experience,
    recentReference,
    level,
    daysPerWeek,
    constraints,
  };

  try {
    await archiveTrainingPlan();
    await clearPlanOverrides();
    const generated = (await generateAiTrainingPlan(objective, constraints)) || fallbackTrainingPlan(objective);
    await saveTrainingPlan({ ...generated, objective });
    revalidatePath("/training");
    return { ok: true };
  } catch {
    return { ok: false, error: "generate" as const };
  }
}

export async function updateFinancePositionAction(formData: FormData) {
  const relativePath = text(formData, "path");
  const title = text(formData, "title");
  const quantity = Number(text(formData, "quantity"));
  const unitPriceText = text(formData, "unitPrice");
  const unitPrice = unitPriceText ? Number(unitPriceText) : undefined;
  if (!relativePath || !title || !Number.isFinite(quantity)) return { ok: false, error: "Nom et quantité requis" };
  try {
    await updateFinancePosition({
      relativePath,
      title,
      assetType: text(formData, "assetType") || "other",
      quantity,
      unitPrice,
      currency: text(formData, "currency") || "EUR",
      identifier: text(formData, "identifier"),
    });
    revalidateApp();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Impossible de modifier la position" };
  }
}

export async function refreshAllFinancePositionPricesAction() {
  try {
    const result = await refreshAllFinancePositionPrices();
    revalidateApp();
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Refresh failed" };
  }
}

export async function reorderFinancePositionsAction(formData: FormData) {
  const paths = formData.getAll("paths").map((value) => String(value));
  if (!paths.length) return { ok: false, error: "Aucune position à réorganiser" };
  try {
    await reorderFinancePositions(paths);
    revalidatePath("/finances");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Réorganisation impossible" };
  }
}

export async function connectFinancePositionAction(formData: FormData) {
  const relativePath = text(formData, "path");
  const identifier = text(formData, "identifier");
  if (!relativePath || !identifier) return { ok: false, error: "Identifiant requis" };
  try {
    await connectFinancePosition(relativePath, identifier);
    revalidateApp();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Connexion impossible" };
  }
}

export async function deleteFinancePositionAction(formData: FormData) {
  const relativePath = text(formData, "path");
  if (!relativePath) return { ok: false, error: "Missing position path" };
  try {
    await deleteFinancePosition(relativePath);
    revalidateApp();
    revalidatePath("/trash");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Delete failed" };
  }
}

export async function createRawNoteAction(formData: FormData) {
  const body = text(formData, "content");
  if (!body) return;
  const note = await createRawNote({
    title: text(formData, "title"),
    body,
    tags: csv(text(formData, "tags")),
  });
  revalidateApp();
  redirect(editHref(note));
}

export async function createWikiNoteAction(formData: FormData) {
  const title = text(formData, "title");
  if (!title) return;
  const note = await createWikiNote({
    title,
    summary: text(formData, "summary"),
    body: text(formData, "body"),
    tags: csv(text(formData, "tags")),
  });
  revalidateApp();
  redirect(editHref(note));
}

export async function configureRevisionProgramAction(formData: FormData) {
  const state = await readSetupState();
  await configureRevisionProgram({
    title: text(formData, "title"),
    examDate: text(formData, "examDate"),
    modules: text(formData, "modules").split(/\r?\n/),
    locale: state.locale,
  });
  revalidatePath("/revisions");
  redirect("/revisions");
}

export async function updateNoteAction(formData: FormData) {
  const relativePath = text(formData, "path");
  const title = text(formData, "title");
  if (!relativePath || !title) return;
  const note = await updateNote({
    relativePath,
    title,
    status: text(formData, "status"),
    area: text(formData, "area"),
    priority: text(formData, "priority"),
    horizon: text(formData, "horizon"),
    tags: csv(text(formData, "tags")),
    content: text(formData, "content"),
  });
  revalidateApp();
  revalidatePath(noteHref(note));
  revalidatePath(editHref(note));
  redirect(editHref(note));
}

export async function updateTaskStatusAction(formData: FormData) {
  const relativePath = text(formData, "path");
  const status = text(formData, "status");
  if (!relativePath || !status) return;
  await updateTaskStatus(relativePath, status);
  revalidateApp();
}

export async function updateCaptureStatusAction(formData: FormData) {
  const relativePath = text(formData, "path");
  const status = text(formData, "status");
  if (!relativePath || !status) return;
  await updateCaptureStatus(relativePath, status);
  revalidateApp();
}

export async function generateDailyBriefAction() {
  try {
    const job = await beginDailyBriefJob();
    if (!job.started) return { ok: true as const, state: job.state };

    after(async () => {
      try {
        await processInbox(10);
        const note = await generateDailyBrief({ force: true, requireAi: true });
        await finishDailyBriefJob(job.state.id!, {
          path: note.relativePath,
          generatedBy: String(note.data.generated_by || "ai"),
        });
      } catch (error) {
        await finishDailyBriefJob(job.state.id!, {
          error: error instanceof Error ? error.message : "Génération IA impossible",
        });
      }
    });

    return { ok: true as const, state: job.state };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Génération impossible" };
  }
}

export async function getDailyBriefJobAction() {
  return readDailyBriefJob();
}

export async function generateWeeklyReviewAction() {
  try {
    await processInbox(10);
    const note = await generateWeeklyReview({ force: true, requireAi: true });
    const coachError = await generateTrailCoachDecision()
      .then(() => "")
      .catch((error) => error instanceof Error ? error.message : "Analyse coach impossible");
    revalidateApp();
    return { ok: true as const, path: note.relativePath, generatedBy: String(note.data.generated_by || "ai"), coachError };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Génération IA impossible" };
  }
}

export async function generateTrailCoachDecisionAction() {
  try {
    const decision = await generateTrailCoachDecision();
    revalidatePath("/training");
    return { ok: true as const, engine: decision.engine };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Analyse coach impossible",
      code: error instanceof AiEngineError ? error.code : undefined,
    };
  }
}

export async function askAssistantAction(
  history: { role: "user" | "assistant"; content: string }[],
  question: string,
  options?: { engine?: "claude" | "codex"; model?: string; effort?: string },
): Promise<{ ok: true; reply: string; engine: string } | { ok: false; error: string }> {
  try {
    const { reply, engine } = await askAssistant(history, question, options ?? {});
    revalidateApp();
    return { ok: true as const, reply, engine };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "L'assistant n'a pas pu répondre." };
  }
}

export async function saveAssistantChatAction(
  id: string,
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<{ ok: true; chats: AssistantChatSummary[] } | { ok: false; error: string }> {
  try {
    const chats = await saveAssistantChat(id, messages);
    return { ok: true as const, chats };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Impossible d’enregistrer la conversation." };
  }
}

export async function loadAssistantChatAction(
  id: string,
): Promise<{ ok: true; chat: StoredAssistantChat } | { ok: false; error: string }> {
  try {
    const chat = await readAssistantChat(id);
    if (!chat) return { ok: false as const, error: "Conversation introuvable." };
    return { ok: true as const, chat };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Impossible de charger la conversation." };
  }
}

export async function deleteAssistantChatAction(
  id: string,
): Promise<{ ok: true; chats: AssistantChatSummary[] } | { ok: false; error: string }> {
  try {
    const chats = await deleteAssistantChat(id);
    return { ok: true as const, chats };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Impossible de supprimer la conversation." };
  }
}

export async function processInboxAction() {
  await processInbox();
  revalidateApp();
}

export async function addFeedAction(formData: FormData) {
  const url = text(formData, "url");
  if (!url) return;
  await addFeed(url);
  revalidateApp();
}

export async function removeFeedAction(formData: FormData) {
  const url = text(formData, "url");
  if (!url) return;
  await removeFeed(url);
  revalidateApp();
}

export async function toggleFeedsAction(formData: FormData) {
  await setFeedsEnabled(text(formData, "enabled") === "true");
  revalidateApp();
}

export async function refreshFeedsAction() {
  await ingestFeeds({ force: true });
  revalidateApp();
}

export async function togglePinNoteAction(formData: FormData) {
  const relativePath = text(formData, "path");
  if (!relativePath) return;
  const note = await setNotePinned(relativePath, text(formData, "pinned") === "true");
  revalidateApp();
  revalidatePath(noteHref(note));
}

export async function createCustomPageAction(formData: FormData) {
  const title = text(formData, "title");
  if (!title) return { ok: false, error: "Title is required" };
  try {
    const page = await createCustomPage(title, text(formData, "icon"));
    revalidatePath("/settings");
    revalidatePath("/", "layout");
    return { ok: true, slug: page.slug };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not create page" };
  }
}

export async function archiveCustomPageAction(formData: FormData) {
  const slug = text(formData, "slug");
  if (!slug) return { ok: false, error: "slug is required" };
  try {
    await archiveCustomPage(slug);
    revalidatePath("/settings");
    revalidatePath(`/p/${slug}`);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not archive page" };
  }
}

export async function toggleCustomPageDailyAction(formData: FormData) {
  const slug = text(formData, "slug");
  if (!slug) return { ok: false, error: "slug is required" };
  try {
    await setCustomPageDaily(slug, text(formData, "enabled") === "true");
    revalidatePath(`/p/${slug}`);
    revalidateApp();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Toggle failed" };
  }
}

export async function setCustomPageIconAction(formData: FormData) {
  const slug = text(formData, "slug");
  if (!slug) return { ok: false, error: "slug is required" };
  try {
    await setCustomPageIcon(slug, String(formData.get("icon") || ""));
    revalidatePath(`/p/${slug}`);
    revalidatePath("/", "layout");
    revalidateApp();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Icon update failed" };
  }
}

export async function createCustomPageEntryAction(formData: FormData) {
  const slug = text(formData, "slug");
  const title = text(formData, "title");
  if (!slug || !title) return;
  await createCustomPageEntry(slug, title, text(formData, "body"));
  revalidatePath(`/p/${slug}`);
}
