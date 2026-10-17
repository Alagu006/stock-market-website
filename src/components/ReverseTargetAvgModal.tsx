import React, { useState, useEffect, useMemo } from 'react';
import { X, Target, ArrowRight, AlertCircle, Calculator } from 'lucide-react';
import type { Stock, Transaction, CorporateAction, CostMethod } from '../types';
import { calculateStockPosition, calculateReverseTargetAverage } from '../services/calculations';
import { formatINR } from '../utils/formatters';

interface ReverseTargetAvgModalProps {
  isOpen: boolean;
  onClose: () => void;
  stocks: Stock[];
  transactions: Transaction[];
  corporateActions: CorporateAction[];
  costMethod: CostMethod;
  initialStockId?: number;
  onPreFillBuy: (stockId: number, qty: number, price: number) => void;
}

export const ReverseTargetAvgModal: React.FC<ReverseTargetAvgModalProps> = ({
  isOpen,
  onClose,
  stocks,
  transactions,
  corporateActions,
  costMethod,
  initialStockId,
  onPreFillBuy,
}) => {
  const [selectedStockId, setSelectedStockId] = useState<number | ''>(
    initialStockId || (stocks[0]?.id ?? '')
  );
  const [targetAverage, setTargetAverage] = useState<string>('');
  const [plannedPrice, setPlannedPrice] = useState<string>('');

  useEffect(() => {
    if (initialStockId) {
      setSelectedStockId(initialStockId);
    } else if (!selectedStockId && stocks[0]?.id) {
      setSelectedStockId(stocks[0].id);
    }
  }, [initialStockId, stocks, isOpen]);

  const selectedStock = useMemo(() => {
    return stocks.find((s) => s.id === Number(selectedStockId));
  }, [stocks, selectedStockId]);

  const currentPosition = useMemo(() => {
    if (!selectedStock || !selectedStock.id) return null;
    return calculateStockPosition(selectedStock.id, transactions, corporateActions, costMethod);
  }, [selectedStock, transactions, corporateActions, costMethod]);

  // Set default suggested target & planned price when stock changes
  useEffect(() => {
    if (currentPosition && currentPosition.averageBuyPrice > 0) {
      const avg = currentPosition.averageBuyPrice;
      // Default suggest ~5% drop target and ~10% drop planned buy
      const suggestedTarget = Math.round(avg * 0.95);
      const suggestedPlanned = Math.round(avg * 0.88);
      setTargetAverage(String(suggestedTarget));
      setPlannedPrice(String(suggestedPlanned));
    }
  }, [selectedStockId, currentPosition?.averageBuyPrice]);

  const calculationResult = useMemo(() => {
    if (!currentPosition || currentPosition.quantity <= 0) {
      return {
        isValid: false,
        error: 'You do not currently hold any shares of this stock to average down.',
        requiredShares: 0,
        capitalRequired: 0,
        newAveragePrice: 0,
      };
    }

    const tAvg = Number(targetAverage);
    const pPrice = Number(plannedPrice);

    if (isNaN(tAvg) || isNaN(pPrice) || tAvg <= 0 || pPrice <= 0) {
      return null;
    }

    return calculateReverseTargetAverage(
      currentPosition.quantity,
      currentPosition.averageBuyPrice,
      tAvg,
      pPrice
    );
  }, [currentPosition, targetAverage, plannedPrice]);

  if (!isOpen) return null;

  const handlePreFill = () => {
    if (!calculationResult || !calculationResult.isValid || !selectedStock?.id) return;
    onPreFillBuy(selectedStock.id, calculationResult.requiredShares, Number(plannedPrice));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-[#111827] border border-slate-800 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
              <Target className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Reverse Target-Average Calculator</h3>
              <p className="text-xs text-slate-400">"Buy the Dip" precision capital planner</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Stock Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
              Select Holding
            </label>
            <select
              value={selectedStockId}
              onChange={(e) => setSelectedStockId(Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-900 text-sm text-slate-200 rounded-xl border border-slate-700 focus:outline-none focus:border-amber-500"
            >
              {stocks.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.symbol} ({s.bseCode}) - {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Current Holding Banner */}
          {currentPosition && (
            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl flex items-center justify-between text-xs">
              <div>
                <span className="text-slate-400">Current Qty: </span>
                <span className="font-bold text-white tabular-nums">{currentPosition.quantity} shares</span>
              </div>
              <div>
                <span className="text-slate-400">Current Avg ({costMethod}): </span>
                <span className="font-bold text-emerald-400 tabular-nums">
                  {formatINR(currentPosition.averageBuyPrice)}
                </span>
              </div>
            </div>
          )}

          {/* Inputs for Target Average & Planned Price */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Desired Target Average (₹)
              </label>
              <input
                type="number"
                step="0.05"
                value={targetAverage}
                onChange={(e) => setTargetAverage(e.target.value)}
                placeholder="Must be < current avg"
                className="w-full px-3 py-2 bg-slate-900 text-sm text-slate-200 rounded-xl border border-slate-700 focus:outline-none focus:border-amber-500 tabular-nums"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                The new average price you want to bring your holding down to.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Planned Buy Price (₹)
              </label>
              <input
                type="number"
                step="0.05"
                value={plannedPrice}
                onChange={(e) => setPlannedPrice(e.target.value)}
                placeholder="Must be < target avg"
                className="w-full px-3 py-2 bg-slate-900 text-sm text-slate-200 rounded-xl border border-slate-700 focus:outline-none focus:border-amber-500 tabular-nums"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                The dip price at which you plan to execute the new buy order.
              </span>
            </div>
          </div>

          {/* Result Box */}
          {calculationResult && (
            <div>
              {calculationResult.isValid ? (
                <div className="bg-gradient-to-br from-amber-500/10 via-slate-900 to-emerald-500/10 border border-amber-500/30 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400 uppercase tracking-wider mb-3">
                    <Calculator className="w-4 h-4" />
                    <span>Exact Order Plan Required</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-center mb-3">
                    <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
                      <span className="text-[11px] text-slate-400 block mb-0.5">Exact Shares to Buy</span>
                      <span className="text-xl sm:text-2xl font-extrabold text-white tabular-nums">
                        {calculationResult.requiredShares}
                      </span>
                      <span className="text-[10px] text-slate-500 block mt-0.5">shares</span>
                    </div>

                    <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
                      <span className="text-[11px] text-slate-400 block mb-0.5">Capital Required</span>
                      <span className="text-xl sm:text-2xl font-extrabold text-amber-300 tabular-nums">
                        {formatINR(calculationResult.capitalRequired)}
                      </span>
                      <span className="text-[10px] text-slate-500 block mt-0.5">total cash outlay</span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-slate-300 flex items-center justify-between">
                    <span>Resulting New Average:</span>
                    <span className="font-bold text-emerald-400 tabular-nums">
                      {formatINR(calculationResult.newAveragePrice)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{calculationResult.error}</span>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!calculationResult || !calculationResult.isValid}
              onClick={handlePreFill}
              className="flex items-center gap-2 px-5 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
            >
              <span>Pre-fill Buy Form</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
