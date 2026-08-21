export function normalizeBusinessSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function matchesBusinessSearch(value: string, query: string) {
  return normalizeBusinessSearch(value).includes(normalizeBusinessSearch(query.trim()));
}

export function matchesBusinessCurrency(currency: string, configuredCurrency: string) {
  return currency.toUpperCase() === configuredCurrency.toUpperCase();
}

export function formatBusinessMoney(value: number, currency: string, locale: string, compact = false) {
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    minimumFractionDigits: 0,
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value);
}
