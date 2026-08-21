import "./business.css";
import { BusinessWorkspace } from "@/components/BusinessWorkspace";
import { todayISO } from "@/lib/dates";
import { listBusinessRecords, noteForClient, readBusinessSettings } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default async function BusinessPage() {
  const [records, settings] = await Promise.all([listBusinessRecords(), readBusinessSettings()]);
  return <BusinessWorkspace records={records.map(noteForClient)} settings={settings} today={todayISO()} />;
}
