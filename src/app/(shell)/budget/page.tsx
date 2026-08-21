import { MonthlyBudgetTracker } from "@/components/Finance";
import { getTranslations } from "@/lib/i18n-server";
import { readMonthlyBudget } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ currency?: string }>;
}) {
  const [params, t] = await Promise.all([searchParams, getTranslations()]);
  const baseCurrency = params.currency?.toUpperCase() === "USD" ? "USD" : "EUR";
  const initialBudget = await readMonthlyBudget();

  return (
    <div className="dash">
      <header className="dash-header">
        <div className="dash-greeting">
          <p className="eyebrow">{t["nav.finances"]}</p>
          <h1>{t["nav.budget"]}</h1>
          <p className="muted">{t["budget.description"]}</p>
        </div>
      </header>
      <MonthlyBudgetTracker currency={baseCurrency} initialBudget={initialBudget} />
    </div>
  );
}
