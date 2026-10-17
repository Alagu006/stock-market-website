import React, { useState, useMemo } from 'react';
import { X, Plus, Search, Edit2, Trash2, Building2, AlertCircle } from 'lucide-react';
import type { Stock, MarketCapCategory } from '../types';

interface StockMasterModalProps {
  isOpen: boolean;
  onClose: () => void;
  stocks: Stock[];
  onAddStock: (stock: Omit<Stock, 'id' | 'createdAt'>) => Promise<void>;
  onUpdateStock: (id: number, stock: Partial<Stock>) => Promise<void>;
  onDeleteStock: (id: number) => Promise<void>;
}

export const StockMasterModal: React.FC<StockMasterModalProps> = ({
  isOpen,
  onClose,
  stocks,
  onAddStock,
  onUpdateStock,
  onDeleteStock,
}) => {
  const [search, setSearch] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingStockId, setEditingStockId] = useState<number | null>(null);

  // Form state
  const [symbol, setSymbol] = useState('');
  const [bseCode, setBseCode] = useState('');
  const [name, setName] = useState('');
  const [sector, setSector] = useState('');
  const [marketCapCategory, setMarketCapCategory] = useState<MarketCapCategory>('Large Cap');
  const [isin, setIsin] = useState('');
  const [expectedDividend, setExpectedDividend] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const resetForm = () => {
    setSymbol('');
    setBseCode('');
    setName('');
    setSector('');
    setMarketCapCategory('Large Cap');
    setIsin('');
    setExpectedDividend('');
    setEditingStockId(null);
    setFormError(null);
    setIsFormOpen(false);
  };

  const handleStartEdit = (stock: Stock) => {
    setEditingStockId(stock.id!);
    setSymbol(stock.symbol);
    setBseCode(stock.bseCode);
    setName(stock.name);
    setSector(stock.sector);
    setMarketCapCategory(stock.marketCapCategory);
    setIsin(stock.isin || '');
    setExpectedDividend(stock.expectedDividendPerShare ? String(stock.expectedDividendPerShare) : '');
    setIsFormOpen(true);
  };

  const filteredStocks = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return stocks;
    return stocks.filter(
      (s) =>
        s.symbol.toLowerCase().includes(q) ||
        s.bseCode.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.sector.toLowerCase().includes(q)
    );
  }, [stocks, search]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanSymbol = symbol.trim().toUpperCase();
    const cleanBse = bseCode.trim();
    const cleanName = name.trim();
    const cleanSector = sector.trim();

    if (!cleanSymbol || !cleanBse || !cleanName || !cleanSector) {
      setFormError('Please fill in Symbol, BSE Code, Name, and Sector.');
      return;
    }

    if (!/^\d{6}$/.test(cleanBse)) {
      setFormError('BSE code must be exactly 6 numeric digits (e.g., 500325).');
      return;
    }

    try {
      const stockData = {
        symbol: cleanSymbol,
        bseCode: cleanBse,
        name: cleanName,
        sector: cleanSector,
        marketCapCategory,
        isin: isin.trim() ? isin.trim().toUpperCase() : undefined,
        expectedDividendPerShare: expectedDividend ? Number(expectedDividend) : undefined,
      };

      if (editingStockId) {
        await onUpdateStock(editingStockId, stockData);
      } else {
        await onAddStock(stockData);
      }
      resetForm();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save stock.');
    }
  };

  const handleDelete = async (id: number, sym: string) => {
    if (window.confirm(`Delete stock ${sym}? This will also delete all associated transactions and prices.`)) {
      await onDeleteStock(id);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-[#111827] border border-slate-800 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold text-white">Stock Master List</h3>
            <span className="text-xs text-slate-400">({stocks.length} registered)</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Top Actions: Search & Add Button */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search symbol, BSE code, name, sector..."
                className="w-full pl-9 pr-4 py-2 bg-slate-900 text-xs sm:text-sm text-slate-200 rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500"
              />
            </div>
            {!isFormOpen && (
              <button
                onClick={() => setIsFormOpen(true)}
                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs sm:text-sm font-bold rounded-xl shadow-md transition-all shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Add New Stock</span>
              </button>
            )}
          </div>

          {/* Inline Add/Edit Form */}
          {isFormOpen && (
            <form onSubmit={handleSubmit} className="bg-slate-900/80 border border-slate-700/80 rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                  {editingStockId ? 'Edit Stock Details' : 'Register New Equity'}
                </span>
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
              </div>

              {formError && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">NSE Symbol *</label>
                  <input
                    type="text"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    placeholder="e.g. INFY"
                    className="w-full px-3 py-1.5 bg-slate-950 text-xs font-bold text-white rounded-lg border border-slate-700 uppercase"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">BSE Code (6 digits) *</label>
                  <input
                    type="text"
                    maxLength={6}
                    value={bseCode}
                    onChange={(e) => setBseCode(e.target.value)}
                    placeholder="e.g. 500209"
                    className="w-full px-3 py-1.5 bg-slate-950 text-xs font-bold text-white rounded-lg border border-slate-700 tabular-nums"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">Market Cap *</label>
                  <select
                    value={marketCapCategory}
                    onChange={(e) => setMarketCapCategory(e.target.value as MarketCapCategory)}
                    className="w-full px-3 py-1.5 bg-slate-950 text-xs text-white rounded-lg border border-slate-700"
                  >
                    <option value="Large Cap">Large Cap</option>
                    <option value="Mid Cap">Mid Cap</option>
                    <option value="Small Cap">Small Cap</option>
                    <option value="Micro Cap">Micro Cap</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">Company Name *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Infosys Limited"
                    className="w-full px-3 py-1.5 bg-slate-950 text-xs text-white rounded-lg border border-slate-700"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">Sector *</label>
                  <input
                    type="text"
                    value={sector}
                    onChange={(e) => setSector(e.target.value)}
                    placeholder="e.g. Information Technology"
                    className="w-full px-3 py-1.5 bg-slate-950 text-xs text-white rounded-lg border border-slate-700"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">ISIN (Optional)</label>
                  <input
                    type="text"
                    value={isin}
                    onChange={(e) => setIsin(e.target.value)}
                    placeholder="e.g. INE009A01021"
                    className="w-full px-3 py-1.5 bg-slate-950 text-xs text-white rounded-lg border border-slate-700 uppercase"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Expected Dividend/Share (₹)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={expectedDividend}
                    onChange={(e) => setExpectedDividend(e.target.value)}
                    placeholder="For income projections"
                    className="w-full px-3 py-1.5 bg-slate-950 text-xs text-white rounded-lg border border-slate-700 tabular-nums"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3 py-1.5 bg-slate-800 text-xs font-semibold text-slate-300 rounded-lg hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg shadow"
                >
                  {editingStockId ? 'Save Changes' : 'Register Stock'}
                </button>
              </div>
            </form>
          )}

          {/* Stocks Table */}
          <div className="border border-slate-800 rounded-xl overflow-hidden max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 text-slate-400 sticky top-0 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Symbol</th>
                  <th className="py-2.5 px-3">BSE Code</th>
                  <th className="py-2.5 px-3">Company Name</th>
                  <th className="py-2.5 px-3">Sector</th>
                  <th className="py-2.5 px-3">Cap</th>
                  <th className="py-2.5 px-3 text-right">Exp Div</th>
                  <th className="py-2.5 px-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y border-slate-800/60">
                {filteredStocks.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-6 text-slate-500">
                      No stocks found matching search.
                    </td>
                  </tr>
                ) : (
                  filteredStocks.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-2.5 px-3 font-bold text-white tracking-wide">{s.symbol}</td>
                      <td className="py-2.5 px-3 text-slate-400 font-mono">{s.bseCode}</td>
                      <td className="py-2.5 px-3 text-slate-300 truncate max-w-[160px]" title={s.name}>
                        {s.name}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">{s.sector}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                          {s.marketCapCategory}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-slate-300">
                        {s.expectedDividendPerShare ? `₹ ${s.expectedDividendPerShare}` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleStartEdit(s)}
                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
                            title="Edit Stock"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(s.id!, s.symbol)}
                            className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                            title="Delete Stock"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
