import { redirect } from "next/navigation";
import { readSetupState, setupPath } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const state = await readSetupState();
  redirect(setupPath(state.currentStep));
}
