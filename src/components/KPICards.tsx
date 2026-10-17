import React from 'react';
import {
  Wallet,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  Coins,
  ShieldCheck,
  Scale,
} from 'lucide-react';
import type { PortfolioKPIs, CostMethod } from '../types';
import { formatINR, formatPercent } from '../utils/formatters';

interface KPICardsProps {
  kpis: PortfolioKPIs;
  costMethod: CostMethod;
}

export const KPICards: React.FC<KPICardsProps> = ({ kpis, costMethod }) => {
  const isUnrealizedProfitable = kpis.unrealizedPnL >= 0;
  const isRealizedProfitable = kpis.realizedPnL >= 0;
  const isDayChangePositive = kpis.dayChangeValue >= 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {/* 1. Total Invested */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-4 shadow-sm relative overflow-hidden group hover:border-slate-700 transition-all">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider">Total Invested</span>
          <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
            <Wallet className="w-4 h-4" />
          </div>
        </div>
        <div className="text-xl sm:text-2xl font-extrabold text-white tabular-nums tracking-tight">
          {formatINR(kpis.totalInvested, { compact: false })}
        </div>
        <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
          <span>Cost Basis ({costMethod})</span>
        </div>
      </div>

      {/* 2. Current Value (with change since previous price entry) */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-4 shadow-sm relative overflow-hidden group hover:border-slate-700 transition-all">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider">Current Value</span>
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
            <TrendingUp className="w-4 h-4" />
          </div>
        </div>
        <div className="text-xl sm:text-2xl font-extrabold text-white tabular-nums tracking-tight">
          {formatINR(kpis.currentValue, { compact: false })}
        </div>
        <div className="text-[11px] mt-1 flex items-center gap-1 font-medium">
          {kpis.dayChangeValue !== 0 ? (
            <span
              className={`flex items-center tabular-nums ${
                isDayChangePositive ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {isDayChangePositive ? (
                <ArrowUpRight className="w-3.5 h-3.5" />
              ) : (
                <ArrowDownRight className="w-3.5 h-3.5" />
              )}
              {formatINR(kpis.dayChangeValue, { showSymbol: true })} ({formatPercent(kpis.dayChangePercent)})
            </span>
          ) : (
            <span className="text-slate-500">Based on latest prices</span>
          )}
        </div>
      </div>

      {/* 3. Unrealized P&L */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-4 shadow-sm relative overflow-hidden group hover:border-slate-700 transition-all">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider">Unrealized P&L</span>
          <div
            className={`p-2 rounded-lg ${
              isUnrealizedProfitable ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
            }`}
          >
            {isUnrealizedProfitable ? (
              <ArrowUpRight className="w-4 h-4" />
            ) : (
              <ArrowDownRight className="w-4 h-4" />
            )}
          </div>
        </div>
        <div
          className={`text-xl sm:text-2xl font-extrabold tabular-nums tracking-tight ${
            isUnrealizedProfitable ? 'text-emerald-400' : 'text-rose-400'
          }`}
        >
          {formatINR(kpis.unrealizedPnL)}
        </div>
        <div className="text-[11px] font-semibold mt-1">
          <span className={isUnrealizedProfitable ? 'text-emerald-400' : 'text-rose-400'}>
            {formatPercent(kpis.unrealizedPnLPercent)}
          </span>
          <span className="text-slate-500 font-normal ml-1.5">on active holdings</span>
        </div>
      </div>

      {/* 4. Realized P&L */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-4 shadow-sm relative overflow-hidden group hover:border-slate-700 transition-all">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider">Realized P&L</span>
          <div
            className={`p-2 rounded-lg ${
              isRealizedProfitable ? 'bg-teal-500/10 text-teal-400' : 'bg-rose-500/10 text-rose-400'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>
        <div
          className={`text-xl sm:text-2xl font-extrabold tabular-nums tracking-tight ${
            isRealizedProfitable ? 'text-teal-400' : 'text-rose-400'
          }`}
        >
          {formatINR(kpis.realizedPnL)}
        </div>
        <div className="text-[11px] text-slate-500 mt-1">
          From all booked sales
        </div>
      </div>

      {/* 5. Annual Dividend & Yield on Cost */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-4 shadow-sm relative overflow-hidden group hover:border-slate-700 transition-all">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider">Annual Dividend</span>
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
            <Coins className="w-4 h-4" />
          </div>
        </div>
        <div className="text-xl sm:text-2xl font-extrabold text-white tabular-nums tracking-tight">
          {formatINR(kpis.annualDividendIncome)}
        </div>
        <div className="text-[11px] mt-1 text-slate-400">
          YoC:{' '}
          <span className="text-amber-400 font-semibold tabular-nums">
            {formatPercent(kpis.portfolioYieldOnCost)}
          </span>
        </div>
      </div>

      {/* 6. Portfolio Quality (Value-Weighted ROCE & P/E) */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-4 shadow-sm relative overflow-hidden group hover:border-slate-700 transition-all">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider">Portfolio Quality</span>
          <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
            <ShieldCheck className="w-4 h-4" />
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <div className="text-lg font-bold text-emerald-400 tabular-nums">
            {kpis.valueWeightedROCE ? `${kpis.valueWeightedROCE.toFixed(1)}%` : '—'}
          </div>
          <span className="text-xs text-slate-500">ROCE</span>
        </div>
        <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
          <Scale className="w-3 h-3 text-slate-500" />
          <span>Weighted P/E: </span>
          <span className="text-slate-200 font-semibold tabular-nums">
            {kpis.valueWeightedPE ? `${kpis.valueWeightedPE.toFixed(1)}x` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
};
