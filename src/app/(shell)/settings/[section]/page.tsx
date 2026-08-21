import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Clock3, ExternalLink } from "lucide-react";
import { saveAssistantSettingsAction } from "@/app/actions";
import { AiSettingsFields } from "@/components/SetupWizard";
import { ThemePicker, AccentPicker, PalettePicker, SurfacePicker } from "@/components/ThemePicker";
import { BackgroundPicker } from "@/components/BackgroundPicker";
import { CustomPagesSettings } from "@/components/CustomPages";
import { LanguagePicker } from "@/components/LanguagePicker";
import { BriefDetailSetting } from "@/components/BriefDetailSetting";
import { ModuleSettings } from "@/components/ModuleSettings";
import { CustomSelect } from "@/components/CustomSelect";
import { getTranslations } from "@/lib/i18n-server";
import { readAiBridgeStatus } from "@/lib/ai-bridge";
import { readBackgroundSettings } from "@/lib/background";
import { getDailyBriefBasePrompt, getDashboard, listAllCustomPages, readSetupState } from "@/lib/vault";
import { SETTINGS_SECTIONS, isSettingsSectionId } from "../sections";

export const dynamic = "force-dynamic";

export default async function SettingsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section: raw } = await params;
  if (!isSettingsSectionId(raw)) notFound();
  const section = SETTINGS_SECTIONS.find((entry) => entry.id === raw)!;
  const t = await getTranslations();

  // Only load what the requested section actually renders: the old single page
  // paid for the dashboard, the custom pages and the bridge probe every time.
  const setup = raw === "appearance" ? null : await readSetupState();

  return (
    <>
      <header className="page-header settings-detail-header">
        <Link className="settings-back" href="/settings">
          <ChevronLeft size={16} aria-hidden />
          {t["settings.back"]}
        </Link>
        <div>
          <p className="eyebrow">{t["settings.eyebrow"]}</p>
          <h1>{t[section.title]}</h1>
          <p className="settings-detail-lede">{t[section.description]}</p>
        </div>
      </header>

      <div className="settings-detail">
        {raw === "appearance" && <AppearanceSection />}
        {raw === "modules" && <ModuleSettings modules={setup!.modules} />}
        {raw === "assistant" && <AssistantSection />}
        {raw === "pages" && <CustomPagesSettings pages={await listAllCustomPages()} />}
        {raw === "advanced" && <AdvancedSection />}
      </div>
    </>
  );

  async function AppearanceSection() {
    const background = await readBackgroundSettings();
    return (
      <>
        <SettingsGroup title={t["theme.label"]}><ThemePicker /></SettingsGroup>
        <SettingsGroup title={t["surface.label"]}><SurfacePicker /></SettingsGroup>
        <SettingsGroup><AccentPicker /></SettingsGroup>
        <SettingsGroup title={t["palette.label"]}>
          <PalettePicker />
          <p className="accent-picker-hint muted">{t["palette.hint"]}</p>
        </SettingsGroup>
        <SettingsGroup><BackgroundPicker initial={background} /></SettingsGroup>
        <SettingsGroup><LanguagePicker /></SettingsGroup>
      </>
    );
  }

  async function AssistantSection() {
    const bridge = await readAiBridgeStatus(setup!.ai.verified);
    const mcpBaseUrl = process.env.NEXT_PUBLIC_MCP_BASE_URL?.trim().replace(/\/+$/, "");
    const hermesConfig = mcpBaseUrl ? `mcp_servers:
  nerva_brain:
    url: ${JSON.stringify(`${mcpBaseUrl}/api/mcp`)}
    auth: oauth
    oauth:
      scope: "read"` : "";
    const dailyBriefPromptValue = setup!.automation.dailyBriefPrompt || await getDailyBriefBasePrompt();
    const dailyModelOptions = (["claude", "codex"] as const).filter((provider) =>
      setup!.ai.verified.includes(provider) || bridge.engines[provider].verified,
    ).flatMap((provider) => {
      const models = [...new Set([setup!.ai.models[provider], ...bridge.models[provider].map((model) => model.id)].filter(Boolean))];
      const providerLabel = provider === "claude" ? "Claude" : "ChatGPT / Codex";
      return models.map((model) => ({ value: `${provider}:${model}`, label: `${providerLabel} · ${model}` }));
    });
    const dailyModel = setup!.automation.dailyBriefProvider && setup!.automation.dailyBriefModel
      ? `${setup!.automation.dailyBriefProvider}:${setup!.automation.dailyBriefModel}`
      : "inherit";
    return (
      <form action={saveAssistantSettingsAction} className="setup-form settings-ai-form">
        <AiSettingsFields state={setup!} bridge={bridge} />
        <BriefDetailSetting value={setup!.automation.briefDetail} />
        <div className="settings-group-card">
          <h3 className="settings-group-title">{t["settings.dailyBrief"]}</h3>
          <label>
            {t["settings.dailyBriefModel"]}
            <CustomSelect
              name="dailyBriefEngine"
              defaultValue={dailyModel}
              options={[{ value: "inherit", label: t["settings.dailyBriefModelDefault"] }, ...dailyModelOptions]}
            />
          </label>
          <label>
            {t["settings.dailyBriefPrompt"]}
            <textarea
              className="settings-prompt-field"
              name="dailyBriefPrompt"
              defaultValue={dailyBriefPromptValue}
              maxLength={12000}
              rows={10}
              placeholder={t["settings.dailyBriefPromptPlaceholder"]}
            />
          </label>
          <p className="muted">{t["settings.dailyBriefHint"]}</p>
        </div>
        <div className="settings-group-card">
          <h3 className="settings-group-title"><Clock3 size={14} /> {t["settings.briefSchedule"]}</h3>
          <div className="setup-two-columns">
            <label>{t["settings.briefFrequency"]}<CustomSelect name="briefFrequency" defaultValue={setup!.automation.briefFrequency} options={[{ value: "manual", label: t["settings.briefManual"] }, { value: "daily", label: t["settings.briefDaily"] }, { value: "twice_daily", label: t["settings.briefTwiceDaily"] }, { value: "weekly", label: t["settings.briefWeekly"] }, { value: "monthly", label: t["settings.briefMonthly"] }]} /></label>
            <label>{t["settings.briefTime"]}<input type="time" name="briefTime" defaultValue={setup!.automation.briefTime} /></label>
            <label>{t["settings.briefTime2"]}<input type="time" name="briefTime2" defaultValue={setup!.automation.briefTime2} /></label>
          </div>
          <p className="muted">{t["settings.briefScheduleHint"]}</p>
        </div>
        <button className="button primary" type="submit">{t["settings.saveAssistant"]}</button>
        <section className="settings-group-card settings-hermes">
          <h3 className="settings-group-title">{t["settings.hermesTitle"]}</h3>
          <p className="muted">{t["settings.hermesDescription"]}</p>
          {hermesConfig ? (
            <label>
              {t["settings.hermesConfig"]}
              <textarea className="settings-prompt-field" readOnly rows={6} spellCheck={false} value={hermesConfig} />
            </label>
          ) : <p className="muted" role="status">{t["settings.hermesNotConfigured"]}</p>}
          <p className="muted">{t["settings.hermesHint"]}</p>
          <a className="button secondary" href="https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/mcp.md">
            <ExternalLink size={15} aria-hidden />
            {t["settings.hermesDocs"]}
          </a>
        </section>
      </form>
    );
  }

  async function AdvancedSection() {
    const data = await getDashboard();
    return (
      <div className="metadata-grid">
        <div><span>Vault</span><strong>{data.vaultRoot}</strong></div>
        <div><span>Capture API</span><strong>/api/capture</strong></div>
        <div><span>Brief API</span><strong>/api/brief</strong></div>
        <div><span>{t["settings.health"]}</span><strong>/api/health</strong></div>
      </div>
    );
  }
}

function SettingsGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="settings-group-card">
      {title ? <h3 className="settings-group-title">{title}</h3> : null}
      {children}
    </section>
  );
}
