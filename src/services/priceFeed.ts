import type { Fundamentals, LiveQuote, MarketIndicesData, CorporateEventData } from '../types';

export const PROXY_BASE_URL = (import.meta.env.VITE_PRICE_SERVER_URL || '').replace(/\/$/, '');

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
 * Auto-fill empty fundamentals from live feed without overwriting user manual or Screener values.
 * Rule: Live feed ONLY populates fields if they are currently null, undefined, or 0.
 * Preserves Screener/Manual fields with metadata tagging.
 */
export function mergeFeedFundamentals(
  existing: Fundamentals | undefined,
  feedQuote: LiveQuote | undefined,
  stockId: number,
  symbol: string
): Fundamentals {
  const base: Fundamentals = existing || {
    stockId,
    symbol,
    lastUpdated: new Date().toISOString().split('T')[0],
  };

  if (!feedQuote) return base;

  // Auto-fill empty fields only
  const high52W = base.high52W || feedQuote.high52W || undefined;
  const low52W = base.low52W || feedQuote.low52W || undefined;
  const stockPE = base.stockPE || feedQuote.pe || undefined;
  const dividendYield = base.dividendYield || feedQuote.dividendYield || undefined;
  const marketCapCr = base.marketCapCr || feedQuote.marketCap || undefined;

  return {
    ...base,
    high52W,
    low52W,
    stockPE,
    dividendYield,
    marketCapCr,
    feedSourceTags: {
      high52W: base.high52W ? (base.feedSourceTags?.high52W || 'Manual / Screener') : 'Feed',
      low52W: base.low52W ? (base.feedSourceTags?.low52W || 'Manual / Screener') : 'Feed',
      stockPE: base.stockPE ? (base.feedSourceTags?.stockPE || 'Manual / Screener') : 'Feed',
      dividendYield: base.dividendYield ? (base.feedSourceTags?.dividendYield || 'Manual / Screener') : 'Feed',
      marketCapCr: base.marketCapCr ? (base.feedSourceTags?.marketCapCr || 'Manual / Screener') : 'Feed',
    },
    lastUpdated: new Date().toISOString().split('T')[0],
  };
}
