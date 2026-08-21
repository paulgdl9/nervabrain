import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { LanguageProvider } from "@/components/LanguageProvider";
import { readBackgroundSettings } from "@/lib/background";
import { getLocale } from "@/lib/i18n-server";
import { UI_PALETTE_IDS } from "@/lib/ui-palette";
import { readSetupState } from "@/lib/vault";
import "./globals.css";

export const metadata: Metadata = {
  title: "NervaBrain",
  description: "A local-first AI memory built on a private Markdown vault.",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "NervaBrain",
    statusBarStyle: "black",
  },
};

export const viewport: Viewport = {
  // width/initialScale are the Next defaults, but exporting a viewport object
  // replaces those defaults wholesale — omitting them dropped the
  // width=device-width meta, so phones fell back to a 980px desktop layout and
  // the <=920px responsive rules never matched. Set them explicitly.
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

// Applied to <html style> before hydration to avoid a flash of the default
// accent. Must stay in sync with ACCENT_STORAGE_KEY/applyAccent in ThemePicker.tsx.
const ACCENT_INIT_SCRIPT = `(function(){try{var a=localStorage.getItem("second-brain:accent");if(!a)return;var m=/^#?([0-9a-f]{6})$/i.exec(a.trim());if(!m)return;var v=m[1];var r=parseInt(v.slice(0,2),16),g=parseInt(v.slice(2,4),16),b=parseInt(v.slice(4,6),16);var rgb=r+", "+g+", "+b;var s=document.documentElement.style;s.setProperty("--accent",a);s.setProperty("--accent-rgb",rgb);s.setProperty("--accent-soft","rgba("+rgb+", 0.14)");s.setProperty("--domain-accent",a);s.setProperty("--blue",a);s.setProperty("--dash-accent",a);s.setProperty("--dash-accent-rgb",rgb);}catch(e){}})();`;

// Applied before hydration so every surface switches together without a flash.
// Opaque is the default: the glass surfaces let page content read through
// panels, drawers and modals, which looked like a rendering fault rather than a
// style. Picking "Transparents" in Settings stores the opt-in.
const SURFACE_INIT_SCRIPT = `(function(){try{if(localStorage.getItem("second-brain:surface-style")==="transparent")document.documentElement.removeAttribute("data-surfaces");}catch(e){}})();`;

// Applied before hydration so the whole colour scheme — background included —
// is in place on first paint. The id is checked against the known list rather
// than written through, so a tampered localStorage value cannot set an
// arbitrary attribute.
const PERSISTED_PALETTE_IDS = UI_PALETTE_IDS.filter((palette) => palette !== "default");
const PALETTE_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem("second-brain:palette");if(${JSON.stringify(PERSISTED_PALETTE_IDS)}.indexOf(p)<0)return;document.documentElement.setAttribute("data-palette",p);}catch(e){}})();`;

// Applied before hydration to avoid a flash. Must stay in sync with the keys in
// BackgroundPicker.tsx.
const BACKGROUND_INIT_SCRIPT = `(function(){try{var s=document.documentElement.style;if(s.getPropertyValue("--app-bg-image"))return;var img=localStorage.getItem("second-brain:bg-image");if(!img)return;var op=localStorage.getItem("second-brain:bg-opacity");var o=op?Number(op):30;var bl=localStorage.getItem("second-brain:bg-blur");var b=bl?Number(bl):0;s.setProperty("--app-bg-image",'url("'+img+'")');s.setProperty("--app-bg-opacity",String((isFinite(o)?o:30)/100));s.setProperty("--app-bg-blur",(isFinite(b)?b:0)+"px");}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Both calls are dynamic (cookies() inside getLocale() opts the route out
  // of the full-route cache), so this always reflects the latest vault state.
  const [locale, setup, background] = await Promise.all([getLocale(), readSetupState(), readBackgroundSettings()]);
  const backgroundStyle = background.hasImage ? {
    "--app-bg-image": `url("/api/background?v=${encodeURIComponent(background.version)}")`,
    "--app-bg-opacity": String(background.opacity / 100),
    "--app-bg-blur": `${background.blur}px`,
  } as CSSProperties : undefined;

  return (
    // data-theme is the source of truth, rendered server-side from the vault
    // setup state so a fresh session (no localStorage) still gets the right
    // theme on first paint, before any script runs. "dark" is the implicit
    // default and needs no attribute; see ThemePicker.tsx.
    <html lang={locale} data-theme={setup.theme === "dark" ? undefined : setup.theme} data-surfaces="opaque" style={backgroundStyle} suppressHydrationWarning>
      <head>
        {/* Palette first: it sets the accent family that a custom accent, applied
            as an inline style by the next script, is meant to override. */}
        <script dangerouslySetInnerHTML={{ __html: PALETTE_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: ACCENT_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SURFACE_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: BACKGROUND_INIT_SCRIPT }} />
      </head>
      <body><LanguageProvider initialLocale={locale}>{children}</LanguageProvider></body>
    </html>
  );
}
