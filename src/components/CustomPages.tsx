"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archiveCustomPageAction, createCustomPageAction } from "@/app/actions";
import type { CustomPage } from "@/lib/vault";
import { useLanguage } from "@/components/LanguageProvider";

export function CustomPagesSettings({ pages }: { pages: CustomPage[] }) {
  const { locale, t } = useLanguage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [archived, setArchived] = useState<Set<string>>(new Set());

  function create(formData: FormData) {
    setError("");
    startTransition(async () => {
      const result = await createCustomPageAction(formData);
      if (result && !result.ok) {
        setError(result.error || t("settings.createError"));
        return;
      }
      router.refresh();
    });
  }

  function archive(slug: string) {
    setError("");
    setArchived((current) => new Set(current).add(slug));
    startTransition(async () => {
      const formData = new FormData();
      formData.set("slug", slug);
      const result = await archiveCustomPageAction(formData);
      if (!result?.ok) {
        setArchived((current) => {
          const next = new Set(current);
          next.delete(slug);
          return next;
        });
        setError(result?.error || t("settings.archiveError"));
        return;
      }
      router.refresh();
    });
  }

  const visible = pages.filter((page) => page.status !== "archived" && !archived.has(page.slug));

  return (
    <div className="custom-pages-settings">
      <form
        className="form compact-form"
        action={(formData) => create(formData)}
      >
        <label>
          {t("settings.pageName")}
          <input name="title" placeholder={locale === "fr" ? "Projets personnels" : "Personal projects"} required />
        </label>
        <button className="button primary" type="submit" disabled={pending}>
          {pending ? t("settings.creating") : t("settings.newPage")}
        </button>
        {error && <p className="finance-refresh-error">{error}</p>}
      </form>

      {visible.length === 0 ? (
        <p className="muted">{t("settings.noCustomPages")}</p>
      ) : (
        <ul className="feed-list">
          {visible.map((page) => (
            <li className="feed-row" key={page.slug}>
              <Link href={`/p/${page.slug}`} className="feed-title">
                {page.icon ? <span className="nf" aria-hidden>{page.icon}</span> : null} {page.title}
              </Link>
              <button
                type="button"
                className="button secondary"
                disabled={pending}
                onClick={() => archive(page.slug)}
              >
                {t("settings.archive")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
