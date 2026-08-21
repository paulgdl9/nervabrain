import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageProvider } from "../src/components/LanguageProvider";
import { MarkdownView } from "../src/components/MarkdownView";
import { sanitizeBriefOutput, stripTaskMetaComments } from "../src/lib/markdown";
import {
  aiTaskCompletion,
  completedTasksInDateWindow,
  extractBriefTasks,
  notesInDateWindow,
  type VaultNote,
} from "../src/lib/vault";
import { isSyncConflictPath } from "../src/lib/vault-lint";

test("extractBriefTasks parses legacy dash bullets with area chips", () => {
  const brief = [
    "## Daily Brief",
    "### ✅ Today's tasks",
    "- **[Projects]** Poster le scan n°2 — tester le canal organique",
    "### To learn",
    "- **[Other]** Not a task, wrong section",
  ].join("\n");
  const tasks = extractBriefTasks(brief);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].area, "Projects");
  assert.equal(tasks[0].title, "Poster le scan n°2");
  assert.equal(tasks[0].why, "tester le canal organique");
});

test("extractBriefTasks parses numbered prose sentences (current skill format)", () => {
  const brief = [
    "### ✅ Today's tasks",
    "1. Préparer et poster la démo ExampleProject n°2 cette semaine, avec un hook axé sur le coût concret du problème (objectif : 10 utilisateurs pilotes au T3).",
    "2. **[Health]** Faire les rappels élastiques fibulaires, car la C1 est demain.",
    "",
    "Rappels et leboncoin restent des tâches déjà ouvertes.",
  ].join("\n");
  const tasks = extractBriefTasks(brief);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].area, "");
  assert.equal(
    tasks[0].title,
    "Préparer et poster la démo ExampleProject n°2 cette semaine",
  );
  assert.match(tasks[0].why ?? "", /hook axé/);
  assert.equal(tasks[1].area, "Health");
  assert.equal(tasks[1].title, "Faire les rappels élastiques fibulaires");
  assert.match(tasks[1].why ?? "", /C1 est demain/);
});

test("task metadata is extracted before storage and hidden from rendered legacy briefs", () => {
  const brief = [
    "### ✅ Tâches du jour",
    "- **[Projects]** Publier le compte rendu. Pourquoi : rendre la décision vérifiable. <!-- task-meta {\"objective\":\"Livrer le projet\",\"exec_kind\":\"prepare\"} -->",
    "<!-- keep-this-comment -->",
  ].join("\n");

  assert.deepEqual(extractBriefTasks(brief), [{
    area: "Projects",
    title: "Publier le compte rendu",
    why: "rendre la décision vérifiable",
    objective: "Livrer le projet",
    exec_kind: "prepare",
  }]);

  const persisted = stripTaskMetaComments(brief);
  assert.doesNotMatch(persisted, /task-meta/);
  assert.match(persisted, /keep-this-comment/);
  assert.doesNotMatch(sanitizeBriefOutput(brief), /task-meta/);

  const rendered = renderToStaticMarkup(createElement(
    LanguageProvider,
    { initialLocale: "fr" } as ComponentProps<typeof LanguageProvider>,
    createElement(MarkdownView, { content: brief }),
  ));
  assert.doesNotMatch(rendered, /task-meta/);
  assert.match(rendered, /keep-this-comment/);
});

function taskNote(overrides: Partial<VaultNote["data"]>, status: string): VaultNote {
  return {
    id: "x", title: "t", relativePath: "05-Tasks/x.md", folder: "05-Tasks",
    kind: "task", data: { ...overrides }, content: "", excerpt: "",
    tags: [], links: [], status, mtime: "",
  };
}

test("completedTasksInDateWindow keeps weekly completions despite a large open backlog", () => {
  const open = Array.from({ length: 40 }, (_, index) => taskNote({ title: `Open ${index}` }, "todo"));
  const inside = taskNote({ done_on: "2026-07-15" }, "done");
  const outside = taskNote({ done_on: "2026-07-06" }, "done");
  const undated = taskNote({}, "done");

  assert.deepEqual(completedTasksInDateWindow([...open, inside, outside, undated], "2026-07-13", "2026-07-19"), [inside]);
});

test("notesInDateWindow guarantees dated journal notes from the last three days", () => {
  const note = (path: string, data: Record<string, unknown>, mtime = "2026-07-15T10:00:00Z"): VaultNote => ({
    ...taskNote(data, "active"),
    relativePath: path,
    data,
    mtime,
  });
  const today = note("02-Raw/journal.md", { date: "2026-07-15" });
  const pathDated = note("02-Raw/2026-07-13.md", {});
  const invalidDatePath = note("02-Raw/2026-07-14-notes.md", { date: "mardi" });
  const explicitlyOld = note("02-Raw/old.md", { date: "2026-07-01", updated: "2026-07-15" });

  assert.deepEqual(
    notesInDateWindow([today, pathDated, invalidDatePath, explicitlyOld], "2026-07-13", "2026-07-15", ["date", "created", "updated"]),
    [today, pathDated, invalidDatePath],
  );
});

test("aiTaskCompletion counts only ai-brief tasks proposed in the last 7 days", () => {
  const now = new Date("2026-07-06T08:00:00Z");
  const tasks = [
    taskNote({ source: "ai-brief", proposed_on: "2026-07-02" }, "done"),
    taskNote({ source: "ai-brief", proposed_on: "2026-07-04" }, "todo"),
    taskNote({ source: "ai-brief", proposed_on: "2026-06-20" }, "done"), // out of window
    taskNote({ source: "manual", proposed_on: "2026-07-05" }, "done"), // not ai
  ];
  const result = aiTaskCompletion(tasks, now);
  assert.equal(result.proposed, 2);
  assert.equal(result.done, 1);
  assert.equal(result.label, "1/2 (50%)");
});

test("isSyncConflictPath flags Syncthing and editor duplicate copies", () => {
  assert.equal(isSyncConflictPath("00-System/Feeds.sync-conflict-20260705-055422-ABUXRRO.md"), true);
  assert.equal(isSyncConflictPath("00-System/Feeds 2.md"), true);
  assert.equal(isSyncConflictPath("00-System/Feeds.md"), false);
  assert.equal(isSyncConflictPath("06-Daily/2026-07-06.md"), false);
});
