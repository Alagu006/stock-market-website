import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  PlusCircle,
  Building2,
  Loader2,
  Check,
  BookOpen,
  Coins,
} from 'lucide-react';
import stocksDirectory from '../data/stocks-directory.json';
import {
  searchLiveSymbols,
  fetchLiveQuotes,
  getYahooSymbolForExchange,
  addStockToRemoteDirectory,
} from '../services/priceFeed';
import { db } from '../db';
import type { Stock, LiveQuote } from '../types';
import { formatINR } from '../utils/formatters';

interface SearchResultItem {
  symbol: string;
  bseCode: string;
  name: string;
  sector: string;
  marketCapCategory: string;
  source: 'bundled' | 'live';
}

interface GlobalStockSearchProps {
  existingStocks: Stock[];
  onImportStock: (stock: Omit<Stock, 'id' | 'createdAt'>, livePrice?: number) => Promise<void>;
  onOpenDirectoryModal: () => void;
  onNavigateToStock?: (stockId: number) => void;
}

export const GlobalStockSearch: React.FC<GlobalStockSearchProps> = ({
  existingStocks,
  onImportStock,
  onOpenDirectoryModal,
  onNavigateToStock,
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearchingLive, setIsSearchingLive] = useState(false);
  const [liveResults, setLiveResults] = useState<SearchResultItem[]>([]);
  const [selectedStockForImport, setSelectedStockForImport] = useState<SearchResultItem | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importSuccessSymbol, setImportSuccessSymbol] = useState<string | null>(null);

  // Live quotes and dividends for search results
  const [resultQuotes, setResultQuotes] = useState<Map<string, LiveQuote>>(new Map());
  const [activeDividendPopoverSym, setActiveDividendPopoverSym] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Existing symbols set for quick check
  const existingSymbolsMap = useMemo(() => {
    const map = new Map<string, Stock>();
    for (const s of existingStocks) {
      map.set(s.symbol.toUpperCase(), s);
      if (s.bseCode) map.set(s.bseCode, s);
    }
    return map;
  }, [existingStocks]);

  // Bundled local instant search
  const bundledMatches = useMemo<SearchResultItem[]>(() => {
    const q = query.trim().toUpperCase();
    if (!q) return [];

    return stocksDirectory
      .filter((s) => {
        return (
          s.symbol.toUpperCase().includes(q) ||
          s.bseCode.includes(q) ||
          s.name.toUpperCase().includes(q) ||
          s.sector.toUpperCase().includes(q)
        );
      })
      .slice(0, 8)
      .map((s) => ({
        symbol: s.symbol,
        bseCode: s.bseCode,
        name: s.name,
        sector: s.sector,
        marketCapCategory: s.marketCapCategory,
        source: 'bundled',
      }));
  }, [query]);

  // If no bundled matches and query length >= 2, fall back to /api/search
  useEffect(() => {
    const q = query.trim();
    if (bundledMatches.length > 0 || q.length < 2) {
      setLiveResults([]);
      setIsSearchingLive(false);
      return;
    }

    let isMounted = true;
    const timer = setTimeout(async () => {
      setIsSearchingLive(true);
      const results = await searchLiveSymbols(q);
      if (isMounted) {
        const mapped: SearchResultItem[] = results.map((r) => ({
          symbol: r.cleanSymbol,
          bseCode: r.exchange === 'BSE' ? r.cleanSymbol : '',
          name: r.name,
          sector: 'Diversified',
          marketCapCategory: 'Mid Cap',
          source: 'live',
        }));
        setLiveResults(mapped);
        setIsSearchingLive(false);
      }
    }, 350);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [query, bundledMatches.length]);

  const combinedResults = useMemo(() => {
    return bundledMatches.length > 0 ? bundledMatches : liveResults;
  }, [bundledMatches, liveResults]);

  // Fetch live quotes (including CMP and latest dividend info) for results
  useEffect(() => {
    if (combinedResults.length === 0) return;
    let isCurrent = true;

    const symbols = combinedResults.map((r) => getYahooSymbolForExchange(r, 'NSE'));
    fetchLiveQuotes(symbols).then((quotes) => {
      if (!isCurrent) return;
      const map = new Map<string, LiveQuote>();
      quotes.forEach((q) => {
        const clean = q.symbol.replace(/\.(NS|BO)$/i, '').toUpperCase();
        map.set(clean, q);
      });
      setResultQuotes(map);
    });

    return () => {
      isCurrent = false;
    };
  }, [combinedResults]);

  // Close dropdown when clicked outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setActiveDividendPopoverSym(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || combinedResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % combinedResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + combinedResults.length) % combinedResults.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = combinedResults[selectedIndex];
      if (item) {
        handleSelectResult(item);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setActiveDividendPopoverSym(null);
    }
  };

  const handleSelectResult = async (item: SearchResultItem) => {
    // Task 4: Auto-add to directory on server and local DB
    addStockToRemoteDirectory({
      nseSymbol: item.symbol,
      bseCode: item.bseCode,
      name: item.name,
      sector: item.sector,
      marketCapCategory: item.marketCapCategory,
    }).catch(() => {});

    const existing = existingSymbolsMap.get(item.symbol.toUpperCase());
    if (existing && existing.id && onNavigateToStock) {
      onNavigateToStock(existing.id);
      setIsOpen(false);
      setQuery('');
    } else {
      setSelectedStockForImport(item);
    }
  };

  const handleConfirmImport = async () => {
    if (!selectedStockForImport) return;
    setIsImporting(true);

    try {
      // Task 4: Auto-add to backend stocks-directory.json and IndexedDB
      await addStockToRemoteDirectory({
        nseSymbol: selectedStockForImport.symbol,
        bseCode: selectedStockForImport.bseCode,
        name: selectedStockForImport.name,
        sector: selectedStockForImport.sector,
        marketCapCategory: selectedStockForImport.marketCapCategory,
      });

      // Also ensure stock is persisted into IndexedDB `stocks` table
      try {
        const existingInDb = await db.stocks.where('symbol').equals(selectedStockForImport.symbol).first();
        if (!existingInDb) {
          await db.stocks.add({
            symbol: selectedStockForImport.symbol,
            bseCode: selectedStockForImport.bseCode || '000000',
            name: selectedStockForImport.name,
            sector: selectedStockForImport.sector || 'Diversified',
            marketCapCategory: (selectedStockForImport.marketCapCategory as any) || 'Mid Cap',
            createdAt: new Date().toISOString(),
          });
        }
      } catch (e) {
        // Ignored if already added
      }

      // Fetch live quote for initial price
      const yahooSym = getYahooSymbolForExchange(selectedStockForImport, 'NSE');
      const quotes = await fetchLiveQuotes([yahooSym]);
      const cmp = quotes[0]?.price || 0;

      await onImportStock(
        {
          symbol: selectedStockForImport.symbol,
          bseCode: selectedStockForImport.bseCode || '000000',
          name: selectedStockForImport.name,
          sector: selectedStockForImport.sector || 'Diversified',
          marketCapCategory: (selectedStockForImport.marketCapCategory as any) || 'Mid Cap',
        },
        cmp > 0 ? cmp : undefined
      );

      setImportSuccessSymbol(selectedStockForImport.symbol);
      setTimeout(() => {
        setImportSuccessSymbol(null);
        setSelectedStockForImport(null);
        setIsOpen(false);
        setQuery('');
      }, 1000);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1 max-w-md">
      {/* Search Input Box */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setSelectedIndex(0);
          }}
          onFocus={() => {
            if (query.trim()) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search any Indian stock (symbol, 6-digit BSE, name)..."
          className="w-full pl-9 pr-16 py-1.5 bg-slate-900/90 text-xs text-slate-100 placeholder-slate-500 rounded-lg border border-slate-700 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <button
            type="button"
            onClick={onOpenDirectoryModal}
            className="p-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Browse Master Stock Directory"
          >
            <BookOpen className="w-3.5 h-3.5" />
          </button>
          {query && (
            <button
              onClick={() => {
                setQuery('');
                setIsOpen(false);
                setActiveDividendPopoverSym(null);
              }}
              className="text-xs text-slate-400 hover:text-slate-200 px-1 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Dropdown Results */}
      {isOpen && query.trim().length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-slate-950 border border-slate-800 rounded-xl shadow-2xl overflow-hidden z-50 max-h-80 overflow-y-auto divide-y divide-slate-800/60 animate-in fade-in duration-150">
          {/* Header indicator */}
          <div className="px-3 py-1.5 bg-slate-900/80 text-[10px] font-semibold text-slate-400 flex items-center justify-between">
            <span>
              {bundledMatches.length > 0
                ? 'Directory Matches'
                : isSearchingLive
                ? 'Searching Live Feed...'
                : liveResults.length > 0
                ? 'Live Exchange Matches'
                : 'No Matches Found'}
            </span>
            <span className="text-slate-500">↑↓ to navigate, Enter to select</span>
          </div>

          {isSearchingLive && (
            <div className="p-4 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              <span>Querying live exchange directory...</span>
            </div>
          )}

          {!isSearchingLive && combinedResults.length === 0 && (
            <div className="p-4 text-center text-xs text-slate-500">
              No matching Indian equities found for "{query}".
            </div>
          )}

          {combinedResults.map((item, idx) => {
            const isAlreadyAdded = existingSymbolsMap.has(item.symbol.toUpperCase());
            const isSelected = selectedIndex === idx;
            const quote = resultQuotes.get(item.symbol.toUpperCase());

            return (
              <div
                key={`${item.symbol}_${idx}`}
                onClick={() => handleSelectResult(item)}
                className={`p-2.5 px-3 flex items-center justify-between cursor-pointer transition-colors ${
                  isSelected ? 'bg-emerald-500/10' : 'hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded bg-slate-800 border border-slate-700/80 flex items-center justify-center shrink-0">
                    <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div className="truncate">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-white text-xs">{item.symbol}</span>
                      {item.bseCode && (
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-1 rounded border border-slate-800">
                          {item.bseCode}
                        </span>
                      )}

                      {/* TASK 2: Prominently badged Dividend Yield & Latest Dividend in Search Dropdown */}
                      {quote && (quote.dividendYield || quote.latestDividend) && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveDividendPopoverSym(
                              activeDividendPopoverSym === item.symbol ? null : item.symbol
                            );
                          }}
                          className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition-all"
                          title="Click to view dividend details"
                        >
                          <Coins className="w-2.5 h-2.5 text-amber-400" />
                          <span>
                            {quote.dividendYield ? `${quote.dividendYield}% Yield` : ''}
                            {quote.latestDividend
                              ? ` • ₹${quote.latestDividend.amount}${
                                  quote.latestDividend.date ? ` (Ex: ${quote.latestDividend.date})` : ''
                                }`
                              : ''}
                          </span>
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 truncate max-w-[220px]">{item.name}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  {quote?.price ? (
                    <span className="text-xs font-bold text-emerald-400 tabular-nums">
                      {formatINR(quote.price)}
                    </span>
                  ) : null}

                  {isAlreadyAdded ? (
                    <span className="text-[10px] font-semibold text-emerald-400 flex items-center gap-0.5 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                      <Check className="w-3 h-3" />
                      <span>In Master</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedStockForImport(item);
                      }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[10px] font-bold shadow-sm transition-all cursor-pointer"
                    >
                      <PlusCircle className="w-3 h-3" />
                      <span>Import</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Import Selected Stock to Master */}
      {selectedStockForImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-emerald-400" />
                Import Stock to Portfolio Master
              </h3>
              <button
                onClick={() => setSelectedStockForImport(null)}
                className="text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">NSE Symbol:</span>
                <span className="font-bold text-white">{selectedStockForImport.symbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">BSE 6-Digit Code:</span>
                <span className="font-mono text-slate-300">
                  {selectedStockForImport.bseCode || 'Auto-mapped'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Company Name:</span>
                <span className="font-semibold text-slate-200">{selectedStockForImport.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Sector:</span>
                <span className="text-slate-300">{selectedStockForImport.sector}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Market Cap Category:</span>
                <span className="text-emerald-400 font-semibold">
                  {selectedStockForImport.marketCapCategory}
                </span>
              </div>

              {/* Live quote preview if available */}
              {resultQuotes.get(selectedStockForImport.symbol.toUpperCase()) && (
                <div className="pt-2 mt-2 border-t border-slate-800/80 flex justify-between items-center text-xs">
                  <span className="text-slate-400">Live Price (CMP):</span>
                  <span className="font-bold text-emerald-400">
                    {formatINR(
                      resultQuotes.get(selectedStockForImport.symbol.toUpperCase())!.price
                    )}
                  </span>
                </div>
              )}
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Importing will automatically register this stock into your Stock Master, add it to your synchronized stock directory, and immediately fetch live CMP, 52W high/low, and fundamentals.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedStockForImport(null)}
                disabled={isImporting}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={isImporting}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-xs font-bold rounded-lg shadow-sm cursor-pointer"
              >
                {isImporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : importSuccessSymbol ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <PlusCircle className="w-3.5 h-3.5" />
                )}
                <span>
                  {isImporting
                    ? 'Importing...'
                    : importSuccessSymbol
                    ? 'Imported!'
                    : 'Confirm & Import Stock'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
