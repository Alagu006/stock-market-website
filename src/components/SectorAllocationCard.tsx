import React from 'react';
import { PieChart, AlertTriangle, ShieldCheck } from 'lucide-react';
import type { SectorAllocation } from '../types';
import { formatINR, formatPercent } from '../utils/formatters';

interface SectorAllocationCardProps {
  allocations: SectorAllocation[];
  totalPortfolioValue: number;
}

export const SectorAllocationCard: React.FC<SectorAllocationCardProps> = ({
  allocations,
  totalPortfolioValue,
}) => {
  if (allocations.length === 0) {
    return null;
  }

  const hasConcentrationRisk = allocations.some((a) => a.isConcentrated);

  return (
    <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-2">
        <div className="flex items-center gap-2">
          <PieChart className="w-4 h-4 text-emerald-400" />
          <div>
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
              Sector Allocation & Diversification
            </h2>
            <p className="text-[11px] text-slate-500">
              Total Portfolio: {formatINR(totalPortfolioValue)}
            </p>
          </div>
        </div>
        <div>
          {hasConcentrationRisk ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span>Concentration Alert: Sector &gt; 35%</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Well Diversified (&lt; 35% max)</span>
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-4">
        {allocations.map((alloc) => {
          const isWarning = alloc.weightPercent > 35;
          return (
            <div
              key={alloc.sector}
              className={`p-3.5 rounded-lg border transition-all ${
                isWarning
                  ? 'bg-amber-950/20 border-amber-500/40'
                  : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-slate-200 truncate pr-2" title={alloc.sector}>
                  {alloc.sector}
                </span>
                <span
                  className={`text-xs font-extrabold tabular-nums ${
                    isWarning ? 'text-amber-400' : 'text-slate-300'
                  }`}
                >
                  {formatPercent(alloc.weightPercent, 1).replace('+', '')}
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden mb-2">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isWarning
                      ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                      : 'bg-gradient-to-r from-emerald-500 to-teal-400'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(2, alloc.weightPercent))}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Value: {formatINR(alloc.currentValue, { compact: true })}</span>
                {isWarning && (
                  <span className="text-amber-400 font-semibold flex items-center gap-0.5">
                    <AlertTriangle className="w-3 h-3" /> Exceeds 35%
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
