"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  BanknoteArrowDown,
  CalendarClock,
  Check,
  CircleDollarSign,
  FileText,
  Gauge,
  Mail,
  Plus,
  ReceiptText,
  Target,
  Trash2,
  TrendingUp,
  UserRoundPlus,
  UsersRound,
  X,
} from "lucide-react";
import {
  createBusinessInvoiceAction,
  createBusinessProspectAction,
  deleteBusinessRecordAction,
  saveBusinessSettingsAction,
  updateBusinessInvoiceStatusAction,
  updateBusinessProspectStageAction,
} from "@/app/actions";
import { CustomSelect } from "@/components/CustomSelect";
import { DatePicker } from "@/components/DatePicker";
import { MetricCards } from "@/components/ui/Analytics";
import { useLanguage } from "@/components/LanguageProvider";
import { formatBusinessMoney, matchesBusinessCurrency, matchesBusinessSearch } from "@/lib/business-view";
import type { TranslationKey } from "@/lib/i18n";
import type { BusinessSettings, BusinessStage, VaultNote } from "@/lib/vault";

type Tab = "overview" | "prospects" | "sales" | "invoices" | "followups" | "insights";
type Modal = "prospect" | "invoice" | null;
type ActionResult = { ok: boolean; error?: string };

type Prospect = {
  path: string;
  company: string;
  contactName: string;
  email: string;
  source: string;
  value: number;
  currency: string;
  stage: BusinessStage;
  probability: number;
  nextAction: string;
  nextActionDate: string;
};

type Invoice = {
  path: string;
  number: string;
  client: string;
  email: string;
  amount: number;
  currency: string;
  issueDate: string;
  dueDate: string;
  paidAt: string;
  status: "draft" | "sent" | "paid";
};

const STAGES: BusinessStage[] = ["lead", "contacted", "qualified", "proposal", "won", "lost"];
const ACTIVE_STAGES = new Set<BusinessStage>(["lead", "contacted", "qualified", "proposal"]);

function stringValue(value: unknown) {
  return value === undefined || value === null ? "" : String(value);
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function prospectFromNote(note: VaultNote): Prospect | null {
  if (stringValue(note.data.record_type) !== "prospect") return null;
  const stage = STAGES.includes(stringValue(note.data.stage) as BusinessStage)
    ? stringValue(note.data.stage) as BusinessStage
    : "lead";
  return {
    path: note.relativePath,
    company: stringValue(note.data.company) || note.title,
    contactName: stringValue(note.data.contact_name),
    email: stringValue(note.data.email),
    source: stringValue(note.data.source),
    value: numberValue(note.data.value),
    currency: stringValue(note.data.currency) || "EUR",
    stage,
    probability: Math.max(0, Math.min(100, numberValue(note.data.probability))),
    nextAction: stringValue(note.data.next_action),
    nextActionDate: stringValue(note.data.next_action_date),
  };
}

function invoiceFromNote(note: VaultNote): Invoice | null {
  if (stringValue(note.data.record_type) !== "invoice") return null;
  const status = stringValue(note.data.status);
  return {
    path: note.relativePath,
    number: stringValue(note.data.invoice_number),
    client: stringValue(note.data.client) || note.title,
    email: stringValue(note.data.client_email),
    amount: numberValue(note.data.amount),
    currency: stringValue(note.data.currency) || "EUR",
    issueDate: stringValue(note.data.issue_date),
    dueDate: stringValue(note.data.due_date),
    paidAt: stringValue(note.data.paid_at),
    status: status === "paid" || status === "sent" ? status : "draft",
  };
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayDiff(from: string, to: string) {
  const start = new Date(`${from.slice(0, 10)}T12:00:00Z`).getTime();
  const end = new Date(`${to.slice(0, 10)}T12:00:00Z`).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 86_400_000)) : 0;
}

function BusinessModal({ kind, currency, today, onClose }: { kind: Exclude<Modal, null>; currency: string; today: string; onClose: () => void }) {
  const { locale, t } = useLanguage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [stage, setStage] = useState("lead");
  const [invoiceStatus, setInvoiceStatus] = useState("draft");
  const [nextActionDate, setNextActionDate] = useState("");
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(addDays(today, 30));
  const stageOptions = STAGES.map((value) => ({ value, label: t(`business.stage.${value}` as TranslationKey) }));
  const invoiceStatusOptions = ["draft", "sent", "paid"].map((value) => ({ value, label: t(`business.invoice.${value}` as TranslationKey) }));

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector(".business-dialog .custom-select.is-open")) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result: ActionResult = kind === "prospect"
        ? await createBusinessProspectAction(data)
        : await createBusinessInvoiceAction(data);
      if (!result.ok) {
        setError(result.error || t("business.error.save"));
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <div className="business-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="business-dialog" role="dialog" aria-modal="true" aria-labelledby={`business-${kind}-title`} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="eyebrow">{t(kind === "prospect" ? "business.prospect.eyebrow" : "business.invoice.eyebrow")}</span>
            <h2 id={`business-${kind}-title`}>{t(kind === "prospect" ? "business.prospect.new" : "business.invoice.new")}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button>
        </header>
        <form className="business-form" onSubmit={submit}>
          <input name="currency" type="hidden" value={currency} />
          {kind === "prospect" ? (
            <>
              <div className="business-form-grid">
                <label>{t("business.field.company")}<input name="company" autoFocus placeholder={t("business.placeholder.company")} /></label>
                <label>{t("business.field.contact")}<input name="contactName" placeholder={t("business.placeholder.contact")} /></label>
                <label>{t("business.field.email")}<input name="email" type="email" placeholder="contact@example.com" /></label>
                <label>{t("business.field.source")}<input name="source" placeholder={t("business.placeholder.source")} /></label>
                <label>{t("business.field.value")} ({currency})<input name="value" inputMode="decimal" min="0" step="0.01" type="number" placeholder="0" /></label>
                <label>{t("business.field.stage")}<CustomSelect name="stage" options={stageOptions} value={stage} onChange={setStage} /></label>
                <label>{t("business.field.probability")}<input name="probability" type="number" min="0" max="100" defaultValue="20" /></label>
              </div>
              <label>{t("business.field.nextAction")}<input name="nextAction" placeholder={t("business.placeholder.nextAction")} /></label>
              <label>{t("business.field.nextActionDate")}<DatePicker name="nextActionDate" value={nextActionDate} onChange={setNextActionDate} locale={locale} placeholder={t("business.placeholder.date")} /></label>
              <label>{t("business.field.notes")}<textarea name="notes" rows={3} placeholder={t("business.placeholder.notes")} /></label>
            </>
          ) : (
            <>
              <div className="business-form-grid">
                <label>{t("business.field.invoiceNumber")}<input name="number" placeholder={t("business.placeholder.invoiceNumber")} /></label>
                <label>{t("business.field.client")}<input name="client" autoFocus required placeholder={t("business.placeholder.client")} /></label>
                <label>{t("business.field.email")}<input name="email" type="email" placeholder="client@example.com" /></label>
                <label>{t("business.field.amount")} ({currency})<input name="amount" inputMode="decimal" min="0" step="0.01" required type="number" placeholder="0" /></label>
                <label>{t("business.field.invoiceStatus")}<CustomSelect name="status" options={invoiceStatusOptions} value={invoiceStatus} onChange={setInvoiceStatus} /></label>
                <label>{t("business.field.issueDate")}<DatePicker name="issueDate" value={issueDate} onChange={setIssueDate} locale={locale} placeholder={t("business.placeholder.date")} /></label>
                <label>{t("business.field.dueDate")}<DatePicker name="dueDate" value={dueDate} onChange={setDueDate} locale={locale} min={issueDate} placeholder={t("business.placeholder.date")} /></label>
              </div>
              <label>{t("business.field.notes")}<textarea name="notes" rows={3} placeholder={t("business.placeholder.invoiceNotes")} /></label>
            </>
          )}
          {error ? <p className="business-form-error" role="alert">{error}</p> : null}
          <footer>
            <button className="button secondary" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="button primary" type="submit" disabled={pending}>{pending ? t("business.saving") : t("business.save")}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function RevenueChart({ points, currency }: { points: Array<{ month: string; value: number }>; currency: string }) {
  const { locale, t } = useLanguage();
  const format = (value: number, compact = false) => formatBusinessMoney(value, currency, locale, compact);
  return (
    <section className="business-chart-section">
      <header><div><span className="eyebrow">{t("business.revenue.eyebrow")}</span><h2>{t("business.revenue.title")}</h2></div><span>{t("business.revenue.period")}</span></header>
      <div className="business-revenue-chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
            <defs><linearGradient id="business-revenue-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--dash-accent)" stopOpacity=".28" /><stop offset="1" stopColor="var(--dash-accent)" stopOpacity="0" /></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="var(--line-soft)" strokeDasharray="3 7" />
            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 10 }} tickFormatter={(value) => format(Number(value), true)} width={58} />
            <Tooltip cursor={{ stroke: "var(--dash-accent)", strokeDasharray: "4 4" }} content={({ active, payload, label }) => active && payload?.[0] ? <div className="business-chart-tooltip"><span>{label}</span><strong>{format(Number(payload[0].value))}</strong></div> : null} />
            <Area type="monotone" dataKey="value" stroke="var(--dash-accent)" strokeWidth={2.5} fill="url(#business-revenue-fill)" activeDot={{ r: 5, fill: "var(--dash-accent)", stroke: "var(--bg)", strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function BusinessWorkspace({ records, settings, today }: { records: VaultNote[]; settings: BusinessSettings; today: string }) {
  const { locale, t } = useLanguage();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [modal, setModal] = useState<Modal>(null);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState("");
  const modalTrigger = useRef<HTMLElement | null>(null);
  const prospects = useMemo(() => records.map(prospectFromNote).filter((item): item is Prospect => Boolean(item)), [records]);
  const invoices = useMemo(() => records.map(invoiceFromNote).filter((item): item is Invoice => Boolean(item)), [records]);
  const configuredProspects = prospects.filter((prospect) => matchesBusinessCurrency(prospect.currency, settings.currency));
  const configuredInvoices = invoices.filter((invoice) => matchesBusinessCurrency(invoice.currency, settings.currency));
  const excludedCurrencies = [...new Set([...prospects, ...invoices]
    .filter((record) => !matchesBusinessCurrency(record.currency, settings.currency))
    .map((record) => record.currency))].sort();
  const excludedCurrencyCount = prospects.length + invoices.length - configuredProspects.length - configuredInvoices.length;
  const currentMonth = today.slice(0, 7);
  const money = (value: number, currency = settings.currency, compact = false) => formatBusinessMoney(value, currency, locale, compact);
  const dateLabel = (date: string) => date ? new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`)) : t("business.noDate");
  const stageLabel = (stage: BusinessStage) => t(`business.stage.${stage}` as TranslationKey);
  const invoiceStatus = (invoice: Invoice) => invoice.status === "sent" && invoice.dueDate && invoice.dueDate < today ? "overdue" : invoice.status;
  const paidThisMonth = configuredInvoices.filter((invoice) => invoice.status === "paid" && (invoice.paidAt || invoice.issueDate).slice(0, 7) === currentMonth).reduce((sum, invoice) => sum + invoice.amount, 0);
  const outstandingInvoices = configuredInvoices.filter((invoice) => invoice.status === "sent");
  const outstanding = outstandingInvoices.reduce((sum, invoice) => sum + invoice.amount, 0);
  const activeProspects = prospects.filter((prospect) => ACTIVE_STAGES.has(prospect.stage));
  const configuredActiveProspects = configuredProspects.filter((prospect) => ACTIVE_STAGES.has(prospect.stage));
  const weightedPipeline = configuredActiveProspects.reduce((sum, prospect) => sum + prospect.value * prospect.probability / 100, 0);
  const won = prospects.filter((prospect) => prospect.stage === "won");
  const configuredWon = configuredProspects.filter((prospect) => prospect.stage === "won");
  const lost = prospects.filter((prospect) => prospect.stage === "lost");
  const conversion = won.length + lost.length ? won.length / (won.length + lost.length) * 100 : 0;
  const averageDeal = configuredWon.length ? configuredWon.reduce((sum, prospect) => sum + prospect.value, 0) / configuredWon.length : 0;
  const paidInvoices = invoices.filter((invoice) => invoice.status === "paid" && invoice.issueDate && invoice.paidAt);
  const averagePaymentDays = paidInvoices.length ? paidInvoices.reduce((sum, invoice) => sum + dayDiff(invoice.issueDate, invoice.paidAt), 0) / paidInvoices.length : 0;
  const followups = [
    ...activeProspects.filter((prospect) => prospect.nextActionDate).map((prospect) => ({
      id: prospect.path,
      kind: "prospect" as const,
      title: prospect.company,
      detail: prospect.nextAction || t("business.followup.contact"),
      date: prospect.nextActionDate,
      email: prospect.email,
    })),
    ...invoices.filter((invoice) => invoice.status === "sent" && invoice.dueDate).map((invoice) => ({
      id: invoice.path,
      kind: "invoice" as const,
      title: invoice.client,
      detail: `${invoice.number} · ${money(invoice.amount, invoice.currency)}`,
      date: invoice.dueDate,
      email: invoice.email,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const dueNow = followups.filter((item) => item.date <= today);
  const filteredProspects = prospects.filter((prospect) => matchesBusinessSearch(`${prospect.company} ${prospect.contactName} ${prospect.email} ${prospect.source}`, query));
  const revenuePoints = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(`${currentMonth}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - (5 - index));
    const key = monthKey(date);
    return {
      key,
      month: new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en", { month: "short" }).format(date),
      value: configuredInvoices.filter((invoice) => invoice.status === "paid" && (invoice.paidAt || invoice.issueDate).slice(0, 7) === key).reduce((sum, invoice) => sum + invoice.amount, 0),
    };
  });
  const goalProgress = settings.monthlyRevenueGoal ? Math.min(100, paidThisMonth / settings.monthlyRevenueGoal * 100) : 0;

  const tabs: Array<{ value: Tab; label: string; icon: React.ReactNode; count?: number }> = [
    { value: "overview", label: t("business.tab.overview"), icon: <Gauge size={16} /> },
    { value: "prospects", label: t("business.tab.prospects"), icon: <UsersRound size={16} />, count: prospects.length },
    { value: "sales", label: t("business.tab.sales"), icon: <TrendingUp size={16} /> },
    { value: "invoices", label: t("business.tab.invoices"), icon: <ReceiptText size={16} />, count: invoices.length },
    { value: "followups", label: t("business.tab.followups"), icon: <CalendarClock size={16} />, count: dueNow.length },
    { value: "insights", label: t("business.tab.insights"), icon: <Target size={16} /> },
  ];

  function updateStage(path: string, stage: string) {
    const data = new FormData();
    data.set("path", path);
    data.set("stage", stage);
    setActionError("");
    startTransition(async () => {
      const result = await updateBusinessProspectStageAction(data);
      if (!result.ok) setActionError(result.error || t("business.error.update"));
      else router.refresh();
    });
  }

  function updateInvoice(path: string, status: string) {
    const data = new FormData();
    data.set("path", path);
    data.set("status", status);
    setActionError("");
    startTransition(async () => {
      const result = await updateBusinessInvoiceStatusAction(data);
      if (!result.ok) setActionError(result.error || t("business.error.update"));
      else router.refresh();
    });
  }

  function openModal(kind: Exclude<Modal, null>) {
    modalTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setModal(kind);
  }

  function closeModal() {
    setModal(null);
    window.requestAnimationFrame(() => modalTrigger.current?.focus());
  }

  function deleteRecord(path: string, title: string) {
    if (!window.confirm(t("business.delete.confirm").replace("{title}", title))) return;
    const data = new FormData();
    data.set("path", path);
    setActionError("");
    startTransition(async () => {
      const result = await deleteBusinessRecordAction(data);
      if (!result.ok) setActionError(result.error || t("business.error.update"));
      else router.refresh();
    });
  }

  function saveGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setActionError("");
    startTransition(async () => {
      const result = await saveBusinessSettingsAction(data);
      if (!result.ok) setActionError(result.error || t("business.error.update"));
      else router.refresh();
    });
  }

  return (
    <div className="business-workspace">
      <header className="business-hero">
        <div>
          <p className="eyebrow">{t("business.eyebrow")}</p>
          <h1>{t("business.title")}</h1>
          <p>{t("business.description")}</p>
        </div>
        <div className="business-hero-actions">
          <button className="button secondary" type="button" onClick={() => openModal("prospect")}><UserRoundPlus size={16} />{t("business.addProspect")}</button>
          <button className="button primary" type="button" onClick={() => openModal("invoice")}><Plus size={16} />{t("business.addInvoice")}</button>
        </div>
      </header>

      <nav className="business-tabs" aria-label={t("business.tabsLabel")}>
        {tabs.map((item) => <button type="button" key={item.value} className={tab === item.value ? "is-active" : ""} aria-current={tab === item.value ? "page" : undefined} onClick={() => setTab(item.value)}>{item.icon}<span>{item.label}</span>{item.count ? <b>{item.count}</b> : null}</button>)}
      </nav>

      {actionError ? <p className="business-action-error" role="alert">{actionError}</p> : null}
      {excludedCurrencyCount ? <p className="business-currency-notice" role="status">{t("business.currency.excluded").replace("{count}", String(excludedCurrencyCount)).replace("{currencies}", excludedCurrencies.join(", ")).replace("{currency}", settings.currency)}</p> : null}

      {tab === "overview" ? (
        <div className="business-tab-content">
          <MetricCards className="business-metrics" viewLabel={t("common.view")} items={[
            { label: t("business.metric.revenue"), value: money(paidThisMonth), detail: settings.monthlyRevenueGoal ? t("business.metric.goalDetail").replace("{goal}", money(settings.monthlyRevenueGoal)) : t("business.metric.noGoal"), tone: "positive", icon: <CircleDollarSign size={15} />, series: revenuePoints.map((point) => point.value) },
            { label: t("business.metric.pipeline"), value: money(weightedPipeline, settings.currency, true), detail: t("business.metric.pipelineDetail").replace("{count}", String(configuredActiveProspects.length)), tone: "accent", icon: <TrendingUp size={15} /> },
            { label: t("business.metric.outstanding"), value: money(outstanding, settings.currency, true), detail: t("business.metric.outstandingDetail").replace("{count}", String(outstandingInvoices.length)), tone: "warning", icon: <BanknoteArrowDown size={15} /> },
            { label: t("business.metric.followups"), value: dueNow.length, detail: t("business.metric.followupsDetail"), tone: dueNow.length ? "negative" : "neutral", icon: <CalendarClock size={15} /> },
          ]} />
          <div className="business-overview-grid">
            <RevenueChart points={revenuePoints} currency={settings.currency} />
            <section className="business-action-queue">
              <header><div><span className="eyebrow">{t("business.today.eyebrow")}</span><h2>{t("business.today.title")}</h2></div><button type="button" onClick={() => setTab("followups")}>{t("business.seeAll")}<ArrowRight size={14} /></button></header>
              {dueNow.length ? <div>{dueNow.slice(0, 5).map((item) => <article key={item.id}><span className={`business-kind is-${item.kind}`}>{item.kind === "prospect" ? <UsersRound size={14} /> : <FileText size={14} />}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div><time>{dateLabel(item.date)}</time></article>)}</div> : <div className="business-empty-compact"><Check size={20} /><strong>{t("business.today.empty")}</strong><span>{t("business.today.emptyDetail")}</span></div>}
            </section>
          </div>
          <section className="business-pipeline-strip">
            <header><div><span className="eyebrow">{t("business.pipeline.eyebrow")}</span><h2>{t("business.pipeline.title")}</h2></div><button type="button" onClick={() => setTab("sales")}>{t("business.openPipeline")}<ArrowRight size={14} /></button></header>
            <div>{STAGES.slice(0, 5).map((stage) => { const items = prospects.filter((prospect) => prospect.stage === stage); return <article key={stage}><span>{stageLabel(stage)}</span><strong>{items.length}</strong><small>{money(items.filter((item) => matchesBusinessCurrency(item.currency, settings.currency)).reduce((sum, item) => sum + item.value, 0), settings.currency, true)}</small></article>; })}</div>
          </section>
        </div>
      ) : null}

      {tab === "prospects" ? (
        <section className="business-list-section">
          <header><div><span className="eyebrow">{t("business.prospects.eyebrow")}</span><h2>{t("business.prospects.title")}</h2><p>{t("business.prospects.description")}</p></div><button className="button primary" type="button" onClick={() => openModal("prospect")}><Plus size={15} />{t("business.addProspect")}</button></header>
          <div className="business-list-toolbar"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("business.prospects.search")} /><span>{t("business.prospects.count").replace("{count}", String(filteredProspects.length))}</span></div>
          {filteredProspects.length ? <div className="business-table-wrap"><table className="business-table"><thead><tr><th>{t("business.column.prospect")}</th><th>{t("business.column.stage")}</th><th>{t("business.column.value")}</th><th>{t("business.column.nextAction")}</th><th>{t("business.column.actions")}</th></tr></thead><tbody>{filteredProspects.map((prospect) => <tr key={prospect.path}><td><strong>{prospect.company}</strong><span>{[prospect.contactName, prospect.email, prospect.source].filter(Boolean).join(" · ") || t("business.noContact")}</span></td><td><CustomSelect name={`stage-${prospect.path}`} options={STAGES.map((stage) => ({ value: stage, label: stageLabel(stage) }))} value={prospect.stage} onChange={(stage) => updateStage(prospect.path, stage)} disabled={pending} /></td><td><strong>{money(prospect.value, prospect.currency)}</strong><span>{prospect.probability}%</span></td><td><strong>{prospect.nextAction || t("business.noNextAction")}</strong><span className={prospect.nextActionDate && prospect.nextActionDate <= today ? "is-overdue" : ""}>{dateLabel(prospect.nextActionDate)}</span></td><td><button className="mini-link mini-danger" type="button" disabled={pending} onClick={() => deleteRecord(prospect.path, prospect.company)}><Trash2 size={13} />{t("trash.delete")}</button></td></tr>)}</tbody></table></div> : <div className="business-empty"><UsersRound size={28} /><h3>{t("business.prospects.empty")}</h3><p>{t("business.prospects.emptyDetail")}</p><button className="button primary" type="button" onClick={() => openModal("prospect")}><Plus size={15} />{t("business.addProspect")}</button></div>}
        </section>
      ) : null}

      {tab === "sales" ? (
        <section className="business-sales-section">
          <header><div><span className="eyebrow">{t("business.sales.eyebrow")}</span><h2>{t("business.sales.title")}</h2><p>{t("business.sales.description")}</p></div><strong>{money(configuredActiveProspects.reduce((sum, prospect) => sum + prospect.value, 0), settings.currency, true)} <small>{t("business.sales.total")}</small></strong></header>
          <div className="business-kanban">{STAGES.map((stage) => { const items = prospects.filter((prospect) => prospect.stage === stage); return <section key={stage} className={`business-kanban-column is-${stage}`}><header><span>{stageLabel(stage)}</span><b>{items.length}</b></header><div>{items.map((prospect) => <article key={prospect.path}><div><strong>{prospect.company}</strong><small>{prospect.contactName || prospect.source || t("business.noContact")}</small></div><b>{money(prospect.value, prospect.currency, true)}</b><footer><span>{prospect.probability}%</span>{prospect.nextActionDate ? <time>{dateLabel(prospect.nextActionDate)}</time> : null}</footer><CustomSelect name={`pipeline-${prospect.path}`} options={STAGES.map((nextStage) => ({ value: nextStage, label: stageLabel(nextStage) }))} value={prospect.stage} onChange={(nextStage) => updateStage(prospect.path, nextStage)} disabled={pending} /></article>)}{!items.length ? <p>{t("business.sales.emptyStage")}</p> : null}</div></section>; })}</div>
        </section>
      ) : null}

      {tab === "invoices" ? (
        <section className="business-list-section">
          <header><div><span className="eyebrow">{t("business.invoices.eyebrow")}</span><h2>{t("business.invoices.title")}</h2><p>{t("business.invoices.description")}</p></div><button className="button primary" type="button" onClick={() => openModal("invoice")}><Plus size={15} />{t("business.addInvoice")}</button></header>
          {invoices.length ? <div className="business-table-wrap"><table className="business-table"><thead><tr><th>{t("business.column.invoice")}</th><th>{t("business.column.client")}</th><th>{t("business.column.amount")}</th><th>{t("business.column.due")}</th><th>{t("business.column.status")}</th><th>{t("business.column.actions")}</th></tr></thead><tbody>{invoices.map((invoice) => { const effective = invoiceStatus(invoice); return <tr key={invoice.path}><td><strong>{invoice.number}</strong><span>{dateLabel(invoice.issueDate)}</span></td><td><strong>{invoice.client}</strong><span>{invoice.email || t("business.noEmail")}</span></td><td><strong>{money(invoice.amount, invoice.currency)}</strong></td><td><strong className={effective === "overdue" ? "is-overdue" : ""}>{dateLabel(invoice.dueDate)}</strong></td><td><span className={`business-status is-${effective}`}>{t(`business.invoice.${effective}` as TranslationKey)}</span><CustomSelect name={`invoice-${invoice.path}`} options={["draft", "sent", "paid"].map((status) => ({ value: status, label: t(`business.invoice.${status}` as TranslationKey) }))} value={invoice.status} onChange={(status) => updateInvoice(invoice.path, status)} disabled={pending} /></td><td><button className="mini-link mini-danger" type="button" disabled={pending} onClick={() => deleteRecord(invoice.path, invoice.number)}><Trash2 size={13} />{t("trash.delete")}</button></td></tr>; })}</tbody></table></div> : <div className="business-empty"><ReceiptText size={28} /><h3>{t("business.invoices.empty")}</h3><p>{t("business.invoices.emptyDetail")}</p><button className="button primary" type="button" onClick={() => openModal("invoice")}><Plus size={15} />{t("business.addInvoice")}</button></div>}
        </section>
      ) : null}

      {tab === "followups" ? (
        <section className="business-followups-section">
          <header><div><span className="eyebrow">{t("business.followups.eyebrow")}</span><h2>{t("business.followups.title")}</h2><p>{t("business.followups.description")}</p></div><strong>{dueNow.length}<small>{t("business.followups.due")}</small></strong></header>
          {followups.length ? <div className="business-followup-list">{followups.map((item) => <article key={`${item.kind}-${item.id}`} className={item.date <= today ? "is-due" : ""}><div className={`business-kind is-${item.kind}`}>{item.kind === "prospect" ? <UsersRound size={16} /> : <ReceiptText size={16} />}</div><div><span>{t(item.kind === "prospect" ? "business.followup.prospect" : "business.followup.invoice")}</span><strong>{item.title}</strong><p>{item.detail}</p></div><time>{dateLabel(item.date)}</time>{item.email ? <a className="button secondary" href={`mailto:${item.email}`}><Mail size={15} />{t("business.followup.write")}</a> : <span className="business-no-email">{t("business.noEmail")}</span>}</article>)}</div> : <div className="business-empty"><Check size={28} /><h3>{t("business.followups.empty")}</h3><p>{t("business.followups.emptyDetail")}</p></div>}
        </section>
      ) : null}

      {tab === "insights" ? (
        <div className="business-insights-grid">
          <section className="business-goal-card">
            <header><span className="eyebrow">{t("business.goal.eyebrow")}</span><h2>{t("business.goal.title")}</h2><p>{t("business.goal.description")}</p></header>
            <div className="business-goal-progress"><strong>{Math.round(goalProgress)}%</strong><span>{money(paidThisMonth)} / {settings.monthlyRevenueGoal ? money(settings.monthlyRevenueGoal) : t("business.goal.notSet")}</span><div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(goalProgress)}><i style={{ width: `${goalProgress}%` }} /></div></div>
            <form onSubmit={saveGoal}><label>{t("business.goal.monthly")}<input name="monthlyRevenueGoal" type="number" min="0" step="100" defaultValue={settings.monthlyRevenueGoal || ""} placeholder="0" /></label><input type="hidden" name="currency" value={settings.currency} /><button className="button primary" type="submit" disabled={pending}>{t("business.goal.save")}</button></form>
          </section>
          <section className="business-health-card">
            <header><span className="eyebrow">{t("business.health.eyebrow")}</span><h2>{t("business.health.title")}</h2></header>
            <div><article><span>{t("business.health.conversion")}</span><strong>{conversion.toFixed(0)}%</strong><small>{won.length} / {won.length + lost.length} {t("business.health.closed")}</small></article><article><span>{t("business.health.averageDeal")}</span><strong>{money(averageDeal, settings.currency, true)}</strong><small>{t("business.health.wonOnly")}</small></article><article><span>{t("business.health.paymentTime")}</span><strong>{averagePaymentDays.toFixed(0)} {t("business.days")}</strong><small>{t("business.health.paidOnly")}</small></article><article><span>{t("business.health.weighted")}</span><strong>{money(weightedPipeline, settings.currency, true)}</strong><small>{t("business.health.weightedDetail")}</small></article></div>
          </section>
          <RevenueChart points={revenuePoints} currency={settings.currency} />
        </div>
      ) : null}

      {modal ? <BusinessModal kind={modal} currency={settings.currency} today={today} onClose={closeModal} /> : null}
    </div>
  );
}
