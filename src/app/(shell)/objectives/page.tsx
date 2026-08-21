import { ObjectivesWorkspace } from "@/components/ObjectivesWorkspace";
import { getDashboard } from "@/lib/vault";
import { getTranslations } from "@/lib/i18n-server";
import { readWorkspaceAppearancePreference } from "@/lib/ui-preferences";

export const dynamic = "force-dynamic";

export default async function ObjectivesPage() {
  const [data, t, appearance] = await Promise.all([getDashboard(), getTranslations(), readWorkspaceAppearancePreference()]);

  return (
    <>
      <div className="dash">
        <header className="dash-header">
          <div className="dash-greeting">
            <p className="eyebrow">{t["page.objectives.eyebrow"]}</p>
            <h1>{t["page.objectives.title"]}</h1>
            <p className="muted">{t["page.objectives.description"]}</p>
          </div>
        </header>
        <ObjectivesWorkspace objectives={data.objectives} initialAppearance={appearance} />
      </div>
    </>
  );
}
