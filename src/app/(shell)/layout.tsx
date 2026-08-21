import { AppShell } from "@/components/AppShell";
import { redirect } from "next/navigation";
import { readSetupState, setupPath } from "@/lib/vault";

// The sidebar shell lives in this route-group layout so it persists across
// client navigations. When every page mounted its own AppShell, each
// navigation rebuilt the sidebar (nav re-read its localStorage order in an
// effect), producing a visible reflash on every page change.
export const dynamic = "force-dynamic";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const setup = await readSetupState();
  if (setup.status !== "completed") redirect(setupPath(setup.currentStep));
  return <AppShell>{children}</AppShell>;
}
