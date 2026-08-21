"use client";

import Link from "next/link";
import { Check, ChevronDown, Circle, Target, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type PrimaryGoalTask = { id: string; title: string; status: string; priority: string };

export type PrimaryGoalOption = {
  id: string;
  title: string;
  done: number;
  total: number;
  progress: number;
  tasks?: PrimaryGoalTask[];
};

export const PRIMARY_GOAL_STORAGE_KEY = "memo-primary-goal";
export const PRIMARY_GOAL_EVENT = "memo-primary-goal-change";

export function PrimaryGoalCard({
  goals,
  locale,
}: {
  goals: PrimaryGoalOption[];
  locale: "fr" | "en";
}) {
  const [selectedId, setSelectedId] = useState(goals[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(PRIMARY_GOAL_STORAGE_KEY);
    if (stored && goals.some((goal) => goal.id === stored)) {
      queueMicrotask(() => setSelectedId(stored));
    }
  }, [goals]);

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const selected = goals.find((goal) => goal.id === selectedId) ?? goals[0];

  function select(id: string) {
    window.localStorage.setItem(PRIMARY_GOAL_STORAGE_KEY, id);
    window.dispatchEvent(new CustomEvent(PRIMARY_GOAL_EVENT, { detail: id }));
    setSelectedId(id);
    setOpen(false);
  }

  if (!selected) {
    return (
      <article className="relative flex min-h-48 flex-col justify-between rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 text-[var(--ink)]">
        <div className="flex size-9 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--panel-2)]">
          <Target aria-hidden size={17} />
        </div>
        <div>
          <p className="m-0 text-xs font-medium text-[var(--muted)]">{locale === "fr" ? "Objectif principal" : "Primary goal"}</p>
          <h3 className="my-2 text-lg font-semibold tracking-[-0.02em]">{locale === "fr" ? "Aucun objectif actif" : "No active goal"}</h3>
          <p className="m-0 text-sm leading-5 text-[var(--muted)]">{locale === "fr" ? "Créez un objectif mesurable pour le faire apparaître ici." : "Create a measurable goal to make it appear here."}</p>
        </div>
        <Link className="mt-4 w-fit text-sm font-medium text-[var(--accent)] no-underline hover:underline" href="/objectives">
          {locale === "fr" ? "Créer un objectif" : "Create a goal"}
        </Link>
      </article>
    );
  }

  return (
    <article ref={rootRef} className={`primary-goal-card relative min-w-0 min-h-48 rounded-2xl border border-[var(--card-border)] bg-[var(--card-surface)] p-5 text-[var(--ink)] shadow-[var(--card-inner)]${open ? " is-open" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">{locale === "fr" ? "Objectif principal" : "Primary goal"}</p>
          <h3 className="my-2 line-clamp-2 text-lg font-semibold tracking-[-0.02em]">{selected.title}</h3>
        </div>
        <button
          aria-expanded={open}
          aria-label={locale === "fr" ? "Changer d’objectif principal" : "Change primary goal"}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-sunken)] text-[var(--muted)] transition hover:bg-[var(--interactive-control-hover)] hover:text-[var(--ink)]"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {open ? <X size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      <div className="mt-6 flex items-end justify-between gap-3">
        <strong className="text-4xl font-semibold tracking-[-0.05em]">{selected.progress}%</strong>
        <span className="pb-1 text-xs text-[var(--muted)]">{selected.done}/{selected.total} {locale === "fr" ? "tâches" : "tasks"}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--line-soft)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={selected.progress}>
        <i className="block h-full rounded-full bg-[rgb(var(--accent-rgb))] transition-[width] duration-500" style={{ width: `${selected.progress}%` }} />
      </div>

      {selected.tasks?.length ? (
        <ul className="mt-4 flex flex-col gap-1.5">
          {selected.tasks.slice(0, 3).map((task) => (
            <li className="flex items-start gap-2 text-sm text-[var(--ink)]" key={task.id}>
              <Circle aria-hidden className="mt-1 shrink-0 text-[var(--muted)]" size={12} />
              <span className="min-w-0 flex-1 break-words leading-5">{task.title}</span>
              {task.priority === "high" ? <em className="mt-0.5 shrink-0 text-[11px] font-medium not-italic text-[var(--accent)]">{locale === "fr" ? "Haute" : "High"}</em> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-[var(--muted)]">{locale === "fr" ? "Aucune tâche liée à cet objectif." : "No task linked to this goal."}</p>
      )}

      {open ? (
        <div className="primary-goal-menu absolute right-4 top-14 z-50 max-h-[min(70vh,520px)] w-[min(320px,calc(100vw-3rem))] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--menu-surface-strong)] p-1.5 text-[var(--ink)] shadow-[var(--shadow-menu)]">
          <p className="m-0 px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">{locale === "fr" ? "Suivre en priorité" : "Track as primary"}</p>
          {goals.map((goal) => (
            <button
              className="flex w-full cursor-pointer items-center gap-3 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-inherit hover:bg-[var(--panel-2)]"
              key={goal.id}
              onClick={() => select(goal.id)}
              type="button"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-[var(--line)]">{goal.id === selected.id ? <Check size={13} /> : null}</span>
              <span className="min-w-0 flex-1"><strong className="block truncate text-sm font-medium">{goal.title}</strong><small className="text-xs text-[var(--muted)]">{goal.progress}% · {goal.done}/{goal.total}</small></span>
            </button>
          ))}
          <Link className="mt-1 block border-t border-[var(--line)] px-2.5 py-2.5 text-xs font-medium text-[var(--muted)] no-underline hover:text-[var(--ink)]" href="/objectives">
            {locale === "fr" ? "Gérer les objectifs" : "Manage goals"}
          </Link>
        </div>
      ) : null}
    </article>
  );
}
