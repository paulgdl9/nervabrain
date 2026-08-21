import { ActionDialog } from "@/components/ActionDialog";
import { GarminResyncButton } from "@/components/GarminResyncButton";
import { ObjectiveSetup } from "@/components/ObjectiveSetup";
import { TrailWorkspace, type TrailTab } from "@/components/TrailWorkspace";
import { computeTrailStats, hasTrainingPlan, maybeRefreshTrailCoachDecision } from "@/lib/trail";
import { selectedTrailWeek } from "@/lib/trail-format";
import { getLocale, getTranslations } from "@/lib/i18n-server";
import { Cloud, Flag, Mountain } from "lucide-react";
import "./training.css";

export const dynamic = "force-dynamic";

const TRAIL_TABS = new Set<TrailTab>(["semaine", "analyse", "plan"]);
function validTrailTab(value: string | undefined): TrailTab {
  return TRAIL_TABS.has(value as TrailTab) ? (value as TrailTab) : "semaine";
}

export default async function TrailPage({ searchParams }: { searchParams: Promise<{ week?: string; tab?: string }> }) {
  const [t, locale, params] = await Promise.all([getTranslations(), getLocale(), searchParams]);
  // hasTrainingPlan must run before computeTrailStats: the latter auto-
  // migrates a legacy plan into existence on first read, which would make
  // this check always true and the objective form unreachable.
  if (!(await hasTrainingPlan())) {
    return (
      <div className="dash trail-workspace">
        <header className="trail-page-header">
          <div className="trail-title-block">
            <p className="trail-overline"><Mountain size={14} /> {t["training.overline.legacy"]}</p>
            <h1>{t["sportSetup.pageTitle"]}</h1>
            <p>{t["sportSetup.pageDescription"]}</p>
          </div>
        </header>
        <ObjectiveSetup />
      </div>
    );
  }

  const stats = await computeTrailStats();
  const { objective } = stats.plan;
  const selectedWeek = selectedTrailWeek(params.week, stats.currentWeek, objective.weeksTotal);
  const { stale: coachStale, running: coachRunning } = maybeRefreshTrailCoachDecision(stats);

  return (
    <div className="dash trail-workspace">
      <header className="trail-page-header">
        <div className="trail-title-block">
          <p className="trail-overline"><Mountain size={14} /> {objective.sport === "trail" ? t["training.overline.trail"] : objective.sport === "run" ? t["training.overline.run"] : t["training.overline.legacy"]}</p>
          <h1>{objective.title}</h1>
          <p>{t["training.description"]}</p>
          <ActionDialog title={t["training.changeGoal"]} trigger={t["training.changeGoal"]}>
            <p className="muted">{t["training.changeHint"]}</p>
            <ObjectiveSetup />
          </ActionDialog>
        </div>
        <div className="trail-race-summary">
          <div className="race-countdown"><span>{t["training.objective"]}</span><strong>J-{stats.daysToRace}</strong></div>
          <div className="race-details"><span><Flag size={14} /> {new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${objective.eventDate}T00:00:00Z`))}</span><strong>{objective.title}</strong></div>
          <div className={`sync-indicator${stats.generatedAt ? " is-synced" : ""}`} title={stats.generatedAt ? new Date(stats.generatedAt).toLocaleString(locale) : t["training.garminMissing"]}>
            <Cloud size={15} /> {stats.generatedAt ? t["training.garminFresh"] : t["training.garminMissing"]}
            <GarminResyncButton />
          </div>
        </div>
      </header>
      <TrailWorkspace stats={stats} labels={t} locale={locale} selectedWeek={selectedWeek} tab={validTrailTab(params.tab)} coachStale={coachStale} coachRunning={coachRunning} />
    </div>
  );
}
