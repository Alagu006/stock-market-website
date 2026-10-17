import React, { useState, useMemo, useEffect } from 'react';
import {
  Sparkles,
  TrendingUp,
  Percent,
  Coins,
  Building2,
  Layers,
  Calendar,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import stocksDirectory from '../data/stocks-directory.json';
import { formatINR } from '../utils/formatters';
import { simulateSIPAndLumpSum, simulateStockCompounding } from '../services/calculations';
import type { Stock, Fundamentals, HoldingCalculation, PriceRecord } from '../types';

interface SimulatorViewProps {
  currentPortfolioValue?: number;
  stocks?: Stock[];
  fundamentalsList?: Fundamentals[];
  holdings?: HoldingCalculation[];
  priceRecords?: PriceRecord[];
}

export const SimulatorView: React.FC<SimulatorViewProps> = ({
  currentPortfolioValue = 0,
  stocks = [],
  fundamentalsList = [],
  holdings = [],
  priceRecords = [],
}) => {
  // Tab: Generic SIP vs Direct Stock Compounding
  const [activeSimulatorTab, setActiveSimulatorTab] = useState<'stock' | 'generic'>('stock');

  // ==========================================
  // 1. GENERIC SIP SIMULATOR STATE
  // ==========================================
  const [genericHorizonYears, setGenericHorizonYears] = useState<number>(15);
  const [genericMonthlySIP, setGenericMonthlySIP] = useState<number>(25000);
  const [genericLumpSum, setGenericLumpSum] = useState<number>(
    currentPortfolioValue > 0 ? Math.round(currentPortfolioValue) : 500000
  );
  const [genericExpectedCagr, setGenericExpectedCagr] = useState<number>(14);
  const [genericEnableDRIP, setGenericEnableDRIP] = useState<boolean>(true);
  const [genericDividendYield, setGenericDividendYield] = useState<number>(1.5);

  const genericSimulation = useMemo(() => {
    return simulateSIPAndLumpSum({
      horizonYears: genericHorizonYears,
      monthlySIP: genericMonthlySIP,
      lumpSum: genericLumpSum,
      expectedCagrPercent: genericExpectedCagr,
      dividendReinvestment: genericEnableDRIP,
      estimatedDividendYieldPercent: genericDividendYield,
    });
  }, [
    genericHorizonYears,
    genericMonthlySIP,
    genericLumpSum,
    genericExpectedCagr,
    genericEnableDRIP,
    genericDividendYield,
  ]);

  const genericSimulationNoDrip = useMemo(() => {
    return simulateSIPAndLumpSum({
      horizonYears: genericHorizonYears,
      monthlySIP: genericMonthlySIP,
      lumpSum: genericLumpSum,
      expectedCagrPercent: genericExpectedCagr,
      dividendReinvestment: false,
      estimatedDividendYieldPercent: genericDividendYield,
    });
  }, [
    genericHorizonYears,
    genericMonthlySIP,
    genericLumpSum,
    genericExpectedCagr,
    genericDividendYield,
  ]);

  const genericDripBoost = Math.max(
    0,
    genericSimulation.finalCorpus - genericSimulationNoDrip.finalCorpus
  );

  const genericChartData = useMemo(() => {
    return genericSimulation.yearBreakdown.map((row) => ({
      year: `Yr ${row.year}`,
      'Invested Capital': row.investedCapital,
      'Corpus (No DRIP)': row.corpusWithoutDrip,
      'Corpus (With DRIP)': row.corpusWithDrip,
    }));
  }, [genericSimulation]);

  // ==========================================
  // 2. DIRECT STOCK SPECIFIC COMPOUNDING STATE
  // ==========================================
  // Combine user stocks with master directory
  const availableStockOptions = useMemo(() => {
    const list: Array<{ symbol: string; bseCode: string; name: string; sector: string }> = [];
    const seen = new Set<string>();

    for (const st of stocks) {
      if (!seen.has(st.symbol.toUpperCase())) {
        seen.add(st.symbol.toUpperCase());
        list.push({
          symbol: st.symbol,
          bseCode: st.bseCode,
          name: st.name,
          sector: st.sector,
        });
      }
    }
    for (const dir of stocksDirectory) {
      if (!seen.has(dir.symbol.toUpperCase())) {
        seen.add(dir.symbol.toUpperCase());
        list.push({
          symbol: dir.symbol,
          bseCode: dir.bseCode,
          name: dir.name,
          sector: dir.sector,
        });
      }
    }
    return list;
  }, [stocks]);

  const [selectedStockSym, setSelectedStockSym] = useState<string>(
    stocks[0]?.symbol || stocksDirectory[0]?.symbol || 'RELIANCE'
  );

  const [stockMode, setStockMode] = useState<'lumpSum' | 'accumulation'>('accumulation');
  const [stockHorizonYears, setStockHorizonYears] = useState<number>(10);
  const [stockInitialPrice, setStockInitialPrice] = useState<number>(2500);
  const [stockInitialShares, setStockInitialShares] = useState<number>(50);
  const [stockExpectedCagr, setStockExpectedCagr] = useState<number>(15);
  const [stockDividendYield, setStockDividendYield] = useState<number>(1.2);
  const [stockEnableDRIP, setStockEnableDRIP] = useState<boolean>(true);

  // Accumulation specific
  const [accumulationType, setAccumulationType] = useState<'shares' | 'amount'>('amount');
  const [periodicShares, setPeriodicShares] = useState<number>(5);
  const [periodicAmount, setPeriodicAmount] = useState<number>(15000);
  const [accumulationFrequency, setAccumulationFrequency] = useState<number>(12); // 12 = Monthly, 4 = Quarterly

  // Auto-fill parameters when selected stock changes
  useEffect(() => {
    const sym = selectedStockSym.toUpperCase();
    const stockObj = stocks.find((s) => s.symbol.toUpperCase() === sym);
    const fund = stockObj
      ? fundamentalsList.find((f) => f.stockId === stockObj.id)
      : undefined;
    const holding = holdings.find((h) => h.stock.symbol.toUpperCase() === sym);
    const latestManualPrice = stockObj
      ? priceRecords.filter((p) => p.stockId === stockObj.id).sort((a, b) => b.date.localeCompare(a.date))[0]?.price
      : undefined;

    // Price
    const initialP = holding?.currentPrice || latestManualPrice || 2500;
    setStockInitialPrice(initialP);

    // Initial shares from current holding
    if (holding && holding.quantity > 0) {
      setStockInitialShares(holding.quantity);
    }

    // Expected CAGR from 10Y Profit CAGR / Sales CAGR / ROE
    const expectedRate =
      fund?.profitCagr10Y || fund?.salesCagr10Y || fund?.roe || 15;
    setStockExpectedCagr(Math.round(expectedRate * 10) / 10);

    // Dividend Yield
    const divYield = fund?.dividendYield || 1.2;
    setStockDividendYield(Math.round(divYield * 10) / 10);
  }, [selectedStockSym, stocks, fundamentalsList, holdings, priceRecords]);

  // Run Direct Stock Compounding Simulation
  const stockSimulation = useMemo(() => {
    return simulateStockCompounding({
      mode: stockMode,
      initialShares: stockInitialShares,
      initialPrice: Math.max(1, stockInitialPrice),
      expectedCagrPct: stockExpectedCagr,
      dividendYieldPct: stockDividendYield,
      drip: stockEnableDRIP,
      horizonYears: stockHorizonYears,
      accumulationType,
      periodicShares,
      periodicAmount,
      frequencyPerYear: accumulationFrequency,
    });
  }, [
    stockMode,
    stockInitialShares,
    stockInitialPrice,
    stockExpectedCagr,
    stockDividendYield,
    stockEnableDRIP,
    stockHorizonYears,
    accumulationType,
    periodicShares,
    periodicAmount,
    accumulationFrequency,
  ]);

  const stockChartData = useMemo(() => {
    return stockSimulation.yearBreakdown.map((row) => ({
      year: `Yr ${row.year}`,
      'Cumulative Invested': row.cumulativeInvested,
      'Total Corpus Value': row.corpusValue,
      'Dividends Earned': row.dividendsEarned,
      'Ending Shares': row.endingShares,
    }));
  }, [stockSimulation]);

  return (
    <div className="space-y-6">
      {/* Top Banner & Mode Toggle */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 p-5 rounded-2xl border border-slate-800 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-emerald-400" />
              Long-Term Compounding & DRIP Simulator
            </h1>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              The 8th Wonder of the World
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Model direct equity compounding with statutory NSE brokerage deductions, dividend reinvestment (DRIP), and periodic accumulation.
          </p>
        </div>

        {/* Tab Toggle: Stock Specific vs Generic SIP */}
        <div className="flex items-center p-1 bg-slate-950 border border-slate-800 rounded-xl self-start md:self-auto">
          <button
            type="button"
            onClick={() => setActiveSimulatorTab('stock')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeSimulatorTab === 'stock'
                ? 'bg-emerald-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Direct Stock Compounding</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSimulatorTab('generic')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeSimulatorTab === 'generic'
                ? 'bg-emerald-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Generic Portfolio / SIP</span>
          </button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* TAB 1: DIRECT STOCK LONG-TERM COMPOUNDING */}
      {/* ======================================================== */}
      {activeSimulatorTab === 'stock' && (
        <div className="space-y-6">
          {/* Stock Selector & Controls Grid */}
          <div className="bg-[#111827] border border-slate-800 rounded-2xl p-5 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-emerald-400" />
                  <span>Direct Equity Simulation Parameters</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Select any company to auto-fill current CMP, CAGR, and dividend metrics
                </p>
              </div>

              {/* Stock dropdown */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-semibold">Select Equity:</span>
                <select
                  value={selectedStockSym}
                  onChange={(e) => setSelectedStockSym(e.target.value)}
                  className="px-3 py-1.5 bg-slate-900 text-xs font-bold text-emerald-400 rounded-xl border border-slate-700 focus:outline-none cursor-pointer"
                >
                  {availableStockOptions.map((st) => (
                    <option key={st.symbol} value={st.symbol} className="bg-slate-900 text-slate-200">
                      {st.symbol} ({st.bseCode}) - {st.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Mode: Lump Sum vs Accumulation */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                  Simulation Strategy
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setStockMode('accumulation')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      stockMode === 'accumulation'
                        ? 'bg-emerald-500 text-slate-950 shadow-md'
                        : 'bg-slate-900 text-slate-400 border border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    Periodic Accumulation
                  </button>
                  <button
                    type="button"
                    onClick={() => setStockMode('lumpSum')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      stockMode === 'lumpSum'
                        ? 'bg-emerald-500 text-slate-950 shadow-md'
                        : 'bg-slate-900 text-slate-400 border border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    Lump Sum + DRIP
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                  Holding Horizon (Years)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="3"
                    max="30"
                    step="1"
                    value={stockHorizonYears}
                    onChange={(e) => setStockHorizonYears(Number(e.target.value))}
                    className="flex-1 accent-emerald-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <span className="text-sm font-bold text-white tabular-nums w-14 text-right">
                    {stockHorizonYears} Yrs
                  </span>
                </div>
              </div>
            </div>

            {/* Dynamic Inputs Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Current Share Price (CMP ₹)
                </label>
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  value={stockInitialPrice}
                  onChange={(e) => setStockInitialPrice(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-900 text-xs text-white rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500 tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Initial Shares Held
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={stockInitialShares}
                  onChange={(e) => setStockInitialShares(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-900 text-xs text-white rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500 tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Expected Price CAGR (%)
                </label>
                <input
                  type="number"
                  min="-20"
                  max="60"
                  step="0.5"
                  value={stockExpectedCagr}
                  onChange={(e) => setStockExpectedCagr(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-900 text-xs text-emerald-400 font-bold rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500 tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Annual Dividend Yield (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="25"
                  step="0.1"
                  value={stockDividendYield}
                  onChange={(e) => setStockDividendYield(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-900 text-xs text-amber-400 font-bold rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500 tabular-nums"
                />
              </div>
            </div>

            {/* Periodic Accumulation Specific Controls */}
            {stockMode === 'accumulation' && (
              <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Periodic Buying Plan (Deducts 0.5% + STT statutory charges)</span>
                  </span>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setAccumulationFrequency(12)}
                      className={`px-2 py-0.5 rounded cursor-pointer ${
                        accumulationFrequency === 12
                          ? 'bg-emerald-500 text-slate-950 font-bold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Monthly (12x/yr)
                    </button>
                    <button
                      type="button"
                      onClick={() => setAccumulationFrequency(4)}
                      className={`px-2 py-0.5 rounded cursor-pointer ${
                        accumulationFrequency === 4
                          ? 'bg-emerald-500 text-slate-950 font-bold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Quarterly (4x/yr)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block text-slate-400 mb-1">Accumulation Mode:</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setAccumulationType('amount')}
                        className={`py-1.5 px-3 rounded-lg font-semibold cursor-pointer ${
                          accumulationType === 'amount'
                            ? 'bg-slate-800 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-900 text-slate-400'
                        }`}
                      >
                        Fixed Amount (₹ / period)
                      </button>
                      <button
                        type="button"
                        onClick={() => setAccumulationType('shares')}
                        className={`py-1.5 px-3 rounded-lg font-semibold cursor-pointer ${
                          accumulationType === 'shares'
                            ? 'bg-slate-800 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-900 text-slate-400'
                        }`}
                      >
                        Fixed Shares (Qty / period)
                      </button>
                    </div>
                  </div>

                  <div>
                    {accumulationType === 'amount' ? (
                      <div>
                        <label className="block text-slate-400 mb-1">
                          Amount to Invest (₹ each {accumulationFrequency === 12 ? 'Month' : 'Quarter'}):
                        </label>
                        <input
                          type="number"
                          step="1000"
                          value={periodicAmount}
                          onChange={(e) => setPeriodicAmount(Number(e.target.value))}
                          className="w-full px-3 py-1.5 bg-slate-900 text-white rounded-lg border border-slate-700"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="block text-slate-400 mb-1">
                          Shares to Buy (each {accumulationFrequency === 12 ? 'Month' : 'Quarter'}):
                        </label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={periodicShares}
                          onChange={(e) => setPeriodicShares(Number(e.target.value))}
                          className="w-full px-3 py-1.5 bg-slate-900 text-white rounded-lg border border-slate-700"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* DRIP Toggle */}
            <div className="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-slate-800/80">
              <div className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-amber-400" />
                <div>
                  <span className="text-xs font-bold text-white block">
                    Dividend Reinvestment Plan (DRIP)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Automatically buy additional shares every year using cash dividends received
                  </span>
                </div>
              </div>

              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={stockEnableDRIP}
                  onChange={(e) => setStockEnableDRIP(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
            </div>
          </div>

          {/* Outcome KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Ending Corpus Value
              </span>
              <div className="text-xl sm:text-2xl font-black text-emerald-400 tabular-nums mt-1">
                {formatINR(stockSimulation.finalCorpus)}
              </div>
              <span className="text-[10px] text-slate-500 mt-1">
                Effective CAGR: {stockSimulation.cagr}%
              </span>
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Total Shares Held
              </span>
              <div className="text-xl sm:text-2xl font-black text-white tabular-nums mt-1">
                {stockSimulation.finalShares} shares
              </div>
              <span className="text-[10px] text-slate-500 mt-1">
                From {stockInitialShares} initial shares
              </span>
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Cumulative Invested
              </span>
              <div className="text-xl sm:text-2xl font-black text-slate-200 tabular-nums mt-1">
                {formatINR(stockSimulation.finalInvested)}
              </div>
              <span className="text-[10px] text-slate-500 mt-1">
                Incl. ₹{stockSimulation.totalCharges} brokerage/STT
              </span>
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Total Dividends Earned
              </span>
              <div className="text-xl sm:text-2xl font-black text-amber-400 tabular-nums mt-1">
                {formatINR(stockSimulation.totalDividends)}
              </div>
              <span className="text-[10px] text-slate-500 mt-1">
                {stockEnableDRIP ? '100% Reinvested into shares' : 'Collected as cash'}
              </span>
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Net Wealth Gain
              </span>
              <div className="text-xl sm:text-2xl font-black text-emerald-400 tabular-nums mt-1">
                {formatINR(stockSimulation.wealthGain)}
              </div>
              <span className="text-[10px] text-slate-500 mt-1">
                Profit generated over principal
              </span>
            </div>
          </div>

          {/* Area Chart: Invested Capital vs Corpus */}
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span>{selectedStockSym} Direct Compounding Trajectory ({stockHorizonYears} Years)</span>
              </h3>
              <span className="text-xs text-slate-400">
                At {stockExpectedCagr}% Stock Price CAGR + {stockDividendYield}% Dividend Yield
              </span>
            </div>

            <div className="h-72 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stockChartData}>
                  <defs>
                    <linearGradient id="colorCorpusStock" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorInvestedStock" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#64748b" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#64748b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="year" stroke="#64748b" fontSize={11} />
                  <YAxis
                    stroke="#64748b"
                    fontSize={11}
                    tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    formatter={(val: any) => formatINR(Number(val))}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Area
                    type="monotone"
                    dataKey="Total Corpus Value"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#colorCorpusStock)"
                  />
                  <Area
                    type="monotone"
                    dataKey="Cumulative Invested"
                    stroke="#94a3b8"
                    strokeWidth={1.5}
                    fillOpacity={1}
                    fill="url(#colorInvestedStock)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Year-by-Year Table */}
          <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-400" />
                <span>Year-by-Year Accumulation, Dividend Payouts & Corpus Growth</span>
              </h3>
              <span className="text-[11px] text-slate-400">
                DRIP converts cash dividends to shares each year
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Year</th>
                    <th className="py-2.5 px-3">Shares Start</th>
                    <th className="py-2.5 px-3">Bought</th>
                    <th className="py-2.5 px-3">DRIP Shares</th>
                    <th className="py-2.5 px-3">Shares End</th>
                    <th className="py-2.5 px-3 text-right">Proj. CMP</th>
                    <th className="py-2.5 px-3 text-right">Invested (Year)</th>
                    <th className="py-2.5 px-3 text-right">Brokerage/STT</th>
                    <th className="py-2.5 px-3 text-right">Dividends</th>
                    <th className="py-2.5 px-3 text-right">Corpus Value</th>
                    <th className="py-2.5 px-3 text-right">Net Gain</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                  {stockSimulation.yearBreakdown.map((row) => (
                    <tr key={row.year} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-2 px-3 font-sans font-bold text-white">Year {row.year}</td>
                      <td className="py-2 px-3 text-slate-300">{row.startingShares}</td>
                      <td className="py-2 px-3 text-slate-300">+{row.purchasedShares}</td>
                      <td className="py-2 px-3 text-amber-400 font-bold">
                        {row.reinvestedShares > 0 ? `+${row.reinvestedShares}` : '—'}
                      </td>
                      <td className="py-2 px-3 text-emerald-400 font-bold">{row.endingShares}</td>
                      <td className="py-2 px-3 text-right text-slate-200">{formatINR(row.sharePrice)}</td>
                      <td className="py-2 px-3 text-right text-slate-300">{formatINR(row.investedThisYear)}</td>
                      <td className="py-2 px-3 text-right text-rose-400">
                        {row.brokerageAndChargesPaid > 0 ? `₹${row.brokerageAndChargesPaid}` : '—'}
                      </td>
                      <td className="py-2 px-3 text-right text-amber-400 font-bold">
                        {formatINR(row.dividendsEarned)}
                      </td>
                      <td className="py-2 px-3 text-right text-emerald-400 font-bold">
                        {formatINR(row.corpusValue)}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-300">{formatINR(row.wealthGain)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 2: GENERIC MUTUAL FUND / EQUITY SIP COMPACT VIEW */}
      {/* ======================================================== */}
      {activeSimulatorTab === 'generic' && (
        <div className="space-y-6">
          {/* Outcome Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
              <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                Projected Corpus ({genericHorizonYears} Yrs)
              </span>
              <div className="text-xl sm:text-2xl font-black text-emerald-400 mt-2">
                {formatINR(genericSimulation.finalCorpus)}
              </div>
              <span className="text-[10px] text-slate-500 mt-1">
                At {genericExpectedCagr}% CAGR {genericEnableDRIP ? `+ ${genericDividendYield}% DRIP` : ''}
              </span>
            </div>

            <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
              <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                <Coins className="w-4 h-4 text-blue-400" />
                Total Invested Capital
              </span>
              <div className="text-xl sm:text-2xl font-black text-slate-200 mt-2">
                {formatINR(genericSimulation.finalInvested)}
              </div>
              <span className="text-[10px] text-slate-500 mt-1">
                Principal contributions over {genericHorizonYears} years
              </span>
            </div>

            <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
              <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                <Percent className="w-4 h-4 text-purple-400" />
                Net Wealth Gain
              </span>
              <div className="text-xl sm:text-2xl font-black text-purple-400 mt-2">
                {formatINR(genericSimulation.totalWealthGain)}
              </div>
              <span className="text-[10px] text-slate-500 mt-1">
                {genericSimulation.wealthMultiple.toFixed(1)}x capital multiplier
              </span>
            </div>

            <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
              <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-400" />
                DRIP Compounding Boost
              </span>
              <div className="text-xl sm:text-2xl font-black text-amber-400 mt-2">
                {formatINR(genericDripBoost)}
              </div>
              <span className="text-[10px] text-slate-500 mt-1">
                Extra wealth created by reinvesting dividends
              </span>
            </div>
          </div>

          {/* Generic Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-slate-900/80 p-5 rounded-2xl border border-slate-800 space-y-4">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider border-b border-slate-800 pb-2">
                SIP & Capital Inputs
              </h2>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Time Horizon</span>
                  <span className="text-white font-bold">{genericHorizonYears} Years</span>
                </div>
                <input
                  type="range"
                  min="3"
                  max="35"
                  step="1"
                  value={genericHorizonYears}
                  onChange={(e) => setGenericHorizonYears(Number(e.target.value))}
                  className="w-full accent-emerald-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Monthly SIP Contribution</span>
                  <span className="text-emerald-400 font-bold">{formatINR(genericMonthlySIP)}</span>
                </div>
                <input
                  type="range"
                  min="5000"
                  max="200000"
                  step="5000"
                  value={genericMonthlySIP}
                  onChange={(e) => setGenericMonthlySIP(Number(e.target.value))}
                  className="w-full accent-emerald-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Initial Lump Sum Capital</span>
                  <span className="text-slate-200 font-bold">{formatINR(genericLumpSum)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="5000000"
                  step="50000"
                  value={genericLumpSum}
                  onChange={(e) => setGenericLumpSum(Number(e.target.value))}
                  className="w-full accent-emerald-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Expected Annual CAGR</span>
                  <span className="text-purple-400 font-bold">{genericExpectedCagr}%</span>
                </div>
                <input
                  type="range"
                  min="8"
                  max="25"
                  step="0.5"
                  value={genericExpectedCagr}
                  onChange={(e) => setGenericExpectedCagr(Number(e.target.value))}
                  className="w-full accent-emerald-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Dividend Yield (%)</span>
                  <span className="text-amber-400 font-bold">{genericDividendYield}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.1"
                  value={genericDividendYield}
                  onChange={(e) => setGenericDividendYield(Number(e.target.value))}
                  className="w-full accent-emerald-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-slate-300">Reinvest Dividends (DRIP)</span>
                <input
                  type="checkbox"
                  checked={genericEnableDRIP}
                  onChange={(e) => setGenericEnableDRIP(e.target.checked)}
                  className="accent-emerald-500 w-4 h-4 rounded cursor-pointer"
                />
              </div>
            </div>

            {/* Generic Chart */}
            <div className="lg:col-span-2 bg-slate-900/80 p-5 rounded-2xl border border-slate-800 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Wealth Trajectory: Capital vs Compounded Corpus
              </h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={genericChartData}>
                    <defs>
                      <linearGradient id="colorCorpusGen" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorInvestedGen" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#64748b" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#64748b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="year" stroke="#64748b" fontSize={11} />
                    <YAxis
                      stroke="#64748b"
                      fontSize={11}
                      tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                      formatter={(val: any) => formatINR(Number(val))}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Area
                      type="monotone"
                      dataKey="Corpus (With DRIP)"
                      stroke="#10b981"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorCorpusGen)"
                    />
                    <Area
                      type="monotone"
                      dataKey="Invested Capital"
                      stroke="#94a3b8"
                      strokeWidth={1.5}
                      fillOpacity={1}
                      fill="url(#colorInvestedGen)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
