import fs from "node:fs/promises";
import path from "node:path";
import { ingestFeeds } from "../src/lib/vault";

await loadEnv();

const result = await ingestFeeds({ force: true });
console.log(`RSS ingest complete: ${result.added} new item(s).`);
for (const [url, info] of Object.entries(result.perFeed)) {
  console.log(info.error ? `- ${url}: ERROR ${info.error}` : `- ${url}: ${info.added}`);
}

async function loadEnv() {
  for (const file of [".env", ".env.local"]) {
    const fullPath = path.join(process.cwd(), file);
    const raw = await fs.readFile(fullPath, "utf8").catch(() => "");
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
      const [key, ...rest] = line.split("=");
      const name = key.trim();
      if (!(name in process.env)) {
        process.env[name] = rest.join("=").trim().replace(/^["']|["']$/g, "");
      }
    }
  }
}
