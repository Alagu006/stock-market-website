import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Configure PDF.js worker safely for Vite/browser and Node test environments
if (typeof window !== 'undefined') {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.mjs',
      import.meta.url
    ).toString();
  } catch {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version || '6.4.299'}/build/pdf.worker.min.mjs`;
  }
}

export interface ExtractedPdfResult {
  text: string;
  pagesCount: number;
  lines: string[];
}

export interface HoldingStatementRow {
  rawName: string;
  symbol: string;
  bseCode: string;
  name: string;
  sector: string;
  marketCapCategory: 'Large Cap' | 'Mid Cap' | 'Small Cap';
  holdingQuantity: number;
  holdingRate: number; // Purchase price / average cost
  buyValue: number;
  marketPrice: number; // Current market price (LTP)
  currentValue: number;
  realizedPnL: number;
  unrealizedPnL: number;
  type: 'BUY';
  date: string;
}

export interface ParsedStatementResult {
  rows: Record<string, any>[];
  detectedColumns: string[];
  detectedType: 'transactions' | 'stocks' | 'holdings' | 'unknown';
  holdingsSummary?: {
    totalHoldings: number;
    totalInvested: number;
    totalCurrentValue: number;
    totalUnrealizedPnL: number;
  };
}

/**
 * Comprehensive Indian stock dictionary with aliases and scrip codes
 */
const INDIAN_EQUITY_DICTIONARY: Record<
  string,
  {
    symbol: string;
    bseCode: string;
    name: string;
    sector: string;
    marketCapCategory: 'Large Cap' | 'Mid Cap' | 'Small Cap';
  }
> = {
  // User holdings
  AMRUTANJAN: { symbol: 'AMRUTANJAN', bseCode: '590006', name: 'Amrutanjan Health Care Ltd', sector: 'Healthcare', marketCapCategory: 'Small Cap' },
  'AMRUTANJAN HEALT': { symbol: 'AMRUTANJAN', bseCode: '590006', name: 'Amrutanjan Health Care Ltd', sector: 'Healthcare', marketCapCategory: 'Small Cap' },
  'ASIAN PAINTS': { symbol: 'ASIANPAINT', bseCode: '500820', name: 'Asian Paints Ltd', sector: 'Consumer Goods', marketCapCategory: 'Large Cap' },
  ASIANPAINT: { symbol: 'ASIANPAINT', bseCode: '500820', name: 'Asian Paints Ltd', sector: 'Consumer Goods', marketCapCategory: 'Large Cap' },
  'B P C L': { symbol: 'BPCL', bseCode: '500547', name: 'Bharat Petroleum Corporation Ltd', sector: 'Energy', marketCapCategory: 'Large Cap' },
  BPCL: { symbol: 'BPCL', bseCode: '500547', name: 'Bharat Petroleum Corporation Ltd', sector: 'Energy', marketCapCategory: 'Large Cap' },
  'BAJAJ HOUSING': { symbol: 'BAJAJHFL', bseCode: '544252', name: 'Bajaj Housing Finance Ltd', sector: 'Financial Services', marketCapCategory: 'Large Cap' },
  BAJAJHFL: { symbol: 'BAJAJHFL', bseCode: '544252', name: 'Bajaj Housing Finance Ltd', sector: 'Financial Services', marketCapCategory: 'Large Cap' },
  'BATA INDIA': { symbol: 'BATAINDIA', bseCode: '500043', name: 'Bata India Ltd', sector: 'Consumer Goods', marketCapCategory: 'Mid Cap' },
  BATAINDIA: { symbol: 'BATAINDIA', bseCode: '500043', name: 'Bata India Ltd', sector: 'Consumer Goods', marketCapCategory: 'Mid Cap' },
  'BRITANNIA INDS': { symbol: 'BRITANNIA', bseCode: '500825', name: 'Britannia Industries Ltd', sector: 'FMCG', marketCapCategory: 'Large Cap' },
  BRITANNIA: { symbol: 'BRITANNIA', bseCode: '500825', name: 'Britannia Industries Ltd', sector: 'FMCG', marketCapCategory: 'Large Cap' },
  'CITY UNION BANK': { symbol: 'CUB', bseCode: '532187', name: 'City Union Bank Ltd', sector: 'Banking', marketCapCategory: 'Mid Cap' },
  CUB: { symbol: 'CUB', bseCode: '532187', name: 'City Union Bank Ltd', sector: 'Banking', marketCapCategory: 'Mid Cap' },
  'CLEAN SCIENCE': { symbol: 'CLEAN', bseCode: '543318', name: 'Clean Science and Technology Ltd', sector: 'Chemicals', marketCapCategory: 'Mid Cap' },
  CLEAN: { symbol: 'CLEAN', bseCode: '543318', name: 'Clean Science and Technology Ltd', sector: 'Chemicals', marketCapCategory: 'Mid Cap' },
  'COAL INDIA': { symbol: 'COALINDIA', bseCode: '533278', name: 'Coal India Ltd', sector: 'Energy', marketCapCategory: 'Large Cap' },
  COALINDIA: { symbol: 'COALINDIA', bseCode: '533278', name: 'Coal India Ltd', sector: 'Energy', marketCapCategory: 'Large Cap' },
  'COLGATE PALMOLIV': { symbol: 'COLPAL', bseCode: '500830', name: 'Colgate-Palmolive (India) Ltd', sector: 'FMCG', marketCapCategory: 'Large Cap' },
  'COLGATE- PALMOLIV': { symbol: 'COLPAL', bseCode: '500830', name: 'Colgate-Palmolive (India) Ltd', sector: 'FMCG', marketCapCategory: 'Large Cap' },
  COLPAL: { symbol: 'COLPAL', bseCode: '500830', name: 'Colgate-Palmolive (India) Ltd', sector: 'FMCG', marketCapCategory: 'Large Cap' },
  'GUJ PIPAVAV PORT': { symbol: 'GPPL', bseCode: '533248', name: 'Gujarat Pipavav Port Ltd', sector: 'Infrastructure', marketCapCategory: 'Mid Cap' },
  GPPL: { symbol: 'GPPL', bseCode: '533248', name: 'Gujarat Pipavav Port Ltd', sector: 'Infrastructure', marketCapCategory: 'Mid Cap' },
  'HBL ENGINEERING': { symbol: 'HBLPOWER', bseCode: '517271', name: 'HBL Power Systems Ltd', sector: 'Capital Goods', marketCapCategory: 'Mid Cap' },
  HBLPOWER: { symbol: 'HBLPOWER', bseCode: '517271', name: 'HBL Power Systems Ltd', sector: 'Capital Goods', marketCapCategory: 'Mid Cap' },
  'HIND UNILEVER': { symbol: 'HINDUNILVR', bseCode: '500696', name: 'Hindustan Unilever Ltd', sector: 'FMCG', marketCapCategory: 'Large Cap' },
  HINDUNILVR: { symbol: 'HINDUNILVR', bseCode: '500696', name: 'Hindustan Unilever Ltd', sector: 'FMCG', marketCapCategory: 'Large Cap' },
  'I R C T C': { symbol: 'IRCTC', bseCode: '542830', name: 'Indian Railway Catering and Tourism Corp Ltd', sector: 'Services', marketCapCategory: 'Large Cap' },
  IRCTC: { symbol: 'IRCTC', bseCode: '542830', name: 'Indian Railway Catering and Tourism Corp Ltd', sector: 'Services', marketCapCategory: 'Large Cap' },
  'INDIAN ENERGY EX': { symbol: 'IEX', bseCode: '540750', name: 'Indian Energy Exchange Ltd', sector: 'Financial Services', marketCapCategory: 'Mid Cap' },
  IEX: { symbol: 'IEX', bseCode: '540750', name: 'Indian Energy Exchange Ltd', sector: 'Financial Services', marketCapCategory: 'Mid Cap' },
  ITC: { symbol: 'ITC', bseCode: '500875', name: 'ITC Ltd', sector: 'FMCG', marketCapCategory: 'Large Cap' },
  'ITC HOTELS': { symbol: 'ITCHOTELS', bseCode: '544331', name: 'ITC Hotels Ltd', sector: 'Hospitality', marketCapCategory: 'Mid Cap' },
  ITCHOTELS: { symbol: 'ITCHOTELS', bseCode: '544331', name: 'ITC Hotels Ltd', sector: 'Hospitality', marketCapCategory: 'Mid Cap' },
  'KANCHI KARPOORAM': { symbol: 'KANPRPLA', bseCode: '538598', name: 'Kanchi Karpooram Ltd', sector: 'Chemicals', marketCapCategory: 'Small Cap' },
  KANPRPLA: { symbol: 'KANPRPLA', bseCode: '538598', name: 'Kanchi Karpooram Ltd', sector: 'Chemicals', marketCapCategory: 'Small Cap' },
  "KWALITY WALL'S": { symbol: 'KWALITY', bseCode: '519415', name: 'Kwality Ltd', sector: 'FMCG', marketCapCategory: 'Small Cap' },
  KWALITY: { symbol: 'KWALITY', bseCode: '519415', name: 'Kwality Ltd', sector: 'FMCG', marketCapCategory: 'Small Cap' },
  'LG ELECTRONICS': { symbol: 'LGELECTRONICS', bseCode: '544000', name: 'LG Electronics India', sector: 'Consumer Durables', marketCapCategory: 'Large Cap' },
  'N S D L': { symbol: 'NSDL', bseCode: '544001', name: 'National Securities Depository Ltd', sector: 'Financial Services', marketCapCategory: 'Mid Cap' },
  NSDL: { symbol: 'NSDL', bseCode: '544001', name: 'National Securities Depository Ltd', sector: 'Financial Services', marketCapCategory: 'Mid Cap' },
  'NESTLE INDIA': { symbol: 'NESTLEIND', bseCode: '500790', name: 'Nestle India Ltd', sector: 'FMCG', marketCapCategory: 'Large Cap' },
  NESTLEIND: { symbol: 'NESTLEIND', bseCode: '500790', name: 'Nestle India Ltd', sector: 'FMCG', marketCapCategory: 'Large Cap' },
  'NTPC GREEN ENE': { symbol: 'NTPCGREEN', bseCode: '544288', name: 'NTPC Green Energy Ltd', sector: 'Energy', marketCapCategory: 'Large Cap' },
  NTPCGREEN: { symbol: 'NTPCGREEN', bseCode: '544288', name: 'NTPC Green Energy Ltd', sector: 'Energy', marketCapCategory: 'Large Cap' },
  'O N G C': { symbol: 'ONGC', bseCode: '500312', name: 'Oil & Natural Gas Corporation Ltd', sector: 'Energy', marketCapCategory: 'Large Cap' },
  ONGC: { symbol: 'ONGC', bseCode: '500312', name: 'Oil & Natural Gas Corporation Ltd', sector: 'Energy', marketCapCategory: 'Large Cap' },
  'OLA ELECTRIC': { symbol: 'OLAELEC', bseCode: '544226', name: 'Ola Electric Mobility Ltd', sector: 'Auto', marketCapCategory: 'Mid Cap' },
  OLAELEC: { symbol: 'OLAELEC', bseCode: '544226', name: 'Ola Electric Mobility Ltd', sector: 'Auto', marketCapCategory: 'Mid Cap' },
  'PATEL ENGINEERIN': { symbol: 'PATELENG', bseCode: '500318', name: 'Patel Engineering Ltd', sector: 'Infrastructure', marketCapCategory: 'Small Cap' },
  PATELENG: { symbol: 'PATELENG', bseCode: '500318', name: 'Patel Engineering Ltd', sector: 'Infrastructure', marketCapCategory: 'Small Cap' },
  'POWER GRID CORPN': { symbol: 'POWERGRID', bseCode: '532898', name: 'Power Grid Corporation of India Ltd', sector: 'Energy', marketCapCategory: 'Large Cap' },
  POWERGRID: { symbol: 'POWERGRID', bseCode: '532898', name: 'Power Grid Corporation of India Ltd', sector: 'Energy', marketCapCategory: 'Large Cap' },
  'RANE (MADRAS)': { symbol: 'RML', bseCode: '532661', name: 'Rane (Madras) Ltd', sector: 'Auto', marketCapCategory: 'Small Cap' },
  RML: { symbol: 'RML', bseCode: '532661', name: 'Rane (Madras) Ltd', sector: 'Auto', marketCapCategory: 'Small Cap' },
  'RELIANCE INDUSTRIES': { symbol: 'RELIANCE', bseCode: '500325', name: 'Reliance Industries Ltd', sector: 'Energy', marketCapCategory: 'Large Cap' },
  RELIANCE: { symbol: 'RELIANCE', bseCode: '500325', name: 'Reliance Industries Ltd', sector: 'Energy', marketCapCategory: 'Large Cap' },
  RITES: { symbol: 'RITES', bseCode: '541556', name: 'RITES Ltd', sector: 'Infrastructure', marketCapCategory: 'Mid Cap' },
  'TATA CONSUMER': { symbol: 'TATACONSUM', bseCode: '500770', name: 'Tata Consumer Products Ltd', sector: 'FMCG', marketCapCategory: 'Large Cap' },
  TATACONSUM: { symbol: 'TATACONSUM', bseCode: '500770', name: 'Tata Consumer Products Ltd', sector: 'FMCG', marketCapCategory: 'Large Cap' },
  'TATA TECHNOLOG': { symbol: 'TATATECH', bseCode: '544028', name: 'Tata Technologies Ltd', sector: 'IT', marketCapCategory: 'Large Cap' },
  TATATECH: { symbol: 'TATATECH', bseCode: '544028', name: 'Tata Technologies Ltd', sector: 'IT', marketCapCategory: 'Large Cap' },
  TCS: { symbol: 'TCS', bseCode: '532540', name: 'Tata Consultancy Services Ltd', sector: 'IT', marketCapCategory: 'Large Cap' },
  'VST INDUSTRIES': { symbol: 'VSTIND', bseCode: '509930', name: 'VST Industries Ltd', sector: 'FMCG', marketCapCategory: 'Small Cap' },
  VSTIND: { symbol: 'VSTIND', bseCode: '509930', name: 'VST Industries Ltd', sector: 'FMCG', marketCapCategory: 'Small Cap' },

  // Other major Indian stocks
  INFOSYS: { symbol: 'INFY', bseCode: '500209', name: 'Infosys Ltd', sector: 'IT', marketCapCategory: 'Large Cap' },
  INFY: { symbol: 'INFY', bseCode: '500209', name: 'Infosys Ltd', sector: 'IT', marketCapCategory: 'Large Cap' },
  HDFCBANK: { symbol: 'HDFCBANK', bseCode: '500180', name: 'HDFC Bank Ltd', sector: 'Banking', marketCapCategory: 'Large Cap' },
  'HDFC BANK': { symbol: 'HDFCBANK', bseCode: '500180', name: 'HDFC Bank Ltd', sector: 'Banking', marketCapCategory: 'Large Cap' },
  ICICIBANK: { symbol: 'ICICIBANK', bseCode: '532174', name: 'ICICI Bank Ltd', sector: 'Banking', marketCapCategory: 'Large Cap' },
  'ICICI BANK': { symbol: 'ICICIBANK', bseCode: '532174', name: 'ICICI Bank Ltd', sector: 'Banking', marketCapCategory: 'Large Cap' },
  SBIN: { symbol: 'SBIN', bseCode: '500112', name: 'State Bank of India', sector: 'Banking', marketCapCategory: 'Large Cap' },
  'STATE BANK': { symbol: 'SBIN', bseCode: '500112', name: 'State Bank of India', sector: 'Banking', marketCapCategory: 'Large Cap' },
  BHARTIARTL: { symbol: 'BHARTIARTL', bseCode: '532454', name: 'Bharti Airtel Ltd', sector: 'Telecom', marketCapCategory: 'Large Cap' },
  'BHARTI AIRTEL': { symbol: 'BHARTIARTL', bseCode: '532454', name: 'Bharti Airtel Ltd', sector: 'Telecom', marketCapCategory: 'Large Cap' },
  TATAMOTORS: { symbol: 'TATAMOTORS', bseCode: '500570', name: 'Tata Motors Ltd', sector: 'Auto', marketCapCategory: 'Large Cap' },
  'TATA MOTORS': { symbol: 'TATAMOTORS', bseCode: '500570', name: 'Tata Motors Ltd', sector: 'Auto', marketCapCategory: 'Large Cap' },
  TATASTEEL: { symbol: 'TATASTEEL', bseCode: '500470', name: 'Tata Steel Ltd', sector: 'Metals & Mining', marketCapCategory: 'Large Cap' },
  'TATA STEEL': { symbol: 'TATASTEEL', bseCode: '500470', name: 'Tata Steel Ltd', sector: 'Metals & Mining', marketCapCategory: 'Large Cap' },
  WIPRO: { symbol: 'WIPRO', bseCode: '507685', name: 'Wipro Ltd', sector: 'IT', marketCapCategory: 'Large Cap' },
  LT: { symbol: 'LT', bseCode: '500510', name: 'Larsen & Toubro Ltd', sector: 'Infrastructure', marketCapCategory: 'Large Cap' },
  'L&T': { symbol: 'LT', bseCode: '500510', name: 'Larsen & Toubro Ltd', sector: 'Infrastructure', marketCapCategory: 'Large Cap' },
  MARUTI: { symbol: 'MARUTI', bseCode: '532500', name: 'Maruti Suzuki India Ltd', sector: 'Auto', marketCapCategory: 'Large Cap' },
  SUNPHARMA: { symbol: 'SUNPHARMA', bseCode: '524715', name: 'Sun Pharmaceutical Industries Ltd', sector: 'Pharma', marketCapCategory: 'Large Cap' },
  TITAN: { symbol: 'TITAN', bseCode: '500114', name: 'Titan Company Ltd', sector: 'Consumer Goods', marketCapCategory: 'Large Cap' },
  ZOMATO: { symbol: 'ZOMATO', bseCode: '543320', name: 'Zomato Ltd', sector: 'Consumer Tech', marketCapCategory: 'Large Cap' },
  JIOFIN: { symbol: 'JIOFIN', bseCode: '543940', name: 'Jio Financial Services Ltd', sector: 'Financial Services', marketCapCategory: 'Large Cap' },
};

/**
 * Normalizes an Indian company name or symbol string to standard equity details
 */
export function resolveIndianEquity(rawName: string): {
  symbol: string;
  bseCode: string;
  name: string;
  sector: string;
  marketCapCategory: 'Large Cap' | 'Mid Cap' | 'Small Cap';
} {
  const trimmed = rawName.trim();
  const upper = trimmed.toUpperCase();

  // Direct lookup
  if (INDIAN_EQUITY_DICTIONARY[upper]) {
    return { ...INDIAN_EQUITY_DICTIONARY[upper] };
  }

  // Check spaced acronyms (e.g. "B P C L" -> "BPCL", "I R C T C" -> "IRCTC")
  const collapsedAcronym = upper.replace(/\b([A-Z])\s+([A-Z])\b/g, '$1$2').replace(/\b([A-Z]{2,})\s+([A-Z])\b/g, '$1$2');
  if (INDIAN_EQUITY_DICTIONARY[collapsedAcronym]) {
    return { ...INDIAN_EQUITY_DICTIONARY[collapsedAcronym] };
  }

  // Normalized key (removing punctuation)
  const cleanKey = upper.replace(/[,\.\-\_\(\)\']/g, ' ').replace(/\s+/g, ' ').trim();
  if (INDIAN_EQUITY_DICTIONARY[cleanKey]) {
    return { ...INDIAN_EQUITY_DICTIONARY[cleanKey] };
  }

  // Partial match search in dictionary
  for (const [dictKey, val] of Object.entries(INDIAN_EQUITY_DICTIONARY)) {
    if (dictKey.length >= 4 && (cleanKey.startsWith(dictKey) || dictKey.startsWith(cleanKey))) {
      return { ...val };
    }
  }

  // Fallback: derive clean symbol from acronym or letters
  const derivedSymbol = (collapsedAcronym || cleanKey)
    .split(/[\s-]+/)[0]
    .replace(/[^A-Z0-9&]/g, '');

  return {
    symbol: derivedSymbol || 'STOCK',
    bseCode: '',
    name: trimmed || derivedSymbol || 'Unknown Company',
    sector: 'Diversified',
    marketCapCategory: 'Mid Cap',
  };
}

/**
 * Extract clean text line-by-line from a PDF file or ArrayBuffer
 * Supports password-protected PDFs (common in Indian broker contract notes and CAS statements)
 */
export async function extractTextFromPdf(
  source: File | ArrayBuffer,
  password?: string
): Promise<ExtractedPdfResult> {
  let arrayBuffer: ArrayBuffer;
  if (source instanceof File) {
    arrayBuffer = await source.arrayBuffer();
  } else {
    arrayBuffer = source;
  }

  try {
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      password: password || undefined,
      useSystemFonts: true,
    });

    const pdf = await loadingTask.promise;
    const pagesCount = pdf.numPages;
    const allLines: string[] = [];

    for (let pageNum = 1; pageNum <= pagesCount; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const items = textContent.items as Array<{
        str: string;
        transform: number[];
        width?: number;
        height?: number;
      }>;

      // Group text items by their vertical position (Y coordinate) with 4px tolerance
      const rowMap = new Map<number, Array<{ x: number; text: string }>>();

      for (const item of items) {
        if (!item.str || item.str.trim().length === 0) continue;
        const x = item.transform[4];
        const y = Math.round(item.transform[5]);

        // Find existing row within 3px
        let foundY: number | null = null;
        for (const existingY of rowMap.keys()) {
          if (Math.abs(existingY - y) <= 3) {
            foundY = existingY;
            break;
          }
        }

        const targetY = foundY !== null ? foundY : y;
        if (!rowMap.has(targetY)) {
          rowMap.set(targetY, []);
        }
        rowMap.get(targetY)!.push({ x, text: item.str.trim() });
      }

      // Sort rows top-to-bottom (PDF Y starts at bottom, so higher Y is higher on page)
      const sortedYs = Array.from(rowMap.keys()).sort((a, b) => b - a);

      for (const y of sortedYs) {
        const rowItems = rowMap.get(y)!;
        // Sort items left-to-right (ascending X)
        rowItems.sort((a, b) => a.x - b.x);
        const line = rowItems.map((item) => item.text).join('\t');
        if (line.trim().length > 0) {
          allLines.push(line);
        }
      }
    }

    return {
      text: allLines.join('\n'),
      pagesCount,
      lines: allLines,
    };
  } catch (err: any) {
    if (err?.name === 'PasswordException' || err?.message?.toLowerCase().includes('password')) {
      throw new Error('PASSWORD_REQUIRED');
    }
    throw err;
  }
}

/**
 * Detect and parse holding/portfolio valuation report statements
 * Handles multi-line wrapped company names and multi-column numeric rows
 */
function parseHoldingValuationStatement(rawLines: string[]): HoldingStatementRow[] {
  const rows: HoldingStatementRow[] = [];
  let prefix = '';
  const todayDate = new Date().toISOString().split('T')[0];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;

    // Skip section headers like "Equity", "Asset Class", "Grand Total", etc.
    const lower = line.toLowerCase();
    if (lower === 'equity' || lower.includes('asset class') || lower.includes('grand total') || lower.includes('sub total')) {
      continue;
    }

    // Match all numbers (including decimals, commas, and negative signs)
    const numMatches = line.match(/-?\d+(?:,\d+)*(?:\.\d+)?/g);

    // If fewer than 4 numbers, this line is a company name prefix or wrap!
    if (!numMatches || numMatches.length < 4) {
      prefix = prefix ? `${prefix} ${line}` : line;
      continue;
    }

    // Data line with company name part and numbers
    const firstNumIdx = line.search(/-?\d+(?:,\d+)*(?:\.\d+)?/);
    const lineNamePart = line.substring(0, firstNumIdx).trim();
    let rawName = prefix ? `${prefix} ${lineNamePart}` : lineNamePart;
    rawName = rawName.trim();
    prefix = ''; // Reset prefix buffer

    if (!rawName) continue;

    const nums = numMatches.map((n) => parseFloat(n.replace(/,/g, '')));

    // Resolve column mappings based on number of columns
    let holdingQty = nums[0];
    let buyValue = nums[1];
    let holdingRate = nums[1] && holdingQty ? nums[1] / holdingQty : 0;
    let marketPrice = nums[nums.length - 1];
    let realizedPnL = 0;
    let unrealizedPnL = 0;

    if (nums.length >= 10) {
      // 11-column standard Indian broker format (Motilal Oswal, ICICI Direct, Kotak, Sharekhan):
      // [0]: Buy Qty, [1]: Buy Value, [2]: Sell Qty, [3]: Sell Value, [4]: Buy Cost Closed,
      // [5]: Sell Cost Closed, [6]: Holding Qty, [7]: Holding Rate (Avg Cost),
      // [8]: Market Rate LTP, [9]: Realised P/L, [10]: Unrealised P/L
      holdingQty = nums[6] || nums[0];
      holdingRate = nums[7] || (holdingQty > 0 ? nums[1] / holdingQty : 0);
      buyValue = nums[1] || (holdingQty * holdingRate);
      marketPrice = nums[8];
      realizedPnL = nums[9] || 0;
      unrealizedPnL = nums[10] || 0;
    } else if (nums.length >= 6) {
      // 6 to 9 column format: [Qty, AvgPrice, CurrentPrice, Invested, CurrentVal, PnL]
      holdingQty = nums[0];
      holdingRate = nums[1];
      marketPrice = nums[2];
      buyValue = nums[3] || (holdingQty * holdingRate);
      unrealizedPnL = nums[nums.length - 1] || 0;
    }

    if (holdingQty <= 0 && buyValue <= 0) {
      continue;
    }

    const equity = resolveIndianEquity(rawName);
    const currentValue = Number((holdingQty * marketPrice).toFixed(2));

    rows.push({
      rawName,
      symbol: equity.symbol,
      bseCode: equity.bseCode,
      name: equity.name,
      sector: equity.sector,
      marketCapCategory: equity.marketCapCategory,
      holdingQuantity: holdingQty,
      holdingRate: Number(holdingRate.toFixed(2)),
      buyValue: Number(buyValue.toFixed(2)),
      marketPrice: Number(marketPrice.toFixed(2)),
      currentValue,
      realizedPnL: Number(realizedPnL.toFixed(2)),
      unrealizedPnL: Number(unrealizedPnL.toFixed(2)),
      type: 'BUY',
      date: todayDate,
    });
  }

  return rows;
}

/**
 * Parses raw text extracted from PDF or pasted by user from Indian broker statements / CAS
 * Identifies columns: Symbol/Name, Date, Type (Buy/Sell), Qty, Price, Amount OR Holding Statement
 */
export function parseStatementText(rawText: string): ParsedStatementResult {
  if (!rawText || rawText.trim().length === 0) {
    return { rows: [], detectedColumns: [], detectedType: 'unknown' };
  }

  const rawLines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    return { rows: [], detectedColumns: [], detectedType: 'unknown' };
  }

  // Check Mode 1: Holding / Valuation Statement (like the user's report)
  const holdingsRows = parseHoldingValuationStatement(rawLines);
  if (holdingsRows.length >= 2) {
    const totalInvested = Number(holdingsRows.reduce((acc, r) => acc + r.buyValue, 0).toFixed(2));
    const totalCurrentValue = Number(holdingsRows.reduce((acc, r) => acc + r.currentValue, 0).toFixed(2));
    const totalUnrealizedPnL = Number(holdingsRows.reduce((acc, r) => acc + r.unrealizedPnL, 0).toFixed(2));

    return {
      rows: holdingsRows,
      detectedColumns: [
        'symbol',
        'name',
        'bseCode',
        'sector',
        'holdingQuantity',
        'holdingRate',
        'marketPrice',
        'buyValue',
        'currentValue',
        'unrealizedPnL',
      ],
      detectedType: 'holdings',
      holdingsSummary: {
        totalHoldings: holdingsRows.length,
        totalInvested,
        totalCurrentValue,
        totalUnrealizedPnL,
      },
    };
  }

  // Check Mode 2: Standard Tabular Statement with Delimited Header (Tab / Comma / Multi-space)
  const rows: Record<string, any>[] = [];
  let headerIndex = -1;
  let headers: string[] = [];

  const txKeywords = ['symbol', 'stock', 'scrip', 'company', 'date', 'trade date', 'type', 'buy/sell', 'quantity', 'qty', 'price', 'rate', 'amount'];
  const holdingsKeywords = ['symbol', 'stock', 'isin', 'holding', 'quantity', 'shares', 'avg cost', 'current price', 'invested'];

  for (let i = 0; i < Math.min(rawLines.length, 15); i++) {
    const line = rawLines[i].toLowerCase();
    const tabParts = rawLines[i].split('\t').map((s) => s.trim()).filter(Boolean);
    const commaParts = rawLines[i].split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    const parts = tabParts.length > 2 ? tabParts : commaParts.length > 2 ? commaParts : line.split(/\s{2,}/);

    const matchTxCount = parts.filter((p) => txKeywords.some((k) => p.toLowerCase().includes(k))).length;
    const matchHoldCount = parts.filter((p) => holdingsKeywords.some((k) => p.toLowerCase().includes(k))).length;

    if (matchTxCount >= 3 || matchHoldCount >= 3) {
      headerIndex = i;
      headers = parts.map((p, idx) => p.trim() || `col_${idx + 1}`);
      break;
    }
  }

  if (headerIndex !== -1 && headers.length > 0) {
    for (let i = headerIndex + 1; i < rawLines.length; i++) {
      const line = rawLines[i];
      const tabParts = line.split('\t').map((s) => s.trim());
      const commaParts = line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      const parts = tabParts.length >= headers.length / 2 ? tabParts : commaParts.length >= headers.length / 2 ? commaParts : line.split(/\s{2,}/);

      if (parts.length >= 2) {
        const rowObj: Record<string, any> = {};
        headers.forEach((h, idx) => {
          rowObj[h] = parts[idx] !== undefined ? parts[idx] : '';
        });
        rows.push(rowObj);
      }
    }
  } else {
    // Check Mode 3: Line-by-line pattern detection (Regex for Indian dates + ticker + buy/sell + qty + rate)
    const dateRegex = /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/i;
    const typeRegex = /\b(BUY|SELL|B|S)\b/i;
    const numberRegex = /\b\d+(?:,\d+)*(?:\.\d+)?\b/g;

    for (const line of rawLines) {
      const dateMatch = line.match(dateRegex);
      if (!dateMatch) continue;

      const typeMatch = line.match(typeRegex);
      const lineWithoutDate = line.replace(dateMatch[0], '');
      const numbers = lineWithoutDate.match(numberRegex);

      if (numbers && numbers.length >= 2) {
        const words = lineWithoutDate
          .replace(typeMatch ? typeMatch[0] : '', '')
          .split(/[\t,\s]+/)
          .filter((w) => /^[A-Z0-9&-]{2,15}$/.test(w) && !/^\d+$/.test(w) && !['EQ', 'NSE', 'BSE', 'NSI'].includes(w));

        const symbol = words[0] || 'STOCK';
        const cleanNumbers = numbers.map((n) => parseFloat(n.replace(/,/g, ''))).filter((n) => !isNaN(n));

        if (cleanNumbers.length >= 2) {
          let qty = cleanNumbers[0];
          let price = cleanNumbers[1];

          if (Number.isInteger(cleanNumbers[0]) && cleanNumbers[1] > cleanNumbers[0] * 5) {
            qty = cleanNumbers[0];
            price = cleanNumbers[1];
          } else if (Number.isInteger(cleanNumbers[1]) && cleanNumbers[0] > cleanNumbers[1] * 5) {
            qty = cleanNumbers[1];
            price = cleanNumbers[0];
          }

          rows.push({
            symbol,
            date: dateMatch[0],
            type: typeMatch ? (typeMatch[1].toUpperCase().startsWith('B') ? 'BUY' : 'SELL') : 'BUY',
            quantity: qty,
            price: price,
          });
        }
      }
    }

    if (rows.length > 0) {
      headers = ['symbol', 'date', 'type', 'quantity', 'price'];
    }
  }

  const headerStr = headers.join(' ').toLowerCase();
  const detectedType =
    headerStr.includes('date') || headerStr.includes('type') || headerStr.includes('buy')
      ? 'transactions'
      : 'stocks';

  return {
    rows,
    detectedColumns: headers,
    detectedType,
  };
}
