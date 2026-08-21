export type MarketQuote = {
  price: number;
  currency: string;
  symbol: string;
  name: string;
  changePercent: number | null;
  previousClose: number | null;
  provider: "yahoo" | "coingecko";
  quotedAt: string;
};

export type MarketHistoryPoint = { date: string; price: number };

type YahooSearchResult = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  score?: number;
};

const REQUEST_TIMEOUT_MS = 10_000;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; SecondBrain/1.0)",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    next: { revalidate: 300 },
  });
  if (!response.ok) throw new Error(`Market data request failed (${response.status})`);
  return response.json();
}

function isYahooInstrument(result: YahooSearchResult) {
  return ["EQUITY", "ETF", "MUTUALFUND", "INDEX", "CURRENCY"].includes(result.quoteType || "");
}

async function resolveYahooSymbol(identifier: string): Promise<{ symbol: string; name: string }> {
  const query = identifier.trim();
  if (!query) throw new Error("ISIN or ticker is required");

  try {
    const json = (await getJson(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`,
    )) as { quotes?: YahooSearchResult[] };
    const candidates = (json.quotes || []).filter((result) => result.symbol && isYahooInstrument(result));
    const exact = candidates.find((result) => result.symbol?.toUpperCase() === query.toUpperCase());
    const result = exact || candidates.sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    if (result?.symbol) {
      return { symbol: result.symbol, name: result.longname || result.shortname || result.symbol };
    }
  } catch {
    // A ticker can still be queried directly if Yahoo search is temporarily throttled.
  }

  if (/^[A-Z0-9^=.\-]{1,30}$/i.test(query) && !/^[A-Z]{2}[A-Z0-9]{9}\d$/i.test(query)) {
    return { symbol: query.toUpperCase(), name: query.toUpperCase() };
  }
  throw new Error("No listed instrument found for this ISIN or ticker");
}

export async function fetchYahooQuote(identifier: string, knownSymbol = ""): Promise<MarketQuote> {
  const resolved = knownSymbol
    ? { symbol: knownSymbol.trim(), name: knownSymbol.trim() }
    : await resolveYahooSymbol(identifier);
  const json = (await getJson(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(resolved.symbol)}?interval=1d&range=5d`,
  )) as {
    chart?: {
      result?: Array<{
        meta?: Record<string, unknown>;
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
      error?: { description?: string } | null;
    };
  };
  const result = json.chart?.result?.[0];
  const meta = result?.meta || {};
  const closes = result?.indicators?.quote?.[0]?.close?.filter((value): value is number => typeof value === "number") || [];
  const price = finiteNumber(meta.regularMarketPrice) ?? closes.at(-1) ?? null;
  const previousClose = finiteNumber(meta.chartPreviousClose) ?? (closes.length > 1 ? closes.at(-2)! : null);
  if (price === null) throw new Error(json.chart?.error?.description || "No current price returned for this instrument");

  return {
    price,
    previousClose,
    changePercent: previousClose && previousClose !== 0 ? ((price - previousClose) / previousClose) * 100 : null,
    currency: String(meta.currency || "EUR").toUpperCase(),
    symbol: String(meta.symbol || resolved.symbol),
    name: String(meta.longName || meta.shortName || resolved.name),
    provider: "yahoo",
    quotedAt: new Date().toISOString(),
  };
}

export async function fetchYahooHistory(identifier: string, knownSymbol = ""): Promise<MarketHistoryPoint[]> {
  const resolved = knownSymbol
    ? { symbol: knownSymbol.trim(), name: knownSymbol.trim() }
    : await resolveYahooSymbol(identifier);
  const json = (await getJson(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(resolved.symbol)}?interval=1d&range=5y`,
  )) as {
    chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> };
  };
  const result = json.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  return timestamps.flatMap((timestamp, index) => {
    const price = closes[index];
    return typeof price === "number" && Number.isFinite(price)
      ? [{ date: new Date(timestamp * 1000).toISOString().slice(0, 10), price }]
      : [];
  });
}

export async function fetchCoinGeckoQuote(id: string, currency = "EUR"): Promise<MarketQuote> {
  const coinId = id.trim().toLowerCase();
  const quoteCurrency = currency.trim().toLowerCase() || "eur";
  if (!coinId) throw new Error("CoinGecko identifier is required");
  const json = (await getJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=${encodeURIComponent(quoteCurrency)}&include_24hr_change=true&include_last_updated_at=true`,
  )) as Record<string, Record<string, unknown>>;
  const data = json[coinId];
  const price = finiteNumber(data?.[quoteCurrency]);
  if (price === null) throw new Error("CoinGecko returned no price for this identifier");
  const updatedAt = finiteNumber(data?.last_updated_at);
  return {
    price,
    currency: quoteCurrency.toUpperCase(),
    symbol: coinId,
    name: coinId,
    changePercent: finiteNumber(data?.[`${quoteCurrency}_24h_change`]),
    previousClose: null,
    provider: "coingecko",
    quotedAt: updatedAt ? new Date(updatedAt * 1000).toISOString() : new Date().toISOString(),
  };
}

export async function fetchCoinGeckoHistory(id: string, currency = "EUR"): Promise<MarketHistoryPoint[]> {
  const coinId = id.trim().toLowerCase();
  const quoteCurrency = currency.trim().toLowerCase() || "eur";
  if (!coinId) throw new Error("CoinGecko identifier is required");
  const json = (await getJson(
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=${encodeURIComponent(quoteCurrency)}&days=365&interval=daily`,
  )) as { prices?: Array<[number, number]> };
  return (json.prices || []).flatMap(([timestamp, price]) => Number.isFinite(price)
    ? [{ date: new Date(timestamp).toISOString().slice(0, 10), price }]
    : []);
}

export async function fetchMarketQuote(input: {
  assetType: string;
  identifier: string;
  currency?: string;
  knownSymbol?: string;
}): Promise<MarketQuote> {
  if (input.assetType === "crypto") {
    return fetchCoinGeckoQuote(input.identifier, input.currency || "EUR");
  }
  if (input.assetType === "stock" || input.assetType === "etf") {
    return fetchYahooQuote(input.identifier, input.knownSymbol);
  }
  throw new Error("This asset type uses a manual valuation");
}

export async function fetchMarketHistory(input: {
  assetType: string;
  identifier: string;
  currency?: string;
  knownSymbol?: string;
}): Promise<MarketHistoryPoint[]> {
  if (input.assetType === "crypto") return fetchCoinGeckoHistory(input.identifier, input.currency || "EUR");
  if (input.assetType === "stock" || input.assetType === "etf") return fetchYahooHistory(input.identifier, input.knownSymbol);
  return [];
}

export async function fetchFxRate(from: string, to: string): Promise<number> {
  const source = from.trim().toUpperCase();
  const target = to.trim().toUpperCase();
  if (!source || source === target) return 1;
  const quote = await fetchYahooQuote(`${source}${target}=X`, `${source}${target}=X`);
  return quote.price;
}
