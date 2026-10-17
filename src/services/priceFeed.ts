import type { Stock, Fundamentals, LiveQuote, MarketIndicesData, CorporateEventData, StockEdgeNewsResponse } from '../types';

const DEFAULT_PRODUCTION_API = 'https://stock-market-api-odq1.onrender.com';

export function getApiBaseUrl(): string {
  const rawEnv = import.meta.env?.VITE_API_BASE_URL || import.meta.env?.VITE_PRICE_SERVER_URL;
  if (rawEnv && typeof rawEnv === 'string' && rawEnv.trim().length > 0) {
    let clean = rawEnv.trim().replace(/\/$/, '');
    // If configured as bare service name or domain without protocol (e.g. stock-market-api-odq1)
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      if (!clean.includes('.') && !clean.includes(':')) {
        clean = `${clean}.onrender.com`;
      }
      clean = `https://${clean}`;
    }
    return clean;
  }
  return DEFAULT_PRODUCTION_API;
}

export const PROXY_BASE_URL = getApiBaseUrl();

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
 * Safely parse JSON from a fetch Response, protecting against HTML (<!doctype ...)
 * and empty responses from idling servers or gateway timeouts.
 */
async function safeJsonParse<T>(res: Response): Promise<T | null> {
  if (!res || !res.ok) return null;
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return null;
  }
  try {
    const text = await res.text();
    if (!text || text.trim().length === 0) return null;
    return JSON.parse(text) as T;
  } catch (err) {
    return null;
  }
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

    return await safeJsonParse<MarketIndicesData>(res);
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

    const data = await safeJsonParse<{ quotes: LiveQuote[] }>(res);
    return data?.quotes || [];
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
    price?: number;
    previousClose?: number;
    change?: number;
    changePercent?: number;
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

    const data = await safeJsonParse<{ results: any[] }>(res);
    return data?.results || [];
  } catch (err) {
    return [];
  }
}

/**
 * Fetch Corporate Events (Dividends & Splits) for a symbol
 */
export async function fetchCorporateEvents(
  symbol: string,
  bseCode?: string
): Promise<CorporateEventData | null> {
  if (!symbol) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const bseParam = bseCode ? `&bseCode=${encodeURIComponent(bseCode.trim())}` : '';
    const res = await fetch(
      `${PROXY_BASE_URL}/api/events?symbol=${encodeURIComponent(symbol.trim())}${bseParam}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    return await safeJsonParse<CorporateEventData>(res);
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

    return await safeJsonParse<{
      symbol: string;
      bseCode?: string;
      fundamentals: Partial<Fundamentals>;
      bseData?: any;
    }>(res);
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

    return await safeJsonParse<StockEdgeNewsResponse>(res);
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

    return await safeJsonParse<{ success: boolean; added: boolean; stock?: any }>(res);
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

/**
 * Fetch BSE Quote from /api/bse-quote
 */
export async function fetchBseQuote(
  scripcode: string,
  symbol?: string,
  slug?: string
): Promise<any | null> {
  try {
    const symQuery = symbol ? `&symbol=${encodeURIComponent(symbol)}` : '';
    const slugQuery = slug ? `&slug=${encodeURIComponent(slug)}` : '';
    const res = await fetch(
      `${PROXY_BASE_URL}/api/bse-quote?scripcode=${encodeURIComponent(scripcode)}${symQuery}${slugQuery}`
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn(`[PriceFeed] Error fetching BSE quote for ${scripcode}:`, err);
    return null;
  }
}

/**
 * Task 2: Map all BSE & fundamental fields to Stock
 * Populates roe, pb, roce, debtToEquity, evToEbitda, salesCagr10Y, profitCagr10Y, dividendYield, sectorPe, intrinsicValue
 * whenever they are not manually locked (fieldSources[field] !== 'manual' && fieldSources[field] !== 'screener').
 * Automatically calculates Intrinsic Value using Graham's formula and Margin of Safety (%).
 * Fallback sectorPe from average pe of all stocks sharing the same sector / basicIndustry.
 */
export function applyFeedToStock(
  stock: Stock,
  feedData: {
    fundamentals?: Partial<Fundamentals>;
    bseData?: any;
    quote?: LiveQuote;
  },
  allStocks: Stock[] = []
): Stock {
  const sources = stock.fieldSources || {};
  const isLocked = (field: string) => sources[field] === 'manual' || sources[field] === 'screener';

  const updated: Stock = { ...stock };
  const fund = feedData.fundamentals || {};
  const bse = feedData.bseData || {};
  const quote = feedData.quote;

  const currentPrice = quote?.price || stock.targetBuyPrice || 0;

  // Sector PE: use feed/stock sectorPe, or compute average pe from db.stocks with same sector/basicIndustry
  let sectorPe = fund.sectorPE || stock.sectorPe;
  if (!sectorPe && allStocks.length > 0) {
    const peers = allStocks.filter(
      (s) =>
        s.id !== stock.id &&
        (s.sector === stock.sector || (stock.basicIndustry && s.basicIndustry === stock.basicIndustry)) &&
        (s.peConsolidated || s.peStandalone)
    );
    if (peers.length > 0) {
      const sumPe = peers.reduce((acc, curr) => acc + (curr.peConsolidated || curr.peStandalone || 0), 0);
      sectorPe = Math.round((sumPe / peers.length) * 100) / 100;
    }
  }

  // Populate fundamental ratios if not locked
  if (!isLocked('sectorPe') && sectorPe) updated.sectorPe = sectorPe;
  if (!isLocked('roe')) updated.roe = fund.roe ?? bse.roe ?? stock.roe;
  if (!isLocked('pb')) updated.pb = fund.pbRatio ?? bse.pbRatio ?? stock.pb;
  if (!isLocked('roce')) updated.roce = fund.roce ?? stock.roce;
  if (!isLocked('debtToEquity')) updated.debtToEquity = fund.debtToEquity ?? stock.debtToEquity;
  if (!isLocked('evToEbitda')) updated.evToEbitda = fund.evToEbitda ?? stock.evToEbitda;
  if (!isLocked('salesCagr10Y')) updated.salesCagr10Y = fund.salesCagr10Y ?? stock.salesCagr10Y;
  if (!isLocked('profitCagr10Y')) updated.profitCagr10Y = fund.profitCagr10Y ?? stock.profitCagr10Y;
  if (!isLocked('dividendYield')) updated.dividendYield = fund.dividendYield ?? quote?.dividendYield ?? stock.dividendYield;

  // BSE specific fields
  if (!isLocked('vwap')) updated.vwap = bse.vwap ?? fund.vwap ?? stock.vwap;
  if (!isLocked('epsStandalone')) updated.epsStandalone = bse.epsStandalone ?? fund.epsStandalone ?? stock.epsStandalone;
  if (!isLocked('epsConsolidated')) updated.epsConsolidated = bse.epsConsolidated ?? fund.epsConsolidated ?? bse.eps ?? stock.epsConsolidated;
  if (!isLocked('cepsStandalone')) updated.cepsStandalone = bse.cepsStandalone ?? stock.cepsStandalone;
  if (!isLocked('cepsConsolidated')) updated.cepsConsolidated = bse.ceps ?? stock.cepsConsolidated;
  if (!isLocked('peStandalone')) updated.peStandalone = bse.peStandalone ?? stock.peStandalone;
  if (!isLocked('peConsolidated')) updated.peConsolidated = bse.peConsolidated ?? bse.pe ?? quote?.pe ?? stock.peConsolidated;
  if (!isLocked('upperPriceBand')) updated.upperPriceBand = bse.upperBand ?? bse.upperPriceBand ?? fund.upperBand ?? stock.upperPriceBand;
  if (!isLocked('lowerPriceBand')) updated.lowerPriceBand = bse.lowerBand ?? bse.lowerPriceBand ?? fund.lowerBand ?? stock.lowerPriceBand;
  if (!isLocked('priceBand')) updated.priceBand = bse.priceBand ?? stock.priceBand;
  if (!isLocked('ttqLakh')) updated.ttqLakh = bse.ttqLakh ?? stock.ttqLakh;
  if (!isLocked('turnoverCr')) updated.turnoverCr = bse.turnoverCr ?? stock.turnoverCr;
  if (!isLocked('twoWeekAvgQtyLakh')) updated.twoWeekAvgQtyLakh = bse.avgQty2WLakh ?? fund.avgQty2WLakh ?? stock.twoWeekAvgQtyLakh;
  if (!isLocked('mcapFullCr')) updated.mcapFullCr = bse.mcapFullCr ?? stock.mcapFullCr;
  if (!isLocked('mcapFfCr')) updated.mcapFfCr = bse.mcapFFCr ?? fund.mcapFFCr ?? stock.mcapFfCr;
  if (!isLocked('faceValue')) updated.faceValue = bse.faceValue ?? fund.faceValue ?? stock.faceValue;
  if (!isLocked('bseCategory')) updated.bseCategory = bse.bseCategory ?? bse.category ?? stock.bseCategory;
  if (!isLocked('bseGroup')) updated.bseGroup = bse.bseGroup ?? bse.group ?? stock.bseGroup;
  if (!isLocked('bseIndex')) updated.bseIndex = bse.index ?? fund.bseIndex ?? stock.bseIndex;
  if (!isLocked('basicIndustry')) updated.basicIndustry = bse.basicIndustry ?? fund.basicIndustry ?? stock.basicIndustry;
  if (!isLocked('latestDividendAmount')) updated.latestDividendAmount = quote?.latestDividend?.amount ?? stock.latestDividendAmount;
  if (!isLocked('latestDividendExDate')) updated.latestDividendExDate = quote?.latestDividend?.date ?? stock.latestDividendExDate;

  // Intrinsic Value (Fair) & Margin of Safety
  if (!isLocked('intrinsicValue')) {
    const eps = updated.epsConsolidated || updated.epsStandalone;
    const pb = updated.pb;
    let intrinsic = fund.intrinsicValue;
    if (!intrinsic && eps && pb && pb > 0 && currentPrice > 0) {
      const bookValuePerShare = currentPrice / pb;
      intrinsic = Math.round(Math.sqrt(22.5 * eps * bookValuePerShare) * 100) / 100;
    }
    if (intrinsic) {
      updated.intrinsicValue = intrinsic;
      if (currentPrice > 0) {
        updated.marginOfSafety = Math.round(((intrinsic - currentPrice) / intrinsic) * 10000) / 100;
      }
    }
  }

  return updated;
}
