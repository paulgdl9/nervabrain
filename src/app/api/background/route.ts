import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import {
  backgroundImagePath,
  readBackgroundSettings,
  removeBackground,
  saveBackgroundAppearance,
  saveBackgroundImage,
} from "@/lib/background";
import {
  SESSION_COOKIE,
  configuredDashboardPassword,
  verifySessionToken,
} from "@/lib/dashboard-session";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function dashboardSessionIsValid(request: NextRequest) {
  const password = configuredDashboardPassword();
  return !password || verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
}

function dashboardWriteIsValid(request: NextRequest) {
  return dashboardSessionIsValid(request) && request.headers.get("sec-fetch-site") === "same-origin";
}

async function readImageBytes(request: NextRequest) {
  const declared = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw new Error("too-large");
  if (!request.body) throw new Error("invalid-image");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("too-large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    throw new Error("invalid-image");
  }
  return bytes;
}

export async function GET(request: NextRequest) {
  if (!dashboardSessionIsValid(request)) return new NextResponse(null, { status: 401 });
  try {
    const [bytes, settings] = await Promise.all([
      fs.readFile(backgroundImagePath()),
      readBackgroundSettings(),
    ]);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-cache",
        ETag: `"${settings.version}"`,
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

export async function POST(request: NextRequest) {
  if (!dashboardWriteIsValid(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "image/jpeg") {
    return NextResponse.json({ ok: false, error: "image/jpeg required" }, { status: 415 });
  }
  try {
    const bytes = await readImageBytes(request);
    const settings = await saveBackgroundImage(
      bytes,
      request.nextUrl.searchParams.get("opacity"),
      request.nextUrl.searchParams.get("blur"),
    );
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    const status = error instanceof Error && error.message === "too-large" ? 413 : 400;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "upload failed" }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  if (!dashboardWriteIsValid(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as { opacity?: unknown; blur?: unknown };
    const settings = await saveBackgroundAppearance(body.opacity, body.blur);
    return NextResponse.json({ ok: true, settings });
  } catch {
    return NextResponse.json({ ok: false, error: "invalid settings" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!dashboardWriteIsValid(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  await removeBackground();
  return NextResponse.json({ ok: true });
}
