import React, { useState, useMemo } from 'react';
import {
  Compass,
  Coffee,
  Gem,
  Coins,
  ShieldCheck,
  TrendingDown,
  Sliders,
  RotateCcw,
  PlusCircle,
  Eye,
} from 'lucide-react';
import type { Stock, Fundamentals, PriceRecord, HoldingCalculation } from '../types';
import { formatINR } from '../utils/formatters';
import { getPassiveHighlights } from '../services/calculations';

interface ScannersViewProps {
  stocks: Stock[];
  fundamentalsList: Fundamentals[];
  priceRecords: PriceRecord[];
  holdings: HoldingCalculation[];
  onOpenAddTx: (stockId: number) => void;
  onNavigateToXRay: (stockId: number) => void;
}

type PresetType = 'all' | 'coffeecan' | 'undervalued' | 'highdividend' | 'zerodebt' | 'near52wlow' | 'custom';

export const ScannersView: React.FC<ScannersViewProps> = ({
  stocks,
  fundamentalsList,
  priceRecords,
  holdings,
  onOpenAddTx,
  onNavigateToXRay,
}) => {
  const [selectedPreset, setSelectedPreset] = useState<PresetType>('coffeecan');

  // Custom Sliders Filter State
  const [minRoce, setMinRoce] = useState<number>(15);
  const [maxPE, setMaxPE] = useState<number>(50);
  const [maxDE, setMaxDE] = useState<number>(0.5);
  const [minProfitCagr, setMinProfitCagr] = useState<number>(8);
  const [selectedSector, setSelectedSector] = useState<string>('ALL');

  // Map latest prices
  const latestPriceMap = useMemo(() => {
    const map = new Map<number, { price: number; date: string }>();
    const sorted = [...priceRecords].sort((a, b) => b.date.localeCompare(a.date));
    for (const p of sorted) {
      if (!map.has(p.stockId)) {
        map.set(p.stockId, { price: p.price, date: p.date });
      }
    }
    return map;
  }, [priceRecords]);

  // Fundamentals map
  const fundMap = useMemo(() => {
    const map = new Map<number, Fundamentals>();
    fundamentalsList.forEach((f) => map.set(f.stockId, f));
    return map;
  }, [fundamentalsList]);

  // Holdings map
  const holdingMap = useMemo(() => {
    const map = new Map<number, HoldingCalculation>();
    holdings.forEach((h) => map.set(h.stock.id!, h));
    return map;
  }, [holdings]);

  // Unique sectors
  const allSectors = useMemo(() => {
    const set = new Set<string>();
    stocks.forEach((s) => {
      if (s.sector) set.add(s.sector);
    });
    return Array.from(set).sort();
  }, [stocks]);

  // Apply preset or custom filters
  const filteredStocks = useMemo(() => {
    return stocks.filter((stock) => {
      if (!stock.id) return false;
      const fund = fundMap.get(stock.id);
      const priceInfo = latestPriceMap.get(stock.id);
      const price = priceInfo?.price || 0;

      // Sector filter if active
      if (selectedSector !== 'ALL' && stock.sector !== selectedSector) {
        return false;
      }

      // 1. Preset: Coffee Can
      // ROCE >= 20, D/E <= 0.25, 10Y sales CAGR >= 10
      if (selectedPreset === 'coffeecan') {
        if (!fund) return false;
        const roceOk = fund.roce !== undefined && fund.roce >= 20;
        const deOk = fund.debtToEquity !== undefined && fund.debtToEquity <= 0.25;
        const salesOk = fund.salesCagr10Y !== undefined && fund.salesCagr10Y >= 10;
        return roceOk && deOk && salesOk;
      }

      // 2. Preset: Undervalued
      // price < intrinsic value
      if (selectedPreset === 'undervalued') {
        if (!fund || !fund.intrinsicValue || price <= 0) return false;
        return price < fund.intrinsicValue;
      }

      // 3. Preset: High Dividend
      // yield >= 1.5
      if (selectedPreset === 'highdividend') {
        if (!fund || fund.dividendYield === undefined) return false;
        return fund.dividendYield >= 1.5;
      }

      // 4. Preset: Near-Zero Debt
      // D/E <= 0.10
      if (selectedPreset === 'zerodebt') {
        if (!fund || fund.debtToEquity === undefined) return false;
        return fund.debtToEquity <= 0.1;
      }

      // 5. Preset: Near 52W Low (within 16%)
      if (selectedPreset === 'near52wlow') {
        if (!fund || !fund.low52W || price <= 0) return false;
        const fromLow = ((price - fund.low52W) / fund.low52W) * 100;
        return fromLow <= 16;
      }

      // 6. Custom Sliders Filter
      if (selectedPreset === 'custom') {
        if (!fund) return false;
        if (fund.roce !== undefined && fund.roce < minRoce) return false;
        if (fund.stockPE !== undefined && fund.stockPE > maxPE) return false;
        if (fund.debtToEquity !== undefined && fund.debtToEquity > maxDE) return false;
        if (fund.profitCagr10Y !== undefined && fund.profitCagr10Y < minProfitCagr) return false;
        return true;
      }

      return true;
    });
  }, [
    stocks,
    selectedPreset,
    fundMap,
    latestPriceMap,
    minRoce,
    maxPE,
    maxDE,
    minProfitCagr,
    selectedSector,
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Compass className="w-5 h-5 text-emerald-400" />
            <span>Investment Scanners & Dip Finders</span>
          </h2>
          <p className="text-xs text-slate-400">
            Identify quality compounding franchises, margin of safety valuations, and 52-week dip opportunities.
          </p>
        </div>
      </div>

      {/* Preset Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* 1. Coffee Can */}
        <button
          onClick={() => setSelectedPreset('coffeecan')}
          className={`p-3 rounded-xl border text-left transition-all ${
            selectedPreset === 'coffeecan'
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 shadow-md'
              : 'bg-[#111827] border-slate-800 text-slate-300 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Coffee className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold">Coffee Can</span>
          </div>
          <span className="text-[10px] text-slate-400 block">
            ROCE ≥ 20%, D/E ≤ 0.25, 10Y Sales ≥ 10%
          </span>
        </button>

        {/* 2. Undervalued */}
        <button
          onClick={() => setSelectedPreset('undervalued')}
          className={`p-3 rounded-xl border text-left transition-all ${
            selectedPreset === 'undervalued'
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-md'
              : 'bg-[#111827] border-slate-800 text-slate-300 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Gem className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold">Undervalued</span>
          </div>
          <span className="text-[10px] text-slate-400 block">
            Market Price &lt; Intrinsic Value
          </span>
        </button>

        {/* 3. High Dividend */}
        <button
          onClick={() => setSelectedPreset('highdividend')}
          className={`p-3 rounded-xl border text-left transition-all ${
            selectedPreset === 'highdividend'
              ? 'bg-teal-500/15 border-teal-500/40 text-teal-300 shadow-md'
              : 'bg-[#111827] border-slate-800 text-slate-300 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Coins className="w-4 h-4 text-teal-400" />
            <span className="text-xs font-bold">High Dividend</span>
          </div>
          <span className="text-[10px] text-slate-400 block">
            Dividend Yield ≥ 1.5%
          </span>
        </button>

        {/* 4. Zero Debt */}
        <button
          onClick={() => setSelectedPreset('zerodebt')}
          className={`p-3 rounded-xl border text-left transition-all ${
            selectedPreset === 'zerodebt'
              ? 'bg-blue-500/15 border-blue-500/40 text-blue-300 shadow-md'
              : 'bg-[#111827] border-slate-800 text-slate-300 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-bold">Near-Zero Debt</span>
          </div>
          <span className="text-[10px] text-slate-400 block">
            Debt to Equity ≤ 0.10
          </span>
        </button>

        {/* 5. Near 52W Low */}
        <button
          onClick={() => setSelectedPreset('near52wlow')}
          className={`p-3 rounded-xl border text-left transition-all ${
            selectedPreset === 'near52wlow'
              ? 'bg-purple-500/15 border-purple-500/40 text-purple-300 shadow-md'
              : 'bg-[#111827] border-slate-800 text-slate-300 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="w-4 h-4 text-purple-400" />
            <span className="text-xs font-bold">Near 52W Low</span>
          </div>
          <span className="text-[10px] text-slate-400 block">
            Within 16% of 52-week low
          </span>
        </button>

        {/* 6. Custom Sliders */}
        <button
          onClick={() => setSelectedPreset('custom')}
          className={`p-3 rounded-xl border text-left transition-all ${
            selectedPreset === 'custom'
              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 shadow-md'
              : 'bg-[#111827] border-slate-800 text-slate-300 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold">Custom Sliders</span>
          </div>
          <span className="text-[10px] text-slate-400 block">
            Fine-tune metrics & sector
          </span>
        </button>
      </div>

      {/* Custom Sliders Panel (Shown when custom preset is active) */}
      {selectedPreset === 'custom' && (
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-emerald-400" />
              <span>Custom Metric Sliders</span>
            </span>
            <button
              onClick={() => {
                setMinRoce(15);
                setMaxPE(50);
                setMaxDE(0.5);
                setMinProfitCagr(8);
                setSelectedSector('ALL');
              }}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Defaults</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-xs">
            {/* Min ROCE */}
            <div>
              <div className="flex justify-between mb-1.5">
                <span className="text-slate-400">Min ROCE (%):</span>
                <span className="font-bold text-emerald-400 tabular-nums">{minRoce}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="40"
                step="1"
                value={minRoce}
                onChange={(e) => setMinRoce(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </div>

            {/* Max PE */}
            <div>
              <div className="flex justify-between mb-1.5">
                <span className="text-slate-400">Max Stock P/E:</span>
                <span className="font-bold text-emerald-400 tabular-nums">{maxPE}x</span>
              </div>
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={maxPE}
                onChange={(e) => setMaxPE(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </div>

            {/* Max Debt/Equity */}
            <div>
              <div className="flex justify-between mb-1.5">
                <span className="text-slate-400">Max Debt / Equity:</span>
                <span className="font-bold text-emerald-400 tabular-nums">{maxDE}</span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={maxDE}
                onChange={(e) => setMaxDE(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </div>

            {/* Min 10Y Profit CAGR */}
            <div>
              <div className="flex justify-between mb-1.5">
                <span className="text-slate-400">Min 10Y Profit CAGR:</span>
                <span className="font-bold text-emerald-400 tabular-nums">{minProfitCagr}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="25"
                step="1"
                value={minProfitCagr}
                onChange={(e) => setMinProfitCagr(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </div>

            {/* Sector Selector */}
            <div>
              <label className="block text-slate-400 mb-1.5 font-semibold">Sector Filter:</label>
              <select
                value={selectedSector}
                onChange={(e) => setSelectedSector(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-900 text-xs text-white rounded-lg border border-slate-700 focus:outline-none focus:border-emerald-500"
              >
                <option value="ALL">All Sectors ({stocks.length})</option>
                {allSectors.map((sec) => (
                  <option key={sec} value={sec}>
                    {sec}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Results Table */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">
              Scanner Matches: {filteredStocks.length} Stocks Identified
            </h3>
            <p className="text-[11px] text-slate-400">
              Preset active: <strong className="text-emerald-400 uppercase">{selectedPreset}</strong>
            </p>
          </div>
        </div>

        {filteredStocks.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            No stocks matched the active scanner criteria. Try lowering the threshold or importing more stock fundamentals in the Import / Export center.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Stock</th>
                  <th className="py-3 px-3 text-right">Price (₹)</th>
                  <th className="py-3 px-3 text-right">ROCE (%)</th>
                  <th className="py-3 px-3 text-right">P/E</th>
                  <th className="py-3 px-3 text-right">D/E</th>
                  <th className="py-3 px-3 text-right">10Y Profit CAGR</th>
                  <th className="py-3 px-3 text-right">Div Yield (%)</th>
                  <th className="py-3 px-3">Passive Signals</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredStocks.map((stock) => {
                  const fund = fundMap.get(stock.id!);
                  const priceInfo = latestPriceMap.get(stock.id!);
                  const price = priceInfo?.price || 0;
                  const holding = holdingMap.get(stock.id!);

                  const badges = getPassiveHighlights(
                    stock,
                    price,
                    holding?.averageBuyPrice || 0,
                    fund,
                    priceInfo?.date
                  );

                  return (
                    <tr key={stock.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white tracking-wide">{stock.symbol}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                            {stock.bseCode}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 truncate max-w-[180px]">
                          {stock.name}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right tabular-nums font-bold text-white">
                        {price > 0 ? formatINR(price) : '—'}
                      </td>

                      <td className="py-3 px-3 text-right tabular-nums font-semibold text-emerald-400">
                        {fund?.roce !== undefined ? `${fund.roce}%` : '—'}
                      </td>

                      <td className="py-3 px-3 text-right tabular-nums text-slate-300">
                        {fund?.stockPE !== undefined ? `${fund.stockPE}x` : '—'}
                      </td>

                      <td className="py-3 px-3 text-right tabular-nums text-slate-300">
                        {fund?.debtToEquity !== undefined ? fund.debtToEquity : '—'}
                      </td>

                      <td className="py-3 px-3 text-right tabular-nums text-slate-300">
                        {fund?.profitCagr10Y !== undefined ? `${fund.profitCagr10Y}%` : '—'}
                      </td>

                      <td className="py-3 px-3 text-right tabular-nums text-amber-400 font-semibold">
                        {fund?.dividendYield !== undefined ? `${fund.dividendYield}%` : '—'}
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex flex-wrap items-center gap-1">
                          {badges.slice(0, 2).map((b) => (
                            <span
                              key={b.id}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                                b.color === 'emerald'
                                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                                  : b.color === 'teal'
                                  ? 'bg-teal-500/10 text-teal-300 border-teal-500/20'
                                  : b.color === 'blue'
                                  ? 'bg-blue-500/10 text-blue-300 border-blue-500/20'
                                  : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                              }`}
                            >
                              {b.label}
                            </span>
                          ))}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => onNavigateToXRay(stock.id!)}
                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
                            title="Open Fundamental X-Ray"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onOpenAddTx(stock.id!)}
                            className="p-1 rounded text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                            title="Add BUY transaction"
                          >
                            <PlusCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
