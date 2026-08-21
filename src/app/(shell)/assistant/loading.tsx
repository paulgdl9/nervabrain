import { LoaderCircle } from "lucide-react";
import { getTranslations } from "@/lib/i18n-server";
import "./assistant.css";

export default async function AssistantLoading() {
  const t = await getTranslations();
  return (
    <div className="dash assistant-page">
      <div className="assistant-card assistant-route-loading" role="status" aria-live="polite">
        <LoaderCircle className="is-spinning" size={28} aria-hidden />
        <span>{t["assistant.loading"]}</span>
      </div>
    </div>
  );
}
