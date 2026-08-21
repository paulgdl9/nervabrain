import { NextRequest, NextResponse } from "next/server";
import { verifyCaptureToken } from "@/lib/auth";
import { readRequestText, RequestBodyError } from "@/lib/http-security";
import { rateLimitRequest } from "@/lib/rate-limit";
import { LOCALE_COOKIE } from "@/lib/i18n";
import {
  getClient,
  issueCode,
  normalizeScopes,
  validateClientRedirect,
} from "@/lib/oauth-codes";

export const runtime = "nodejs";

type Locale = "fr" | "en";

function requestLocale(request: NextRequest): Locale {
  return request.cookies.get(LOCALE_COOKIE)?.value === "en" ? "en" : "fr";
}

function copy(locale: Locale) {
  return locale === "fr" ? {
    title: "Autoriser NervaBrain",
    heading: "Autoriser l’accès",
    request: "demande les droits",
    token: "Token d’accès",
    allow: "Autoriser",
    invalid: "Requête OAuth invalide",
    attempts: "Trop de tentatives",
    retry: "Réessayez dans un instant.",
    wrongToken: "Token incorrect.",
  } : {
    title: "Authorize NervaBrain",
    heading: "Authorize access",
    request: "is requesting the following permissions",
    token: "Access token",
    allow: "Authorize",
    invalid: "Invalid OAuth request",
    attempts: "Too many attempts",
    retry: "Try again in a moment.",
    wrongToken: "Incorrect token.",
  };
}

function validationError(error: string | undefined, locale: Locale) {
  if (!error || locale === "fr") return error ?? copy(locale).invalid;
  return ({
    "client_id inconnu": "Unknown client_id",
    "redirect_uri invalide": "Invalid redirect_uri",
    "response_type invalide": "Invalid response_type",
    "PKCE S256 est obligatoire": "PKCE S256 is required",
    "code_challenge invalide": "Invalid code_challenge",
    "scope invalide": "Invalid scope",
    "state trop long": "State is too long",
  } as Record<string, string>)[error] ?? copy(locale).invalid;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(input: {
  locale: Locale;
  clientName: string;
  clientId: string;
  challenge: string;
  redirectUri: string;
  state: string;
  scope: string;
  error?: string;
}) {
  const text = copy(input.locale);
  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
  return `<!DOCTYPE html>
<html lang="${input.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${text.title}</title><style>
body{font-family:system-ui,sans-serif;max-width:420px;margin:80px auto;padding:0 24px;background:#0f0f0f;color:#e8e8e8}
h2{margin-bottom:8px}p{color:#aaa;font-size:14px;margin-bottom:24px}input[type=password]{width:100%;padding:10px 14px;border-radius:8px;border:1px solid #333;background:#1a1a1a;color:#e8e8e8;font-size:15px;box-sizing:border-box;margin-bottom:16px}button{width:100%;padding:11px;border-radius:8px;border:none;background:#fff;color:#000;font-size:15px;font-weight:600;cursor:pointer}.err{color:#f87171}
</style></head><body><h2>${text.heading}</h2>
<p><strong>${escapeHtml(input.clientName)}</strong> ${text.request} <strong>${escapeHtml(input.scope)}</strong>.</p>
<form method="POST">
${hidden("client_id", input.clientId)}${hidden("code_challenge", input.challenge)}${hidden("redirect_uri", input.redirectUri)}${hidden("state", input.state)}${hidden("scope", input.scope)}
${hidden("response_type", "code")}${hidden("code_challenge_method", "S256")}
${input.error ? `<p class="err">${escapeHtml(input.error)}</p>` : ""}
<input type="password" name="token" placeholder="${text.token}" autofocus autocomplete="current-password" required maxlength="512">
<button type="submit">${text.allow}</button></form></body></html>`;
}

function htmlResponse(html: string, status = 200, extraHeaders?: Record<string, string>, formAction = "'self'") {
  return new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; base-uri 'none'; frame-ancestors 'none'`,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function validateAuthorization(input: Record<string, string>) {
  const client = getClient(input.client_id ?? "");
  const scopes = normalizeScopes(input.scope);
  if (!client) return { error: "client_id inconnu" } as const;
  if (!validateClientRedirect(client.clientId, input.redirect_uri ?? "")) return { error: "redirect_uri invalide" } as const;
  if (input.response_type !== "code") return { error: "response_type invalide" } as const;
  if (input.code_challenge_method !== "S256") return { error: "PKCE S256 est obligatoire" } as const;
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(input.code_challenge ?? "")) return { error: "code_challenge invalide" } as const;
  if (!scopes) return { error: "scope invalide" } as const;
  if ((input.state ?? "").length > 1_024) return { error: "state trop long" } as const;
  return { client, scopes } as const;
}

// Chrome enforces form-action against the *redirect target* of a form
// submission, so the consent page must allow the (already client-validated)
// redirect_uri origin or the 302 back to the OAuth client is silently blocked.
function consentFormAction(redirectUri: string) {
  try {
    return `'self' ${new URL(redirectUri).origin}`;
  } catch {
    return "'self'";
  }
}

export async function GET(request: NextRequest) {
  const locale = requestLocale(request);
  const text = copy(locale);
  const input = Object.fromEntries(request.nextUrl.searchParams);
  const validated = validateAuthorization(input);
  if ("error" in validated) return htmlResponse(`<h1>${text.invalid}</h1><p>${escapeHtml(validationError(validated.error, locale))}</p>`, 400);

  return htmlResponse(page({
    locale,
    clientName: validated.client.clientName,
    clientId: validated.client.clientId,
    challenge: input.code_challenge ?? "",
    redirectUri: input.redirect_uri ?? "",
    state: input.state ?? "",
    scope: validated.scopes.join(" "),
  }), 200, undefined, consentFormAction(input.redirect_uri ?? ""));
}

export async function POST(request: NextRequest) {
  const locale = requestLocale(request);
  const text = copy(locale);
  try {
    // Throttle CAPTURE_TOKEN brute-force attempts, per IP. See rate-limit.ts.
    const limited = rateLimitRequest(request, "authorize", { limit: 8, windowMs: 60_000 });
    if (!limited.ok) {
      return htmlResponse(
        `<h1>${text.attempts}</h1><p>${text.retry}</p>`,
        429,
        { "Retry-After": String(limited.retryAfter) },
      );
    }
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.startsWith("application/x-www-form-urlencoded")) {
      throw new RequestBodyError("content-type invalide", 415);
    }
    const form = new URLSearchParams(await readRequestText(request, 16 * 1024));
    const input = Object.fromEntries(form);
    const validated = validateAuthorization(input);
    if ("error" in validated) return htmlResponse(`<h1>${text.invalid}</h1><p>${escapeHtml(validationError(validated.error, locale))}</p>`, 400);

    if (!verifyCaptureToken(input.token ?? "")) {
      return htmlResponse(page({
        locale,
        clientName: validated.client.clientName,
        clientId: validated.client.clientId,
        challenge: input.code_challenge ?? "",
        redirectUri: input.redirect_uri ?? "",
        state: input.state ?? "",
        scope: validated.scopes.join(" "),
        error: text.wrongToken,
      }), 401, undefined, consentFormAction(input.redirect_uri ?? ""));
    }

    const code = issueCode({
      challenge: input.code_challenge ?? "",
      redirectUri: input.redirect_uri ?? "",
      clientId: input.client_id ?? "",
      scopes: validated.scopes,
    });
    const redirect = new URL(input.redirect_uri ?? "");
    redirect.searchParams.set("code", code);
    if (input.state) redirect.searchParams.set("state", input.state);
    return NextResponse.redirect(redirect, 302);
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return htmlResponse(`<h1>${text.invalid}</h1>`, status);
  }
}
