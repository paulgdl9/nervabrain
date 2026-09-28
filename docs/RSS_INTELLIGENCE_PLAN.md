# RSS intelligence, dashboard widgets, and navigation control

Status: IMPLEMENTED
Branch: `feat/rss-intelligence-official`
Date: 2026-09-26

## Outcome

Replace the current “every RSS item becomes Inbox noise” behavior with a configurable intelligence pipeline. A user can register sources from Settings or MCP, define one or more AI digest profiles, choose a cadence, and optionally add the resulting widgets to the dashboard. Navigation entries can be hidden without deleting their routes or data.

## Product decisions

1. The Library route and Wiki storage stay intact because Inbox processing and knowledge consolidation depend on them. `/wiki` can be hidden per profile and restored in Settings; existing profiles keep their explicit choice.
2. Feed collection and feed interpretation are separate. Collection stores bounded source items; digest profiles select and synthesize them. Raw RSS items no longer have to flood the Inbox.
3. One digest profile equals one optional dashboard widget. This supports both a single “important news” carousel and several specialist widgets such as radiology and technology.
4. AI output is constrained to known article IDs and URLs. The bridge may rank and summarize, but it cannot invent sources.
5. The current local-first architecture remains: configuration and generated state are stored under the vault through `vault.ts`, with no database or new dependency.
6. Existing flat RSS configuration migrates automatically. Existing URLs remain usable and ingestion can be disabled or run manually.
7. Sidebar visibility is persisted in setup state so it works across browsers and devices. Settings remains visible as the recovery path.

## Data model

```text
FeedSource
  id, label, url, enabled, topics[]

FeedDigestProfile
  id, title, enabled
  sourceIds[]             # empty means all enabled sources
  instructions            # user-specific editorial prompt
  cadence                 # manual | multiple_daily | daily | weekly
  maxItems, lookbackHours

FeedDigestRunState
  profileId
  lastAttempt, lastSuccess, nextDue
  consecutiveFailures, error, partial

FeedArticle (bounded cache)
  id, sourceId, title, url, summary, published, discoveredAt

FeedDigest
  profileId, generatedAt, engine, overview
  items[] { articleId, title, summary, whyItMatters, url, source, published }
```

Storage:

- `.rss-config.json`: versioned canonical source/profile configuration.
- `00-System/Feeds.md`: human-readable compatibility view and legacy flat-URL migration input, never the structured source of authority.
- `.rss-articles.json`: bounded raw article cache and deduplication state.
- `.rss-digests.json`: latest successful digest per profile plus separate attempt/error/backoff state.
- `.second-brain-setup.json`: navigation visibility and setup-level defaults.

## Runtime flow

```text
Settings / MCP
      │
      ▼
Feed sources ──► safe RSS fetch ──► bounded article cache
                                         │
                              cadence says profile is due
                                         │
                                         ▼
                                 AI bridge /digest
                                         │
                           validate against known IDs/URLs
                                         │
                                         ▼
                                latest digest state
                                         │
                      dashboard catalog / optional widget
```

The existing instrumentation loop becomes a lightweight scheduler: it collects sources and runs only due profiles. `multiple_daily`, `daily`, and `weekly` map to explicit persisted elapsed intervals of 6 hours, 24 hours, and 7 days. Manual refresh remains available. A filesystem lease with expiry and a due-state recheck prevents concurrent processes or a restart from launching the same profile twice. Failures are isolated by source and profile; attempt state changes while the last successful digest remains visible with a stale/error marker and bounded retry backoff.

## UI behavior

### Settings

- “Sources & intelligence” section:
  - add/remove/enable RSS sources;
  - create/edit/delete digest profiles;
  - choose sources, editorial instructions, cadence, lookback, and item count;
  - run a profile now and show last-run state.
- “Navigation” section:
  - show/hide built-in main and utility links;
  - every destination starts visible on a new profile and can be hidden independently;
  - Settings cannot be hidden, so the user cannot lock themselves out.

### Dashboard

- A digest profile appears as a connected widget preset only when RSS is enabled, at least one source exists, and that profile is enabled.
- New digest widgets start hidden and are added through the existing block catalog.
- The widget shows one article at a time with previous/next controls, source/date, AI summary, “why it matters,” and the original link.
- Empty, loading, stale, partial-error, and AI-unavailable states are explicit.

### Sidebar

- Hidden routes remain directly reachable and no content is deleted.
- Module gates still apply; visibility is an additional filter.
- The Trail entry can therefore be removed on Antoine’s instance without removing training data or code.

## MCP surface

- `list_rss_sources` (read)
- `add_rss_source` (write)
- `remove_rss_source` (write)
- `list_rss_digests` (read)
- `upsert_rss_digest_profile` (write)
- `remove_rss_digest_profile` (write)
- `run_rss_digest` (write)

All write tools reuse the existing OAuth write scope and the same URL safety rules as browser configuration. Runtime validation is shared by Settings and MCP. Mutating batch calls are serialized per configuration file.

## Error and rescue registry

| Failure | User-visible behavior | Rescue |
|---|---|---|
| One source times out or returns invalid XML | Source error in Settings; other sources continue | Keep cached items and retry next cycle |
| AI bridge unavailable | Last digest stays visible and marked stale | Manual retry; no fabricated local “AI” digest |
| AI returns an unknown or out-of-profile article | Invalid item is dropped; run marked partial | Accept only article IDs, then rehydrate every URL/title/source/date from the exact candidate set |
| No recent articles match a profile | Widget shows a calm empty state | Broaden lookback/sources or wait for next run |
| Scheduler/process restarts | No duplicate digest storm | Persist last run and compute due state from disk |
| A nav item is hidden accidentally | Route still works directly | Settings remains permanently visible |
| Legacy flat feeds exist | They become enabled sources on read | Write back only after an explicit configuration change |

## Implementation tasks

### A. RSS intelligence engine (high reasoning)

- Add source/profile/article/digest contracts and migration in `src/lib/vault.ts` or a focused server-only module.
- Stop automatic Inbox pollution while preserving an opt-in capture path if needed.
- Add due-profile scheduling and bounded cache retention.
- Add `/digest` to `bridge/memo-bridge.py` with strict structured output.
- Extend MCP tools and tests.
- Apply `assertSafeFeedUrl` when configuring a source, keep DNS pinning on fetch/redirect, and reject non-HTTP(S) article links.
- Treat titles and summaries as hostile prompt input; the bridge must ignore embedded instructions.

### B. Settings, navigation, and widgets (standard reasoning)

- Persist hidden navigation entries in setup state and filter the sidebar.
- Add navigation and feed-intelligence controls to Settings.
- Generalize dashboard layout state for dynamic connected widget IDs.
- Add accessible digest carousel widgets and responsive styles.
- Add FR/EN strings and unit tests.

### C. Integration and adversarial verification (high reasoning)

- Verify migration, due scheduling, deduplication, AI trust boundaries, auth scopes, and failure isolation.
- Run typecheck, tests, lint, and build.
- Exercise Settings and dashboard at 390×844 and desktop width against a scratch vault.
- Preserve the existing uncommitted Trail/UI work and report any pre-existing failure separately.

## Test diagram

| Flow / branch | Coverage |
|---|---|
| Legacy URL list → source objects | Unit migration test |
| Duplicate item across polling cycles | Unit ingestion/cache test |
| Source failure among successful sources | Unit partial-ingestion test |
| Cadence due/not-due after restart | Unit schedule test |
| Two processes attempt the same due profile | Filesystem lease/concurrency test |
| Failed refresh after a previous success | Latest-success preservation test |
| Bridge output references unknown URL | Contract validation test |
| Bridge output references a known but out-of-profile article | Candidate-set validation test |
| MCP read/write scope separation | MCP route test |
| Dynamic widget hidden by default/restorable | Dashboard state test |
| Profile-specific Library/Training visibility and legacy route migration | Navigation normalization test |
| Empty/stale/error digest rendering | Component/browser checks |
| Mobile sidebar and widget carousel | 390×844 browser verification |

## NOT in scope

- A full-text article scraper or paywall bypass.
- Email newsletters and authenticated feeds.
- Semantic vector search or a new database.
- Deleting the Wiki/Library data model or its route.

## Acceptance criteria

- Adding an RSS source works from Settings and MCP.
- At least one configurable digest profile can produce an AI-processed result from known feed items.
- Multiple profiles create independent optional dashboard widgets.
- Cadence supports manual, several times per day, daily, and weekly.
- No configured sources means no RSS widget presets are shown.
- Library can be hidden from Antoine's sidebar, while its route and knowledge workflows still work.
- Tasks, Objectives, Trail, and other sidebar entries can be hidden and restored in Settings.
- Current unrelated uncommitted changes remain untouched.
- `npm run typecheck`, `npm test`, and touched-file lint pass; mobile and desktop UI checks are recorded.
