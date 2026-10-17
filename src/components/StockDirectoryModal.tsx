import React, { useState, useMemo } from 'react';
import {
  BookOpen,
  Search,
  X,
  PlusCircle,
  Building2,
  Check,
} from 'lucide-react';
import stocksDirectory from '../data/stocks-directory.json';
import type { Stock } from '../types';

interface StockDirectoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingStocks: Stock[];
  onImportStock: (stock: Omit<Stock, 'id' | 'createdAt'>) => Promise<void>;
}

export const StockDirectoryModal: React.FC<StockDirectoryModalProps> = ({
  isOpen,
  onClose,
  existingStocks,
  onImportStock,
}) => {
  const [search, setSearch] = useState('');
  const [selectedSector, setSelectedSector] = useState('ALL');
  const [selectedCap, setSelectedCap] = useState('ALL');
  const [importedSet, setImportedSet] = useState<Set<string>>(new Set());

  // Existing symbols set
  const existingSet = useMemo(() => {
    const s = new Set<string>();
    existingStocks.forEach((st) => s.add(st.symbol.toUpperCase()));
    return s;
  }, [existingStocks]);

  // Unique Sectors
  const sectors = useMemo(() => {
    const set = new Set<string>();
    stocksDirectory.forEach((st) => set.add(st.sector));
    return ['ALL', ...Array.from(set).sort()];
  }, []);

  // Filtered list
  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return stocksDirectory.filter((st) => {
      if (selectedSector !== 'ALL' && st.sector !== selectedSector) return false;
      if (selectedCap !== 'ALL' && st.marketCapCategory !== selectedCap) return false;
      if (q) {
        return (
          st.symbol.toUpperCase().includes(q) ||
          st.bseCode.includes(q) ||
          st.name.toUpperCase().includes(q)
        );
      }
      return true;
    });
  }, [search, selectedSector, selectedCap]);

  if (!isOpen) return null;

  const handleImport = async (item: (typeof stocksDirectory)[0]) => {
    await onImportStock({
      symbol: item.symbol,
      bseCode: item.bseCode,
      name: item.name,
      sector: item.sector,
      marketCapCategory: item.marketCapCategory as any,
      isin: item.isin,
    });
    setImportedSet((prev) => new Set(prev).add(item.symbol.toUpperCase()));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <BookOpen className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="font-bold text-white text-base">Indian Equities Master Directory</h2>
              <p className="text-[11px] text-slate-400">
                Browse official NSE & BSE listed stocks and import them into your portfolio
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter Controls */}
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            <div className="relative min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search symbol, BSE code, company..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <select
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
            >
              {sectors.map((sec) => (
                <option key={sec} value={sec}>
                  {sec === 'ALL' ? 'All Sectors' : sec}
                </option>
              ))}
            </select>

            <select
              value={selectedCap}
              onChange={(e) => setSelectedCap(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
            >
              <option value="ALL">All Market Caps</option>
              <option value="Large Cap">Large Cap</option>
              <option value="Mid Cap">Mid Cap</option>
              <option value="Small Cap">Small Cap</option>
            </select>
          </div>

          <span className="text-[11px] text-slate-400 self-end sm:self-auto">
            {filtered.length} equities listed
          </span>
        </div>

        {/* Equities Table */}
        <div className="overflow-y-auto flex-1 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map((item) => {
              const isAdded =
                existingSet.has(item.symbol.toUpperCase()) ||
                importedSet.has(item.symbol.toUpperCase());

              return (
                <div
                  key={item.symbol}
                  className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between hover:border-slate-700 transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-xs">{item.symbol}</span>
                        <span className="font-mono text-[10px] text-slate-400 bg-slate-900 px-1 py-0.2 rounded border border-slate-800">
                          {item.bseCode}
                        </span>
                        <span className="text-[9px] font-bold px-1 rounded bg-teal-500/10 text-teal-300 border border-teal-500/20">
                          {item.marketCapCategory}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate max-w-[200px] mt-0.5">
                        {item.name}
                      </p>
                      <span className="text-[10px] text-slate-500">{item.sector}</span>
                    </div>
                  </div>

                  <div className="shrink-0 ml-2">
                    {isAdded ? (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20">
                        <Check className="w-3.5 h-3.5" />
                        <span>Added</span>
                      </span>
                    ) : (
                      <button
                        onClick={() => handleImport(item)}
                        className="flex items-center gap-1 px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg shadow-sm transition-all"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950 flex items-center justify-between text-xs text-slate-400">
          <span>Run `npm run build:stocklist` to refresh public exchange listings</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
