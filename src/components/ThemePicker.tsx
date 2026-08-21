"use client";

import { useEffect, useState } from "react";
import { saveUiPreferenceAction } from "@/app/actions";
import { useLanguage } from "@/components/LanguageProvider";
import { UI_PALETTE_IDS, normalizeUiPalette, type UiPaletteId } from "@/lib/ui-palette";

// Local cache only; the vault-backed setup state (written via
// saveUiPreferenceAction) is the source of truth applied server-side in
// layout.tsx. Kept for instant same-tab feedback.
const THEME_STORAGE_KEY = "second-brain:theme";
// Must stay in sync with ACCENT_INIT_SCRIPT in src/app/layout.tsx.
const ACCENT_STORAGE_KEY = "second-brain:accent";
// Must stay in sync with SURFACE_INIT_SCRIPT in src/app/layout.tsx.
const SURFACE_STORAGE_KEY = "second-brain:surface-style";
// Must stay in sync with PALETTE_INIT_SCRIPT in src/app/layout.tsx.
const PALETTE_STORAGE_KEY = "second-brain:palette";
// Fallback only for server render / environments without a document; the
// real default comes from the active theme's --accent (see readComputedAccent).
const FALLBACK_ACCENT = "#ffffff";
const ACCENT_PROPERTIES = [
  "--accent",
  "--accent-rgb",
  "--accent-soft",
  "--domain-accent",
  "--blue",
  "--dash-accent",
  "--dash-accent-rgb",
] as const;

const THEMES = [{ id: "dark" }, { id: "light" }] as const;

type ThemeId = (typeof THEMES)[number]["id"];
type SurfaceStyle = "transparent" | "opaque";

function applyTheme(theme: ThemeId) {
  if (theme === "dark") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

function readActiveTheme(): ThemeId {
  if (typeof document === "undefined") return "dark";
  const current = document.documentElement.getAttribute("data-theme") as ThemeId | null;
  return current && THEMES.some((theme) => theme.id === current) ? current : "dark";
}

export function ThemePicker() {
  const { t } = useLanguage();
  // Lazy-initialized from the DOM: layout.tsx renders <html data-theme> from
  // the vault setup state directly in the server HTML, so by the time this
  // client component hydrates that attribute already holds the real value.
  // The server render of *this* component always starts from "dark" (no
  // `document` in Node), which can briefly mismatch the client's first paint
  // for a non-default theme — suppressHydrationWarning below covers that
  // expected, self-correcting diff.
  const [active, setActive] = useState<ThemeId>(readActiveTheme);

  useEffect(() => {
    // React preserves the server-rendered state while hydrating. Re-read the
    // attribute set by the server so the selected card always matches the
    // theme that is actually visible.
    queueMicrotask(() => setActive(readActiveTheme()));
  }, []);

  function selectTheme(theme: ThemeId) {
    setActive(theme);
    applyTheme(theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // localStorage unavailable (private mode, etc.) — theme still applies for this session.
    }
    void saveUiPreferenceAction({ theme }).catch(() => undefined);
  }

  return (
    <div className="theme-picker" role="radiogroup" aria-label={t("theme.label")}>
      {THEMES.map((theme) => (
        <button
          key={theme.id}
          type="button"
          className={`button theme-picker-option ${active === theme.id ? "primary" : "secondary"}`}
          role="radio"
          aria-checked={active === theme.id}
          onClick={() => selectTheme(theme.id)}
          suppressHydrationWarning
        >
          <span className={`theme-swatch theme-swatch-${theme.id}`} aria-hidden="true" />
          <span>
            {/* Keyed off the id: a two-branch ternary labelled the third theme
                "Clair", so the picker listed the same name twice. */}
            <strong>{t(`theme.${theme.id}`)}</strong>
            <small>{t(`theme.${theme.id}Description`)}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function applySurfaceStyle(style: SurfaceStyle) {
  if (style === "transparent") {
    document.documentElement.removeAttribute("data-surfaces");
  } else {
    document.documentElement.setAttribute("data-surfaces", "opaque");
  }
}

function readSurfaceStyle(): SurfaceStyle {
  // Opaque is the default, so the server markup carries the attribute and only
  // an explicit opt-in removes it.
  if (typeof document === "undefined") return "opaque";
  return document.documentElement.getAttribute("data-surfaces") === "opaque" ? "opaque" : "transparent";
}

export function SurfacePicker() {
  const { t } = useLanguage();
  const [active, setActive] = useState<SurfaceStyle>(readSurfaceStyle);
  const styles: SurfaceStyle[] = ["transparent", "opaque"];

  useEffect(() => {
    queueMicrotask(() => setActive(readSurfaceStyle()));
  }, []);

  function selectSurface(style: SurfaceStyle) {
    setActive(style);
    applySurfaceStyle(style);
    try {
      window.localStorage.setItem(SURFACE_STORAGE_KEY, style);
    } catch {
      // localStorage unavailable — the choice still applies for this session.
    }
  }

  return (
    <div className="theme-picker surface-picker" role="radiogroup" aria-label={t("surface.label")}>
      {styles.map((style) => (
        <button
          key={style}
          type="button"
          className={`button theme-picker-option ${active === style ? "primary" : "secondary"}`}
          role="radio"
          aria-checked={active === style}
          onClick={() => selectSurface(style)}
          suppressHydrationWarning
        >
          <span className={`surface-swatch surface-swatch-${style}`} aria-hidden="true">
            <i />
          </span>
          <span>
            <strong>{t(style === "transparent" ? "surface.transparent" : "surface.opaque")}</strong>
            <small>{t(style === "transparent" ? "surface.transparentDescription" : "surface.opaqueDescription")}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

// A scheme is a macOS-inspired colour range declared in globals.css under
// [data-palette="<id>"]: background, surfaces, text levels, hairlines, the
// accent family and the --chart-* ramp, in a dark and a light variant. The
// default scheme is the absence of the attribute, so it needs no block.
function applyPalette(palette: UiPaletteId) {
  if (palette === "default") {
    document.documentElement.removeAttribute("data-palette");
  } else {
    document.documentElement.setAttribute("data-palette", palette);
  }
}

function readPalette(): UiPaletteId {
  if (typeof document === "undefined") return "default";
  return normalizeUiPalette(document.documentElement.getAttribute("data-palette"));
}

export function PalettePicker() {
  const { t } = useLanguage();
  const [active, setActive] = useState<UiPaletteId>(readPalette);

  useEffect(() => {
    queueMicrotask(() => setActive(readPalette()));
  }, []);

  function selectPalette(palette: UiPaletteId) {
    setActive(palette);
    applyPalette(palette);
    try {
      window.localStorage.setItem(PALETTE_STORAGE_KEY, palette);
    } catch {
      // localStorage unavailable — the palette still applies for this session.
    }
  }

  return (
    <div className="theme-picker palette-picker" role="radiogroup" aria-label={t("palette.label")}>
      {UI_PALETTE_IDS.map((palette) => (
        <button
          key={palette}
          type="button"
          className={`button theme-picker-option ${active === palette ? "primary" : "secondary"}`}
          role="radio"
          aria-checked={active === palette}
          onClick={() => selectPalette(palette)}
          suppressHydrationWarning
        >
          {/* The swatch carries the palette's own variable block (see
              globals.css), so the preview can never drift from what the
              palette actually applies. */}
          <span className={`palette-swatch palette-swatch-${palette}`} aria-hidden="true">
            <i /><i /><i /><i />
          </span>
          <span>
            <strong>{t(`palette.${palette}`)}</strong>
          </span>
        </button>
      ))}
    </div>
  );
}

function hexToRgbTriplet(hex: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

function applyAccent(hex: string) {
  const rgb = hexToRgbTriplet(hex);
  if (!rgb) return;
  const root = document.documentElement.style;
  root.setProperty("--accent", hex);
  root.setProperty("--accent-rgb", rgb);
  root.setProperty("--accent-soft", `rgba(${rgb}, 0.14)`);
  root.setProperty("--domain-accent", hex);
  root.setProperty("--blue", hex);
  root.setProperty("--dash-accent", hex);
  root.setProperty("--dash-accent-rgb", rgb);
}

function resetAccent() {
  const root = document.documentElement.style;
  for (const prop of ACCENT_PROPERTIES) {
    root.removeProperty(prop);
  }
}

function readStoredAccent(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACCENT_STORAGE_KEY);
  } catch {
    return null;
  }
}

// The default (unset) accent isn't a fixed color — it's whatever the active
// theme currently resolves --accent to (near-white in dark, systemBlue in
// light). Read it from the live DOM instead of a hardcoded hex so the color
// input's swatch always shows the color that's actually in effect.
function readComputedAccent(): string {
  if (typeof document === "undefined") return FALLBACK_ACCENT;
  const value = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : FALLBACK_ACCENT;
}

export function AccentPicker() {
  const { t } = useLanguage();
  // Same lazy-from-storage pattern as ThemePicker: the inline script in
  // layout.tsx already applied a persisted accent (if any) before hydration.
  const [accent, setAccent] = useState<string>(() => readStoredAccent() ?? readComputedAccent());
  const [hasCustomAccent, setHasCustomAccent] = useState<boolean>(() => readStoredAccent() !== null);

  // Keep the swatch in sync with theme switches while no custom accent is
  // set — otherwise picking Light/Dark in ThemePicker wouldn't visibly move
  // this swatch even though --accent changed underneath it.
  useEffect(() => {
    if (hasCustomAccent) return;
    const sync = () => setAccent(readComputedAccent());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette"] });
    return () => observer.disconnect();
  }, [hasCustomAccent]);

  function selectAccent(hex: string) {
    setAccent(hex);
    setHasCustomAccent(true);
    applyAccent(hex);
    try {
      window.localStorage.setItem(ACCENT_STORAGE_KEY, hex);
    } catch {
      // localStorage unavailable — accent still applies for this session.
    }
  }

  function resetToDefault() {
    setHasCustomAccent(false);
    resetAccent();
    setAccent(readComputedAccent());
    try {
      window.localStorage.removeItem(ACCENT_STORAGE_KEY);
    } catch {
      // localStorage unavailable — nothing persisted to clear.
    }
  }

  return (
    <div className="accent-picker">
      <div className="accent-picker-row">
        <label className="accent-picker-swatch">
          <input
            type="color"
            value={accent}
            onChange={(event) => selectAccent(event.target.value)}
            aria-label={t("theme.accentAria")}
            suppressHydrationWarning
          />
          <span>
            <strong>{t("theme.accent")}</strong>
            <small>{t("theme.accentDescription")}</small>
          </span>
        </label>
        {hasCustomAccent ? (
          <button type="button" className="button secondary accent-picker-reset" onClick={resetToDefault}>
            {t("theme.reset")}
          </button>
        ) : null}
      </div>
      <p className="accent-picker-hint muted">
        {t("theme.accentHint")}
      </p>
    </div>
  );
}
