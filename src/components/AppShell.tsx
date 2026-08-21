import { listCustomPages, listPinnedNotes, noteHref, readSetupState } from "@/lib/vault";
import { AppShellChrome } from "@/components/AppShellChrome";
import { configuredDashboardPassword } from "@/lib/dashboard-session";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const [pinned, customPages, setup] = await Promise.all([
    listPinnedNotes(),
    listCustomPages(),
    readSetupState(),
  ]);
  const pinnedItems = pinned.map((note) => ({ href: noteHref(note), label: note.title }));
  const customItems = customPages.map((page) => ({ slug: page.slug, title: page.title, icon: page.icon }));
  const authEnabled = Boolean(configuredDashboardPassword());

  return (
    <AppShellChrome pinnedItems={pinnedItems} customPages={customItems} modules={setup.modules} setupComplete={setup.status === "completed"} authEnabled={authEnabled}>
      {children}
    </AppShellChrome>
  );
}
