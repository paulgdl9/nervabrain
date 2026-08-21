import { DailyWorkspace, type DailyBrief } from "@/components/DailyWorkspace";
import { GenerateBriefButton } from "@/components/Forms";
import { getDashboard, noteHref } from "@/lib/vault";
import { readBriefSuggestions } from "@/lib/brief-suggestions";
import { getTranslations } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function DailyPage() {
  const [data, t] = await Promise.all([getDashboard(), getTranslations()]);
  // Server-side read: a client GET to our own /api/* has no Origin header and 401s.
  const suggestions = Object.fromEntries(await Promise.all(
    data.daily.map(async (note) => [note.relativePath, await readBriefSuggestions(note.relativePath)] as const),
  ));

  const briefs: DailyBrief[] = data.daily.map((note) => ({
    suggestions: suggestions[note.relativePath] || [],
    id: note.id,
    path: note.relativePath,
    date: String(note.data.date || note.data.created || note.mtime),
    href: noteHref(note),
    content: note.content,
    feedback: note.data.brief_feedback === "useful" || note.data.brief_feedback === "not_useful"
      ? note.data.brief_feedback
      : "",
    feedbackReason: String(note.data.brief_feedback_reason || ""),
  }));

  return (
    <>
      <div className="dash">
        <header className="dash-header">
          <div className="dash-greeting">
            <p className="eyebrow">{t["page.daily.eyebrow"]}</p>
            <h1>{t["page.daily.title"]}</h1>
            <p className="muted">{t["page.daily.description"]}</p>
          </div>
          <div className="header-actions">
            <GenerateBriefButton />
          </div>
        </header>
        <DailyWorkspace briefs={briefs} />
      </div>
    </>
  );
}
