import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Bell,
  Coins,
  Scissors,
  ExternalLink,
  PlusCircle,
  CheckCircle2,
  Loader2,
  RotateCcw,
  RefreshCw,
  FileText,
} from 'lucide-react';
import type {
  Stock,
  DividendRecord,
  CorporateAction,
  HoldingCalculation,
  CorporateEventData,
  StockEdgeNewsItem,
} from '../types';
import { formatINR, formatDateDDMMYYYY } from '../utils/formatters';
import { fetchCorporateEvents, fetchStockEdgeNews } from '../services/priceFeed';

interface CorporateActionsFeedViewProps {
  stocks: Stock[];
  holdings: HoldingCalculation[];
  existingDividends: DividendRecord[];
  existingCorporateActions: CorporateAction[];
  onAddDividend: (dividend: Omit<DividendRecord, 'id' | 'createdAt'>) => Promise<void>;
  onAddCorporateAction: (action: Omit<CorporateAction, 'id' | 'createdAt'>) => Promise<void>;
  onDeleteCorporateAction: (id: number) => Promise<void>;
}

export const CorporateActionsFeedView: React.FC<CorporateActionsFeedViewProps> = ({
  stocks,
  holdings,
  existingDividends,
  existingCorporateActions,
  onAddDividend,
  onAddCorporateAction,
  onDeleteCorporateAction,
}) => {
  const [filterMode, setFilterMode] = useState<'holdings' | 'all'>(holdings.length > 0 ? 'holdings' : 'all');
  const [loading, setLoading] = useState(false);
  const [eventsMap, setEventsMap] = useState<Map<string, CorporateEventData>>(new Map());
  const [announcements, setAnnouncements] = useState<Array<{ symbol: string; item: StockEdgeNewsItem }>>([]);
  const [refreshIndex, setRefreshIndex] = useState(0);

  const isFetchingRef = useRef(false);
  const lastFetchedKeyRef = useRef<string>('');

  // Dividend record modal state
  const [recordingDiv, setRecordingDiv] = useState<{
    stock: Stock;
    date: string;
    amountPerShare: number;
    sharesHeld: number;
    tds: number;
    note: string;
  } | null>(null);

  // Active target stocks
  const targetStocks = useMemo(() => {
    if (filterMode === 'holdings') {
      const holdingStockIds = new Set(holdings.map((h) => h.stock.id));
      const filtered = stocks.filter((s) => s.id && holdingStockIds.has(s.id));
      return filtered.length > 0 ? filtered : stocks;
    }
    return stocks;
  }, [stocks, holdings, filterMode]);

  // Stable key based on symbols to avoid refetching on every DB/price update
  const targetSymbolsKey = useMemo(() => {
    return targetStocks
      .map((s) => `${s.symbol.toUpperCase()}:${s.bseCode || ''}`)
      .sort()
      .join(',');
  }, [targetStocks]);

  // Fetch events & announcements once per symbol set or on manual refresh
  useEffect(() => {
    if (!targetSymbolsKey) {
      setLoading(false);
      return;
    }

    const currentKey = `${filterMode}_${targetSymbolsKey}_${refreshIndex}`;
    if (lastFetchedKeyRef.current === currentKey) {
      return;
    }

    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    lastFetchedKeyRef.current = currentKey;

    let isMounted = true;
    setLoading(true);

    const loadData = async () => {
      try {
        const newEventsMap = new Map<string, CorporateEventData>();
        const newAnnouncements: Array<{ symbol: string; item: StockEdgeNewsItem }> = [];

        const stockSlice = targetStocks.slice(0, 15);
        const chunks: Stock[][] = [];
        for (let i = 0; i < stockSlice.length; i += 5) {
          chunks.push(stockSlice.slice(i, i + 5));
        }

        for (const chunk of chunks) {
          if (!isMounted) break;
          await Promise.all(
            chunk.map(async (st) => {
              try {
                const [ev, news] = await Promise.all([
                  fetchCorporateEvents(st.symbol, st.bseCode),
                  fetchStockEdgeNews(st.symbol),
                ]);
                if (ev && isMounted) {
                  newEventsMap.set(st.symbol.toUpperCase(), ev);
                }
                if (news && news.items && news.items.length > 0 && isMounted) {
                  news.items.forEach((item) => {
                    newAnnouncements.push({ symbol: st.symbol, item });
                  });
                }
              } catch {}
            })
          );
        }

        if (isMounted) {
          setEventsMap(newEventsMap);
          setAnnouncements(newAnnouncements);
        }
      } finally {
        isFetchingRef.current = false;
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
      isFetchingRef.current = false;
    };
  }, [filterMode, targetSymbolsKey, refreshIndex]);

  // Aggregate detected dividends
  const detectedDividends = useMemo(() => {
    const list: Array<{
      stock: Stock;
      holdingQty: number;
      date: string;
      amountPerShare: number;
      estimatedPayout: number;
      isAlreadyRecorded: boolean;
      sourceLabel?: string;
    }> = [];

    for (const stock of targetStocks) {
      const ev = eventsMap.get(stock.symbol.toUpperCase());
      const holding = holdings.find((h) => h.stock.id === stock.id);
      const qty = holding?.quantity || 0;
      let count = 0;

      if (ev && ev.dividends && ev.dividends.length > 0) {
        for (const div of ev.dividends.slice(0, 5)) {
          count++;
          const already = existingDividends.some(
            (ed) => ed.stockId === stock.id && ed.date === div.date
          );

          list.push({
            stock,
            holdingQty: qty,
            date: div.date,
            amountPerShare: div.amount,
            estimatedPayout: qty * div.amount,
            isAlreadyRecorded: already,
            sourceLabel: 'Exchange Live',
          });
        }
      }

      // Fallback: If no event returned, but stock has verified dividend on master record
      if (count === 0 && stock.latestDividendAmount && stock.latestDividendAmount > 0) {
        const divDate = stock.latestDividendExDate || new Date().toISOString().split('T')[0];
        const already = existingDividends.some(
          (ed) => ed.stockId === stock.id && ed.date === divDate
        );
        list.push({
          stock,
          holdingQty: qty,
          date: divDate,
          amountPerShare: stock.latestDividendAmount,
          estimatedPayout: qty * stock.latestDividendAmount,
          isAlreadyRecorded: already,
          sourceLabel: 'BSE Direct',
        });
      }
    }

    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [targetStocks, eventsMap, holdings, existingDividends]);

  // Aggregate detected splits and bonuses
  const detectedSplits = useMemo(() => {
    const list: Array<{
      stock: Stock;
      date: string;
      numerator: number;
      denominator: number;
      splitRatio: string;
      isAlreadyApplied: boolean;
      existingActionId?: number;
    }> = [];

    for (const stock of targetStocks) {
      const ev = eventsMap.get(stock.symbol.toUpperCase());
      if (ev && ev.splits) {
        for (const sp of ev.splits) {
          const matchingAction = existingCorporateActions.find(
            (ca) => ca.stockId === stock.id && ca.exDate === sp.date
          );

          list.push({
            stock,
            date: sp.date,
            numerator: sp.numerator,
            denominator: sp.denominator,
            splitRatio: sp.splitRatio,
            isAlreadyApplied: !!matchingAction,
            existingActionId: matchingAction?.id,
          });
        }
      }
    }

    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [targetStocks, eventsMap, existingCorporateActions]);

  // Handle Apply Split/Bonus
  const handleApplySplit = async (item: (typeof detectedSplits)[0]) => {
    if (!item.stock.id) return;
    await onAddCorporateAction({
      stockId: item.stock.id,
      symbol: item.stock.symbol,
      type: item.numerator > item.denominator ? 'SPLIT' : 'BONUS',
      fromFactor: item.denominator,
      toFactor: item.numerator,
      exDate: item.date,
      note: `Detected exchange action ${item.splitRatio}`,
    });
  };

  // Handle Save Dividend from modal
  const handleSaveDividend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recordingDiv || !recordingDiv.stock.id) return;

    await onAddDividend({
      stockId: recordingDiv.stock.id,
      symbol: recordingDiv.stock.symbol,
      date: recordingDiv.date,
      amountPerShare: recordingDiv.amountPerShare,
      sharesHeld: recordingDiv.sharesHeld,
      tds: recordingDiv.tds > 0 ? recordingDiv.tds : undefined,
      note: recordingDiv.note || 'Recorded from Corporate Action Feed',
    });

    setRecordingDiv(null);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 p-5 rounded-2xl border border-slate-800 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <Bell className="w-6 h-6 text-emerald-400" />
              Corporate Actions & Events Feed
            </h1>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Live Feed
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Track declared dividends, bonus issues, and stock splits for your stocks. Apply actions safely with instant undo.
          </p>
        </div>

        {/* Filter Toggle & Refresh */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setFilterMode('holdings')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                filterMode === 'holdings'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              My Holdings ({holdings.length})
            </button>
            <button
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                filterMode === 'all'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              All Tracked Stocks ({stocks.length})
            </button>
          </div>

          <button
            onClick={() => setRefreshIndex((k) => k + 1)}
            disabled={loading}
            className="p-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-emerald-400 rounded-xl transition-all disabled:opacity-50"
            title="Refresh corporate actions feed"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="p-4 bg-slate-900/80 rounded-xl border border-slate-800 flex items-center justify-center gap-2 text-xs text-slate-400 animate-pulse">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
          <span>Fetching recent corporate filings & announcements from live feed...</span>
        </div>
      )}

      {/* Grid: Left Dividends Feed, Right Splits & Bonuses */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Column 1: Dividends Feed */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Coins className="w-4 h-4 text-emerald-400" />
              Dividend Declarations ({detectedDividends.length})
            </h2>
            <span className="text-[11px] text-slate-400">Exact payout = Shares held &times; Div/share</span>
          </div>

          {detectedDividends.length === 0 ? (
            <div className="bg-slate-900/80 p-8 rounded-2xl border border-slate-800 text-center text-slate-500 text-xs italic">
              No recent dividend events detected for selected stocks.
            </div>
          ) : (
            detectedDividends.map((item, idx) => (
              <div
                key={`${item.stock.symbol}_${item.date}_${idx}`}
                className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex items-center justify-between hover:border-slate-700 transition-all"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-xs">{item.stock.symbol}</span>
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-1 rounded border border-slate-800">
                      Ex-Date: {formatDateDDMMYYYY(item.date)}
                    </span>
                    {item.sourceLabel && (
                      <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {item.sourceLabel}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 mt-1">
                    Payout: <strong className="text-emerald-400">{formatINR(item.amountPerShare)}</strong> per share
                  </p>
                  {item.holdingQty > 0 && (
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Shares held: <span className="font-bold text-slate-200">{item.holdingQty}</span> &bull; Estimated Payout:{' '}
                      <strong className="text-emerald-300">{formatINR(item.estimatedPayout)}</strong>
                    </p>
                  )}
                </div>

                <div className="shrink-0 ml-3">
                  {item.isAlreadyRecorded ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Recorded</span>
                    </span>
                  ) : (
                    <button
                      onClick={() =>
                        setRecordingDiv({
                          stock: item.stock,
                          date: item.date,
                          amountPerShare: item.amountPerShare,
                          sharesHeld: item.holdingQty > 0 ? item.holdingQty : 1,
                          tds: item.estimatedPayout >= 5000 ? Math.round(item.estimatedPayout * 0.1) : 0,
                          note: `Dividend declared on ${item.date}`,
                        })
                      }
                      className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg shadow-sm transition-all"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>Record as Received</span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Column 2: Splits & Bonuses Feed */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Scissors className="w-4 h-4 text-teal-400" />
              Splits & Bonuses Suggestions ({detectedSplits.length})
            </h2>
            <span className="text-[11px] text-slate-400">One-click apply (Non-destructive)</span>
          </div>

          {detectedSplits.length === 0 ? (
            <div className="bg-slate-900/80 p-8 rounded-2xl border border-slate-800 text-center text-slate-500 text-xs italic">
              No recent split or bonus actions detected.
            </div>
          ) : (
            detectedSplits.map((item, idx) => (
              <div
                key={`${item.stock.symbol}_${item.date}_${idx}`}
                className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex items-center justify-between hover:border-slate-700 transition-all"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-xs">{item.stock.symbol}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-teal-500/10 text-teal-300 border border-teal-500/20">
                      {item.numerator > item.denominator ? 'Stock Split' : 'Bonus Issue'}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-1 rounded border border-slate-800">
                      Ex-Date: {formatDateDDMMYYYY(item.date)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1">
                    Ratio: <strong className="text-teal-300 font-mono">{item.splitRatio}</strong> (Shares &times;
                    {(item.numerator / item.denominator).toFixed(2)})
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Adjusts transactions prior to ex-date dynamically in calculation layer
                  </p>
                </div>

                <div className="shrink-0 ml-3">
                  {item.isAlreadyApplied ? (
                    <div className="flex items-center gap-1.5">
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Applied</span>
                      </span>
                      {item.existingActionId && (
                        <button
                          onClick={() => onDeleteCorporateAction(item.existingActionId!)}
                          className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                          title="Undo / Delete corporate action"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => handleApplySplit(item)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-bold rounded-lg shadow-sm transition-all"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>Apply Action</span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Corporate Announcements & Regulatory Updates Section */}
      {announcements.length > 0 && (
        <div className="bg-slate-900/80 p-5 rounded-2xl border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-400" />
              Live Corporate Announcements & Filings ({announcements.length})
            </h3>
            <span className="text-[11px] text-slate-400">StockEdge & BSE Announcements Feed</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {announcements.slice(0, 8).map((ann, idx) => (
              <div
                key={`${ann.symbol}_ann_${idx}`}
                className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="font-bold text-white text-xs px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                      {ann.symbol}
                    </span>
                    <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                      {ann.item.category || 'Announcement'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-200 line-clamp-2 leading-relaxed">
                    {ann.item.headline}
                  </p>
                </div>

                <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-900 text-[11px] text-slate-400">
                  <span>{ann.item.date} {ann.item.time ? `• ${ann.item.time}` : ''}</span>
                  {ann.item.url && (
                    <a
                      href={ann.item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-400 hover:text-emerald-300 font-semibold inline-flex items-center gap-1"
                    >
                      <span>Read Filing</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Official Exchange Filings Direct Links Section */}
      <div className="bg-slate-900/80 p-5 rounded-2xl border border-slate-800 space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <ExternalLink className="w-4 h-4 text-emerald-400" />
          Official Exchange Announcements & Regulatory Filings
        </h3>
        <p className="text-xs text-slate-400">
          Indian stock exchanges publish verified corporate filings, board meeting agendas, and financial results directly on their portals:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <a
            href="https://www.nseindia.com/companies-listing/corporate-filings-announcements"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3.5 bg-slate-950 border border-slate-800 rounded-xl hover:border-emerald-500/50 hover:bg-slate-900 transition-all text-xs"
          >
            <div>
              <span className="font-bold text-white block">NSE Corporate Announcements</span>
              <span className="text-[11px] text-slate-400">Board meetings, financial results & disclosures</span>
            </div>
            <ExternalLink className="w-4 h-4 text-emerald-400 shrink-0" />
          </a>

          <a
            href="https://www.bseindia.com/corporates/ann.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3.5 bg-slate-950 border border-slate-800 rounded-xl hover:border-teal-500/50 hover:bg-slate-900 transition-all text-xs"
          >
            <div>
              <span className="font-bold text-white block">BSE Corporate Filings Portal</span>
              <span className="text-[11px] text-slate-400">Notices, dividend records & AGM resolutions</span>
            </div>
            <ExternalLink className="w-4 h-4 text-teal-400 shrink-0" />
          </a>
        </div>
      </div>

      {/* Record Dividend Modal */}
      {recordingDiv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Coins className="w-4 h-4 text-emerald-400" />
                Record Dividend for {recordingDiv.stock.symbol}
              </h3>
              <button
                onClick={() => setRecordingDiv(null)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveDividend} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Credit / Ex-Date</label>
                <input
                  type="date"
                  value={recordingDiv.date}
                  onChange={(e) => setRecordingDiv({ ...recordingDiv, date: e.target.value })}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Div Per Share (₹)</label>
                  <input
                    type="number"
                    step="any"
                    value={recordingDiv.amountPerShare}
                    onChange={(e) =>
                      setRecordingDiv({
                        ...recordingDiv,
                        amountPerShare: parseFloat(e.target.value) || 0,
                      })
                    }
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Shares Held</label>
                  <input
                    type="number"
                    step="any"
                    value={recordingDiv.sharesHeld}
                    onChange={(e) =>
                      setRecordingDiv({
                        ...recordingDiv,
                        sharesHeld: parseFloat(e.target.value) || 0,
                      })
                    }
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">TDS Deducted (₹)</label>
                <input
                  type="number"
                  step="any"
                  value={recordingDiv.tds}
                  onChange={(e) =>
                    setRecordingDiv({
                      ...recordingDiv,
                      tds: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white"
                />
              </div>

              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex justify-between text-xs">
                <span>
                  Gross: <strong>{formatINR(recordingDiv.amountPerShare * recordingDiv.sharesHeld)}</strong>
                </span>
                <span>
                  Net: <strong className="text-emerald-400">
                    {formatINR(recordingDiv.amountPerShare * recordingDiv.sharesHeld - recordingDiv.tds)}
                  </strong>
                </span>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Note</label>
                <input
                  type="text"
                  value={recordingDiv.note}
                  onChange={(e) => setRecordingDiv({ ...recordingDiv, note: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRecordingDiv(null)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg"
                >
                  Save Dividend Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
