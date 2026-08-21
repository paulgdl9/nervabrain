import { GenerateWeeklyReviewButton } from "@/components/Forms";
import { WeeklyWorkspace, type WeeklyReview } from "@/components/WeeklyWorkspace";
import { getDashboard, noteHref } from "@/lib/vault";
import { readBriefSuggestions } from "@/lib/brief-suggestions";
import { getTranslations } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function WeeklyPage() {
  const [data, t] = await Promise.all([getDashboard(), getTranslations()]);
  // Server-side read: a client GET to our own /api/* has no Origin header and 401s.
  const suggestions = Object.fromEntries(await Promise.all(
    data.weekly.map(async (note) => [note.relativePath, await readBriefSuggestions(note.relativePath)] as const),
  ));

  const reviews: WeeklyReview[] = data.weekly.map((note) => ({
    suggestions: suggestions[note.relativePath] || [],
    id: note.id,
    path: note.relativePath,
    week: String(note.data.week || note.title),
    start: String(note.data.week_start || ""),
    end: String(note.data.week_end || ""),
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
            <p className="eyebrow">{t["page.weekly.eyebrow"]}</p>
            <h1>{t["page.weekly.title"]}</h1>
            <p className="muted">{t["page.weekly.description"]}</p>
          </div>
          <div className="header-actions">
            <GenerateWeeklyReviewButton />
          </div>
        </header>
        <WeeklyWorkspace reviews={reviews} />
      </div>
    </>
  );
}
