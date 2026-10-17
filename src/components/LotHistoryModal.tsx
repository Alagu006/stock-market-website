import React, { useMemo } from 'react';
import { X, Trash2, Layers, HelpCircle } from 'lucide-react';
import type { Stock, Transaction, CorporateAction, CostMethod } from '../types';
import { calculateStockPosition } from '../services/calculations';
import { formatINR, formatDateDDMMYYYY } from '../utils/formatters';

interface LotHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  stock: Stock | undefined;
  transactions: Transaction[];
  corporateActions: CorporateAction[];
  costMethod: CostMethod;
  onDeleteTransaction: (txId: number) => Promise<void>;
}

export const LotHistoryModal: React.FC<LotHistoryModalProps> = ({
  isOpen,
  onClose,
  stock,
  transactions,
  corporateActions,
  costMethod,
  onDeleteTransaction,
}) => {
  if (!isOpen || !stock || !stock.id) return null;

  const position = useMemo(() => {
    return calculateStockPosition(stock.id!, transactions, corporateActions, costMethod);
  }, [stock, transactions, corporateActions, costMethod]);

  const handleDelete = async (txId: number | undefined) => {
    if (!txId) return;
    if (window.confirm('Are you sure you want to delete this transaction? All portfolio calculations will immediately recalculate from raw data.')) {
      await onDeleteTransaction(txId);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-[#111827] border border-slate-800 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-emerald-400" />
              <h3 className="text-base font-bold text-white">
                Lot & Tranche History: {stock.symbol} ({stock.bseCode})
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Evaluating position using <span className="text-emerald-400 font-semibold">{costMethod}</span> method
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current State Summary Banner */}
        <div className="px-6 py-3 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-slate-400">Total Shares Held: </span>
              <span className="font-bold text-white tabular-nums">{position.quantity}</span>
            </div>
            <div>
              <span className="text-slate-400">Effective Avg Cost: </span>
              <span className="font-bold text-emerald-400 tabular-nums">
                {formatINR(position.averageBuyPrice)}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Total Cost Basis: </span>
              <span className="font-bold text-white tabular-nums">
                {formatINR(position.totalCostBasis)}
              </span>
            </div>
          </div>
          <div>
            <span className="text-slate-400">Total Realized P&L: </span>
            <span
              className={`font-bold tabular-nums ${
                position.realizedPnL >= 0 ? 'text-teal-400' : 'text-rose-400'
              }`}
            >
              {formatINR(position.realizedPnL)}
            </span>
          </div>
        </div>

        {/* Informative Explanation banner */}
        <div className="px-6 py-2.5 bg-slate-900/30 text-[11px] text-slate-400 border-b border-slate-800/80 flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-slate-500 shrink-0" />
          {costMethod === 'FIFO' ? (
            <span>
              <strong>FIFO Method:</strong> Each SELL matches against the oldest available BUY lot. The table shows which lot tranches were consumed and what remaining shares exist in each BUY lot.
            </span>
          ) : (
            <span>
              <strong>Average Cost Method:</strong> The running weighted average price recalculates after every BUY. Sells book realized profit against the current running weighted average without modifying the per-share cost basis of remaining shares.
            </span>
          )}
        </div>

        {/* Transactions / Lots Table */}
        <div className="p-6 overflow-x-auto">
          {position.lotHistory.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              No transactions recorded for this stock.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900 text-slate-400 border-b border-slate-800 uppercase font-semibold text-[10px] tracking-wider">
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3 text-right">Qty</th>
                  <th className="py-2.5 px-3 text-right">Price (₹)</th>
                  <th className="py-2.5 px-3 text-right">Charges (₹)</th>
                  <th className="py-2.5 px-3 text-right">Running Shares</th>
                  {costMethod === 'Average Cost' ? (
                    <th className="py-2.5 px-3 text-right">Running W.Avg</th>
                  ) : (
                    <>
                      <th className="py-2.5 px-3 text-right">Remaining Lot Qty</th>
                      <th className="py-2.5 px-3">FIFO Consumption Details</th>
                    </>
                  )}
                  <th className="py-2.5 px-3 text-right">Realized P&L</th>
                  <th className="py-2.5 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {position.lotHistory.map((item, idx) => {
                  const isBuy = item.transaction.type === 'BUY';

                  return (
                    <tr key={item.transaction.id || idx} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-3 text-slate-300 font-medium whitespace-nowrap">
                        {formatDateDDMMYYYY(item.transaction.date)}
                      </td>

                      <td className="py-3 px-3">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded font-bold text-[10px] ${
                            isBuy
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}
                        >
                          {item.transaction.type}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-right tabular-nums font-semibold text-slate-200">
                        {item.adjustedQuantity}
                      </td>

                      <td className="py-3 px-3 text-right tabular-nums text-slate-300">
                        {formatINR(item.adjustedPrice, { showSymbol: false })}
                      </td>

                      <td className="py-3 px-3 text-right tabular-nums text-slate-400">
                        {item.transaction.charges ? formatINR(item.transaction.charges, { showSymbol: false }) : '—'}
                      </td>

                      <td className="py-3 px-3 text-right tabular-nums font-bold text-white">
                        {item.runningShares}
                      </td>

                      {/* Average Cost View */}
                      {costMethod === 'Average Cost' && (
                        <td className="py-3 px-3 text-right tabular-nums font-semibold text-emerald-400">
                          {item.runningWeightedAvg ? formatINR(item.runningWeightedAvg) : '—'}
                        </td>
                      )}

                      {/* FIFO View */}
                      {costMethod === 'FIFO' && (
                        <>
                          <td className="py-3 px-3 text-right tabular-nums">
                            {isBuy ? (
                              <span
                                className={`font-semibold ${
                                  (item.remainingQuantity ?? 0) > 0 ? 'text-emerald-400' : 'text-slate-500'
                                }`}
                              >
                                {item.remainingQuantity ?? 0} left
                              </span>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>

                          <td className="py-3 px-3">
                            {!isBuy && item.consumedLots && item.consumedLots.length > 0 ? (
                              <div className="space-y-1">
                                {item.consumedLots.map((c, i) => (
                                  <div key={i} className="text-[11px] text-slate-300 flex items-center gap-1.5">
                                    <span className="text-slate-400">{c.qtyTaken} shares</span>
                                    <span className="text-slate-500">from {formatDateDDMMYYYY(c.buyDate)}</span>
                                    <span className="text-slate-400">(@ {formatINR(c.buyPrice, { showSymbol: false })})</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                        </>
                      )}

                      {/* Realized P&L */}
                      <td className="py-3 px-3 text-right tabular-nums font-bold">
                        {item.realizedPnL !== undefined ? (
                          <span className={item.realizedPnL >= 0 ? 'text-teal-400' : 'text-rose-400'}>
                            {formatINR(item.realizedPnL)}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>

                      {/* Delete Action */}
                      <td className="py-3 px-3 text-center">
                        <button
                          onClick={() => handleDelete(item.transaction.id)}
                          className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Delete this transaction"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/40 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
