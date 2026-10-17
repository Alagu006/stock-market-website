import type {
  Stock,
  Transaction,
  CorporateAction,
  PriceRecord,
  Fundamentals,
  CostMethod,
  HoldingCalculation,
  PortfolioKPIs,
  SectorAllocation,
  LotHistoryItem,
  DividendRecord,
  NSEChargesBreakdown,
} from '../types';
import { isDateOlderThanDays } from '../utils/formatters';

export interface AdjustedTransaction {
  id?: number;
  stockId: number;
  symbol: string;
  type: 'BUY' | 'SELL';
  date: string;
  originalQuantity: number;
  originalPrice: number;
  quantity: number; // Adjusted for corporate actions prior to ex-date
  price: number; // Adjusted for corporate actions prior to ex-date
  charges: number;
  effectivePricePerShare: number; // Including charges for BUY, deducting charges for SELL
  note?: string;
  createdAt?: string;
}

/**
 * Adjust transactions based on Corporate Actions (Splits and Bonuses).
 * Corporate actions are applied to transactions that occurred STRICTLY BEFORE the action's exDate.
 * Ratio: fromFactor -> toFactor.
 * e.g., Split 1:2 -> multiplier = 2 / 1 = 2.
 * Quantity is multiplied by multiplier, Price is divided by multiplier.
 */
export function adjustTransactionsForCorporateActions(
  transactions: Transaction[],
  corporateActions: CorporateAction[]
): AdjustedTransaction[] {
  // Sort actions chronologically by exDate
  const sortedActions = [...corporateActions].sort((a, b) => a.exDate.localeCompare(b.exDate));

  return transactions.map((tx) => {
    let adjQty = tx.quantity;
    let adjPrice = tx.price;

    for (const ca of sortedActions) {
      if (ca.stockId === tx.stockId && tx.date < ca.exDate) {
        if (ca.fromFactor > 0 && ca.toFactor > 0) {
          const multiplier = ca.toFactor / ca.fromFactor;
          adjQty = Math.round(adjQty * multiplier * 10000) / 10000;
          adjPrice = adjPrice / multiplier;
        }
      }
    }

    const charges = tx.totalCharges !== undefined ? tx.totalCharges : (tx.charges || 0);
    // For a BUY, charges increase the cost basis per share
    // For a SELL, charges decrease the net realization per share
    const effectivePricePerShare =
      tx.type === 'BUY'
        ? adjPrice + (adjQty > 0 ? charges / adjQty : 0)
        : adjPrice - (adjQty > 0 ? charges / adjQty : 0);

    return {
      id: tx.id,
      stockId: tx.stockId,
      symbol: tx.symbol,
      type: tx.type,
      date: tx.date,
      originalQuantity: tx.quantity,
      originalPrice: tx.price,
      quantity: adjQty,
      price: adjPrice,
      charges,
      effectivePricePerShare,
      note: tx.note,
      createdAt: tx.createdAt,
    };
  });
}

/**
 * Validates whether a proposed sell transaction is valid (cannot sell more than held on that date).
 */
export function validateSellQuantity(
  stockId: number,
  sellDate: string,
  sellQty: number,
  allTransactions: Transaction[],
  corporateActions: CorporateAction[]
): { isValid: boolean; maxAllowed: number; error?: string } {
  const adjusted = adjustTransactionsForCorporateActions(
    allTransactions.filter((tx) => tx.stockId === stockId),
    corporateActions
  );

  // Filter transactions up to and including the sellDate, sorted chronologically
  const sorted = adjusted
    .filter((tx) => tx.date <= sellDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  let currentHolding = 0;
  for (const tx of sorted) {
    if (tx.type === 'BUY') {
      currentHolding += tx.quantity;
    } else if (tx.type === 'SELL') {
      currentHolding -= tx.quantity;
    }
  }

  if (sellQty <= 0) {
    return { isValid: false, maxAllowed: Math.max(0, currentHolding), error: 'Quantity must be greater than zero.' };
  }

  if (sellQty > currentHolding) {
    return {
      isValid: false,
      maxAllowed: Math.max(0, currentHolding),
      error: `Cannot sell ${sellQty} shares. Maximum shares held on ${sellDate} is ${currentHolding}.`,
    };
  }

  return { isValid: true, maxAllowed: currentHolding };
}

/**
 * FIFO Lot Interface
 */
interface FIFOLot {
  txId?: number;
  date: string;
  originalQty: number;
  remainingQty: number;
  effectivePrice: number;
  charges: number;
}

/**
 * Calculates stock position, lot history, and realized P&L using either 'Average Cost' or 'FIFO'.
 */
export function calculateStockPosition(
  stockId: number,
  allTransactions: Transaction[],
  corporateActions: CorporateAction[],
  costMethod: CostMethod = 'Average Cost'
): {
  quantity: number;
  averageBuyPrice: number;
  totalCostBasis: number;
  realizedPnL: number;
  lotHistory: LotHistoryItem[];
  activeLotsCount: number;
} {
  const stockTxs = allTransactions.filter((t) => t.stockId === stockId);
  const adjustedTxs = adjustTransactionsForCorporateActions(stockTxs, corporateActions);

  // Sort chronologically by date; if same date, BUY precedes SELL
  const sorted = [...adjustedTxs].sort((a, b) => {
    const dComp = a.date.localeCompare(b.date);
    if (dComp !== 0) return dComp;
    if (a.type === b.type) return (a.id || 0) - (b.id || 0);
    return a.type === 'BUY' ? -1 : 1;
  });

  const originalTxMap = new Map<number, Transaction>();
  stockTxs.forEach((tx) => {
    if (tx.id !== undefined) originalTxMap.set(tx.id, tx);
  });

  let runningShares = 0;
  let runningRealizedPnL = 0;
  const lotHistory: LotHistoryItem[] = [];

  if (costMethod === 'Average Cost') {
    let runningAveragePrice = 0;

    for (const tx of sorted) {
      const orig = tx.id ? originalTxMap.get(tx.id) : undefined;
      const originalTx: Transaction = orig || {
        stockId: tx.stockId,
        symbol: tx.symbol,
        type: tx.type,
        date: tx.date,
        quantity: tx.originalQuantity,
        price: tx.originalPrice,
        charges: tx.charges,
        note: tx.note,
        createdAt: tx.createdAt || tx.date,
      };

      if (tx.type === 'BUY') {
        const totalOldCost = runningShares * runningAveragePrice;
        const totalNewCost = tx.quantity * tx.effectivePricePerShare;
        runningShares += tx.quantity;
        runningAveragePrice = runningShares > 0 ? (totalOldCost + totalNewCost) / runningShares : 0;

        lotHistory.push({
          transaction: originalTx,
          adjustedQuantity: tx.quantity,
          adjustedPrice: tx.price,
          runningShares,
          runningWeightedAvg: runningAveragePrice,
          remainingQuantity: tx.quantity,
        });
      } else {
        // SELL
        const sellRealized = tx.quantity * (tx.effectivePricePerShare - runningAveragePrice);
        runningRealizedPnL += sellRealized;
        runningShares = Math.max(0, runningShares - tx.quantity);

        lotHistory.push({
          transaction: originalTx,
          adjustedQuantity: tx.quantity,
          adjustedPrice: tx.price,
          runningShares,
          runningWeightedAvg: runningAveragePrice,
          realizedPnL: sellRealized,
        });
      }
    }

    const totalCostBasis = runningShares * runningAveragePrice;

    return {
      quantity: runningShares,
      averageBuyPrice: runningShares > 0 ? runningAveragePrice : 0,
      totalCostBasis,
      realizedPnL: runningRealizedPnL,
      lotHistory,
      activeLotsCount: runningShares > 0 ? 1 : 0,
    };
  } else {
    // FIFO Method
    const buyLots: FIFOLot[] = [];

    for (const tx of sorted) {
      const orig = tx.id ? originalTxMap.get(tx.id) : undefined;
      const originalTx: Transaction = orig || {
        stockId: tx.stockId,
        symbol: tx.symbol,
        type: tx.type,
        date: tx.date,
        quantity: tx.originalQuantity,
        price: tx.originalPrice,
        charges: tx.charges,
        note: tx.note,
        createdAt: tx.createdAt || tx.date,
      };

      if (tx.type === 'BUY') {
        buyLots.push({
          txId: tx.id,
          date: tx.date,
          originalQty: tx.quantity,
          remainingQty: tx.quantity,
          effectivePrice: tx.effectivePricePerShare,
          charges: tx.charges,
        });
        runningShares += tx.quantity;

        lotHistory.push({
          transaction: originalTx,
          adjustedQuantity: tx.quantity,
          adjustedPrice: tx.price,
          runningShares,
          remainingQuantity: tx.quantity,
        });
      } else {
        // SELL consumes FIFO lots
        let qtyToConsume = tx.quantity;
        let sellRealized = 0;
        const consumedLots: LotHistoryItem['consumedLots'] = [];

        for (const lot of buyLots) {
          if (qtyToConsume <= 0) break;
          if (lot.remainingQty <= 0) continue;

          const take = Math.min(lot.remainingQty, qtyToConsume);
          const pnlForLot = take * (tx.effectivePricePerShare - lot.effectivePrice);
          sellRealized += pnlForLot;
          lot.remainingQty -= take;
          qtyToConsume -= take;

          consumedLots.push({
            buyTxId: lot.txId,
            buyDate: lot.date,
            qtyTaken: take,
            buyPrice: lot.effectivePrice,
            realizedPnL: pnlForLot,
          });
        }

        runningRealizedPnL += sellRealized;
        runningShares = Math.max(0, runningShares - tx.quantity);

        lotHistory.push({
          transaction: originalTx,
          adjustedQuantity: tx.quantity,
          adjustedPrice: tx.price,
          runningShares,
          consumedLots,
          realizedPnL: sellRealized,
        });
      }
    }

    // Remaining cost basis under FIFO
    let remainingCostBasis = 0;
    let remainingShares = 0;
    let activeLotsCount = 0;

    for (const lot of buyLots) {
      if (lot.remainingQty > 0) {
        remainingCostBasis += lot.remainingQty * lot.effectivePrice;
        remainingShares += lot.remainingQty;
        activeLotsCount++;
      }
    }

    const fifoAveragePrice = remainingShares > 0 ? remainingCostBasis / remainingShares : 0;

    // Update remainingQuantity on BUY history items
    const remainingQtyByTxId = new Map<number | undefined, number>();
    buyLots.forEach((l) => {
      remainingQtyByTxId.set(l.txId, l.remainingQty);
    });

    lotHistory.forEach((item) => {
      if (item.transaction.type === 'BUY' && item.transaction.id !== undefined) {
        item.remainingQuantity = remainingQtyByTxId.get(item.transaction.id) ?? 0;
      }
    });

    return {
      quantity: remainingShares,
      averageBuyPrice: fifoAveragePrice,
      totalCostBasis: remainingCostBasis,
      realizedPnL: runningRealizedPnL,
      lotHistory,
      activeLotsCount,
    };
  }
}

/**
 * Calculates live 4-Card Preview when typing a BUY or SELL form entry.
 */
export function calculateLivePreview(
  stock: Stock,
  currentPrice: number,
  allTransactions: Transaction[],
  corporateActions: CorporateAction[],
  costMethod: CostMethod,
  pending: {
    type: 'BUY' | 'SELL';
    date: string;
    quantity: number;
    price: number;
    charges?: number;
  }
) {
  const currentPos = calculateStockPosition(stock.id!, allTransactions, corporateActions, costMethod);
  const qty = pending.quantity || 0;
  const price = pending.price || 0;
  const charges = pending.charges || 0;

  if (qty <= 0 || price <= 0) {
    return {
      existing: {
        shares: currentPos.quantity,
        averagePrice: currentPos.averageBuyPrice,
        invested: currentPos.totalCostBasis,
      },
      thisTx: {
        type: pending.type,
        shares: qty,
        price,
        charges,
        totalAmount: qty * price + charges,
      },
      postAverage: {
        newAveragePrice: currentPos.averageBuyPrice,
        diffVsOld: 0,
      },
      postPosition: {
        shares: currentPos.quantity,
        invested: currentPos.totalCostBasis,
        currentValue: currentPos.quantity * currentPrice,
        unrealizedPnL: currentPos.quantity * currentPrice - currentPos.totalCostBasis,
        unrealizedPnLPercent:
          currentPos.totalCostBasis > 0
            ? ((currentPos.quantity * currentPrice - currentPos.totalCostBasis) / currentPos.totalCostBasis) * 100
            : 0,
      },
      isValid: true,
    };
  }

  // Check validation for SELL
  let isValid = true;
  let validationError: string | undefined;

  if (pending.type === 'SELL') {
    const val = validateSellQuantity(stock.id!, pending.date, qty, allTransactions, corporateActions);
    if (!val.isValid) {
      isValid = false;
      validationError = val.error;
    }
  }

  // Create mock transaction
  const mockTx: Transaction = {
    stockId: stock.id!,
    symbol: stock.symbol,
    type: pending.type,
    date: pending.date,
    quantity: qty,
    price,
    charges,
    createdAt: new Date().toISOString(),
  };

  const simulatedTxs = [...allTransactions, mockTx];
  const postPos = calculateStockPosition(stock.id!, simulatedTxs, corporateActions, costMethod);

  const totalAmount = pending.type === 'BUY' ? qty * price + charges : qty * price - charges;
  const diffVsOld = postPos.averageBuyPrice - currentPos.averageBuyPrice;
  const postMarketValue = postPos.quantity * currentPrice;
  const postUnrealized = postMarketValue - postPos.totalCostBasis;
  const postUnrealizedPct = postPos.totalCostBasis > 0 ? (postUnrealized / postPos.totalCostBasis) * 100 : 0;

  return {
    existing: {
      shares: currentPos.quantity,
      averagePrice: currentPos.averageBuyPrice,
      invested: currentPos.totalCostBasis,
    },
    thisTx: {
      type: pending.type,
      shares: qty,
      price,
      charges,
      totalAmount,
    },
    postAverage: {
      newAveragePrice: postPos.averageBuyPrice,
      diffVsOld,
    },
    postPosition: {
      shares: postPos.quantity,
      invested: postPos.totalCostBasis,
      currentValue: postMarketValue,
      unrealizedPnL: postUnrealized,
      unrealizedPnLPercent: postUnrealizedPct,
    },
    isValid,
    validationError,
  };
}

/**
 * Reverse Target-Average ("Buy the Dip") Calculator:
 * exact shares = ceil(CurrentQty * (CurrentAvg - TargetAvg) / (TargetAvg - PlannedPrice))
 */
export function calculateReverseTargetAverage(
  currentQty: number,
  currentAvg: number,
  targetAvg: number,
  plannedPrice: number
): {
  isValid: boolean;
  requiredShares: number;
  capitalRequired: number;
  newAveragePrice: number;
  error?: string;
} {
  if (currentQty <= 0 || currentAvg <= 0) {
    return {
      isValid: false,
      requiredShares: 0,
      capitalRequired: 0,
      newAveragePrice: 0,
      error: 'Current holding quantity and average price must be greater than zero.',
    };
  }

  if (targetAvg >= currentAvg) {
    return {
      isValid: false,
      requiredShares: 0,
      capitalRequired: 0,
      newAveragePrice: 0,
      error: 'Target average price must be strictly lower than current average price.',
    };
  }

  if (plannedPrice >= targetAvg) {
    return {
      isValid: false,
      requiredShares: 0,
      capitalRequired: 0,
      newAveragePrice: 0,
      error: 'Planned buy price must be strictly lower than the desired target average price.',
    };
  }

  const denominator = targetAvg - plannedPrice;
  const numerator = currentQty * (currentAvg - targetAvg);
  const exactShares = Math.ceil(numerator / denominator);
  const capitalRequired = exactShares * plannedPrice;

  // Verify new actual average after buying exactShares at plannedPrice
  const totalShares = currentQty + exactShares;
  const totalCost = currentQty * currentAvg + capitalRequired;
  const newAveragePrice = totalShares > 0 ? totalCost / totalShares : 0;

  return {
    isValid: true,
    requiredShares: exactShares,
    capitalRequired,
    newAveragePrice,
  };
}

/**
 * Aggregate all active holdings, calculating P&L, ROCE, P/E, Dividend, Stale badge, etc.
 */
export function calculateAllHoldings(
  stocks: Stock[],
  transactions: Transaction[],
  corporateActions: CorporateAction[],
  priceRecords: PriceRecord[],
  fundamentalsList: Fundamentals[],
  costMethod: CostMethod = 'Average Cost'
): HoldingCalculation[] {
  // Map latest prices and previous price
  const priceMap = new Map<number, { latestPrice: number; latestDate: string; prevPrice?: number }>();

  // Sort prices chronologically
  const sortedPrices = [...priceRecords].sort((a, b) => {
    const dComp = a.date.localeCompare(b.date);
    if (dComp !== 0) return dComp;
    return (a.id || 0) - (b.id || 0);
  });

  for (const pr of sortedPrices) {
    const existing = priceMap.get(pr.stockId);
    if (!existing) {
      priceMap.set(pr.stockId, { latestPrice: pr.price, latestDate: pr.date });
    } else {
      priceMap.set(pr.stockId, {
        latestPrice: pr.price,
        latestDate: pr.date,
        prevPrice: existing.latestPrice,
      });
    }
  }

  // Fundamentals map
  const fundMap = new Map<number, Fundamentals>();
  fundamentalsList.forEach((f) => fundMap.set(f.stockId, f));

  const holdings: HoldingCalculation[] = [];

  for (const stock of stocks) {
    if (!stock.id) continue;
    const pos = calculateStockPosition(stock.id, transactions, corporateActions, costMethod);

    // We only display active holdings (quantity > 0) in the Holdings table
    if (pos.quantity <= 0) continue;

    const priceInfo = priceMap.get(stock.id);
    const currentPrice = priceInfo
      ? priceInfo.latestPrice
      : (stock.targetBuyPrice || stock.vwap || pos.averageBuyPrice);
    const lastPriceDate = priceInfo ? priceInfo.latestDate : null;
    const isPriceStale = !priceInfo || isDateOlderThanDays(lastPriceDate, 7);

    const currentValue = pos.quantity * currentPrice;
    const unrealizedPnL = currentValue - pos.totalCostBasis;
    const unrealizedPnLPercent = pos.totalCostBasis > 0 ? (unrealizedPnL / pos.totalCostBasis) * 100 : 0;

    const fund = fundMap.get(stock.id);
    const expectedDiv = stock.expectedDividendPerShare || 0;
    const annualDividendIncome = pos.quantity * expectedDiv;
    const yieldOnCost = pos.totalCostBasis > 0 ? (annualDividendIncome / pos.totalCostBasis) * 100 : 0;

    let priceChange: number | undefined;
    let priceChangePercent: number | undefined;
    if (priceInfo && priceInfo.prevPrice !== undefined && priceInfo.prevPrice > 0) {
      priceChange = currentPrice - priceInfo.prevPrice;
      priceChangePercent = ((currentPrice - priceInfo.prevPrice) / priceInfo.prevPrice) * 100;
    }

    holdings.push({
      stock,
      quantity: pos.quantity,
      averageBuyPrice: pos.averageBuyPrice,
      totalInvested: pos.totalCostBasis,
      currentPrice,
      lastPriceDate,
      isPriceStale,
      currentValue,
      unrealizedPnL,
      unrealizedPnLPercent,
      realizedPnL: pos.realizedPnL,
      annualDividendIncome,
      yieldOnCost,
      roce: fund?.roce ?? null,
      pe: fund?.stockPE ?? null,
      lotsCount: pos.activeLotsCount,
      previousPrice: priceInfo?.prevPrice,
      priceChange,
      priceChangePercent,
    });
  }

  // Sort by currentValue descending by default
  return holdings.sort((a, b) => b.currentValue - a.currentValue);
}

/**
 * Calculates Portfolio KPIs
 */
export function calculatePortfolioKPIs(
  holdings: HoldingCalculation[],
  stocks: Stock[],
  transactions: Transaction[],
  corporateActions: CorporateAction[],
  costMethod: CostMethod
): PortfolioKPIs {
  let totalInvested = 0;
  let currentValue = 0;
  let annualDividendIncome = 0;
  let dayChangeValue = 0;

  for (const h of holdings) {
    totalInvested += h.totalInvested;
    currentValue += h.currentValue;
    annualDividendIncome += h.annualDividendIncome;

    if (h.previousPrice !== undefined) {
      dayChangeValue += h.quantity * (h.currentPrice - h.previousPrice);
    }
  }

  const unrealizedPnL = currentValue - totalInvested;
  const unrealizedPnLPercent = totalInvested > 0 ? (unrealizedPnL / totalInvested) * 100 : 0;
  const dayChangePercent = currentValue > 0 && currentValue !== dayChangeValue ? (dayChangeValue / (currentValue - dayChangeValue)) * 100 : 0;
  const portfolioYieldOnCost = totalInvested > 0 ? (annualDividendIncome / totalInvested) * 100 : 0;

  // Realized P&L across ALL stocks (including closed positions)
  let totalRealizedPnL = 0;
  for (const stock of stocks) {
    if (!stock.id) continue;
    const pos = calculateStockPosition(stock.id, transactions, corporateActions, costMethod);
    totalRealizedPnL += pos.realizedPnL;
  }

  // Value-weighted ROCE
  let weightedRoceSum = 0;
  let valueForRoce = 0;
  for (const h of holdings) {
    if (h.roce !== null && h.roce !== undefined && !isNaN(h.roce)) {
      weightedRoceSum += h.roce * h.currentValue;
      valueForRoce += h.currentValue;
    }
  }
  const valueWeightedROCE = valueForRoce > 0 ? weightedRoceSum / valueForRoce : null;

  // Value-weighted P/E (Harmonic mean is standard for portfolio PE: Total Value / Sum(Value / PE))
  let peEarningsSum = 0;
  let valueForPE = 0;
  for (const h of holdings) {
    if (h.pe !== null && h.pe !== undefined && h.pe > 0) {
      peEarningsSum += h.currentValue / h.pe;
      valueForPE += h.currentValue;
    }
  }
  const valueWeightedPE = peEarningsSum > 0 ? valueForPE / peEarningsSum : null;

  return {
    totalInvested,
    currentValue,
    unrealizedPnL,
    unrealizedPnLPercent,
    realizedPnL: totalRealizedPnL,
    dayChangeValue,
    dayChangePercent,
    annualDividendIncome,
    portfolioYieldOnCost,
    valueWeightedROCE,
    valueWeightedPE,
  };
}

/**
 * Calculates sector breakdown and flags concentration above 35%
 */
export function calculateSectorAllocations(holdings: HoldingCalculation[]): SectorAllocation[] {
  const sectorMap = new Map<string, { invested: number; current: number }>();
  let totalCurrentVal = 0;

  for (const h of holdings) {
    const sec = h.stock.sector?.trim() || 'Others';
    const curr = sectorMap.get(sec) || { invested: 0, current: 0 };
    curr.invested += h.totalInvested;
    curr.current += h.currentValue;
    sectorMap.set(sec, curr);
    totalCurrentVal += h.currentValue;
  }

  const results: SectorAllocation[] = [];
  sectorMap.forEach((val, sector) => {
    const weightPercent = totalCurrentVal > 0 ? (val.current / totalCurrentVal) * 100 : 0;
    results.push({
      sector,
      investedValue: val.invested,
      currentValue: val.current,
      weightPercent,
      isConcentrated: weightPercent > 35,
    });
  });

  return results.sort((a, b) => b.currentValue - a.currentValue);
}

/**
 * XIRR (Extended Internal Rate of Return) calculation via Newton-Raphson method
 * Cashflow: { date: YYYY-MM-DD, amount: number }
 * Negative = outflow (buying), Positive = inflow (selling, dividends, or final portfolio terminal value)
 */
export function calculateXIRR(cashflows: Array<{ date: string; amount: number }>, guess: number = 0.1): number | null {
  if (cashflows.length < 2) return null;

  // Filter out zero amount flows
  const validFlows = cashflows.filter((cf) => Math.abs(cf.amount) > 0.001);
  const hasNegative = validFlows.some((cf) => cf.amount < 0);
  const hasPositive = validFlows.some((cf) => cf.amount > 0);
  if (!hasNegative || !hasPositive) return null;

  // Sort cashflows chronologically
  const sorted = [...validFlows].sort((a, b) => a.date.localeCompare(b.date));
  const t0 = new Date(sorted[0].date).getTime();

  const getYears = (dateStr: string) => {
    const t = new Date(dateStr).getTime();
    return (t - t0) / (1000 * 60 * 60 * 24 * 365);
  };

  const npv = (rate: number) => {
    return sorted.reduce((sum, cf) => {
      const years = getYears(cf.date);
      return sum + cf.amount / Math.pow(1 + rate, years);
    }, 0);
  };

  const derivativeNpv = (rate: number) => {
    return sorted.reduce((sum, cf) => {
      const years = getYears(cf.date);
      return sum - (years * cf.amount) / Math.pow(1 + rate, years + 1);
    }, 0);
  };

  let rate = guess;
  const maxIterations = 100;
  const tolerance = 1e-6;

  for (let i = 0; i < maxIterations; i++) {
    if (rate <= -1) rate = -0.9999;
    const value = npv(rate);
    const dVal = derivativeNpv(rate);

    if (Math.abs(dVal) < 1e-10) break;

    const nextRate = rate - value / dVal;
    if (Math.abs(nextRate - rate) < tolerance) {
      return nextRate * 100; // in %
    }
    rate = nextRate;
  }

  return isFinite(rate) ? rate * 100 : null;
}

/**
 * Tax Classification (STCG vs LTCG) - Always uses FIFO matching
 * STCG: Holding period <= 365 days (12 months or less)
 * LTCG: Holding period > 365 days
 */
export interface TaxSaleRecord {
  sellTxId?: number;
  symbol: string;
  sellDate: string;
  buyDate: string;
  quantity: number;
  sellPrice: number;
  buyPrice: number;
  holdingDays: number;
  gainOrLoss: number;
  term: 'STCG' | 'LTCG';
  financialYear: string;
}

export function classifyTaxLots(
  allTransactions: Transaction[],
  corporateActions: CorporateAction[]
): TaxSaleRecord[] {
  // Tax view ALWAYS uses FIFO
  const groupedByStock = new Map<number, Transaction[]>();
  allTransactions.forEach((tx) => {
    const arr = groupedByStock.get(tx.stockId) || [];
    arr.push(tx);
    groupedByStock.set(tx.stockId, arr);
  });

  const taxRecords: TaxSaleRecord[] = [];

  groupedByStock.forEach((txs) => {
    const adjusted = adjustTransactionsForCorporateActions(txs, corporateActions);
    const sorted = [...adjusted].sort((a, b) => {
      const dComp = a.date.localeCompare(b.date);
      if (dComp !== 0) return dComp;
      return a.type === 'BUY' ? -1 : 1;
    });

    const buyLots: FIFOLot[] = [];

    for (const tx of sorted) {
      if (tx.type === 'BUY') {
        buyLots.push({
          txId: tx.id,
          date: tx.date,
          originalQty: tx.quantity,
          remainingQty: tx.quantity,
          effectivePrice: tx.effectivePricePerShare,
          charges: tx.charges,
        });
      } else {
        // SELL
        let qtyToMatch = tx.quantity;
        const sellDate = new Date(tx.date);

        for (const lot of buyLots) {
          if (qtyToMatch <= 0) break;
          if (lot.remainingQty <= 0) continue;

          const taken = Math.min(lot.remainingQty, qtyToMatch);
          lot.remainingQty -= taken;
          qtyToMatch -= taken;

          const buyDate = new Date(lot.date);
          const diffMs = sellDate.getTime() - buyDate.getTime();
          const holdingDays = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));

          const term: 'STCG' | 'LTCG' = holdingDays <= 365 ? 'STCG' : 'LTCG';
          const gainOrLoss = taken * (tx.effectivePricePerShare - lot.effectivePrice);

          // Determine FY
          const month = sellDate.getMonth() + 1;
          const year = sellDate.getFullYear();
          const fy = month >= 4 ? `FY ${year}-${String(year + 1).slice(-2)}` : `FY ${year - 1}-${String(year).slice(-2)}`;

          taxRecords.push({
            sellTxId: tx.id,
            symbol: tx.symbol,
            sellDate: tx.date,
            buyDate: lot.date,
            quantity: taken,
            sellPrice: tx.effectivePricePerShare,
            buyPrice: lot.effectivePrice,
            holdingDays,
            gainOrLoss,
            term,
            financialYear: fy,
          });
        }
      }
    }
  });

  return taxRecords.sort((a, b) => b.sellDate.localeCompare(a.sellDate));
}

/**
 * Auto-generate Pros and Cons based on fundamental metrics
 */
export function generateProsAndCons(
  fund: Fundamentals | undefined,
  currentPrice: number,
  averageBuyPrice?: number
): { pros: string[]; cons: string[] } {
  const pros: string[] = [];
  const cons: string[] = [];

  if (!fund) {
    return { pros: ['Stock master active in portfolio'], cons: ['Fundamentals not yet imported'] };
  }

  // ROCE
  if (fund.roce !== undefined && fund.roce !== null) {
    if (fund.roce >= 25) {
      pros.push(`Exceptional capital efficiency with ROCE of ${fund.roce.toFixed(1)}%`);
    } else if (fund.roce >= 15) {
      pros.push(`Healthy ROCE of ${fund.roce.toFixed(1)}%`);
    } else if (fund.roce < 10) {
      cons.push(`Sub-par capital efficiency with ROCE of ${fund.roce.toFixed(1)}%`);
    }
  }

  // Debt to Equity
  if (fund.debtToEquity !== undefined && fund.debtToEquity !== null) {
    if (fund.debtToEquity <= 0.1) {
      pros.push(`Virtually debt-free balance sheet (D/E: ${fund.debtToEquity.toFixed(2)})`);
    } else if (fund.debtToEquity <= 0.5) {
      pros.push(`Conservative leverage with D/E of ${fund.debtToEquity.toFixed(2)}`);
    } else if (fund.debtToEquity > 1.0) {
      cons.push(`High financial leverage with Debt to Equity of ${fund.debtToEquity.toFixed(2)}`);
    }
  }

  // Growth CAGR
  if (fund.profitCagr10Y !== undefined && fund.profitCagr10Y >= 12) {
    pros.push(`Consistent long-term earnings growth (10Y Profit CAGR: ${fund.profitCagr10Y.toFixed(1)}%)`);
  } else if (fund.profitCagr10Y !== undefined && fund.profitCagr10Y < 6) {
    cons.push(`Sluggish 10-year profit CAGR of ${fund.profitCagr10Y.toFixed(1)}%`);
  }

  // Valuation vs Intrinsic Value
  if (fund.intrinsicValue && currentPrice > 0) {
    if (currentPrice < fund.intrinsicValue) {
      const discount = ((fund.intrinsicValue - currentPrice) / fund.intrinsicValue) * 100;
      pros.push(`Trading at a ${discount.toFixed(1)}% discount to estimated intrinsic value`);
    } else if (currentPrice > fund.intrinsicValue * 1.3) {
      const premium = ((currentPrice - fund.intrinsicValue) / fund.intrinsicValue) * 100;
      cons.push(`Trading at a ${premium.toFixed(1)}% premium over estimated intrinsic value`);
    }
  }

  // 52W Low Proximity
  if (fund.low52W && currentPrice > 0) {
    const fromLow = ((currentPrice - fund.low52W) / fund.low52W) * 100;
    if (fromLow <= 16) {
      pros.push(`Trading near 52-week low (${fromLow.toFixed(1)}% above bottom) - potential accumulation zone`);
    }
  }

  // Cost basis comparison
  if (averageBuyPrice && currentPrice > 0 && currentPrice < averageBuyPrice) {
    const dip = ((averageBuyPrice - currentPrice) / averageBuyPrice) * 100;
    pros.push(`Current price is ${dip.toFixed(1)}% below your average cost basis`);
  }

  // Default fallbacks if empty
  if (pros.length === 0) pros.push('Clean track record and sector presence');
  if (cons.length === 0) cons.push('Subject to broader industry cyclicality and macroeconomic risks');

  return { pros, cons };
}

/**
 * Passive Highlights (replacing intrusive popups/sounds)
 */
export interface PassiveHighlightBadge {
  id: string;
  label: string;
  color: 'emerald' | 'teal' | 'amber' | 'blue' | 'purple';
  description: string;
}

export function getPassiveHighlights(
  stock: Stock,
  currentPrice: number,
  averageBuyPrice: number,
  fund?: Fundamentals,
  lastPriceDate?: string | null
): PassiveHighlightBadge[] {
  const badges: PassiveHighlightBadge[] = [];

  // 1. Below My Average
  if (averageBuyPrice > 0 && currentPrice > 0 && currentPrice < averageBuyPrice) {
    badges.push({
      id: 'below-avg',
      label: 'Below Avg',
      color: 'emerald',
      description: `CMP ₹ ${currentPrice.toFixed(2)} is lower than your average ₹ ${averageBuyPrice.toFixed(2)}`,
    });
  }

  // 2. Near 52W Low (within 16%)
  if (fund?.low52W && currentPrice > 0) {
    const diffFromLow = ((currentPrice - fund.low52W) / fund.low52W) * 100;
    if (diffFromLow <= 16) {
      badges.push({
        id: 'near-52w-low',
        label: 'Near 52W Low',
        color: 'teal',
        description: `Within ${diffFromLow.toFixed(1)}% of 52-week low (₹ ${fund.low52W})`,
      });
    }
  }

  // 3. Below Intrinsic Value
  if (fund?.intrinsicValue && currentPrice > 0 && currentPrice < fund.intrinsicValue) {
    const discount = ((fund.intrinsicValue - currentPrice) / fund.intrinsicValue) * 100;
    badges.push({
      id: 'below-intrinsic',
      label: 'Below Intrinsic',
      color: 'blue',
      description: `${discount.toFixed(1)}% margin of safety below intrinsic value (₹ ${fund.intrinsicValue})`,
    });
  }

  // 4. In Buy Zone (Target Price)
  if (stock.targetBuyPrice && currentPrice > 0 && currentPrice <= stock.targetBuyPrice) {
    badges.push({
      id: 'in-buy-zone',
      label: 'In Buy Zone',
      color: 'purple',
      description: `CMP is below your target buy price of ₹ ${stock.targetBuyPrice}`,
    });
  }

  // 5. Stale Price (> 7 days)
  if (isDateOlderThanDays(lastPriceDate, 7)) {
    badges.push({
      id: 'stale-price',
      label: 'Stale Price',
      color: 'amber',
      description: 'Price entry is older than 7 days. Update price for fresh valuation.',
    });
  }

  return badges;
}

/**
 * Compound Annual Growth Rate (CAGR)
 */
export function calculateCAGR(startValue: number, endValue: number, years: number): number | null {
  if (startValue <= 0 || endValue <= 0 || years <= 0) return null;
  const cagr = Math.pow(endValue / startValue, 1 / years) - 1;
  return cagr * 100;
}

/**
 * Calculate per-stock XIRR from buy, sell, dividend cashflows and terminal value
 */
export function calculateStockXIRR(
  stockId: number,
  transactions: Transaction[],
  currentHoldingQty: number,
  currentPrice: number,
  dividends: DividendRecord[]
): number | null {
  const stockTxs = transactions.filter((t) => t.stockId === stockId);
  const stockDivs = dividends.filter((d) => d.stockId === stockId);

  const cashflows: Array<{ date: string; amount: number }> = [];

  for (const t of stockTxs) {
    if (t.type === 'BUY') {
      cashflows.push({ date: t.date, amount: -(t.quantity * t.price + (t.charges || 0)) });
    } else {
      cashflows.push({ date: t.date, amount: +(t.quantity * t.price - (t.charges || 0)) });
    }
  }

  for (const d of stockDivs) {
    const netDiv = d.amountPerShare * d.sharesHeld - (d.tds || 0);
    cashflows.push({ date: d.date, amount: +netDiv });
  }

  // Terminal value at current date if still holding shares
  if (currentHoldingQty > 0 && currentPrice > 0) {
    cashflows.push({
      date: new Date().toISOString().split('T')[0],
      amount: +(currentHoldingQty * currentPrice),
    });
  }

  return calculateXIRR(cashflows);
}

/**
 * Calculate overall portfolio XIRR
 */
export function calculatePortfolioXIRR(
  transactions: Transaction[],
  holdings: HoldingCalculation[],
  dividends: DividendRecord[]
): number | null {
  const cashflows: Array<{ date: string; amount: number }> = [];

  for (const t of transactions) {
    if (t.type === 'BUY') {
      cashflows.push({ date: t.date, amount: -(t.quantity * t.price + (t.charges || 0)) });
    } else {
      cashflows.push({ date: t.date, amount: +(t.quantity * t.price - (t.charges || 0)) });
    }
  }

  for (const d of dividends) {
    const netDiv = d.amountPerShare * d.sharesHeld - (d.tds || 0);
    cashflows.push({ date: d.date, amount: +netDiv });
  }

  let totalTerminalValue = 0;
  for (const h of holdings) {
    totalTerminalValue += h.currentValue;
  }

  if (totalTerminalValue > 0) {
    cashflows.push({
      date: new Date().toISOString().split('T')[0],
      amount: +totalTerminalValue,
    });
  }

  return calculateXIRR(cashflows);
}

/**
 * Group realized P&L and compute taxes by Financial Year (April - March)
 */
export interface FYTaxSummary {
  financialYear: string;
  totalRealizedPnL: number;
  stcgGain: number;
  ltcgGain: number;
  ltcgExemptionApplied: number;
  taxableLtcg: number;
  stcgTax: number;
  ltcgTax: number;
  totalTax: number;
  transactionsCount: number;
}

export function calculateTaxSummaryByFY(
  taxRecords: TaxSaleRecord[],
  stcgRate: number = 20,
  ltcgRate: number = 12.5,
  ltcgExemption: number = 125000
): FYTaxSummary[] {
  const map = new Map<string, { stcg: number; ltcg: number; count: number }>();

  for (const r of taxRecords) {
    const curr = map.get(r.financialYear) || { stcg: 0, ltcg: 0, count: 0 };
    if (r.term === 'STCG') {
      curr.stcg += r.gainOrLoss;
    } else {
      curr.ltcg += r.gainOrLoss;
    }
    curr.count++;
    map.set(r.financialYear, curr);
  }

  const summaries: FYTaxSummary[] = [];

  map.forEach((val, fy) => {
    const totalRealizedPnL = val.stcg + val.ltcg;
    const ltcgExemptionApplied = val.ltcg > 0 ? Math.min(val.ltcg, ltcgExemption) : 0;
    const taxableLtcg = Math.max(0, val.ltcg - ltcgExemptionApplied);

    const stcgTax = val.stcg > 0 ? (val.stcg * stcgRate) / 100 : 0;
    const ltcgTax = taxableLtcg > 0 ? (taxableLtcg * ltcgRate) / 100 : 0;
    const totalTax = stcgTax + ltcgTax;

    summaries.push({
      financialYear: fy,
      totalRealizedPnL,
      stcgGain: val.stcg,
      ltcgGain: val.ltcg,
      ltcgExemptionApplied,
      taxableLtcg,
      stcgTax,
      ltcgTax,
      totalTax,
      transactionsCount: val.count,
    });
  });

  return summaries.sort((a, b) => b.financialYear.localeCompare(a.financialYear));
}

/**
 * SIP + Lump Sum + DRIP Multi-Year Simulator
 */
export interface SimulatorYearBreakdown {
  year: number;
  investedCapital: number;
  corpusWithoutDrip: number;
  corpusWithDrip: number;
  estimatedDividendsEarned: number;
  wealthMultipleWithoutDrip: number;
  wealthMultipleWithDrip: number;
}

export function simulateSIPAndLumpSum(params: {
  horizonYears: number;
  monthlySIP: number;
  lumpSum: number;
  expectedCagrPercent: number;
  dividendReinvestment: boolean;
  estimatedDividendYieldPercent?: number;
}): {
  yearBreakdown: SimulatorYearBreakdown[];
  finalInvested: number;
  finalCorpus: number;
  totalWealthGain: number;
  wealthMultiple: number;
} {
  const {
    horizonYears,
    monthlySIP,
    lumpSum,
    expectedCagrPercent,
    dividendReinvestment,
    estimatedDividendYieldPercent = 1.2,
  } = params;

  const rCapital = expectedCagrPercent / 100;
  const rDiv = (estimatedDividendYieldPercent || 0) / 100;
  const annualSIP = monthlySIP * 12;

  const yearBreakdown: SimulatorYearBreakdown[] = [];
  let corpusNoDrip = lumpSum;
  let corpusWithDrip = lumpSum;
  let cumInvested = lumpSum;

  for (let yr = 1; yr <= horizonYears; yr++) {
    cumInvested += annualSIP;

    // Growth without DRIP
    corpusNoDrip = (corpusNoDrip + annualSIP) * (1 + rCapital);

    // Growth with DRIP (Capital CAGR + Reinvested Dividend)
    const effectiveTotalGrowth = dividendReinvestment ? rCapital + rDiv : rCapital;
    corpusWithDrip = (corpusWithDrip + annualSIP) * (1 + effectiveTotalGrowth);

    const estimatedDividendsEarned = corpusWithDrip * rDiv;

    yearBreakdown.push({
      year: yr,
      investedCapital: cumInvested,
      corpusWithoutDrip: Math.round(corpusNoDrip),
      corpusWithDrip: Math.round(corpusWithDrip),
      estimatedDividendsEarned: Math.round(estimatedDividendsEarned),
      wealthMultipleWithoutDrip: cumInvested > 0 ? Number((corpusNoDrip / cumInvested).toFixed(2)) : 1,
      wealthMultipleWithDrip: cumInvested > 0 ? Number((corpusWithDrip / cumInvested).toFixed(2)) : 1,
    });
  }

  const finalCorpus = dividendReinvestment
    ? yearBreakdown[yearBreakdown.length - 1]?.corpusWithDrip || 0
    : yearBreakdown[yearBreakdown.length - 1]?.corpusWithoutDrip || 0;

  const finalInvested = cumInvested;
  const totalWealthGain = Math.max(0, finalCorpus - finalInvested);
  const wealthMultiple = finalInvested > 0 ? Number((finalCorpus / finalInvested).toFixed(2)) : 1;

  return {
    yearBreakdown,
    finalInvested,
    finalCorpus,
    totalWealthGain,
    wealthMultiple,
  };
}

/**
 * Task 5: Auto-calculate NSE Brokerage & Statutory Charges
 * Standard NSE Delivery:
 * - Brokerage: 0.5% (0.005)
 * - STT: 0.1% (0.001) on Buy and Sell delivery
 * - NSE Exchange Transaction Charge: 0.00297%
 * - SEBI Turnover Fee: 0.0001%
 * - Stamp Duty: 0.015% on Buy, 0% on Sell
 * - GST: 18% on (Brokerage + Exchange Charges + SEBI Fee)
 */
export function calculateNSECharges(
  type: 'BUY' | 'SELL',
  quantity: number,
  price: number
): NSEChargesBreakdown {
  const turnover = Math.round(quantity * price * 100) / 100;
  if (turnover <= 0 || isNaN(turnover)) {
    return {
      turnover: 0,
      brokerage: 0,
      stt: 0,
      exchangeCharges: 0,
      sebiFee: 0,
      stampDuty: 0,
      gst: 0,
      totalCharges: 0,
      netTotal: 0,
    };
  }

  // Brokerage: 0.5% (0.005)
  const brokerage = Math.round(turnover * 0.005 * 100) / 100;

  // STT: 0.1% (0.001) on Buy & Sell delivery
  const stt = Math.round(turnover * 0.001 * 100) / 100;

  // NSE Exchange Transaction Charge: 0.00297% (0.0000297)
  const exchangeCharges = Math.round(turnover * 0.0000297 * 100) / 100;

  // SEBI Turnover Fee: 0.0001% (0.000001)
  const sebiFee = Math.round(turnover * 0.000001 * 100) / 100;

  // Stamp Duty: 0.015% (0.00015) on Buy transactions, 0% on Sell
  const stampDuty = type === 'BUY' ? Math.round(turnover * 0.00015 * 100) / 100 : 0;

  // GST: 18% on (Brokerage + NSE Exchange Transaction Charge + SEBI Fee)
  const gstBase = brokerage + exchangeCharges + sebiFee;
  const gst = Math.round(gstBase * 0.18 * 100) / 100;

  // Total Charges
  const totalCharges =
    Math.round((brokerage + stt + exchangeCharges + sebiFee + stampDuty + gst) * 100) / 100;

  // Net Total Payable (Buy) or Receivable (Sell)
  const netTotal =
    type === 'BUY'
      ? Math.round((turnover + totalCharges) * 100) / 100
      : Math.round((turnover - totalCharges) * 100) / 100;

  return {
    turnover,
    brokerage,
    stt,
    exchangeCharges,
    sebiFee,
    stampDuty,
    gst,
    totalCharges,
    netTotal,
  };
}

/**
 * Task 1: Parse BSE ROE / PB string (e.g., "25.99/4.52")
 */
export function parseBseRoePb(roePbStr?: string): { roe?: number; pbRatio?: number } {
  if (!roePbStr || typeof roePbStr !== 'string') return {};
  const cleaned = roePbStr.replace(/%/g, '').trim();
  const parts = cleaned.split('/').map((s) => s.trim());
  const roe = parts[0] && !isNaN(Number(parts[0])) ? Number(parts[0]) : undefined;
  const pbRatio = parts[1] && !isNaN(Number(parts[1])) ? Number(parts[1]) : undefined;
  return { roe, pbRatio };
}

/**
 * Task 1: Parse BSE EPS string (e.g., "15.13/16.11" Standalone/Consolidated)
 */
export function parseBseEps(epsStr?: string): {
  standalone?: number;
  consolidated?: number;
  primaryEps?: number;
} {
  if (!epsStr || typeof epsStr !== 'string') return {};
  const parts = epsStr.split('/').map((s) => s.trim());
  const standalone = parts[0] && !isNaN(Number(parts[0])) ? Number(parts[0]) : undefined;
  const consolidated = parts[1] && !isNaN(Number(parts[1])) ? Number(parts[1]) : undefined;
  const primaryEps = consolidated !== undefined ? consolidated : standalone;
  return { standalone, consolidated, primaryEps };
}

/**
 * Task 1: Calculate Intrinsic Value (Fair)
 * Formula: Graham Number = sqrt(22.5 * EPS * BookValue)
 * If BookValue not explicitly provided, BookValue = Current Price / PB
 */
export function calculateIntrinsicValue(
  eps?: number,
  bookValue?: number,
  expectedGrowthRate?: number
): number | undefined {
  if (!eps || eps <= 0) return undefined;

  if (bookValue && bookValue > 0) {
    const val = Math.sqrt(22.5 * eps * bookValue);
    return Math.round(val * 100) / 100;
  }

  // Fallback: EPS-growth formula = EPS * (8.5 + 2 * g)
  if (expectedGrowthRate !== undefined && expectedGrowthRate > 0) {
    const g = Math.min(25, expectedGrowthRate);
    const val = eps * (8.5 + 2 * g);
    return Math.round(val * 100) / 100;
  }

  return undefined;
}

/**
 * Task 1: Calculate Margin of Safety (%)
 * Formula: ((Intrinsic Value - Current Price) / Intrinsic Value) * 100
 */
export function calculateMarginOfSafety(
  intrinsicValue?: number,
  currentPrice?: number
): number | undefined {
  if (!intrinsicValue || !currentPrice || intrinsicValue <= 0 || currentPrice <= 0) {
    return undefined;
  }
  const mos = ((intrinsicValue - currentPrice) / intrinsicValue) * 100;
  return Math.round(mos * 100) / 100;
}

/**
 * Task 6: Stock-Specific Long-Term Compounding Simulation
 */
export interface StockCompoundingYearRow {
  year: number;
  startingShares: number;
  purchasedShares: number;
  reinvestedShares: number;
  endingShares: number;
  sharePrice: number;
  investedThisYear: number;
  cumulativeInvested: number;
  brokerageAndChargesPaid: number;
  dividendsEarned: number;
  corpusValue: number;
  wealthGain: number;
}

export interface StockCompoundingResult {
  yearBreakdown: StockCompoundingYearRow[];
  finalShares: number;
  finalInvested: number;
  finalCorpus: number;
  totalDividends: number;
  totalCharges: number;
  wealthGain: number;
  cagr: number;
}

export function simulateStockCompounding(params: {
  mode: 'lumpSum' | 'accumulation';
  initialShares?: number;
  initialCapital?: number;
  initialPrice: number;
  expectedCagrPct: number; // Stock price CAGR %
  dividendYieldPct: number; // Dividend yield %
  drip: boolean; // Reinvest dividends into shares
  horizonYears: number;
  // Accumulation params:
  accumulationType?: 'shares' | 'amount';
  periodicShares?: number;
  periodicAmount?: number;
  frequencyPerYear?: number; // 12 for monthly, 4 for quarterly, 1 for annual
}): StockCompoundingResult {
  const {
    mode,
    initialPrice,
    expectedCagrPct,
    dividendYieldPct,
    drip,
    horizonYears,
    accumulationType = 'amount',
    periodicShares = 0,
    periodicAmount = 0,
    frequencyPerYear = 12,
  } = params;

  const rPrice = Math.max(-0.5, expectedCagrPct / 100);
  const rDiv = Math.max(0, dividendYieldPct / 100);

  // Initial purchase
  let startingShares = 0;
  let initialTurnover = 0;
  if (mode === 'lumpSum') {
    if (params.initialShares && params.initialShares > 0) {
      startingShares = params.initialShares;
      initialTurnover = startingShares * initialPrice;
    } else if (params.initialCapital && params.initialCapital > 0) {
      initialTurnover = params.initialCapital;
      startingShares = Math.floor(initialTurnover / initialPrice);
    }
  } else {
    // Accumulation starting shares
    if (params.initialShares && params.initialShares > 0) {
      startingShares = params.initialShares;
      initialTurnover = startingShares * initialPrice;
    }
  }

  const initialCharges =
    initialTurnover > 0 ? calculateNSECharges('BUY', startingShares, initialPrice).totalCharges : 0;
  let cumInvested = initialTurnover + initialCharges;
  let cumCharges = initialCharges;
  let cumDividends = 0;

  let currentShares = startingShares;
  let currentPrice = initialPrice;

  const yearBreakdown: StockCompoundingYearRow[] = [];

  for (let yr = 1; yr <= horizonYears; yr++) {
    const yearStartShares = currentShares;
    let yearPurchasedShares = 0;
    let yearInvestedCash = 0;
    let yearCharges = 0;

    // Price appreciates over the year
    const endOfYearPrice = Math.round(currentPrice * (1 + rPrice) * 100) / 100;
    // Average price during the year for periodic buys
    const avgYearPrice = Math.round(((currentPrice + endOfYearPrice) / 2) * 100) / 100;

    if (mode === 'accumulation') {
      const times = Math.max(1, frequencyPerYear);
      for (let f = 0; f < times; f++) {
        let buyQty = 0;
        let buyTurnover = 0;

        if (accumulationType === 'shares') {
          buyQty = Math.max(0, periodicShares);
          buyTurnover = buyQty * avgYearPrice;
        } else {
          const perBuyAmt = Math.max(0, periodicAmount);
          buyQty = avgYearPrice > 0 ? Math.floor(perBuyAmt / avgYearPrice) : 0;
          buyTurnover = buyQty * avgYearPrice;
        }

        if (buyQty > 0) {
          const chg = calculateNSECharges('BUY', buyQty, avgYearPrice).totalCharges;
          yearPurchasedShares += buyQty;
          yearInvestedCash += buyTurnover + chg;
          yearCharges += chg;
        }
      }
    }

    currentShares += yearPurchasedShares;
    cumInvested += yearInvestedCash;
    cumCharges += yearCharges;

    // Dividend payout based on year-end price or average
    const dividendPerShare = endOfYearPrice * rDiv;
    const yearDividends = Math.round(currentShares * dividendPerShare * 100) / 100;
    cumDividends += yearDividends;

    let yearReinvestedShares = 0;
    if (drip && yearDividends > 0 && endOfYearPrice > 0) {
      // Reinvest dividends into shares
      yearReinvestedShares = Math.floor(yearDividends / endOfYearPrice);
      currentShares += yearReinvestedShares;
    }

    const corpusValue = Math.round(currentShares * endOfYearPrice * 100) / 100;
    const wealthGain = Math.round((corpusValue - cumInvested) * 100) / 100;

    yearBreakdown.push({
      year: yr,
      startingShares: yearStartShares,
      purchasedShares: yearPurchasedShares,
      reinvestedShares: yearReinvestedShares,
      endingShares: currentShares,
      sharePrice: endOfYearPrice,
      investedThisYear: Math.round(yearInvestedCash * 100) / 100,
      cumulativeInvested: Math.round(cumInvested * 100) / 100,
      brokerageAndChargesPaid: Math.round(yearCharges * 100) / 100,
      dividendsEarned: yearDividends,
      corpusValue,
      wealthGain,
    });

    currentPrice = endOfYearPrice;
  }

  const finalShares = currentShares;
  const finalInvested = Math.round(cumInvested * 100) / 100;
  const finalCorpus = yearBreakdown[yearBreakdown.length - 1]?.corpusValue || 0;
  const wealthGain = Math.round((finalCorpus - finalInvested) * 100) / 100;

  // Effective CAGR
  let cagr = 0;
  if (finalInvested > 0 && horizonYears > 0) {
    cagr = Math.round((Math.pow(finalCorpus / finalInvested, 1 / horizonYears) - 1) * 10000) / 100;
  }

  return {
    yearBreakdown,
    finalShares,
    finalInvested,
    finalCorpus,
    totalDividends: Math.round(cumDividends * 100) / 100,
    totalCharges: Math.round(cumCharges * 100) / 100,
    wealthGain,
    cagr,
  };
}

