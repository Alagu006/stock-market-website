import type { Fundamentals, LiveQuote, MarketIndicesData, CorporateEventData, StockEdgeNewsResponse } from '../types';

const DEFAULT_PRODUCTION_API = 'https://stock-market-api-odq1.onrender.com';

function resolveProxyBaseUrl(): string {
  const envUrl = import.meta.env.VITE_PRICE_SERVER_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/$/, '');
  }
  // If running in browser and not on localhost, automatically connect to the live Render price API
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return DEFAULT_PRODUCTION_API;
    }
  }
  return '';
}

export const PROXY_BASE_URL = resolveProxyBaseUrl();

/**
 * Checks if the current time is within Indian Stock Market Trading Hours
 * Market Hours: Monday to Friday, 09:15 to 15:30 IST (UTC +5:30)
 * Excludes Saturdays and Sundays.
 */
export function isIndianMarketOpen(now: Date = new Date()): boolean {
  // Convert UTC date to IST (+5 hours 30 mins)
  // now.getTime() returns absolute UTC milliseconds since epoch
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffsetMs);

  const dayOfWeek = istDate.getUTCDay(); // 0 is Sunday, 6 is Saturday
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  const marketOpenMinutes = 9 * 60 + 15; // 09:15 IST
  const marketCloseMinutes = 15 * 60 + 30; // 15:30 IST

  return totalMinutes >= marketOpenMinutes && totalMinutes <= marketCloseMinutes;
}

/**
 * Symbol mapping for Yahoo Finance upstream:
 * NSE: SYMBOL.NS (e.g. RELIANCE.NS, M&M.NS, BAJAJ-AUTO.NS)
 * BSE: Prefer SYMBOL.BO, or 6-digit CODE.BO if symbol unavailable
 */
export function getYahooSymbolForExchange(
  stock: { symbol: string; bseCode?: string },
  exchange: 'NSE' | 'BSE'
): string {
  const sym = stock.symbol.trim().toUpperCase();
  if (exchange === 'NSE') {
    return `${sym}.NS`;
  } else {
    // BSE: Yahoo Finance handles both CODE.BO (e.g. 500325.BO) and SYMBOL.BO (e.g. RELIANCE.BO)
    if (stock.bseCode && stock.bseCode.trim().length > 0) {
      return `${stock.bseCode.trim().toUpperCase()}.BO`;
    }
    return `${sym}.BO`;
  }
}

/**
 * Fallback alternative symbol (if preferred exchange symbol is unavailable)
 */
export function getFallbackYahooSymbol(
  stock: { symbol: string; bseCode?: string },
  preferredExchange: 'NSE' | 'BSE'
): string {
  const fallbackExchange = preferredExchange === 'NSE' ? 'BSE' : 'NSE';
  return getYahooSymbolForExchange(stock, fallbackExchange);
}

/**
 * Ping Proxy Server Health Check
 */
export async function checkProxyHealth(): Promise<{
  isOnline: boolean;
  message: string;
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${PROXY_BASE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      return { isOnline: true, message: 'Price server connected' };
    }
    return { isOnline: false, message: `Server returned status ${res.status}` };
  } catch (err: any) {
    return {
      isOnline: false,
      message:
        'Connecting to price server... (free-tier servers may take 30–50s to wake up if idle)',
    };
  }
}

/**
 * Fetch Major Indian Indices (NIFTY 50, SENSEX, NIFTY BANK)
 */
export async function fetchLiveMarketIndices(): Promise<MarketIndicesData | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${PROXY_BASE_URL}/api/indices`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

/**
 * Batch Fetch Live Quotes from Proxy
 */
export async function fetchLiveQuotes(symbols: string[]): Promise<LiveQuote[]> {
  if (!symbols || symbols.length === 0) return [];

  const unique = Array.from(new Set(symbols.map((s) => s.trim()))).filter(Boolean);
  const encoded = unique.map((s) => encodeURIComponent(s)).join(',');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${PROXY_BASE_URL}/api/quote?symbols=${encoded}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return [];
    const data = await res.json();
    return data.quotes || [];
  } catch (err) {
    console.warn('[PriceFeed] Failed to fetch live quotes:', err);
    return [];
  }
}

/**
 * Search live companies / symbols (as backup when bundled list has no match)
 */
export async function searchLiveSymbols(query: string): Promise<
  Array<{
    symbol: string;
    cleanSymbol: string;
    name: string;
    exchange: string;
    exchangeDisplay: string;
    type: string;
  }>
> {
  if (!query || query.trim().length === 0) return [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${PROXY_BASE_URL}/api/search?q=${encodeURIComponent(query.trim())}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch (err) {
    return [];
  }
}

/**
 * Fetch Corporate Events (Dividends & Splits) for a symbol
 */
export async function fetchCorporateEvents(symbol: string): Promise<CorporateEventData | null> {
  if (!symbol) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `${PROXY_BASE_URL}/api/events?symbol=${encodeURIComponent(symbol.trim())}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

/**
 * Task 1: Fetch enriched fundamentals from Proxy (BSE + Yahoo + Graham Intrinsic Value)
 */
export async function fetchStockFundamentals(
  symbol: string,
  bseCode?: string,
  currentPrice?: number,
  slug?: string
): Promise<{
  symbol: string;
  bseCode?: string;
  fundamentals: Partial<Fundamentals>;
  bseData?: any;
} | null> {
  if (!symbol) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const params = new URLSearchParams({
      symbol: symbol.trim(),
    });
    if (bseCode) params.set('bseCode', bseCode.trim());
    if (currentPrice) params.set('currentPrice', String(currentPrice));
    if (slug) params.set('slug', slug.trim());

    const res = await fetch(`${PROXY_BASE_URL}/api/fundamentals?${params.toString()}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn(`[PriceFeed] Error fetching fundamentals for ${symbol}:`, err);
    return null;
  }
}

/**
 * Task 3: Fetch on-demand StockEdge news & updates
 */
export async function fetchStockEdgeNews(symbol: string): Promise<StockEdgeNewsResponse | null> {
  if (!symbol) return null;
  try {
    const controller = new AbortController();
    // 15s timeout to allow safe 5-10s server-side rate limit throttle
    const timeout = setTimeout(() => controller.abort(), 18000);
    const res = await fetch(
      `${PROXY_BASE_URL}/api/stockedge-updates?symbol=${encodeURIComponent(symbol.trim())}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn(`[PriceFeed] Error fetching StockEdge news for ${symbol}:`, err);
    return null;
  }
}

/**
 * Task 4: Auto-add searched stock to stocks-directory.json
 */
export async function addStockToRemoteDirectory(stockData: {
  nseSymbol?: string;
  symbol?: string;
  bseCode?: string;
  name: string;
  isin?: string;
  sector?: string;
  marketCapCategory?: string;
}): Promise<{ success: boolean; added: boolean; stock?: any } | null> {
  try {
    const res = await fetch(`${PROXY_BASE_URL}/api/directory/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stockData),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('[PriceFeed] Failed to add stock to remote directory:', err);
    return null;
  }
}

/**
 * Auto-fill empty fundamentals from live feed without overwriting user manual or Screener values.
 * Rule: Live feed ONLY populates fields if they are currently null, undefined, or 0.
 * Preserves Screener/Manual fields with metadata tagging.
 */
export function mergeFeedFundamentals(
  existing: Fundamentals | undefined,
  feedQuote: LiveQuote | undefined,
  stockId: number,
  symbol: string,
  enriched?: Partial<Fundamentals>
): Fundamentals {
  const base: Fundamentals = existing || {
    stockId,
    symbol,
    lastUpdated: new Date().toISOString().split('T')[0],
  };

  const high52W = base.high52W || feedQuote?.high52W || enriched?.high52W || undefined;
  const low52W = base.low52W || feedQuote?.low52W || enriched?.low52W || undefined;
  const stockPE = base.stockPE || feedQuote?.pe || enriched?.stockPE || undefined;
  const dividendYield = base.dividendYield || feedQuote?.dividendYield || enriched?.dividendYield || undefined;
  const marketCapCr = base.marketCapCr || feedQuote?.marketCap || enriched?.marketCapCr || undefined;

  // Additional Task 1 metrics
  const roce = base.roce || enriched?.roce || undefined;
  const roe = base.roe || enriched?.roe || undefined;
  const debtToEquity = base.debtToEquity || enriched?.debtToEquity || undefined;
  const evToEbitda = base.evToEbitda || enriched?.evToEbitda || undefined;
  const pbRatio = base.pbRatio || enriched?.pbRatio || undefined;
  const salesCagr10Y = base.salesCagr10Y || enriched?.salesCagr10Y || undefined;
  const profitCagr10Y = base.profitCagr10Y || enriched?.profitCagr10Y || undefined;
  const intrinsicValue = base.intrinsicValue || enriched?.intrinsicValue || undefined;
  const marginOfSafety = base.marginOfSafety || enriched?.marginOfSafety || undefined;

  // BSE specific metrics
  const vwap = base.vwap || enriched?.vwap || feedQuote?.bseData?.vwap || undefined;
  const epsStandalone = base.epsStandalone || enriched?.epsStandalone || feedQuote?.bseData?.epsStandalone || undefined;
  const epsConsolidated = base.epsConsolidated || enriched?.epsConsolidated || feedQuote?.bseData?.epsConsolidated || undefined;
  const ceps = base.ceps || enriched?.ceps || feedQuote?.bseData?.ceps || undefined;
  const mcapFFCr = base.mcapFFCr || enriched?.mcapFFCr || feedQuote?.bseData?.mcapFFCr || undefined;
  const avgQty2WLakh = base.avgQty2WLakh || enriched?.avgQty2WLakh || feedQuote?.bseData?.avgQty2WLakh || undefined;
  const faceValue = base.faceValue || enriched?.faceValue || feedQuote?.bseData?.faceValue || undefined;
  const basicIndustry = base.basicIndustry || enriched?.basicIndustry || feedQuote?.bseData?.basicIndustry || undefined;
  const upperBand = base.upperBand || enriched?.upperBand || feedQuote?.bseData?.upperBand || undefined;
  const lowerBand = base.lowerBand || enriched?.lowerBand || feedQuote?.bseData?.lowerBand || undefined;
  const bseIndex = base.bseIndex || enriched?.bseIndex || feedQuote?.bseData?.index || undefined;

  return {
    ...base,
    high52W,
    low52W,
    stockPE,
    dividendYield,
    marketCapCr,
    roce,
    roe,
    debtToEquity,
    evToEbitda,
    pbRatio,
    salesCagr10Y,
    profitCagr10Y,
    intrinsicValue,
    marginOfSafety,
    vwap,
    epsStandalone,
    epsConsolidated,
    ceps,
    mcapFFCr,
    avgQty2WLakh,
    faceValue,
    basicIndustry,
    upperBand,
    lowerBand,
    bseIndex,
    feedSourceTags: {
      high52W: base.high52W ? (base.feedSourceTags?.high52W || 'Manual / Screener') : 'Feed',
      low52W: base.low52W ? (base.feedSourceTags?.low52W || 'Manual / Screener') : 'Feed',
      stockPE: base.stockPE ? (base.feedSourceTags?.stockPE || 'Manual / Screener') : 'Feed',
      dividendYield: base.dividendYield ? (base.feedSourceTags?.dividendYield || 'Manual / Screener') : 'Feed',
      marketCapCr: base.marketCapCr ? (base.feedSourceTags?.marketCapCr || 'Manual / Screener') : 'Feed',
      roe: base.roe ? (base.feedSourceTags?.roe || 'Manual / Screener') : 'Feed',
      pbRatio: base.pbRatio ? (base.feedSourceTags?.pbRatio || 'Manual / Screener') : 'Feed',
      roce: base.roce ? (base.feedSourceTags?.roce || 'Manual / Screener') : 'Feed',
      debtToEquity: base.debtToEquity ? (base.feedSourceTags?.debtToEquity || 'Manual / Screener') : 'Feed',
      evToEbitda: base.evToEbitda ? (base.feedSourceTags?.evToEbitda || 'Manual / Screener') : 'Feed',
      salesCagr10Y: base.salesCagr10Y ? (base.feedSourceTags?.salesCagr10Y || 'Manual / Screener') : 'Feed',
      profitCagr10Y: base.profitCagr10Y ? (base.feedSourceTags?.profitCagr10Y || 'Manual / Screener') : 'Feed',
      intrinsicValue: base.intrinsicValue ? (base.feedSourceTags?.intrinsicValue || 'Manual / Screener') : 'Calculated',
      marginOfSafety: base.marginOfSafety ? (base.feedSourceTags?.marginOfSafety || 'Manual / Screener') : 'Calculated',
    },
    lastUpdated: new Date().toISOString().split('T')[0],
  };
}
