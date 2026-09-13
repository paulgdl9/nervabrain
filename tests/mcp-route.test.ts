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
import { fallbackTrainingPlan, loadTrainingPlan, saveTrainingPlan } from "../src/lib/trail";

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
  assert.ok(names.includes("get_training_status"));
  assert.ok(!names.includes("create_task"), "write tools must not be listed for read-only scope");
  assert.ok(!names.includes("record_training_feedback"));
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

test("application MCP tools create, link, list, update, and unlink documents", async () => {
  resetOAuthStateForTests();
  const readToken = bearerToken(["read"]);
  const writeToken = bearerToken(["read", "write"]);
  const readTools = (await (await POST(rpc({ jsonrpc: "2.0", id: "read-tools", method: "tools/list", params: {} }, readToken))).json()).result.tools;
  const readNames = readTools.map((tool: { name: string }) => tool.name);
  assert.ok(readNames.includes("list_applications"));
  assert.ok(!readNames.includes("create_application"));

  const call = async (name: string, args: Record<string, unknown>, token = writeToken) => {
    const response = await POST(rpc({ jsonrpc: "2.0", id: name, method: "tools/call", params: { name, arguments: args } }, token));
    return (await response.json()).result;
  };
  const created = await call("create_application", { company: "Acme", role: "SRE", stage: "new" });
  const applicationPath = String(created.content[0].text).replace("Application created: ", "");
  const documentCreated = await call("create_application_document", {
    name: "CV SRE",
    kind: "cv",
    url: "https://www.canva.com/design/sre",
    application_path: applicationPath,
  });
  const documentPath = String(documentCreated.content[0].text).replace("Application document created: ", "");

  await call("update_application_stage", { application_path: applicationPath, stage: "preparing" });
  let listed = JSON.parse((await call("list_applications", {}, readToken)).content[0].text);
  assert.deepEqual(listed.applications.find((item: { id: string }) => item.id === applicationPath).document_paths, [documentPath]);
  assert.deepEqual(listed.documents.find((item: { id: string }) => item.id === documentPath).application_paths, [applicationPath]);
  assert.equal(listed.applications.find((item: { id: string }) => item.id === applicationPath).stage, "preparing");

  await call("link_application_document", { application_path: applicationPath, document_path: documentPath, linked: false });
  listed = JSON.parse((await call("list_applications", {}, readToken)).content[0].text);
  assert.deepEqual(listed.applications.find((item: { id: string }) => item.id === applicationPath).document_paths, []);
});

test("MCP module tools keep tasks, objectives, and training data in sync", async () => {
  resetOAuthStateForTests();
  const token = bearerToken(["read", "write"]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await POST(rpc({ jsonrpc: "2.0", id: name, method: "tools/call", params: { name, arguments: args } }, token));
    return (await response.json()).result;
  };

  const task = await call("create_task", { title: "Tâche MCP", area: "Test" });
  const taskPath = String(task.content[0].text).replace("Task created: ", "");
  await call("update_task_status", { task_path: taskPath, status: "done" });
  const taskNote = fs.readFileSync(path.join(scratchVault, taskPath), "utf8");
  assert.match(taskNote, /status: done/);
  assert.match(taskNote, /done_on: \d{4}-\d{2}-\d{2}/);

  const objective = await call("create_objective", { title: "Objectif MCP", area: "Test" });
  const objectivePath = String(objective.content[0].text).replace("Objective created: ", "");
  await call("update_objective_status", { objective_path: objectivePath, status: "paused" });
  assert.match(fs.readFileSync(path.join(scratchVault, objectivePath), "utf8"), /status: paused/);

  const monday = new Date();
  monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const event = new Date(monday);
  event.setDate(event.getDate() + 41);
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  await saveTrainingPlan(fallbackTrainingPlan({
    sport: "trail",
    title: "Trail MCP",
    eventDate: iso(event),
    startDate: iso(monday),
    weeksTotal: 6,
    eventDistanceKm: 25,
    eventElevationM: 1200,
    level: "beginner",
    daysPerWeek: 3,
    constraints: "",
  }));
  fs.mkdirSync(path.join(scratchVault, "08-Projects/Trail-26K"), { recursive: true });
  fs.writeFileSync(path.join(scratchVault, "08-Projects/Trail-26K/sync-data.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    activities: [{
      id: "garmin-test-1",
      date: iso(new Date()),
      week: 1,
      weekday: (new Date().getDay() + 6) % 7,
      kind: "run",
      type: "running",
      name: "Course MCP",
      km: 5,
      dur_s: 1800,
      hr: 145,
      dplus: 80,
    }],
  }));

  const training = JSON.parse((await call("get_training_status")).content[0].text);
  assert.equal(training.objective.title, "Trail MCP");
  assert.equal(training.recent_activities.at(-1).id, "garmin-test-1");
  assert.equal(training.plan_week.number, training.current_week.number);
  assert.ok(training.plan_week.sessions.every((item: { id?: string; details?: string[] }) => item.id && item.details?.length));
  const session = training.current_week.sessions[0];
  assert.ok(session?.id);

  await call("record_training_feedback", {
    activity_id: "garmin-test-1",
    rpe: 5,
    pain: 1,
    feeling: "good",
    note: "RAS",
  });
  const feedback = JSON.parse(fs.readFileSync(path.join(scratchVault, "08-Projects/Trail-26K/feedback-data.json"), "utf8"));
  assert.equal(feedback.feedback[0].activityId, "garmin-test-1");

  await call("adjust_training_session", {
    session_id: session.id,
    week: training.current_week.number,
    action: "cancel",
    reason: "Test MCP",
  });
  let overrides = JSON.parse(fs.readFileSync(path.join(scratchVault, "08-Projects/Training/plan-overrides.json"), "utf8"));
  assert.equal(overrides.overrides[0].session_id, session.id);
  assert.equal(overrides.overrides[0].action, "cancel");

  await call("adjust_training_session", { session_id: session.id, week: training.current_week.number, action: "restore" });
  overrides = JSON.parse(fs.readFileSync(path.join(scratchVault, "08-Projects/Training/plan-overrides.json"), "utf8"));
  assert.deepEqual(overrides.overrides, []);

  const weekday = (new Date(`${session.planned_date}T12:00:00Z`).getUTCDay() + 6) % 7;
  const custom = {
    week: training.current_week.number,
    sport: session.sport,
    weekday,
    title: "Séance MCP personnalisée",
    subtitle: "Remplacement structuré",
    duration_min: session.duration_min || 30,
    intensity: "Facile",
    details: ["Échauffement", "Bloc principal", "Retour au calme"],
  };
  await call("adjust_training_session", { ...custom, session_id: session.id, action: "replace" });
  assert.equal((await loadTrainingPlan()).weeks[training.current_week.number - 1].sessions.find((item) => item.id === session.id)?.title, custom.title);

  await call("adjust_training_session", { session_id: session.id, week: training.current_week.number, action: "delete" });
  assert.equal((await loadTrainingPlan()).weeks[training.current_week.number - 1].sessions.some((item) => item.id === session.id), false);

  await call("adjust_training_session", { ...custom, action: "add" });
  assert.ok((await loadTrainingPlan()).weeks[training.current_week.number - 1].sessions.some((item) => item.title === custom.title));
});

test("training MCP appends the next week for a rolling migrated plan", async () => {
  resetOAuthStateForTests();
  const writeToken = bearerToken(["read", "write"]);
  const plan = fallbackTrainingPlan({
    sport: "trail", title: "Rolling plan", eventDate: "2026-12-15", startDate: "2026-09-07",
    weeksTotal: 1, level: "intermediaire", daysPerWeek: 3, constraints: "",
  });
  plan.generatedBy = "migration";
  await saveTrainingPlan(plan);
  const response = await POST(rpc({
    jsonrpc: "2.0", id: "add-week-two", method: "tools/call", params: { name: "adjust_training_session", arguments: {
      week: 2, action: "add", sport: "strength", weekday: 0, title: "Push", subtitle: "Séance validée",
      duration_min: 60, intensity: "Modérée", details: ["Échauffement", "Bloc principal"],
    } },
  }, writeToken));
  const result = await response.json();
  assert.equal(result.result.isError, undefined);
  const saved = await loadTrainingPlan();
  assert.equal(saved.objective.weeksTotal, 2);
  assert.equal(saved.weeks[1].dates, "14/09 - 20/09");
  assert.equal(saved.weeks[1].sessions[0].title, "Push");

  const missingWeek = await POST(rpc({
    jsonrpc: "2.0", id: "missing-week", method: "tools/call", params: { name: "adjust_training_session", arguments: {
      week: 4, action: "add", sport: "strength", weekday: 0, title: "Push", subtitle: "Séance validée",
      duration_min: 60, intensity: "Modérée", details: ["Échauffement", "Bloc principal"],
    } },
  }, writeToken));
  const failed = await missingWeek.json();
  assert.equal(failed.result.isError, true);
  assert.equal(failed.result.content[0].text, "Semaine introuvable dans le plan");
});

test("training MCP creates and replaces a complete week", async () => {
  resetOAuthStateForTests();
  const writeToken = bearerToken(["read", "write"]);
  const plan = fallbackTrainingPlan({
    sport: "trail", title: "Rolling plan", eventDate: "2026-12-15", startDate: "2026-09-07",
    weeksTotal: 1, level: "intermediaire", daysPerWeek: 3, constraints: "",
  });
  plan.generatedBy = "migration";
  await saveTrainingPlan(plan);
  const call = async (args: Record<string, unknown>) => {
    const response = await POST(rpc({ jsonrpc: "2.0", id: "set-week", method: "tools/call", params: { name: "set_training_week", arguments: args } }, writeToken));
    return response.json();
  };
  const push = {
    sport: "strength", weekday: 0, title: "Push", subtitle: "Séance validée",
    duration_min: 60, intensity: "Modérée", details: ["Échauffement", "Bloc principal"],
  };
  const created = await call({ week: 2, phase: 1, sessions: [push, { ...push, weekday: 2, title: "Pull" }] });
  assert.equal(created.result.content[0].text, "Training week set: 2 (2 sessions)");
  let saved = await loadTrainingPlan();
  assert.equal(saved.objective.weeksTotal, 2);
  assert.equal(saved.weeks[1].dates, "14/09 - 20/09");
  assert.deepEqual(saved.weeks[1].sessions.map((item) => item.title), ["Push", "Pull"]);
  const pushId = saved.weeks[1].sessions[0].id;

  await call({ week: 2, sessions: [push] });
  saved = await loadTrainingPlan();
  assert.equal(saved.weeks[1].sessions.length, 1);
  assert.equal(saved.weeks[1].sessions[0].id, pushId);

  const skipped = await call({ week: 4, sessions: [push] });
  assert.equal(skipped.result.isError, true);
  assert.equal(skipped.result.content[0].text, "Les semaines doivent être créées dans l’ordre");
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
