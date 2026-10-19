import { describe, it, expect } from 'vitest';
import {
  calculateStockPosition,
  adjustTransactionsForCorporateActions,
  validateSellQuantity,
  calculateReverseTargetAverage,
  calculateXIRR,
  classifyTaxLots,
  calculateCAGR,
  calculateTaxSummaryByFY,
  simulateSIPAndLumpSum,
  generateProsAndCons,
  getPassiveHighlights,
  calculateNSECharges,
  parseBseRoePb,
  parseBseEps,
  calculateIntrinsicValue,
  calculateMarginOfSafety,
  simulateStockCompounding,
  calculateAllHoldings,
  calculatePortfolioKPIs,
} from './calculations';
import type { Transaction, CorporateAction, Stock, Fundamentals, LiveQuote } from '../types';

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

  it('calculates Multi-Year CAGR correctly', () => {
    // 100 growing to 200 over 5 years
    // (200/100)^(1/5) - 1 = 2^(0.2) - 1 = ~14.87%
    const cagr = calculateCAGR(100, 200, 5);
    expect(cagr).not.toBeNull();
    expect(cagr!).toBeCloseTo(14.87, 1);

    // Negative / invalid cases
    expect(calculateCAGR(0, 200, 5)).toBeNull();
    expect(calculateCAGR(100, 0, 5)).toBeNull();
  });

  it('calculates Indian Capital Gains Tax by FY with Budget 2024 rules and ₹1.25L LTCG exemption', () => {
    const taxRecords = [
      {
        symbol: 'TCS',
        sellDate: '2024-06-15',
        buyDate: '2024-01-10',
        quantity: 10,
        sellPrice: 4000,
        buyPrice: 3000,
        holdingDays: 157,
        gainOrLoss: 50000, // STCG 50,000
        term: 'STCG' as const,
        financialYear: '2024-25',
      },
      {
        symbol: 'RELIANCE',
        sellDate: '2024-09-20',
        buyDate: '2022-05-10',
        quantity: 100,
        sellPrice: 3000,
        buyPrice: 1000,
        holdingDays: 864,
        gainOrLoss: 200000, // LTCG 2,00,000
        term: 'LTCG' as const,
        financialYear: '2024-25',
      },
    ];

    const summaries = calculateTaxSummaryByFY(taxRecords, 20, 12.5, 125000);
    expect(summaries).toHaveLength(1);

    const fy2425 = summaries[0];
    expect(fy2425.financialYear).toBe('2024-25');
    expect(fy2425.stcgGain).toBe(50000);
    expect(fy2425.ltcgGain).toBe(200000);

    // LTCG Exemption applied = ₹1,25,000
    expect(fy2425.ltcgExemptionApplied).toBe(125000);
    // Taxable LTCG = 2,00,000 - 1,25,000 = 75,000
    expect(fy2425.taxableLtcg).toBe(75000);

    // STCG Tax @ 20% on 50,000 = 10,000
    expect(fy2425.stcgTax).toBe(10000);

    // LTCG Tax @ 12.5% on 75,000 = 9,375
    expect(fy2425.ltcgTax).toBe(9375);

    // Total Tax Due = 10,000 + 9,375 = 19,375
    expect(fy2425.totalTax).toBe(19375);
  });

  it('accurately models multi-year SIP + Lump Sum + Compounding with DRIP bonus', () => {
    const sim = simulateSIPAndLumpSum({
      horizonYears: 10,
      monthlySIP: 10000, // 1.2L per year
      lumpSum: 100000, // 1L initial
      expectedCagrPercent: 12,
      dividendReinvestment: true,
      estimatedDividendYieldPercent: 2,
    });

    // 10 years of 1.2L = 12L + 1L initial = 13L total invested
    expect(sim.finalInvested).toBe(1300000);
    expect(sim.yearBreakdown).toHaveLength(10);
    expect(sim.finalCorpus).toBeGreaterThan(sim.finalInvested);
    expect(sim.wealthMultiple).toBeGreaterThan(1);
    expect(sim.totalWealthGain).toBe(sim.finalCorpus - sim.finalInvested);
  });

  it('evaluates passive highlight badges and pros/cons without intrusive popups', () => {
    const stock: Stock = {
      id: 1,
      symbol: 'TCS',
      bseCode: '532540',
      name: 'Tata Consultancy Services',
      sector: 'IT',
      marketCapCategory: 'Large Cap',
      targetBuyPrice: 3800,
      createdAt: '2023-01-01',
    };

    const fund: Fundamentals = {
      stockId: 1,
      symbol: 'TCS',
      roce: 58,
      debtToEquity: 0.05,
      profitCagr10Y: 12,
      low52W: 3400,
      intrinsicValue: 4200,
      lastUpdated: '2024-01-01',
    };

    // CMP = 3500, averageBuyPrice = 3600
    // Below avg (3500 < 3600)
    // In buy zone (3500 <= 3800 target)
    // Below intrinsic (3500 < 4200)
    // Near 52W low (3500 is within 16% of 3400)
    const badges = getPassiveHighlights(stock, 3500, 3600, fund, '2024-01-01');
    const badgeIds = badges.map((b) => b.id);

    expect(badgeIds).toContain('below-avg');
    expect(badgeIds).toContain('in-buy-zone');
    expect(badgeIds).toContain('below-intrinsic');
    expect(badgeIds).toContain('near-52w-low');

    const prosCons = generateProsAndCons(fund, 3500, 3600);
    expect(prosCons.pros.length).toBeGreaterThan(0);
  });

  describe('NSE 0.5% Brokerage & Statutory Delivery Charges', () => {
    it('calculates exact charges breakdown for a BUY delivery transaction', () => {
      // 100 shares @ ₹1000 = ₹100,000 turnover
      const charges = calculateNSECharges('BUY', 100, 1000);

      expect(charges.turnover).toBe(100000);
      expect(charges.brokerage).toBe(500); // 0.5%
      expect(charges.stt).toBe(100); // 0.1%
      expect(charges.exchangeCharges).toBe(2.97); // 0.00297%
      expect(charges.sebiFee).toBe(0.1); // 0.0001%
      expect(charges.stampDuty).toBe(15); // 0.015% on BUY
      expect(charges.gst).toBe(90.55); // 18% on (500 + 2.97 + 0.1)
      expect(charges.totalCharges).toBe(708.62);
      expect(charges.netTotal).toBe(100708.62);
    });

    it('calculates exact charges breakdown for a SELL delivery transaction (0% stamp duty)', () => {
      // 100 shares @ ₹1000 = ₹100,000 turnover
      const charges = calculateNSECharges('SELL', 100, 1000);

      expect(charges.turnover).toBe(100000);
      expect(charges.brokerage).toBe(500);
      expect(charges.stt).toBe(100);
      expect(charges.stampDuty).toBe(0); // 0% on SELL
      expect(charges.totalCharges).toBe(693.62);
      expect(charges.netTotal).toBe(99306.38);
    });
  });

  describe('BSE ROE / PB and EPS Parsing', () => {
    it('parses BSE slash-separated ROE and PB strings correctly', () => {
      const parsed = parseBseRoePb('25.99/4.52');
      expect(parsed.roe).toBe(25.99);
      expect(parsed.pbRatio).toBe(4.52);

      const parsedPct = parseBseRoePb('18.5%/3.2');
      expect(parsedPct.roe).toBe(18.5);
      expect(parsedPct.pbRatio).toBe(3.2);
    });

    it('parses BSE standalone and consolidated EPS correctly', () => {
      const parsed = parseBseEps('15.13/16.11');
      expect(parsed.standalone).toBe(15.13);
      expect(parsed.consolidated).toBe(16.11);
      expect(parsed.primaryEps).toBe(16.11);

      const single = parseBseEps('22.50');
      expect(single.standalone).toBe(22.50);
      expect(single.primaryEps).toBe(22.50);
    });
  });

  describe('Graham Intrinsic Value and Margin of Safety', () => {
    it('calculates Graham Number intrinsic value: sqrt(22.5 * EPS * BookValue)', () => {
      // EPS = 20, BookValue = 500
      // 22.5 * 20 * 500 = 225,000 -> sqrt = 474.34
      const iv = calculateIntrinsicValue(20, 500);
      expect(iv).toBe(474.34);
    });

    it('calculates Margin of Safety (%) correctly', () => {
      // Intrinsic Value = 1000, CMP = 750 -> 25% discount
      const mos = calculateMarginOfSafety(1000, 750);
      expect(mos).toBe(25);

      // Intrinsic Value = 1000, CMP = 1200 -> -20% premium
      const mosPrem = calculateMarginOfSafety(1000, 1200);
      expect(mosPrem).toBe(-20);
    });
  });

  describe('Stock-Specific Long-Term Compounding Simulation', () => {
    it('simulates lump sum with dividend reinvestment (DRIP)', () => {
      const res = simulateStockCompounding({
        mode: 'lumpSum',
        initialShares: 100,
        initialPrice: 1000,
        expectedCagrPct: 15,
        dividendYieldPct: 2,
        drip: true,
        horizonYears: 5,
      });

      expect(res.yearBreakdown).toHaveLength(5);
      expect(res.finalShares).toBeGreaterThan(100); // Shares accumulated via DRIP
      expect(res.finalCorpus).toBeGreaterThan(res.finalInvested);
      expect(res.totalDividends).toBeGreaterThan(0);
      expect(res.cagr).toBeGreaterThan(0);
    });

    it('simulates periodic accumulation with NSE statutory brokerage deductions', () => {
      const res = simulateStockCompounding({
        mode: 'accumulation',
        initialShares: 10,
        initialPrice: 500,
        expectedCagrPct: 12,
        dividendYieldPct: 1.5,
        drip: true,
        horizonYears: 3,
        accumulationType: 'shares',
        periodicShares: 2,
        frequencyPerYear: 12, // 2 shares/month = 24 shares/year
      });

      expect(res.yearBreakdown).toHaveLength(3);
      expect(res.finalShares).toBeGreaterThan(70);
      expect(res.totalCharges).toBeGreaterThan(0); // Brokerage & STT deducted
    });
  });

  describe('Live Price Feeds and Real-Time Calculations', () => {
    const sampleStock: Stock = {
      id: 1,
      symbol: 'RELIANCE',
      bseCode: '500325',
      name: 'Reliance Industries Ltd',
      sector: 'Energy',
      marketCapCategory: 'Large Cap',
      currentPrice: 2800,
      previousClose: 2750,
      dayChange: 50,
      dayChangePercent: 1.82,
      createdAt: '2024-01-01',
    };

    const sampleTx: Transaction = {
      id: 101,
      stockId: 1,
      symbol: 'RELIANCE',
      type: 'BUY',
      date: '2024-01-10',
      quantity: 10,
      price: 2500,
      createdAt: '2024-01-10',
    };

    it('prioritizes liveQuotesMap when computing currentPrice, priceChange, and isLive flag', () => {
      const liveQuotesMap = new Map<string, LiveQuote>();
      liveQuotesMap.set('RELIANCE.NS', {
        symbol: 'RELIANCE.NS',
        shortName: 'Reliance Industries',
        price: 2950.50,
        change: 150.50,
        changePercent: 5.37,
        previousClose: 2800.00,
        dayHigh: 2980.00,
        dayLow: 2810.00,
        high52W: 3100.00,
        low52W: 2200.00,
        timestamp: new Date().toISOString(),
      });

      const holdings = calculateAllHoldings(
        [sampleStock],
        [sampleTx],
        [],
        [],
        [],
        'Average Cost',
        liveQuotesMap
      );

      expect(holdings).toHaveLength(1);
      const h = holdings[0];
      expect(h.currentPrice).toBe(2950.50);
      expect(h.isLive).toBe(true);
      expect(h.priceChange).toBe(150.50);
      expect(h.priceChangePercent).toBe(5.37);
      expect(h.previousPrice).toBe(2800.00);
      expect(h.dayHigh).toBe(2980.00);
      expect(h.dayLow).toBe(2810.00);
      expect(h.high52W).toBe(3100.00);
      expect(h.low52W).toBe(2200.00);
      // Value: 10 shares * 2950.50 = 29505
      expect(h.currentValue).toBe(29505);
      // Invested: 10 * 2500 = 25000 -> P&L = +4505
      expect(h.unrealizedPnL).toBe(4505);
    });

    it('correctly calculates portfolio KPIs with day change from live holdings', () => {
      const liveQuotesMap = new Map<string, LiveQuote>();
      liveQuotesMap.set('RELIANCE.NS', {
        symbol: 'RELIANCE.NS',
        shortName: 'Reliance Industries',
        price: 2900,
        change: 100, // +100 per share
        changePercent: 3.57,
        previousClose: 2800,
        timestamp: new Date().toISOString(),
      });

      const holdings = calculateAllHoldings(
        [sampleStock],
        [sampleTx],
        [],
        [],
        [],
        'Average Cost',
        liveQuotesMap
      );

      const kpis = calculatePortfolioKPIs(
        holdings,
        [sampleStock],
        [sampleTx],
        [],
        'Average Cost'
      );

      expect(kpis.totalInvested).toBe(25000); // 10 * 2500
      expect(kpis.currentValue).toBe(29000); // 10 * 2900
      expect(kpis.unrealizedPnL).toBe(4000);
      // Day change: 10 shares * 100 = 1000
      expect(kpis.dayChangeValue).toBe(1000);
      // Previous total value: 10 * 2800 = 28000. Day change % = (1000 / 28000) * 100 = 3.5714...
      expect(kpis.dayChangePercent).toBeCloseTo(3.5714, 2);
    });
  });
});


