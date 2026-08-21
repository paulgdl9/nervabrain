"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Activity, BookOpenCheck, BriefcaseBusiness, Check, Landmark, Plus, WalletCards, X } from "lucide-react";
import { completeSetupAction, saveAiCredentialAction, saveSetupStepAction, verifyAiConnectionAction, type VerifyFailureReason } from "@/app/actions";
import { AiProviderLogo } from "@/components/AiProviderLogo";
import { CustomSelect } from "@/components/CustomSelect";
import { useLanguage } from "@/components/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import type { BridgeStatus } from "@/lib/ai-bridge";
import type { SetupGoal, SetupState, SetupStep } from "@/lib/vault";

type AiProvider = "claude" | "codex";

const OPTIONAL_STEPS = new Set<SetupStep>(["context", "feeds", "ai", "goals"]);
const WIZARD_STEPS = ["language", "ai", "context", "modules", "feeds", "goals", "review"] as const satisfies readonly SetupStep[];
const stepHref = (step: SetupStep) => `/setup/${step}`;

const TIMEZONES = typeof Intl.supportedValuesOf === "function"
  ? Intl.supportedValuesOf("timeZone")
  : ["Europe/Paris", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney", "UTC"];

const RSS_CATEGORIES = [
  "setup.rss.tech",
  "setup.rss.ai",
  "setup.rss.science",
  "setup.rss.health",
  "setup.rss.environment",
  "setup.rss.business",
  "setup.rss.cybersecurity",
  "setup.rss.design",
  "setup.rss.news",
  "setup.rss.culture",
  "setup.rss.sport",
] as const satisfies readonly TranslationKey[];

const RSS_CATALOG: Array<{ category: (typeof RSS_CATEGORIES)[number]; label: string; language: string; url: string }> = [
  { category: "setup.rss.tech", label: "Hacker News", language: "EN", url: "https://news.ycombinator.com/rss" },
  { category: "setup.rss.tech", label: "GitHub Changelog", language: "EN", url: "https://github.blog/changelog/feed/" },
  { category: "setup.rss.tech", label: "Mozilla Hacks", language: "EN", url: "https://hacks.mozilla.org/feed/" },
  { category: "setup.rss.tech", label: "Ars Technica", language: "US", url: "https://feeds.arstechnica.com/arstechnica/index" },
  { category: "setup.rss.tech", label: "The Verge", language: "US", url: "https://www.theverge.com/rss/index.xml" },
  { category: "setup.rss.tech", label: "TechCrunch", language: "US", url: "https://techcrunch.com/feed/" },
  { category: "setup.rss.tech", label: "Numerama", language: "FR", url: "https://www.numerama.com/feed/" },
  { category: "setup.rss.tech", label: "Frandroid", language: "FR", url: "https://www.frandroid.com/feed" },
  { category: "setup.rss.tech", label: "Next.ink", language: "FR", url: "https://next.ink/feed/" },
  { category: "setup.rss.ai", label: "OpenAI News", language: "EN", url: "https://openai.com/news/rss.xml" },
  { category: "setup.rss.ai", label: "Google AI", language: "EN", url: "https://blog.google/technology/ai/rss/" },
  { category: "setup.rss.ai", label: "Meta Engineering", language: "EN", url: "https://engineering.fb.com/feed/" },
  { category: "setup.rss.ai", label: "Hugging Face", language: "US", url: "https://huggingface.co/blog/feed.xml" },
  { category: "setup.rss.ai", label: "MIT Technology Review AI", language: "US", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed" },
  { category: "setup.rss.science", label: "NASA", language: "EN", url: "https://www.nasa.gov/feed/" },
  { category: "setup.rss.science", label: "NASA Earth Observatory", language: "EN", url: "https://earthobservatory.nasa.gov/feeds/image-of-the-day.rss" },
  { category: "setup.rss.science", label: "ScienceDaily", language: "EN", url: "https://www.sciencedaily.com/rss/top/science.xml" },
  { category: "setup.rss.science", label: "CNRS Le journal", language: "FR", url: "https://lejournal.cnrs.fr/rss" },
  { category: "setup.rss.science", label: "Futura Sciences", language: "FR", url: "https://www.futura-sciences.com/rss/actualites.xml" },
  { category: "setup.rss.science", label: "Nature", language: "EN", url: "https://www.nature.com/nature.rss" },
  { category: "setup.rss.science", label: "Smithsonian Magazine", language: "US", url: "https://www.smithsonianmag.com/rss/latest_articles/" },
  { category: "setup.rss.tech", label: "Inria", language: "FR", url: "https://www.inria.fr/fr/rss.xml" },
  { category: "setup.rss.health", label: "World Health Organization", language: "EN", url: "https://www.who.int/rss-feeds/news-english.xml" },
  { category: "setup.rss.health", label: "ScienceDaily Health", language: "EN", url: "https://www.sciencedaily.com/rss/top/health.xml" },
  { category: "setup.rss.health", label: "Inserm", language: "FR", url: "https://presse.inserm.fr/feed/" },
  { category: "setup.rss.health", label: "NIH News Releases", language: "US", url: "https://www.nih.gov/news-events/news-releases/rss.xml" },
  { category: "setup.rss.health", label: "Harvard Health", language: "US", url: "https://www.health.harvard.edu/blog/feed" },
  { category: "setup.rss.environment", label: "NASA Earth Science", language: "EN", url: "https://science.nasa.gov/feed/?science_org=19791%2C22453" },
  { category: "setup.rss.environment", label: "ScienceDaily Environment", language: "EN", url: "https://www.sciencedaily.com/rss/top/environment.xml" },
  { category: "setup.rss.environment", label: "ADEME Infos", language: "FR", url: "https://infos.ademe.fr/feed/" },
  { category: "setup.rss.environment", label: "Grist", language: "US", url: "https://grist.org/feed/" },
  { category: "setup.rss.business", label: "European Central Bank", language: "EN", url: "https://www.ecb.europa.eu/rss/press.html" },
  { category: "setup.rss.business", label: "BBC Business", language: "EN", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { category: "setup.rss.business", label: "Federal Reserve", language: "US", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { category: "setup.rss.business", label: "INSEE", language: "FR", url: "https://www.insee.fr/fr/flux-rss/ensemble" },
  { category: "setup.rss.cybersecurity", label: "CISA Advisories", language: "EN", url: "https://www.cisa.gov/cybersecurity-advisories/all.xml" },
  { category: "setup.rss.cybersecurity", label: "Google Security Blog", language: "EN", url: "https://security.googleblog.com/feeds/posts/default" },
  { category: "setup.rss.cybersecurity", label: "CERT-FR / ANSSI", language: "FR", url: "https://www.cert.ssi.gouv.fr/feed/" },
  { category: "setup.rss.cybersecurity", label: "Krebs on Security", language: "US", url: "https://krebsonsecurity.com/feed/" },
  { category: "setup.rss.cybersecurity", label: "The Hacker News", language: "US", url: "https://feeds.feedburner.com/TheHackersNews" },
  { category: "setup.rss.design", label: "Smashing Magazine", language: "EN", url: "https://www.smashingmagazine.com/feed/" },
  { category: "setup.rss.design", label: "A List Apart", language: "US", url: "https://alistapart.com/main/feed/" },
  { category: "setup.rss.design", label: "Creative Bloq", language: "EN", url: "https://www.creativebloq.com/feed" },
  { category: "setup.rss.news", label: "Le Monde", language: "FR", url: "https://www.lemonde.fr/rss/une.xml" },
  { category: "setup.rss.news", label: "France 24", language: "FR", url: "https://www.france24.com/fr/rss" },
  { category: "setup.rss.news", label: "NPR News", language: "US", url: "https://feeds.npr.org/1001/rss.xml" },
  { category: "setup.rss.news", label: "New York Times", language: "US", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml" },
  { category: "setup.rss.news", label: "Libération", language: "FR", url: "https://www.liberation.fr/arc/outboundfeeds/rss-all/?outputType=xml" },
  { category: "setup.rss.culture", label: "The Conversation France", language: "FR", url: "https://theconversation.com/fr/articles.atom" },
  { category: "setup.rss.culture", label: "France Culture", language: "FR", url: "https://www.radiofrance.fr/franceculture/rss" },
  { category: "setup.rss.culture", label: "Smithsonian Arts & Culture", language: "US", url: "https://www.smithsonianmag.com/rss/arts-culture/" },
  { category: "setup.rss.sport", label: "Cyclingnews", language: "EN", url: "https://www.cyclingnews.com/feeds/all/" },
  { category: "setup.rss.sport", label: "iRunFar", language: "EN", url: "https://www.irunfar.com/feed" },
  { category: "setup.rss.sport", label: "Bike Café", language: "FR", url: "https://bike-cafe.fr/feed/" },
  { category: "setup.rss.sport", label: "Distances+", language: "FR", url: "https://distances.plus/feed/" },
  { category: "setup.rss.sport", label: "Trail Runner", language: "US", url: "https://www.trailrunnermag.com/feed/" },
  { category: "setup.rss.sport", label: "Runner's World", language: "US", url: "https://www.runnersworld.com/rss/all.xml/" },
  { category: "setup.rss.sport", label: "VO2", language: "FR", url: "https://www.vo2.fr/feed/" },
  { category: "setup.rss.sport", label: "L'Équipe", language: "FR", url: "https://dwh.lequipe.fr/api/edito/rss?path=/" },
];

const GOAL_SUGGESTIONS: Array<{ title: TranslationKey; area: TranslationKey; next: TranslationKey }> = [
  { title: "setup.goal.health", area: "setup.goal.areaHealth", next: "setup.goal.healthNext" },
  { title: "setup.goal.adventure", area: "setup.goal.areaExperience", next: "setup.goal.adventureNext" },
  { title: "setup.goal.mastery", area: "setup.goal.areaGrowth", next: "setup.goal.masteryNext" },
  { title: "setup.goal.freedom", area: "setup.goal.areaFreedom", next: "setup.goal.freedomNext" },
  { title: "setup.goal.contribution", area: "setup.goal.areaContribution", next: "setup.goal.contributionNext" },
];

const AI_COMMANDS: Record<AiProvider, Array<{ label: TranslationKey; command: string }>> = {
  claude: [
    { label: "setup.aiCommandInstall", command: "docker compose up -d --build ai-bridge" },
    { label: "setup.aiCommandLogin", command: "docker compose exec ai-bridge claude auth login" },
    { label: "setup.aiCommandStatus", command: "docker compose exec ai-bridge claude auth status --text" },
  ],
  codex: [
    { label: "setup.aiCommandInstall", command: "docker compose up -d --build ai-bridge" },
    { label: "setup.aiCommandHeadless", command: "docker compose exec ai-bridge codex login --device-auth" },
    { label: "setup.aiCommandLogin", command: "docker compose exec ai-bridge codex login" },
    { label: "setup.aiCommandStatus", command: "docker compose exec ai-bridge codex login status" },
  ],
};

function StepActions({ step, nextDisabled = false }: { step: SetupStep; nextDisabled?: boolean }) {
  const { t } = useLanguage();
  const index = WIZARD_STEPS.indexOf(step);
  return (
    <div className="setup-actions">
      {index > 0 ? <Link className="button secondary" href={stepHref(WIZARD_STEPS[index - 1])}>{t("setup.back")}</Link> : <span />}
      <div className="setup-actions-next">
        {OPTIONAL_STEPS.has(step) ? <button className="button secondary" type="submit" name="skip" value="true">{t("setup.skip")}</button> : null}
        <button className="button primary" type="submit" disabled={nextDisabled}>{t("setup.next")}</button>
      </div>
    </div>
  );
}

function CommandBlock({ label, command }: { label: string; command: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }
  return (
    <div className="setup-command">
      <small>{label}</small>
      <code>{command}</code>
      <button type="button" onClick={copy} aria-label={`${t("setup.copyCommand")}: ${command}`}>{copied ? t("setup.copied") : t("setup.copy")}</button>
    </div>
  );
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  const { t } = useLanguage();
  return <span className={`setup-status ${ok ? "is-ready" : ""}`}>{label}: {ok ? t("setup.ready") : t("setup.notReady")}</span>;
}

function ContextStep({ state }: { state: SetupState["context"] }) {
  const { t } = useLanguage();
  const [context, setContext] = useState({
    identity: state.identity,
    focusAreas: state.focusAreas,
    weeklyRhythm: state.weeklyRhythm,
    operatingRules: state.operatingRules.join("\n"),
    currentPriorities: state.currentPriorities.join("\n"),
  });
  const set = (key: keyof typeof context, value: string) => setContext((current) => ({ ...current, [key]: value }));

  return (
    <div className="setup-context-layout">
      <div className="setup-questions">
        {([
          ["identity", "setup.question.identity", "setup.question.identityHint", "setup.identityPlaceholder", 4],
          ["focusAreas", "setup.question.help", "setup.question.helpHint", "setup.focusAreasPlaceholder", 3],
          ["weeklyRhythm", "setup.question.rhythm", "setup.question.rhythmHint", "setup.weeklyRhythmPlaceholder", 2],
          ["operatingRules", "setup.question.preferences", "setup.question.preferencesHint", "setup.linePlaceholder", 4],
          ["currentPriorities", "setup.question.priorities", "setup.question.prioritiesHint", "setup.priorityPlaceholder", 4],
        ] as const).map(([key, label, hint, placeholder, rows], index) => (
          <label className="setup-question" key={key}>
            <span className="setup-question-number">{index + 1}</span>
            <span className="setup-question-copy"><strong>{t(label)}</strong><small>{t(hint)}</small></span>
            <textarea name={key} rows={rows} value={context[key]} placeholder={t(placeholder)} onChange={(event) => set(key, event.target.value)} />
          </label>
        ))}
        <input type="hidden" name="contactEmail" value={state.contactEmail} />
      </div>
      <aside className="setup-context-preview">
        <span className="eyebrow">{t("setup.contextPreview")}</span>
        <h2>{t("setup.contextPreviewTitle")}</h2>
        <p><strong>{t("setup.contextSectionSituation")}</strong><br />{context.identity || t("setup.contextExampleSituation")}</p>
        <p><strong>{t("setup.contextSectionGoals")}</strong><br />{context.focusAreas || t("setup.contextExampleGoals")}</p>
        <p><strong>{t("setup.contextSectionPriorities")}</strong><br />{context.currentPriorities || t("setup.contextExamplePriorities")}</p>
        <p><strong>{t("setup.contextSectionRules")}</strong><br />{context.operatingRules || t("setup.contextExampleRules")}</p>
        {context.weeklyRhythm ? <p><strong>{t("setup.weeklyRhythm")}</strong><br />{context.weeklyRhythm}</p> : null}
      </aside>
    </div>
  );
}

function ModuleStep({ state }: { state: SetupState }) {
  const { t } = useLanguage();
  const [modules, setModules] = useState({ finance: state.modules.finance, budget: state.modules.budget, trail: state.modules.trail, business: state.modules.business, revisions: state.modules.revisions });
  const [customModules, setCustomModules] = useState(state.modules.custom);
  const [customTitle, setCustomTitle] = useState("");
  const financeEnabled = modules.finance || modules.budget || modules.business;
  const moduleCards = [
    { key: "trail" as const, icon: <Activity size={20} />, label: "setup.module.trail", description: "setup.module.trailDescription" },
    { key: "business" as const, icon: <BriefcaseBusiness size={20} />, label: "setup.module.business", description: "setup.module.businessDescription" },
    { key: "revisions" as const, icon: <BookOpenCheck size={20} />, label: "setup.module.revisions", description: "setup.module.revisionsDescription" },
    { key: "finance" as const, icon: <Landmark size={20} />, label: "setup.module.finance", description: "setup.module.financeDescription" },
    { key: "budget" as const, icon: <WalletCards size={20} />, label: "setup.module.budget", description: "setup.module.budgetDescription" },
  ];

  function addCustomModule() {
    const title = customTitle.trim();
    if (!title || customModules.some((item) => item.toLowerCase() === title.toLowerCase())) return;
    setCustomModules((current) => [...current, title]);
    setCustomTitle("");
  }

  return (
    <>
      <fieldset className="setup-fieldset">
        <legend>{t("setup.modulesLegend")}</legend>
        <p className="setup-hint">{t("setup.modulesHint")}</p>
        <div className="setup-module-grid">
          {moduleCards.map((module) => (
            <label className={`setup-module-card ${modules[module.key] ? "is-selected" : ""}`} key={module.key}>
              <input
                type="checkbox"
                name={module.key}
                checked={modules[module.key]}
                onChange={(event) => setModules((current) => ({ ...current, [module.key]: event.target.checked }))}
              />
              <span className="setup-module-icon">{module.icon}</span>
              <span><strong>{t(module.label as TranslationKey)}</strong><small>{t(module.description as TranslationKey)}</small></span>
              <span className="setup-module-check" aria-hidden="true"><Check size={14} /></span>
            </label>
          ))}
        </div>
      </fieldset>

      {financeEnabled ? (
        <label className="setup-currency-field">
          <span>{t("setup.currency")}</span>
          <small>{t("setup.currencyHint")}</small>
          <CustomSelect
            name="currency"
            defaultValue={state.currency}
            options={[
              { value: "EUR", label: t("finance.currency.eur"), hint: "EUR" },
              { value: "USD", label: t("finance.currency.usd"), hint: "USD" },
              { value: "CHF", label: t("finance.currency.chf"), hint: "CHF" },
              { value: "GBP", label: t("finance.currency.gbp"), hint: "GBP" },
            ]}
          />
        </label>
      ) : null}

      <section className="setup-custom-modules">
        <div><h2>{t("setup.customModuleTitle")}</h2><p>{t("setup.customModuleHint")}</p></div>
        <div className="setup-custom-module-form">
          <input value={customTitle} placeholder={t("setup.customModulePlaceholder")} onChange={(event) => setCustomTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomModule(); } }} />
          <button className="button secondary" type="button" disabled={!customTitle.trim()} onClick={addCustomModule}><Plus size={15} />{t("setup.customModuleAdd")}</button>
        </div>
        {customModules.length ? <div className="setup-custom-module-list">{customModules.map((title) => <span key={title}>{title}<button type="button" aria-label={`${t("setup.remove")}: ${title}`} onClick={() => setCustomModules((current) => current.filter((item) => item !== title))}><X size={13} /></button></span>)}</div> : null}
        <input type="hidden" name="customModules" value={JSON.stringify(customModules)} />
      </section>
    </>
  );
}

function FeedsStep({ state }: { state: SetupState["feeds"] }) {
  const { t } = useLanguage();
  const [enabled, setEnabled] = useState(state.enabled);
  const selectedFeeds = new Set(state.urls);
  const catalogUrls = new Set(RSS_CATALOG.map((feed) => feed.url));
  const customFeeds = state.urls.filter((url) => !catalogUrls.has(url));
  return (
    <>
      <input type="hidden" name="feedsEnabled" value={String(enabled)} />
      <button className={`setup-switch ${enabled ? "is-on" : ""}`} type="button" role="switch" aria-checked={enabled} onClick={() => setEnabled((current) => !current)}>
        <span className="setup-switch-track"><span /></span>
        <span><strong>{t("setup.enableFeeds")}</strong><small>{t("setup.enableFeedsHint")}</small></span>
      </button>
      <fieldset className="setup-fieldset" disabled={!enabled}>
        <legend>{t("setup.feedCatalog")}</legend>
        <p className="setup-hint">{t("setup.feedCatalogHint")}</p>
        <div className="setup-feed-categories">
          {RSS_CATEGORIES.map((category, index) => {
            const feeds = RSS_CATALOG.filter((feed) => feed.category === category);
            return (
              <details className="setup-feed-category" open={index === 0} key={category}>
                <summary><span>{t(category)}</span><small>{t("setup.sourceCount").replace("{count}", String(feeds.length))}</small></summary>
                <div className="setup-feed-grid">
                  {feeds.map((feed) => (
                    <label className="setup-feed-choice" key={feed.url}>
                      <input type="checkbox" name="feeds" value={feed.url} defaultChecked={selectedFeeds.has(feed.url)} />
                      <span><strong>{feed.label}</strong><small>{feed.language}</small></span>
                      <Check size={13} aria-hidden="true" />
                    </label>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </fieldset>
      <label>{t("setup.customFeeds")}<textarea name="feeds" rows={4} disabled={!enabled} defaultValue={customFeeds.join("\n")} placeholder={t("setup.feedsPlaceholder")} /></label>
    </>
  );
}

// A sticky (still-verified) failure and a genuine not-connected failure need
// different copy: the same quota hit must read as "still connected, quota
// reached" when a prior verification stands, not "not connected".
const VERIFY_REASON_STALE_KEYS: Record<VerifyFailureReason, TranslationKey> = {
  bridge: "setup.verifyReasonBridgeStale",
  quota: "setup.verifyReasonQuotaStale",
  auth: "setup.verifyReasonAuthStale",
  unknown: "setup.verifyReasonUnknownStale",
};
const VERIFY_REASON_ERROR_KEYS: Record<VerifyFailureReason, TranslationKey> = {
  bridge: "setup.verifyReasonBridgeError",
  quota: "setup.verifyReasonQuotaError",
  auth: "setup.verifyReasonAuthError",
  unknown: "setup.verifyReasonUnknownError",
};

function AiProviderCard({ provider, status, onVerified }: { provider: AiProvider; status: BridgeStatus["engines"][AiProvider]; onVerified: (provider: AiProvider, verified: boolean) => void }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [method, setMethod] = useState<"api_key" | "cli">(status.method);
  const [apiKey, setApiKey] = useState("");
  // "stale" = a previously verified connection whose latest check failed;
  // the connection stays visually verified (sticky) and only a transient
  // hint is shown, so a quota hit never reads as "disconnected".
  const [action, setAction] = useState<"idle" | "saving" | "saved" | "verifying" | "verified" | "stale" | "error">(status.verified ? "verified" : "idle");
  const [failureReason, setFailureReason] = useState<VerifyFailureReason | null>(null);
  const verified = action === "verified" || action === "stale" || (action === "idle" && status.verified);
  const name = provider === "claude" ? "Claude" : "ChatGPT / Codex";

  async function saveKey() {
    setAction("saving");
    setFailureReason(null);
    const result = await saveAiCredentialAction(provider, apiKey);
    setApiKey("");
    setAction(result.ok ? "saved" : "error");
    onVerified(provider, false);
    if (result.ok) router.refresh();
  }

  async function verify() {
    setAction("verifying");
    setFailureReason(null);
    const result = await verifyAiConnectionAction(provider);
    if (result.ok) {
      setAction("verified");
      onVerified(provider, true);
      router.refresh();
      return;
    }
    setFailureReason(result.reason);
    setAction(result.stillVerified ? "stale" : "error");
    onVerified(provider, result.stillVerified);
  }

  return (
    <section className={`setup-ai-provider is-${provider} ${verified ? "is-verified" : ""}`}>
      <div className="setup-ai-provider-heading">
        <span className="setup-ai-mark"><AiProviderLogo provider={provider} /></span>
        <div><h2>{name}</h2><p>{t(provider === "claude" ? "setup.claudeCardDescription" : "setup.codexCardDescription")}</p></div>
        {verified ? <span className="setup-ai-verified"><Check size={13} />{t("setup.connectionVerified")}</span> : null}
      </div>
      <div className="setup-ai-methods" role="group" aria-label={`${name}: ${t("setup.aiConnectionMethod")}`}>
        <button className={method === "api_key" ? "is-active" : ""} type="button" onClick={() => setMethod("api_key")}>{t("setup.aiApiKey")}</button>
        <button className={method === "cli" ? "is-active" : ""} type="button" onClick={() => setMethod("cli")}>{t("setup.aiCliLogin")}</button>
      </div>
      {method === "api_key" ? (
        <div className="setup-ai-key">
          <label>{t(provider === "claude" ? "setup.anthropicApiKey" : "setup.openaiApiKey")}<input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={provider === "claude" ? "sk-ant-…" : "sk-…"} /></label>
          <p>{t("setup.apiKeyPrivacy")}</p>
          {!status.installed ? <div className="setup-ai-commands"><p>{t("setup.apiKeyRuntime")}</p><CommandBlock label={t("setup.aiCommandInstall")} command={AI_COMMANDS[provider][0].command} /></div> : null}
          <button className="button secondary" type="button" disabled={apiKey.length < 20 || action === "saving"} onClick={saveKey}>{action === "saving" ? t("setup.saving") : t("setup.saveApiKey")}</button>
        </div>
      ) : (
        <details className="setup-ai-cli">
          <summary>{t("setup.cliToggle")}</summary>
          <p>{t("setup.cliInstructions")}</p>
          {AI_COMMANDS[provider].map((item) => <CommandBlock key={item.command} label={t(item.label)} command={item.command} />)}
        </details>
      )}
      <div className="setup-ai-provider-footer">
        <div className="setup-ai-provider-state" aria-live="polite">
          <Status ok={status.installed} label={t("setup.cliInstalled")} />
          <span className={`setup-status ${verified ? "is-ready" : ""}`}>{verified ? t("setup.connectionVerified") : action === "error" ? t("setup.connectionFailed") : action === "saved" ? t("setup.keySaved") : status.configured ? t("setup.connectionConfigured") : t("setup.connectionPending")}</span>
        </div>
        {failureReason ? <p className={`setup-ai-verify-hint ${action === "error" ? "is-error" : ""}`}>{t(action === "error" ? VERIFY_REASON_ERROR_KEYS[failureReason] : VERIFY_REASON_STALE_KEYS[failureReason])}</p> : null}
        <button className="button primary" type="button" disabled={!status.installed || action === "verifying"} onClick={verify}>{action === "verifying" ? t("setup.verifying") : verified ? t("setup.verifyAgain") : t("setup.verifyConnection")}</button>
      </div>
    </section>
  );
}

export function AiSettingsFields({ state, bridge }: { state: SetupState; bridge?: BridgeStatus }) {
  const { t } = useLanguage();
  const router = useRouter();
  const initialVerified = (["claude", "codex"] as const).filter((provider) => state.ai.verified.includes(provider) || bridge?.engines[provider].verified);
  const [verifiedProviders, setVerifiedProviders] = useState<Set<AiProvider>>(new Set(initialVerified));
  const [primary, setPrimary] = useState<SetupState["ai"]["primary"]>(state.ai.primary);
  const [models, setModels] = useState(state.ai.models);
  const connected = (["claude", "codex"] as const).filter((provider) => verifiedProviders.has(provider));
  const effectivePrimary = connected.length === 0
    ? ""
    : connected.length === 1
      ? connected[0]
      : connected.includes(primary as AiProvider) ? primary : connected[0];

  function setProviderVerified(provider: AiProvider, verified: boolean) {
    setVerifiedProviders((current) => {
      const next = new Set(current);
      if (verified) next.add(provider); else next.delete(provider);
      return next;
    });
  }

  const fallback = connected.length === 2 ? connected.find((provider) => provider !== effectivePrimary) || "" : "";
  const effectiveModels = Object.fromEntries((["claude", "codex"] as const).map((provider) => {
    const available = bridge?.models[provider] || [];
    const selected = available.some((model) => model.id === models[provider]) ? models[provider] : available[0]?.id || models[provider];
    return [provider, selected];
  })) as SetupState["ai"]["models"];
  return (
    <>
      <div className="setup-bridge">
        <div><h2>{t("setup.aiBridge")}</h2><p>{t("setup.bridgeHint")}</p></div>
        <div className="setup-statuses"><Status ok={bridge?.configured === true} label={t("setup.bridgeConfigured")} /><Status ok={bridge?.reachable === true} label={t("setup.bridgeReachable")} /></div>
      </div>
      {bridge?.reachable !== true ? (
        <div className="setup-bridge-help">
          <p>{t("setup.bridgeStartHint")}</p>
          <CommandBlock label={t("setup.bridgeStartCommand")} command="docker compose up -d ai-bridge" />
          <button className="button secondary" type="button" onClick={() => router.refresh()}>{t("setup.refreshBridge")}</button>
        </div>
      ) : null}
      <div className="setup-ai-providers">
        {(["claude", "codex"] as const).map((provider) => <AiProviderCard key={provider} provider={provider} status={bridge?.engines[provider] || { installed: false, configured: false, verified: state.ai.verified.includes(provider), method: "cli" }} onVerified={setProviderVerified} />)}
      </div>
      <input type="hidden" name="aiPrimary" value={effectivePrimary} />
      <input type="hidden" name="aiFallback" value={fallback} />
      <input type="hidden" name="aiClaudeModel" value={effectiveModels.claude} />
      <input type="hidden" name="aiCodexModel" value={effectiveModels.codex} />
      <section className="setup-engine-order">
        <div><h2>{t("setup.aiOrderTitle")}</h2><p>{t("setup.aiOrderHint")}</p></div>
        {connected.length === 0 ? <p className="setup-engine-empty">{t("setup.noVerifiedAi")}</p> : null}
        {connected.length === 1 ? <div className="setup-engine-auto"><Check size={15} /><span><strong>{connected[0] === "claude" ? "Claude" : "ChatGPT / Codex"}</strong><small>{t("setup.aiPrimaryAutomatic")}</small></span></div> : null}
        {connected.length === 2 ? (
          <div className="setup-two-columns">
            <label>{t("setup.aiPrimary")}<CustomSelect name="aiPrimaryDisplay" value={effectivePrimary} onChange={(value) => setPrimary(value as AiProvider)} options={connected.map((provider) => ({ value: provider, label: provider === "claude" ? "Claude" : "ChatGPT / Codex" }))} /></label>
            <div className="setup-engine-auto"><span><strong>{fallback === "claude" ? "Claude" : "ChatGPT / Codex"}</strong><small>{t("setup.aiFallbackAutomatic")}</small></span></div>
          </div>
        ) : null}
        {connected.length ? (
          <div className="setup-model-grid">
            {connected.map((provider) => {
              const name = provider === "claude" ? "Claude" : "ChatGPT / Codex";
              const options = bridge?.models[provider] || [];
              return (
                <label key={provider}>
                  {t("setup.aiModel").replace("{provider}", name)}
                  {options.length ? (
                    <CustomSelect
                      name={`ai${provider}ModelDisplay`}
                      value={effectiveModels[provider]}
                      onChange={(value) => setModels((current) => ({ ...current, [provider]: value }))}
                      options={options.map((model) => ({ value: model.id, label: model.label, hint: model.id === model.label ? undefined : model.id }))}
                    />
                  ) : <span className="setup-model-unavailable">{t("setup.aiModelsUnavailable")}</span>}
                </label>
              );
            })}
          </div>
        ) : null}
      </section>
    </>
  );
}

function GoalsStep({ initialGoals }: { initialGoals: SetupGoal[] }) {
  const { t } = useLanguage();
  const [goals, setGoals] = useState<SetupGoal[]>(initialGoals.length ? initialGoals : [{ title: "", area: "", nextStep: "" }]);
  const updateGoal = (index: number, key: keyof SetupGoal, value: string) => setGoals((current) => current.map((goal, goalIndex) => goalIndex === index ? { ...goal, [key]: value } : goal));

  function toggleSuggestion(suggestion: (typeof GOAL_SUGGESTIONS)[number], checked: boolean) {
    const title = t(suggestion.title);
    setGoals((current) => checked
      ? [...current.filter((goal) => goal.title || goal.area || goal.nextStep), { title, area: t(suggestion.area), nextStep: t(suggestion.next) }]
      : current.filter((goal) => goal.title !== title));
  }

  return (
    <>
      <fieldset className="setup-fieldset">
        <legend>{t("setup.goalSuggestions")}</legend>
        <p className="setup-hint">{t("setup.goalSuggestionsHint")}</p>
        <div className="setup-choice-grid">
          {GOAL_SUGGESTIONS.map((suggestion) => {
            const title = t(suggestion.title);
            return <label className="setup-choice" key={suggestion.title}><input type="checkbox" checked={goals.some((goal) => goal.title === title)} onChange={(event) => toggleSuggestion(suggestion, event.target.checked)} /><span><strong>{title}</strong><small>{t(suggestion.next)}</small></span></label>;
          })}
        </div>
      </fieldset>
      <div className="setup-goals">
        <div className="setup-section-heading"><h2>{t("setup.yourGoals")}</h2><button className="button secondary" type="button" onClick={() => setGoals((current) => [...current, { title: "", area: "", nextStep: "" }])}>{t("setup.addGoal")}</button></div>
        {goals.map((goal, index) => (
          <div className="setup-goal" key={index}>
            <label>{t("setup.goalTitle")}<input value={goal.title} onChange={(event) => updateGoal(index, "title", event.target.value)} /></label>
            <label>{t("setup.goalArea")}<input value={goal.area} placeholder={t("setup.goalAreaPlaceholder")} onChange={(event) => updateGoal(index, "area", event.target.value)} /></label>
            <label className="is-wide">{t("setup.goalNext")}<input value={goal.nextStep} onChange={(event) => updateGoal(index, "nextStep", event.target.value)} /></label>
            {goals.length > 1 ? <button className="button secondary setup-remove" type="button" onClick={() => setGoals((current) => current.filter((_, goalIndex) => goalIndex !== index))}>{t("setup.remove")}</button> : null}
          </div>
        ))}
      </div>
      <input type="hidden" name="goals" value={JSON.stringify(goals)} />
    </>
  );
}

export function SetupWizard({ step, state, error, bridge }: { step: SetupStep; state: SetupState; error?: string; bridge?: BridgeStatus }) {
  const { t } = useLanguage();
  const stepIndex = WIZARD_STEPS.indexOf(step);
  const titleKey = `setup.step.${step}` as TranslationKey;
  const descriptionKey = `setup.step.${step}Description` as TranslationKey;
  const moduleNames = [
    state.modules.trail && t("setup.module.trail"),
    state.modules.business && t("setup.module.business"),
    state.modules.revisions && t("setup.module.revisions"),
    state.modules.finance && t("setup.module.finance"),
    state.modules.budget && t("setup.module.budget"),
    ...state.modules.custom,
  ].filter(Boolean).join(", ");
  const selectedAi = [state.ai.primary, state.ai.fallback].filter((provider): provider is AiProvider => Boolean(provider));
  const aiSummary = selectedAi.length
    ? selectedAi.map((provider) => {
      const name = provider === "codex" ? "ChatGPT / Codex" : "Claude";
      const configured = state.ai.models[provider] ? `${name} · ${state.ai.models[provider]}` : name;
      return state.ai.verified.includes(provider) ? configured : `${configured} · ${t("setup.connectionNeedsVerification")}`;
    }).join(" → ")
    : t("setup.none");

  return (
    <main className="setup-page">
      <div className="setup-frame">
        <header className="setup-header"><Link className="setup-brand" href="/setup">{process.env.NEXT_PUBLIC_APP_NAME || "NervaBrain"}</Link><span>{t("setup.privateLocal")}</span></header>
        <ol className="setup-progress" aria-label={t("setup.progressLabel")}>{WIZARD_STEPS.map((setupStep, index) => <li aria-current={index === stepIndex ? "step" : undefined} className={index === stepIndex ? "is-current" : index < stepIndex ? "is-done" : ""} key={setupStep}><span>{index < stepIndex ? <Check size={14} aria-hidden /> : index + 1}</span><small>{t(`setup.step.${setupStep}` as TranslationKey)}</small></li>)}</ol>
        <section className="setup-card">
          <div className="setup-intro"><p className="eyebrow">{t("setup.stepCount").replace("{current}", String(stepIndex + 1)).replace("{total}", String(WIZARD_STEPS.length))}</p><h1>{t(titleKey)}</h1><p className="muted">{t(descriptionKey)}</p></div>
          {error ? <div className="setup-error" role="alert">{t(error === "required" ? "setup.errorRequired" : "setup.errorInvalid")}</div> : null}
          {step === "review" ? (
            <>
              <div className="setup-review">
                <section><h2>{t("setup.step.language")}</h2><p>{state.locale.toUpperCase()} · {state.timezone}</p><Link href={stepHref("language")}>{t("setup.edit")}</Link></section>
                <section><h2>{t("setup.step.context")}</h2><p>{state.context.identity || t("setup.notProvided")}</p><Link href={stepHref("context")}>{t("setup.edit")}</Link></section>
                <section><h2>{t("setup.step.modules")}</h2><p>{moduleNames || t("setup.none")}{state.modules.finance || state.modules.budget || state.modules.business ? ` · ${state.currency}` : ""}</p><Link href={stepHref("modules")}>{t("setup.edit")}</Link></section>
                <section><h2>{t("setup.step.feeds")}</h2><p>{state.feeds.enabled ? t("setup.feedSummary").replace("{count}", String(state.feeds.urls.length)) : t("setup.feedsDisabled")}</p><Link href={stepHref("feeds")}>{t("setup.edit")}</Link></section>
                <section><h2>{t("setup.step.ai")}</h2><p>{aiSummary}</p><Link href={stepHref("ai")}>{t("setup.edit")}</Link></section>
                <section><h2>{t("setup.step.goals")}</h2><p>{t("setup.goalSummary").replace("{count}", String(state.goals.length))}</p><Link href={stepHref("goals")}>{t("setup.edit")}</Link></section>
              </div>
              <form action={completeSetupAction}><div className="setup-actions"><Link className="button secondary" href={stepHref("goals")}>{t("setup.back")}</Link><button className="button primary" type="submit">{state.status === "completed" ? t("setup.saveChanges") : t("setup.finish")}</button></div></form>
            </>
          ) : (
            <form action={saveSetupStepAction} className="setup-form">
              <input type="hidden" name="step" value={step} />
              {step === "language" ? <><label>{t("language.current")}<CustomSelect name="locale" defaultValue={state.locale} options={[{ value: "fr", label: t("language.french") }, { value: "en", label: t("language.english") }]} /></label><label>{t("setup.timezone")}<CustomSelect name="timezone" defaultValue={state.timezone} searchable searchPlaceholder={t("setup.searchTimezone")} options={[...new Set([state.timezone, ...TIMEZONES])].filter(Boolean).map((timezone) => ({ value: timezone, label: timezone.replaceAll("_", " ") }))} /></label></> : null}
              {step === "context" ? <ContextStep state={state.context} /> : null}
              {step === "modules" ? <ModuleStep state={state} /> : null}
              {step === "feeds" ? <FeedsStep state={state.feeds} /> : null}
              {step === "ai" ? <AiSettingsFields state={state} bridge={bridge} /> : null}
              {step === "goals" ? <GoalsStep initialGoals={state.goals} /> : null}
              <StepActions step={step} />
            </form>
          )}
        </section>
        <p className="setup-footer">{t("setup.footer")}</p>
      </div>
    </main>
  );
}
