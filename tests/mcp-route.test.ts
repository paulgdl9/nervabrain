import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

// Point OAuth persistence and the vault at scratch locations so tests never
// touch ./data or the real vault. Both paths are resolved lazily per call, so
// assigning here (before any route call) is sufficient despite import hoisting.
process.env.OAUTH_STATE_FILE = path.join(os.tmpdir(), `oauth-state-mcp-test-${process.pid}-${randomUUID()}.json`);
const scratchVault = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-route-test-vault-"));
process.env.SECOND_BRAIN_VAULT = scratchVault;
process.env.NEXT_PUBLIC_MCP_BASE_URL = "https://brain.example";

import { GET, OPTIONS, POST } from "../src/app/api/mcp/route";
import { issueAccessToken, resetOAuthStateForTests } from "../src/lib/oauth-codes";

const ENDPOINT = "https://brain.example/api/mcp";

function bearerToken(scopes: ("read" | "write")[] = ["read", "write"]) {
  return issueAccessToken("test-client", scopes).token;
}

function rpc(body: unknown, token: string) {
  return new NextRequest(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("GET without credentials returns 401 with resource metadata pointer", async () => {
  resetOAuthStateForTests();
  const response = await GET(new NextRequest(ENDPOINT));
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate") ?? "", /resource_metadata=/);
});

test("authenticated GET returns 405: no standalone SSE stream is offered", async () => {
  resetOAuthStateForTests();
  const token = bearerToken(["read"]);
  const response = await GET(new NextRequest(ENDPOINT, { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST, OPTIONS");
});

test("server-side OPTIONS needs no Origin while unknown browser origins stay blocked", async () => {
  assert.equal((await OPTIONS(new NextRequest(ENDPOINT, { method: "OPTIONS" }))).status, 204);
  assert.equal((await OPTIONS(new NextRequest(ENDPOINT, {
    method: "OPTIONS",
    headers: { origin: "https://evil.example" },
  }))).status, 403);
});

test("tools/list exposes the ChatGPT-required search and fetch tools to read scope", async () => {
  resetOAuthStateForTests();
  const response = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, bearerToken(["read"])));
  assert.equal(response.status, 200);
  const payload = await response.json();
  const names = payload.result.tools.map((tool: { name: string }) => tool.name);
  assert.ok(names.includes("search"), `missing "search" in ${names}`);
  assert.ok(names.includes("fetch"), `missing "fetch" in ${names}`);
  assert.ok(!names.includes("create_task"), "write tools must not be listed for read-only scope");
});

test("search and fetch return the OpenAI connector document shape", async () => {
  resetOAuthStateForTests();
  fs.mkdirSync(path.join(scratchVault, "03-Wiki"), { recursive: true });
  fs.writeFileSync(
    path.join(scratchVault, "03-Wiki", "Zanzibar-Test.md"),
    "---\ntype: wiki\ntitle: Zanzibar Test\nstatus: active\ntags: []\n---\n\n# Zanzibar Test\n\nUnique zanzibar payload.\n",
  );
  const token = bearerToken(["read"]);

  const searchResponse = await POST(rpc(
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search", arguments: { query: "zanzibar" } } },
    token,
  ));
  const searchPayload = JSON.parse((await searchResponse.json()).result.content[0].text);
  assert.ok(Array.isArray(searchPayload.results));
  const hit = searchPayload.results.find((r: { id: string }) => r.id === "03-Wiki/Zanzibar-Test.md");
  assert.ok(hit, "seeded note should be found");
  assert.equal(hit.title, "Zanzibar Test");
  assert.equal(hit.url, "https://brain.example/note/03-Wiki/Zanzibar-Test.md");

  const fetchResponse = await POST(rpc(
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "fetch", arguments: { id: hit.id } } },
    token,
  ));
  const document = JSON.parse((await fetchResponse.json()).result.content[0].text);
  assert.equal(document.id, hit.id);
  assert.equal(document.title, "Zanzibar Test");
  assert.match(document.text, /zanzibar payload/);
});

test("fetch and read_note refuse non-Markdown vault files", async () => {
  resetOAuthStateForTests();
  fs.writeFileSync(path.join(scratchVault, "secret.json"), '{"secret":"must stay private"}\n');
  const token = bearerToken(["read"]);

  for (const [name, key] of [["fetch", "id"], ["read_note", "path"]] as const) {
    const response = await POST(rpc({
      jsonrpc: "2.0",
      id: name,
      method: "tools/call",
      params: { name, arguments: { [key]: "secret.json" } },
    }, token));
    assert.doesNotMatch((await response.json()).result.content[0].text, /must stay private/);
  }
});

test("save_daily_chat_digest validates and replaces one deterministic Raw note", async () => {
  resetOAuthStateForTests();
  const token = bearerToken(["write"]);
  const tools = (await (await POST(rpc({ jsonrpc: "2.0", id: "tools", method: "tools/list", params: {} }, token))).json()).result.tools;
  assert.deepEqual(tools.find((tool: { name: string }) => tool.name === "save_daily_chat_digest")?.annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  });
  const call = (date: string, body: string) => POST(rpc({
    jsonrpc: "2.0",
    id: date,
    method: "tools/call",
    params: { name: "save_daily_chat_digest", arguments: { date, body } },
  }, token));

  assert.equal((await (await call("2026-02-30", "Impossible")).json()).result.isError, true);
  await call("2026-08-02", "## Décisions\n\nPremière version.");
  await call("2026-08-02", "## Décisions\n\nVersion remplacée.");

  const rawDir = path.join(scratchVault, "02-Raw");
  assert.deepEqual(fs.readdirSync(rawDir).filter((name) => name.endsWith("-conversations-ia.md")), ["2026-08-02-conversations-ia.md"]);
  const note = fs.readFileSync(path.join(rawDir, "2026-08-02-conversations-ia.md"), "utf8");
  assert.match(note, /title: "Conversations IA — 2026-08-02"/);
  assert.match(note, /date: 2026-08-02/);
  assert.match(note, /Version remplacée/);
  assert.doesNotMatch(note, /Première version/);
});
