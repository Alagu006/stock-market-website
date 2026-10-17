import { describe, it, expect } from 'vitest';
import {
  calculateStockPosition,
  adjustTransactionsForCorporateActions,
  validateSellQuantity,
  calculateReverseTargetAverage,
  calculateXIRR,
  classifyTaxLots,
} from './calculations';
import type { Transaction, CorporateAction } from '../types';

describe('Dalal Diary\'s Core Calculations Engine', () => {
  const stockId = 1;
  const symbol = 'TCS';

  it('calculates weighted average cost and realized P&L accurately', () => {
    // Buy 10 @ 3000
    // Buy 10 @ 4000 -> 20 @ 3500 avg
    // Sell 5 @ 4500 -> realized P&L: 5 * (4500 - 3500) = 5000. Remaining: 15 @ 3500 avg
    const transactions: Transaction[] = [
      { id: 1, stockId, symbol, type: 'BUY', date: '2024-01-10', quantity: 10, price: 3000, createdAt: '' },
      { id: 2, stockId, symbol, type: 'BUY', date: '2024-02-10', quantity: 10, price: 4000, createdAt: '' },
      { id: 3, stockId, symbol, type: 'SELL', date: '2024-03-10', quantity: 5, price: 4500, createdAt: '' },
    ];

    const pos = calculateStockPosition(stockId, transactions, [], 'Average Cost');

    expect(pos.quantity).toBe(15);
    expect(pos.averageBuyPrice).toBe(3500);
    expect(pos.totalCostBasis).toBe(15 * 3500); // 52500
    expect(pos.realizedPnL).toBe(5000);
  });

  it('calculates FIFO lot matching and remaining cost basis accurately', () => {
    // Buy 10 @ 3000 (Lot 1)
    // Buy 10 @ 4000 (Lot 2)
    // Sell 12 @ 4500
    // FIFO should consume all 10 of Lot 1 (pnl: 10*(4500-3000) = 15000) + 2 of Lot 2 (pnl: 2*(4500-4000) = 1000)
    // Total realized = 16000
    // Remaining in Lot 2: 8 shares @ 4000 = 32000 total cost basis, avg 4000
    const transactions: Transaction[] = [
      { id: 1, stockId, symbol, type: 'BUY', date: '2024-01-10', quantity: 10, price: 3000, createdAt: '' },
      { id: 2, stockId, symbol, type: 'BUY', date: '2024-02-10', quantity: 10, price: 4000, createdAt: '' },
      { id: 3, stockId, symbol, type: 'SELL', date: '2024-03-10', quantity: 12, price: 4500, createdAt: '' },
    ];

    const pos = calculateStockPosition(stockId, transactions, [], 'FIFO');

    expect(pos.quantity).toBe(8);
    expect(pos.averageBuyPrice).toBe(4000);
    expect(pos.totalCostBasis).toBe(32000);
    expect(pos.realizedPnL).toBe(16000);

    // Verify lot history details
    const sellHistory = pos.lotHistory.find((item) => item.transaction.id === 3);
    expect(sellHistory?.consumedLots).toHaveLength(2);
    expect(sellHistory?.consumedLots?.[0].qtyTaken).toBe(10);
    expect(sellHistory?.consumedLots?.[0].buyPrice).toBe(3000);
    expect(sellHistory?.consumedLots?.[1].qtyTaken).toBe(2);
    expect(sellHistory?.consumedLots?.[1].buyPrice).toBe(4000);
  });

  it('verifies that total profit on fully sold stocks is invariant to cost method', () => {
    // Buy 10 @ 2000
    // Buy 10 @ 3000 (Total cost: 50,000)
    // Sell 20 @ 4000 (Total proceeds: 80,000)
    // Total profit must be exactly 30,000 regardless of cost method
    const transactions: Transaction[] = [
      { id: 1, stockId, symbol, type: 'BUY', date: '2024-01-01', quantity: 10, price: 2000, createdAt: '' },
      { id: 2, stockId, symbol, type: 'BUY', date: '2024-02-01', quantity: 10, price: 3000, createdAt: '' },
      { id: 3, stockId, symbol, type: 'SELL', date: '2024-03-01', quantity: 20, price: 4000, createdAt: '' },
    ];

    const avgPos = calculateStockPosition(stockId, transactions, [], 'Average Cost');
    const fifoPos = calculateStockPosition(stockId, transactions, [], 'FIFO');

    expect(avgPos.quantity).toBe(0);
    expect(fifoPos.quantity).toBe(0);
    expect(avgPos.realizedPnL).toBe(30000);
    expect(fifoPos.realizedPnL).toBe(30000);
  });

  it('correctly applies splits and bonuses to pre-exDate transactions only', () => {
    // Buy 10 shares @ 1000 on 2024-01-10
    // Split 1:2 on 2024-06-01 (1 share becomes 2, price halves to 500)
    // Buy 10 shares @ 600 on 2024-07-01 (post split, should remain 10 @ 600)
    // Total shares should be 20 (from pre-split) + 10 (post-split) = 30 shares
    // Total invested: (20 * 500) + (10 * 600) = 10000 + 6000 = 16000
    // Average price: 16000 / 30 = 533.3333
    const transactions: Transaction[] = [
      { id: 1, stockId, symbol, type: 'BUY', date: '2024-01-10', quantity: 10, price: 1000, createdAt: '' },
      { id: 2, stockId, symbol, type: 'BUY', date: '2024-07-01', quantity: 10, price: 600, createdAt: '' },
    ];

    const corporateActions: CorporateAction[] = [
      {
        id: 1,
        stockId,
        symbol,
        type: 'SPLIT',
        fromFactor: 1,
        toFactor: 2,
        exDate: '2024-06-01',
        createdAt: '',
      },
    ];

    const adjusted = adjustTransactionsForCorporateActions(transactions, corporateActions);
    expect(adjusted[0].quantity).toBe(20);
    expect(adjusted[0].price).toBe(500);
    expect(adjusted[1].quantity).toBe(10);
    expect(adjusted[1].price).toBe(600);

    const pos = calculateStockPosition(stockId, transactions, corporateActions, 'Average Cost');
    expect(pos.quantity).toBe(30);
    expect(Math.round(pos.totalCostBasis)).toBe(16000);
    expect(Number(pos.averageBuyPrice.toFixed(2))).toBe(533.33);
  });

  it('blocks SELL larger than shares held on that date, taking corporate actions into account', () => {
    const transactions: Transaction[] = [
      { id: 1, stockId, symbol, type: 'BUY', date: '2024-01-10', quantity: 10, price: 1000, createdAt: '' },
    ];

    // Attempt to sell 15 shares before split -> should fail
    const valBeforeSplit = validateSellQuantity(stockId, '2024-02-01', 15, transactions, []);
    expect(valBeforeSplit.isValid).toBe(false);
    expect(valBeforeSplit.maxAllowed).toBe(10);

    // Split 1:2 on 2024-03-01 -> shares become 20
    const actions: CorporateAction[] = [
      { id: 1, stockId, symbol, type: 'SPLIT', fromFactor: 1, toFactor: 2, exDate: '2024-03-01', createdAt: '' },
    ];

    // Selling 15 shares on 2024-04-01 (post split) should now succeed
    const valAfterSplit = validateSellQuantity(stockId, '2024-04-01', 15, transactions, actions);
    expect(valAfterSplit.isValid).toBe(true);
    expect(valAfterSplit.maxAllowed).toBe(20);

    // Selling 25 shares should fail
    const valExceed = validateSellQuantity(stockId, '2024-04-01', 25, transactions, actions);
    expect(valExceed.isValid).toBe(false);
  });

  it('calculates Reverse Target-Average ("Buy the Dip") exact shares and capital', () => {
    // CurrentQty = 100, CurrentAvg = 500, TargetAvg = 450, PlannedPrice = 400
    // exact shares = ceil(100 * (500 - 450) / (450 - 400)) = ceil(100 * 50 / 50) = 100 shares
    // Capital required = 100 * 400 = 40,000
    // Resulting average: (100 * 500 + 40000) / 200 = 90000 / 200 = 450
    const res = calculateReverseTargetAverage(100, 500, 450, 400);

    expect(res.isValid).toBe(true);
    expect(res.requiredShares).toBe(100);
    expect(res.capitalRequired).toBe(40000);
    expect(res.newAveragePrice).toBe(450);

    // Test with fractional ceil requirement:
    // CurrentQty = 100, CurrentAvg = 1000, TargetAvg = 950, PlannedPrice = 800
    // Numerator: 100 * (1000 - 950) = 5000
    // Denominator: 950 - 800 = 150
    // 5000 / 150 = 33.333 -> ceil = 34 shares
    const res2 = calculateReverseTargetAverage(100, 1000, 950, 800);
    expect(res2.isValid).toBe(true);
    expect(res2.requiredShares).toBe(34);
    expect(res2.newAveragePrice).toBeLessThanOrEqual(950);

    // Validation: Planned price must be below target average
    const invalidRes = calculateReverseTargetAverage(100, 500, 450, 460);
    expect(invalidRes.isValid).toBe(false);
  });

  it('calculates XIRR accurately for buy, sell, and terminal value cashflows', () => {
    // Invest 1,00,000 on 2023-01-01
    // Value is 1,20,000 on 2024-01-01 (1 year later) -> exact 20% return
    const flows = [
      { date: '2023-01-01', amount: -100000 },
      { date: '2024-01-01', amount: 120000 },
    ];

    const xirr = calculateXIRR(flows);
    expect(xirr).not.toBeNull();
    expect(Math.round(xirr!)).toBe(20);
  });

  it('classifies tax lots into STCG (<=365 days) and LTCG (>365 days) using FIFO', () => {
    const transactions: Transaction[] = [
      { id: 1, stockId, symbol, type: 'BUY', date: '2022-01-01', quantity: 10, price: 1000, createdAt: '' }, // Lot 1
      { id: 2, stockId, symbol, type: 'BUY', date: '2023-06-01', quantity: 10, price: 1200, createdAt: '' }, // Lot 2
      // Sell 15 shares on 2023-08-01:
      // - 10 shares from Lot 1 (held from 2022-01-01 to 2023-08-01 = ~577 days > 365 -> LTCG)
      // - 5 shares from Lot 2 (held from 2023-06-01 to 2023-08-01 = ~61 days <= 365 -> STCG)
      { id: 3, stockId, symbol, type: 'SELL', date: '2023-08-01', quantity: 15, price: 1500, createdAt: '' },
    ];

    const taxRecords = classifyTaxLots(transactions, []);
    expect(taxRecords).toHaveLength(2);

    const ltcg = taxRecords.find((r) => r.term === 'LTCG');
    const stcg = taxRecords.find((r) => r.term === 'STCG');

    expect(ltcg).toBeDefined();
    expect(ltcg?.quantity).toBe(10);
    expect(ltcg?.gainOrLoss).toBe(10 * (1500 - 1000)); // 5000

    expect(stcg).toBeDefined();
    expect(stcg?.quantity).toBe(5);
    expect(stcg?.gainOrLoss).toBe(5 * (1500 - 1200)); // 1500
  });
});
