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
  lastUpdated: string;
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
