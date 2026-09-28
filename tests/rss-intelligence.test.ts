import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  feedDigestNextDue,
  ingestFeeds,
  isFeedDigestDue,
  mergeFeedArticles,
  readFeedArticles,
  readFeedIntelligence,
  runDueFeedDigests,
  runFeedDigest,
  upsertFeedDigestProfile,
  validateFeedDigestOutput,
  type FeedArticle,
  type FeedDigestProfile,
  type FeedSource,
} from "../src/lib/vault";

async function scratchVault(run: (root: string) => Promise<void>) {
  const previous = process.env.SECOND_BRAIN_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerva-rss-intelligence-"));
  process.env.SECOND_BRAIN_VAULT = root;
  try {
    await run(root);
  } finally {
    if (previous === undefined) delete process.env.SECOND_BRAIN_VAULT;
    else process.env.SECOND_BRAIN_VAULT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeConfig(root: string, options: { enabled?: boolean; sources?: FeedSource[]; profiles?: FeedDigestProfile[] } = {}) {
  await fs.writeFile(path.join(root, ".rss-config.json"), `${JSON.stringify({
    version: 2,
    enabled: options.enabled ?? true,
    sources: options.sources || [],
    profiles: options.profiles || [],
    lastCollectionAt: "",
    lastCollectionCount: 0,
  }, null, 2)}\n`, "utf8");
}

function runDigestInChild(root: string, profileId: string) {
  const script = [
    'import { runFeedDigest } from "./src/lib/vault";',
    `runFeedDigest(${JSON.stringify(profileId)}, { force: true, now: new Date("2026-09-26T08:00:00.000Z") })`,
    '  .then(() => process.exit(0))',
    '  .catch((error) => { console.error(error); process.exit(1); });',
  ].join("\n");
  return new Promise<void>((resolve, reject) => {
    const child = spawn(path.join(process.cwd(), "node_modules", ".bin", "tsx"), ["-e", script], {
      cwd: process.cwd(),
      env: { ...process.env, SECOND_BRAIN_VAULT: root },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr || `child exited ${code}`)));
  });
}

const SOURCE_A: FeedSource = {
  id: "source-a",
  label: "Radiology",
  url: "https://example.com/radiology.xml",
  enabled: true,
  topics: ["radiology"],
};

const PROFILE: FeedDigestProfile = {
  id: "digest-radio",
  title: "Veille radiologie",
  enabled: true,
  sourceIds: [SOURCE_A.id],
  instructions: "Prioriser les évolutions qui changent la pratique.",
  cadence: "daily",
  maxItems: 3,
  lookbackHours: 48,
  lastRun: "",
  nextDue: "",
};

test("legacy Feeds.md migrates only on the first RSS mutation", () => scratchVault(async (root) => {
  const system = path.join(root, "00-System");
  await fs.mkdir(system, { recursive: true });
  await fs.writeFile(path.join(system, "Feeds.md"), [
    "---",
    "type: system",
    "role: feeds",
    "enabled: true",
    "feeds:",
    "  - https://example.com/legacy.xml",
    "---",
    "# RSS Feeds",
  ].join("\n"), "utf8");

  const legacy = await readFeedIntelligence();
  assert.deepEqual(legacy.sources.map((source) => source.url), ["https://example.com/legacy.xml"]);
  await assert.rejects(fs.access(path.join(root, ".rss-config.json")));

  await upsertFeedDigestProfile({ title: "Digest legacy", cadence: "weekly" });
  const canonical = JSON.parse(await fs.readFile(path.join(root, ".rss-config.json"), "utf8"));
  assert.equal(canonical.version, 2);
  assert.equal(canonical.sources[0].url, "https://example.com/legacy.xml");
  assert.equal(canonical.profiles[0].title, "Digest legacy");
}));

test("corrupt or future canonical RSS configuration fails closed", () => scratchVault(async (root) => {
  await fs.writeFile(path.join(root, ".rss-config.json"), "{broken", "utf8");
  await assert.rejects(readFeedIntelligence(), /corrupt/);

  await fs.writeFile(path.join(root, ".rss-config.json"), JSON.stringify({ version: 99 }), "utf8");
  await assert.rejects(readFeedIntelligence(), /Unsupported RSS configuration version/);
}));

test("collection deduplicates articles, isolates source failures, and leaves Inbox untouched", () => scratchVault(async (root) => {
  const sourceB: FeedSource = { ...SOURCE_A, id: "source-b", label: "Broken", url: "https://example.org/broken.xml" };
  await writeConfig(root, { sources: [SOURCE_A, sourceB] });
  const previousCapture = process.env.RSS_CAPTURE_TO_INBOX;
  delete process.env.RSS_CAPTURE_TO_INBOX;
  try {
    const now = new Date("2026-09-26T08:00:00.000Z");
    const fetcher = async (url: string) => {
      if (url === sourceB.url) throw new Error("source unavailable");
      return [
        { id: "one", title: "First", link: "https://news.example/one", summary: "A", published: "2026-09-26T07:00:00.000Z" },
        { id: "two", title: "Second", link: "https://news.example/two", summary: "B", published: "2026-09-26T06:00:00.000Z" },
        { id: "one", title: "First duplicate", link: "https://news.example/one", summary: "A", published: "2026-09-26T07:00:00.000Z" },
      ];
    };

    const first = await ingestFeeds({ fetcher, now });
    assert.equal(first.added, 2);
    assert.equal(first.perFeed[SOURCE_A.url].added, 2);
    assert.match(first.perFeed[sourceB.url].error || "", /source unavailable/);
    const sourceState = (await readFeedIntelligence()).sourceState;
    assert.equal(sourceState[SOURCE_A.id].lastSuccess, now.toISOString());
    assert.match(sourceState[sourceB.id].error || "", /source unavailable/);
    assert.equal((await readFeedArticles()).length, 2);
    assert.deepEqual(await fs.readdir(path.join(root, "01-Inbox")), []);

    const second = await ingestFeeds({ fetcher, now: new Date("2026-09-26T09:00:00.000Z") });
    assert.equal(second.added, 0);
    assert.equal((await readFeedArticles()).length, 2);
  } finally {
    if (previousCapture === undefined) delete process.env.RSS_CAPTURE_TO_INBOX;
    else process.env.RSS_CAPTURE_TO_INBOX = previousCapture;
  }
}));

test("collection skips disabled configuration and sources but force still collects enabled sources", () => scratchVault(async (root) => {
  const disabledSource: FeedSource = {
    ...SOURCE_A,
    id: "source-disabled",
    label: "Disabled",
    url: "https://example.org/disabled.xml",
    enabled: false,
  };
  await writeConfig(root, { enabled: false, sources: [SOURCE_A, disabledSource] });
  const fetched: string[] = [];
  const fetcher = async (url: string) => {
    fetched.push(url);
    return [{ id: "forced", title: "Forced collection", link: "https://news.example/forced" }];
  };

  const skipped = await ingestFeeds({ fetcher, now: new Date("2026-09-26T08:00:00.000Z") });
  assert.equal(skipped.added, 0);
  assert.deepEqual(fetched, []);

  const forced = await ingestFeeds({ force: true, fetcher, now: new Date("2026-09-26T09:00:00.000Z") });
  assert.equal(forced.added, 1);
  assert.deepEqual(fetched, [SOURCE_A.url]);
  assert.equal(forced.perFeed[disabledSource.url], undefined);
  assert.equal((await readFeedArticles()).length, 1);
}));

test("article cache applies retention and a hard cap", () => {
  const article = (id: string, discoveredAt: string): FeedArticle => ({
    id,
    sourceId: SOURCE_A.id,
    title: id,
    url: `https://news.example/${id}`,
    summary: "",
    published: discoveredAt,
    discoveredAt,
  });
  const merged = mergeFeedArticles([
    article("old", "2026-07-01T00:00:00.000Z"),
    article("one", "2026-09-25T00:00:00.000Z"),
  ], [
    article("one", "2026-09-26T00:00:00.000Z"),
    article("two", "2026-09-24T00:00:00.000Z"),
  ], { cap: 2, retentionDays: 30, now: new Date("2026-09-26T12:00:00.000Z") });

  assert.deepEqual(merged.map((item) => item.id), ["one", "two"]);
  assert.equal(merged[0].discoveredAt, "2026-09-26T00:00:00.000Z");
});

test("digest validation accepts only exact candidate id/url pairs and rehydrates metadata", () => {
  const candidates: FeedArticle[] = [
    {
      id: "article-1",
      sourceId: SOURCE_A.id,
      title: "Trusted title",
      url: "https://news.example/trusted",
      summary: "Original abstract",
      published: "2026-09-26T07:00:00.000Z",
      discoveredAt: "2026-09-26T07:05:00.000Z",
    },
  ];
  const digest = validateFeedDigestOutput(PROFILE, candidates, [SOURCE_A], {
    engine: "codex",
    overview: "Synthèse",
    items: [
      { article_id: "article-1", url: "https://news.example/trusted", summary: "Résumé digéré", why_it_matters: "Impact clinique" },
      { article_id: "article-1", url: "https://evil.example/rewrite", summary: "Poison", why_it_matters: "Non" },
      { article_id: "unknown", url: "https://news.example/trusted", summary: "Inventé", why_it_matters: "Non" },
    ],
  }, "2026-09-26T08:00:00.000Z");

  assert.equal(digest.items.length, 1);
  assert.equal(digest.items[0].title, "Trusted title");
  assert.equal(digest.items[0].source, "Radiology");
  assert.equal(digest.items[0].url, "https://news.example/trusted");
  assert.equal(digest.partial, true);
  assert.equal(digest.error, undefined);
  assert.match(digest.warning || "", /2 invalid/);
});

test("corrupt or future RSS cache state fails closed", () => scratchVault(async (root) => {
  await fs.writeFile(path.join(root, ".rss-articles.json"), "{broken", "utf8");
  await assert.rejects(readFeedArticles(), /corrupt/);
  await fs.writeFile(path.join(root, ".rss-articles.json"), JSON.stringify({ version: 99, articles: [] }), "utf8");
  await assert.rejects(readFeedArticles(), /Unsupported RSS article state version/);

  await writeConfig(root, { profiles: [PROFILE] });
  await fs.writeFile(path.join(root, ".rss-digests.json"), "{broken", "utf8");
  await assert.rejects(readFeedIntelligence(), /corrupt/);
  await fs.writeFile(path.join(root, ".rss-digests.json"), JSON.stringify({ version: 99 }), "utf8");
  await assert.rejects(readFeedIntelligence(), /Unsupported RSS digest state version/);
}));

test("digest schedules are restart-safe elapsed cadences", () => {
  assert.equal(feedDigestNextDue("manual", "2026-09-26T08:00:00.000Z"), "");
  assert.equal(feedDigestNextDue("multiple_daily", "2026-09-26T08:00:00.000Z"), "2026-09-26T14:00:00.000Z");
  assert.equal(feedDigestNextDue("daily", "2026-09-26T08:00:00.000Z"), "2026-09-27T08:00:00.000Z");
  assert.equal(feedDigestNextDue("weekly", "2026-09-26T08:00:00.000Z"), "2026-10-03T08:00:00.000Z");
  assert.equal(isFeedDigestDue({ ...PROFILE, lastRun: "", nextDue: "" }, new Date("2026-09-26T08:00:00.000Z")), true);
  assert.equal(isFeedDigestDue({ ...PROFILE, lastRun: "2026-09-26T08:00:00.000Z", nextDue: "2026-09-27T08:00:00.000Z" }, new Date("2026-09-26T12:00:00.000Z")), false);
  assert.equal(isFeedDigestDue({ ...PROFILE, enabled: false }, new Date("2026-09-26T12:00:00.000Z")), false);
  assert.equal(isFeedDigestDue({ ...PROFILE, cadence: "manual" }, new Date("2026-09-26T12:00:00.000Z")), false);
  assert.equal(isFeedDigestDue({ ...PROFILE, lastRun: "2026-09-25T08:00:00.000Z", nextDue: "invalid" }, new Date("2026-09-26T12:00:00.000Z")), true);
});

test("due digest scheduler ignores disabled, manual, and future profiles", () => scratchVault(async (root) => {
  const now = new Date("2026-09-26T12:00:00.000Z");
  const disabled = { ...PROFILE, id: "digest-disabled", enabled: false };
  const manual = { ...PROFILE, id: "digest-manual", cadence: "manual" as const };
  const due = { ...PROFILE, id: "digest-due" };
  const future = { ...PROFILE, id: "digest-future" };
  await writeConfig(root, { enabled: false, profiles: [disabled, manual, due, future] });
  await fs.writeFile(path.join(root, ".rss-digests.json"), JSON.stringify({
    version: 1,
    latestSuccess: {},
    runState: {
      [due.id]: { lastAttempt: "2026-09-25T08:00:00.000Z", lastSuccess: "", nextDue: "2026-09-26T08:00:00.000Z", consecutiveFailures: 0 },
      [future.id]: { lastAttempt: "2026-09-26T08:00:00.000Z", lastSuccess: "", nextDue: "2026-09-27T08:00:00.000Z", consecutiveFailures: 0 },
    },
  }), "utf8");

  assert.deepEqual(await runDueFeedDigests({ now }), []);
  await writeConfig(root, { profiles: [disabled, manual, due, future] });

  const results = await runDueFeedDigests({ now });
  assert.deepEqual(results.map((digest) => digest.profileId), [due.id]);
  assert.equal(results[0].engine, "none");
  assert.equal(results[0].items.length, 0);
  const intelligence = await readFeedIntelligence();
  assert.equal(intelligence.profiles.find((profile) => profile.id === due.id)?.nextDue, "2026-09-27T12:00:00.000Z");
  assert.equal(intelligence.profiles.find((profile) => profile.id === future.id)?.nextDue, "2026-09-27T08:00:00.000Z");
}));

test("digest runner rejects missing profiles and returns a non-due cached digest unchanged", () => scratchVault(async (root) => {
  await writeConfig(root, { profiles: [PROFILE] });
  await assert.rejects(runFeedDigest("missing-profile", { force: true }), /Digest profile not found/);

  const cached = {
    profileId: PROFILE.id,
    generatedAt: "2026-09-26T08:00:00.000Z",
    engine: "codex",
    overview: "Cached digest",
    items: [],
  };
  await fs.writeFile(path.join(root, ".rss-digests.json"), JSON.stringify({
    version: 1,
    latestSuccess: { [PROFILE.id]: cached },
    runState: {
      [PROFILE.id]: {
        lastAttempt: "2026-09-26T08:00:00.000Z",
        lastSuccess: "2026-09-26T08:00:00.000Z",
        nextDue: "2026-09-27T08:00:00.000Z",
        consecutiveFailures: 0,
      },
    },
  }), "utf8");

  const result = await runFeedDigest(PROFILE.id, { now: new Date("2026-09-26T12:00:00.000Z") });
  assert.equal(result.overview, "Cached digest");
  const state = JSON.parse(await fs.readFile(path.join(root, ".rss-digests.json"), "utf8"));
  assert.equal(state.runState[PROFILE.id].lastAttempt, "2026-09-26T08:00:00.000Z");
}));

test("an expired digest lease is reclaimed and an empty candidate set persists a successful run", () => scratchVault(async (root) => {
  await writeConfig(root, { profiles: [PROFILE] });
  const lease = path.join(root, `.rss-digest-${PROFILE.id}.lock`);
  await fs.writeFile(lease, JSON.stringify({ token: "crashed-worker" }), "utf8");
  const old = new Date("2026-09-26T06:00:00.000Z");
  await fs.utimes(lease, old, old);
  const previousLeaseMs = process.env.RSS_DIGEST_LEASE_MS;
  process.env.RSS_DIGEST_LEASE_MS = "60000";
  try {
    const result = await runFeedDigest(PROFILE.id, { force: true, now: new Date("2026-09-26T08:00:00.000Z") });
    assert.equal(result.engine, "none");
    assert.deepEqual(result.items, []);
    assert.equal(result.error, undefined);
    await assert.rejects(fs.access(lease));
    const intelligence = await readFeedIntelligence();
    assert.equal(intelligence.digests[0].generatedAt, "2026-09-26T08:00:00.000Z");
    assert.equal(intelligence.profiles[0].nextDue, "2026-09-27T08:00:00.000Z");
  } finally {
    if (previousLeaseMs === undefined) delete process.env.RSS_DIGEST_LEASE_MS;
    else process.env.RSS_DIGEST_LEASE_MS = previousLeaseMs;
  }
}));

test("scheduler continues across independent AI failures", () => scratchVault(async (root) => {
  const first = { ...PROFILE, id: "digest-first" };
  const second = { ...PROFILE, id: "digest-second" };
  await writeConfig(root, { sources: [SOURCE_A], profiles: [first, second] });
  await fs.writeFile(path.join(root, ".rss-articles.json"), JSON.stringify({
    version: 1,
    articles: [{
      id: "article-scheduler",
      sourceId: SOURCE_A.id,
      title: "Scheduler",
      url: "https://news.example/scheduler",
      summary: "Candidate",
      published: "2026-09-26T07:00:00.000Z",
      discoveredAt: "2026-09-26T07:00:00.000Z",
    }],
  }), "utf8");
  const keys = ["MEMO_BRIDGE_URL", "MEMO_TOKEN", "AI_BRIEF_ENDPOINT", "AI_BRIEF_TOKEN", "MEMO_ENV_FILE"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    const results = await runDueFeedDigests({ now: new Date("2026-09-26T08:00:00.000Z") });
    assert.deepEqual(results.map((digest) => digest.profileId), [first.id, second.id]);
    assert.ok(results.every((digest) => /bridge IA non configuré/.test(digest.error || "")));
    const intelligence = await readFeedIntelligence();
    assert.equal(intelligence.digests.length, 2);
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}));

test("a failed AI refresh preserves the last successful digest", () => scratchVault(async (root) => {
  await writeConfig(root, { sources: [SOURCE_A], profiles: [PROFILE] });
  await fs.writeFile(path.join(root, ".rss-articles.json"), JSON.stringify({
    version: 1,
    articles: [{
      id: "article-1",
      sourceId: SOURCE_A.id,
      title: "Trusted title",
      url: "https://news.example/trusted",
      summary: "Original abstract",
      published: "2026-09-26T07:00:00.000Z",
      discoveredAt: "2026-09-26T07:05:00.000Z",
    }],
  }), "utf8");
  await fs.writeFile(path.join(root, ".rss-digests.json"), JSON.stringify({
    version: 1,
    latestSuccess: {
      [PROFILE.id]: {
        profileId: PROFILE.id,
        generatedAt: "2026-09-26T07:30:00.000Z",
        engine: "codex",
        overview: "Previous good digest",
        items: [{
          articleId: "article-1",
          title: "Trusted title",
          summary: "Previous summary",
          whyItMatters: "Previous reason",
          url: "https://news.example/trusted",
          source: "Radiology",
          published: "2026-09-26T07:00:00.000Z",
        }],
      },
    },
    runState: {},
  }), "utf8");

  const keys = ["MEMO_BRIDGE_URL", "MEMO_TOKEN", "AI_BRIEF_ENDPOINT", "AI_BRIEF_TOKEN", "MEMO_ENV_FILE"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    const result = await runFeedDigest(PROFILE.id, { force: true, now: new Date("2026-09-26T08:00:00.000Z") });
    assert.equal(result.overview, "Previous good digest");
    assert.equal(result.items.length, 1);
    assert.equal(result.partial, true);
    assert.match(result.error || "", /bridge IA non configuré/);

    const persisted = await readFeedIntelligence();
    assert.equal(persisted.digests[0].overview, "Previous good digest");
    assert.match(persisted.digests[0].error || "", /bridge IA non configuré/);
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}));

test("concurrent digest runs share a filesystem lease and invoke the AI once", () => scratchVault(async (root) => {
  await writeConfig(root, { sources: [SOURCE_A], profiles: [PROFILE] });
  await fs.writeFile(path.join(root, ".rss-articles.json"), JSON.stringify({
    version: 1,
    articles: [{
      id: "article-lease",
      sourceId: SOURCE_A.id,
      title: "Lease test",
      url: "https://news.example/lease",
      summary: "Original abstract",
      published: "2026-09-26T07:00:00.000Z",
      discoveredAt: "2026-09-26T07:05:00.000Z",
    }],
  }), "utf8");

  const envKeys = ["MEMO_BRIDGE_URL", "MEMO_TOKEN", "MEMO_ENGINE_PRIMARY", "MEMO_ENGINE_FALLBACK", "MEMO_ENV_FILE"] as const;
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  let calls = 0;
  process.env.MEMO_BRIDGE_URL = "https://bridge.example";
  process.env.MEMO_TOKEN = "test-token";
  process.env.MEMO_ENGINE_PRIMARY = "codex";
  delete process.env.MEMO_ENGINE_FALLBACK;
  delete process.env.MEMO_ENV_FILE;
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 40));
    return new Response(JSON.stringify({
      ok: true,
      engine: "codex",
      overview: "One generated digest",
      items: [{
        article_id: "article-lease",
        url: "https://news.example/lease",
        summary: "Summary",
        why_it_matters: "Reason",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await Promise.all([
      runFeedDigest(PROFILE.id, { force: true, now: new Date("2026-09-26T08:00:00.000Z") }),
      runFeedDigest(PROFILE.id, { force: true, now: new Date("2026-09-26T08:00:00.000Z") }),
    ]);
    assert.equal(calls, 1);
    const intelligence = await readFeedIntelligence();
    assert.equal(intelligence.digests[0].overview, "One generated digest");
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of envKeys) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}));

test("independent processes serialize shared digest state mutations", () => scratchVault(async (root) => {
  const profiles = Array.from({ length: 6 }, (_, index) => ({ ...PROFILE, id: `digest-process-${index}` }));
  await writeConfig(root, { profiles });
  await Promise.all(profiles.map((profile) => runDigestInChild(root, profile.id)));
  const state = JSON.parse(await fs.readFile(path.join(root, ".rss-digests.json"), "utf8"));
  assert.deepEqual(Object.keys(state.runState).sort(), profiles.map((profile) => profile.id).sort());
  assert.deepEqual(Object.keys(state.latestSuccess).sort(), profiles.map((profile) => profile.id).sort());
  await assert.rejects(fs.access(path.join(root, ".rss-digests.json.lock")));
}));
