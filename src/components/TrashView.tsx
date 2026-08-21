"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2, FileText } from "lucide-react";
import type { TrashItem } from "@/lib/vault";
import { useLanguage } from "@/components/LanguageProvider";

function fmtWhen(value: string, locale: "fr" | "en", today: string, yesterday: string, daysAgo: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Math.round((Date.now() - d.getTime()) / 86_400_000);
  if (diff <= 0) return today;
  if (diff === 1) return yesterday;
  if (diff < 7) return daysAgo.replace("{count}", String(diff));
  return d.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { month: "short", day: "numeric" });
}

export function TrashView({ items }: { items: TrashItem[] }) {
  const router = useRouter();
  const { locale, t } = useLanguage();
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState<TrashItem | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [emptying, setEmptying] = useState(false);

  async function call(action: string, path?: string) {
    await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(path ? { action, path } : { action }),
    });
    router.refresh();
  }

  async function restore(it: TrashItem) {
    setBusy(it.trashPath);
    await call("restore", it.trashPath);
    setBusy("");
  }

  async function purge(it: TrashItem) {
    setBusy(it.trashPath);
    await call("purge", it.trashPath);
    setBusy("");
    setConfirm(null);
  }

  async function empty() {
    setEmptying(true);
    await call("empty-trash");
    setEmptying(false);
    setConfirmEmpty(false);
  }

  if (!items.length) {
    return (
      <section className="card">
        <div className="dash-empty">{t("trash.empty")}</div>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <span className="card-eyebrow">{t("trash.recoverable")}</span>
          <h2>{items.length} {t(items.length > 1 ? "trash.items" : "trash.item")}</h2>
        </div>
        <button type="button" className="button danger" onClick={() => setConfirmEmpty(true)} disabled={emptying}>
          <Trash2 size={14} aria-hidden /> {t("trash.emptyAction")}
        </button>
      </div>

      <ul className="trash-list">
        {items.map((it) => (
          <li className="trash-row" key={it.trashPath}>
            <span className="trash-icon"><FileText size={15} aria-hidden /></span>
            <div className="trash-main">
              <span className="trash-title">{it.title || t("trash.untitled")}</span>
              <span className="trash-meta">{it.kind} · {t("trash.from")} {it.from || "?"} · {fmtWhen(it.trashedAt, locale, t("common.today"), t("common.yesterday"), t("common.daysAgo"))}</span>
            </div>
            <div className="trash-actions">
              <button type="button" className="mini-link" onClick={() => restore(it)} disabled={busy === it.trashPath}>
                <RotateCcw size={13} aria-hidden /> {t("trash.restore")}
              </button>
              <button type="button" className="mini-link mini-danger" onClick={() => setConfirm(it)} disabled={busy === it.trashPath}>
                <Trash2 size={13} aria-hidden /> {t("trash.delete")}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {confirm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setConfirm(null)}>
          <div className="modal-dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-icon"><Trash2 size={18} /></div>
            <h3>{t("trash.deletePermanently")}</h3>
            <p className="muted">{t("trash.confirm").replace("{title}", confirm.title || t("trash.untitled"))}</p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setConfirm(null)}>{t("trash.cancel")}</button>
              <button type="button" className="button danger" onClick={() => purge(confirm)}>{t("trash.deleteForever")}</button>
            </div>
          </div>
        </div>
      )}

      {confirmEmpty && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setConfirmEmpty(false)}>
          <div className="modal-dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-icon"><Trash2 size={18} /></div>
            <h3>{t("trash.emptyAction")}</h3>
            <p className="muted">{t("trash.emptyConfirm").replace("{count}", String(items.length))}</p>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setConfirmEmpty(false)} disabled={emptying}>{t("trash.cancel")}</button>
              <button type="button" className="button danger" onClick={empty} disabled={emptying}>{t("trash.deleteForever")}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
