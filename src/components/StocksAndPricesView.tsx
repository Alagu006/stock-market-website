import React, { useMemo } from 'react';
import {
  Building2,
  Edit3,
  PlusCircle,
  Clock,
  AlertTriangle,
  Target,
  History,
  Coins,
} from 'lucide-react';
import type { Stock, PriceRecord, CostMethod, Transaction, CorporateAction, Fundamentals } from '../types';
import { formatINR, formatDateDDMMYYYY, formatDaysAgo, isDateOlderThanDays } from '../utils/formatters';
import { calculateStockPosition } from '../services/calculations';

interface StocksAndPricesViewProps {
  stocks: Stock[];
  priceRecords: PriceRecord[];
  transactions: Transaction[];
  corporateActions: CorporateAction[];
  costMethod: CostMethod;
  searchQuery: string;
  fundamentalsList?: Fundamentals[];
  onOpenPriceUpdate: (stockId: number) => void;
  onOpenAddTx: (stockId: number) => void;
  onOpenStockMaster: () => void;
  onOpenLotHistory: (stockId: number) => void;
  onOpenTargetAvg: (stockId: number) => void;
}

export const StocksAndPricesView: React.FC<StocksAndPricesViewProps> = ({
  stocks,
  priceRecords,
  transactions,
  corporateActions,
  costMethod,
  searchQuery,
  fundamentalsList = [],
  onOpenPriceUpdate,
  onOpenAddTx,
  onOpenStockMaster,
  onOpenLotHistory,
  onOpenTargetAvg,
}) => {
  // Map latest price per stock
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

  // Filter stocks
  const filteredStocks = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return stocks;
    return stocks.filter(
      (s) =>
        s.symbol.toLowerCase().includes(q) ||
        s.bseCode.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.sector.toLowerCase().includes(q)
    );
  }, [stocks, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-slate-800 gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-emerald-400" />
            <span>Stocks Master & Manual Price Tracker</span>
          </h2>
          <p className="text-xs text-slate-400">
            All prices are entered manually. Prices older than 7 days display a stale warning.
          </p>
        </div>
        <button
          onClick={onOpenStockMaster}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-all self-start sm:self-auto"
        >
          <Building2 className="w-4 h-4" />
          <span>Manage Master List</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredStocks.map((stock) => {
          const priceInfo = latestPriceMap.get(stock.id!);
          const isStale = !priceInfo || isDateOlderThanDays(priceInfo.date, 7);
          const pos = calculateStockPosition(stock.id!, transactions, corporateActions, costMethod);
          const fund = fundamentalsList.find((f) => f.stockId === stock.id);

          return (
            <div
              key={stock.id}
              className="bg-[#111827] border border-slate-800 rounded-xl p-4 shadow-sm hover:border-slate-700 transition-all flex flex-col justify-between"
            >
              <div>
                {/* Header */}
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold text-base text-white tracking-wide">
                        {stock.symbol}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                        {stock.bseCode}
                      </span>
                      {(fund?.dividendYield || stock.dividendYield || stock.latestDividendAmount) && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30"
                          title="Dividend Details"
                        >
                          <Coins className="w-2.5 h-2.5 text-amber-400" />
                          <span>
                            {fund?.dividendYield || stock.dividendYield
                              ? `Div: ${fund?.dividendYield || stock.dividendYield}%`
                              : ''}
                            {stock.latestDividendAmount
                              ? ` • ₹${stock.latestDividendAmount}${
                                  stock.latestDividendExDate ? ` (Ex: ${stock.latestDividendExDate})` : ''
                                }`
                              : ''}
                          </span>
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 truncate max-w-[220px]" title={stock.name}>
                      {stock.name}
                    </div>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                    {stock.sector}
                  </span>
                </div>

                {/* Price Display */}
                <div className="p-3 bg-slate-900/80 border border-slate-800/80 rounded-xl my-3">
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                    <span>{priceInfo ? 'Recorded Price / CMP' : (stock.targetBuyPrice || stock.vwap ? 'Live Market Price (CMP)' : 'Manual Price')}</span>
                    <button
                      onClick={() => onOpenPriceUpdate(stock.id!)}
                      className="text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1 text-[11px]"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Update</span>
                    </button>
                  </div>

                  <div className="flex items-baseline justify-between">
                    <div className="text-xl font-extrabold text-white tabular-nums">
                      {priceInfo
                        ? formatINR(priceInfo.price)
                        : (stock.targetBuyPrice || stock.vwap)
                        ? formatINR(stock.targetBuyPrice || stock.vwap!)
                        : 'No price set'}
                    </div>

                    <div>
                      {priceInfo ? (
                        isStale ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                            <AlertTriangle className="w-3 h-3" />
                            <span>Stale ({formatDaysAgo(priceInfo?.date)})</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                            <Clock className="w-3 h-3 text-slate-500" />
                            <span>{formatDaysAgo(priceInfo?.date)}</span>
                          </span>
                        )
                      ) : (stock.targetBuyPrice || stock.vwap) ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                          Live Feed
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {priceInfo ? (
                    <div className="text-[10px] text-slate-500 mt-1">
                      Recorded on: {formatDateDDMMYYYY(priceInfo.date)}
                    </div>
                  ) : (stock.targetBuyPrice || stock.vwap) ? (
                    <div className="text-[10px] text-slate-400 mt-1">
                      Fetched from Yahoo / BSE real-time stream
                    </div>
                  ) : null}
                </div>

                {/* Position in Portfolio */}
                <div className="grid grid-cols-2 gap-2 text-xs py-1 text-slate-400">
                  <div>
                    <span>Shares Held: </span>
                    <strong className="text-white tabular-nums">{pos.quantity}</strong>
                  </div>
                  <div>
                    <span>Avg ({costMethod}): </span>
                    <strong className="text-white tabular-nums">
                      {pos.quantity > 0 ? formatINR(pos.averageBuyPrice) : '—'}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2 mt-2">
                <button
                  onClick={() => onOpenLotHistory(stock.id!)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold flex items-center gap-1 transition-all"
                >
                  <History className="w-3.5 h-3.5" />
                  <span>Tranches</span>
                </button>

                {pos.quantity > 0 && (
                  <button
                    onClick={() => onOpenTargetAvg(stock.id!)}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-semibold flex items-center gap-1 transition-all border border-amber-500/20"
                  >
                    <Target className="w-3.5 h-3.5" />
                    <span>Buy Dip</span>
                  </button>
                )}

                <button
                  onClick={() => onOpenAddTx(stock.id!)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1 transition-all shadow-sm"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>+ Tx</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
