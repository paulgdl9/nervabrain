import fs from "node:fs/promises";
import { atomicWriteFile } from "@/lib/atomic-write";
import { resolveVaultPath } from "@/lib/vault";

const IMAGE_FILE = ".second-brain-background.jpg";
const SETTINGS_FILE = ".second-brain-background.json";
const DEFAULT_OPACITY = 30;
const DEFAULT_BLUR = 0;

export type BackgroundSettings = {
  hasImage: boolean;
  opacity: number;
  blur: number;
  version: string;
};

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

export async function readBackgroundSettings(): Promise<BackgroundSettings> {
  const image = await fs.stat(resolveVaultPath(IMAGE_FILE)).catch(() => null);
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(resolveVaultPath(SETTINGS_FILE), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
  } catch {
    // Missing or malformed metadata falls back safely without hiding the image.
  }
  return {
    hasImage: Boolean(image),
    opacity: boundedNumber(stored.opacity, DEFAULT_OPACITY, 0, 100),
    blur: boundedNumber(stored.blur, DEFAULT_BLUR, 0, 40),
    version: image ? String(Math.round(image.mtimeMs)) : "",
  };
}

export async function saveBackgroundImage(bytes: Uint8Array, opacity: unknown, blur: unknown) {
  await atomicWriteFile(resolveVaultPath(IMAGE_FILE), bytes);
  await saveBackgroundAppearance(opacity, blur);
  return readBackgroundSettings();
}

export async function saveBackgroundAppearance(opacity: unknown, blur: unknown) {
  const settings = {
    version: 1,
    opacity: boundedNumber(opacity, DEFAULT_OPACITY, 0, 100),
    blur: boundedNumber(blur, DEFAULT_BLUR, 0, 40),
  };
  await atomicWriteFile(resolveVaultPath(SETTINGS_FILE), `${JSON.stringify(settings, null, 2)}\n`);
  return readBackgroundSettings();
}

export async function removeBackground() {
  await Promise.all([
    fs.unlink(resolveVaultPath(IMAGE_FILE)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    }),
    fs.unlink(resolveVaultPath(SETTINGS_FILE)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    }),
  ]);
}

export function backgroundImagePath() {
  return resolveVaultPath(IMAGE_FILE);
}
