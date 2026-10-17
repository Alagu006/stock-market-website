import Dexie, { type Table } from 'dexie';
import type {
  Stock,
  Transaction,
  PriceRecord,
  CorporateAction,
  DividendRecord,
  Fundamentals,
  BenchmarkRecord,
  AppSettings,
  CostMethod,
} from '../types';

/**
 * CRITICAL ARCHITECTURAL REQUIREMENT:
 * DO NOT rename or recreate this IndexedDB database name ('DalalDiaryDB').
 * Keeping this exact name ensures existing user portfolios, transactions,
 * and historical prices remain 100% intact across all upgrades and updates.
 */
export class DalalDiaryDB extends Dexie {
  stocks!: Table<Stock, number>;
  transactions!: Table<Transaction, number>;
  priceRecords!: Table<PriceRecord, number>;
  corporateActions!: Table<CorporateAction, number>;
  dividendRecords!: Table<DividendRecord, number>;
  fundamentals!: Table<Fundamentals, number>;
  benchmarkRecords!: Table<BenchmarkRecord, number>;
  settings!: Table<AppSettings, number>;

  constructor() {
    // Preserve 'DalalDiaryDB' database name for complete backward data compatibility
    super('DalalDiaryDB');
    this.version(1).stores({
      stocks: '++id, &symbol, bseCode, name, sector, marketCapCategory, watchlist',
      transactions: '++id, stockId, symbol, type, date',
      priceRecords: '++id, stockId, symbol, date',
      corporateActions: '++id, stockId, symbol, type, exDate',
      dividendRecords: '++id, stockId, symbol, date',
      fundamentals: '++id, &stockId, symbol',
      benchmarkRecords: '++id, name, date',
      settings: '++id',
    });
  }
}

export const db = new DalalDiaryDB();

/**
 * Initialize default settings if not exists
 */
export async function getOrInitSettings(): Promise<AppSettings> {
  const existing = await db.settings.toCollection().first();
  if (existing) {
    return existing;
  }
  const defaultSettings: AppSettings = {
    costMethod: 'Average Cost',
    stcgRate: 20, // Budget 2024 revised STCG rate
    ltcgRate: 12.5, // Budget 2024 revised LTCG rate
    ltcgExemption: 125000, // Rs 1.25 Lakh exemption
    lastBackupDate: undefined,
  };
  const id = await db.settings.add(defaultSettings);
  return { ...defaultSettings, id };
}

export async function updateCostMethodSetting(method: CostMethod): Promise<void> {
  const settings = await getOrInitSettings();
  if (settings.id) {
    await db.settings.update(settings.id, { costMethod: method });
  }
}

export async function updateScreenerMappingSetting(mapping: Record<string, string>): Promise<void> {
  const settings = await getOrInitSettings();
  if (settings.id) {
    await db.settings.update(settings.id, { savedScreenerMapping: mapping });
  }
}

export async function bulkImportStocks(stocksData: Omit<Stock, 'id' | 'createdAt'>[]): Promise<void> {
  await db.transaction('rw', db.stocks, async () => {
    for (const item of stocksData) {
      const existing = await db.stocks
        .where('symbol')
        .equalsIgnoreCase(item.symbol)
        .first();

      if (existing && existing.id) {
        await db.stocks.update(existing.id, {
          bseCode: item.bseCode || existing.bseCode,
          name: item.name || existing.name,
          sector: item.sector || existing.sector,
          marketCapCategory: item.marketCapCategory || existing.marketCapCategory,
          isin: item.isin || existing.isin,
          expectedDividendPerShare: item.expectedDividendPerShare ?? existing.expectedDividendPerShare,
        });
      } else {
        await db.stocks.add({
          ...item,
          createdAt: new Date().toISOString(),
        });
      }
    }
  });
}

export async function bulkUpsertFundamentals(
  funds: Array<Partial<Fundamentals> & { stockId: number; symbol: string }>
): Promise<void> {
  await db.transaction('rw', db.fundamentals, async () => {
    for (const item of funds) {
      const existing = await db.fundamentals
        .where('stockId')
        .equals(item.stockId)
        .first();

      if (existing && existing.id) {
        await db.fundamentals.update(existing.id, {
          ...item,
          lastUpdated: new Date().toISOString().split('T')[0],
        });
      } else {
        await db.fundamentals.add({
          stockId: item.stockId,
          symbol: item.symbol,
          marketCapCr: item.marketCapCr,
          stockPE: item.stockPE,
          sectorPE: item.sectorPE,
          roce: item.roce,
          roe: item.roe,
          debtToEquity: item.debtToEquity,
          evToEbitda: item.evToEbitda,
          pbRatio: item.pbRatio,
          dividendYield: item.dividendYield,
          salesCagr10Y: item.salesCagr10Y,
          profitCagr10Y: item.profitCagr10Y,
          high52W: item.high52W,
          low52W: item.low52W,
          intrinsicValue: item.intrinsicValue,
          lastUpdated: new Date().toISOString().split('T')[0],
        });
      }
    }
  });
}

export async function updateLastBackupTimestamp(): Promise<string> {
  const settings = await getOrInitSettings();
  const nowISO = new Date().toISOString();
  if (settings.id) {
    await db.settings.update(settings.id, { lastBackupDate: nowISO });
  }
  return nowISO;
}

/**
 * One-click JSON export of all raw tables
 */
export async function exportDatabaseBackupJSON(): Promise<string> {
  const [
    stocks,
    transactions,
    priceRecords,
    corporateActions,
    dividendRecords,
    fundamentals,
    benchmarkRecords,
    settings,
  ] = await Promise.all([
    db.stocks.toArray(),
    db.transactions.toArray(),
    db.priceRecords.toArray(),
    db.corporateActions.toArray(),
    db.dividendRecords.toArray(),
    db.fundamentals.toArray(),
    db.benchmarkRecords.toArray(),
    db.settings.toArray(),
  ]);

  const backupData = {
    app: "Dalal Diary's",
    version: '1.0.0',
    exportDate: new Date().toISOString(),
    data: {
      stocks,
      transactions,
      priceRecords,
      corporateActions,
      dividendRecords,
      fundamentals,
      benchmarkRecords,
      settings,
    },
  };

  await updateLastBackupTimestamp();
  return JSON.stringify(backupData, null, 2);
}

/**
 * Restore / Import from JSON backup
 */
export async function restoreDatabaseFromJSON(jsonStr: string, mode: 'overwrite' | 'merge' = 'overwrite'): Promise<{ success: boolean; message: string; counts: Record<string, number> }> {
  try {
    const parsed = JSON.parse(jsonStr);
    // Support both standard envelope { app: ..., data: { ... } } and direct/legacy formats
    const rawData = parsed?.data || parsed;
    if (!rawData || typeof rawData !== 'object') {
      throw new Error('Invalid backup file format: file does not contain valid portfolio data.');
    }

    const {
      stocks = [],
      transactions = [],
      priceRecords = [],
      corporateActions = [],
      dividendRecords = [],
      fundamentals = [],
      benchmarkRecords = [],
      settings = [],
    } = rawData;

    await db.transaction('rw', [
      db.stocks,
      db.transactions,
      db.priceRecords,
      db.corporateActions,
      db.dividendRecords,
      db.fundamentals,
      db.benchmarkRecords,
      db.settings,
    ], async () => {
      if (mode === 'overwrite') {
        await db.stocks.clear();
        await db.transactions.clear();
        await db.priceRecords.clear();
        await db.corporateActions.clear();
        await db.dividendRecords.clear();
        await db.fundamentals.clear();
        await db.benchmarkRecords.clear();
        await db.settings.clear();
      }

      if (stocks.length) await db.stocks.bulkAdd(stocks);
      if (transactions.length) await db.transactions.bulkAdd(transactions);
      if (priceRecords.length) await db.priceRecords.bulkAdd(priceRecords);
      if (corporateActions.length) await db.corporateActions.bulkAdd(corporateActions);
      if (dividendRecords.length) await db.dividendRecords.bulkAdd(dividendRecords);
      if (fundamentals.length) await db.fundamentals.bulkAdd(fundamentals);
      if (benchmarkRecords.length) await db.benchmarkRecords.bulkAdd(benchmarkRecords);
      if (settings.length) await db.settings.bulkAdd(settings);
    });

    await updateLastBackupTimestamp();

    return {
      success: true,
      message: 'Portfolio data restored successfully!',
      counts: {
        stocks: stocks.length,
        transactions: transactions.length,
        priceRecords: priceRecords.length,
        corporateActions: corporateActions.length,
        dividendRecords: dividendRecords.length,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      message: err.message || 'Failed to restore backup.',
      counts: {},
    };
  }
}

/**
 * Helper to seed rich realistic Indian portfolio data for quick testing/demo
 */
export async function seedSampleIndianPortfolio(): Promise<void> {
  await db.transaction('rw', [
    db.stocks,
    db.transactions,
    db.priceRecords,
    db.corporateActions,
    db.dividendRecords,
    db.fundamentals,
    db.settings,
  ], async () => {
    await db.stocks.clear();
    await db.transactions.clear();
    await db.priceRecords.clear();
    await db.corporateActions.clear();
    await db.dividendRecords.clear();
    await db.fundamentals.clear();

    // 1. Stocks
    const tcsId = await db.stocks.add({
      symbol: 'TCS',
      bseCode: '532540',
      name: 'Tata Consultancy Services Ltd',
      sector: 'Information Technology',
      marketCapCategory: 'Large Cap',
      isin: 'INE467B01029',
      expectedDividendPerShare: 75,
      watchlist: false,
      thesisNote: 'Dominant global IT services franchise with industry-leading cash conversion and high ROCE.',
      createdAt: '2023-01-01',
    });

    const relId = await db.stocks.add({
      symbol: 'RELIANCE',
      bseCode: '500325',
      name: 'Reliance Industries Ltd',
      sector: 'Energy & Retail',
      marketCapCategory: 'Large Cap',
      isin: 'INE002A01018',
      expectedDividendPerShare: 10,
      watchlist: false,
      thesisNote: 'Conglomerate spanning Retail, Telecom (Jio), and Green Energy transition.',
      createdAt: '2023-01-01',
    });

    const hdfcId = await db.stocks.add({
      symbol: 'HDFCBANK',
      bseCode: '500180',
      name: 'HDFC Bank Ltd',
      sector: 'Banking & Finance',
      marketCapCategory: 'Large Cap',
      isin: 'INE040A01034',
      expectedDividendPerShare: 19.5,
      watchlist: false,
      thesisNote: 'India premier private bank, post-merger integration progressing towards credit-deposit rebalancing.',
      createdAt: '2023-01-01',
    });

    const titanId = await db.stocks.add({
      symbol: 'TITAN',
      bseCode: '500114',
      name: 'Titan Company Ltd',
      sector: 'Consumer Discretionary',
      marketCapCategory: 'Large Cap',
      isin: 'INE280A01028',
      expectedDividendPerShare: 11,
      watchlist: false,
      thesisNote: 'Market leader in branded jewellery with strong consumer trust and retail expansion runway.',
      createdAt: '2023-01-01',
    });

    const tataMotorsId = await db.stocks.add({
      symbol: 'TATAMOTORS',
      bseCode: '500570',
      name: 'Tata Motors Ltd',
      sector: 'Automobile',
      marketCapCategory: 'Large Cap',
      isin: 'INE155A01022',
      expectedDividendPerShare: 6,
      watchlist: false,
      thesisNote: 'Turnaround story with JLR debt reduction and leading domestic EV market share.',
      createdAt: '2023-01-01',
    });

    // 2. Transactions
    // TCS
    await db.transactions.bulkAdd([
      { stockId: tcsId, symbol: 'TCS', type: 'BUY', date: '2023-04-12', quantity: 25, price: 3200, charges: 80, createdAt: '2023-04-12' },
      { stockId: tcsId, symbol: 'TCS', type: 'BUY', date: '2023-10-18', quantity: 15, price: 3450, charges: 55, createdAt: '2023-10-18' },
      { stockId: tcsId, symbol: 'TCS', type: 'BUY', date: '2024-02-15', quantity: 10, price: 3800, charges: 45, createdAt: '2024-02-15' },
    ]);

    // RELIANCE
    await db.transactions.bulkAdd([
      { stockId: relId, symbol: 'RELIANCE', type: 'BUY', date: '2023-05-20', quantity: 40, price: 2450, charges: 120, createdAt: '2023-05-20' },
      { stockId: relId, symbol: 'RELIANCE', type: 'BUY', date: '2023-12-05', quantity: 20, price: 2580, charges: 65, createdAt: '2023-12-05' },
      { stockId: relId, symbol: 'RELIANCE', type: 'SELL', date: '2024-04-10', quantity: 15, price: 2950, charges: 50, createdAt: '2024-04-10' },
    ]);

    // HDFCBANK
    await db.transactions.bulkAdd([
      { stockId: hdfcId, symbol: 'HDFCBANK', type: 'BUY', date: '2023-08-15', quantity: 60, price: 1610, charges: 110, createdAt: '2023-08-15' },
      { stockId: hdfcId, symbol: 'HDFCBANK', type: 'BUY', date: '2024-01-25', quantity: 40, price: 1440, charges: 75, createdAt: '2024-01-25' },
    ]);

    // TITAN
    await db.transactions.bulkAdd([
      { stockId: titanId, symbol: 'TITAN', type: 'BUY', date: '2023-06-10', quantity: 15, price: 2900, charges: 50, createdAt: '2023-06-10' },
      { stockId: titanId, symbol: 'TITAN', type: 'BUY', date: '2024-03-08', quantity: 10, price: 3600, charges: 45, createdAt: '2024-03-08' },
    ]);

    // TATAMOTORS
    await db.transactions.bulkAdd([
      { stockId: tataMotorsId, symbol: 'TATAMOTORS', type: 'BUY', date: '2023-03-05', quantity: 80, price: 430, charges: 45, createdAt: '2023-03-05' },
      { stockId: tataMotorsId, symbol: 'TATAMOTORS', type: 'BUY', date: '2023-09-12', quantity: 50, price: 620, charges: 35, createdAt: '2023-09-12' },
    ]);

    // 3. Prices (keeping multiple entries for history)
    await db.priceRecords.bulkAdd([
      // TCS
      { stockId: tcsId, symbol: 'TCS', price: 3950, date: '2024-09-15', createdAt: '2024-09-15' },
      { stockId: tcsId, symbol: 'TCS', price: 4120, date: new Date().toISOString().split('T')[0], createdAt: new Date().toISOString() },
      // RELIANCE
      { stockId: relId, symbol: 'RELIANCE', price: 2880, date: '2024-09-15', createdAt: '2024-09-15' },
      { stockId: relId, symbol: 'RELIANCE', price: 2740, date: new Date().toISOString().split('T')[0], createdAt: new Date().toISOString() },
      // HDFCBANK
      { stockId: hdfcId, symbol: 'HDFCBANK', price: 1650, date: '2024-09-15', createdAt: '2024-09-15' },
      { stockId: hdfcId, symbol: 'HDFCBANK', price: 1685, date: new Date().toISOString().split('T')[0], createdAt: new Date().toISOString() },
      // TITAN
      { stockId: titanId, symbol: 'TITAN', price: 3450, date: '2024-09-15', createdAt: '2024-09-15' },
      { stockId: titanId, symbol: 'TITAN', price: 3560, date: new Date().toISOString().split('T')[0], createdAt: new Date().toISOString() },
      // TATAMOTORS (older price for stale demonstration test)
      { stockId: tataMotorsId, symbol: 'TATAMOTORS', price: 920, date: '2024-08-01', createdAt: '2024-08-01' },
    ]);

    // 4. Fundamentals
    await db.fundamentals.bulkAdd([
      {
        stockId: tcsId,
        symbol: 'TCS',
        marketCapCr: 1485000,
        stockPE: 30.5,
        sectorPE: 28.2,
        roce: 58.2,
        roe: 48.5,
        debtToEquity: 0.05,
        dividendYield: 1.82,
        salesCagr10Y: 11.2,
        profitCagr10Y: 10.4,
        high52W: 4585,
        low52W: 3313,
        intrinsicValue: 4200,
        lastUpdated: new Date().toISOString().split('T')[0],
      },
      {
        stockId: relId,
        symbol: 'RELIANCE',
        marketCapCr: 1850000,
        stockPE: 26.8,
        sectorPE: 16.5,
        roce: 11.4,
        roe: 9.8,
        debtToEquity: 0.42,
        dividendYield: 0.36,
        salesCagr10Y: 13.5,
        profitCagr10Y: 12.1,
        high52W: 3217,
        low52W: 2220,
        intrinsicValue: 3000,
        lastUpdated: new Date().toISOString().split('T')[0],
      },
      {
        stockId: hdfcId,
        symbol: 'HDFCBANK',
        marketCapCr: 1280000,
        stockPE: 18.9,
        sectorPE: 16.2,
        roce: 16.8,
        roe: 15.5,
        debtToEquity: 0.85,
        dividendYield: 1.15,
        salesCagr10Y: 17.8,
        profitCagr10Y: 18.2,
        high52W: 1794,
        low52W: 1363,
        intrinsicValue: 1950,
        lastUpdated: new Date().toISOString().split('T')[0],
      },
      {
        stockId: titanId,
        symbol: 'TITAN',
        marketCapCr: 315000,
        stockPE: 84.5,
        sectorPE: 45.0,
        roce: 32.4,
        roe: 28.6,
        debtToEquity: 0.38,
        dividendYield: 0.31,
        salesCagr10Y: 19.5,
        profitCagr10Y: 20.8,
        high52W: 3886,
        low52W: 3055,
        intrinsicValue: 3100,
        lastUpdated: new Date().toISOString().split('T')[0],
      },
      {
        stockId: tataMotorsId,
        symbol: 'TATAMOTORS',
        marketCapCr: 340000,
        stockPE: 10.2,
        sectorPE: 24.1,
        roce: 21.5,
        roe: 25.1,
        debtToEquity: 0.65,
        dividendYield: 0.65,
        salesCagr10Y: 7.8,
        profitCagr10Y: 18.5,
        high52W: 1179,
        low52W: 630,
        intrinsicValue: 1050,
        lastUpdated: '2024-08-01',
      },
    ]);

    // 5. Dividends
    await db.dividendRecords.bulkAdd([
      {
        stockId: tcsId,
        symbol: 'TCS',
        date: '2023-07-20',
        amountPerShare: 24,
        sharesHeld: 25,
        tds: 60,
        note: 'Interim Dividend FY24',
        createdAt: '2023-07-20',
      },
      {
        stockId: tcsId,
        symbol: 'TCS',
        date: '2024-01-18',
        amountPerShare: 27,
        sharesHeld: 40,
        tds: 108,
        note: 'Special Dividend FY24',
        createdAt: '2024-01-18',
      },
      {
        stockId: relId,
        symbol: 'RELIANCE',
        date: '2023-08-21',
        amountPerShare: 9,
        sharesHeld: 40,
        tds: 36,
        note: 'Final Dividend FY23',
        createdAt: '2023-08-21',
      },
      {
        stockId: hdfcId,
        symbol: 'HDFCBANK',
        date: '2024-05-10',
        amountPerShare: 19.5,
        sharesHeld: 100,
        tds: 195,
        note: 'Dividend FY24',
        createdAt: '2024-05-10',
      },
    ]);

    // 6. Corporate Action: Reliance 1:1 Bonus Issue
    await db.corporateActions.bulkAdd([
      {
        stockId: relId,
        symbol: 'RELIANCE',
        type: 'BONUS',
        fromFactor: 1,
        toFactor: 2,
        exDate: '2024-10-28',
        note: '1:1 Bonus issue approved by AGM',
        createdAt: '2024-10-28',
      },
    ]);

    // 7. Benchmark Records: NIFTY 50 historical checkpoints
    await db.benchmarkRecords.bulkAdd([
      { name: 'NIFTY 50', date: '2023-04-03', level: 17398, createdAt: '2023-04-03' },
      { name: 'NIFTY 50', date: '2023-10-03', level: 19528, createdAt: '2023-10-03' },
      { name: 'NIFTY 50', date: '2024-04-01', level: 22462, createdAt: '2024-04-01' },
      { name: 'NIFTY 50', date: '2024-09-30', level: 25810, createdAt: '2024-09-30' },
      { name: 'NIFTY 50', date: '2025-01-02', level: 24150, createdAt: '2025-01-02' },
    ]);

    await getOrInitSettings();
  });
}
