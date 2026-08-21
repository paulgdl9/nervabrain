"use client";

import {
  createCaptureAction,
  createCustomPageEntryAction,
  createFinancePositionAction,
  createObjectiveAction,
  createRawNoteAction,
  createTaskAction,
  createWikiNoteAction,
  generateDailyBriefAction,
  getDailyBriefJobAction,
  generateWeeklyReviewAction,
  updateNoteAction,
  updateTaskStatusAction,
} from "@/app/actions";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import type { DailyBriefJobState } from "@/lib/daily-brief-job";
import { Bitcoin, Building2, ChartNoAxesCombined, CheckCircle2, Circle, Landmark, Layers3, PiggyBank, Plus, Save, ShieldCheck, Sparkles, WalletCards, XCircle } from "lucide-react";
import { todayISO } from "@/lib/dates";
import type { VaultNote } from "@/lib/vault";
import { useLanguage } from "@/components/LanguageProvider";
import { CustomSelect } from "@/components/CustomSelect";

function editHref(note: Pick<VaultNote, "relativePath">) {
  return "/edit/" + note.relativePath.split("/").map(encodeURIComponent).join("/");
}

const areas = ["Projects", "Work", "Learning", "Health", "Finance", "Personal", "Knowledge"];
const priorities = ["high", "medium", "low"];

function CaptureSubmitButton() {
  const { pending } = useFormStatus();
  const { locale } = useLanguage();
  return (
    <button className="button primary" type="submit" disabled={pending} aria-busy={pending}>
      <span className="nf" aria-hidden><Plus size={14} /></span>
      {pending
        ? (locale === "fr" ? "L’IA classe…" : "AI is sorting…")
        : (locale === "fr" ? "Capturer et classer" : "Capture and sort")}
    </button>
  );
}

export function CaptureForm({ compact = false }: { compact?: boolean }) {
  const { t } = useLanguage();
  return (
    <form action={createCaptureAction} className={compact ? "form compact-form" : "form"}>
      {!compact && <h2>{t("form.capture")}</h2>}
      <label>
        {t("form.title")}
        <input name="title" placeholder={t("form.optional")} />
      </label>
      <label>
        URL
        <input name="url" placeholder="https://..." />
      </label>
      <label>
        {t("form.text")}
        <textarea name="text" rows={compact ? 4 : 8} placeholder={t("form.write")} required />
      </label>
      <CaptureSubmitButton />
    </form>
  );
}

export function ObjectiveForm() {
  const { t, valueLabel } = useLanguage();
  return (
    <form action={createObjectiveAction} className="form">
      <h2>{t("form.objective")}</h2>
      <label>
        {t("form.title")}
        <input name="title" required />
      </label>
      <div className="field-row">
        <label>
          {t("workspace.area")}
          <CustomSelect name="area" defaultValue="Projects" options={areas.map((area) => ({ value: area, label: area }))} />
        </label>
        <label>
          {t("workspace.priority")}
          <CustomSelect name="priority" defaultValue="medium" options={priorities.map((priority) => ({ value: priority, label: valueLabel(priority) }))} />
        </label>
      </div>
      <label>
        {t("workspace.horizon")}
        <input name="horizon" />
      </label>
      <label>
        {t("form.currentState")}
        <textarea name="currentState" rows={3} />
      </label>
      <label>
        {t("form.nextStep")}
        <textarea name="nextStep" rows={3} />
      </label>
      <button className="button primary" type="submit">
        <span className="nf" aria-hidden><Plus size={14} /></span>
        {t("form.addObjective")}
      </button>
    </form>
  );
}

export function TaskForm() {
  const { t, valueLabel } = useLanguage();
  return (
    <form action={createTaskAction} className="form">
      <h2>{t("form.task")}</h2>
      <label>
        {t("form.title")}
        <input name="title" required />
      </label>
      <div className="field-row">
        <label>
          {t("workspace.area")}
          <CustomSelect name="area" defaultValue="Projects" options={areas.map((area) => ({ value: area, label: area }))} />
        </label>
        <label>
          {t("workspace.priority")}
          <CustomSelect name="priority" defaultValue="medium" options={priorities.map((priority) => ({ value: priority, label: valueLabel(priority) }))} />
        </label>
      </div>
      <label>
        {t("form.objective")}
        <input name="objective" placeholder={t("form.exactNoteTitle")} />
      </label>
      <label>
        {t("form.why")}
        <textarea name="why" rows={4} />
      </label>
      <button className="button primary" type="submit">
        <span className="nf" aria-hidden><Plus size={14} /></span>
        {t("form.addTask")}
      </button>
    </form>
  );
}

export function FinanceForm() {
  const { locale, t } = useLanguage();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [assetType, setAssetType] = useState("etf");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const usesMarketPrice = ["etf", "stock", "crypto"].includes(assetType);
  const assetOptions = [
    { value: "etf", label: "ETF", icon: <Layers3 size={15} /> },
    { value: "stock", label: t("finance.asset.stock"), icon: <ChartNoAxesCombined size={15} /> },
    { value: "crypto", label: "Crypto", icon: <Bitcoin size={15} /> },
    { value: "savings", label: t("finance.asset.savings"), icon: <PiggyBank size={15} /> },
    { value: "life_insurance", label: t("finance.asset.lifeInsurance"), icon: <ShieldCheck size={15} /> },
    { value: "real_estate", label: t("finance.asset.realEstate"), icon: <Building2 size={15} /> },
    { value: "bonds", label: t("finance.asset.bonds"), icon: <Landmark size={15} /> },
    { value: "other", label: t("finance.asset.other"), icon: <WalletCards size={15} /> },
  ];
  const currencyOptions = [
    { value: "EUR", label: "EUR", hint: t("finance.currency.eur"), icon: <span className="finance-select-glyph">€</span> },
    { value: "USD", label: "USD", hint: t("finance.currency.usd"), icon: <span className="finance-select-glyph">$</span> },
    { value: "CHF", label: "CHF", hint: t("finance.currency.chf"), icon: <span className="finance-select-glyph">₣</span> },
    { value: "GBP", label: "GBP", hint: t("finance.currency.gbp"), icon: <span className="finance-select-glyph">£</span> },
  ];
  return (
    <form ref={formRef} className="form compact-form finance-form" onSubmit={(event) => {
      event.preventDefault();
      setError("");
      const formData = new FormData(event.currentTarget);
      startTransition(async () => {
        const result = await createFinancePositionAction(formData);
        if (!result?.ok) setError(result?.error || t("finance.addFailed"));
        else {
          formRef.current?.reset();
          setAssetType("etf");
          router.refresh();
        }
      });
    }}>
      <label>
        {t("form.assetName")}
        <input name="title" placeholder={locale === "fr" ? "Apple, Livret A, Bitcoin…" : "Apple, savings account, Bitcoin…"} required />
      </label>
      <div className="field-row">
        <label>
          {t("form.type")}
          <CustomSelect name="assetType" options={assetOptions} value={assetType} onChange={setAssetType} />
        </label>
        <label>
          {t("form.currency")}
          <CustomSelect name="currency" options={currencyOptions} defaultValue="EUR" />
        </label>
      </div>
      <div className="field-row">
        <label>
          {t("form.quantity")}
          <input name="quantity" type="number" step="any" min="0" placeholder="1" required />
        </label>
        {!usesMarketPrice && <label>
          {t("finance.currentUnitValue")}
          <input name="unitPrice" type="number" step="any" min="0" placeholder="0.00" required />
        </label>}
      </div>
      {usesMarketPrice && <label>
        {assetType === "crypto" ? t("form.cryptoId") : t("finance.identifier")}
        <input name="identifier" placeholder={assetType === "crypto" ? "bitcoin, ethereum…" : "FR001400U5Q4, AAPL, WPEA.PA…"} required />
        <small className="field-hint">{assetType === "crypto" ? t("finance.cryptoHint") : t("finance.identifierHint")}</small>
      </label>}
      <label>
        {t("form.note")}
        <textarea name="note" rows={2} placeholder={t("form.optionalDetail")} />
      </label>
      {error && <div className="form-error">{error}</div>}
      <button className="button primary" type="submit" disabled={pending}>
        <span className="nf" aria-hidden></span>
        {pending ? t("finance.connectingPrice") : t("form.addPosition")}
      </button>
    </form>
  );
}

export function CustomPageEntryForm({ slug }: { slug: string }) {
  const { t } = useLanguage();
  return (
    <form action={createCustomPageEntryAction} className="form compact-form">
      <input type="hidden" name="slug" value={slug} />
      <label>
        {t("form.title")}
        <input name="title" required />
      </label>
      <label>
        {t("form.content")}
        <textarea name="body" rows={6} placeholder={t("form.writeNote")} />
      </label>
      <button className="button primary" type="submit">
        <span className="nf" aria-hidden></span>
        {t("form.addEntry")}
      </button>
    </form>
  );
}

export function RawNoteForm({ compact = false }: { compact?: boolean }) {
  const { locale, t } = useLanguage();
  const date = todayISO();

  return (
    <form action={createRawNoteAction} className={compact ? "form dashboard-journal-form" : "form"}>
      {!compact ? <h2>{t("form.note")}</h2> : null}
      {compact
        ? <input name="title" type="hidden" value={`Note ${date}`} />
        : <label>
            {t("form.title")}
            <input name="title" defaultValue={`Note ${date}`} required />
          </label>}
      <label>
        {!compact ? t("form.content") : null}
        <textarea name="content" rows={compact ? 4 : 10} placeholder={compact ? t("dashboard.quickCapturePlaceholder") : t("form.writeNote")} required />
      </label>
      {compact
        ? <input name="tags" type="hidden" value="journal" />
        : <label>
            {t("form.tags")}
            <input name="tags" placeholder={locale === "fr" ? "journal, idée, travail" : "journal, idea, work"} />
          </label>}
      <button className="button primary" type="submit">
        <span className="nf" aria-hidden><Plus size={14} /></span>
        {compact ? t("dashboard.saveCapture") : t("form.addNote")}
      </button>
    </form>
  );
}

export function WikiForm() {
  const { t } = useLanguage();
  return (
    <form action={createWikiNoteAction} className="form">
      <h2>{t("page.wiki.newArticle")}</h2>
      <label>
        {t("form.title")}
        <input name="title" required />
      </label>
      <label>
        {t("form.wikiLearning")}
        <textarea name="summary" rows={3} />
      </label>
      <label>
        {t("form.wikiContent")}
        <textarea name="body" rows={6} />
      </label>
      <label>
        {t("form.tags")}
        <input name="tags" />
      </label>
      <button className="button primary" type="submit">
        <span className="nf" aria-hidden><Plus size={14} /></span>
        {t("form.createDraft")}
      </button>
    </form>
  );
}

export function NoteEditorForm({ note }: { note: VaultNote }) {
  const { locale, t, valueLabel } = useLanguage();
  const statuses = statusOptions(note);

  return (
    <form action={updateNoteAction} className="editor-form">
      <input type="hidden" name="path" value={note.relativePath} />
      <input className="editor-title-input" name="title" defaultValue={note.title} required />
      <div className="editor-properties">
        <label>
          {t("workspace.status")}
          <CustomSelect name="status" defaultValue={note.status || statuses[0]} options={statuses.map((status) => ({ value: status, label: valueLabel(status) }))} />
        </label>
        <label>
          {t("workspace.area")}
          <input name="area" defaultValue={stringField(note.data.area)} placeholder={locale === "fr" ? "Projets" : "Projects"} />
        </label>
        <label>
          {t("workspace.priority")}
          <CustomSelect name="priority" defaultValue={stringField(note.data.priority) || "medium"} options={priorities.map((priority) => ({ value: priority, label: valueLabel(priority) }))} />
        </label>
        <label>
          {t("workspace.horizon")}
          <input name="horizon" defaultValue={stringField(note.data.horizon)} placeholder={locale === "fr" ? "Maintenant, T3…" : "Now, Q3…"} />
        </label>
        <label className="wide-field">
          {t("form.tags")}
          <input name="tags" defaultValue={note.tags.join(", ")} placeholder={locale === "fr" ? "journal, produit, idée" : "journal, product, idea"} />
        </label>
      </div>
      <label>
        {t("form.content")}
        <textarea className="editor-textarea" name="content" defaultValue={note.content} rows={22} required />
      </label>
      <div className="editor-actions">
        <button className="button primary" type="submit">
          <span className="nf" aria-hidden><Save size={14} /></span>
          {t("form.save")}
        </button>
      </div>
    </form>
  );
}

export function GenerateBriefButton() {
  const { locale, t } = useLanguage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [job, setJob] = useState<DailyBriefJobState | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const followedRunningJob = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getDailyBriefJobAction().then((state) => {
      if (cancelled) return;
      if (state.status === "running") followedRunningJob.current = true;
      setJob(state);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (job?.status !== "running") return;
    followedRunningJob.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const next = await getDailyBriefJobAction();
      if (cancelled) return;
      setJob(next);
      if (next.status === "running") {
        timer = setTimeout(poll, 1600);
        return;
      }
      if (followedRunningJob.current) {
        setResult(next.status === "succeeded"
          ? { ok: true, message: locale === "fr" ? `Généré par ${next.generatedBy || "l’IA"}.` : `Generated by ${next.generatedBy || "AI"}.` }
          : { ok: false, message: next.error || (locale === "fr" ? "Génération impossible." : "Generation failed.") });
        followedRunningJob.current = false;
        router.refresh();
      }
    };
    timer = setTimeout(poll, 800);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [job?.status, locale, router]);

  const running = pending || job?.status === "running";
  return (
    <div className="flex max-w-sm flex-col items-end gap-1.5">
      <button className="button primary" type="button" disabled={running} onClick={() => {
        setResult(null);
        startTransition(async () => {
          const response = await generateDailyBriefAction();
          if (!response.ok) return setResult({ ok: false, message: response.error });
          followedRunningJob.current = true;
          setJob(response.state);
        });
      }}>
        <span className="nf" aria-hidden><Sparkles size={14} /></span>
        {running ? (locale === "fr" ? "Génération en arrière-plan…" : "Generating in the background…") : t("form.generateBrief")}
      </button>
      {result ? <small className={`text-right text-xs ${result.ok ? "text-[var(--muted)]" : "text-red-500"}`} role={result.ok ? "status" : "alert"}>{result.message}</small> : null}
    </div>
  );
}

export function GenerateWeeklyReviewButton() {
  const { locale, t } = useLanguage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="flex max-w-sm flex-col items-end gap-1.5">
      <button className="button primary" type="button" disabled={pending} onClick={() => {
        setResult(null);
        startTransition(async () => {
          const response = await generateWeeklyReviewAction();
          if (!response.ok) return setResult({ ok: false, message: response.error });
          setResult({
            ok: !response.coachError,
            message: response.coachError
              ? (locale === "fr" ? `Weekly généré, mais le coach n’a pas répondu : ${response.coachError}` : `Weekly generated, but the coach failed: ${response.coachError}`)
              : (locale === "fr" ? `Synthèse générée par ${response.generatedBy}.` : `Review generated by ${response.generatedBy}.`),
          });
          router.refresh();
        });
      }}>
        <span className="nf" aria-hidden><Sparkles size={14} /></span>
        {pending ? (locale === "fr" ? "L’IA clôture la semaine…" : "AI is closing the week…") : t("form.generateReview")}
      </button>
      {result ? <small className={`text-right text-xs ${result.ok ? "text-[var(--muted)]" : "text-red-500"}`} role={result.ok ? "status" : "alert"}>{result.message}</small> : null}
    </div>
  );
}

export function TaskStatusControls({ note }: { note: VaultNote }) {
  const { t, valueLabel } = useLanguage();
  return (
    <form action={updateTaskStatusAction} className="status-controls">
      <input type="hidden" name="path" value={note.relativePath} />
      <button name="status" value="todo" className="icon-button" title={valueLabel("todo")} type="submit">
        <span className="nf" aria-hidden><Circle size={14} /></span>
      </button>
      <button name="status" value="done" className="icon-button" title={valueLabel("done")} type="submit">
        <span className="nf" aria-hidden><CheckCircle2 size={14} /></span>
      </button>
      <button name="status" value="abandoned" className="icon-button" title={t("form.abandoned")} type="submit">
        <span className="nf" aria-hidden><XCircle size={14} /></span>
      </button>
    </form>
  );
}

export function TaskChecklist({ tasks }: { tasks: VaultNote[] }) {
  const { t, valueLabel } = useLanguage();
  if (!tasks.length) {
    return <div className="dash-empty">{t("form.noOpenTasks")}</div>;
  }
  return (
    <ul className="check-list">
      {tasks.map((note) => {
        const area = stringField(note.data.area);
        const priority = stringField(note.data.priority);
        return (
          <li className="check-row" key={note.id}>
            <form action={updateTaskStatusAction} className="check-toggle">
              <input type="hidden" name="path" value={note.relativePath} />
              <input type="hidden" name="status" value="done" />
              <button type="submit" className="check-box" aria-label={t("form.markDone").replace("{title}", note.title)}>
                <span className="nf check-mark" aria-hidden></span>
              </button>
            </form>
            <Link href={editHref(note)} className="check-title">
              {note.title}
            </Link>
            {priority ? <span className={`check-flag prio-${priority}`}>{valueLabel(priority)}</span> : null}
            {area ? <span className="check-area">{area}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function statusOptions(note: VaultNote) {
  const base = note.kind === "task"
    ? ["todo", "doing", "done", "abandoned"]
    : note.kind === "objective"
      ? ["active", "paused", "achieved", "abandoned"]
      : note.kind === "capture"
        ? ["inbox", "briefed", "processed", "archived"]
        : note.kind === "wiki"
          ? ["draft", "active", "archived"]
          : ["active", "draft", "archived", "imported"];

  return note.status && !base.includes(note.status) ? [note.status, ...base] : base;
}

function stringField(value: unknown) {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}
