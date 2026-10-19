import React from 'react';
import {
  TrendingUp,
  Clock,
  AlertTriangle,
  History,
  Target,
  PlusCircle,
  Edit3,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import type { HoldingCalculation, CostMethod } from '../types';
import { formatINR, formatPercent, formatDateDDMMYYYY, formatDaysAgo } from '../utils/formatters';

interface HoldingsTableProps {
  holdings: HoldingCalculation[];
  costMethod: CostMethod;
  onOpenLotHistory: (stockId: number) => void;
  onOpenTargetAvg: (stockId: number) => void;
  onOpenAddTxForStock: (stockId: number) => void;
  onOpenPriceUpdate: (stockId: number) => void;
  onSeedSampleData: () => void;
  onOpenStockMaster: () => void;
}

export const HoldingsTable: React.FC<HoldingsTableProps> = ({
  holdings,
  costMethod,
  onOpenLotHistory,
  onOpenTargetAvg,
  onOpenAddTxForStock,
  onOpenPriceUpdate,
  onSeedSampleData,
  onOpenStockMaster,
}) => {
  if (holdings.length === 0) {
    return (
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-8 sm:p-12 text-center shadow-sm">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-4">
          <TrendingUp className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold text-white mb-2">No Active Holdings Recorded</h3>
        <p className="text-sm text-slate-400 max-w-md mx-auto mb-6">
          Dalal Diary's is ready. Add your first stock and record your initial buy transaction, or load sample Indian blue-chips to test the calculations and features immediately.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={onOpenStockMaster}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded-lg text-sm transition-all"
          >
            + Add First Stock
          </button>
          <button
            onClick={onSeedSampleData}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg text-sm border border-slate-700 transition-all"
          >
            Explore with Sample Indian Portfolio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#111827] border border-slate-800 rounded-xl shadow-sm overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-white">Portfolio Holdings</h2>
          <p className="text-xs text-slate-400">
            Calculated live via <span className="text-emerald-400 font-semibold">{costMethod}</span> method
          </p>
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span> Active Holdings ({holdings.length})
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs sm:text-sm">
          <thead>
            <tr className="bg-slate-900/80 text-slate-400 border-b border-slate-800 font-semibold text-[11px] uppercase tracking-wider">
              <th className="py-3 px-4">Stock</th>
              <th className="py-3 px-3 text-right">Qty / Lots</th>
              <th className="py-3 px-3 text-right">Avg Price</th>
              <th className="py-3 px-3 text-right">Live CMP</th>
              <th className="py-3 px-4 text-right">Invested</th>
              <th className="py-3 px-4 text-right">Current Value</th>
              <th className="py-3 px-4 text-right">Unrealized P&L</th>
              <th className="py-3 px-3 text-right">ROCE / P/E</th>
              <th className="py-3 px-3 text-right">Annual Div</th>
              <th className="py-3 px-4 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {holdings.map((h) => {
              const isProfit = h.unrealizedPnL >= 0;

              return (
                <tr key={h.stock.id} className="hover:bg-slate-800/40 transition-colors">
                  {/* Stock Symbol & BSE */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white tracking-wide">{h.stock.symbol}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 tabular-nums">
                        {h.stock.bseCode}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate max-w-[150px] sm:max-w-[200px]" title={h.stock.name}>
                      {h.stock.name}
                    </div>
                  </td>

                  {/* Quantity & Lots */}
                  <td className="py-3.5 px-3 text-right tabular-nums">
                    <div className="font-semibold text-slate-200">{h.quantity}</div>
                    <div className="text-[11px] text-slate-500">
                      {h.lotsCount} {h.lotsCount === 1 ? 'lot' : 'lots'}
                    </div>
                  </td>

                  {/* Average Buy Price */}
                  <td className="py-3.5 px-3 text-right tabular-nums">
                    <div className="font-semibold text-slate-200">
                      {formatINR(h.averageBuyPrice, { showSymbol: false })}
                    </div>
                    <div className="text-[10px] text-slate-500 uppercase">{costMethod === 'FIFO' ? 'FIFO' : 'W.Avg'}</div>
                  </td>

                  {/* Live CMP with Day Change & Feed status */}
                  <td className="py-3.5 px-3 text-right tabular-nums">
                    <div className="font-bold text-white text-sm">
                      {formatINR(h.currentPrice, { showSymbol: false })}
                    </div>
                    {h.priceChange !== undefined && h.priceChangePercent !== undefined ? (
                      <div
                        className={`text-[11px] font-bold flex items-center justify-end gap-0.5 ${
                          h.priceChange >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {h.priceChange >= 0 ? '+' : ''}
                        {h.priceChange.toFixed(2)} ({h.priceChangePercent >= 0 ? '+' : ''}
                        {h.priceChangePercent.toFixed(2)}%)
                      </div>
                    ) : null}
                    <div className="flex items-center justify-end gap-1 text-[10px] mt-0.5">
                      {h.isLive ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[9px] font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span>Live Feed</span>
                        </span>
                      ) : h.isPriceStale ? (
                        <span
                          className="inline-flex items-center gap-0.5 px-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[9px] font-bold"
                          title={`Price last updated on ${formatDateDDMMYYYY(h.lastPriceDate)} (> 7 days ago)`}
                        >
                          <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                          <span>Stale</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 flex items-center gap-0.5 text-[10px]" title={formatDateDDMMYYYY(h.lastPriceDate)}>
                          <Clock className="w-2.5 h-2.5 text-slate-500" />
                          <span>{formatDaysAgo(h.lastPriceDate)}</span>
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Invested */}
                  <td className="py-3.5 px-4 text-right tabular-nums font-medium text-slate-300">
                    {formatINR(h.totalInvested)}
                  </td>

                  {/* Current Value */}
                  <td className="py-3.5 px-4 text-right tabular-nums font-semibold text-white">
                    {formatINR(h.currentValue)}
                  </td>

                  {/* Unrealized P&L */}
                  <td className="py-3.5 px-4 text-right tabular-nums">
                    <div
                      className={`font-bold flex items-center justify-end gap-0.5 ${
                        isProfit ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {isProfit ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                      {formatINR(h.unrealizedPnL)}
                    </div>
                    <div className={`text-[11px] font-semibold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatPercent(h.unrealizedPnLPercent)}
                    </div>
                  </td>

                  {/* ROCE / PE */}
                  <td className="py-3.5 px-3 text-right tabular-nums">
                    <div className="text-slate-200 font-medium">
                      {h.roce !== null ? `${h.roce.toFixed(1)}%` : '—'}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {h.pe !== null ? `${h.pe.toFixed(1)}x PE` : '—'}
                    </div>
                  </td>

                  {/* Annual Dividend */}
                  <td className="py-3.5 px-3 text-right tabular-nums">
                    <div className="text-slate-200 font-medium">
                      {formatINR(h.annualDividendIncome)}
                    </div>
                    <div className="text-[10px] text-amber-400 font-medium">
                      YoC: {formatPercent(h.yieldOnCost)}
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 px-4 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {/* Buy the Dip calculator */}
                      <button
                        onClick={() => onOpenTargetAvg(h.stock.id!)}
                        className="p-1.5 rounded-md text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 transition-all"
                        title="Target-Average Calculator (Buy the Dip)"
                      >
                        <Target className="w-4 h-4" />
                      </button>

                      {/* Lot History */}
                      <button
                        onClick={() => onOpenLotHistory(h.stock.id!)}
                        className="p-1.5 rounded-md text-slate-300 hover:bg-slate-800 hover:text-white transition-all"
                        title="View Lot History & Tranches"
                      >
                        <History className="w-4 h-4" />
                      </button>

                      {/* Update Price */}
                      <button
                        onClick={() => onOpenPriceUpdate(h.stock.id!)}
                        className="p-1.5 rounded-md text-slate-300 hover:bg-slate-800 hover:text-white transition-all"
                        title="Update Manual Price"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      {/* Add Transaction */}
                      <button
                        onClick={() => onOpenAddTxForStock(h.stock.id!)}
                        className="p-1.5 rounded-md text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300 transition-all"
                        title="Add Buy/Sell Transaction"
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
    </div>
  );
};
