import { TasksWorkspace } from "@/components/TasksWorkspace";
import { getDashboard } from "@/lib/vault";
import { getTranslations } from "@/lib/i18n-server";
import { readWorkspaceAppearancePreference } from "@/lib/ui-preferences";

export const dynamic = "force-dynamic";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const [data, t, appearance] = await Promise.all([getDashboard(), getTranslations(), readWorkspaceAppearancePreference()]);
  const { sort } = await searchParams;

  return (
    <>
      <div className="dash dash-full-bleed">
        <header className="dash-header">
          <div className="dash-greeting">
            <p className="eyebrow">{t["page.tasks.eyebrow"]}</p>
            <h1>{t["page.tasks.title"]}</h1>
            <p className="muted">{t["page.tasks.description"]}</p>
          </div>
        </header>
        <TasksWorkspace tasks={data.tasks} initialSort={sort === "priority" ? "priority" : undefined} initialAppearance={appearance} />
      </div>
    </>
  );
}
