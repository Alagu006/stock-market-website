export type CostMethod = 'Average Cost' | 'FIFO';

export type TransactionType = 'BUY' | 'SELL';

export type CorporateActionType = 'SPLIT' | 'BONUS';

export type MarketCapCategory = 'Large Cap' | 'Mid Cap' | 'Small Cap' | 'Micro Cap';

export interface Stock {
  id?: number;
  symbol: string; // NSE Symbol (e.g., RELIANCE, TCS)
  bseCode: string; // 6-digit BSE security code (e.g., 500325)
  name: string; // Company Name
  sector: string; // Sector (e.g., IT, Banking, FMCG, Pharma)
  marketCapCategory: MarketCapCategory;
  isin?: string; // Optional ISIN (e.g., INE002A01018)
  expectedDividendPerShare?: number; // Optional expected dividend per share for projections
  watchlist?: boolean;
  targetBuyPrice?: number;
  thesisNote?: string;
  // Extra BSE & Fundamental fields
  sectorPe?: number;
  vwap?: number;
  epsStandalone?: number;
  epsConsolidated?: number;
  cepsStandalone?: number;
  cepsConsolidated?: number;
  peStandalone?: number;
  peConsolidated?: number;
  upperPriceBand?: number;
  lowerPriceBand?: number;
  priceBand?: string;
  ttqLakh?: number;
  turnoverCr?: number;
  twoWeekAvgQtyLakh?: number;
  mcapFullCr?: number;
  mcapFfCr?: number;
  faceValue?: number;
  bseCategory?: string;
  bseGroup?: string;
  bseIndex?: string;
  basicIndustry?: string;
  latestDividendAmount?: number;
  latestDividendExDate?: string;
  stockedgeId?: string;
  roe?: number;
  pb?: number;
  roce?: number;
  debtToEquity?: number;
  evToEbitda?: number;
  salesCagr10Y?: number;
  profitCagr10Y?: number;
  dividendYield?: number;
  intrinsicValue?: number;
  marginOfSafety?: number;
  marketCapCr?: number;
  // Real-time market feed fields
  currentPrice?: number;
  previousClose?: number;
  dayChange?: number;
  dayChangePercent?: number;
  dayHigh?: number;
  dayLow?: number;
  high52W?: number;
  low52W?: number;
  lastPriceUpdate?: string;
  priceSource?: 'live' | 'manual';
  fieldSources?: Record<string, 'manual' | 'screener' | 'feed'>;
  createdAt: string; // ISO date string
}

export interface Transaction {
  id?: number;
  stockId: number; // Foreign key to Stock
  symbol: string; // Denormalized for convenience
  type: TransactionType;
  date: string; // YYYY-MM-DD
  quantity: number;
  price: number; // Purchase / Sale price per share
  charges?: number; // Brokerage, STT, exchange charges, etc.
  brokerage?: number;
  sttAndCharges?: number;
  totalCharges?: number;
  netAmount?: number;
  note?: string;
  createdAt: string;
}

export interface PriceRecord {
  id?: number;
  stockId: number;
  symbol: string;
  price: number;
  date: string; // YYYY-MM-DD date entered or effective
  createdAt: string;
}

export interface CorporateAction {
  id?: number;
  stockId: number;
  symbol: string;
  type: CorporateActionType;
  // For SPLIT 1:2 (1 share into 2 shares) -> fromFactor: 1, toFactor: 2 (multiplies shares by 2, divides price by 2)
  // For BONUS 1:1 (1 bonus for 1 held, total 2) -> fromFactor: 1, toFactor: 2 (multiplies shares by 2)
  fromFactor: number;
  toFactor: number;
  exDate: string; // YYYY-MM-DD
  note?: string;
  createdAt: string;
}

export interface DividendRecord {
  id?: number;
  stockId: number;
  symbol: string;
  date: string; // YYYY-MM-DD
  amountPerShare: number;
  sharesHeld: number;
  tds?: number; // Tax Deducted at Source
  note?: string;
  createdAt: string;
}

export interface Fundamentals {
  id?: number;
  stockId: number;
  symbol: string;
  marketCapCr?: number; // Market cap in Crore
  stockPE?: number;
  sectorPE?: number;
  roce?: number; // %
  roe?: number; // %
  debtToEquity?: number;
  evToEbitda?: number;
  pbRatio?: number;
  dividendYield?: number; // %
  salesCagr10Y?: number; // %
  profitCagr10Y?: number; // %
  high52W?: number;
  low52W?: number;
  intrinsicValue?: number;
  marginOfSafety?: number;
  // BSE Specific Exchange Details
  vwap?: number;
  eps?: number;
  epsStandalone?: number;
  epsConsolidated?: number;
  ceps?: number;
  mcapFFCr?: number;
  avgQty2WLakh?: number;
  faceValue?: number;
  basicIndustry?: string;
  upperBand?: number;
  lowerBand?: number;
  bseIndex?: string;
  // Up to 5 years financial history
  financials5Y?: Array<{
    year: string;
    revenueCr: number;
    netProfitCr: number;
  }>;
  // Shareholding pattern (%)
  shareholding?: {
    promoter: number;
    fii: number;
    dii: number;
    public: number;
  };
  feedSourceTags?: Record<string, string>;
  lastUpdated: string;
}

export interface NSEChargesBreakdown {
  turnover: number;
  brokerage: number; // 0.5%
  stt: number; // 0.1% Buy and Sell delivery
  exchangeCharges: number; // 0.00297%
  sebiFee: number; // 0.0001%
  stampDuty: number; // 0.015% on Buy, 0% on Sell
  gst: number; // 18% on (Brokerage + Exchange Charges + SEBI Fee)
  totalCharges: number;
  netTotal: number;
}

export interface StockEdgeNewsItem {
  date: string;
  time: string;
  category: string;
  headline: string;
  url?: string;
}

export interface StockEdgeNewsResponse {
  symbol: string;
  lastUpdated: string;
  items: StockEdgeNewsItem[];
}

export interface LiveQuote {
  symbol: string;
  shortName: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  dayHigh?: number | null;
  dayLow?: number | null;
  high52W?: number | null;
  low52W?: number | null;
  pe?: number | null;
  forwardPE?: number | null;
  dividendYield?: number | null;
  latestDividend?: { amount: number; date: string } | null;
  marketCap?: number | null;
  currency?: string;
  bseData?: {
    vwap?: number;
    epsStandalone?: number;
    epsConsolidated?: number;
    ceps?: number;
    mcapFFCr?: number;
    avgQty2WLakh?: number;
    faceValue?: number;
    basicIndustry?: string;
    upperBand?: number;
    lowerBand?: number;
    index?: string;
  };
  timestamp: string;
}

export interface IndexItem {
  name: string;
  symbol: string;
  level: number;
  previousClose: number;
  change: number;
  changePercent: number;
  dayHigh?: number;
  dayLow?: number;
}

export interface MarketIndicesData {
  nifty50: IndexItem;
  sensex: IndexItem;
  niftyBank: IndexItem;
  timestamp: string;
}

export interface CorporateEventData {
  symbol: string;
  targetSymbol: string;
  dividends: Array<{ date: string; amount: number }>;
  splits: Array<{ date: string; numerator: number; denominator: number; splitRatio: string }>;
  timestamp: string;
}

export interface BenchmarkRecord {
  id?: number;
  name: string; // e.g., 'NIFTY 50'
  date: string; // YYYY-MM-DD
  level: number;
  createdAt: string;
}

export interface AppSettings {
  id?: number;
  costMethod: CostMethod;
  stcgRate: number; // default 20%
  ltcgRate: number; // default 12.5%
  ltcgExemption: number; // default 1,25,000
  lastBackupDate?: string;
  savedScreenerMapping?: Record<string, string>;
  activeExchange?: 'NSE' | 'BSE';
  refreshMode?: 'Manual' | 'Auto 15s' | 'Auto 30s' | 'Off';
}

export interface ImportPreviewRow<T> {
  rowIndex: number;
  data: Partial<T>;
  rawRow: Record<string, any>;
  errors: string[];
  warnings: string[];
  isValid: boolean;
}

// Derived Holding structure computed on the fly
export interface HoldingCalculation {
  stock: Stock;
  quantity: number;
  averageBuyPrice: number;
  totalInvested: number;
  currentPrice: number;
  lastPriceDate: string | null;
  isPriceStale: boolean; // > 7 days old
  currentValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  realizedPnL: number;
  annualDividendIncome: number;
  yieldOnCost: number;
  roce: number | null;
  pe: number | null;
  lotsCount: number;
  previousPrice?: number;
  priceChange?: number;
  priceChangePercent?: number;
  isLive?: boolean;
  dayHigh?: number;
  dayLow?: number;
  high52W?: number;
  low52W?: number;
}

// Lot breakdown for Lot History modal
export interface LotHistoryItem {
  transaction: Transaction;
  adjustedQuantity: number;
  adjustedPrice: number;
  runningShares: number;
  // Average Cost Method fields
  runningWeightedAvg?: number;
  // FIFO Method fields
  consumedLots?: Array<{
    buyTxId?: number;
    buyDate: string;
    qtyTaken: number;
    buyPrice: number;
    realizedPnL: number;
  }>;
  remainingQuantity?: number;
  realizedPnL?: number;
}

export interface PortfolioKPIs {
  totalInvested: number;
  currentValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  realizedPnL: number;
  dayChangeValue: number;
  dayChangePercent: number;
  annualDividendIncome: number;
  portfolioYieldOnCost: number;
  valueWeightedROCE: number | null;
  valueWeightedPE: number | null;
}

export interface SectorAllocation {
  sector: string;
  investedValue: number;
  currentValue: number;
  weightPercent: number;
  isConcentrated: boolean; // > 35%
}
