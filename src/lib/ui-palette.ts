// The macOS-inspired colour schemes offered in Settings. The stable ids keep
// existing preferences valid; their user-facing names and seeds live in
// i18n.ts and globals.css. The picker, startup script and tests share this list.
export const UI_PALETTE_IDS = [
  "default",
  "monokai",
  "dracula",
  "nord",
  "gruvbox",
  "solarized",
  "tokyo-night",
  "catppuccin",
  "one",
] as const;

export type UiPaletteId = (typeof UI_PALETTE_IDS)[number];

export function normalizeUiPalette(value: unknown): UiPaletteId {
  return typeof value === "string" && UI_PALETTE_IDS.includes(value as UiPaletteId)
    ? value as UiPaletteId
    : "default";
}
