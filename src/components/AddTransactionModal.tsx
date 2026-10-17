import React, { useState, useEffect, useMemo } from 'react';
import { X, AlertCircle, Calculator, ShieldCheck, RefreshCw } from 'lucide-react';
import type { Stock, Transaction, CorporateAction, PriceRecord, CostMethod, TransactionType } from '../types';
import { calculateLivePreview, validateSellQuantity, calculateNSECharges } from '../services/calculations';
import { addStockToRemoteDirectory } from '../services/priceFeed';
import { formatINR, formatPercent } from '../utils/formatters';

interface AddTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddTransaction: (tx: Omit<Transaction, 'id' | 'createdAt'>) => Promise<void>;
  stocks: Stock[];
  allTransactions: Transaction[];
  corporateActions: CorporateAction[];
  priceRecords: PriceRecord[];
  costMethod: CostMethod;
  initialStockId?: number;
  initialType?: TransactionType;
  initialQuantity?: number;
  initialPrice?: number;
}

export const AddTransactionModal: React.FC<AddTransactionModalProps> = ({
  isOpen,
  onClose,
  onAddTransaction,
  stocks,
  allTransactions,
  corporateActions,
  priceRecords,
  costMethod,
  initialStockId,
  initialType = 'BUY',
  initialQuantity,
  initialPrice,
}) => {
  const [stockId, setStockId] = useState<number | ''>(initialStockId || (stocks[0]?.id ?? ''));
  const [type, setType] = useState<TransactionType>(initialType);
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [quantity, setQuantity] = useState<string>(initialQuantity ? String(initialQuantity) : '');
  const [price, setPrice] = useState<string>(initialPrice ? String(initialPrice) : '');
  const [charges, setCharges] = useState<string>('0');
  const [isManualChargesOverride, setIsManualChargesOverride] = useState(false);
  const [note, setNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Auto-calculate NSE brokerage & statutory charges
  const nseCharges = useMemo(() => {
    const q = Number(quantity) || 0;
    const p = Number(price) || 0;
    return calculateNSECharges(type, q, p);
  }, [type, quantity, price]);

  // Sync charges with auto-calculated charges unless manually overridden
  useEffect(() => {
    if (!isManualChargesOverride) {
      if (nseCharges.totalCharges > 0) {
        setCharges(String(nseCharges.totalCharges));
      } else if (Number(quantity) === 0 || Number(price) === 0) {
        setCharges('0');
      }
    }
  }, [nseCharges, isManualChargesOverride, quantity, price]);

  // Synchronize when initial values change
  useEffect(() => {
    if (initialStockId) setStockId(initialStockId);
    if (initialType) setType(initialType);
    if (initialQuantity) setQuantity(String(initialQuantity));
    if (initialPrice) setPrice(String(initialPrice));
  }, [initialStockId, initialType, initialQuantity, initialPrice, isOpen]);

  // Selected Stock
  const selectedStock = useMemo(() => {
    return stocks.find((s) => s.id === Number(stockId));
  }, [stocks, stockId]);

  // Latest manual price for preview
  const latestPrice = useMemo(() => {
    if (!stockId) return 0;
    const stockPrices = priceRecords
      .filter((p) => p.stockId === Number(stockId))
      .sort((a, b) => b.date.localeCompare(a.date));
    return stockPrices[0]?.price || (price ? Number(price) : 0);
  }, [stockId, priceRecords, price]);

  // Compute live 4-card preview
  const livePreview = useMemo(() => {
    if (!selectedStock || !selectedStock.id) return null;
    return calculateLivePreview(
      selectedStock,
      latestPrice,
      allTransactions,
      corporateActions,
      costMethod,
      {
        type,
        date,
        quantity: Number(quantity) || 0,
        price: Number(price) || 0,
        charges: Number(charges) || 0,
      }
    );
  }, [selectedStock, latestPrice, allTransactions, corporateActions, costMethod, type, date, quantity, price, charges]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!stockId) {
      setFormError('Please select a stock.');
      return;
    }
    const numQty = Number(quantity);
    const numPrice = Number(price);
    const numCharges = Number(charges) || 0;

    if (isNaN(numQty) || numQty <= 0) {
      setFormError('Quantity must be a positive number.');
      return;
    }
    if (isNaN(numPrice) || numPrice <= 0) {
      setFormError('Price must be greater than zero.');
      return;
    }

    // Validation for SELL
    if (type === 'SELL') {
      const val = validateSellQuantity(Number(stockId), date, numQty, allTransactions, corporateActions);
      if (!val.isValid) {
        setFormError(val.error || `Insufficient shares to sell on ${date}.`);
        return;
      }
    }

    try {
      setIsSubmitting(true);
      if (selectedStock) {
        addStockToRemoteDirectory({
          nseSymbol: selectedStock.symbol,
          bseCode: selectedStock.bseCode,
          name: selectedStock.name,
          sector: selectedStock.sector,
          marketCapCategory: selectedStock.marketCapCategory,
        }).catch(() => {});
      }

      await onAddTransaction({
        stockId: Number(stockId),
        symbol: selectedStock?.symbol || '',
        type,
        date,
        quantity: numQty,
        price: numPrice,
        charges: numCharges,
        note: note.trim() || undefined,
      });
      onClose();
    } catch (err: any) {
      setFormError(err.message || 'Failed to record transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-y-auto">
      <div className="bg-[#111827] border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-2">
            <span
              className={`w-3 h-3 rounded-full ${
                type === 'BUY' ? 'bg-emerald-500 shadow-emerald-500/50' : 'bg-rose-500 shadow-rose-500/50'
              } shadow-md`}
            />
            <h3 className="text-base font-bold text-white">Record Transaction</h3>
            <span className="text-xs text-slate-400">({costMethod} Basis)</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {formError && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {/* Type Toggle & Stock Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Transaction Type
              </label>
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-900 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setType('BUY')}
                  className={`py-2 text-xs font-bold rounded-lg transition-all ${
                    type === 'BUY'
                      ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  BUY
                </button>
                <button
                  type="button"
                  onClick={() => setType('SELL')}
                  className={`py-2 text-xs font-bold rounded-lg transition-all ${
                    type === 'SELL'
                      ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  SELL
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Select Stock
              </label>
              <select
                value={stockId}
                onChange={(e) => setStockId(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-900 text-sm text-slate-200 rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500"
                required
              >
                <option value="">-- Choose Stock --</option>
                {stocks.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.symbol} ({s.bseCode}) - {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Date, Qty, Price, Charges */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 text-sm text-slate-200 rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Quantity
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g. 25"
                className="w-full px-3 py-2 bg-slate-900 text-sm text-slate-200 rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500 tabular-nums"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Price (₹)
              </label>
              <input
                type="number"
                min="0.05"
                step="0.05"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="e.g. 3450.50"
                className="w-full px-3 py-2 bg-slate-900 text-sm text-slate-200 rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500 tabular-nums"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Brokerage & Charges (₹)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const next = !isManualChargesOverride;
                    setIsManualChargesOverride(next);
                    if (!next) {
                      setCharges(String(nseCharges.totalCharges));
                    }
                  }}
                  className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer font-medium"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  <span>{isManualChargesOverride ? 'Enable Auto-Calc' : 'Manual Override'}</span>
                </button>
              </div>
              <input
                type="number"
                min="0"
                step="0.5"
                value={charges}
                onChange={(e) => {
                  setCharges(e.target.value);
                  setIsManualChargesOverride(true);
                }}
                placeholder="Auto-calculated (0.5% + STT + GST)"
                className="w-full px-3 py-2 bg-slate-900 text-sm text-slate-200 rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500 tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Note (Optional)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Reason or tranche context"
                className="w-full px-3 py-2 bg-slate-900 text-sm text-slate-200 rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* TASK 5: Live NSE Brokerage & Statutory Charges Breakdown Card */}
          {nseCharges.turnover > 0 && (
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-bold text-slate-300 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>NSE Delivery Charges Breakdown</span>
                </span>
                <span className="text-[10px] text-emerald-400 font-mono">
                  Turnover: {formatINR(nseCharges.turnover)}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-400 pt-1">
                <div>
                  <span className="block text-slate-500">Brokerage (0.5%):</span>
                  <span className="font-semibold text-white">₹{nseCharges.brokerage}</span>
                </div>
                <div>
                  <span className="block text-slate-500">STT (0.1%):</span>
                  <span className="font-semibold text-white">₹{nseCharges.stt}</span>
                </div>
                <div>
                  <span className="block text-slate-500">Exch + SEBI + Stamp:</span>
                  <span className="font-semibold text-white">
                    ₹{(nseCharges.exchangeCharges + nseCharges.sebiFee + nseCharges.stampDuty).toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="block text-slate-500">GST (18%):</span>
                  <span className="font-semibold text-white">₹{nseCharges.gst}</span>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-800/80 pt-2 font-bold">
                <span className="text-slate-400">
                  Total Statutory Charges:{' '}
                  <strong className="text-slate-200">₹{nseCharges.totalCharges}</strong>
                </span>
                <span className="text-emerald-400">
                  Net {type === 'BUY' ? 'Payable' : 'Receivable'}: {formatINR(nseCharges.netTotal)}
                </span>
              </div>
            </div>
          )}

          {/* LIVE 4-CARD PREVIEW */}
          {livePreview && (
            <div className="border border-slate-800 bg-slate-950/50 rounded-xl p-4">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 mb-3 uppercase tracking-wider">
                <Calculator className="w-3.5 h-3.5 text-emerald-400" />
                <span>Live Impact Preview ({costMethod})</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Card 1: Existing Holding and Average */}
                <div className="bg-[#111827] border border-slate-800 rounded-lg p-3">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                    1. Existing Position
                  </span>
                  <div className="text-sm font-bold text-white tabular-nums">
                    {livePreview.existing.shares} shares
                  </div>
                  <div className="text-xs text-slate-300 tabular-nums mt-0.5">
                    Avg: {formatINR(livePreview.existing.averagePrice)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Inv: {formatINR(livePreview.existing.invested, { compact: true })}
                  </div>
                </div>

                {/* Card 2: This Transaction's Impact */}
                <div className="bg-[#111827] border border-slate-800 rounded-lg p-3">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                    2. This Transaction
                  </span>
                  <div
                    className={`text-sm font-bold tabular-nums ${
                      type === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {type} {livePreview.thisTx.shares || 0} shares
                  </div>
                  <div className="text-xs text-slate-300 tabular-nums mt-0.5">
                    @ {formatINR(livePreview.thisTx.price)}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    Total: {formatINR(livePreview.thisTx.totalAmount)}
                  </div>
                </div>

                {/* Card 3: New Average and Difference vs Old */}
                <div className="bg-[#111827] border border-slate-800 rounded-lg p-3">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                    3. Post-Entry Average
                  </span>
                  <div className="text-sm font-bold text-white tabular-nums">
                    {formatINR(livePreview.postAverage.newAveragePrice)}
                  </div>
                  <div className="text-xs mt-0.5 flex items-center gap-1 font-semibold tabular-nums">
                    <span
                      className={
                        livePreview.postAverage.diffVsOld < 0
                          ? 'text-emerald-400'
                          : livePreview.postAverage.diffVsOld > 0
                          ? 'text-rose-400'
                          : 'text-slate-400'
                      }
                    >
                      {livePreview.postAverage.diffVsOld !== 0
                        ? `${livePreview.postAverage.diffVsOld > 0 ? '+' : ''}${formatINR(
                            livePreview.postAverage.diffVsOld
                          )}`
                        : '0.00'}
                    </span>
                    <span className="text-[10px] text-slate-500 font-normal">vs old</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {type === 'BUY' && livePreview.postAverage.diffVsOld < 0 ? '✓ Average lowered' : ''}
                  </div>
                </div>

                {/* Card 4: Post-Entry Position vs Current Price */}
                <div className="bg-[#111827] border border-slate-800 rounded-lg p-3">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                    4. Position vs Mkt Price
                  </span>
                  <div className="text-sm font-bold text-white tabular-nums">
                    {livePreview.postPosition.shares} shares
                  </div>
                  <div
                    className={`text-xs mt-0.5 font-semibold tabular-nums ${
                      livePreview.postPosition.unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    PnL: {formatINR(livePreview.postPosition.unrealizedPnL)} (
                    {formatPercent(livePreview.postPosition.unrealizedPnLPercent)})
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    Mkt Val: {formatINR(livePreview.postPosition.currentValue, { compact: true })}
                  </div>
                </div>
              </div>

              {!livePreview.isValid && (
                <div className="mt-3 text-xs text-rose-400 font-semibold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{livePreview.validationError}</span>
                </div>
              )}
            </div>
          )}

          {/* Submit & Cancel */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs sm:text-sm font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (livePreview !== null && !livePreview.isValid)}
              className="px-5 py-2 text-xs sm:text-sm font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Recording...' : `Record ${type}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
