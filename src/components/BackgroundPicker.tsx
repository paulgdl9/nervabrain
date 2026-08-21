"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import type { BackgroundSettings } from "@/lib/background";

// Must stay in sync with BG_INIT_SCRIPT in src/app/layout.tsx.
const IMAGE_KEY = "second-brain:bg-image";
const OPACITY_KEY = "second-brain:bg-opacity";
const BLUR_KEY = "second-brain:bg-blur";
// Legacy localStorage keys are kept only to migrate existing wallpapers into
// the vault-backed persistent storage on the next visit to Settings.
const MAX_INPUT_BYTES = 30 * 1024 * 1024; // 30 MB raw file, before compression
const MAX_STORED_BYTES = 1.5 * 1024 * 1024; // target size of the final data URL
const MAX_DIMENSION = 2560; // longest edge — plenty for a blurred desktop wallpaper
const DEFAULT_OPACITY = 30; // percent
const DEFAULT_BLUR = 0; // px — the frosted-glass look comes from the cards, not this

// Downscales and re-encodes an image client-side so it fits comfortably under
// MAX_STORED_BYTES regardless of the original file's resolution or format,
// so the user never has to compress photos by hand before importing one.
async function compressImage(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("image decode failed"));
      image.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    let quality = 0.85;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > MAX_STORED_BYTES && quality > 0.4) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    if (dataUrl.length > MAX_STORED_BYTES) {
      // Still too big at the lowest acceptable quality: shrink dimensions
      // further rather than degrade quality past the point of looking broken.
      canvas.width = Math.round(canvas.width * 0.75);
      canvas.height = Math.round(canvas.height * 0.75);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function applyBackground(dataUrl: string | null, opacityPercent: number, blurPx: number) {
  const style = document.documentElement.style;
  if (dataUrl) {
    style.setProperty("--app-bg-image", `url("${dataUrl}")`);
    style.setProperty("--app-bg-opacity", String(opacityPercent / 100));
    style.setProperty("--app-bg-blur", `${blurPx}px`);
  } else {
    style.removeProperty("--app-bg-image");
    style.removeProperty("--app-bg-opacity");
    style.removeProperty("--app-bg-blur");
  }
}

function imageUrl(version: string) {
  return `/api/background?v=${encodeURIComponent(version)}`;
}

async function dataUrlBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.blob();
}

export function BackgroundPicker({ initial }: { initial: BackgroundSettings }) {
  const { t } = useLanguage();
  const [image, setImage] = useState<string | null>(() => initial.hasImage ? imageUrl(initial.version) : null);
  const [opacity, setOpacity] = useState<number>(initial.opacity);
  const [blur, setBlur] = useState<number>(initial.blur);
  const [error, setError] = useState("");
  const [compressing, setCompressing] = useState(false);

  async function uploadBlob(blob: Blob, nextOpacity: number, nextBlur: number) {
    const response = await fetch(`/api/background?opacity=${nextOpacity}&blur=${nextBlur}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    });
    if (!response.ok) throw new Error("upload failed");
    const result = await response.json() as { settings?: BackgroundSettings };
    if (!result.settings?.hasImage) throw new Error("upload failed");
    return result.settings;
  }

  // Migrate the previous browser-only wallpaper once. New uploads are written
  // directly into the persistent vault and no longer depend on localStorage.
  useEffect(() => {
    if (initial.hasImage) {
      localStorage.removeItem(IMAGE_KEY);
      localStorage.removeItem(OPACITY_KEY);
      localStorage.removeItem(BLUR_KEY);
      return;
    }
    try {
      const storedImage = localStorage.getItem(IMAGE_KEY);
      if (!storedImage) return;
      const storedOpacity = localStorage.getItem(OPACITY_KEY);
      const storedBlur = localStorage.getItem(BLUR_KEY);
      const nextOpacity = storedOpacity ? Number(storedOpacity) : DEFAULT_OPACITY;
      const nextBlur = storedBlur ? Number(storedBlur) : DEFAULT_BLUR;
      const safeOpacity = Number.isFinite(nextOpacity) ? nextOpacity : DEFAULT_OPACITY;
      const safeBlur = Number.isFinite(nextBlur) ? nextBlur : DEFAULT_BLUR;
      queueMicrotask(() => {
        setImage(storedImage);
        setOpacity(safeOpacity);
        setBlur(safeBlur);
      });
      applyBackground(storedImage, safeOpacity, safeBlur);
      void dataUrlBlob(storedImage)
        .then((blob) => uploadBlob(blob, safeOpacity, safeBlur))
        .then((settings) => {
          const persistedUrl = imageUrl(settings.version);
          setImage(persistedUrl);
          applyBackground(persistedUrl, settings.opacity, settings.blur);
          localStorage.removeItem(IMAGE_KEY);
          localStorage.removeItem(OPACITY_KEY);
          localStorage.removeItem(BLUR_KEY);
        })
        .catch(() => setError(t("bg.errorStore")));
    } catch {
      // localStorage unavailable
    }
  // The migration is intentionally tied to the server snapshot received when
  // this settings page was rendered.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.hasImage]);

  useEffect(() => {
    if (!image?.startsWith("/api/background")) return;
    const timer = window.setTimeout(() => {
      void fetch("/api/background", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opacity, blur }),
      }).then((response) => {
        if (!response.ok) setError(t("bg.errorStore"));
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [blur, image, opacity, t]);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/")) {
      setError(t("bg.errorType"));
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      setError(t("bg.errorSize"));
      return;
    }
    setCompressing(true);
    try {
      const dataUrl = await compressImage(file);
      const settings = await uploadBlob(await dataUrlBlob(dataUrl), opacity, blur);
      const persistedUrl = imageUrl(settings.version);
      setImage(persistedUrl);
      applyBackground(persistedUrl, settings.opacity, settings.blur);
    } catch {
      setError(t("bg.errorStore"));
    } finally {
      setCompressing(false);
    }
  }

  function changeOpacity(value: number) {
    setOpacity(value);
    if (image) applyBackground(image, value, blur);
  }

  function changeBlur(value: number) {
    setBlur(value);
    if (image) applyBackground(image, opacity, value);
  }

  async function remove() {
    setError("");
    try {
      const response = await fetch("/api/background", { method: "DELETE" });
      if (!response.ok) throw new Error("delete failed");
      localStorage.removeItem(IMAGE_KEY);
      localStorage.removeItem(OPACITY_KEY);
      localStorage.removeItem(BLUR_KEY);
      setImage(null);
      applyBackground(null, opacity, blur);
    } catch {
      setError(t("bg.errorStore"));
    }
  }

  return (
    <div className="bg-picker">
      <div className="accent-picker-row">
        <div className="accent-picker-swatch">
          <span>
            <strong>{t("bg.title")}</strong>
            <small>{t("bg.hint")}</small>
          </span>
        </div>
      </div>
      <div className="bg-picker-controls">
        <label className={`button secondary bg-picker-import${compressing ? " is-busy" : ""}`}>
          <input type="file" accept="image/*" onChange={onFile} hidden disabled={compressing} />
          {compressing ? t("bg.compressing") : image ? t("bg.change") : t("bg.import")}
        </label>
        {image ? (
          <button type="button" className="button secondary" onClick={() => void remove()} disabled={compressing}>
            {t("bg.remove")}
          </button>
        ) : null}
      </div>
      {image ? (
        <>
          <div
            className="bg-picker-preview"
            style={{ backgroundImage: `url("${image}")` }}
            aria-hidden
          />
          <label className="bg-picker-opacity">
            <span>
              {t("bg.opacity")} · {opacity}%
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={opacity}
              onChange={(event) => changeOpacity(Number(event.target.value))}
            />
          </label>
          <label className="bg-picker-opacity">
            <span>
              {t("bg.wallpaperBlur")} · {blur}px
            </span>
            <input
              type="range"
              min={0}
              max={40}
              step={1}
              value={blur}
              onChange={(event) => changeBlur(Number(event.target.value))}
            />
          </label>
        </>
      ) : null}
      {error ? <p className="bg-picker-error">{error}</p> : null}
    </div>
  );
}
