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
  addStockToRemoteDirectory,
  applyFeedToStock,
  mergeFeedFundamentals,
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

  // If query length >= 2, search live symbols AND candidate quotes simultaneously
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setLiveResults([]);
      setIsSearchingLive(false);
      return;
    }

    let isMounted = true;
    const timer = setTimeout(async () => {
      setIsSearchingLive(true);

      const cleanCandidate = q.toUpperCase().replace(/[^A-Z0-9&-]/g, '');
      const candidateSymbols = /^\d{6}$/.test(cleanCandidate)
        ? [`${cleanCandidate}.BO`]
        : [`${cleanCandidate}.NS`, `${cleanCandidate}.BO`];

      try {
        const [remoteResults, directQuotes] = await Promise.all([
          searchLiveSymbols(q),
          fetchLiveQuotes(candidateSymbols),
        ]);

        if (isMounted) {
          const mappedFromRemote: SearchResultItem[] = remoteResults.map((r: any) => {
            const cleanSym = (r.cleanSymbol || r.symbol.replace(/\.(NS|BO)$/i, '')).toUpperCase();
            if (r.price && r.price > 0) {
              setResultQuotes((prev) => {
                const next = new Map(prev);
                next.set(cleanSym, {
                  symbol: r.symbol,
                  shortName: r.name || cleanSym,
                  price: r.price,
                  previousClose: r.previousClose || r.price,
                  change: r.change || 0,
                  changePercent: r.changePercent || 0,
                  high52W: r.high52W || null,
                  low52W: r.low52W || null,
                  pe: r.pe || null,
                  dividendYield: r.dividendYield || null,
                  latestDividend: r.latestDividend || null,
                  marketCap: null,
                  currency: 'INR',
                  timestamp: new Date().toISOString(),
                });
                return next;
              });
            }
            return {
              symbol: cleanSym,
              bseCode: r.bseCode || (r.exchange === 'BSE' ? cleanSym : ''),
              name: r.name,
              sector: r.sector || 'Diversified',
              marketCapCategory: r.marketCapCategory || 'Mid Cap',
              source: 'live',
            };
          });

          const mappedFromDirectQuotes: SearchResultItem[] = [];
          for (const dq of directQuotes) {
            if (dq && dq.price > 0) {
              const isBSE = dq.symbol.endsWith('.BO');
              const clean = dq.symbol.replace(/\.(NS|BO)$/i, '').toUpperCase();
              mappedFromDirectQuotes.push({
                symbol: clean,
                bseCode: isBSE ? clean : '',
                name: dq.shortName || clean,
                sector: 'Diversified',
                marketCapCategory: 'Mid Cap',
                source: 'live',
              });
              setResultQuotes((prev) => {
                const next = new Map(prev);
                next.set(clean, dq);
                return next;
              });
            }
          }

          const seen = new Set<string>();
          const merged: SearchResultItem[] = [];
          for (const item of [...mappedFromDirectQuotes, ...mappedFromRemote]) {
            const sym = item.symbol.toUpperCase();
            if (!seen.has(sym)) {
              seen.add(sym);
              merged.push(item);
            }
          }

          setLiveResults(merged);
          setIsSearchingLive(false);
        }
      } catch (err) {
        if (isMounted) {
          setIsSearchingLive(false);
        }
      }
    }, 300);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [query]);

  // Combine local bundled matches and live results
  const combinedResults = useMemo(() => {
    const seen = new Set<string>();
    const list: SearchResultItem[] = [];

    // Bundled matches first
    for (const b of bundledMatches) {
      const sym = b.symbol.toUpperCase();
      if (!seen.has(sym)) {
        seen.add(sym);
        list.push(b);
      }
    }

    // Then live results
    for (const l of liveResults) {
      const sym = l.symbol.toUpperCase();
      if (!seen.has(sym)) {
        seen.add(sym);
        list.push(l);
      }
    }

    return list.slice(0, 10);
  }, [bundledMatches, liveResults]);

  // Fetch live quotes (including CMP, P/E, and latest dividend info) for visible results
  useEffect(() => {
    if (combinedResults.length === 0) return;
    let isCurrent = true;

    const querySymbols: string[] = [];
    for (const r of combinedResults) {
      const sym = r.symbol.trim().toUpperCase();
      querySymbols.push(`${sym}.NS`, `${sym}.BO`);
      if (r.bseCode && /^\d{6}$/.test(r.bseCode.trim())) {
        querySymbols.push(`${r.bseCode.trim()}.BO`);
      }
    }

    fetchLiveQuotes(querySymbols).then((quotes) => {
      if (!isCurrent) return;
      setResultQuotes((prev) => {
        const next = new Map(prev);
        quotes.forEach((q) => {
          const clean = q.symbol.replace(/\.(NS|BO)$/i, '').toUpperCase();
          next.set(clean, q);
          next.set(q.symbol.toUpperCase(), q);
          if ((q as any).bseData?.scripCode) {
            next.set(String((q as any).bseData.scripCode), q);
          }
        });
        return next;
      });
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
    // 1. Auto-append to backend stocks-directory.json
    addStockToRemoteDirectory({
      nseSymbol: item.symbol,
      bseCode: item.bseCode,
      name: item.name,
      sector: item.sector,
      marketCapCategory: item.marketCapCategory,
    }).catch(() => {});

    // 2. Fetch live quote if not in cache
    let quote = resultQuotes.get(item.symbol.toUpperCase());
    if (!quote) {
      const quotes = await fetchLiveQuotes([`${item.symbol}.NS`, `${item.symbol}.BO`]);
      if (quotes[0]) quote = quotes[0];
    }
    const cmp = quote?.price || 0;

    // 3. Save or update in IndexedDB with all live quote fields applied via applyFeedToStock
    let stockId = 0;
    const cleanSym = item.symbol.trim().toUpperCase();
    try {
      const existingInDb = await db.stocks.where('symbol').equalsIgnoreCase(cleanSym).first();
      if (!existingInDb) {
        let baseStock: Stock = {
          symbol: cleanSym,
          bseCode: item.bseCode || (item.source === 'live' && /^\d{6}$/.test(cleanSym) ? cleanSym : '000000'),
          name: item.name,
          sector: item.sector || 'Diversified',
          marketCapCategory: (item.marketCapCategory as any) || 'Mid Cap',
          createdAt: new Date().toISOString(),
        };
        if (quote) {
          baseStock = applyFeedToStock(baseStock, { quote });
        }
        const newId = await db.stocks.add(baseStock);
        stockId = Number(newId);
      } else {
        stockId = existingInDb.id!;
        if (quote) {
          const updated = applyFeedToStock(existingInDb, { quote });
          await db.stocks.put(updated);
        }
      }

      // CRITICAL: Immediately persist CMP to db.priceRecords so CMP appears across all views
      if (cmp > 0 && stockId > 0) {
        const todayDate = new Date().toISOString().split('T')[0];
        const existingPrice = await db.priceRecords
          .where('stockId')
          .equals(stockId)
          .filter((p) => p.date === todayDate)
          .first();

        if (existingPrice && existingPrice.id) {
          await db.priceRecords.update(existingPrice.id, {
            price: cmp,
            createdAt: new Date().toISOString(),
          });
        } else {
          await db.priceRecords.add({
            stockId,
            symbol: item.symbol,
            price: cmp,
            date: todayDate,
            createdAt: new Date().toISOString(),
          });
        }

        if (quote) {
          const existingFund = await db.fundamentals.where('stockId').equals(stockId).first();
          const merged = mergeFeedFundamentals(existingFund, quote, stockId, item.symbol);
          await db.fundamentals.put(merged);
        }
      }
    } catch (e) {
      console.warn('Error saving to IndexedDB:', e);
    }

    // 4. Open in view
    if (stockId > 0 && onNavigateToStock) {
      onNavigateToStock(stockId);
      setIsOpen(false);
      setQuery('');
    } else {
      await onImportStock(
        {
          symbol: item.symbol,
          bseCode: item.bseCode || '000000',
          name: item.name,
          sector: item.sector || 'Diversified',
          marketCapCategory: (item.marketCapCategory as any) || 'Mid Cap',
        },
        cmp > 0 ? cmp : undefined
      );
      setIsOpen(false);
      setQuery('');
    }
  };

  const handleConfirmImport = async () => {
    if (!selectedStockForImport) return;
    setIsImporting(true);

    try {
      await handleSelectResult(selectedStockForImport);
      setImportSuccessSymbol(selectedStockForImport.symbol);
      setTimeout(() => {
        setImportSuccessSymbol(null);
        setSelectedStockForImport(null);
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

                      {/* P/E badge */}
                      {quote && quote.pe ? (
                        <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                          PE: {quote.pe}x
                        </span>
                      ) : null}

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
                    <div className="flex flex-col items-end">
                      <span className="text-xs font-bold text-white tabular-nums">
                        {formatINR(quote.price)}
                      </span>
                      {quote.changePercent !== undefined && quote.changePercent !== null ? (
                        <span
                          className={`text-[10px] font-bold tabular-nums ${
                            quote.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {quote.changePercent >= 0 ? '+' : ''}
                          {quote.changePercent.toFixed(2)}%
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {isAlreadyAdded ? (
                    <span className="text-[10px] font-semibold text-emerald-400 flex items-center gap-0.5 bg-emerald-500/10 px-2 py-1 rounded">
                      <Check className="w-3 h-3" />
                      <span>In Master</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectResult(item);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[10px] font-bold shadow-sm transition-all cursor-pointer"
                    >
                      <PlusCircle className="w-3 h-3" />
                      <span>Add</span>
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
