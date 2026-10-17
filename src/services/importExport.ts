import * as XLSX from 'xlsx';
import type {
  Stock,
  Transaction,
  CorporateAction,
  PriceRecord,
  Fundamentals,
  CostMethod,
  HoldingCalculation,
  ImportPreviewRow,
  MarketCapCategory,
} from '../types';
import { validateSellQuantity, classifyTaxLots } from './calculations';
import { formatDateDDMMYYYY } from '../utils/formatters';

// Common aliases for Screener.in standard fields
export const SCREENER_FIELD_DEFINITIONS: Array<{
  key: keyof Omit<Fundamentals, 'id' | 'stockId' | 'symbol' | 'lastUpdated' | 'financials5Y' | 'shareholding'>;
  label: string;
  aliases: string[];
}> = [
  { key: 'marketCapCr', label: 'Market Cap (Cr)', aliases: ['market capitalization', 'market cap', 'mcap', 'mar cap', 'market cap (cr)', 'market cap cr'] },
  { key: 'stockPE', label: 'Stock P/E', aliases: ['price to earning', 'stock p/e', 'p/e', 'pe', 'current pe'] },
  { key: 'sectorPE', label: 'Sector P/E', aliases: ['sector p/e', 'industry p/e', 'sector pe', 'ind pe'] },
  { key: 'roce', label: 'ROCE (%)', aliases: ['return on capital employed', 'roce', 'roce %', 'roce 1yr', 'roce%'] },
  { key: 'roe', label: 'ROE (%)', aliases: ['return on equity', 'roe', 'roe %', 'roe 1yr', 'roe%'] },
  { key: 'debtToEquity', label: 'Debt to Equity', aliases: ['debt to equity', 'd/e', 'debt / equity', 'debt/equity'] },
  { key: 'evToEbitda', label: 'EV / EBITDA', aliases: ['ev / ebitda', 'ev/ebitda', 'enterprise value to ebitda'] },
  { key: 'pbRatio', label: 'Price to Book (P/B)', aliases: ['price to book', 'p/b', 'price to book value', 'pb'] },
  { key: 'dividendYield', label: 'Dividend Yield (%)', aliases: ['dividend yield', 'div yield', 'div yield %', 'dividend yield %'] },
  { key: 'salesCagr10Y', label: '10Y Sales Growth (%)', aliases: ['10y sales cagr', '10years sales growth', 'compounded sales growth 10 years', 'sales growth 10years', 'sales 10y cagr'] },
  { key: 'profitCagr10Y', label: '10Y Profit Growth (%)', aliases: ['10y profit cagr', '10years profit growth', 'compounded profit growth 10 years', 'profit growth 10years', 'profit 10y cagr'] },
  { key: 'high52W', label: '52W High (₹)', aliases: ['52w high', '52 week high', 'high price', 'high'] },
  { key: 'low52W', label: '52W Low (₹)', aliases: ['52w low', '52 week low', 'low price', 'low'] },
  { key: 'intrinsicValue', label: 'Intrinsic Value (₹)', aliases: ['intrinsic value', 'fair value', 'graham number'] },
];

/**
 * Parses raw ArrayBuffer or binary string into an array of row objects
 */
export function parseSpreadsheet(data: ArrayBuffer | string): { sheets: string[]; getSheetData: (sheetName?: string) => Record<string, any>[] } {
  const workbook = XLSX.read(data, { type: typeof data === 'string' ? 'binary' : 'array', cellDates: true });
  const sheets = workbook.SheetNames;

  const getSheetData = (sheetName?: string) => {
    const targetSheet = sheetName || sheets[0];
    const worksheet = workbook.Sheets[targetSheet];
    if (!worksheet) return [];
    return XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });
  };

  return { sheets, getSheetData };
}

/**
 * Normalizes Excel dates, ISO dates, or DD-MM-YYYY strings into YYYY-MM-DD
 */
export function normalizeDate(val: any): string | null {
  if (!val) return null;

  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const str = String(val).trim();
  if (!str) return null;

  // DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // YYYY-MM-DD
  const ymdMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, '0');
    const day = ymdMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Try standard parse
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

/**
 * 1. Validate and Parse Stocks Import
 */
export function validateStocksImport(
  rawRows: Record<string, any>[],
  existingStocks: Stock[]
): ImportPreviewRow<Stock>[] {
  const existingSymbols = new Set(existingStocks.map((s) => s.symbol.toUpperCase()));
  const existingBseCodes = new Set(existingStocks.map((s) => s.bseCode));

  return rawRows.map((row, idx) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Keys lookup (case-insensitive)
    const findVal = (fieldNames: string[]) => {
      for (const fn of fieldNames) {
        for (const [k, v] of Object.entries(row)) {
          if (k.trim().toLowerCase() === fn.toLowerCase()) {
            return String(v).trim();
          }
        }
      }
      return '';
    };

    const bseCode = findVal(['bse_code', 'bsecode', 'bse code', 'bse']);
    let symbol = findVal(['nse_symbol', 'nsesymbol', 'symbol', 'nse symbol', 'ticker']).toUpperCase();
    let name = findVal(['name', 'company_name', 'company name', 'company']);
    let sector = findVal(['sector', 'industry']);
    let marketCap = findVal(['market_cap', 'market cap', 'marketcap', 'market cap category', 'cap']) as MarketCapCategory;
    const isin = findVal(['isin', 'isin_code']).toUpperCase();
    const expDivStr = findVal(['expected_dividend', 'expected dividend', 'dividend per share', 'exp_div']);

    // Check BSE Code
    if (!bseCode) {
      errors.push('BSE Code is required.');
    } else if (!/^\d{6}$/.test(bseCode)) {
      errors.push(`Invalid BSE code "${bseCode}". Must be exactly 6 digits.`);
    }

    // If only BSE Code is provided, create placeholders for name and symbol
    if (bseCode && (!symbol || !name)) {
      if (!symbol) symbol = `BSE_${bseCode}`;
      if (!name) name = `Company ${bseCode}`;
      if (!sector) sector = 'Diversified';
      warnings.push('Incomplete stock info: generated default symbol/name from BSE Code.');
    }

    if (!sector) {
      sector = 'Diversified';
    }

    const validCaps: MarketCapCategory[] = ['Large Cap', 'Mid Cap', 'Small Cap', 'Micro Cap'];
    if (!validCaps.includes(marketCap)) {
      marketCap = 'Large Cap';
    }

    // Duplicate checks
    if (symbol && existingSymbols.has(symbol)) {
      warnings.push(`Symbol ${symbol} already exists. Will update stock details.`);
    }
    if (bseCode && existingBseCodes.has(bseCode)) {
      warnings.push(`BSE Code ${bseCode} already registered.`);
    }

    const expectedDividendPerShare = expDivStr ? parseFloat(expDivStr) : undefined;

    const parsedData: Partial<Stock> = {
      symbol,
      bseCode,
      name,
      sector,
      marketCapCategory: marketCap,
      isin: isin || undefined,
      expectedDividendPerShare: !isNaN(expectedDividendPerShare!) ? expectedDividendPerShare : undefined,
    };

    return {
      rowIndex: idx + 1,
      data: parsedData,
      rawRow: row,
      errors,
      warnings,
      isValid: errors.length === 0,
    };
  });
}

/**
 * 2. Validate and Parse Transactions Import
 */
export function validateTransactionsImport(
  rawRows: Record<string, any>[],
  stocks: Stock[],
  existingTransactions: Transaction[],
  corporateActions: CorporateAction[]
): ImportPreviewRow<Transaction>[] {
  const stockMapBySymbol = new Map<string, Stock>();
  const stockMapByBse = new Map<string, Stock>();

  stocks.forEach((s) => {
    stockMapBySymbol.set(s.symbol.toUpperCase(), s);
    stockMapByBse.set(s.bseCode, s);
  });

  // Track virtual running positions for sequence validation
  const simulatedTxs: Transaction[] = [...existingTransactions];

  return rawRows.map((row, idx) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const findVal = (fieldNames: string[]) => {
      for (const fn of fieldNames) {
        for (const [k, v] of Object.entries(row)) {
          if (k.trim().toLowerCase() === fn.toLowerCase()) {
            return String(v).trim();
          }
        }
      }
      return '';
    };

    const identifier = findVal(['symbol', 'nse_symbol', 'bse_code', 'bsecode', 'bse', 'stock', 'ticker']).toUpperCase();
    const dateRaw = findVal(['date', 'tx_date', 'transaction date', 'trade date']);
    const typeRaw = findVal(['type', 'tx_type', 'transaction type', 'action']).toUpperCase();
    const qtyStr = findVal(['qty', 'quantity', 'shares', 'units']);
    const priceStr = findVal(['price', 'buy price', 'sell price', 'rate', 'avg price']);
    const chargesStr = findVal(['charges', 'brokerage', 'taxes', 'fees']);
    const note = findVal(['note', 'notes', 'remarks', 'comment']);

    // Match Stock
    const matchedStock = stockMapBySymbol.get(identifier) || stockMapByBse.get(identifier);
    if (!matchedStock || !matchedStock.id) {
      errors.push(`Stock "${identifier}" not found in master database. Please add stock first.`);
    }

    // Date
    const normDate = normalizeDate(dateRaw);
    if (!normDate) {
      errors.push(`Invalid date format "${dateRaw}". Use DD-MM-YYYY or YYYY-MM-DD.`);
    }

    // Type
    let txType: 'BUY' | 'SELL' = 'BUY';
    if (typeRaw === 'BUY' || typeRaw === 'B') {
      txType = 'BUY';
    } else if (typeRaw === 'SELL' || typeRaw === 'S') {
      txType = 'SELL';
    } else {
      errors.push(`Invalid transaction type "${typeRaw}". Must be BUY or SELL.`);
    }

    // Quantity
    const qty = parseFloat(qtyStr);
    if (isNaN(qty) || qty <= 0) {
      errors.push(`Quantity must be a positive number. Got "${qtyStr}".`);
    }

    // Price
    const price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) {
      errors.push(`Price must be greater than zero. Got "${priceStr}".`);
    }

    const charges = chargesStr ? parseFloat(chargesStr) : 0;

    // Validate SELL against holding
    if (matchedStock?.id && normDate && txType === 'SELL' && !isNaN(qty) && qty > 0) {
      const sellCheck = validateSellQuantity(matchedStock.id, normDate, qty, simulatedTxs, corporateActions);
      if (!sellCheck.isValid) {
        errors.push(sellCheck.error || `Insufficient shares to sell on ${normDate}.`);
      }
    }

    const parsedTx: Partial<Transaction> = {
      stockId: matchedStock?.id,
      symbol: matchedStock?.symbol || identifier,
      type: txType,
      date: normDate || '',
      quantity: qty || 0,
      price: price || 0,
      charges: !isNaN(charges) ? charges : 0,
      note: note || undefined,
    };

    if (errors.length === 0 && matchedStock?.id) {
      simulatedTxs.push({
        stockId: matchedStock.id,
        symbol: matchedStock.symbol,
        type: txType,
        date: normDate!,
        quantity: qty,
        price,
        charges,
        createdAt: new Date().toISOString(),
      });
    }

    return {
      rowIndex: idx + 1,
      data: parsedTx,
      rawRow: row,
      errors,
      warnings,
      isValid: errors.length === 0,
    };
  });
}

/**
 * 3. Validate and Parse Bulk Price Update Import
 */
export function validateBulkPricesImport(
  rawRows: Record<string, any>[],
  stocks: Stock[]
): ImportPreviewRow<PriceRecord>[] {
  const stockMapBySymbol = new Map<string, Stock>();
  const stockMapByBse = new Map<string, Stock>();

  stocks.forEach((s) => {
    stockMapBySymbol.set(s.symbol.toUpperCase(), s);
    stockMapByBse.set(s.bseCode, s);
  });

  return rawRows.map((row, idx) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const findVal = (fieldNames: string[]) => {
      for (const fn of fieldNames) {
        for (const [k, v] of Object.entries(row)) {
          if (k.trim().toLowerCase() === fn.toLowerCase()) {
            return String(v).trim();
          }
        }
      }
      return '';
    };

    const identifier = findVal(['symbol', 'nse_symbol', 'bse_code', 'bsecode', 'stock', 'ticker']).toUpperCase();
    const priceStr = findVal(['price', 'current_price', 'cmp', 'close_price', 'close']);
    const dateRaw = findVal(['date', 'price_date', 'as_on_date']) || new Date().toISOString().split('T')[0];

    const matchedStock = stockMapBySymbol.get(identifier) || stockMapByBse.get(identifier);
    if (!matchedStock || !matchedStock.id) {
      errors.push(`Stock "${identifier}" not found in database.`);
    }

    const price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) {
      errors.push(`Price must be greater than zero. Got "${priceStr}".`);
    }

    const normDate = normalizeDate(dateRaw);
    if (!normDate) {
      errors.push(`Invalid date format "${dateRaw}".`);
    }

    const parsedPrice: Partial<PriceRecord> = {
      stockId: matchedStock?.id,
      symbol: matchedStock?.symbol || identifier,
      price: price || 0,
      date: normDate || new Date().toISOString().split('T')[0],
    };

    return {
      rowIndex: idx + 1,
      data: parsedPrice,
      rawRow: row,
      errors,
      warnings,
      isValid: errors.length === 0,
    };
  });
}

/**
 * 4. Screener.in Parser & Column-Mapping
 */
export function autoDetectScreenerMapping(columns: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};

  for (const def of SCREENER_FIELD_DEFINITIONS) {
    for (const col of columns) {
      const colClean = col.trim().toLowerCase();
      if (def.aliases.some((alias) => colClean === alias || colClean.includes(alias))) {
        mapping[def.key] = col;
        break;
      }
    }
  }

  // Also auto-detect Stock Identifier column
  for (const col of columns) {
    const colClean = col.trim().toLowerCase();
    if (['bse code', 'bse_code', 'bse', 'nse symbol', 'symbol', 'name', 'company name'].includes(colClean)) {
      mapping['__stockIdentifier'] = col;
      break;
    }
  }

  return mapping;
}

export function parseScreenerRows(
  rawRows: Record<string, any>[],
  columnMapping: Record<string, string>,
  stocks: Stock[]
): ImportPreviewRow<Fundamentals>[] {
  const stockMapBySymbol = new Map<string, Stock>();
  const stockMapByBse = new Map<string, Stock>();
  const stockMapByName = new Map<string, Stock>();

  stocks.forEach((s) => {
    stockMapBySymbol.set(s.symbol.toUpperCase(), s);
    stockMapByBse.set(s.bseCode, s);
    stockMapByName.set(s.name.toLowerCase(), s);
  });

  const identifierCol = columnMapping['__stockIdentifier'] || Object.keys(rawRows[0] || {})[0];

  return rawRows.map((row, idx) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const rawId = String(row[identifierCol] || '').trim();
    if (!rawId) {
      errors.push('Missing stock name/symbol in row.');
      return {
        rowIndex: idx + 1,
        data: {},
        rawRow: row,
        errors,
        warnings,
        isValid: false,
      };
    }

    const matchedStock =
      stockMapBySymbol.get(rawId.toUpperCase()) ||
      stockMapByBse.get(rawId) ||
      stockMapByName.get(rawId.toLowerCase());

    if (!matchedStock || !matchedStock.id) {
      warnings.push(`Stock "${rawId}" not found in portfolio. Will be skipped if not confirmed.`);
    }

    const parseNum = (colName?: string): number | undefined => {
      if (!colName || row[colName] === undefined || row[colName] === '') return undefined;
      const clean = String(row[colName]).replace(/,/g, '').replace(/%/g, '').trim();
      const n = parseFloat(clean);
      return isNaN(n) ? undefined : n;
    };

    const fundData: Partial<Fundamentals> = {
      stockId: matchedStock?.id,
      symbol: matchedStock?.symbol || rawId,
      marketCapCr: parseNum(columnMapping['marketCapCr']),
      stockPE: parseNum(columnMapping['stockPE']),
      sectorPE: parseNum(columnMapping['sectorPE']),
      roce: parseNum(columnMapping['roce']),
      roe: parseNum(columnMapping['roe']),
      debtToEquity: parseNum(columnMapping['debtToEquity']),
      evToEbitda: parseNum(columnMapping['evToEbitda']),
      pbRatio: parseNum(columnMapping['pbRatio']),
      dividendYield: parseNum(columnMapping['dividendYield']),
      salesCagr10Y: parseNum(columnMapping['salesCagr10Y']),
      profitCagr10Y: parseNum(columnMapping['profitCagr10Y']),
      high52W: parseNum(columnMapping['high52W']),
      low52W: parseNum(columnMapping['low52W']),
      intrinsicValue: parseNum(columnMapping['intrinsicValue']),
      lastUpdated: new Date().toISOString().split('T')[0],
    };

    return {
      rowIndex: idx + 1,
      data: fundData,
      rawRow: row,
      errors,
      warnings,
      isValid: errors.length === 0 && matchedStock !== undefined,
    };
  });
}

/**
 * 5. Downloadable Sample File Builders
 */
export function downloadSampleFile(filename: string, content: string | Uint8Array, fileType: 'csv' | 'xlsx' = 'csv') {
  const mime =
    fileType === 'csv'
      ? 'text/csv;charset=utf-8;'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const blob =
    typeof content === 'string'
      ? new Blob([content], { type: mime })
      : new Blob([content as any], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function generateSampleStocksCSV(): string {
  return [
    'NSE_Symbol,BSE_Code,Name,Sector,Market_Cap,ISIN,Expected_Dividend',
    'INFY,500209,Infosys Limited,Information Technology,Large Cap,INE009A01021,46.0',
    'ITC,500875,ITC Limited,Fast Moving Consumer Goods,Large Cap,INE154A01025,13.75',
    'POLYCAB,542652,Polycab India Ltd,Capital Goods & Wires,Mid Cap,INE455K01017,30.0',
    'DEEPAKNTR,506401,Deepak Nitrite Ltd,Specialty Chemicals,Mid Cap,INE288B01029,7.5',
  ].join('\n');
}

export function generateSampleTransactionsCSV(): string {
  return [
    'Symbol,Date,Type,Qty,Price,Charges,Note',
    'TCS,15-01-2024,BUY,10,3800.50,45.0,Tranche 1 Q4 dip',
    'RELIANCE,22-01-2024,BUY,15,2680.00,55.0,Jio growth thesis',
    'HDFCBANK,10-02-2024,BUY,25,1420.00,60.0,Post-merger averaging',
    'TCS,20-03-2024,SELL,5,4150.00,35.0,Partial profit booking',
  ].join('\n');
}

export function generateSamplePricesCSV(): string {
  return [
    'Symbol,Price,Date',
    'TCS,4150.00,2024-10-17',
    'RELIANCE,2755.50,2024-10-17',
    'HDFCBANK,1680.00,2024-10-17',
    'TITAN,3580.00,2024-10-17',
    'TATAMOTORS,930.00,2024-10-17',
  ].join('\n');
}

export function generateSampleScreenerCSV(): string {
  return [
    'Name,BSE Code,NSE Symbol,Market Capitalization,Price to Earning,ROCE,Return on equity,Debt to equity,Dividend yield,High price,Low price',
    'Tata Consultancy Services Ltd.,532540,TCS,1485000,30.5,58.2,48.5,0.05,1.82,4585,3313',
    'Reliance Industries Ltd.,500325,RELIANCE,1850000,26.8,11.4,9.8,0.42,0.36,3217,2220',
    'HDFC Bank Ltd.,500180,HDFCBANK,1280000,18.9,16.8,15.5,0.85,1.15,1794,1363',
  ].join('\n');
}

/**
 * 6. Export Engine (Excel Multi-Sheet & CSV)
 */
export function exportMultiSheetExcel(
  stocks: Stock[],
  holdings: HoldingCalculation[],
  transactions: Transaction[],
  corporateActions: CorporateAction[],
  costMethod: CostMethod
) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Stocks Master
  const stocksRows = stocks.map((s) => ({
    'NSE Symbol': s.symbol,
    'BSE Code': s.bseCode,
    'Company Name': s.name,
    'Sector': s.sector,
    'Market Cap Category': s.marketCapCategory,
    'ISIN': s.isin || '',
    'Expected Div/Share (₹)': s.expectedDividendPerShare || '',
    'Watchlist': s.watchlist ? 'Yes' : 'No',
    'Thesis Note': s.thesisNote || '',
  }));
  const wsStocks = XLSX.utils.json_to_sheet(stocksRows);
  XLSX.utils.book_append_sheet(wb, wsStocks, 'Stocks Master');

  // Sheet 2: Current Holdings
  const holdingsRows = holdings.map((h) => ({
    'Symbol': h.stock.symbol,
    'BSE Code': h.stock.bseCode,
    'Company': h.stock.name,
    'Sector': h.stock.sector,
    'Quantity': h.quantity,
    'Lots': h.lotsCount,
    'Average Price (₹)': Number(h.averageBuyPrice.toFixed(2)),
    'Cost Method': costMethod,
    'Total Invested (₹)': Number(h.totalInvested.toFixed(2)),
    'Manual Price (₹)': Number(h.currentPrice.toFixed(2)),
    'Last Price Date': h.lastPriceDate || '',
    'Current Value (₹)': Number(h.currentValue.toFixed(2)),
    'Unrealized P&L (₹)': Number(h.unrealizedPnL.toFixed(2)),
    'Unrealized P&L (%)': Number(h.unrealizedPnLPercent.toFixed(2)),
    'Realized P&L (₹)': Number(h.realizedPnL.toFixed(2)),
    'ROCE (%)': h.roce !== null ? h.roce : '',
    'P/E': h.pe !== null ? h.pe : '',
    'Annual Div Income (₹)': Number(h.annualDividendIncome.toFixed(2)),
    'Yield on Cost (%)': Number(h.yieldOnCost.toFixed(2)),
  }));
  const wsHoldings = XLSX.utils.json_to_sheet(holdingsRows);
  XLSX.utils.book_append_sheet(wb, wsHoldings, 'Current Holdings');

  // Sheet 3: Tranche Ledger
  const sortedTxs = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const txRows = sortedTxs.map((t) => ({
    'Date': formatDateDDMMYYYY(t.date),
    'Symbol': t.symbol,
    'Type': t.type,
    'Quantity': t.quantity,
    'Price (₹)': t.price,
    'Charges (₹)': t.charges || 0,
    'Gross Amount (₹)': t.quantity * t.price,
    'Net Amount (₹)': t.type === 'BUY' ? t.quantity * t.price + (t.charges || 0) : t.quantity * t.price - (t.charges || 0),
    'Note': t.note || '',
  }));
  const wsTxs = XLSX.utils.json_to_sheet(txRows);
  XLSX.utils.book_append_sheet(wb, wsTxs, 'Tranche Ledger');

  // Sheet 4: Realized P&L (FIFO Tax Matched)
  const taxLots = classifyTaxLots(transactions, corporateActions);
  const taxRows = taxLots.map((tl) => ({
    'Symbol': tl.symbol,
    'Sale Date': formatDateDDMMYYYY(tl.sellDate),
    'Buy Date': formatDateDDMMYYYY(tl.buyDate),
    'Quantity': tl.quantity,
    'Sale Price (₹)': Number(tl.sellPrice.toFixed(2)),
    'Cost Price (₹)': Number(tl.buyPrice.toFixed(2)),
    'Gain / Loss (₹)': Number(tl.gainOrLoss.toFixed(2)),
    'Holding Days': tl.holdingDays,
    'Term': tl.term,
    'Financial Year': tl.financialYear,
  }));
  const wsTax = XLSX.utils.json_to_sheet(taxRows);
  XLSX.utils.book_append_sheet(wb, wsTax, 'Realized PnL & Tax');

  // Generate buffer and trigger download
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const dateStr = `${day}-${month}-${year}`;
  XLSX.writeFile(wb, `dalal-diary-portfolio-${dateStr}.xlsx`);
}

export function exportSingleSheetCSV(data: Record<string, any>[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(data);
  const csv = XLSX.utils.sheet_to_csv(ws);
  downloadSampleFile(filename, csv, 'csv');
}
