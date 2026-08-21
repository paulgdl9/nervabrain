import { NextRequest, NextResponse } from "next/server";
import { createObjective, createRawNote, createTask, deleteNote, emptyTrash, FileWriteConflictError, moveNote, purgeNote, renameNote, restoreNote, setWikiChecklistState, updateNote } from "@/lib/vault";
import { authenticateRequestAsync, unauthorizedResponse } from "@/lib/auth";
import { bodyErrorResponse, readJsonObject } from "@/lib/http-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!await authenticateRequestAsync(request, { scope: "write", allowSameOrigin: true, allowCaptureHeader: true })) return unauthorizedResponse();
  let body: Record<string, unknown>;
  try { body = await readJsonObject(request, 2 * 1024 * 1024); } catch (error) { return bodyErrorResponse(error); }

  if (body.action === "create") {
    const note = await createRawNote({
      title: typeof body.title === "string" ? body.title : undefined,
      body: typeof body.content === "string" ? body.content : "",
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    });
    return NextResponse.json({ ok: true, note });
  }

  if (body.action === "create-objective") {
    const note = await createObjective({
      title: typeof body.title === "string" && body.title.trim() ? body.title : "New objective",
      area: typeof body.area === "string" ? body.area : "",
      priority: typeof body.priority === "string" ? body.priority : "medium",
      horizon: typeof body.horizon === "string" ? body.horizon : "",
    });
    return NextResponse.json({ ok: true, note });
  }

  if (body.action === "create-task") {
    const note = await createTask({
      title: typeof body.title === "string" && body.title.trim() ? body.title : "New task",
      area: typeof body.area === "string" ? body.area : "",
      priority: typeof body.priority === "string" ? body.priority : "medium",
      why: typeof body.content === "string" ? body.content : "",
    });
    return NextResponse.json({ ok: true, note });
  }

  if (body.action === "update") {
    if (typeof body.path !== "string") {
      return NextResponse.json({ ok: false, error: "path is required" }, { status: 400 });
    }

    try {
      const note = await updateNote({
        relativePath: body.path,
        title: typeof body.title === "string" && body.title.trim() ? body.title : "Untitled",
        status: typeof body.status === "string" ? body.status : "active",
        area: typeof body.area === "string" ? body.area : "",
        priority: typeof body.priority === "string" ? body.priority : "",
        horizon: typeof body.horizon === "string" ? body.horizon : "",
        order: typeof body.order === "number" ? body.order : undefined,
        tags: Array.isArray(body.tags) ? body.tags.slice(0, 100).map(String) : [],
        content: typeof body.content === "string" ? body.content : "",
        expectedMtime: typeof body.expectedMtime === "string" ? body.expectedMtime : undefined,
      });
      return NextResponse.json({ ok: true, note });
    } catch (error) {
      if (error instanceof FileWriteConflictError) {
        return NextResponse.json({ ok: false, error: "note was modified elsewhere", actualMtime: error.actualMtime }, { status: 409 });
      }
      throw error;
    }
  }

  if (body.action === "set-wiki-checklist") {
    if (typeof body.path !== "string" || !Number.isInteger(body.index) || typeof body.checked !== "boolean" || typeof body.expectedMtime !== "string") {
      return NextResponse.json({ ok: false, error: "path, index, checked and expectedMtime are required" }, { status: 400 });
    }
    try {
      const note = await setWikiChecklistState({
        relativePath: body.path,
        index: body.index as number,
        checked: body.checked,
        expectedMtime: body.expectedMtime,
      });
      return NextResponse.json({ ok: true, note });
    } catch (error) {
      if (error instanceof FileWriteConflictError) {
        return NextResponse.json({ ok: false, error: "note was modified elsewhere", actualMtime: error.actualMtime }, { status: 409 });
      }
      throw error;
    }
  }

  if (body.action === "delete") {
    if (typeof body.path !== "string") {
      return NextResponse.json({ ok: false, error: "path is required" }, { status: 400 });
    }
    await deleteNote(body.path);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "move") {
    if (typeof body.path !== "string" || typeof body.folder !== "string") {
      return NextResponse.json({ ok: false, error: "path and folder are required" }, { status: 400 });
    }
    const note = await moveNote(body.path, body.folder);
    return NextResponse.json({ ok: true, note });
  }

  if (body.action === "rename") {
    if (typeof body.path !== "string" || typeof body.filename !== "string") {
      return NextResponse.json({ ok: false, error: "path and filename are required" }, { status: 400 });
    }
    try {
      const note = await renameNote(body.path, body.filename);
      return NextResponse.json({ ok: true, note });
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "rename failed" }, { status: 409 });
    }
  }

  if (body.action === "restore") {
    if (typeof body.path !== "string") {
      return NextResponse.json({ ok: false, error: "path is required" }, { status: 400 });
    }
    const restored = await restoreNote(body.path);
    return NextResponse.json({ ok: true, path: restored });
  }

  if (body.action === "purge") {
    if (typeof body.path !== "string") {
      return NextResponse.json({ ok: false, error: "path is required" }, { status: 400 });
    }
    await purgeNote(body.path);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "empty-trash") {
    const count = await emptyTrash();
    return NextResponse.json({ ok: true, count });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
