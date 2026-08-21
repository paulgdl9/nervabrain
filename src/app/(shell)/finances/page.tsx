import { FinanceForm } from "@/components/Forms";
import { FinanceDashboard, FinanceList } from "@/components/Finance";
import { getFinanceHistory, listFinancePositionsWithLivePrices } from "@/lib/vault";
import { getTranslations } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function FinancesPage({
  searchParams,
}: {
  searchParams: Promise<{ currency?: string }>;
}) {
  const params = await searchParams;
  const baseCurrency = params.currency?.toUpperCase() === "USD" ? "USD" : "EUR";
  const [positions, t] = await Promise.all([listFinancePositionsWithLivePrices(baseCurrency), getTranslations()]);
  const history = await getFinanceHistory(positions, baseCurrency);

  return (
    <>
      <div className="dash">
        <header className="dash-header">
          <div className="dash-greeting">
            <p className="eyebrow">{t["page.finances.eyebrow"]}</p>
            <h1>{t["page.finances.title"]}</h1>
            <p className="muted">{t["page.finances.description"]}</p>
          </div>
        </header>
        <FinanceDashboard positions={positions} history={history} baseCurrency={baseCurrency} />
        <div className="dash-columns finance-columns">
          <div className="col-main">
            <section className="panel">
              <div className="panel-header">
                <h2>{t["page.finances.positions"]} ({positions.length})</h2>
              </div>
              <FinanceList positions={positions} />
            </section>
          </div>
          <div className="col-side">
            <section className="panel">
              <div className="panel-header">
                <h2>{t["page.finances.newPosition"]}</h2>
              </div>
              <FinanceForm />
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
