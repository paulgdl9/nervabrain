"use client";

import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

export function ActionDialog({
  title,
  trigger,
  children,
}: {
  title: string;
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button className="button primary" type="button" onClick={() => setOpen(true)}>
        {trigger}
      </button>
      {open && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            aria-labelledby={id}
            aria-modal="true"
            className="dialog"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="dialog-header">
              <h2 id={id}>{title}</h2>
              <button className="icon-button" type="button" onClick={() => setOpen(false)} title={t("common.close")} aria-label={t("common.close")}>
                <X size={16} aria-hidden />
              </button>
            </div>
            {children}
          </section>
        </div>
      )}
    </>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
  danger = false,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
  danger?: boolean;
}) {
  const { locale, t } = useLanguage();
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section aria-labelledby={id} aria-modal="true" className="dialog confirm-dialog" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header"><h2 id={id}>{title}</h2><button className="icon-button" type="button" onClick={onClose} aria-label={t("common.close")}><X size={16} /></button></div>
        <p>{description}</p>
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onClose}>{locale === "fr" ? "Annuler" : "Cancel"}</button>
          <button className={`button${danger ? " danger" : " primary"}`} type="button" onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
