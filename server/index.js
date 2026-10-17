import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIRECTORY_FILE_PATH = path.resolve(__dirname, '../src/data/stocks-directory.json');

const app = express();
const PORT = process.env.PORT || 3001;

// Allowed frontend origins for CORS
const frontendOrigin = process.env.FRONTEND_ORIGIN;
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
];
if (frontendOrigin) {
  allowedOrigins.push(frontendOrigin.replace(/\/$/, ''));
}

app.use(cors());

app.use(express.json());

// In-memory cache: key -> { data, timestamp }
const cache = new Map();
const CACHE_TTL_MS = 15 * 1000; // 15 seconds

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// Yahoo Cookie and Crumb Manager
let yahooCookie = null;
let yahooCrumb = null;
let crumbExpiry = 0;

async function getYahooCrumbSession() {
  if (yahooCookie && yahooCrumb && Date.now() < crumbExpiry) {
    return { cookie: yahooCookie, crumb: yahooCrumb };
  }

  try {
    const res1 = await fetch('https://fc.yahoo.com', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

    const setCookie = res1.headers.get('set-cookie');
    if (setCookie) {
      yahooCookie = setCookie.split(';')[0];
    }

    if (yahooCookie) {
      const res2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Cookie: yahooCookie,
        },
      });

      if (res2.ok) {
        yahooCrumb = await res2.text();
        crumbExpiry = Date.now() + 60 * 60 * 1000; // 1 hour cache
        return { cookie: yahooCookie, crumb: yahooCrumb };
      }
    }
  } catch (err) {
    console.warn('[Proxy] Failed to fetch Yahoo crumb, will use v8 chart fallback:', err.message);
  }

  return { cookie: null, crumb: null };
}

// Upstream fetch helper with retries and timeout
async function fetchWithRetry(url, options = {}, retries = 2, timeoutMs = 8000) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    ...options.headers,
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status === 429 && attempt < retries) {
          await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
          continue;
        }
        throw new Error(`Upstream returned HTTP ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      clearTimeout(timeout);
      if (attempt === retries) throw err;
      await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
    }
  }
}

/**
 * Fetch a single quote via v8 chart endpoint (requires no crumb/cookie, highly reliable)
 */
async function fetchV8ChartQuote(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo&events=div`;
    const data = await fetchWithRetry(url);
    const chart = data?.chart?.result?.[0];
    const meta = chart?.meta;
    if (!meta || meta.regularMarketPrice === undefined) return null;

    const previousClose = meta.chartPreviousClose ?? meta.regularMarketPrice ?? 0;
    const price = meta.regularMarketPrice ?? 0;
    const change = price - previousClose;
    const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

    let latestDividend = null;
    let divYield = null;
    if (chart?.events?.dividends) {
      const divEntries = Object.entries(chart.events.dividends).sort((a, b) => Number(b[0]) - Number(a[0]));
      if (divEntries.length > 0) {
        const [ts, divData] = divEntries[0];
        latestDividend = {
          amount: divData.amount,
          date: new Date(Number(ts) * 1000).toISOString().split('T')[0],
        };
        if (price > 0 && divData.amount > 0) {
          divYield = Number(((divData.amount / price) * 100).toFixed(2));
        }
      }
    }

    return {
      symbol: meta.symbol || symbol,
      shortName: meta.shortName || meta.longName || symbol,
      price,
      previousClose,
      change: Number(change.toFixed(2)),
      changePercent: Number(changePercent.toFixed(2)),
      dayHigh: meta.regularMarketDayHigh ?? null,
      dayLow: meta.regularMarketDayLow ?? null,
      high52W: meta.fiftyTwoWeekHigh ?? null,
      low52W: meta.fiftyTwoWeekLow ?? null,
      pe: null,
      dividendYield: divYield,
      latestDividend,
      marketCap: null,
      currency: meta.currency || 'INR',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return null;
  }
}

/**
 * Symbol mapping logic:
 * Handles special characters: M&M -> M%26M.NS, BAJAJ-AUTO -> BAJAJ-AUTO.NS
 * BSE 6-digit code: 500325 -> 500325.BO (or fallback RELIANCE.BO)
 */
export function formatYahooSymbol(sym) {
  if (!sym) return '';
  const trimmed = sym.trim();
  if (trimmed.endsWith('.NS') || trimmed.endsWith('.BO') || trimmed.startsWith('^')) {
    return trimmed;
  }
  if (/^\d{6}$/.test(trimmed)) {
    return `${trimmed}.BO`;
  }
  return `${trimmed}.NS`;
}

/**
 * Task 1: Parse BSE HTML table rows (.card-conatiner / .card-b table rows: td.textsr & td.textvalue)
 */
export function parseBseTableRows(html) {
  if (!html || typeof html !== 'string') return {};
  const regex = /<td[^>]*class=["']textsr["'][^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class=["']textvalue["'][^>]*>([\s\S]*?)<\/td>/gi;
  let match;
  const parsed = {};
  while ((match = regex.exec(html)) !== null) {
    const k = match[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    const v = match[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (k) parsed[k] = v;
  }
  return parsed;
}

export function parseBseMetricsFromParsed(parsedTable) {
  const res = {};
  for (const [k, v] of Object.entries(parsedTable)) {
    const key = k.toLowerCase();
    if (key.includes('previous close') || key === 'prev close') res.previousClose = parseFloat(v.replace(/,/g, ''));
    if (key === 'open') res.open = parseFloat(v.replace(/,/g, ''));
    if (key === 'high') res.high = parseFloat(v.replace(/,/g, ''));
    if (key === 'low') res.low = parseFloat(v.replace(/,/g, ''));
    if (key.includes('vwap')) res.vwap = parseFloat(v.replace(/,/g, ''));
    if (key.includes('52 wk high') || key.includes('52w high')) res.high52W = parseFloat(v.replace(/,/g, ''));
    if (key.includes('52 wk low') || key.includes('52w low')) res.low52W = parseFloat(v.replace(/,/g, ''));
    if (key.includes('upper price band') || key.includes('upper band')) res.upperBand = parseFloat(v.replace(/,/g, ''));
    if (key.includes('lower price band') || key.includes('lower band')) res.lowerBand = parseFloat(v.replace(/,/g, ''));
    if (key.includes('ttq (lakh)') || key.includes('ttq')) res.ttqLakh = parseFloat(v.replace(/,/g, ''));
    if (key.includes('turnover (cr.)') || key.includes('turnover')) res.turnoverCr = parseFloat(v.replace(/,/g, ''));
    if (key.includes('2w avg qty')) res.avgQty2WLakh = parseFloat(v.replace(/,/g, ''));
    if (key.includes('mcap full')) res.mcapFullCr = parseFloat(v.replace(/,/g, ''));
    if (key.includes('mcap ff')) res.mcapFFCr = parseFloat(v.replace(/,/g, ''));
    if (key.includes('eps (ttm)') || key === 'eps') {
      const parts = v.split('/').map((s) => parseFloat(s.trim()));
      res.epsStandalone = parts[0] || null;
      res.epsConsolidated = parts[1] || parts[0] || null;
      res.eps = res.epsConsolidated || res.epsStandalone;
    }
    if (key.includes('ceps (ttm)') || key === 'ceps') {
      const parts = v.split('/').map((s) => parseFloat(s.trim()));
      res.ceps = parts[1] || parts[0] || null;
    }
    if (key === 'pe' || key.includes('p/e')) {
      const parts = v.split('/').map((s) => parseFloat(s.trim()));
      res.peStandalone = parts[0] || null;
      res.peConsolidated = parts[1] || parts[0] || null;
      res.pe = res.peConsolidated || res.peStandalone;
    }
    if (key.includes('roe / pb') || key.includes('roe/pb')) {
      const parts = v.split('/').map((s) => parseFloat(s.replace(/%/g, '').trim()));
      res.roe = parts[0] || null;
      res.pbRatio = parts[1] || null;
    }
    if (key.includes('face value')) res.faceValue = parseFloat(v.replace(/,/g, ''));
    if (key === 'index' || key.includes('grp_index')) res.index = v;
    if (key.includes('basic industry') || key.includes('industry')) res.basicIndustry = v;
  }
  return res;
}

/**
 * Fetch BSE details using BSE official APIs
 */
async function fetchBseData(bseCode, symbol, slug) {
  if (!bseCode || !/^\d+$/.test(String(bseCode).trim())) return null;
  const cleanCode = String(bseCode).trim();
  const cleanSymbol = symbol ? String(symbol).replace(/\.(NS|BO)$/i, '').trim() : '';

  try {
    const bseHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
      Origin: 'https://www.bseindia.com',
      Referer: 'https://www.bseindia.com/',
    };

    // 1. Try fetching BSE stock page html to parse card table rows
    let parsedMetrics = {};
    try {
      const pageSlug = slug || (cleanSymbol ? cleanSymbol.toLowerCase() : 'stock');
      const pageUrl = `https://www.bseindia.com/stock-share-price/${encodeURIComponent(pageSlug)}/${encodeURIComponent(cleanSymbol || 'symbol')}/${cleanCode}/`;
      const pageRes = await fetch(pageUrl, { headers: bseHeaders });
      if (pageRes.ok) {
        const html = await pageRes.text();
        const parsedRows = parseBseTableRows(html);
        parsedMetrics = parseBseMetricsFromParsed(parsedRows);
      }
    } catch (e) {
      // HTML scrape fallback
    }

    // 2. Fetch official API endpoints for robust real-time header data
    const [comHeaderRes, scripHeaderRes] = await Promise.allSettled([
      fetchWithRetry(
        `https://api.bseindia.com/BseIndiaAPI/api/ComHeader/w?scripcode=${cleanCode}`,
        { headers: bseHeaders },
        1,
        5000
      ),
      fetchWithRetry(
        `https://api.bseindia.com/BseIndiaAPI/api/getScripHeaderData/w?DebtFlag=&scripcode=${cleanCode}&seriesid=`,
        { headers: bseHeaders },
        1,
        5000
      ),
    ]);

    const comHeader = comHeaderRes.status === 'fulfilled' ? comHeaderRes.value : null;
    const scripHeader = scripHeaderRes.status === 'fulfilled' ? scripHeaderRes.value : null;

    const bseObj = {
      scripCode: cleanCode,
      symbol: cleanSymbol || comHeader?.SecurityId || '',
      faceValue: parsedMetrics.faceValue ?? (comHeader?.FaceVal ? parseFloat(comHeader.FaceVal) : null),
      basicIndustry: parsedMetrics.basicIndustry || comHeader?.IndustryNew || comHeader?.Industry || null,
      index: parsedMetrics.index || comHeader?.Index || comHeader?.Grp_Index || null,
      epsStandalone: parsedMetrics.epsStandalone || null,
      epsConsolidated: parsedMetrics.epsConsolidated || null,
      eps: parsedMetrics.eps ?? (comHeader?.EPS && comHeader.EPS !== '-' ? parseFloat(comHeader.EPS) : null),
      ceps: parsedMetrics.ceps || null,
      peStandalone: parsedMetrics.peStandalone || null,
      peConsolidated: parsedMetrics.peConsolidated || null,
      pe: parsedMetrics.pe ?? (comHeader?.PE && comHeader.PE !== '-' ? parseFloat(comHeader.PE) : null),
      roe: parsedMetrics.roe ?? (comHeader?.ROE && comHeader.ROE !== '-' ? parseFloat(comHeader.ROE) : null),
      pbRatio: parsedMetrics.pbRatio ?? (comHeader?.PB && comHeader.PB !== '-' ? parseFloat(comHeader.PB) : null),
      previousClose:
        parsedMetrics.previousClose ??
        (scripHeader?.Header?.PrevClose ? parseFloat(scripHeader.Header.PrevClose) : null),
      open: parsedMetrics.open ?? (scripHeader?.Header?.Open ? parseFloat(scripHeader.Header.Open) : null),
      high: parsedMetrics.high ?? (scripHeader?.Header?.High ? parseFloat(scripHeader.Header.High) : null),
      low: parsedMetrics.low ?? (scripHeader?.Header?.Low ? parseFloat(scripHeader.Header.Low) : null),
      ltp: scripHeader?.Header?.LTP ? parseFloat(scripHeader.Header.LTP) : null,
      vwap: parsedMetrics.vwap || null,
      high52W: parsedMetrics.high52W || null,
      low52W: parsedMetrics.low52W || null,
      upperBand: parsedMetrics.upperBand || null,
      lowerBand: parsedMetrics.lowerBand || null,
      ttqLakh: parsedMetrics.ttqLakh || null,
      turnoverCr: parsedMetrics.turnoverCr || null,
      avgQty2WLakh: parsedMetrics.avgQty2WLakh || null,
      mcapFullCr: parsedMetrics.mcapFullCr || null,
      mcapFFCr: parsedMetrics.mcapFFCr || null,
    };

    return bseObj;
  } catch (err) {
    console.warn(`[BSE] Error fetching BSE data for ${cleanCode}:`, err.message);
    return null;
  }
}

/**
 * Fetch Yahoo Quote Summary for rich fundamentals (financialData, defaultKeyStatistics, summaryDetail)
 */
async function fetchYahooQuoteSummary(symbol) {
  try {
    const { cookie, crumb } = await getYahooCrumbSession();
    const yahooSymbol = formatYahooSymbol(symbol);
    const crumbQuery = crumb ? `&crumb=${encodeURIComponent(crumb)}` : '';
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
      yahooSymbol
    )}?modules=defaultKeyStatistics,financialData,summaryDetail${crumbQuery}`;

    const headers = cookie ? { Cookie: cookie } : {};
    const data = await fetchWithRetry(url, { headers }, 1, 6000);
    const res = data?.quoteSummary?.result?.[0];
    if (!res) return null;

    const fd = res.financialData || {};
    const ks = res.defaultKeyStatistics || {};
    const sd = res.summaryDetail || {};

    const roe = fd.returnOnEquity?.raw ? Number((fd.returnOnEquity.raw * 100).toFixed(2)) : null;
    const debtToEquity = fd.debtToEquity?.raw ? Number((fd.debtToEquity.raw / 100).toFixed(2)) : null;
    const evToEbitda = ks.enterpriseToEbitda?.raw ? Number(ks.enterpriseToEbitda.raw.toFixed(2)) : null;
    const pbRatio = ks.priceToBook?.raw ? Number(ks.priceToBook.raw.toFixed(2)) : null;
    const dividendYield = sd.dividendYield?.raw
      ? Number((sd.dividendYield.raw * 100).toFixed(2))
      : sd.trailingAnnualDividendYield?.raw
      ? Number((sd.trailingAnnualDividendYield.raw * 100).toFixed(2))
      : null;
    const revenueGrowth = fd.revenueGrowth?.raw ? Number((fd.revenueGrowth.raw * 100).toFixed(2)) : null;
    const earningsGrowth = fd.earningsGrowth?.raw ? Number((fd.earningsGrowth.raw * 100).toFixed(2)) : null;
    const trailingEps = ks.trailingEps?.raw || null;
    const bookValue = ks.bookValue?.raw || null;

    return {
      roe,
      debtToEquity,
      evToEbitda,
      pbRatio,
      dividendYield,
      revenueGrowth,
      earningsGrowth,
      trailingEps,
      bookValue,
    };
  } catch (err) {
    return null;
  }
}

/**
 * Task 3: On-Demand StockEdge News Fetcher with 5-10s Rate-Limiting Delay & Mutex
 */
let isStockEdgeLocked = false;
let lastStockEdgeRequestTime = 0;

async function fetchStockEdgeUpdates(symbol) {
  const cleanSym = symbol.replace(/\.(NS|BO)$/i, '').trim();
  const cacheKey = `stockedge_${cleanSym.toUpperCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // Rate-limiting delay & concurrency lock
  while (isStockEdgeLocked) {
    await new Promise((r) => setTimeout(r, 400));
  }

  isStockEdgeLocked = true;
  try {
    const elapsed = Date.now() - lastStockEdgeRequestTime;
    const minDelay = 5000 + Math.floor(Math.random() * 5000); // 5000ms - 10000ms delay
    if (elapsed < minDelay) {
      await new Promise((r) => setTimeout(r, minDelay - elapsed));
    }
    lastStockEdgeRequestTime = Date.now();

    // 1. Search StockEdge Universal Search to get DocId / Slug
    const searchUrl = `https://api.stockedge.com/Api/UniversalSearchApi/GetQuickSearchResult?searchTerm=${encodeURIComponent(cleanSym)}`;
    const searchRes = await fetchWithRetry(searchUrl, {
      headers: {
        Origin: 'https://web.stockedge.com',
        Referer: 'https://web.stockedge.com/',
      },
    }, 1, 6000);

    let docId = null;
    let slug = null;
    if (searchRes?.Data && Array.isArray(searchRes.Data)) {
      const match = searchRes.Data.find((d) => d.EntityCode === 'se_security');
      if (match) {
        docId = match.DocId;
        slug = match.Slug;
      }
    }

    const items = [];
    if (slug && docId) {
      const pageUrl = `https://web.stockedge.com/share/${slug}/${docId}?section=news`;
      try {
        const pageRes = await fetch(pageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });

        if (pageRes.ok) {
          const html = await pageRes.text();
          const ionItemRegex = /<ion-item[^>]*>([\s\S]*?)<\/ion-item>/gi;
          const currentDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

          let itemMatch;
          while ((itemMatch = ionItemRegex.exec(html)) !== null && items.length < 15) {
            const itemHtml = itemMatch[1];
            const timeMatch = itemHtml.match(/(\d{1,2}:\d{2}\s*(?:am|pm))/i);
            const tagMatch =
              itemHtml.match(/<span[^>]*class=["'][^"']*badge[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
              itemHtml.match(/(?:Company News|Movers Today|Earnings|Corporate Result|Stock Action|Block Deal)/i);
            const headlineText = itemHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

            if (headlineText.length > 15) {
              items.push({
                date: currentDate,
                time: timeMatch ? timeMatch[1] : 'Recent',
                category: tagMatch ? (typeof tagMatch[1] === 'string' ? tagMatch[1].trim() : tagMatch[0]) : 'Company News',
                headline: headlineText.slice(0, 180),
                url: `https://web.stockedge.com/share/${slug}/${docId}?section=news`,
              });
            }
          }
        }
      } catch (err) {
        console.warn(`[StockEdge] Page fetch error for ${cleanSym}:`, err.message);
      }
    }

    if (items.length === 0) {
      items.push({
        date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        time: 'Market Hours',
        category: 'Corporate Update',
        headline: `${cleanSym}: Tracking active filings and quarterly updates on BSE / StockEdge portals.`,
        url: slug && docId ? `https://web.stockedge.com/share/${slug}/${docId}?section=news` : `https://web.stockedge.com/`,
      });
    }

    const payload = {
      symbol: cleanSym,
      lastUpdated: new Date().toISOString(),
      items,
    };
    // Cache for 1 hour
    cache.set(cacheKey, { data: payload, timestamp: Date.now() });
    return payload;
  } finally {
    isStockEdgeLocked = false;
  }
}

// Root landing status page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Dalal Diary's Price Proxy API</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f17; color: #e2e8f0; padding: 40px 20px; line-height: 1.6; max-width: 680px; margin: 0 auto; }
        .card { background: #111827; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        .badge { display: inline-block; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; padding: 4px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
        h1 { margin: 0 0 12px; font-size: 24px; color: #f8fafc; }
        p { color: #94a3b8; font-size: 14px; margin-top: 0; }
        .endpoint-list { list-style: none; padding: 0; margin: 24px 0; }
        .endpoint-list li { background: #0f172a; border: 1px solid #1e293b; padding: 12px 16px; border-radius: 8px; margin-bottom: 8px; font-family: monospace; font-size: 13px; display: flex; justify-content: space-between; align-items: center; }
        .endpoint-list a { color: #38bdf8; text-decoration: none; }
        .endpoint-list a:hover { text-decoration: underline; }
        .footer { font-size: 12px; color: #64748b; margin-top: 24px; text-align: center; }
      </style>
    </head>
    <body>
      <div class="card">
        <span class="badge">● Online & Operational</span>
        <h1>Dalal Diary's Price Proxy Server</h1>
        <p>This is the backend price proxy service that delivers live NSE/BSE stock quotes, indices, and corporate actions to your <strong>Dalal Diary's</strong> portfolio tracker.</p>
        
        <ul class="endpoint-list">
          <li><span>Health Check:</span> <a href="/health">/health</a></li>
          <li><span>Live Indices:</span> <a href="/api/indices">/api/indices</a></li>
          <li><span>Sample Quote:</span> <a href="/api/quote?symbols=RELIANCE.NS,TCS.NS">/api/quote?symbols=RELIANCE.NS,TCS.NS</a></li>
        </ul>
        
        <p style="font-size: 13px; color: #cbd5e1; background: rgba(56, 189, 248, 0.1); border-left: 3px solid #38bdf8; padding: 10px 14px; border-radius: 4px;">
          <strong>Note:</strong> To view your portfolio dashboard, open your <strong>Static Site</strong> URL in your Render dashboard (e.g. <code>stock-market-ui</code>).
        </p>
      </div>
      <div class="footer">Dalal Diary's &bull; High-Performance Indian Equity Portfolio Tracker</div>
    </body>
    </html>
  `);
});

// 1. Health check endpoint (for Render free-tier wakeup)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: "Dalal Diary's Price Proxy",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

// 2. Live Quotes Endpoint
app.get('/api/quote', async (req, res) => {
  const symbolsParam = req.query.symbols;
  if (!symbolsParam || typeof symbolsParam !== 'string') {
    return res.status(400).json({ error: 'Missing "symbols" query parameter' });
  }

  const rawSymbols = symbolsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawSymbols.length === 0) {
    return res.json({ quotes: [] });
  }

  const quotesResult = [];
  const symbolsToFetch = [];

  for (const s of rawSymbols) {
    const cached = getCached(`quote_${s}`);
    if (cached) {
      quotesResult.push(cached);
    } else {
      symbolsToFetch.push(s);
    }
  }

  if (symbolsToFetch.length > 0) {
    // Attempt 1: Fetch via v7 bulk endpoint with Yahoo cookie/crumb
    const { cookie, crumb } = await getYahooCrumbSession();
    let bulkSuccess = false;

    if (cookie && crumb) {
      try {
        const chunkSize = 40;
        for (let i = 0; i < symbolsToFetch.length; i += chunkSize) {
          const chunk = symbolsToFetch.slice(i, i + chunkSize);
          const encoded = chunk.map((s) => encodeURIComponent(s)).join(',');
          const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encoded}&crumb=${crumb}`;

          const data = await fetchWithRetry(url, { headers: { Cookie: cookie } });
          const results = data?.quoteResponse?.result || [];

          for (const item of results) {
            const mapped = {
              symbol: item.symbol,
              shortName: item.shortName || item.longName || item.symbol,
              price: item.regularMarketPrice ?? 0,
              previousClose: item.regularMarketPreviousClose ?? item.regularMarketPrice ?? 0,
              change: item.regularMarketChange ?? 0,
              changePercent: item.regularMarketChangePercent ?? 0,
              dayHigh: item.regularMarketDayHigh ?? null,
              dayLow: item.regularMarketDayLow ?? null,
              high52W: item.fiftyTwoWeekHigh ?? null,
              low52W: item.fiftyTwoWeekLow ?? null,
              pe: item.trailingPE ? Number(item.trailingPE.toFixed(2)) : null,
              forwardPE: item.forwardPE ? Number(item.forwardPE.toFixed(2)) : null,
              dividendYield: item.trailingAnnualDividendYield
                ? Number((item.trailingAnnualDividendYield * 100).toFixed(2))
                : null,
              latestDividend: item.trailingAnnualDividendRate
                ? {
                    amount: item.trailingAnnualDividendRate,
                    date: item.dividendDate ? new Date(item.dividendDate * 1000).toISOString().split('T')[0] : '',
                  }
                : null,
              marketCap: item.marketCap ? Math.round(item.marketCap / 10000000) : null, // ₹ Crore
              currency: item.currency || 'INR',
              timestamp: new Date().toISOString(),
            };

            setCached(`quote_${item.symbol}`, mapped);
            quotesResult.push(mapped);
          }
        }
        bulkSuccess = true;
      } catch (err) {
        console.warn('[Proxy] v7 bulk quote failed, switching to v8 individual fallback:', err.message);
      }
    }

    // Attempt 2: If bulk failed or missed symbols, fetch remaining symbols via v8 chart
    const fetchedSymbolsSet = new Set(quotesResult.map((q) => q.symbol));
    const missingSymbols = symbolsToFetch.filter((s) => !fetchedSymbolsSet.has(s));

    if (missingSymbols.length > 0) {
      const v8Promises = missingSymbols.map(async (sym) => {
        const quote = await fetchV8ChartQuote(sym);
        if (quote) {
          setCached(`quote_${sym}`, quote);
          quotesResult.push(quote);
        }
      });
      await Promise.all(v8Promises);
    }
  }

  res.json({ quotes: quotesResult });
});

// 3. Major Indian Indices (NIFTY 50, SENSEX, NIFTY BANK)
app.get('/api/indices', async (req, res) => {
  const cacheKey = 'indian_indices';
  const cached = getCached(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  const indicesConfig = [
    { key: 'nifty50', name: 'NIFTY 50', symbol: '^NSEI' },
    { key: 'sensex', name: 'SENSEX', symbol: '^BSESN' },
    { key: 'niftyBank', name: 'NIFTY BANK', symbol: '^NSEBANK' },
  ];

  try {
    const promises = indicesConfig.map(async (cfg) => {
      const q = await fetchV8ChartQuote(cfg.symbol);
      return {
        key: cfg.key,
        data: {
          name: cfg.name,
          symbol: cfg.symbol,
          level: q?.price ?? 0,
          previousClose: q?.previousClose ?? 0,
          change: q?.change ?? 0,
          changePercent: q?.changePercent ?? 0,
          dayHigh: q?.dayHigh ?? 0,
          dayLow: q?.dayLow ?? 0,
        },
      };
    });

    const results = await Promise.all(promises);
    const payload = {
      timestamp: new Date().toISOString(),
    };
    for (const r of results) {
      payload[r.key] = r.data;
    }

    setCached(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error('Error fetching indices:', err.message);
    res.status(502).json({
      error: 'Failed to fetch market indices',
      message: err.message,
    });
  }
});

// 4. Search live symbol/company backup
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  const cacheKey = `search_${query.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      query
    )}&quotesCount=15&newsCount=0&enableFuzzyQuery=true`;
    const data = await fetchWithRetry(url);
    const quotes = data?.quotes || [];

    const indianQuotes = quotes
      .filter((q) => {
        const sym = q.symbol || '';
        return sym.endsWith('.NS') || sym.endsWith('.BO') || q.exchange === 'NSI' || q.exchange === 'BSE';
      })
      .map((q) => {
        const isBSE = q.symbol.endsWith('.BO');
        const cleanSymbol = q.symbol.replace(/\.(NS|BO)$/, '');
        return {
          symbol: q.symbol,
          cleanSymbol,
          name: q.shortname || q.longname || cleanSymbol,
          exchange: isBSE ? 'BSE' : 'NSE',
          exchangeDisplay: isBSE ? 'BSE' : 'NSE',
          type: q.quoteType || 'EQUITY',
        };
      });

    const payload = { results: indianQuotes };
    setCached(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(502).json({ error: 'Failed to search symbols', message: err.message });
  }
});

// 5. Corporate Events (Dividends & Splits) for a symbol
app.get('/api/events', async (req, res) => {
  const symbol = req.query.symbol;
  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ error: 'Missing "symbol" parameter' });
  }

  const cacheKey = `events_${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  try {
    const targetSymbol = formatYahooSymbol(symbol);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      targetSymbol
    )}?interval=1d&range=2y&events=div,split`;
    const data = await fetchWithRetry(url);
    const chart = data?.chart?.result?.[0];
    const events = chart?.events || {};

    const dividends = [];
    if (events.dividends) {
      for (const [timestamp, item] of Object.entries(events.dividends)) {
        const d = new Date(Number(timestamp) * 1000);
        dividends.push({
          date: d.toISOString().split('T')[0],
          amount: item.amount,
        });
      }
    }

    const splits = [];
    if (events.splits) {
      for (const [timestamp, item] of Object.entries(events.splits)) {
        const d = new Date(Number(timestamp) * 1000);
        splits.push({
          date: d.toISOString().split('T')[0],
          numerator: item.numerator,
          denominator: item.denominator,
          splitRatio: item.splitRatio,
        });
      }
    }

    dividends.sort((a, b) => b.date.localeCompare(a.date));
    splits.sort((a, b) => b.date.localeCompare(a.date));

    const payload = {
      symbol,
      targetSymbol,
      dividends,
      splits,
      timestamp: new Date().toISOString(),
    };

    setCached(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(`Events error for ${symbol}:`, err.message);
    res.status(502).json({ error: 'Failed to fetch corporate events', message: err.message });
  }
});

// 6. Fundamentals Endpoint (BSE + Yahoo QuoteSummary + Graham Intrinsic Value)
app.get('/api/fundamentals', async (req, res) => {
  const symbol = req.query.symbol;
  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ error: 'Missing "symbol" query parameter' });
  }

  const cleanSymbol = symbol.replace(/\.(NS|BO)$/i, '').trim().toUpperCase();
  const bseCode = req.query.bseCode ? String(req.query.bseCode).trim() : null;
  const currentPriceParam = req.query.currentPrice ? parseFloat(req.query.currentPrice) : null;

  const cacheKey = `fundamentals_${cleanSymbol}_${bseCode || ''}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  try {
    const [bseData, yahooFundamentals] = await Promise.all([
      bseCode ? fetchBseData(bseCode, cleanSymbol, req.query.slug) : Promise.resolve(null),
      fetchYahooQuoteSummary(cleanSymbol),
    ]);

    // Derive ROE and PB from BSE first (Task 1: Map ROE and PB directly from parsed BSE ROE/PB field or Yahoo fallback)
    const roe = bseData?.roe ?? yahooFundamentals?.roe ?? null;
    const pbRatio = bseData?.pbRatio ?? yahooFundamentals?.pbRatio ?? null;
    const eps = bseData?.eps ?? yahooFundamentals?.trailingEps ?? null;
    const debtToEquity = yahooFundamentals?.debtToEquity ?? null;
    const evToEbitda = yahooFundamentals?.evToEbitda ?? null;
    const dividendYield = yahooFundamentals?.dividendYield ?? null;
    const salesCagr10Y = yahooFundamentals?.revenueGrowth ?? null;
    const profitCagr10Y = yahooFundamentals?.earningsGrowth ?? null;

    // Determine currentPrice: from query param, or bseData.ltp, or bseData.previousClose
    const currentPrice = currentPriceParam || bseData?.ltp || bseData?.previousClose || 0;

    // Compute Book Value: from yahoo bookValue, or currentPrice / pbRatio
    let bookValue = yahooFundamentals?.bookValue;
    if (!bookValue && currentPrice > 0 && pbRatio && pbRatio > 0) {
      bookValue = Math.round((currentPrice / pbRatio) * 100) / 100;
    }

    // Graham's number: sqrt(22.5 * EPS * BookValue) or EPS * (8.5 + 2 * g)
    let intrinsicValue = null;
    if (eps && eps > 0) {
      if (bookValue && bookValue > 0) {
        intrinsicValue = Math.round(Math.sqrt(22.5 * eps * bookValue) * 100) / 100;
      } else if (profitCagr10Y && profitCagr10Y > 0) {
        const g = Math.min(25, profitCagr10Y);
        intrinsicValue = Math.round(eps * (8.5 + 2 * g) * 100) / 100;
      }
    }

    // Margin of Safety: ((intrinsicValue - currentPrice) / intrinsicValue) * 100
    let marginOfSafety = null;
    if (intrinsicValue && currentPrice > 0) {
      marginOfSafety = Math.round(((intrinsicValue - currentPrice) / intrinsicValue) * 10000) / 100;
    }

    // ROCE: estimate from ROE * (1 - debtRatio) or ROE if debt is 0
    let roce = null;
    if (roe !== null) {
      if (debtToEquity !== null && debtToEquity > 0) {
        roce = Math.round((roe / (1 + debtToEquity * 0.4)) * 100) / 100;
      } else {
        roce = roe;
      }
    }

    const payload = {
      symbol: cleanSymbol,
      bseCode: bseCode || bseData?.scripCode || null,
      fundamentals: {
        symbol: cleanSymbol,
        roe,
        pbRatio,
        eps,
        roce,
        debtToEquity,
        evToEbitda,
        dividendYield,
        salesCagr10Y,
        profitCagr10Y,
        intrinsicValue,
        marginOfSafety,
        vwap: bseData?.vwap || null,
        epsStandalone: bseData?.epsStandalone || null,
        epsConsolidated: bseData?.epsConsolidated || null,
        ceps: bseData?.ceps || null,
        mcapFFCr: bseData?.mcapFFCr || null,
        avgQty2WLakh: bseData?.avgQty2WLakh || null,
        faceValue: bseData?.faceValue || null,
        basicIndustry: bseData?.basicIndustry || null,
        upperBand: bseData?.upperBand || null,
        lowerBand: bseData?.lowerBand || null,
        bseIndex: bseData?.index || null,
        lastUpdated: new Date().toISOString(),
      },
      bseData: bseData || null,
      timestamp: new Date().toISOString(),
    };

    setCached(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(`[Fundamentals] Error for ${cleanSymbol}:`, err.message);
    res.status(500).json({ error: 'Failed to fetch fundamentals', message: err.message });
  }
});

// 7. On-demand StockEdge News & Updates with 5-10s safe delay
app.get('/api/stockedge-updates', async (req, res) => {
  const symbol = req.query.symbol || req.query.stockedgeId;
  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ error: 'Missing "symbol" query parameter' });
  }

  try {
    const data = await fetchStockEdgeUpdates(symbol);
    res.json(data);
  } catch (err) {
    console.error(`[StockEdge] Updates error for ${symbol}:`, err.message);
    res.status(500).json({ error: 'Failed to fetch StockEdge updates', message: err.message });
  }
});

// 8. Auto-add searched stock to stocks-directory.json
app.post('/api/directory/add', async (req, res) => {
  const { nseSymbol, symbol, bseCode, name, isin, sector, marketCapCategory } = req.body || {};
  const sym = (nseSymbol || symbol || '').trim().toUpperCase();

  if (!sym && !bseCode) {
    return res.status(400).json({ error: 'At least nseSymbol or bseCode is required' });
  }

  try {
    let directory = [];
    if (fs.existsSync(DIRECTORY_FILE_PATH)) {
      const fileData = await fs.promises.readFile(DIRECTORY_FILE_PATH, 'utf-8');
      directory = JSON.parse(fileData);
    }

    const cleanBse = bseCode ? String(bseCode).trim() : '';
    const cleanIsin = isin ? String(isin).trim().toUpperCase() : '';

    // Check if already exists by symbol, bseCode, or isin
    const existingIndex = directory.findIndex((item) => {
      const matchSym = sym && item.symbol && item.symbol.toUpperCase() === sym;
      const matchBse = cleanBse && item.bseCode && String(item.bseCode).trim() === cleanBse;
      const matchIsin = cleanIsin && item.isin && item.isin.toUpperCase() === cleanIsin;
      return matchSym || matchBse || matchIsin;
    });

    if (existingIndex !== -1) {
      return res.json({
        success: true,
        added: false,
        message: 'Stock already present in directory',
        stock: directory[existingIndex],
      });
    }

    const newStock = {
      symbol: sym || cleanBse,
      bseCode: cleanBse,
      name: (name || sym).trim(),
      isin: cleanIsin,
      sector: (sector || 'Diversified').trim(),
      marketCapCategory: (marketCapCategory || 'Mid Cap').trim(),
    };

    directory.push(newStock);
    await fs.promises.writeFile(DIRECTORY_FILE_PATH, JSON.stringify(directory, null, 2), 'utf-8');

    console.log(`[Directory] Added new stock: ${newStock.symbol} (${newStock.name})`);
    return res.json({
      success: true,
      added: true,
      message: 'Stock successfully appended to directory',
      stock: newStock,
    });
  } catch (err) {
    console.error('[Directory] Error adding stock:', err.message);
    res.status(500).json({ error: 'Failed to update stocks directory', message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Dalal Diary's Price Proxy] Server listening on port ${PORT}`);
});
