"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { readSetupState, setupPath } from "@/lib/vault";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
  createSessionToken,
  verifyDashboardPassword,
} from "@/lib/dashboard-session";
import { rateLimit } from "@/lib/rate-limit";

// Resolve the client IP behind Cloudflare/proxy for rate-limiting. Mirrors
// rate-limit.ts#clientIp but reads from the server-action headers() bag since
// there is no NextRequest here.
function loginClientIp(bag: Headers): string {
  const cf = bag.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const forwarded = bag.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",", 1)[0]?.trim();
    if (first) return first;
  }
  const realIp = bag.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

function safeRedirectTarget(raw: FormDataEntryValue | null) {
  const value = String(raw || "");
  // Only allow same-app relative paths; refuse protocol-relative or absolute
  // URLs so this can't be turned into an open redirect.
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function loginAction(formData: FormData) {
  const password = String(formData.get("password") || "");
  const from = safeRedirectTarget(formData.get("from"));

  // Throttle DASHBOARD_PASSWORD brute-force attempts, per IP (in-memory,
  // single-instance; see rate-limit.ts). Any attempt — right or wrong —
  // counts, so a locked-out IP must wait out the window.
  const bag = await headers();
  const limited = rateLimit(`login:${loginClientIp(bag)}`, { limit: 8, windowMs: 60_000 });
  if (!limited.ok) {
    redirect(`/login?error=rate&from=${encodeURIComponent(from)}`);
  }

  if (!verifyDashboardPassword(password)) {
    redirect(`/login?error=1&from=${encodeURIComponent(from)}`);
  }

  const token = createSessionToken();
  if (!token) {
    // DASHBOARD_PASSWORD is set but no secret material could be derived
    // (shouldn't happen since the password itself is a valid fallback secret).
    redirect(`/login?error=1&from=${encodeURIComponent(from)}`);
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });

  if (from === "/") {
    const setup = await readSetupState();
    if (setup.status !== "completed") redirect(setupPath(setup.currentStep));
  }
  redirect(from);
}

export async function logoutAction() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
