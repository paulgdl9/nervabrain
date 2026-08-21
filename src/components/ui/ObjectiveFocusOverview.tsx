"use client";

import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Circle } from "lucide-react";
import { useEffect, useState } from "react";
import {
  PRIMARY_GOAL_EVENT,
  PRIMARY_GOAL_STORAGE_KEY,
  type PrimaryGoalOption,
} from "@/components/ui/PrimaryGoalCard";

export type ObjectiveFocusGoal = PrimaryGoalOption & {
  tasks: Array<{ id: string; title: string; status: string; priority: string }>;
};

export function ObjectiveFocusOverview({ goals, locale }: { goals: ObjectiveFocusGoal[]; locale: "fr" | "en" }) {
  const [selectedId, setSelectedId] = useState(goals[0]?.id ?? "");

  useEffect(() => {
    const sync = (event?: Event) => {
      const eventId = event instanceof CustomEvent ? String(event.detail || "") : "";
      const id = eventId || window.localStorage.getItem(PRIMARY_GOAL_STORAGE_KEY) || "";
      if (goals.some((goal) => goal.id === id)) setSelectedId(id);
    };
    sync();
    window.addEventListener(PRIMARY_GOAL_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PRIMARY_GOAL_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [goals]);

  const selected = goals.find((goal) => goal.id === selectedId) ?? goals[0];
  if (!selected) return null;
  const others = goals.filter((goal) => goal.id !== selected.id).slice(0, 3);

  return (
    <section className="objective-focus-overview">
      <header className="objective-focus-heading">
        <div>
          <span>{locale === "fr" ? "Objectif sélectionné" : "Selected goal"}</span>
          <h2>{selected.title}</h2>
        </div>
        <Link href="/objectives">{locale === "fr" ? "Gérer les objectifs" : "Manage goals"} <ArrowUpRight size={14} /></Link>
      </header>

      <div className="objective-focus-layout">
        <article className="objective-focus-progress">
          <div><strong>{selected.progress}%</strong><span>{selected.done}/{selected.total} {locale === "fr" ? "tâches terminées" : "tasks completed"}</span></div>
          <div className="objective-focus-track" role="progressbar" aria-label={selected.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={selected.progress}><i style={{ width: `${selected.progress}%` }} /></div>
          <p>{selected.tasks[0]?.title || (locale === "fr" ? "Ajoutez une prochaine action concrète à cet objectif." : "Add a concrete next action to this goal.")}</p>
        </article>

        <div className="objective-focus-actions">
          <div className="objective-focus-section-head"><strong>{locale === "fr" ? "Prochaines actions" : "Next actions"}</strong><Link href="/tasks?sort=priority">{locale === "fr" ? "Voir les tâches" : "View tasks"}</Link></div>
          {selected.tasks.length ? (
            <ul>
              {selected.tasks.slice(0, 4).map((task) => <li key={task.id}><Circle size={13} /><span>{task.title}</span>{task.priority === "high" ? <em>{locale === "fr" ? "Haute" : "High"}</em> : null}</li>)}
            </ul>
          ) : <div className="objective-focus-empty"><CheckCircle2 size={16} /><span>{locale === "fr" ? "Aucune tâche ouverte pour cet objectif." : "No open task for this goal."}</span></div>}
        </div>
      </div>

      {others.length ? <div className="objective-focus-others"><span>{locale === "fr" ? "Autres objectifs actifs" : "Other active goals"}</span>{others.map((goal) => <article key={goal.id}><div><strong>{goal.title}</strong><small>{goal.done}/{goal.total}</small></div><i><b style={{ width: `${goal.progress}%` }} /></i></article>)}</div> : null}
    </section>
  );
}
