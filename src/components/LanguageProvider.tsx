"use client";

import { createContext, useContext, useMemo, useState } from "react";
// Read the app-router context directly instead of useRouter(): useRouter()
// throws when no router is mounted (static test renders via renderToStaticMarkup),
// whereas this returns null and we simply skip the refresh there.
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { saveUiPreferenceAction } from "@/app/actions";
import {
  dictionary,
  LOCALE_COOKIE,
  type Locale,
  type TranslationKey,
} from "@/lib/i18n";

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
  valueLabel: (value: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState(initialLocale);
  const router = useContext(AppRouterContext);

  const value = useMemo<LanguageContextValue>(() => ({
    locale,
    setLocale(nextLocale) {
      setLocaleState(nextLocale);
      document.documentElement.lang = nextLocale;
      document.cookie = `${LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
      // Also persist server-side (vault setup state + a server-set cookie):
      // Safari ITP caps a client-set cookie to ~7 days, so the client copy
      // alone doesn't survive. getLocale() falls back to the vault copy.
      void saveUiPreferenceAction({ locale: nextLocale }).catch(() => undefined);
      // Server components also read the locale cookie. A soft refresh
      // re-renders them with the new locale without a full page reload.
      router?.refresh();
    },
    t: (key) => dictionary(locale)[key],
    valueLabel: (rawValue) => {
      const keyByValue: Partial<Record<string, TranslationKey>> = {
        high: "value.high", medium: "value.medium", low: "value.low",
        todo: "value.todo", doing: "value.doing", done: "value.done", completed: "value.completed", cancelled: "value.cancelled", canceled: "value.cancelled", archived: "value.archived",
        active: "value.active", achieved: "value.achieved", paused: "value.paused", waiting: "value.waiting", abandoned: "value.abandoned",
      };
      const key = keyByValue[rawValue.toLowerCase()];
      return key ? dictionary(locale)[key] : rawValue;
    },
  }), [locale, router]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
