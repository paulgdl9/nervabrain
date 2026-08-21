"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Bitcoin,
  Building2,
  ArrowDown,
  ArrowUp,
  ChartNoAxesCombined,
  ChevronDown,
  CircleDollarSign,
  Landmark,
  Layers3,
  Link2,
  GripVertical,
  Pencil,
  PieChart,
  PiggyBank,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Wallet,
  WalletCards,
  X,
} from "lucide-react";
import type { VaultNote, MonthlyBudgetConfig, FinanceHistoryPoint } from "@/lib/vault";
import {
  connectFinancePositionAction,
  deleteFinancePositionAction,
  refreshAllFinancePositionPricesAction,
  refreshFinancePositionPriceAction,
  reorderFinancePositionsAction,
  updateFinancePositionAction,
  updateMonthlyBudgetAction,
} from "@/app/actions";
import { useLanguage } from "@/components/LanguageProvider";
import { CustomSelect } from "@/components/CustomSelect";
import { DayOfMonthPicker } from "@/components/DayOfMonthPicker";
import { ConfirmDialog } from "@/components/ActionDialog";
import { MetricCards, type MetricTone } from "@/components/ui/Analytics";
import { FinanceMetricChart, type FinanceMetricPoint } from "@/components/ui/FinanceMetricChart";
import { DonutRing, useDonutSelection } from "@/components/ui/DonutChart";
import { budgetCategoryColor, prepareBudgetCategories, type BudgetCategoryItem } from "@/lib/budget-categories";
import type { TranslationKey } from "@/lib/i18n";

type Translate = (key: TranslationKey) => string;

function translated(t: Translate, key: TranslationKey, values: Record<string, string | number> = {}) {
  return Object.entries(values).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), t(key));
}

// Asset types are categorical: the shared --chart-* ramp from globals.css, the
// same tokens .finance-type-* paints its dots with, so the legend, the dots and
// the charts always agree — and a colour scheme repaints all three at once.
const TYPE_COLORS: Record<string, string> = {
  etf: "var(--chart-1)",
  stock: "var(--chart-4)",
  crypto: "var(--chart-3)",
  savings: "var(--chart-2)",
  life_insurance: "var(--chart-5)",
  real_estate: "var(--chart-6)",
  bonds: "var(--chart-7)",
  other: "var(--muted)",
};

const ASSET_ICONS = {
  etf: Layers3,
  stock: ChartNoAxesCombined,
  crypto: Bitcoin,
  savings: PiggyBank,
  life_insurance: ShieldCheck,
  real_estate: Building2,
  bonds: Landmark,
  other: WalletCards,
};

type SubscriptionFrequency = "monthly" | "yearly";
type SubscriptionDecision = "keep" | "reduce" | "cut";
type SubscriptionCategory =
  | "ai"
  | "banking"
  | "cloud"
  | "dating"
  | "energy"
  | "fitness"
  | "gaming"
  | "mobility"
  | "news"
  | "productivity"
  | "security"
  | "shopping"
  | "streaming"
  | "telecom"
  | "other";

type BudgetSubscription = {
  id: string;
  service: string;
  usage: string;
  category: SubscriptionCategory;
  domain: string;
  price: string;
  frequency: SubscriptionFrequency;
  nextDate: string;
  payment: string;
  decision: SubscriptionDecision;
};

type BudgetItem = {
  id: string;
  label: string;
  category: string;
  price: string;
  frequency: SubscriptionFrequency;
};

type MonthlyBudget = {
  month: string;
  income: string;
  fixedItems: BudgetItem[];
  variableItems: BudgetItem[];
  savingsTarget: string;
  subscriptions: BudgetSubscription[];
};

const DEFAULT_BUDGET: MonthlyBudget = {
  month: new Date().toISOString().slice(0, 7),
  income: "",
  fixedItems: [],
  variableItems: [],
  savingsTarget: "",
  subscriptions: [],
};

const EMPTY_SUBSCRIPTION: Omit<BudgetSubscription, "id"> = {
  service: "",
  usage: "",
  category: "other",
  domain: "",
  price: "",
  frequency: "monthly",
  nextDate: "",
  payment: "",
  decision: "keep",
};

const EMPTY_BUDGET_ITEM: Omit<BudgetItem, "id"> = {
  label: "",
  category: "other",
  price: "",
  frequency: "monthly",
};

const FIXED_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "housing", label: "Logement" },
  { key: "insurance", label: "Assurance" },
  { key: "credit", label: "Crédit" },
  { key: "health", label: "Santé" },
  { key: "transport", label: "Transport" },
  { key: "taxes", label: "Impôts" },
  { key: "other", label: "Autre" },
];

const VARIABLE_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "food", label: "Alimentation" },
  { key: "transport", label: "Transport" },
  { key: "leisure", label: "Sorties & loisirs" },
  { key: "shopping", label: "Shopping" },
  { key: "health", label: "Santé" },
  { key: "other", label: "Autre" },
];

const FIXED_CATEGORY_LABELS = Object.fromEntries(FIXED_CATEGORIES.map((category) => [category.key, category.label]));
const VARIABLE_CATEGORY_LABELS = Object.fromEntries(VARIABLE_CATEGORIES.map((category) => [category.key, category.label]));

type PopularSubscription = Omit<BudgetSubscription, "id" | "price" | "nextDate" | "payment" | "decision">;

const SUBSCRIPTION_CATEGORIES: Array<{ key: SubscriptionCategory; label: string }> = [
  { key: "ai", label: "IA" },
  { key: "cloud", label: "Cloud & stores" },
  { key: "productivity", label: "Productivité" },
  { key: "streaming", label: "Streaming" },
  { key: "telecom", label: "Télécom" },
  { key: "energy", label: "Énergie" },
  { key: "mobility", label: "Mobilité" },
  { key: "banking", label: "Banque & finance" },
  { key: "security", label: "Sécurité" },
  { key: "fitness", label: "Sport" },
  { key: "dating", label: "Dating" },
  { key: "shopping", label: "Shopping" },
  { key: "gaming", label: "Gaming" },
  { key: "news", label: "Presse" },
  { key: "other", label: "Autre" },
];

const CATEGORY_LABELS = Object.fromEntries(SUBSCRIPTION_CATEGORIES.map((category) => [category.key, category.label])) as Record<SubscriptionCategory, string>;

const POPULAR_SUBSCRIPTIONS: PopularSubscription[] = [
  { service: "ChatGPT", usage: "IA", category: "ai", domain: "openai.com", frequency: "monthly" },
  { service: "Claude", usage: "IA", category: "ai", domain: "anthropic.com", frequency: "monthly" },
  { service: "Cursor", usage: "Code IA", category: "ai", domain: "cursor.com", frequency: "monthly" },
  { service: "Perplexity", usage: "Recherche IA", category: "ai", domain: "perplexity.ai", frequency: "monthly" },
  { service: "Apple iCloud", usage: "Stockage", category: "cloud", domain: "icloud.com", frequency: "monthly" },
  { service: "Google One", usage: "Stockage", category: "cloud", domain: "one.google.com", frequency: "monthly" },
  { service: "Microsoft 365", usage: "Office + cloud", category: "cloud", domain: "microsoft.com", frequency: "monthly" },
  { service: "Dropbox", usage: "Stockage", category: "cloud", domain: "dropbox.com", frequency: "monthly" },
  { service: "Notion", usage: "Notes", category: "productivity", domain: "notion.so", frequency: "monthly" },
  { service: "GitHub", usage: "Dev", category: "productivity", domain: "github.com", frequency: "monthly" },
  { service: "Figma", usage: "Design", category: "productivity", domain: "figma.com", frequency: "monthly" },
  { service: "Canva", usage: "Design", category: "productivity", domain: "canva.com", frequency: "monthly" },
  { service: "Netflix", usage: "Streaming", category: "streaming", domain: "netflix.com", frequency: "monthly" },
  { service: "Spotify", usage: "Musique", category: "streaming", domain: "spotify.com", frequency: "monthly" },
  { service: "YouTube Premium", usage: "Vidéo", category: "streaming", domain: "youtube.com", frequency: "monthly" },
  { service: "Disney+", usage: "Streaming", category: "streaming", domain: "disneyplus.com", frequency: "monthly" },
  { service: "Amazon Prime", usage: "Shopping + vidéo", category: "shopping", domain: "amazon.fr", frequency: "yearly" },
  { service: "Canal+", usage: "TV", category: "streaming", domain: "canalplus.com", frequency: "monthly" },
  { service: "Crunchyroll", usage: "Anime", category: "streaming", domain: "crunchyroll.com", frequency: "monthly" },
  { service: "Free", usage: "Mobile / internet", category: "telecom", domain: "free.fr", frequency: "monthly" },
  { service: "Orange", usage: "Mobile / internet", category: "telecom", domain: "orange.fr", frequency: "monthly" },
  { service: "SFR", usage: "Mobile / internet", category: "telecom", domain: "sfr.fr", frequency: "monthly" },
  { service: "Bouygues Telecom", usage: "Mobile / internet", category: "telecom", domain: "bouyguestelecom.fr", frequency: "monthly" },
  { service: "EDF", usage: "Électricité", category: "energy", domain: "edf.fr", frequency: "monthly" },
  { service: "Engie", usage: "Énergie", category: "energy", domain: "engie.fr", frequency: "monthly" },
  { service: "TotalEnergies", usage: "Énergie", category: "energy", domain: "totalenergies.fr", frequency: "monthly" },
  { service: "Uber One", usage: "Mobilité", category: "mobility", domain: "uber.com", frequency: "monthly" },
  { service: "Bolt", usage: "Mobilité", category: "mobility", domain: "bolt.eu", frequency: "monthly" },
  { service: "SNCF Connect", usage: "Transport", category: "mobility", domain: "sncf-connect.com", frequency: "yearly" },
  { service: "Revolut", usage: "Banque", category: "banking", domain: "revolut.com", frequency: "monthly" },
  { service: "N26", usage: "Banque", category: "banking", domain: "n26.com", frequency: "monthly" },
  { service: "BoursoBank", usage: "Banque", category: "banking", domain: "boursobank.com", frequency: "monthly" },
  { service: "Trade Republic", usage: "Investissement", category: "banking", domain: "traderepublic.com", frequency: "monthly" },
  { service: "NordVPN", usage: "VPN", category: "security", domain: "nordvpn.com", frequency: "yearly" },
  { service: "Proton", usage: "Mail / VPN", category: "security", domain: "proton.me", frequency: "monthly" },
  { service: "1Password", usage: "Mots de passe", category: "security", domain: "1password.com", frequency: "monthly" },
  { service: "Tinder", usage: "Dating", category: "dating", domain: "tinder.com", frequency: "monthly" },
  { service: "Bumble", usage: "Dating", category: "dating", domain: "bumble.com", frequency: "monthly" },
  { service: "Hinge", usage: "Dating", category: "dating", domain: "hinge.co", frequency: "monthly" },
  { service: "Zwift", usage: "Cyclisme", category: "fitness", domain: "zwift.com", frequency: "monthly" },
  { service: "Strava", usage: "Sport", category: "fitness", domain: "strava.com", frequency: "yearly" },
  { service: "Garmin", usage: "Sport", category: "fitness", domain: "garmin.com", frequency: "monthly" },
  { service: "Basic-Fit", usage: "Salle de sport", category: "fitness", domain: "basic-fit.com", frequency: "monthly" },
  { service: "Steam", usage: "Gaming", category: "gaming", domain: "steampowered.com", frequency: "monthly" },
  { service: "PlayStation Plus", usage: "Gaming", category: "gaming", domain: "playstation.com", frequency: "yearly" },
  { service: "Xbox Game Pass", usage: "Gaming", category: "gaming", domain: "xbox.com", frequency: "monthly" },
  { service: "Nintendo Switch Online", usage: "Gaming", category: "gaming", domain: "nintendo.com", frequency: "yearly" },
  { service: "Le Monde", usage: "Presse", category: "news", domain: "lemonde.fr", frequency: "monthly" },
  { service: "The New York Times", usage: "Presse", category: "news", domain: "nytimes.com", frequency: "monthly" },
];

function sf(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

function numberOf(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function amountOf(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function monthlyAmount(price: string, frequency: string) {
  const amount = amountOf(price);
  return frequency === "yearly" ? amount / 12 : amount;
}

function createLocalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `subscription-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function categoryOf(value: unknown): SubscriptionCategory {
  const raw = sf(value) as SubscriptionCategory;
  return CATEGORY_LABELS[raw] ? raw : "other";
}

function budgetCategoryOf(value: unknown, labels: Record<string, string>) {
  const raw = sf(value);
  return labels[raw] ? raw : "other";
}

function normalizeBudgetItem(source: { id: string; label: string; category: string; price: string; frequency: string }, labels: Record<string, string>): BudgetItem {
  return {
    id: source.id || createLocalId(),
    label: sf(source.label),
    category: budgetCategoryOf(source.category, labels),
    price: sf(source.price),
    frequency: source.frequency === "yearly" ? "yearly" : "monthly",
  };
}

function normalizeBudget(source: MonthlyBudgetConfig): MonthlyBudget {
  return {
    month: source.month || DEFAULT_BUDGET.month,
    income: source.income,
    fixedItems: source.fixedItems.map((item) => normalizeBudgetItem(item, FIXED_CATEGORY_LABELS)),
    variableItems: source.variableItems.map((item) => normalizeBudgetItem(item, VARIABLE_CATEGORY_LABELS)),
    savingsTarget: source.savingsTarget || DEFAULT_BUDGET.savingsTarget,
    subscriptions: source.subscriptions.map((item) => ({
      id: item.id || createLocalId(),
      service: sf(item.service),
      usage: sf(item.usage),
      category: categoryOf(item.category),
      domain: sf(item.domain),
      price: sf(item.price),
      frequency: item.frequency === "yearly" ? "yearly" : "monthly",
      nextDate: sf(item.nextDate),
      payment: sf(item.payment),
      decision: item.decision === "cut" || item.decision === "reduce" ? item.decision : "keep",
    })),
  };
}

function isBlankBudget(budget: MonthlyBudget) {
  return amountOf(budget.income) === 0
    && amountOf(budget.savingsTarget) === 0
    && budget.fixedItems.length === 0
    && budget.variableItems.length === 0
    && budget.subscriptions.length === 0;
}

function subscriptionInitials(service: string) {
  const words = service.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "•";
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

function faviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function cleanDomain(value: string) {
  return value.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function assetTypeOf(note: VaultNote) {
  const raw = sf(note.data.asset_type);
  return TYPE_COLORS[raw] ? raw : "other";
}

function baseValueOf(note: VaultNote) {
  const enriched = numberOf(note.data.value_base);
  if (enriched || note.data.value_base !== undefined) return enriched;
  return numberOf(note.data.quantity) * numberOf(note.data.unit_price);
}

function formatAmount(amount: number, currency: string, locale = "en", compact = false) {
  try {
    return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en", {
      style: "currency",
      currency: currency || "EUR",
      notation: compact ? "compact" : "standard",
      // See FinanceMetricChart: a compact format with no explicit minimum
      // renders differently under Node's ICU and the browser's, which breaks
      // hydration on any value whose rounded decimal is zero.
      minimumFractionDigits: compact ? 0 : 2,
      maximumFractionDigits: compact ? 1 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatPercent(value: number, locale: string) {
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en", {
    style: "percent",
    signDisplay: "always",
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function assetLabel(type: string, t: ReturnType<typeof useLanguage>["t"]) {
  return ({
    etf: "ETF",
    stock: t("finance.asset.stock"),
    crypto: "Crypto",
    savings: t("finance.asset.savings"),
    life_insurance: t("finance.asset.lifeInsurance"),
    real_estate: t("finance.asset.realEstate"),
    bonds: t("finance.asset.bonds"),
    other: t("finance.asset.other"),
  })[type] || t("finance.asset.other");
}

function AssetTypeIcon({ type, size = 16 }: { type: string; size?: number }) {
  const Icon = ASSET_ICONS[type as keyof typeof ASSET_ICONS] || WalletCards;
  return <Icon size={size} strokeWidth={1.9} aria-hidden />;
}

function financeBreakdown(point: FinanceHistoryPoint, positions: VaultNote[], locale: string) {
  return positions.map((position) => {
    const asset = point.byAsset?.[position.relativePath];
    const assetCurrency = sf(position.data.currency) || point.currency;
    return {
      label: position.title,
      value: asset?.value || 0,
      color: TYPE_COLORS[assetTypeOf(position)],
      detail: asset?.unitPrice ? `Cours ${formatAmount(asset.unitPrice, assetCurrency, locale)}` : undefined,
    };
  });
}

function FinanceAssetClassCards({ positions, history, currency }: { positions: VaultNote[]; history: FinanceHistoryPoint[]; currency: string }) {
  const { locale, t } = useLanguage();
  const grouped = [...new Set(positions.map(assetTypeOf))].map((type) => {
    const items = positions.filter((position) => assetTypeOf(position) === type);
    const value = items.reduce((sum, position) => sum + baseValueOf(position), 0);
    return { type, items, value, largest: [...items].sort((a, b) => baseValueOf(b) - baseValueOf(a))[0] };
  }).sort((a, b) => b.value - a.value);
  return grouped.length ? <section className="finance-asset-overview"><header><div><span>{t("finance.assetClasses")}</span><h2>{t("finance.detailedComposition")}</h2></div><p>{t("finance.detailedCompositionHint")}</p></header><div className="finance-asset-card-grid">{grouped.map((group) => {
    const points: FinanceMetricPoint[] = history.map((point) => ({ date: point.date, value: point.byType[group.type] || 0, estimated: point.estimated, breakdown: financeBreakdown(point, group.items, locale) }));
    return <FinanceMetricChart color={TYPE_COLORS[group.type]} compact currency={currency} icon={<AssetTypeIcon type={group.type} />} key={group.type} locale={locale} points={points} subtitle={`${translated(t, group.items.length === 1 ? "finance.positionCountOne" : "finance.positionCount", { count: group.items.length })} · ${group.largest?.title || "—"}`} title={assetLabel(group.type, t)} />;
  })}</div></section> : null;
}

export function FinanceDashboard({ positions, history, baseCurrency = "EUR" }: { positions: VaultNote[]; history: FinanceHistoryPoint[]; baseCurrency?: "EUR" | "USD" }) {
  const { locale, t } = useLanguage();
  const total = positions.reduce((sum, position) => sum + baseValueOf(position), 0);
  const connected = positions.filter((position) => sf(position.data.market_identifier) || sf(position.data.price_id)).length;
  const byType = new Map<string, number>();
  for (const position of positions) {
    const type = assetTypeOf(position);
    byType.set(type, (byType.get(type) || 0) + baseValueOf(position));
  }
  const allocation = [...byType.entries()].sort((a, b) => b[1] - a[1]);
  const largestAllocation = allocation[0];
  const historyPoints: FinanceMetricPoint[] = history.map((point) => ({ date: point.date, value: point.total, estimated: point.estimated, breakdown: allocation.map(([type]) => ({ label: assetLabel(type, t), value: point.byType[type] || 0, color: TYPE_COLORS[type] })) }));

  return (
    <>
      <FinanceMetricChart action={<div className="finance-currency-switch" aria-label={t("finance.displayCurrency")}><Link href="/finances?currency=EUR" aria-current={baseCurrency === "EUR" ? "true" : undefined}>€</Link><Link href="/finances?currency=USD" aria-current={baseCurrency === "USD" ? "true" : undefined}>$</Link></div>} currency={baseCurrency} icon={<Wallet size={17} />} locale={locale} points={historyPoints} subtitle={`${translated(t, positions.length === 1 ? "finance.positionCountOne" : "finance.positionCount", { count: positions.length })} · ${t("finance.dailyTracking")}`} title={t("finance.netWorth")} />

      <details className="panel finance-allocation-panel" open>
        <summary className="finance-allocation-summary">
          <span className="finance-allocation-summary-icon"><PieChart size={18} /></span>
          <span className="finance-allocation-summary-copy">
            <strong>{t("finance.allocation")}</strong>
            <small>{allocation.length} {t("finance.assetClasses")}</small>
          </span>
          <span className="finance-allocation-preview" aria-hidden>
            {allocation.slice(0, 5).map(([type, value]) => (
              <i key={type} style={{ background: TYPE_COLORS[type], flexGrow: total ? Math.max(value / total * 100, 4) : 1 }} />
            ))}
          </span>
          <span className="finance-allocation-summary-chevron"><ChevronDown size={17} /></span>
        </summary>
        <div className="finance-allocation-content">
          <div className="finance-allocation-toolbar">
            <span>{positions.length} {t("finance.holdings")}</span>
            <RefreshAllButton />
          </div>
          <AllocationDonut allocation={allocation} positions={positions} total={total} currency={baseCurrency} locale={locale} t={t} />
        </div>
      </details>

      <MetricCards className="finance-modern-metrics" viewLabel={t("common.view")} items={[
        { label: t("finance.positions"), value: positions.length, detail: t("finance.holdings"), icon: <CircleDollarSign size={17} />, tone: "info" },
        { label: t("finance.connected"), value: `${connected}/${positions.length}`, detail: connected === positions.length && positions.length ? t("finance.pricesCurrent") : t("finance.automaticSources"), icon: <ShieldCheck size={17} />, tone: connected === positions.length && positions.length ? "positive" : "neutral" },
        { label: t("finance.assetClasses"), value: allocation.length, detail: t("finance.netWorthAllocation"), icon: <Layers3 size={17} />, tone: "accent" },
        { label: t("finance.mainAllocation"), value: largestAllocation ? `${Math.round(largestAllocation[1] / Math.max(total, 1) * 100)}%` : "—", detail: largestAllocation ? assetLabel(largestAllocation[0], t) : t("finance.none"), icon: largestAllocation ? <AssetTypeIcon type={largestAllocation[0]} /> : <PieChart size={17} />, tone: "warning" },
      ]} />

      <FinanceAssetClassCards positions={positions} history={history} currency={baseCurrency} />
    </>
  );
}

function SubscriptionLogo({ service, domain }: { service: string; domain: string }) {
  const clean = cleanDomain(domain);
  const [failedDomain, setFailedDomain] = useState("");
  const showImage = Boolean(clean && failedDomain !== clean);
  return (
    <span className="finance-subscription-logo" aria-hidden>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={faviconUrl(clean)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedDomain(clean)} />
      ) : (
        <span>{subscriptionInitials(service)}</span>
      )}
    </span>
  );
}

type BudgetStatusTone = "positive" | "warning" | "negative" | "neutral";

type BudgetSegment = {
  key: string;
  label: string;
  amount: number;
  color: string;
  description: string;
  icon: ReactNode;
};

// The four budget segments read semantic tokens, not literals: savings stays
// the positive tone, variable the warning one, so the meaning survives a
// scheme swap instead of the hue being frozen.
const BUDGET_SEGMENT_COLORS = {
  fixed: "var(--tone-info)",
  variable: "var(--tone-warning)",
  subscriptions: "var(--chart-8)",
  savings: "var(--tone-positive)",
};

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function percentOf(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}

function formatBudgetPercent(value: number, locale: string) {
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en", {
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatBudgetMonth(month: string, locale: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  if (!year || !monthIndex) return month || (locale === "fr" ? "Mois en cours" : "Current month");
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, monthIndex - 1, 1));
}

function budgetStatusFor(income: number, remaining: number, usagePercent: number, t: Translate): { label: string; detail: string; tone: BudgetStatusTone } {
  if (income <= 0) return { label: t("budget.status.incomplete"), detail: t("budget.status.incompleteDetail"), tone: "neutral" };
  if (remaining < 0) return { label: t("budget.status.deficit"), detail: t("budget.status.deficitDetail"), tone: "negative" };
  if (usagePercent >= 92) return { label: t("budget.status.watch"), detail: t("budget.status.watchDetail"), tone: "warning" };
  return { label: t("budget.status.balanced"), detail: t("budget.status.balancedDetail"), tone: "positive" };
}

function categoryTotalsFromBudgetItems(items: BudgetItem[], labels: Record<string, string>, groupLabel: string, t: Translate): BudgetCategoryItem[] {
  const totals = new Map<string, { amount: number; count: number }>();
  for (const item of items) {
    const amount = monthlyAmount(item.price, item.frequency);
    if (amount <= 0) continue;
    const current = totals.get(item.category) || { amount: 0, count: 0 };
    totals.set(item.category, { amount: current.amount + amount, count: current.count + 1 });
  }
  return [...totals.entries()]
    .map(([category, total]) => ({
      key: `${groupLabel}-${category}`,
      label: labels[category] || t("budget.category.other"),
      meta: `${groupLabel} · ${translated(t, total.count === 1 ? "budget.itemCountOne" : "budget.itemCount", { count: total.count })}`,
      amount: total.amount,
      color: budgetCategoryColor(category),
    }))
    .sort((a, b) => b.amount - a.amount);
}

function categoryTotalsFromSubscriptions(subscriptions: BudgetSubscription[], labels: Record<SubscriptionCategory, string>, t: Translate): BudgetCategoryItem[] {
  const totals = new Map<SubscriptionCategory, { amount: number; count: number }>();
  for (const subscription of subscriptions) {
    const amount = monthlyAmount(subscription.price, subscription.frequency);
    if (amount <= 0) continue;
    const current = totals.get(subscription.category) || { amount: 0, count: 0 };
    totals.set(subscription.category, { amount: current.amount + amount, count: current.count + 1 });
  }
  return [...totals.entries()]
    .map(([category, total]) => ({
      key: `subscription-${category}`,
      label: labels[category] || t("budget.category.other"),
      meta: `${t("budget.subscriptions")} · ${translated(t, total.count === 1 ? "budget.serviceCountOne" : "budget.serviceCount", { count: total.count })}`,
      amount: total.amount,
      color: budgetCategoryColor(category),
    }))
    .sort((a, b) => b.amount - a.amount);
}

function BudgetEditorSection({
  title,
  meta,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  meta: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="finance-budget-section" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="finance-budget-section-summary">
        <span className="finance-budget-section-icon">{icon}</span>
        <span>
          <strong>{title}</strong>
          <small>{meta}</small>
        </span>
        <ChevronDown size={16} aria-hidden />
      </summary>
      <div className="finance-budget-section-body">{children}</div>
    </details>
  );
}

function BudgetKpiGrid({
  kpis,
}: {
  kpis: Array<{
    label: string;
    value: string;
    detail: string;
    icon: ReactNode;
    tone?: BudgetStatusTone;
  }>;
}) {
  const tone: Record<BudgetStatusTone, MetricTone> = { positive: "positive", negative: "negative", warning: "warning", neutral: "neutral" };
  return <MetricCards className="finance-budget-kpis-modern" items={kpis.map((kpi) => ({ ...kpi, tone: kpi.tone ? tone[kpi.tone] : "neutral" }))} />;
}

function BudgetDonut({
  segments,
  total,
  currency,
  locale,
  ariaLabel,
  centerLabel,
  emptyTitle,
  emptyDetail,
}: {
  segments: BudgetSegment[];
  total: number;
  currency: string;
  locale: string;
  ariaLabel: string;
  centerLabel: string;
  emptyTitle: string;
  emptyDetail: string;
}) {
  const selection = useDonutSelection();
  const positiveSegments = segments.filter((segment) => segment.amount > 0);

  return (
    <div className="finance-budget-donut-wrap">
        <DonutRing
          segments={positiveSegments.map((segment) => ({
            label: segment.label,
            value: segment.amount,
            color: segment.color,
            formattedValue: formatAmount(segment.amount, currency, locale),
          }))}
          centerValue={`${formatBudgetPercent(total ? 100 : 0, locale)}%`}
          centerSub={centerLabel}
          ariaLabel={ariaLabel}
          selection={selection}
        />
        <div className="finance-budget-legend">
          {positiveSegments.length > 0 ? positiveSegments.map((segment, index) => {
            const share = percentOf(segment.amount, total);
            const style = { "--budget-color": segment.color } as CSSProperties;
            const state = selection.active === null ? "" : selection.active === index ? " is-active" : " is-dim";
            return (
              <button
                type="button"
                className={`finance-budget-legend-item${state}`}
                key={segment.key}
                style={style}
                aria-pressed={selection.active === index}
                {...selection.segmentProps(index)}
              >
                <span className="finance-budget-legend-icon" aria-hidden>{segment.icon}</span>
                <span>
                  <strong>{segment.label}</strong>
                  <small>{formatAmount(segment.amount, currency, locale)} · {segment.description}</small>
                </span>
                <em>{formatBudgetPercent(share, locale)}%</em>
              </button>
            );
          }) : (
            <BudgetEmptyState
              icon={<PieChart size={18} />}
              title={emptyTitle}
              detail={emptyDetail}
              compact
            />
          )}
        </div>
    </div>
  );
}

function BudgetBreakdownDonut({
  segments,
  total,
  currency,
  locale,
}: {
  segments: BudgetSegment[];
  total: number;
  currency: "EUR" | "USD";
  locale: string;
}) {
  const { t } = useLanguage();
  return (
    <section className="finance-budget-chart-card finance-budget-donut-card">
      <div className="finance-budget-chart-head">
        <span><PieChart size={17} /> {t("budget.monthlyBreakdown")}</span>
        <strong>{formatAmount(total, currency, locale)}</strong>
      </div>
      <BudgetDonut
        segments={segments}
        total={total}
        currency={currency}
        locale={locale}
        ariaLabel={t("budget.breakdownAria")}
        centerLabel={t("budget.planned")}
        emptyTitle={t("budget.emptyBreakdown")}
        emptyDetail={t("budget.emptyBreakdownDetail")}
      />
    </section>
  );
}

function BudgetIncomeProgress({
  income,
  planned,
  remaining,
  usagePercent,
  currency,
  locale,
}: {
  income: number;
  planned: number;
  remaining: number;
  usagePercent: number;
  currency: "EUR" | "USD";
  locale: string;
}) {
  const { t } = useLanguage();
  const cappedUsage = clamp(usagePercent);
  return (
    <div className={`finance-budget-progress ${remaining < 0 ? "is-negative" : ""}`}>
      <div className="finance-budget-chart-head">
        <span><TrendingUp size={17} /> {t("budget.incomeUse")}</span>
        <strong>{formatBudgetPercent(usagePercent, locale)}%</strong>
      </div>
      <div
        className="finance-budget-progress-track"
        role="progressbar"
        aria-label={t("budget.plannedIncomeShare")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(cappedUsage)}
      >
        <i className="finance-budget-progress-fill" style={{ width: `${cappedUsage}%` }} />
      </div>
      <div className="finance-budget-progress-meta">
        <span>{translated(t, "budget.amountPlanned", { amount: formatAmount(planned, currency, locale) })}</span>
        <span>{income > 0 ? translated(t, "budget.amountRemaining", { amount: formatAmount(remaining, currency, locale) }) : t("budget.incomeMissing")}</span>
      </div>
    </div>
  );
}

function BudgetCategories({
  items,
  total,
  currency,
  locale,
}: {
  items: BudgetCategoryItem[];
  total: number;
  currency: "EUR" | "USD";
  locale: string;
}) {
  const { t } = useLanguage();
  const [view, setView] = useState<"bars" | "pie">("bars");
  const donutSegments: BudgetSegment[] = items.map((item) => ({
    key: item.key,
    label: item.label,
    amount: item.amount,
    color: item.color,
    description: item.meta,
    icon: <ChartNoAxesCombined size={15} />,
  }));

  return (
    <div className="finance-budget-bars">
      <div className="finance-budget-chart-head">
        <span><ChartNoAxesCombined size={17} /> {t("budget.mainCategories")}</span>
        <div className="finance-view-toggle" role="group" aria-label={t("budget.categoryView")} style={{ "--finance-chart-color": "var(--budget-blue)" } as CSSProperties}>
          <button type="button" aria-label={t("budget.showBars")} title={t("budget.bars")} aria-pressed={view === "bars"} onClick={() => setView("bars")}><ChartNoAxesCombined size={14} /></button>
          <button type="button" aria-label={t("budget.showBreakdown")} title={t("budget.breakdown")} aria-pressed={view === "pie"} onClick={() => setView("pie")}><PieChart size={14} /></button>
        </div>
      </div>
      {items.length > 0 ? (
        view === "bars" ? <div className="finance-budget-bar-list">
          {items.map((item) => {
            const share = percentOf(item.amount, total);
            const style = { "--budget-color": item.color, "--budget-width": `${clamp(share)}%` } as CSSProperties;
            return (
              <div className="finance-budget-bar-row" key={item.key} style={style}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.meta}</span>
                </div>
                <em>{formatAmount(item.amount, currency, locale)}</em>
                <span className="finance-budget-bar-track" aria-hidden><i /></span>
              </div>
            );
          })}
        </div> : <BudgetDonut
          segments={donutSegments}
          total={total}
          currency={currency}
          locale={locale}
          ariaLabel={t("budget.mainCategoriesAria")}
          centerLabel={t("budget.categories")}
          emptyTitle={t("budget.noCategory")}
          emptyDetail={t("budget.noCategoryDetail")}
        />
      ) : (
        <BudgetEmptyState
          icon={<ChartNoAxesCombined size={18} />}
          title={t("budget.noCategory")}
          detail={t("budget.noEnvelopeDetail")}
        />
      )}
    </div>
  );
}

function BudgetEmptyState({
  icon,
  title,
  detail,
  compact = false,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  compact?: boolean;
}) {
  return (
    <div className={`finance-budget-empty finance-budget-empty-state ${compact ? "is-compact" : ""}`}>
      <span className="finance-budget-empty-icon" aria-hidden>{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
    </div>
  );
}

function BudgetItemsSection({
  title,
  emptyLabel,
  emptyDetail,
  emptyIcon,
  items,
  categoryOptions,
  draft,
  setDraft,
  onAdd,
  onUpdate,
  onDelete,
  currency,
  locale,
  showHeader = true,
}: {
  title: string;
  emptyLabel: string;
  emptyDetail: string;
  emptyIcon: ReactNode;
  items: BudgetItem[];
  categoryOptions: Array<{ value: string; label: string }>;
  draft: Omit<BudgetItem, "id">;
  setDraft: (updater: (current: Omit<BudgetItem, "id">) => Omit<BudgetItem, "id">) => void;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<BudgetItem>) => void;
  onDelete: (id: string) => void;
  currency: "EUR" | "USD";
  locale: string;
  showHeader?: boolean;
}) {
  const { t } = useLanguage();
  const frequencyOptions = [
    { value: "monthly", label: t("budget.frequency.monthly"), hint: t("budget.frequency.monthlyHint") },
    { value: "yearly", label: t("budget.frequency.yearly"), hint: t("budget.frequency.yearlyHint") },
  ];
  const total = items.reduce((sum, item) => sum + monthlyAmount(item.price, item.frequency), 0);
  return (
    <section className="finance-budget-items">
      {showHeader && (
        <div className="finance-subscriptions-head">
          <h3>{title}</h3>
          <span>{formatAmount(total, currency, locale)} / {t("budget.month")}</span>
        </div>
      )}

      {items.length > 0 ? (
        <div className="finance-budget-items-list">
          {items.map((item) => {
            const monthly = monthlyAmount(item.price, item.frequency);
            return (
              <div className="finance-budget-item-row" key={item.id}>
                <input value={item.label} aria-label={t("budget.label")} placeholder={t("budget.label")} onChange={(event) => onUpdate(item.id, { label: event.target.value })} />
                <CustomSelect
                  name={`cat-${item.id}`}
                  options={categoryOptions}
                  value={item.category}
                  onChange={(value) => onUpdate(item.id, { category: value })}
                />
                <label className="finance-compact-field finance-price-field">
                  <input inputMode="decimal" value={item.price} aria-label={t("budget.price")} placeholder="0" onChange={(event) => onUpdate(item.id, { price: event.target.value })} />
                  {item.frequency === "yearly" && <small>{formatAmount(monthly, currency, locale)}/{t("budget.month")}</small>}
                </label>
                <CustomSelect
                  name={`freq-${item.id}`}
                  options={frequencyOptions}
                  value={item.frequency}
                  onChange={(value) => onUpdate(item.id, { frequency: value as SubscriptionFrequency })}
                />
                <button
                  className="finance-subscription-delete"
                  type="button"
                  title={t("common.delete")}
                  aria-label={translated(t, "budget.deleteItem", { item: item.label || t("budget.thisItem") })}
                  onClick={() => onDelete(item.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <BudgetEmptyState icon={emptyIcon} title={emptyLabel} detail={emptyDetail} />
      )}

      <form
        className="finance-budget-item-form"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd();
        }}
      >
        <input value={draft.label} placeholder={t("budget.labelPlaceholder")} aria-label={t("budget.newItem")} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} />
        <CustomSelect name="new-item-category" options={categoryOptions} value={draft.category} onChange={(value) => setDraft((current) => ({ ...current, category: value }))} />
        <input inputMode="decimal" value={draft.price} placeholder={t("budget.price")} aria-label={t("budget.price")} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} />
        <CustomSelect name="new-item-frequency" options={frequencyOptions} value={draft.frequency} onChange={(value) => setDraft((current) => ({ ...current, frequency: value as SubscriptionFrequency }))} />
        <button className="button secondary" type="submit">
          <Plus size={14} />
          {t("common.add")}
        </button>
      </form>
    </section>
  );
}

export function MonthlyBudgetTracker({ currency = "EUR", initialBudget }: { currency?: "EUR" | "USD"; initialBudget: MonthlyBudgetConfig }) {
  const { locale, t } = useLanguage();
  const [budget, setBudget] = useState<MonthlyBudget>(() => normalizeBudget(initialBudget));
  const [draft, setDraft] = useState<Omit<BudgetSubscription, "id">>(EMPTY_SUBSCRIPTION);
  const [fixedDraft, setFixedDraft] = useState<Omit<BudgetItem, "id">>(EMPTY_BUDGET_ITEM);
  const [variableDraft, setVariableDraft] = useState<Omit<BudgetItem, "id">>(EMPTY_BUDGET_ITEM);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [budgetSetupOpen, setBudgetSetupOpen] = useState(() => isBlankBudget(normalizeBudget(initialBudget)));
  const [resetOpen, setResetOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSave = useRef(true);
  const fixedCategoryOptions = useMemo(() => [
    { value: "housing", label: t("budget.category.housing") },
    { value: "insurance", label: t("budget.category.insurance") },
    { value: "credit", label: t("budget.category.credit") },
    { value: "health", label: t("budget.category.health") },
    { value: "transport", label: t("budget.category.transport") },
    { value: "taxes", label: t("budget.category.taxes") },
    { value: "other", label: t("budget.category.other") },
  ], [t]);
  const variableCategoryOptions = useMemo(() => [
    { value: "food", label: t("budget.category.food") },
    { value: "transport", label: t("budget.category.transport") },
    { value: "leisure", label: t("budget.category.leisure") },
    { value: "shopping", label: t("budget.category.shopping") },
    { value: "health", label: t("budget.category.health") },
    { value: "other", label: t("budget.category.other") },
  ], [t]);
  const subscriptionCategoryOptions = useMemo(() => SUBSCRIPTION_CATEGORIES.map((category) => ({
    value: category.key,
    label: t(`budget.subscriptionCategory.${category.key}`),
  })), [t]);
  const subscriptionCategoryLabels = useMemo(() => Object.fromEntries(
    subscriptionCategoryOptions.map((category) => [category.value, category.label]),
  ) as Record<SubscriptionCategory, string>, [subscriptionCategoryOptions]);
  const frequencyOptions = useMemo(() => [
    { value: "monthly", label: t("budget.frequency.monthly"), hint: t("budget.frequency.monthlyHint") },
    { value: "yearly", label: t("budget.frequency.yearly"), hint: t("budget.frequency.yearlyHint") },
  ], [t]);
  const decisionOptions = useMemo(() => [
    { value: "keep", label: t("budget.decision.keep"), hint: t("budget.decision.keepHint") },
    { value: "reduce", label: t("budget.decision.reduce"), hint: t("budget.decision.reduceHint") },
    { value: "cut", label: t("budget.decision.cut"), hint: t("budget.decision.cutHint") },
  ], [t]);

  // Budget is stored in the vault (00-System/Budget.md), not localStorage, so it
  // shows up on every device via Syncthing. Debounced like the note editors:
  // save 520ms after the last edit instead of on every keystroke.
  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const formData = new FormData();
      formData.set("month", budget.month);
      formData.set("income", budget.income);
      formData.set("savingsTarget", budget.savingsTarget);
      formData.set("fixedItems", JSON.stringify(budget.fixedItems));
      formData.set("variableItems", JSON.stringify(budget.variableItems));
      formData.set("subscriptions", JSON.stringify(budget.subscriptions));
      setSaveState("saving");
      updateMonthlyBudgetAction(formData).then((result) => {
        setSaveState(result.ok ? "saved" : "error");
      });
    }, 520);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [budget]);

  const existingServices = useMemo(() => new Set(
    budget.subscriptions.map((subscription) => subscription.service.trim().toLowerCase()).filter(Boolean),
  ), [budget.subscriptions]);
  const catalogGroups = useMemo(() => SUBSCRIPTION_CATEGORIES
    .map((category) => ({
      ...category,
      label: t(`budget.subscriptionCategory.${category.key}`),
      items: POPULAR_SUBSCRIPTIONS.filter((subscription) => subscription.category === category.key),
    }))
    .filter((category) => category.items.length > 0), [t]);

  const totals = useMemo(() => {
    const income = amountOf(budget.income);
    const fixedCosts = budget.fixedItems.reduce((sum, item) => sum + monthlyAmount(item.price, item.frequency), 0);
    const variableBudget = budget.variableItems.reduce((sum, item) => sum + monthlyAmount(item.price, item.frequency), 0);
    const savingsTarget = amountOf(budget.savingsTarget);
    const subscriptions = budget.subscriptions.reduce((sum, subscription) => sum + monthlyAmount(subscription.price, subscription.frequency), 0);
    const planned = fixedCosts + variableBudget + savingsTarget + subscriptions;
    return {
      income,
      fixedCosts,
      variableBudget,
      savingsTarget,
      subscriptions,
      planned,
      remaining: income - planned,
    };
  }, [budget]);

  const budgetView = useMemo(() => {
    const segments: BudgetSegment[] = [
      {
        key: "fixed",
        label: t("budget.fixedCosts"),
        amount: totals.fixedCosts,
        color: BUDGET_SEGMENT_COLORS.fixed,
        description: translated(t, budget.fixedItems.length === 1 ? "budget.itemCountOne" : "budget.itemCount", { count: budget.fixedItems.length }),
        icon: <Wallet size={17} />,
      },
      {
        key: "variable",
        label: t("budget.variableBudget"),
        amount: totals.variableBudget,
        color: BUDGET_SEGMENT_COLORS.variable,
        description: translated(t, budget.variableItems.length === 1 ? "budget.envelopeCountOne" : "budget.envelopeCount", { count: budget.variableItems.length }),
        icon: <ChartNoAxesCombined size={17} />,
      },
      {
        key: "subscriptions",
        label: t("budget.subscriptions"),
        amount: totals.subscriptions,
        color: BUDGET_SEGMENT_COLORS.subscriptions,
        description: translated(t, budget.subscriptions.length === 1 ? "budget.serviceCountOne" : "budget.serviceCount", { count: budget.subscriptions.length }),
        icon: <WalletCards size={17} />,
      },
      {
        key: "savings",
        label: t("budget.savings"),
        amount: totals.savingsTarget,
        color: BUDGET_SEGMENT_COLORS.savings,
        description: t("budget.monthlyGoal"),
        icon: <PiggyBank size={17} />,
      },
    ];
    const fixedLabels = Object.fromEntries(fixedCategoryOptions.map((option) => [option.value, option.label]));
    const variableLabels = Object.fromEntries(variableCategoryOptions.map((option) => [option.value, option.label]));
    const fixedCategories = categoryTotalsFromBudgetItems(budget.fixedItems, fixedLabels, t("budget.fixed"), t);
    const variableCategories = categoryTotalsFromBudgetItems(budget.variableItems, variableLabels, t("budget.variable"), t);
    const subscriptionCategories = categoryTotalsFromSubscriptions(budget.subscriptions, subscriptionCategoryLabels, t);
    const categories = prepareBudgetCategories(
      [...fixedCategories, ...variableCategories, ...subscriptionCategories],
      (count) => ({
        label: t("budget.category.other"),
        meta: translated(t, "budget.groupedCategoryCount", { count }),
      }),
    );
    const usagePercent = percentOf(totals.planned, totals.income);
    const savingsRate = percentOf(totals.savingsTarget, totals.income);
    return {
      segments,
      allocationTotal: segments.reduce((sum, segment) => sum + segment.amount, 0),
      categoryBars: categories.items,
      categoryTotal: categories.total,
      recurringTotal: totals.fixedCosts + totals.subscriptions,
      savingsRate,
      usagePercent,
      monthLabel: formatBudgetMonth(budget.month, locale),
      status: budgetStatusFor(totals.income, totals.remaining, usagePercent, t),
    };
  }, [budget, fixedCategoryOptions, locale, subscriptionCategoryLabels, t, totals, variableCategoryOptions]);

  function updateBudgetField(field: "month" | "income" | "savingsTarget", value: string) {
    setBudget((current) => ({ ...current, [field]: value }));
  }

  function updateSubscription(id: string, patch: Partial<BudgetSubscription>) {
    setBudget((current) => ({
      ...current,
      subscriptions: current.subscriptions.map((subscription) => (
        subscription.id === id ? { ...subscription, ...patch } : subscription
      )),
    }));
  }

  function addSubscription() {
    if (!draft.service.trim() && !draft.price.trim()) return;
    setBudget((current) => ({
      ...current,
      subscriptions: [...current.subscriptions, { ...draft, id: createLocalId(), service: draft.service.trim() || t("budget.untitled") }],
    }));
    setDraft(EMPTY_SUBSCRIPTION);
  }

  function addKnownSubscription(subscription: PopularSubscription) {
    if (existingServices.has(subscription.service.toLowerCase())) return;
    setBudget((current) => ({
      ...current,
      subscriptions: [
        ...current.subscriptions,
        {
          ...EMPTY_SUBSCRIPTION,
          ...subscription,
          usage: subscriptionCategoryLabels[subscription.category],
          id: createLocalId(),
        },
      ],
    }));
  }

  function updateItem(list: "fixedItems" | "variableItems", id: string, patch: Partial<BudgetItem>) {
    setBudget((current) => ({
      ...current,
      [list]: current[list].map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  }

  function deleteItem(list: "fixedItems" | "variableItems", id: string) {
    setBudget((current) => ({ ...current, [list]: current[list].filter((item) => item.id !== id) }));
  }

  function addFixedItem() {
    if (!fixedDraft.label.trim() && !fixedDraft.price.trim()) return;
    setBudget((current) => ({
      ...current,
      fixedItems: [...current.fixedItems, { ...fixedDraft, id: createLocalId(), label: fixedDraft.label.trim() || t("budget.untitled") }],
    }));
    setFixedDraft(EMPTY_BUDGET_ITEM);
  }

  function addVariableItem() {
    if (!variableDraft.label.trim() && !variableDraft.price.trim()) return;
    setBudget((current) => ({
      ...current,
      variableItems: [...current.variableItems, { ...variableDraft, id: createLocalId(), label: variableDraft.label.trim() || t("budget.untitled") }],
    }));
    setVariableDraft(EMPTY_BUDGET_ITEM);
  }

  function resetBudget() {
    setBudget({ ...DEFAULT_BUDGET, month: budget.month || DEFAULT_BUDGET.month });
    setBudgetSetupOpen(true);
  }

  return (
    <section className="finance-budget-panel" id="budget-mensuel">
      {budgetSetupOpen ? (
        <section className="finance-budget-onboarding" aria-labelledby="budget-onboarding-title">
          <span className="finance-budget-onboarding-icon"><Wallet size={24} aria-hidden /></span>
          <div className="finance-budget-onboarding-copy">
            <span className="finance-kicker">{t("budget.monthlyBudget")}</span>
            <h2 id="budget-onboarding-title">{t("budget.onboardingTitle")}</h2>
            <p>{t("budget.onboardingDescription")}</p>
          </div>
          <div className="finance-budget-onboarding-fields">
            <label>
              {t("budget.monthlyNetIncome")}
              <input
                inputMode="decimal"
                value={budget.income}
                placeholder={t("budget.incomePlaceholder")}
                autoFocus
                onChange={(event) => updateBudgetField("income", event.target.value)}
              />
            </label>
            <label>
              {t("budget.desiredSavings")} <small>{t("form.optional")}</small>
              <input
                inputMode="decimal"
                value={budget.savingsTarget}
                placeholder="0"
                onChange={(event) => updateBudgetField("savingsTarget", event.target.value)}
              />
            </label>
          </div>
          <span className="muted finance-budget-savestate" aria-live="polite">
            {saveState === "saving" ? t("budget.saving") : saveState === "saved" ? t("budget.saved") : saveState === "error" ? t("budget.saveError") : t("budget.savedInVault")}
          </span>
          <button className="button primary finance-budget-onboarding-submit" type="button" disabled={totals.income <= 0} onClick={() => setBudgetSetupOpen(false)}>
            {t("budget.build")}
          </button>
        </section>
      ) : (
      <div className="finance-budget-dashboard">
        <header className="finance-budget-hero finance-budget-chart-card">
          <div className="finance-budget-chart-head">
            <span><Wallet size={15} /> {t("budget.monthlyBudget")}</span>
            <button className="button secondary finance-budget-reset" type="button" onClick={() => setResetOpen(true)}>
              <RefreshCw size={14} />
              {t("budget.reset")}
            </button>
          </div>
          <div className="finance-budget-hero-body">
            <div className="finance-budget-hero-copy">
              <h2>{budgetView.monthLabel}</h2>
              <strong className={`finance-budget-hero-total ${totals.remaining >= 0 ? "is-positive" : "is-negative"}`}>
                {formatAmount(totals.remaining, currency, locale)}
              </strong>
              <div className="finance-budget-hero-meta">
                <span>{translated(t, "budget.amountPlanned", { amount: formatAmount(totals.planned, currency, locale) })}</span>
                <span>{translated(t, "budget.incomePercent", { percent: formatBudgetPercent(budgetView.usagePercent, locale) })}</span>
              </div>
            </div>
            <div className="finance-budget-hero-actions">
              <span className={`finance-budget-status is-${budgetView.status.tone}`}>
                <strong>{budgetView.status.label}</strong>
                <small>{budgetView.status.detail}</small>
              </span>
              <span className="muted finance-budget-savestate" aria-live="polite">
                {saveState === "saving" ? t("budget.saving") : saveState === "saved" ? t("budget.saved") : saveState === "error" ? t("budget.saveError") : t("budget.vaultSynced")}
              </span>
            </div>
          </div>
        </header>

        <BudgetKpiGrid
          kpis={[
            {
              label: t("budget.income"),
              value: formatAmount(totals.income, currency, locale),
              detail: t("budget.monthlyNet"),
              icon: <CircleDollarSign size={18} />,
            },
            {
              label: totals.remaining >= 0 ? t("budget.available") : t("budget.overrun"),
              value: formatAmount(totals.remaining, currency, locale),
              detail: totals.remaining >= 0 ? t("budget.afterBudget") : t("budget.toCorrect"),
              icon: <Wallet size={18} />,
              tone: totals.remaining >= 0 ? "positive" : "negative",
            },
            {
              label: t("budget.savings"),
              value: formatAmount(totals.savingsTarget, currency, locale),
              detail: translated(t, "budget.incomePercent", { percent: formatBudgetPercent(budgetView.savingsRate, locale) }),
              icon: <PiggyBank size={18} />,
              tone: "positive",
            },
            {
              label: t("budget.subscriptions"),
              value: formatAmount(totals.subscriptions, currency, locale),
              detail: translated(t, budget.subscriptions.length === 1 ? "budget.serviceCountOne" : "budget.serviceCount", { count: budget.subscriptions.length }),
              icon: <WalletCards size={18} />,
            },
          ]}
        />

        <div className="finance-budget-charts">
          <BudgetBreakdownDonut
            segments={budgetView.segments}
            total={budgetView.allocationTotal}
            currency={currency}
            locale={locale}
          />
          <section className="finance-budget-chart-card">
            <BudgetIncomeProgress
              income={totals.income}
              planned={totals.planned}
              remaining={totals.remaining}
              usagePercent={budgetView.usagePercent}
              currency={currency}
              locale={locale}
            />
            <BudgetCategories
              items={budgetView.categoryBars}
              total={budgetView.categoryTotal}
              currency={currency}
              locale={locale}
            />
          </section>
        </div>
      </div>
      )}

      {!budgetSetupOpen ? <div className="finance-budget-editor-grid">
        <BudgetEditorSection
          title={t("budget.monthSettings")}
          meta={`${budgetView.monthLabel} · ${t("budget.incomeAndGoal")}`}
          icon={<CircleDollarSign size={17} />}
          defaultOpen
        >
          <div className="finance-budget-inputs">
            <label>
              {t("budget.month")}
              <input value={budget.month} placeholder="2026-07" onChange={(event) => updateBudgetField("month", event.target.value)} />
            </label>
            <label>
              {t("budget.netIncome")}
              <input inputMode="decimal" value={budget.income} placeholder="0" onChange={(event) => updateBudgetField("income", event.target.value)} />
            </label>
            <label>
              {t("budget.savingsInvestment")}
              <input inputMode="decimal" value={budget.savingsTarget} placeholder="0" onChange={(event) => updateBudgetField("savingsTarget", event.target.value)} />
            </label>
          </div>
          <div className="finance-budget-summary">
            <span>{t("budget.plannedExpenses")}: <strong>{formatAmount(totals.planned, currency, locale)}</strong></span>
            <span>{t("budget.recurring")}: <strong>{formatAmount(budgetView.recurringTotal, currency, locale)}</strong></span>
            <span>{t("budget.remaining")}: <strong>{formatAmount(totals.remaining, currency, locale)}</strong></span>
          </div>
        </BudgetEditorSection>

        <BudgetEditorSection
          title={t("budget.fixedCosts")}
          meta={`${formatAmount(totals.fixedCosts, currency, locale)} / ${t("budget.month")}`}
          icon={<Wallet size={17} />}
          defaultOpen
        >
          <BudgetItemsSection
            title={t("budget.fixedCosts")}
            emptyLabel={t("budget.noFixedCost")}
            emptyDetail={t("budget.noFixedCostDetail")}
            emptyIcon={<Wallet size={18} />}
            items={budget.fixedItems}
            categoryOptions={fixedCategoryOptions}
            draft={fixedDraft}
            setDraft={setFixedDraft}
            onAdd={addFixedItem}
            onUpdate={(id, patch) => updateItem("fixedItems", id, patch)}
            onDelete={(id) => deleteItem("fixedItems", id)}
            currency={currency}
            locale={locale}
            showHeader={false}
          />
        </BudgetEditorSection>

        <BudgetEditorSection
          title={t("budget.variableBudget")}
          meta={`${formatAmount(totals.variableBudget, currency, locale)} / ${t("budget.month")}`}
          icon={<ChartNoAxesCombined size={17} />}
          defaultOpen
        >
          <BudgetItemsSection
            title={t("budget.variableBudget")}
            emptyLabel={t("budget.noVariableEnvelope")}
            emptyDetail={t("budget.noVariableEnvelopeDetail")}
            emptyIcon={<ChartNoAxesCombined size={18} />}
            items={budget.variableItems}
            categoryOptions={variableCategoryOptions}
            draft={variableDraft}
            setDraft={setVariableDraft}
            onAdd={addVariableItem}
            onUpdate={(id, patch) => updateItem("variableItems", id, patch)}
            onDelete={(id) => deleteItem("variableItems", id)}
            currency={currency}
            locale={locale}
            showHeader={false}
          />
        </BudgetEditorSection>

        <BudgetEditorSection
          title={t("budget.mySubscriptions")}
          meta={`${formatAmount(totals.subscriptions, currency, locale)} · ${translated(t, budget.subscriptions.length === 1 ? "budget.serviceCountOne" : "budget.serviceCount", { count: budget.subscriptions.length })}`}
          icon={<WalletCards size={17} />}
          defaultOpen
        >
          <div className="finance-subscriptions-wrap">
            {budget.subscriptions.length > 0 ? (
              <div className="finance-subscriptions-list">
                {budget.subscriptions.map((subscription) => {
                  const monthlyPrice = subscription.frequency === "yearly" ? amountOf(subscription.price) / 12 : amountOf(subscription.price);
                  return (
                    <article className={`finance-subscription-card decision-${subscription.decision}`} key={subscription.id}>
                      <div className="finance-service-cell">
                        <SubscriptionLogo service={subscription.service} domain={subscription.domain} />
                        <div>
                          <input value={subscription.service} aria-label={t("budget.service")} onChange={(event) => updateSubscription(subscription.id, { service: event.target.value })} />
                          <input
                            value={subscription.domain}
                            aria-label={t("budget.logoDomain")}
                            placeholder={t("budget.logoDomainPlaceholder")}
                            onChange={(event) => updateSubscription(subscription.id, { domain: cleanDomain(event.target.value) })}
                          />
                        </div>
                      </div>

                      <label className="finance-compact-field">
                        <span>{t("budget.category")}</span>
                        <CustomSelect
                          name={`category-${subscription.id}`}
                          options={subscriptionCategoryOptions}
                          value={subscription.category}
                          onChange={(value) => updateSubscription(subscription.id, { category: value as SubscriptionCategory })}
                        />
                      </label>

                      <label className="finance-compact-field finance-usage-field">
                        <span>{t("budget.usage")}</span>
                        <input value={subscription.usage} aria-label={t("budget.usage")} placeholder={t("budget.usagePlaceholder")} onChange={(event) => updateSubscription(subscription.id, { usage: event.target.value })} />
                      </label>

                      <label className="finance-compact-field finance-price-field">
                        <span>{t("budget.price")}</span>
                        <input inputMode="decimal" value={subscription.price} aria-label={t("budget.price")} placeholder="0" onChange={(event) => updateSubscription(subscription.id, { price: event.target.value })} />
                        <small>{formatAmount(monthlyPrice, currency, locale)} / {t("budget.month")}</small>
                      </label>

                      <label className="finance-compact-field">
                        <span>{t("budget.frequency")}</span>
                        <CustomSelect
                          name={`frequency-${subscription.id}`}
                          options={frequencyOptions}
                          value={subscription.frequency}
                          onChange={(value) => updateSubscription(subscription.id, { frequency: value as SubscriptionFrequency })}
                        />
                      </label>

                      <label className="finance-compact-field">
                        <span>{t("budget.dueDate")}</span>
                        <DayOfMonthPicker
                          value={subscription.nextDate}
                          ariaLabel={t("budget.nextDueDate")}
                          onChange={(nextDate) => updateSubscription(subscription.id, { nextDate })}
                        />
                      </label>

                      <label className="finance-compact-field">
                        <span>{t("budget.payment")}</span>
                        <input value={subscription.payment} aria-label={t("budget.payment")} placeholder={t("budget.paymentPlaceholder")} onChange={(event) => updateSubscription(subscription.id, { payment: event.target.value })} />
                      </label>

                      <label className="finance-compact-field">
                        <span>{t("budget.decision")}</span>
                        <CustomSelect
                          name={`decision-${subscription.id}`}
                          options={decisionOptions}
                          value={subscription.decision}
                          onChange={(value) => updateSubscription(subscription.id, { decision: value as SubscriptionDecision })}
                        />
                      </label>

                      <button
                        className="finance-subscription-delete"
                        type="button"
                        title={t("common.delete")}
                        aria-label={translated(t, "budget.deleteSubscription", { service: subscription.service || t("budget.thisSubscription") })}
                        onClick={() => setBudget((current) => ({
                          ...current,
                          subscriptions: current.subscriptions.filter((item) => item.id !== subscription.id),
                        }))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <BudgetEmptyState
                icon={<WalletCards size={18} />}
                title={t("budget.noSubscription")}
                detail={t("budget.noSubscriptionDetail")}
              />
            )}
          </div>

          <form className="finance-subscription-form" onSubmit={(event) => {
            event.preventDefault();
            addSubscription();
          }}>
            <input value={draft.service} placeholder={t("budget.service")} aria-label={t("budget.newService")} onChange={(event) => setDraft((current) => ({ ...current, service: event.target.value }))} />
            <CustomSelect name="new-category" options={subscriptionCategoryOptions} value={draft.category} onChange={(value) => setDraft((current) => ({ ...current, category: value as SubscriptionCategory }))} />
            <input value={draft.usage} placeholder={t("budget.usage")} aria-label={t("budget.usage")} onChange={(event) => setDraft((current) => ({ ...current, usage: event.target.value }))} />
            <input value={draft.domain} placeholder={t("budget.logoDomain")} aria-label={t("budget.logoDomain")} onChange={(event) => setDraft((current) => ({ ...current, domain: cleanDomain(event.target.value) }))} />
            <input inputMode="decimal" value={draft.price} placeholder={t("budget.price")} aria-label={t("budget.price")} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} />
            <CustomSelect name="new-frequency" options={frequencyOptions} value={draft.frequency} onChange={(value) => setDraft((current) => ({ ...current, frequency: value as SubscriptionFrequency }))} />
            <button className="button primary" type="submit">
              <Plus size={14} />
              {t("common.add")}
            </button>
          </form>
        </BudgetEditorSection>

        <BudgetEditorSection
          title={t("budget.knownSubscriptions")}
          meta={t("budget.knownSubscriptionsHint")}
          icon={<Plus size={17} />}
        >
          <div className="finance-catalog-groups">
            {catalogGroups.map((group) => (
              <section className="finance-catalog-group" key={group.key}>
                <h4>{group.label}</h4>
                <div className="finance-catalog-grid">
                  {group.items.map((subscription) => {
                    const added = existingServices.has(subscription.service.toLowerCase());
                    return (
                      <button
                        className="finance-catalog-item"
                        type="button"
                        key={subscription.service}
                        disabled={added}
                        onClick={() => addKnownSubscription(subscription)}
                      >
                        <SubscriptionLogo service={subscription.service} domain={subscription.domain} />
                        <span>
                          <strong>{subscription.service}</strong>
                          <small>{added ? t("budget.alreadyAdded") : group.label}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </BudgetEditorSection>
      </div> : null}
      <ConfirmDialog
        open={resetOpen}
        title={t("budget.resetTitle")}
        description={t("budget.resetDescription")}
        confirmLabel={t("budget.reset")}
        danger
        onClose={() => setResetOpen(false)}
        onConfirm={resetBudget}
      />
    </section>
  );
}

function AllocationDonut({
  allocation,
  positions,
  total,
  currency,
  locale,
  t,
}: {
  allocation: Array<[string, number]>;
  positions: VaultNote[];
  total: number;
  currency: string;
  locale: string;
  t: ReturnType<typeof useLanguage>["t"];
}) {
  const selection = useDonutSelection();
  const segments = allocation.map(([type, value]) => ({
    label: assetLabel(type, t),
    value,
    color: TYPE_COLORS[type],
    formattedValue: `${total ? Math.round(value / total * 100) : 0}%`,
  }));
  return (
    <div className="finance-allocation">
      <DonutRing
        segments={segments}
        centerValue={total ? "100%" : "0%"}
        centerSub={t("finance.invested")}
        ariaLabel={t("finance.allocation")}
        selection={selection}
      />
      <div className="finance-allocation-legend">
        {allocation.length === 0 && <span className="muted">{t("finance.none")}</span>}
        {allocation.map(([type, value], index) => {
          const typePositions = positions.filter((position) => assetTypeOf(position) === type).sort((a, b) => baseValueOf(b) - baseValueOf(a));
          const content = (
            <>
              <span className="finance-allocation-icon"><AssetTypeIcon type={type} /></span>
              <div className="finance-allocation-name">
                <span>{assetLabel(type, t)}</span>
                <small>{formatAmount(value, currency, locale)}{typePositions.length > 1 ? ` · ${typePositions.length} ${t("finance.holdings")}` : ""}</small>
              </div>
              <span className="finance-allocation-share">
                <strong>{total ? Math.round((value / total) * 100) : 0}%</strong>
                {typePositions.length > 1 && <ChevronDown size={14} aria-hidden />}
              </span>
            </>
          );
          const style = { "--asset-color": TYPE_COLORS[type] } as React.CSSProperties;
          // Hovering a row lights its slice; the click stays free for the
          // details disclosure, and the ring itself pins a slice.
          const sync = selection.hoverProps(index);
          const state = selection.active === null ? "" : selection.active === index ? " is-active" : " is-dim";
          if (typePositions.length < 2) {
            return <div className={`finance-allocation-item${state}`} key={type} style={style} {...sync}>{content}</div>;
          }
          return (
            <details className={`finance-allocation-group${state}`} key={type} style={style} {...sync}>
              <summary className="finance-allocation-item">{content}</summary>
              <div className="finance-suballocation">
                {typePositions.map((position) => {
                  const positionValue = baseValueOf(position);
                  const share = value ? positionValue / value * 100 : 0;
                  return (
                    <div className="finance-suballocation-item" key={position.id}>
                      <div><span>{position.title}</span><strong>{Math.round(share)}%</strong></div>
                      <span className="finance-suballocation-bar"><i style={{ width: `${share}%` }} /></span>
                      <small>{formatAmount(positionValue, currency, locale)}</small>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function RefreshAllButton() {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  return (
    <div className="finance-refresh-all">
      <button className="finance-refresh-compact" type="button" disabled={pending} title={t("finance.refreshAll")} aria-label={t("finance.refreshAll")} onClick={() => {
        startTransition(async () => {
          const result = await refreshAllFinancePositionPricesAction();
          setMessage(result.ok && "refreshed" in result ? `${result.refreshed} ${t("finance.pricesUpdated")}` : result.error || t("finance.refreshFailed"));
          router.refresh();
        });
      }}>
        <RefreshCw size={14} className={pending ? "is-spinning" : ""} />
      </button>
      {message && <small className="finance-refresh-message">{message}</small>}
    </div>
  );
}

export function FinanceList({ positions }: { positions: VaultNote[] }) {
  const { locale, t } = useLanguage();
  const router = useRouter();
  const [orderPaths, setOrderPaths] = useState<string[] | null>(null);
  const [draggedPath, setDraggedPath] = useState("");
  const [overPath, setOverPath] = useState("");
  const [reorderError, setReorderError] = useState("");
  const [reorderPending, startReorder] = useTransition();
  const [expandedPath, setExpandedPath] = useState("");
  const byPath = new Map(positions.map((position) => [position.relativePath, position]));
  const orderedPositions = orderPaths
    ? [
        ...orderPaths.map((relativePath) => byPath.get(relativePath)).filter((position): position is VaultNote => Boolean(position)),
        ...positions.filter((position) => !orderPaths.includes(position.relativePath)),
      ]
    : positions;

  function reorder(fromPath: string, toPath: string) {
    if (!fromPath || !toPath || fromPath === toPath || reorderPending) return;
    const fromIndex = orderedPositions.findIndex((position) => position.relativePath === fromPath);
    const toIndex = orderedPositions.findIndex((position) => position.relativePath === toPath);
    if (fromIndex < 0 || toIndex < 0) return;
    const previousPaths = orderedPositions.map((position) => position.relativePath);
    const next = [...orderedPositions];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    const nextPaths = next.map((position) => position.relativePath);
    setOrderPaths(nextPaths);
    setReorderError("");
    startReorder(async () => {
      const formData = new FormData();
      nextPaths.forEach((relativePath) => formData.append("paths", relativePath));
      const result = await reorderFinancePositionsAction(formData);
      if (!result.ok) {
        setOrderPaths(previousPaths);
        setReorderError(result.error || t("finance.reorderFailed"));
      } else {
        router.refresh();
      }
    });
  }

  if (!positions.length) return <div className="dash-empty">{t("finance.noneDescription")}</div>;

  return (
    <div className="finance-table-wrap">
      {reorderError && <div className="finance-reorder-error">{reorderError}</div>}
      <table className="finance-table">
        <thead><tr>
          <th>{t("finance.asset")}</th><th>{t("finance.daily")}</th>
          <th>{t("finance.value")}</th><th><span className="sr-only">{t("common.actions")}</span></th>
        </tr></thead>
        <tbody>{orderedPositions.map((position, index) => (
          <FinanceRow
            key={position.id}
            position={position}
            locale={locale}
            index={index}
            total={orderedPositions.length}
            reorderPending={reorderPending}
            expanded={expandedPath === position.relativePath}
            isDragging={draggedPath === position.relativePath}
            isDragOver={overPath === position.relativePath && draggedPath !== position.relativePath}
            onDragStart={() => setDraggedPath(position.relativePath)}
            onDragOver={() => { if (draggedPath && draggedPath !== position.relativePath) setOverPath(position.relativePath); }}
            onDrop={() => {
              reorder(draggedPath, position.relativePath);
              setDraggedPath("");
              setOverPath("");
            }}
            onDragEnd={() => { setDraggedPath(""); setOverPath(""); }}
            onToggle={() => setExpandedPath((current) => current === position.relativePath ? "" : position.relativePath)}
            onMove={(direction) => {
              const target = orderedPositions[index + direction];
              if (target) reorder(position.relativePath, target.relativePath);
            }}
          />
        ))}</tbody>
      </table>
    </div>
  );
}

function FinanceRow({
  position,
  locale,
  index,
  total,
  reorderPending,
  expanded,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onToggle,
  onMove,
}: {
  position: VaultNote;
  locale: string;
  index: number;
  total: number;
  reorderPending: boolean;
  expanded: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onToggle: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const { t } = useLanguage();
  const type = assetTypeOf(position);
  const quantity = numberOf(position.data.quantity);
  const unitPrice = numberOf(position.data.unit_price);
  const currency = sf(position.data.currency) || "EUR";
  const baseCurrency = sf(position.data.base_currency) || "EUR";
  const change = numberOf(position.data.market_change_percent);
  const identifier = sf(position.data.market_identifier) || sf(position.data.price_id);
  const symbol = sf(position.data.market_symbol);
  const error = sf(position.data.market_error);
  const detailsId = `finance-details-${position.id.replace(/[^a-z0-9]/gi, "-")}`;
  return (
    <>
      <tr
        className={`${expanded ? "is-expanded" : ""} ${isDragging ? "is-dragging" : ""} ${isDragOver ? "is-drag-over" : ""}`}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; onDragOver(); }}
        onDrop={(event) => { event.preventDefault(); onDrop(); }}
      >
        <td>
          <div className="finance-asset-cell">
            <span
              className="finance-drag-handle"
              draggable={!reorderPending}
              title={t("finance.dragPosition")}
              onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; onDragStart(); }}
              onDragEnd={onDragEnd}
            ><GripVertical size={15} aria-hidden /></span>
            <span className="finance-asset-icon" style={{ "--asset-color": TYPE_COLORS[type] } as React.CSSProperties}><AssetTypeIcon type={type} size={17} /></span>
            <div><strong>{position.title}</strong><span>{assetLabel(type, t)} {symbol ? `· ${symbol}` : identifier ? `· ${identifier}` : ""}</span></div>
            <button
              className="finance-row-expand"
              type="button"
              aria-expanded={expanded}
              aria-controls={detailsId}
              aria-label={`${t("finance.asset")} · ${position.title}`}
              onClick={onToggle}
            ><ChevronDown size={15} /></button>
          </div>
        </td>
        <td><span className={`finance-change ${change >= 0 ? "is-positive" : "is-negative"}`}>{change ? formatPercent(change, locale) : "—"}</span></td>
        <td><strong>{formatAmount(baseValueOf(position), baseCurrency, locale)}</strong>{currency !== baseCurrency && <small>{formatAmount(quantity * unitPrice, currency, locale)}</small>}</td>
        <td><PositionActions position={position} connected={Boolean(identifier)} index={index} total={total} reorderPending={reorderPending} onMove={onMove} /></td>
      </tr>
      {expanded && (
        <tr className="finance-position-details" id={detailsId}>
          <td colSpan={4}>
            <div className="finance-position-details-grid">
              <div>
                <span>{t("finance.unitPrice")}</span>
                <strong>{formatAmount(unitPrice, currency, locale)}</strong>
                <small>{sf(position.data.price_source) === "auto" ? t("finance.live") : t("finance.manual")}</small>
              </div>
              <div>
                <span>{t("finance.quantity")}</span>
                <strong>{new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en", { maximumFractionDigits: 6 }).format(quantity)}</strong>
                <small>{currency}</small>
              </div>
              <div className="finance-position-market">
                <span>{t("finance.marketData")}</span>
                {identifier ? <strong>{symbol || identifier}</strong> : <small>{t("finance.manual")}</small>}
                {!identifier && ["stock", "etf", "crypto"].includes(type) && <ConnectPosition position={position} />}
                {error && <small className="finance-row-error">{error}</small>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ConnectPosition({ position }: { position: VaultNote }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  if (!open) return <button className="finance-connect-trigger" type="button" onClick={() => setOpen(true)}><Link2 size={12} /> {t("finance.connect")}</button>;
  return (
    <form className="finance-connect-form" onSubmit={(event) => {
      event.preventDefault();
      setError("");
      const formData = new FormData(event.currentTarget);
      startTransition(async () => {
        const result = await connectFinancePositionAction(formData);
        if (!result.ok) setError(result.error || t("finance.refreshFailed"));
        else { setOpen(false); router.refresh(); }
      });
    }}>
      <input type="hidden" name="path" value={position.relativePath} />
      <input name="identifier" placeholder={position.data.asset_type === "crypto" ? "bitcoin" : "ISIN ou ticker"} required autoFocus />
      <button className="button secondary" disabled={pending}>{pending ? "…" : t("finance.connect")}</button>
      {error && <small className="finance-row-error">{error}</small>}
    </form>
  );
}

function PositionActions({
  position,
  connected,
  index,
  total,
  reorderPending,
  onMove,
}: {
  position: VaultNote;
  connected: boolean;
  index: number;
  total: number;
  reorderPending: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const run = (action: "refresh" | "delete") => startTransition(async () => {
    const formData = new FormData();
    formData.set("path", position.relativePath);
    if (action === "delete") await deleteFinancePositionAction(formData);
    else await refreshFinancePositionPriceAction(formData);
    router.refresh();
  });
  return (
    <>
    <div className="finance-row-actions">
      <button type="button" title={t("finance.moveUp")} disabled={reorderPending || index === 0} onClick={() => onMove(-1)}><ArrowUp size={13} /></button>
      <button type="button" title={t("finance.moveDown")} disabled={reorderPending || index === total - 1} onClick={() => onMove(1)}><ArrowDown size={13} /></button>
      <EditPositionButton position={position} />
      {connected && <button type="button" title={t("finance.refreshPrice")} disabled={pending} onClick={() => run("refresh")}><RefreshCw size={14} /></button>}
      <button type="button" className="danger" title={t("finance.delete")} disabled={pending} onClick={() => setDeleteOpen(true)}><Trash2 size={14} /></button>
    </div>
    <ConfirmDialog
      open={deleteOpen}
      title={t("finance.delete")}
      description={t("finance.deleteConfirm").replace("{title}", position.title)}
      confirmLabel={t("finance.delete")}
      danger
      onClose={() => setDeleteOpen(false)}
      onConfirm={() => run("delete")}
    />
    </>
  );
}

function EditPositionButton({ position }: { position: VaultNote }) {
  const { t } = useLanguage();
  const router = useRouter();
  const initialType = assetTypeOf(position);
  const [open, setOpen] = useState(false);
  const [assetType, setAssetType] = useState(initialType);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const usesMarketPrice = ["etf", "stock", "crypto"].includes(assetType);
  const identifier = sf(position.data.market_identifier) || sf(position.data.price_id);
  const currentCurrency = sf(position.data.currency) || "EUR";
  const assetOptions = Object.keys(ASSET_ICONS).map((type) => ({
    value: type,
    label: assetLabel(type, t),
    icon: <AssetTypeIcon type={type} size={15} />,
  }));
  const currencyOptions = [
    { value: "EUR", label: "EUR", hint: t("finance.currency.eur"), icon: <span className="finance-select-glyph">€</span> },
    { value: "USD", label: "USD", hint: t("finance.currency.usd"), icon: <span className="finance-select-glyph">$</span> },
    { value: "CHF", label: "CHF", hint: t("finance.currency.chf"), icon: <span className="finance-select-glyph">₣</span> },
    { value: "GBP", label: "GBP", hint: t("finance.currency.gbp"), icon: <span className="finance-select-glyph">£</span> },
    ...(!["EUR", "USD", "CHF", "GBP"].includes(currentCurrency) ? [{ value: currentCurrency, label: currentCurrency }] : []),
  ];

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending]);

  return (
    <>
      <button type="button" title={t("finance.editPosition")} aria-label={t("finance.editPosition")} onClick={() => {
        setAssetType(initialType);
        setError("");
        setOpen(true);
      }}><Pencil size={14} /></button>
      {open && createPortal((
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => { if (!pending) setOpen(false); }}>
          <section className="dialog finance-edit-dialog" role="dialog" aria-modal="true" aria-labelledby={`edit-${position.id.replace(/[^a-z0-9]/gi, "-")}`} onMouseDown={(event) => event.stopPropagation()}>
            <div className="dialog-header">
              <h2 id={`edit-${position.id.replace(/[^a-z0-9]/gi, "-")}`}>{t("finance.editPosition")}</h2>
              <button className="icon-button" type="button" disabled={pending} onClick={() => setOpen(false)} title={t("common.close")}><X size={16} /></button>
            </div>
            <form className="form compact-form finance-form" onSubmit={(event) => {
              event.preventDefault();
              setError("");
              const formData = new FormData(event.currentTarget);
              startTransition(async () => {
                const result = await updateFinancePositionAction(formData);
                if (!result.ok) setError(result.error || t("finance.updateFailed"));
                else {
                  setOpen(false);
                  router.refresh();
                }
              });
            }}>
              <input type="hidden" name="path" value={position.relativePath} />
              <label>
                {t("form.assetName")}
                <input name="title" defaultValue={position.title} required />
              </label>
              <div className="field-row">
                <label>
                  {t("form.type")}
                  <CustomSelect name="assetType" options={assetOptions} value={assetType} onChange={setAssetType} />
                </label>
                <label>
                  {t("form.currency")}
                  <CustomSelect name="currency" options={currencyOptions} defaultValue={currentCurrency} />
                </label>
              </div>
              <div className="field-row">
                <label>
                  {t("form.quantity")}
                  <input name="quantity" type="number" step="any" min="0" defaultValue={numberOf(position.data.quantity)} required />
                </label>
                {!usesMarketPrice && <label>
                  {t("finance.currentUnitValue")}
                  <input name="unitPrice" type="number" step="any" min="0" defaultValue={numberOf(position.data.unit_price)} required />
                </label>}
              </div>
              {usesMarketPrice && <label>
                {assetType === "crypto" ? t("form.cryptoId") : t("finance.identifier")}
                <input name="identifier" defaultValue={identifier} required />
                <small className="field-hint">{t("finance.identifierEditHint")}</small>
              </label>}
              {error && <div className="form-error">{error}</div>}
              <div className="finance-edit-actions">
                <button className="button secondary" type="button" disabled={pending} onClick={() => setOpen(false)}>{t("page.cancel")}</button>
                <button className="button primary" type="submit" disabled={pending}>{pending ? t("workspace.saving") : t("form.save")}</button>
              </div>
            </form>
          </section>
        </div>
      ), document.body)}
    </>
  );
}

// Kept as a small compatibility export for any dashboard embedding the old summary.
export const FinanceSummary = FinanceDashboard;
