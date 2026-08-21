"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Brain, LogOut, Menu, Search, Settings, X } from "lucide-react";
import { AppNav, AppUtilityNav, PinnedNav, type CustomPageEntry, type EnabledModules } from "@/components/AppNav";
import { logoutAction } from "@/app/login/actions";
import { useLanguage } from "@/components/LanguageProvider";

const SIDEBAR_COLLAPSED_KEY = "second-brain:sidebar-collapsed";

// The shell mounts once in the (shell) route-group layout, so full-bleed is
// decided per route here instead of per page via props.
const FULL_BLEED_PREFIXES = ["/doc/", "/edit/", "/p/", "/tasks", "/training", "/business", "/revisions"];

export function AppShellChrome({
  children,
  pinnedItems,
  customPages = [],
  modules,
  setupComplete = false,
  authEnabled = false,
}: {
  children: React.ReactNode;
  pinnedItems: { href: string; label: string }[];
  customPages?: CustomPageEntry[];
  modules?: EnabledModules;
  setupComplete?: boolean;
  authEnabled?: boolean;
}) {
  const pathname = usePathname();
  const fullBleed = FULL_BLEED_PREFIXES.some(
    (prefix) => pathname.startsWith(prefix) || pathname === prefix.replace(/\/$/, ""),
  );
  const { t } = useLanguage();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored === "1") queueMicrotask(() => setCollapsed(true));
  }, []);

  // Close the mobile drawer whenever navigation happens.
  useEffect(() => {
    queueMicrotask(() => setMobileNavOpen(false));
  }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle("mobile-nav-open", mobileNavOpen);
    return () => document.body.classList.remove("mobile-nav-open");
  }, [mobileNavOpen]);

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <div className={`app-shell${collapsed ? " is-collapsed" : ""}${mobileNavOpen ? " is-mobile-nav-open" : ""}`}>
      <div className="mobile-topbar">
        <button
          type="button"
          className="mobile-nav-toggle"
          onClick={() => setMobileNavOpen((value) => !value)}
          aria-label={mobileNavOpen ? t("nav.close") : t("nav.open")}
          aria-expanded={mobileNavOpen}
        >
          {mobileNavOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
        </button>
        <span className="mobile-topbar-title">{process.env.NEXT_PUBLIC_APP_NAME || "NervaBrain"}</span>
      </div>
      <div className="sidebar-backdrop" onClick={() => setMobileNavOpen(false)} aria-hidden={!mobileNavOpen} />
      <aside className="sidebar">
        <div className="brand">
          <span className="nf brand-icon" aria-hidden><Brain size={18} /></span>
          <div className="brand-text">
            <strong>{process.env.NEXT_PUBLIC_APP_NAME || "NervaBrain"}</strong>
            <span>{t("app.vault")}</span>
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
            aria-pressed={collapsed}
            title={collapsed ? t("nav.expand") : t("nav.collapse")}
          >
            <span aria-hidden>{collapsed ? "›" : "‹"}</span>
          </button>
          <button
            type="button"
            className="sidebar-close"
            onClick={() => setMobileNavOpen(false)}
            aria-label={t("nav.close")}
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="sidebar-scroll">
          <AppNav customPages={customPages} modules={modules} />
          <PinnedNav items={pinnedItems} />
          <form action="/search" className="side-search">
            <span className="nf nav-icon" aria-hidden><Search size={14} /></span>
            <input name="q" placeholder={t("nav.search")} aria-label={t("nav.search")} />
          </form>
          <AppUtilityNav showSetup={!setupComplete} />
          <Link href="/settings" className="nav-item subtle-link">
            <span className="nf nav-icon" aria-hidden><Settings size={15} /></span>
            <span className="nav-label">{t("nav.settings")}</span>
          </Link>
          {authEnabled ? (
            <form action={logoutAction} className="logout-form">
              <button type="submit" className="nav-item subtle-link">
                <span className="nf nav-icon" aria-hidden><LogOut size={15} /></span>
                <span className="nav-label">{t("nav.logout")}</span>
              </button>
            </form>
          ) : null}
        </div>
      </aside>
      <main className={`main${fullBleed ? " main-full-bleed" : ""}`}>{children}</main>
    </div>
  );
}
