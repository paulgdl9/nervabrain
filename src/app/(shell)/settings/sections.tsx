import { Bot, LayoutGrid, Palette, ShieldCheck, SquareStack } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The settings screens are driven by this list so the index and the detail
 * route can never disagree about which sections exist, their order, or their
 * wording. Adding a section means adding one entry here plus a case in the
 * detail route's renderer.
 */
export type SettingsSectionId = "appearance" | "modules" | "assistant" | "pages" | "advanced";

export type SettingsSection = {
  id: SettingsSectionId;
  title: TranslationKey;
  description: TranslationKey;
  icon: React.ReactNode;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "appearance", title: "settings.appearance", description: "settings.appearanceDescription", icon: <Palette size={18} /> },
  { id: "modules", title: "settings.modules", description: "settings.modulesDescription", icon: <LayoutGrid size={18} /> },
  { id: "assistant", title: "settings.assistant", description: "settings.assistantDescription", icon: <Bot size={18} /> },
  { id: "pages", title: "settings.customPages", description: "settings.customPagesDescription", icon: <SquareStack size={18} /> },
  { id: "advanced", title: "settings.advanced", description: "settings.advancedDescription", icon: <ShieldCheck size={18} /> },
];

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}
