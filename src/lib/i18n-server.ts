import "server-only";

import { cookies } from "next/headers";
import { dictionary, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { readSetupState } from "@/lib/vault";

// No cookie (first visit, or Safari ITP capped/wiped it) falls back to the
// locale persisted in the vault-backed setup state, so the choice survives
// even when client storage doesn't.
export async function getLocale() {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(value)) return value;
  return (await readSetupState()).locale;
}

export async function getTranslations() {
  return dictionary(await getLocale());
}
