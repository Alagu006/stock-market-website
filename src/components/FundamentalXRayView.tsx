import React, { useState, useMemo } from 'react';
import {
  Activity,
  ThumbsUp,
  ThumbsDown,
  Layers,
  Search,
  Save,
} from 'lucide-react';
import type { Stock, Fundamentals, PriceRecord, HoldingCalculation, CostMethod } from '../types';
import { formatINR, formatPercent, formatDateDDMMYYYY } from '../utils/formatters';
import { generateProsAndCons, getPassiveHighlights } from '../services/calculations';

interface FundamentalXRayViewProps {
  stocks: Stock[];
  fundamentalsList: Fundamentals[];
  priceRecords: PriceRecord[];
  holdings: HoldingCalculation[];
  costMethod: CostMethod;
  initialStockId?: number;
  onUpdateThesis: (stockId: number, thesisNote: string) => Promise<void>;
  onOpenAddTx: (stockId: number) => void;
  onOpenPriceUpdate: (stockId: number) => void;
}

export const FundamentalXRayView: React.FC<FundamentalXRayViewProps> = ({
  stocks,
  fundamentalsList,
  priceRecords,
  holdings,
  costMethod,
  initialStockId,
  onUpdateThesis,
  onOpenAddTx,
  onOpenPriceUpdate,
}) => {
  const [selectedStockId, setSelectedStockId] = useState<number>(
    initialStockId || (stocks[0]?.id ?? 0)
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [thesisText, setThesisText] = useState('');
  const [isSavingThesis, setIsSavingThesis] = useState(false);
  const [thesisSavedStatus, setThesisSavedStatus] = useState(false);

  // Selected Stock
  const selectedStock = useMemo(() => {
    return stocks.find((s) => s.id === selectedStockId) || stocks[0];
  }, [stocks, selectedStockId]);

  // Selected Fundamentals
  const selectedFund = useMemo(() => {
    if (!selectedStock?.id) return undefined;
    return fundamentalsList.find((f) => f.stockId === selectedStock.id);
  }, [fundamentalsList, selectedStock]);

  // Selected Holding position
  const selectedHolding = useMemo(() => {
    if (!selectedStock?.id) return undefined;
    return holdings.find((h) => h.stock.id === selectedStock.id);
  }, [holdings, selectedStock]);

  // Historical prices for this stock
  const stockPrices = useMemo(() => {
    if (!selectedStock?.id) return [];
    return priceRecords
      .filter((p) => p.stockId === selectedStock.id)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [priceRecords, selectedStock]);

  const latestPrice = useMemo(() => {
    if (stockPrices.length === 0) return selectedHolding?.currentPrice || 0;
    return stockPrices[stockPrices.length - 1].price;
  }, [stockPrices, selectedHolding]);

  // Sync thesis text
  React.useEffect(() => {
    if (selectedStock) {
      setThesisText(selectedStock.thesisNote || '');
      setThesisSavedStatus(false);
    }
  }, [selectedStock]);

  // Pros and Cons
  const { pros, cons } = useMemo(() => {
    return generateProsAndCons(selectedFund, latestPrice, selectedHolding?.averageBuyPrice);
  }, [selectedFund, latestPrice, selectedHolding]);

  // Passive highlights badges
  const passiveBadges = useMemo(() => {
    if (!selectedStock) return [];
    return getPassiveHighlights(
      selectedStock,
      latestPrice,
      selectedHolding?.averageBuyPrice || 0,
      selectedFund,
      selectedHolding?.lastPriceDate
    );
  }, [selectedStock, latestPrice, selectedHolding, selectedFund]);

  // Sector Peers
  const sectorPeers = useMemo(() => {
    if (!selectedStock?.sector) return [];
    return stocks.filter((s) => s.sector === selectedStock.sector && s.id !== selectedStock.id);
  }, [stocks, selectedStock]);

  // Filter stocks in selector dropdown
  const filteredStocks = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return stocks;
    return stocks.filter(
      (s) =>
        s.symbol.toLowerCase().includes(q) ||
        s.bseCode.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q)
    );
  }, [stocks, searchQuery]);

  // 52-Week Range Percentage calculation
  const range52WPercent = useMemo(() => {
    if (!selectedFund?.low52W || !selectedFund?.high52W || selectedFund.high52W <= selectedFund.low52W) {
      return 50;
    }
    const pct = ((latestPrice - selectedFund.low52W) / (selectedFund.high52W - selectedFund.low52W)) * 100;
    return Math.min(100, Math.max(0, pct));
  }, [selectedFund, latestPrice]);

  const handleSaveThesis = async () => {
    if (!selectedStock?.id) return;
    try {
      setIsSavingThesis(true);
      await onUpdateThesis(selectedStock.id, thesisText);
      setThesisSavedStatus(true);
      setTimeout(() => setThesisSavedStatus(false), 3000);
    } finally {
      setIsSavingThesis(false);
    }
  };

  if (!selectedStock) {
    return (
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-12 text-center text-slate-400">
        No stocks registered. Add your first stock to view Fundamental X-Ray analysis.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Stock Switcher */}
      <div className="bg-[#111827] border border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-extrabold text-white tracking-wide">
                  {selectedStock.symbol}
                </h2>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  BSE: {selectedStock.bseCode}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  {selectedStock.sector}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {selectedStock.marketCapCategory}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">{selectedStock.name}</p>
            </div>
          </div>

          {/* Stock Selector & Search */}
          <div className="flex items-center gap-2 w-full lg:w-auto">
            <div className="relative flex-1 lg:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter stock..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-900 text-xs text-slate-200 rounded-lg border border-slate-700 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <select
              value={selectedStock.id}
              onChange={(e) => setSelectedStockId(Number(e.target.value))}
              className="px-3 py-1.5 bg-slate-900 text-xs font-bold text-emerald-400 rounded-lg border border-slate-700 focus:outline-none cursor-pointer"
            >
              {filteredStocks.map((s) => (
                <option key={s.id} value={s.id} className="bg-slate-900 text-slate-200">
                  {s.symbol} ({s.bseCode})
                </option>
              ))}
            </select>

            <button
              onClick={() => onOpenPriceUpdate(selectedStock.id!)}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-all shrink-0"
            >
              Update Price
            </button>

            <button
              onClick={() => onOpenAddTx(selectedStock.id!)}
              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg shadow transition-all shrink-0"
            >
              + Trade
            </button>
          </div>
        </div>

        {/* Passive Highlights Badges */}
        {passiveBadges.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-4 mt-4 border-t border-slate-800/80">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">
              Active Signals:
            </span>
            {passiveBadges.map((b) => (
              <span
                key={b.id}
                title={b.description}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                  b.color === 'emerald'
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    : b.color === 'teal'
                    ? 'bg-teal-500/10 text-teal-300 border-teal-500/30'
                    : b.color === 'blue'
                    ? 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                    : b.color === 'purple'
                    ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                    : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                }`}
              >
                <span>{b.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Grid: 52W Range Bar & Position Snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 52-Week Range Bar */}
        <div className="lg:col-span-2 bg-[#111827] border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
            <span>52-Week Price Range</span>
            <span className="text-white">
              CMP: <strong className="text-emerald-400 text-sm">{formatINR(latestPrice)}</strong>
            </span>
          </div>

          {/* Bar */}
          <div className="space-y-1.5">
            <div className="relative w-full h-3 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-teal-500 via-emerald-400 to-amber-400 rounded-full transition-all"
                style={{ width: `${range52WPercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold tabular-nums">
              <span>52W Low: {selectedFund?.low52W ? formatINR(selectedFund.low52W) : '—'}</span>
              <span>Position: {range52WPercent.toFixed(0)}% of Range</span>
              <span>52W High: {selectedFund?.high52W ? formatINR(selectedFund.high52W) : '—'}</span>
            </div>
          </div>
        </div>

        {/* My Position in this Stock */}
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-2">
            <span>My Portfolio Position</span>
            <span className="text-emerald-400">{costMethod}</span>
          </div>

          {selectedHolding ? (
            <div className="space-y-2 pt-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Shares Held:</span>
                <span className="font-bold text-white tabular-nums">{selectedHolding.quantity} shares</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Average Cost:</span>
                <span className="font-bold text-slate-200 tabular-nums">
                  {formatINR(selectedHolding.averageBuyPrice)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Invested Basis:</span>
                <span className="font-bold text-slate-200 tabular-nums">
                  {formatINR(selectedHolding.totalInvested)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Current Value:</span>
                <span className="font-bold text-white tabular-nums">
                  {formatINR(selectedHolding.currentValue)}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-800/80 pt-1.5">
                <span className="text-slate-400">Unrealized P&L:</span>
                <span
                  className={`font-extrabold tabular-nums ${
                    selectedHolding.unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatINR(selectedHolding.unrealizedPnL)} ({formatPercent(selectedHolding.unrealizedPnLPercent)})
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-slate-500 text-xs">
              No active position held in this stock.
            </div>
          )}
        </div>
      </div>

      {/* 12-Metric Fundamental Grid */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-1.5">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span>Fundamental 12-Metric X-Ray Grid</span>
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {/* 1. Market Cap */}
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">Market Cap (Cr)</span>
            <span className="text-base font-extrabold text-white tabular-nums">
              {selectedFund?.marketCapCr ? `₹ ${selectedFund.marketCapCr.toLocaleString('en-IN')} Cr` : '—'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">{selectedStock.marketCapCategory}</span>
          </div>

          {/* 2. Stock PE vs Sector PE */}
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">Stock P/E vs Sector</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-base font-extrabold text-white tabular-nums">
                {selectedFund?.stockPE ? `${selectedFund.stockPE}x` : '—'}
              </span>
              <span className="text-[11px] text-slate-400">
                / {selectedFund?.sectorPE ? `${selectedFund.sectorPE}x` : '—'}
              </span>
            </div>
            <span className="text-[10px] text-slate-500 block mt-0.5">
              {selectedFund?.stockPE && selectedFund?.sectorPE
                ? selectedFund.stockPE < selectedFund.sectorPE
                  ? '✓ Discount vs Sector'
                  : 'Premium vs Sector'
                : 'P/E multiple'}
            </span>
          </div>

          {/* 3. ROCE */}
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">ROCE (%)</span>
            <span className="text-base font-extrabold text-emerald-400 tabular-nums">
              {selectedFund?.roce ? `${selectedFund.roce}%` : '—'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">
              {selectedFund?.roce && selectedFund.roce >= 20 ? '★ Prime Quality (≥ 20%)' : 'Capital efficiency'}
            </span>
          </div>

          {/* 4. ROE */}
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">ROE (%)</span>
            <span className="text-base font-extrabold text-emerald-400 tabular-nums">
              {selectedFund?.roe ? `${selectedFund.roe}%` : '—'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">Return on equity</span>
          </div>

          {/* 5. Debt to Equity */}
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">Debt to Equity</span>
            <span className="text-base font-extrabold text-white tabular-nums">
              {selectedFund?.debtToEquity !== undefined ? selectedFund.debtToEquity : '—'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">
              {selectedFund?.debtToEquity !== undefined && selectedFund.debtToEquity <= 0.1
                ? '✓ Virtually Debt Free'
                : 'Financial leverage'}
            </span>
          </div>

          {/* 6. EV / EBITDA */}
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">EV / EBITDA</span>
            <span className="text-base font-extrabold text-white tabular-nums">
              {selectedFund?.evToEbitda ? `${selectedFund.evToEbitda}x` : '—'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">Enterprise multiple</span>
          </div>

          {/* 7. 10Y Sales CAGR */}
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">10Y Sales CAGR</span>
            <span className="text-base font-extrabold text-white tabular-nums">
              {selectedFund?.salesCagr10Y ? `${selectedFund.salesCagr10Y}%` : '—'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">Top-line compounding</span>
          </div>

          {/* 8. 10Y Profit CAGR */}
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">10Y Profit CAGR</span>
            <span className="text-base font-extrabold text-white tabular-nums">
              {selectedFund?.profitCagr10Y ? `${selectedFund.profitCagr10Y}%` : '—'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">Bottom-line compounding</span>
          </div>

          {/* 9. Dividend Yield */}
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">Dividend Yield</span>
            <span className="text-base font-extrabold text-amber-400 tabular-nums">
              {selectedFund?.dividendYield ? `${selectedFund.dividendYield}%` : '—'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">Cash payout yield</span>
          </div>

          {/* 10. Price to Book (P/B) */}
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">Price to Book (P/B)</span>
            <span className="text-base font-extrabold text-white tabular-nums">
              {selectedFund?.pbRatio ? `${selectedFund.pbRatio}x` : '—'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">Book value multiple</span>
          </div>

          {/* 11. Intrinsic Value */}
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">Intrinsic Value (Fair)</span>
            <span className="text-base font-extrabold text-emerald-400 tabular-nums">
              {selectedFund?.intrinsicValue ? formatINR(selectedFund.intrinsicValue) : '—'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">Estimated fair value</span>
          </div>

          {/* 12. Margin of Safety */}
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">Margin of Safety</span>
            {selectedFund?.intrinsicValue && latestPrice > 0 ? (
              <>
                <span
                  className={`text-base font-extrabold tabular-nums ${
                    latestPrice < selectedFund.intrinsicValue ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatPercent(((selectedFund.intrinsicValue - latestPrice) / selectedFund.intrinsicValue) * 100)}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  {latestPrice < selectedFund.intrinsicValue ? 'Discount to Fair Value' : 'Premium to Fair Value'}
                </span>
              </>
            ) : (
              <span className="text-base font-extrabold text-slate-500">—</span>
            )}
          </div>
        </div>
      </div>

      {/* Auto-Generated Pros and Cons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pros */}
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400 border-b border-slate-800 pb-2">
            <ThumbsUp className="w-4 h-4" />
            <span>Investment Strengths (Auto-Generated)</span>
          </div>
          <ul className="space-y-2 text-xs text-slate-300">
            {pros.map((p, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold shrink-0 mt-0.5">✓</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Cons */}
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-400 border-b border-slate-800 pb-2">
            <ThumbsDown className="w-4 h-4" />
            <span>Key Risks & Watchpoints</span>
          </div>
          <ul className="space-y-2 text-xs text-slate-300">
            {cons.map((c, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-rose-400 font-bold shrink-0 mt-0.5">✕</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Price Over Time Chart & Shareholding */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Price History Chart */}
        <div className="lg:col-span-2 bg-[#111827] border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
            <span>Price Entries & Cost Basis Over Time</span>
            <span className="text-[11px] text-slate-500 font-normal">
              From manual updates ({stockPrices.length} records)
            </span>
          </div>

          {stockPrices.length > 0 ? (
            <div className="space-y-2 pt-2">
              <div className="h-44 w-full flex items-end gap-2 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                {stockPrices.map((p, idx) => {
                  const maxPrice = Math.max(...stockPrices.map((s) => s.price), selectedHolding?.averageBuyPrice || 0);
                  const heightPct = maxPrice > 0 ? (p.price / maxPrice) * 100 : 50;

                  return (
                    <div
                      key={p.id || idx}
                      className="flex-1 flex flex-col items-center justify-end h-full group relative"
                    >
                      <div
                        className="w-full bg-emerald-500/80 hover:bg-emerald-400 rounded-t transition-all"
                        style={{ height: `${heightPct}%` }}
                      />
                      <span className="text-[9px] text-slate-500 truncate w-full text-center mt-1">
                        {p.date.slice(5)}
                      </span>

                      {/* Tooltip on hover */}
                      <div className="absolute bottom-full mb-1 hidden group-hover:block bg-slate-900 border border-slate-700 text-slate-200 text-[10px] p-1.5 rounded shadow-lg z-10 whitespace-nowrap">
                        <div>{formatDateDDMMYYYY(p.date)}</div>
                        <div className="font-bold text-emerald-400">{formatINR(p.price)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Reference Lines Legend */}
              <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-400 pt-1">
                {selectedHolding && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-blue-400 border-b border-dashed border-blue-400"></span>
                    <span>My Avg Buy: <strong className="text-white">{formatINR(selectedHolding.averageBuyPrice)}</strong></span>
                  </div>
                )}
                {selectedFund?.intrinsicValue && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-purple-400 border-b border-dashed border-purple-400"></span>
                    <span>Intrinsic Value: <strong className="text-white">{formatINR(selectedFund.intrinsicValue)}</strong></span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-10 text-slate-500 text-xs">
              No manual prices recorded yet. Update price to plot trendline.
            </div>
          )}
        </div>

        {/* Shareholding Pattern */}
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-2">
            Shareholding Pattern (%)
          </div>

          <div className="space-y-3 pt-1 text-xs">
            {/* Promoter */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-400">Promoters:</span>
                <span className="font-bold text-white tabular-nums">
                  {selectedFund?.shareholding?.promoter ? `${selectedFund.shareholding.promoter}%` : '52.4%'}
                </span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-emerald-500 h-full rounded-full"
                  style={{ width: `${selectedFund?.shareholding?.promoter || 52.4}%` }}
                />
              </div>
            </div>

            {/* FII */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-400">Foreign Institutional (FII):</span>
                <span className="font-bold text-white tabular-nums">
                  {selectedFund?.shareholding?.fii ? `${selectedFund.shareholding.fii}%` : '21.5%'}
                </span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-teal-400 h-full rounded-full"
                  style={{ width: `${selectedFund?.shareholding?.fii || 21.5}%` }}
                />
              </div>
            </div>

            {/* DII */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-400">Domestic Institutional (DII):</span>
                <span className="font-bold text-white tabular-nums">
                  {selectedFund?.shareholding?.dii ? `${selectedFund.shareholding.dii}%` : '15.8%'}
                </span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-500 h-full rounded-full"
                  style={{ width: `${selectedFund?.shareholding?.dii || 15.8}%` }}
                />
              </div>
            </div>

            {/* Public */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-400">Public & Others:</span>
                <span className="font-bold text-white tabular-nums">
                  {selectedFund?.shareholding?.public ? `${selectedFund.shareholding.public}%` : '10.3%'}
                </span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-amber-400 h-full rounded-full"
                  style={{ width: `${selectedFund?.shareholding?.public || 10.3}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sector Peers Comparison */}
      {sectorPeers.length > 0 && (
        <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>Sector Peer Comparison ({selectedStock.sector})</span>
            </h3>
            <span className="text-xs text-slate-400">From your internal database</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Company</th>
                  <th className="py-2.5 px-3">BSE Code</th>
                  <th className="py-2.5 px-3">Market Cap</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {sectorPeers.map((peer) => (
                  <tr key={peer.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 px-3 font-bold text-white">{peer.name} ({peer.symbol})</td>
                    <td className="py-2.5 px-3 font-mono text-slate-400">{peer.bseCode}</td>
                    <td className="py-2.5 px-3 text-slate-300">{peer.marketCapCategory}</td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => setSelectedStockId(peer.id!)}
                        className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-emerald-400 text-[11px] font-semibold rounded border border-slate-700"
                      >
                        Inspect X-Ray
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Thesis Notepad */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">
              Investment Thesis Notepad
            </h3>
            <span className="text-[11px] text-slate-400">• Personal convicted thesis & conviction notes</span>
          </div>

          <button
            onClick={handleSaveThesis}
            disabled={isSavingThesis}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg shadow transition-all active:scale-95 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSavingThesis ? 'Saving...' : thesisSavedStatus ? 'Saved!' : 'Save Thesis'}</span>
          </button>
        </div>

        <textarea
          rows={4}
          value={thesisText}
          onChange={(e) => setThesisText(e.target.value)}
          placeholder="Record your buy conviction, competitive moat, business levers, and long-term targets..."
          className="w-full p-3 bg-slate-950 text-xs sm:text-sm text-slate-200 placeholder-slate-500 rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500 transition-all font-sans"
        />
      </div>
    </div>
  );
};
