import { notFound } from "next/navigation";
import { RadioWorkspace } from "@/components/RadioWorkspace";
import { RevisionSetup } from "@/components/RevisionSetup";
import { getRevisionDashboard, getRevisionSetup } from "@/lib/radio";
import { readSetupState } from "@/lib/vault";
import "../radio/radio.css";

export const dynamic = "force-dynamic";

export default async function RevisionsPage() {
  const [data, setup, revisionSetup] = await Promise.all([getRevisionDashboard(), readSetupState(), getRevisionSetup()]);
  if (!setup.modules.revisions) notFound();
  return data ? <RadioWorkspace data={data} /> : <RevisionSetup data={revisionSetup} />;
}
