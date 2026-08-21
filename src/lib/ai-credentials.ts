import fs from "node:fs/promises";
import path from "node:path";
import { withFileWriteLock } from "@/lib/atomic-write";

export type AiProvider = "claude" | "codex";

const ENV_NAME: Record<AiProvider, "ANTHROPIC_API_KEY" | "OPENAI_API_KEY"> = {
  claude: "ANTHROPIC_API_KEY",
  codex: "OPENAI_API_KEY",
};

export function aiCredentialsPath(projectRoot = process.cwd()) {
  const dataRoot = path.resolve(projectRoot, "data");
  const configured = String(process.env.AI_CREDENTIALS_FILE || "").trim();
  if (!configured) return path.join(dataRoot, "ai-credentials.env");
  if (path.isAbsolute(configured)) return path.normalize(configured);

  // Relative paths name a file inside the shared ./data volume. Accept the
  // common "data/foo" spelling without accidentally producing data/data/foo.
  const relative = configured.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^data\//, "");
  const target = path.resolve(dataRoot, relative || "ai-credentials.env");
  return target.startsWith(`${dataRoot}${path.sep}`)
    ? target
    : path.join(dataRoot, "ai-credentials.env");
}

function parseCredentials(raw: string) {
  const values = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^(ANTHROPIC_API_KEY|OPENAI_API_KEY)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

export async function configuredAiCredentials(): Promise<Record<AiProvider, boolean>> {
  const raw = await fs.readFile(aiCredentialsPath(), "utf8").catch(() => "");
  const values = parseCredentials(raw);
  return {
    claude: Boolean(values.get(ENV_NAME.claude)),
    codex: Boolean(values.get(ENV_NAME.codex)),
  };
}

export async function saveAiCredential(provider: AiProvider, apiKey: string) {
  const key = apiKey.trim();
  if (key.length < 20 || /\s/.test(key)) throw new Error("invalid_api_key");

  const target = aiCredentialsPath();
  return withFileWriteLock(target, async () => {
    const directory = path.dirname(target);
    const values = parseCredentials(await fs.readFile(target, "utf8").catch(() => ""));
    values.set(ENV_NAME[provider], key);
    const body = [...values.entries()].map(([name, value]) => `${name}=${value}`).join("\n") + "\n";
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;

    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(temporary, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      await fs.rename(temporary, target);
      await fs.chmod(target, 0o600);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  });
}
