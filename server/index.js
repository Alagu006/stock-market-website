import express from 'express';
import cors from 'cors';

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
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const data = await fetchWithRetry(url);
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta || meta.regularMarketPrice === undefined) return null;

    const previousClose = meta.chartPreviousClose ?? meta.regularMarketPrice ?? 0;
    const price = meta.regularMarketPrice ?? 0;
    const change = price - previousClose;
    const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

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
      dividendYield: null,
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

app.listen(PORT, () => {
  console.log(`[Dalal Diary's Price Proxy] Server listening on port ${PORT}`);
});
