import React from 'react';
import {
  TrendingUp,
  Search,
  SlidersHorizontal,
  AlertTriangle,
  PlusCircle,
  Database,
  RefreshCw,
  Building2,
} from 'lucide-react';
import type { CostMethod, AppSettings } from '../types';
import { isDateOlderThanDays, formatDateDDMMYYYY } from '../utils/formatters';

interface NavbarProps {
  costMethod: CostMethod;
  onCostMethodChange: (method: CostMethod) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeTab: 'portfolio' | 'stocks';
  onTabChange: (tab: 'portfolio' | 'stocks') => void;
  settings: AppSettings | undefined;
  onOpenAddTx: () => void;
  onOpenStockMaster: () => void;
  onOpenBackup: () => void;
  onOpenTargetAvg: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  costMethod,
  onCostMethodChange,
  searchQuery,
  onSearchChange,
  activeTab,
  onTabChange,
  settings,
  onOpenAddTx,
  onOpenStockMaster,
  onOpenBackup,
  onOpenTargetAvg,
}) => {
  const isBackupStale = !settings?.lastBackupDate || isDateOlderThanDays(settings.lastBackupDate, 14);

  return (
    <header className="sticky top-0 z-30 bg-[#0f172a]/95 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          {/* Brand */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <TrendingUp className="w-6 h-6 text-slate-950 font-bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xl tracking-tight text-white">
                  Dalal <span className="text-emerald-400">Diary's</span>
                </span>
                <span className="hidden sm:inline-block text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  NSE/BSE
                </span>
              </div>
              <p className="hidden md:block text-[11px] text-slate-400 -mt-0.5">
                Long-Term Equity Portfolio Tracker
              </p>
            </div>
          </div>

          {/* Search bar */}
          <div className="flex-1 max-w-md hidden md:block">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search symbol, BSE code, name, sector..."
                className="w-full pl-10 pr-4 py-2 bg-slate-900/90 text-sm text-slate-200 placeholder-slate-500 rounded-lg border border-slate-700/70 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => onSearchChange('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Action buttons & Global Settings */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Global Cost Method dropdown */}
            <div className="flex items-center bg-slate-900/90 border border-slate-700/80 rounded-lg p-1">
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 ml-1.5 hidden sm:block" />
              <select
                value={costMethod}
                onChange={(e) => onCostMethodChange(e.target.value as CostMethod)}
                className="bg-transparent text-xs sm:text-sm font-semibold text-emerald-400 focus:outline-none px-2 py-1 cursor-pointer"
                title="Global Cost Basis Method (Recalculates entire portfolio live)"
              >
                <option value="Average Cost" className="bg-slate-900 text-slate-200">
                  Average Cost
                </option>
                <option value="FIFO" className="bg-slate-900 text-slate-200">
                  FIFO
                </option>
              </select>
            </div>

            {/* Manage Stock Master list */}
            <button
              onClick={onOpenStockMaster}
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-slate-300 border border-slate-700/80 hover:bg-slate-800 transition-all"
              title="Manage Stocks Master List"
            >
              <Building2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Stocks</span>
            </button>

            {/* Buy the Dip quick calculator trigger */}
            <button
              onClick={onOpenTargetAvg}
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 transition-all"
              title="Reverse Target-Average Calculator"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Buy the Dip</span>
            </button>

            {/* Add Transaction */}
            <button
              onClick={onOpenAddTx}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20 transition-all active:scale-95"
            >
              <PlusCircle className="w-4 h-4" />
              <span className="hidden sm:inline">Transaction</span>
            </button>

            {/* Backup & Restore Button with 14-day stale alert */}
            <button
              onClick={onOpenBackup}
              className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                isBackupStale
                  ? 'bg-rose-500/10 border-rose-500/40 text-rose-300 hover:bg-rose-500/20'
                  : 'bg-slate-900 border-slate-700/80 text-slate-300 hover:bg-slate-800'
              }`}
              title={
                isBackupStale
                  ? `Backup Warning: Last backup was ${
                      settings?.lastBackupDate ? formatDateDDMMYYYY(settings.lastBackupDate) : 'Never'
                    }. Please back up your data!`
                  : `Last backup: ${formatDateDDMMYYYY(settings?.lastBackupDate)}`
              }
            >
              <Database className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Backup</span>
              {isBackupStale && (
                <span className="flex items-center gap-0.5 text-[10px] text-rose-400 font-bold">
                  <AlertTriangle className="w-3 h-3 text-rose-400 animate-pulse" />
                  <span className="hidden md:inline">&gt;14d</span>
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Tab Navigation & Mobile Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between pb-3 gap-2">
          {/* Navigation Tabs */}
          <nav className="flex items-center space-x-1 sm:space-x-2">
            <button
              onClick={() => onTabChange('portfolio')}
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all ${
                activeTab === 'portfolio'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              Dashboard & Holdings
            </button>
            <button
              onClick={() => onTabChange('stocks')}
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all ${
                activeTab === 'stocks'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              Stocks & Manual Prices
            </button>
          </nav>

          {/* Mobile search bar */}
          <div className="md:hidden">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search symbol, BSE code, sector..."
                className="w-full pl-9 pr-3 py-1.5 bg-slate-900 text-xs text-slate-200 placeholder-slate-500 rounded-lg border border-slate-700 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
