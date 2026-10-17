import React, { useState, useEffect } from 'react';
import { X, History } from 'lucide-react';
import type { Stock, PriceRecord } from '../types';
import { formatINR, formatDateDDMMYYYY } from '../utils/formatters';

interface PriceUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  stock: Stock | undefined;
  priceRecords: PriceRecord[];
  onAddPriceRecord: (stockId: number, symbol: string, price: number, date: string) => Promise<void>;
}

export const PriceUpdateModal: React.FC<PriceUpdateModalProps> = ({
  isOpen,
  onClose,
  stock,
  priceRecords,
  onAddPriceRecord,
}) => {
  const [newPrice, setNewPrice] = useState<string>('');
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stockPriceHistory = React.useMemo(() => {
    if (!stock?.id) return [];
    return priceRecords
      .filter((p) => p.stockId === stock.id)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [stock, priceRecords]);

  useEffect(() => {
    if (stockPriceHistory.length > 0) {
      setNewPrice(String(stockPriceHistory[0].price));
    } else {
      setNewPrice('');
    }
    setDate(new Date().toISOString().split('T')[0]);
    setError(null);
  }, [stock, stockPriceHistory.length, isOpen]);

  if (!isOpen || !stock) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = Number(newPrice);
    if (isNaN(p) || p <= 0) {
      setError('Price must be greater than zero.');
      return;
    }
    if (!date) {
      setError('Please choose a date.');
      return;
    }

    try {
      setIsSubmitting(true);
      await onAddPriceRecord(stock.id!, stock.symbol, p, date);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update price.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-[#111827] border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60">
          <div>
            <h3 className="text-base font-bold text-white">
              Update Manual Price: {stock.symbol}
            </h3>
            <p className="text-xs text-slate-400">{stock.name} ({stock.bseCode})</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Current / Manual Price (₹) *
              </label>
              <input
                type="number"
                step="0.05"
                min="0.05"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                placeholder="e.g. 3950.00"
                className="w-full px-3 py-2 bg-slate-900 text-sm font-bold text-white rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500 tabular-nums"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Price Date *
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 text-sm text-slate-200 rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500"
                required
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs sm:text-sm shadow-lg shadow-emerald-500/20 transition-all active:scale-95 disabled:opacity-50"
            >
              {isSubmitting ? 'Recording Price...' : 'Record Price Update'}
            </button>
          </div>

          {/* Stored Price History */}
          <div className="pt-3 border-t border-slate-800">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              <History className="w-3.5 h-3.5 text-slate-500" />
              <span>Historical Price Entries ({stockPriceHistory.length})</span>
            </div>

            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl max-h-44 overflow-y-auto divide-y divide-slate-800/60">
              {stockPriceHistory.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-500">
                  No previous manual price entries.
                </div>
              ) : (
                stockPriceHistory.map((p, idx) => (
                  <div key={p.id || idx} className="p-2.5 px-3 flex items-center justify-between text-xs">
                    <span className="text-slate-400">{formatDateDDMMYYYY(p.date)}</span>
                    <span className="font-bold text-white tabular-nums">{formatINR(p.price)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
