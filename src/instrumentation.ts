export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const minutes = Number(process.env.RSS_POLL_MINUTES ?? 30);
  const { ingestFeeds, readNote, readSetupState } = await import("@/lib/vault");
  const { briefScheduleSlot } = await import("@/lib/brief-schedule");
  const { mkdir, readFile, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const briefMarker = join(process.cwd(), "data", "brief-schedule-slot");
  if (Number.isFinite(minutes) && minutes > 0) {
    const runFeeds = () => ingestFeeds()
      .then((result) => { if (result.added) console.log(`[rss] ingested ${result.added} new item(s)`); })
      .catch((error) => console.error("[rss] ingest failed:", error));
    setTimeout(runFeeds, 15_000);
    setInterval(runFeeds, minutes * 60_000);
  }

  let runningBrief = false;
  const runBrief = async () => {
    if (runningBrief) return;
    runningBrief = true;
    try {
      const setup = await readSetupState();
      const slot = briefScheduleSlot(new Date(), setup.timezone, setup.automation.briefFrequency, setup.automation.briefTime, setup.automation.briefTime2);
      if (!slot || await readFile(briefMarker, "utf8").catch(() => "") === slot) return;
      const date = slot.slice(0, 10);
      if (setup.automation.briefFrequency !== "twice_daily" && await readNote(`06-Daily/${date}.md`)) {
        await mkdir(join(process.cwd(), "data"), { recursive: true });
        await writeFile(briefMarker, slot, { mode: 0o600 });
        return;
      }
      const token = process.env.CAPTURE_TOKEN?.trim();
      if (!token) return;
      const response = await fetch("http://127.0.0.1:3000/api/automation/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Capture-Token": token },
        body: JSON.stringify({ forceBrief: setup.automation.briefFrequency === "twice_daily" }),
        signal: AbortSignal.timeout(14 * 60_000),
      });
      const result = await response.json().catch(() => null) as { brief?: string } | null;
      if (result?.brief) {
        await mkdir(join(process.cwd(), "data"), { recursive: true });
        await writeFile(briefMarker, slot, { mode: 0o600 });
      } else if (!response.ok) console.error(`[brief-schedule] automation failed: HTTP ${response.status}`);
    } catch (error) {
      console.error("[brief-schedule] automation failed:", error);
    } finally {
      runningBrief = false;
    }
  };
  setTimeout(runBrief, 30_000);
  setInterval(runBrief, 5 * 60_000);

  // Once-daily metric snapshot for dashboard trend sparklines. Self-guarded to
  // write at most once per day; independent of the brief schedule.
  let runningSnapshot = false;
  const runSnapshot = async () => {
    if (runningSnapshot) return;
    runningSnapshot = true;
    try {
      const { recordDailySnapshot } = await import("@/lib/daily-snapshot");
      await recordDailySnapshot();
    } catch (error) {
      console.error("[snapshot] daily snapshot failed:", error);
    } finally {
      runningSnapshot = false;
    }
  };
  setTimeout(runSnapshot, 45_000);
  setInterval(runSnapshot, 5 * 60_000);
}
