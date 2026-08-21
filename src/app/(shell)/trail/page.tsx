import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The training workspace moved to /training; keep the old URL working for
// bookmarks and the home-screen shortcut.
export default async function TrailPage({ searchParams }: { searchParams: Promise<{ week?: string; tab?: string }> }) {
  const legacy = await searchParams;
  const params = new URLSearchParams();
  if (legacy.week) params.set("week", legacy.week);
  if (legacy.tab) params.set("tab", legacy.tab);
  const query = params.toString();
  redirect(`/training${query ? `?${query}` : ""}`);
}
