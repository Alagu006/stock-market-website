import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { MarketIndicesData } from '../types';
import { isIndianMarketOpen } from '../services/priceFeed';

interface TopIndicesRibbonProps {
  indices: MarketIndicesData | null;
  activeExchange: 'NSE' | 'BSE';
  onToggleExchange: (exchange: 'NSE' | 'BSE') => void;
  refreshMode: 'Manual' | 'Auto 15s' | 'Auto 30s' | 'Off';
  onChangeRefreshMode: (mode: 'Manual' | 'Auto 15s' | 'Auto 30s' | 'Off') => void;
  isSyncing: boolean;
  onManualSync: () => void;
  lastSynced: Date | null;
  serverStatus: { isOnline: boolean; message: string };
}

export const TopIndicesRibbon: React.FC<TopIndicesRibbonProps> = ({
  indices,
  activeExchange,
  onToggleExchange,
  refreshMode,
  onChangeRefreshMode,
  isSyncing,
  onManualSync,
  lastSynced,
  serverStatus,
}) => {
  const isMarketOpen = isIndianMarketOpen();

  const formatIndexVal = (val?: number) => {
    if (!val) return '--';
    return val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatPoints = (val?: number) => {
    if (val === undefined || val === null) return '--';
    const sign = val >= 0 ? '+' : '';
    return `${sign}${val.toFixed(2)}`;
  };

  const formatPct = (val?: number) => {
    if (val === undefined || val === null) return '--';
    const sign = val >= 0 ? '+' : '';
    return `${sign}${val.toFixed(2)}%`;
  };

  const items = [
    { key: 'nifty50', label: 'NIFTY 50', data: indices?.nifty50 },
    { key: 'sensex', label: 'SENSEX', data: indices?.sensex },
    { key: 'niftyBank', label: 'NIFTY BANK', data: indices?.niftyBank },
  ];

  return (
    <div className="bg-[#090d16] border-b border-slate-800/80 px-4 py-2 text-xs">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-2.5">
        {/* Indices Ticker Items */}
        <div className="flex items-center gap-3 sm:gap-6 overflow-x-auto no-scrollbar w-full md:w-auto">
          {items.map((item) => {
            const d = item.data;
            const isPositive = (d?.change ?? 0) >= 0;

            return (
              <div key={item.key} className="flex items-center gap-2 shrink-0">
                <span className="font-bold text-slate-400 text-[11px] tracking-wide">
                  {item.label}
                </span>
                <span className="font-extrabold text-white text-xs font-mono">
                  {formatIndexVal(d?.level)}
                </span>
                <span
                  className={`flex items-center text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${
                    isPositive
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-rose-500/10 text-rose-400'
                  }`}
                >
                  {isPositive ? (
                    <TrendingUp className="w-2.5 h-2.5 mr-0.5" />
                  ) : (
                    <TrendingDown className="w-2.5 h-2.5 mr-0.5" />
                  )}
                  {formatPoints(d?.change)} ({formatPct(d?.changePercent)})
                </span>
              </div>
            );
          })}
        </div>

        {/* Live Controls & Status Strip */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0 self-end md:self-auto text-[11px]">
          {/* Market Hours Indicator */}
          <div
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-300"
            title="Trading hours: 09:15 to 15:30 IST (Mon to Fri)"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isMarketOpen ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
              }`}
            />
            <span className="text-[10px] font-semibold">
              {isMarketOpen ? 'Market Live' : 'Market Closed'}
            </span>
          </div>

          {/* Global NSE / BSE Toggle */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5">
            <button
              onClick={() => onToggleExchange('NSE')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                activeExchange === 'NSE'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              NSE Live
            </button>
            <button
              onClick={() => onToggleExchange('BSE')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                activeExchange === 'BSE'
                  ? 'bg-teal-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              BSE Live
            </button>
          </div>

          {/* Refresh Mode Selector */}
          <select
            value={refreshMode}
            onChange={(e) => onChangeRefreshMode(e.target.value as any)}
            className="bg-slate-900 border border-slate-800 text-slate-300 rounded-lg px-2 py-1 text-[10px] font-semibold focus:outline-none focus:border-emerald-500"
            title="Price feed auto-refresh mode"
          >
            <option value="Manual">Manual</option>
            <option value="Auto 15s">Auto 15s</option>
            <option value="Auto 30s">Auto 30s</option>
            <option value="Off">Off</option>
          </select>

          {/* Manual Sync Button */}
          <button
            onClick={onManualSync}
            disabled={isSyncing}
            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg font-bold text-[10px] transition-all disabled:opacity-50 active:scale-95"
            title="Sync live quotes now"
          >
            <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>

          {/* Timestamp */}
          {lastSynced && (
            <span className="text-[10px] text-slate-500 font-mono hidden xl:inline">
              Synced: {lastSynced.toLocaleTimeString('en-IN')}
            </span>
          )}

          {/* Server Connection Indicator */}
          <div
            className="flex items-center text-[10px]"
            title={serverStatus.message}
          >
            {serverStatus.isOnline ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <span className="flex items-center gap-1 text-amber-400 font-medium">
                <WifiOff className="w-3.5 h-3.5" />
                <span className="hidden lg:inline text-[9px]">Connecting</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
