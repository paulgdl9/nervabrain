import { ActionDialog } from "@/components/ActionDialog";
import { CaptureForm } from "@/components/Forms";
import { InboxWorkspace } from "@/components/KnowledgeWorkspaces";
import { getDashboard } from "@/lib/vault";
import { getTranslations } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const [data, t] = await Promise.all([getDashboard(), getTranslations()]);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">{t["page.inbox.eyebrow"]}</p>
          <h1>{t["page.inbox.title"]}</h1>
          <p className="muted">{t["page.inbox.description"]}</p>
        </div>
        <div className="header-actions">
          <ActionDialog title={t["page.inbox.newCapture"]} trigger={t["page.inbox.newCapture"]}>
            <CaptureForm />
          </ActionDialog>
        </div>
      </header>
      <InboxWorkspace initialFilter="open" notes={data.inbox} />
    </>
  );
}
