import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { archiveStaleTasks, generateWeeklyReview } from "../src/lib/vault";
import { weekId, weekStartISO } from "../src/lib/dates";

async function withTempVault(run: () => Promise<void>) {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "memo-vault-archive-"));
  process.env.SECOND_BRAIN_VAULT = root;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
}

function dailyNote(date: string) {
  return [
    "---",
    "type: daily",
    `date: ${date}`,
    "status: draft",
    "generated_by: local",
    "---",
    `# Daily Brief - ${date}`,
    "",
    `Fact recorded on ${date}.`,
    "",
  ].join("\n");
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("generateWeeklyReview archives daily briefs from closed calendar weeks", async () => {
  await withTempVault(async () => {
    const root = process.env.SECOND_BRAIN_VAULT!;
    const dailyDir = path.join(root, "06-Daily");
    await fs.mkdir(dailyDir, { recursive: true });

    const currentMonday = weekStartISO();
    const previousMonday = addDays(currentMonday, -7);
    const archivedDates = Array.from({ length: 7 }, (_, i) => addDays(previousMonday, i));
    const liveDates = Array.from({ length: 4 }, (_, i) => addDays(currentMonday, i));
    const dates = [...archivedDates, ...liveDates];
    for (const date of dates) {
      await fs.writeFile(path.join(dailyDir, `${date}.md`), dailyNote(date));
    }

    // An earlier weekly review citing soon-to-be-archived dailies in sources.
    const weeklyDir = path.join(root, "07-Weekly");
    await fs.mkdir(weeklyDir, { recursive: true });
    await fs.writeFile(
      path.join(weeklyDir, "old-review.md"),
      [
        "---",
        "type: weekly",
        "title: Weekly Review - old",
        "status: draft",
        "sources:",
        `  - 06-Daily/${archivedDates[0]}.md`,
        `  - 06-Daily/${liveDates[0]}.md`,
        "---",
        "# Weekly Review - old",
        "",
        "Body.",
        "",
      ].join("\n"),
    );

    // A live daily brief cites the previous day's brief, which this rotation is
    // about to archive. This is the common case, not the weekly one: every daily
    // cites its predecessor.
    await fs.writeFile(
      path.join(dailyDir, `${liveDates[0]}.md`),
      [
        "---",
        "type: daily",
        `date: ${liveDates[0]}`,
        "status: draft",
        "generated_by: local",
        "sources:",
        `  - 06-Daily/${archivedDates[6]}.md`,
        "---",
        `# Daily Brief - ${liveDates[0]}`,
        "",
        "Body.",
        "",
      ].join("\n"),
    );

    await generateWeeklyReview({ force: true });

    const remaining = (await fs.readdir(dailyDir)).filter((f) => f.endsWith(".md")).sort();
    assert.deepEqual(remaining, liveDates.map((d) => `${d}.md`));

    // The closed week must be moved out, not deleted, into a sibling _Archive root
    // (not a subfolder of 06-Daily, since listNotes("daily") walks it recursively).
    const archivedWeek = `06-Daily-${weekId(new Date(`${previousMonday}T12:00:00.000Z`), "UTC")}`;
    const archived = (await fs.readdir(path.join(root, "_Archive", archivedWeek))).sort();
    assert.deepEqual(archived, ["INDEX.md", ...archivedDates.map((date) => `${date}.md`)].sort());

    // The compressed index belongs beside its archived sources, not in the live Wiki.
    const summary = await fs.readFile(path.join(root, "_Archive", archivedWeek, "INDEX.md"), "utf8");
    assert.match(summary, new RegExp(archivedDates[0]));
    assert.match(summary, new RegExp(archivedDates[6]));

    // Weekly notes citing a moved daily must have their sources rewritten to
    // the archive path, so provenance never dangles.
    const weekly = await fs.readFile(path.join(root, "07-Weekly", "old-review.md"), "utf8");
    assert.match(weekly, new RegExp(`_Archive/${archivedWeek}/${archivedDates[0]}\\.md`));
    assert.doesNotMatch(weekly, new RegExp(`- 06-Daily/${archivedDates[0]}\\.md`));
    // Untouched entries stay as they were.
    assert.match(weekly, new RegExp(`06-Daily/${liveDates[0]}\\.md`));

    // Same rule for a daily citing a daily: restricting the rewrite to weekly
    // notes left a dangling path in the newest brief every week.
    const liveDaily = await fs.readFile(path.join(dailyDir, `${liveDates[0]}.md`), "utf8");
    assert.match(liveDaily, new RegExp(`_Archive/${archivedWeek}/${archivedDates[6]}\\.md`));
    assert.doesNotMatch(liveDaily, new RegExp(`- 06-Daily/${archivedDates[6]}\\.md`));
  });
});

test("completed tasks leave the active workspace after the weekly evidence window", async () => {
  await withTempVault(async () => {
    const root = process.env.SECOND_BRAIN_VAULT!;
    const taskDir = path.join(root, "05-Tasks");
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(path.join(taskDir, "old.md"), [
      "---", "type: task", "title: Old", "status: done", "done_on: 2026-07-20", "---", "# Old", "",
    ].join("\n"));
    await fs.writeFile(path.join(taskDir, "recent.md"), [
      "---", "type: task", "title: Recent", "status: done", "done_on: 2026-08-02", "---", "# Recent", "",
    ].join("\n"));

    const moved = await archiveStaleTasks("2026-08-04");
    assert.match(moved.get("05-Tasks/old.md") || "", /^_Archive\/05-Tasks-2026-W30\/old\.md$/);
    await fs.access(path.join(taskDir, "recent.md"));
    await assert.rejects(fs.access(path.join(taskDir, "old.md")));
  });
});

test("generateWeeklyReview archives dated Raw notes after reviewing the last closed week", async () => {
  await withTempVault(async () => {
    const root = process.env.SECOND_BRAIN_VAULT!;
    const rawDir = path.join(root, "02-Raw");
    await fs.mkdir(rawDir, { recursive: true });
    const previousMonday = addDays(weekStartISO(), -7);
    const oldDate = addDays(previousMonday, 2);
    const liveDate = weekStartISO();
    await fs.writeFile(path.join(rawDir, "old-journal.md"), [
      "---", `date: ${oldDate}`, "title: Old journal", "---", "A dated temporary note.", "",
    ].join("\n"));
    await fs.writeFile(path.join(rawDir, "current-journal.md"), [
      "---", `date: ${liveDate}`, "title: Current journal", "---", "Keep this live.", "",
    ].join("\n"));

    const review = await generateWeeklyReview({ force: true });
    const week = weekId(new Date(`${previousMonday}T12:00:00.000Z`), "UTC");
    assert.equal(review.data.week_start, previousMonday);
    assert.equal(review.data.week_end, addDays(previousMonday, 6));
    assert.equal(review.data.archived_raw_count, 1);
    await fs.access(path.join(root, "_Archive", `02-Raw-${week}`, "old-journal.md"));
    await fs.access(path.join(root, "_Archive", `02-Raw-${week}`, "INDEX.md"));
    await assert.rejects(fs.access(path.join(root, "03-Wiki", `Raw-Archive-${week}.md`)));
    await fs.access(path.join(rawDir, "current-journal.md"));
    await assert.rejects(fs.access(path.join(rawDir, "old-journal.md")));
  });
});

// The rotation runs with the Monday weekly review, and the daily brief reads
// the journal of the last three days. A week-boundary cutoff alone therefore
// moved Saturday's and Sunday's journal into _Archive before Monday's brief
// had read them, so a digest written on Sunday evening never reached a brief.
test("generateWeeklyReview keeps Raw notes the daily brief still reads", async () => {
  await withTempVault(async () => {
    const root = process.env.SECOND_BRAIN_VAULT!;
    const rawDir = path.join(root, "02-Raw");
    await fs.mkdir(rawDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const inWindow = [addDays(today, -1), addDays(today, -2)];
    for (const [index, date] of inWindow.entries()) {
      await fs.writeFile(path.join(rawDir, `journal-${index}.md`), [
        "---", `date: ${date}`, `title: Journal ${index}`, "---", "Still inside the brief window.", "",
      ].join("\n"));
    }
    const staleDate = addDays(today, -12);
    await fs.writeFile(path.join(rawDir, "stale-journal.md"), [
      "---", `date: ${staleDate}`, "title: Stale journal", "---", "Outside every window.", "",
    ].join("\n"));

    await generateWeeklyReview({ force: true });

    for (const index of inWindow.keys()) {
      await fs.access(path.join(rawDir, `journal-${index}.md`));
    }
    await assert.rejects(fs.access(path.join(rawDir, "stale-journal.md")));
  });
});

test("generateWeeklyReview keeps notes from the current calendar week live", async () => {
  await withTempVault(async () => {
    const root = process.env.SECOND_BRAIN_VAULT!;
    const dailyDir = path.join(root, "06-Daily");
    await fs.mkdir(dailyDir, { recursive: true });
    const dates = Array.from({ length: 5 }, (_, i) => addDays(weekStartISO(), i));
    for (const date of dates) {
      await fs.writeFile(path.join(dailyDir, `${date}.md`), dailyNote(date));
    }

    await generateWeeklyReview({ force: true });

    const remaining = (await fs.readdir(dailyDir)).filter((f) => f.endsWith(".md"));
    assert.equal(remaining.length, 5);
    await assert.rejects(fs.readdir(path.join(root, "_Archive")));
  });
});
