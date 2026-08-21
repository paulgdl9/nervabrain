import { AssistantChat } from "@/components/AssistantChat";
import { getLocale, getTranslations } from "@/lib/i18n-server";
import { aiSetupPreferences, readNote } from "@/lib/vault";
import { listAssistantChats } from "@/lib/assistant-chats";
import { MessageCircle } from "lucide-react";
import "./assistant.css";

export const dynamic = "force-dynamic";

type AssistantModelCatalog = { claude: { id: string; label: string }[]; codex: { id: string; label: string }[] };

// Same server-side fetch pattern as readBridgeStatus in setup/[step]/page.tsx:
// Bearer token, short timeout, graceful fallback to an empty catalog.
async function readAssistantModels(): Promise<AssistantModelCatalog> {
  const empty: AssistantModelCatalog = { claude: [], codex: [] };
  const bridgeUrl = process.env.MEMO_BRIDGE_URL?.trim();
  const bridgeToken = process.env.MEMO_TOKEN?.trim();
  if (!bridgeUrl || !bridgeToken) return empty;
  try {
    const response = await fetch(`${bridgeUrl.replace(/\/+$/, "")}/status`, {
      headers: { Authorization: `Bearer ${bridgeToken}` },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return empty;
    const health = await response.json().catch(() => null) as {
      auth?: { claude?: { configured?: boolean }; codex?: { configured?: boolean } };
      models?: { claude?: Array<{ id?: unknown; label?: unknown }>; codex?: Array<{ id?: unknown; label?: unknown }> };
    } | null;
    if (!health) return empty;
    const models = (provider: "claude" | "codex") => {
      if (health.auth?.[provider]?.configured !== true) return [];
      return (health.models?.[provider] || []).flatMap((model) => {
        const id = typeof model.id === "string" ? model.id.trim() : "";
        if (!id || id.length > 160 || !/^[a-zA-Z0-9._:/@-]+$/.test(id)) return [];
        const label = typeof model.label === "string" && model.label.trim() ? model.label.trim().slice(0, 120) : id;
        return [{ id, label }];
      });
    };
    return { claude: models("claude"), codex: models("codex") };
  } catch {
    return empty;
  }
}

function preparationPrompt(locale: "fr" | "en", title: string, relativePath: string) {
  if (locale === "en") {
    return `Prepare "${title}" with my Brain (${relativePath}).

Read this item, then search the vault for the most useful notes, knowledge, decisions and related projects. Do not rely only on matching titles.

Reply with:
1. The 5 most useful ideas or notes, with why each one matters here.
2. A concise braindump that connects them to the item.
3. A practical outline: Problem → Insight → Solution → Next actions.
4. Missing information or assumptions to validate.

Use only information found in the vault, cite the source note paths, and do not write the final deliverable in my voice.`;
  }
  return `Prépare « ${title} » avec mon Brain (${relativePath}).

Lis cet élément, puis cherche dans le vault les notes, connaissances, décisions et projets liés les plus utiles. Ne te limite pas aux titres qui contiennent les mêmes mots.

Réponds avec :
1. Les 5 idées ou notes les plus utiles, avec la raison précise de leur intérêt ici.
2. Un braindump concis qui les relie à l’élément.
3. Un plan concret : Problème → Idée forte → Solution → Prochaines actions.
4. Les informations manquantes ou hypothèses à valider.

Utilise uniquement les informations du vault, cite les chemins des notes sources et n’écris pas le livrable final à ma place.`;
}

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ prepare?: string }>;
}) {
  const [t, locale, models, ai, initialChats, query] = await Promise.all([
    getTranslations(),
    getLocale(),
    readAssistantModels(),
    aiSetupPreferences(),
    listAssistantChats(),
    searchParams,
  ]);
  const defaultEngine: "claude" | "codex" | "" = ai.engineOrder[0] ?? "";
  const requestedPath = typeof query.prepare === "string" ? query.prepare.trim() : "";
  const safePath = requestedPath
    && requestedPath.length <= 500
    && !requestedPath.includes("\0")
    && !requestedPath.split("/").includes("..")
    ? requestedPath
    : "";
  const target = safePath ? await readNote(safePath) : null;
  const initialPrompt = target && ["task", "project", "objective"].includes(target.kind)
    ? preparationPrompt(locale, target.title, target.relativePath)
    : "";

  return (
    <div className="dash assistant-page">
      <header className="dash-header">
        <div className="dash-greeting">
          <p className="eyebrow"><MessageCircle size={14} /> {t["assistant.overline"]}</p>
          <h1>{t["assistant.title"]}</h1>
          <p className="muted">{t["assistant.description"]}</p>
        </div>
      </header>
      <AssistantChat models={models} defaultEngine={defaultEngine} initialChats={initialChats} initialPrompt={initialPrompt} />
    </div>
  );
}
