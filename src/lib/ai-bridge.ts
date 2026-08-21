import { configuredAiCredentials } from "@/lib/ai-credentials";
import type { AiProvider } from "@/lib/vault";

export type BridgeStatus = {
  configured: boolean;
  reachable: boolean;
  models: Record<AiProvider, Array<{ id: string; label: string }>>;
  engines: Record<AiProvider, {
    installed: boolean;
    configured: boolean;
    verified: boolean;
    method: "api_key" | "cli";
  }>;
};

export async function readAiBridgeStatus(verified: AiProvider[]): Promise<BridgeStatus> {
  const bridgeUrl = process.env.MEMO_BRIDGE_URL?.trim();
  const bridgeToken = process.env.MEMO_TOKEN?.trim();
  const configured = Boolean(bridgeUrl && bridgeToken);
  const credentials = await configuredAiCredentials();
  const unavailable: BridgeStatus = {
    configured,
    reachable: false,
    models: { claude: [], codex: [] },
    engines: {
      claude: { installed: false, configured: credentials.claude, verified: verified.includes("claude"), method: credentials.claude ? "api_key" : "cli" },
      codex: { installed: false, configured: credentials.codex, verified: verified.includes("codex"), method: credentials.codex ? "api_key" : "cli" },
    },
  };
  if (!bridgeUrl) return unavailable;

  try {
    const response = await fetch(`${bridgeUrl.replace(/\/+$/, "")}/${bridgeToken ? "status" : "health"}`, {
      headers: bridgeToken ? { Authorization: `Bearer ${bridgeToken}` } : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const health = response.ok ? await response.json().catch(() => null) as {
      engines?: Partial<Record<AiProvider, boolean>>;
      auth?: Partial<Record<AiProvider, { configured?: boolean; method?: "api_key" | "cli" }>>;
      models?: Partial<Record<AiProvider, Array<{ id?: unknown; label?: unknown }>>>;
    } | null : null;
    const models = (provider: AiProvider) => (health?.models?.[provider] || []).flatMap((model) => {
      const id = typeof model.id === "string" ? model.id.trim() : "";
      if (!id || id.length > 160 || !/^[a-zA-Z0-9._:/@-]+$/.test(id)) return [];
      const label = typeof model.label === "string" && model.label.trim() ? model.label.trim().slice(0, 120) : id;
      return [{ id, label }];
    });
    return {
      configured,
      reachable: response.ok && health !== null,
      models: { claude: models("claude"), codex: models("codex") },
      engines: {
        claude: {
          installed: health?.engines?.claude === true,
          configured: health?.auth?.claude?.configured === true || credentials.claude,
          verified: verified.includes("claude"),
          method: health?.auth?.claude?.method || (credentials.claude ? "api_key" : "cli"),
        },
        codex: {
          installed: health?.engines?.codex === true,
          configured: health?.auth?.codex?.configured === true || credentials.codex,
          verified: verified.includes("codex"),
          method: health?.auth?.codex?.method || (credentials.codex ? "api_key" : "cli"),
        },
      },
    };
  } catch {
    return unavailable;
  }
}
