import { ActionDialog } from "@/components/ActionDialog";
import { WikiForm } from "@/components/Forms";
import { WikiWorkspace } from "@/components/KnowledgeWorkspaces";
import { getDashboard } from "@/lib/vault";
import { getTranslations } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function WikiPage() {
  const [data, t] = await Promise.all([getDashboard(), getTranslations()]);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">{t["page.wiki.eyebrow"]}</p>
          <h1>{t["page.wiki.title"]}</h1>
          <p className="muted">{t["page.wiki.description"]}</p>
        </div>
        <div className="header-actions">
          <ActionDialog title={t["page.wiki.newArticle"]} trigger={t["page.wiki.newArticle"]}>
            <WikiForm />
          </ActionDialog>
        </div>
      </header>
      <WikiWorkspace notes={data.wiki} />
    </>
  );
}
