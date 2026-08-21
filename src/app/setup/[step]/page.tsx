import { redirect } from "next/navigation";
import { SetupWizard } from "@/components/SetupWizard";
import { readAiBridgeStatus } from "@/lib/ai-bridge";
import { SETUP_STEPS, readSetupState, setupPath, type SetupStep } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default async function SetupStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ step: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ step: rawStep }, { error }, state] = await Promise.all([
    params,
    searchParams,
    readSetupState(),
  ]);
  if (!SETUP_STEPS.includes(rawStep as SetupStep)) redirect(setupPath(state.currentStep));
  const step = rawStep as SetupStep;
  const bridge = step === "ai" ? await readAiBridgeStatus(state.ai.verified) : undefined;

  return <SetupWizard step={step} state={state} error={error} bridge={bridge} />;
}
