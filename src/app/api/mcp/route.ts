import { NextRequest, NextResponse } from "next/server";
import {
  searchNotes,
  readNote,
  listNotes,
  createTask,
  createCapture,
  processInbox,
  createWikiNote,
  noteHref,
  upsertVaultNote,
} from "@/lib/vault";
import { preflight, withCors } from "@/lib/cors";
import { authenticateRequest, type AuthContext } from "@/lib/auth";
import { readRequestText, RequestBodyError } from "@/lib/http-security";
import type { OAuthScope } from "@/lib/oauth-codes";

export const runtime = "nodejs";

const PROTOCOL_VERSION = "2024-11-05";

function ok(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function err(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
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
];

const WRITE_TOOLS = new Set(["capture_insight", "save_daily_chat_digest", "save_wiki_note", "create_task"]);

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
        ? notes.map((n) => `[${n.status}] ${n.title}`).join("\n")
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
    } catch {
      return ok(id, {
        content: [{ type: "text", text: "Tool execution failed." }],
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
