export const MAIN_NAV_HREFS = [
  "/",
  "/daily",
  "/weekly",
  "/notes",
  "/tasks",
  "/objectives",
  "/business",
  "/applications",
  "/finances",
  "/budget",
  "/training",
  "/revisions",
  "/wiki",
  "/assistant",
] as const;

export const UTILITY_NAV_HREFS = ["/setup", "/inbox", "/feeds", "/trash"] as const;
export const CONFIGURABLE_NAV_HREFS = [...MAIN_NAV_HREFS, ...UTILITY_NAV_HREFS] as const;
export type ConfigurableNavHref = (typeof CONFIGURABLE_NAV_HREFS)[number];

const CONFIGURABLE_NAV_SET = new Set<string>(CONFIGURABLE_NAV_HREFS);

export function normalizeHiddenNavigation(value: unknown, fallback: readonly string[] = []): ConfigurableNavHref[] {
  const input = Array.isArray(value) ? value : fallback;
  const migrated = input.map(String).map((href) => href === "/trail" ? "/training" : href === "/radio" ? "/revisions" : href);
  return [...new Set(migrated.filter((href): href is ConfigurableNavHref => CONFIGURABLE_NAV_SET.has(href)))];
}
