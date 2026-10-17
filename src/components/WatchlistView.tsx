import React, { useState, useMemo } from 'react';
import {
  Bookmark,
  Star,
  Search,
  PlusCircle,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import type { Stock, Fundamentals, PriceRecord, HoldingCalculation } from '../types';
import { formatINR, formatDateDDMMYYYY } from '../utils/formatters';
import { getPassiveHighlights } from '../services/calculations';

interface WatchlistViewProps {
  stocks: Stock[];
  fundamentalsList: Fundamentals[];
  priceRecords: PriceRecord[];
  holdings: HoldingCalculation[];
  onToggleWatchlist: (stockId: number, currentStatus: boolean) => Promise<void>;
  onUpdateTargetBuyPrice: (stockId: number, price: number | undefined) => Promise<void>;
  onOpenAddTx: (stockId: number) => void;
  onNavigateToXRay: (stockId: number) => void;
}

export const WatchlistView: React.FC<WatchlistViewProps> = ({
  stocks,
  fundamentalsList,
  priceRecords,
  holdings,
  onToggleWatchlist,
  onUpdateTargetBuyPrice,
  onOpenAddTx,
  onNavigateToXRay,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyInBuyZone, setOnlyInBuyZone] = useState(false);
  const [selectedSector, setSelectedSector] = useState<string>('ALL');
  const [editingTargetId, setEditingTargetId] = useState<number | null>(null);
  const [targetInputVal, setTargetInputVal] = useState<string>('');

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
    for (const f of fundamentalsList) {
      map.set(f.stockId, f);
    }
    return map;
  }, [fundamentalsList]);

  // Holdings map
  const holdingMap = useMemo(() => {
    const map = new Map<number, HoldingCalculation>();
    for (const h of holdings) {
      if (h.stock.id) map.set(h.stock.id, h);
    }
    return map;
  }, [holdings]);

  // Watchlisted Stocks (or all stocks if none are bookmarked yet)
  const watchlistedStocks = useMemo(() => {
    return stocks.filter((s) => s.watchlist);
  }, [stocks]);

  // Unique Sectors
  const sectors = useMemo(() => {
    const set = new Set<string>();
    stocks.forEach((s) => set.add(s.sector));
    return ['ALL', ...Array.from(set).sort()];
  }, [stocks]);

  // Evaluated items
  const evaluatedItems = useMemo(() => {
    const sourceList = watchlistedStocks.length > 0 ? watchlistedStocks : stocks;

    return sourceList.map((stock) => {
      const priceInfo = stock.id ? latestPriceMap.get(stock.id) : undefined;
      const cmp = priceInfo?.price || 0;
      const fund = stock.id ? fundMap.get(stock.id) : undefined;
      const holding = stock.id ? holdingMap.get(stock.id) : undefined;
      const avgBuy = holding?.averageBuyPrice || 0;

      const badges = getPassiveHighlights(
        stock,
        cmp,
        avgBuy,
        fund,
        priceInfo?.date || null
      );

      // Margin of Safety vs Target Price: ((Target - CMP) / CMP) * 100
      let marginOfSafetyPct: number | null = null;
      let inBuyZone = false;

      if (stock.targetBuyPrice && cmp > 0) {
        marginOfSafetyPct = ((stock.targetBuyPrice - cmp) / cmp) * 100;
        inBuyZone = cmp <= stock.targetBuyPrice;
      }

      // Margin of safety vs Intrinsic Value if available
      let intrinsicMarginPct: number | null = null;
      if (fund?.intrinsicValue && cmp > 0) {
        intrinsicMarginPct = ((fund.intrinsicValue - cmp) / fund.intrinsicValue) * 100;
      }

      return {
        stock,
        cmp,
        lastPriceDate: priceInfo?.date || null,
        fund,
        holding,
        badges,
        marginOfSafetyPct,
        intrinsicMarginPct,
        inBuyZone,
      };
    });
  }, [watchlistedStocks, stocks, latestPriceMap, fundMap, holdingMap]);

  // Filter items
  const filteredItems = useMemo(() => {
    return evaluatedItems.filter((item) => {
      if (onlyInBuyZone && !item.inBuyZone) return false;
      if (selectedSector !== 'ALL' && item.stock.sector !== selectedSector) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const sym = item.stock.symbol.toLowerCase();
        const name = item.stock.name.toLowerCase();
        const bse = item.stock.bseCode.toLowerCase();
        if (!sym.includes(q) && !name.includes(q) && !bse.includes(q)) return false;
      }
      return true;
    });
  }, [evaluatedItems, onlyInBuyZone, selectedSector, searchQuery]);

  // Start editing target buy price
  const handleStartEditTarget = (stockId: number, currentTarget?: number) => {
    setEditingTargetId(stockId);
    setTargetInputVal(currentTarget ? currentTarget.toString() : '');
  };

  const handleSaveTarget = async (stockId: number) => {
    const val = parseFloat(targetInputVal);
    await onUpdateTargetBuyPrice(stockId, isNaN(val) || val <= 0 ? undefined : val);
    setEditingTargetId(null);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 p-5 rounded-2xl border border-slate-800 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <Bookmark className="w-6 h-6 text-amber-400" />
              Buy-Zone Watchlist & Margin of Safety
            </h1>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Disciplined Value Investing
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Never chase prices. Define your predetermined target buy prices and seize opportunities when market dips present adequate margin of safety.
          </p>
        </div>

        {/* Quick KPI Badge */}
        <div className="flex items-center gap-3">
          <div className="bg-slate-950 px-4 py-2 rounded-xl border border-slate-800 text-xs">
            <span className="text-slate-400">In Buy Zone: </span>
            <strong className="text-emerald-400 font-extrabold text-sm ml-1">
              {evaluatedItems.filter((i) => i.inBuyZone).length}
            </strong>
            <span className="text-slate-500 mx-1.5">/</span>
            <span className="text-slate-300 font-bold">{evaluatedItems.length} Tracked</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/80 p-4 rounded-xl border border-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search watchlist..."
              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Sector filter */}
          <select
            value={selectedSector}
            onChange={(e) => setSelectedSector(e.target.value)}
            className="bg-slate-950 border border-slate-700 text-xs font-semibold text-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-emerald-500"
          >
            {sectors.map((sec) => (
              <option key={sec} value={sec}>
                {sec === 'ALL' ? 'All Sectors' : sec}
              </option>
            ))}
          </select>

          {/* Buy Zone toggle */}
          <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 ml-1">
            <input
              type="checkbox"
              checked={onlyInBuyZone}
              onChange={(e) => setOnlyInBuyZone(e.target.checked)}
              className="rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-0"
            />
            <span className="font-semibold text-emerald-400">Show Buy-Zone Opportunities Only</span>
          </label>
        </div>

        <span className="text-[11px] text-slate-400 self-end sm:self-auto">
          {filteredItems.length} stocks shown
        </span>
      </div>

      {/* Watchlist Table */}
      <div className="bg-slate-900/90 rounded-2xl border border-slate-800 overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
              <tr>
                <th className="py-3 px-4 font-semibold text-center w-12">Track</th>
                <th className="py-3 px-4 font-semibold">Stock</th>
                <th className="py-3 px-4 font-semibold">Sector</th>
                <th className="py-3 px-4 font-semibold text-right">Manual CMP</th>
                <th className="py-3 px-4 font-semibold text-right">Target Buy Price</th>
                <th className="py-3 px-4 font-semibold text-right">Intrinsic Value</th>
                <th className="py-3 px-4 font-semibold text-right">Margin of Safety</th>
                <th className="py-3 px-4 font-semibold">Passive Highlights</th>
                <th className="py-3 px-4 font-semibold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500">
                    <Bookmark className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                    <p className="font-semibold text-slate-400">No stocks match your filter.</p>
                    <p className="text-xs text-slate-600 mt-1">
                      Star any stock from your Stocks Master list or Scanners to build your Watchlist.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const s = item.stock;
                  const isEditingTarget = editingTargetId === s.id;

                  return (
                    <tr
                      key={s.id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        item.inBuyZone ? 'bg-emerald-500/5' : ''
                      }`}
                    >
                      {/* Star Watchlist Toggle */}
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => s.id && onToggleWatchlist(s.id, !!s.watchlist)}
                          className={`p-1 rounded transition-colors ${
                            s.watchlist
                              ? 'text-amber-400 hover:text-amber-300'
                              : 'text-slate-600 hover:text-slate-400'
                          }`}
                          title={s.watchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                        >
                          <Star className={`w-4 h-4 ${s.watchlist ? 'fill-amber-400' : ''}`} />
                        </button>
                      </td>

                      {/* Stock Info */}
                      <td className="py-3.5 px-4 font-bold text-white">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => s.id && onNavigateToXRay(s.id)}
                            className="hover:text-emerald-400 transition-colors text-left"
                            title="Open Fundamental X-Ray"
                          >
                            <span>{s.symbol}</span>
                          </button>
                          <span className="text-[10px] text-slate-400 font-mono font-normal">
                            {s.bseCode}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-normal truncate max-w-[150px]">
                          {s.name}
                        </div>
                      </td>

                      {/* Sector */}
                      <td className="py-3.5 px-4 text-slate-400">{s.sector}</td>

                      {/* CMP */}
                      <td className="py-3.5 px-4 text-right font-bold text-slate-100">
                        {item.cmp > 0 ? (
                          <div>
                            <span>{formatINR(item.cmp)}</span>
                            {item.lastPriceDate && (
                              <div className="text-[10px] text-slate-500 font-normal">
                                {formatDateDDMMYYYY(item.lastPriceDate)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-600">--</span>
                        )}
                      </td>

                      {/* Target Buy Price (Editable) */}
                      <td className="py-3.5 px-4 text-right">
                        {isEditingTarget ? (
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="number"
                              step="any"
                              value={targetInputVal}
                              onChange={(e) => setTargetInputVal(e.target.value)}
                              placeholder="₹ Target"
                              className="w-20 bg-slate-950 border border-emerald-500 rounded px-1.5 py-0.5 text-xs text-white"
                              autoFocus
                            />
                            <button
                              onClick={() => s.id && handleSaveTarget(s.id)}
                              className="p-1 bg-emerald-500 text-slate-950 rounded hover:bg-emerald-400"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => s.id && handleStartEditTarget(s.id, s.targetBuyPrice)}
                            className="font-bold text-amber-300 hover:text-amber-200 underline decoration-dotted underline-offset-4"
                            title="Click to edit target price"
                          >
                            {s.targetBuyPrice ? formatINR(s.targetBuyPrice) : 'Set Target'}
                          </button>
                        )}
                      </td>

                      {/* Intrinsic Value */}
                      <td className="py-3.5 px-4 text-right text-slate-300 font-medium">
                        {item.fund?.intrinsicValue ? formatINR(item.fund.intrinsicValue) : '--'}
                      </td>

                      {/* Margin of Safety */}
                      <td className="py-3.5 px-4 text-right">
                        {item.marginOfSafetyPct !== null ? (
                          <span
                            className={`px-2 py-0.5 rounded font-extrabold text-xs ${
                              item.marginOfSafetyPct >= 0
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {item.marginOfSafetyPct >= 0
                              ? `+${item.marginOfSafetyPct.toFixed(1)}%`
                              : `${item.marginOfSafetyPct.toFixed(1)}%`}
                          </span>
                        ) : item.intrinsicMarginPct !== null ? (
                          <span className="text-xs text-blue-400 font-semibold">
                            {item.intrinsicMarginPct.toFixed(1)}% (Intr)
                          </span>
                        ) : (
                          <span className="text-slate-600">--</span>
                        )}
                      </td>

                      {/* Passive Highlights */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {item.badges.length === 0 ? (
                            <span className="text-slate-600 text-[11px]">No alerts</span>
                          ) : (
                            item.badges.map((b) => (
                              <span
                                key={b.id}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                  b.color === 'emerald'
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                    : b.color === 'teal'
                                    ? 'bg-teal-500/10 text-teal-300 border-teal-500/20'
                                    : b.color === 'blue'
                                    ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                    : b.color === 'purple'
                                    ? 'bg-purple-500/10 text-purple-300 border-purple-500/20'
                                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                }`}
                                title={b.description}
                              >
                                {b.label}
                              </span>
                            ))
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => s.id && onOpenAddTx(s.id)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded shadow-sm transition-all"
                            title="Record Buy transaction"
                          >
                            <PlusCircle className="w-3.5 h-3.5" />
                            <span>Buy</span>
                          </button>
                          <button
                            onClick={() => s.id && onNavigateToXRay(s.id)}
                            className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
                            title="Deep dive in Fundamental X-Ray"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
