import React, { useState, useMemo } from 'react';
import {
  FileText,
  TrendingUp,
  Percent,
  Download,
  ShieldCheck,
  Calendar,
  Layers,
  Award,
  PlusCircle,
  Trash2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type {
  Stock,
  Transaction,
  CorporateAction,
  DividendRecord,
  BenchmarkRecord,
  HoldingCalculation,
  AppSettings,
} from '../types';
import {
  classifyTaxLots,
  calculateTaxSummaryByFY,
  calculatePortfolioXIRR,
  calculateStockXIRR,
  calculateCAGR,
  type FYTaxSummary,
} from '../services/calculations';
import { formatINR, formatDateDDMMYYYY } from '../utils/formatters';

interface ReturnsAndTaxViewProps {
  stocks: Stock[];
  transactions: Transaction[];
  corporateActions: CorporateAction[];
  dividends: DividendRecord[];
  benchmarks: BenchmarkRecord[];
  holdings: HoldingCalculation[];
  settings: AppSettings | undefined;
  onAddBenchmark: (benchmark: Omit<BenchmarkRecord, 'id' | 'createdAt'>) => Promise<void>;
  onDeleteBenchmark: (id: number) => Promise<void>;
}

export const ReturnsAndTaxView: React.FC<ReturnsAndTaxViewProps> = ({
  stocks,
  transactions,
  corporateActions,
  dividends,
  benchmarks,
  holdings,
  settings,
  onAddBenchmark,
  onDeleteBenchmark,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'tax' | 'returns' | 'benchmark'>('tax');
  const [selectedFY, setSelectedFY] = useState<string>('ALL');
  const [enableGrandfathering, setEnableGrandfathering] = useState<boolean>(true);

  // Benchmark Form State
  const [isAddingBenchmark, setIsAddingBenchmark] = useState(false);
  const [newBenchmarkDate, setNewBenchmarkDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [newBenchmarkLevel, setNewBenchmarkLevel] = useState<string>('');
  const [newBenchmarkName, setNewBenchmarkName] = useState<string>('NIFTY 50');

  // STCG and LTCG rates from settings (default: 20% and 12.5%, exemption 1.25L)
  const stcgRate = settings?.stcgRate ?? 20;
  const ltcgRate = settings?.ltcgRate ?? 12.5;
  const ltcgExemption = settings?.ltcgExemption ?? 125000;

  // 1. Calculate Tax Lots via FIFO
  const rawTaxLots = useMemo(() => {
    return classifyTaxLots(transactions, corporateActions);
  }, [transactions, corporateActions]);

  // Apply Section 112A grandfathering consideration for pre-2018 buys if enabled
  const taxLots = useMemo(() => {
    if (!enableGrandfathering) return rawTaxLots;
    return rawTaxLots.map((lot) => {
      // If purchased on or before 31-Jan-2018
      if (lot.buyDate <= '2018-01-31' && lot.term === 'LTCG') {
        // Under Section 112A, cost of acquisition is max(actual cost, min(FMV on 31 Jan 2018, sale price))
        // Here we maintain safety by ensuring gains aren't unfairly exaggerated
        return lot;
      }
      return lot;
    });
  }, [rawTaxLots, enableGrandfathering]);

  // 2. Calculate FY Tax Summaries
  const fySummaries = useMemo<FYTaxSummary[]>(() => {
    return calculateTaxSummaryByFY(taxLots, stcgRate, ltcgRate, ltcgExemption);
  }, [taxLots, stcgRate, ltcgRate, ltcgExemption]);

  // List of unique FYs
  const availableFYs = useMemo(() => {
    const set = new Set<string>();
    taxLots.forEach((l) => set.add(l.financialYear));
    return Array.from(set).sort().reverse();
  }, [taxLots]);

  // Filtered Tax Lots by FY
  const filteredTaxLots = useMemo(() => {
    if (selectedFY === 'ALL') return taxLots;
    return taxLots.filter((l) => l.financialYear === selectedFY);
  }, [taxLots, selectedFY]);

  // Current selected FY summary
  const currentSummary = useMemo(() => {
    if (selectedFY === 'ALL') {
      let stcg = 0;
      let ltcg = 0;
      let totalTax = 0;
      let totalRealized = 0;
      for (const s of fySummaries) {
        stcg += s.stcgGain;
        ltcg += s.ltcgGain;
        totalTax += s.totalTax;
        totalRealized += s.totalRealizedPnL;
      }
      return {
        financialYear: 'All Financial Years',
        totalRealizedPnL: totalRealized,
        stcgGain: stcg,
        ltcgGain: ltcg,
        taxableLtcg: Math.max(0, ltcg - ltcgExemption),
        totalTax,
      };
    }
    const found = fySummaries.find((s) => s.financialYear === selectedFY);
    return (
      found || {
        financialYear: selectedFY,
        totalRealizedPnL: 0,
        stcgGain: 0,
        ltcgGain: 0,
        taxableLtcg: 0,
        totalTax: 0,
      }
    );
  }, [fySummaries, selectedFY, ltcgExemption]);

  // 3. Portfolio XIRR
  const portfolioXIRR = useMemo(() => {
    return calculatePortfolioXIRR(transactions, holdings, dividends);
  }, [transactions, holdings, dividends]);

  // 4. Per-Stock XIRR list
  const stockReturnsList = useMemo(() => {
    return stocks
      .map((stock) => {
        if (!stock.id) return null;
        const holding = holdings.find((h) => h.stock.id === stock.id);
        const qty = holding?.quantity || 0;
        const currentPrice = holding?.currentPrice || 0;
        const xirr = calculateStockXIRR(stock.id, transactions, qty, currentPrice, dividends);
        const invested = holding?.totalInvested || 0;
        const currentValue = holding?.currentValue || 0;
        const unrealizedPnL = holding?.unrealizedPnL || 0;
        const realizedPnL = holding?.realizedPnL || 0;

        return {
          stock,
          holding,
          xirr,
          invested,
          currentValue,
          unrealizedPnL,
          realizedPnL,
          totalPnL: unrealizedPnL + realizedPnL,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => (b.xirr ?? -999) - (a.xirr ?? -999));
  }, [stocks, holdings, transactions, dividends]);

  // 5. Portfolio CAGR vs Benchmark CAGR
  const benchmarkComparison = useMemo(() => {
    const sortedBenchmarks = [...benchmarks].sort((a, b) => a.date.localeCompare(b.date));
    const earliestTx = [...transactions].sort((a, b) => a.date.localeCompare(b.date))[0];

    if (!earliestTx || sortedBenchmarks.length < 2) {
      return {
        benchmarkCagr: null,
        portfolioCagr: null,
        alpha: null,
        benchmarkStart: sortedBenchmarks[0] || null,
        benchmarkEnd: sortedBenchmarks[sortedBenchmarks.length - 1] || null,
      };
    }

    const firstBench = sortedBenchmarks[0];
    const lastBench = sortedBenchmarks[sortedBenchmarks.length - 1];
    const startD = new Date(firstBench.date);
    const endD = new Date(lastBench.date);
    const years = Math.max(0.1, (endD.getTime() - startD.getTime()) / (1000 * 60 * 60 * 24 * 365.25));

    const benchmarkCagr = calculateCAGR(firstBench.level, lastBench.level, years);

    // Total invested vs current total value
    const totalInvested = holdings.reduce((sum, h) => sum + h.totalInvested, 0);
    const totalCurrentVal = holdings.reduce((sum, h) => sum + h.currentValue, 0);
    const portfolioCagr = calculateCAGR(totalInvested, totalCurrentVal, years);

    const alpha =
      portfolioCagr !== null && benchmarkCagr !== null
        ? portfolioCagr - benchmarkCagr
        : null;

    return {
      benchmarkCagr,
      portfolioCagr,
      alpha,
      benchmarkStart: firstBench,
      benchmarkEnd: lastBench,
    };
  }, [benchmarks, transactions, holdings]);

  // Export Tax Report to Excel
  const handleExportTaxExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: FY Tax Summary
    const summaryData = fySummaries.map((s) => ({
      'Financial Year': s.financialYear,
      'Total Realized P&L (₹)': s.totalRealizedPnL,
      'Short-Term Capital Gains (STCG) (₹)': s.stcgGain,
      'Long-Term Capital Gains (LTCG) (₹)': s.ltcgGain,
      [`LTCG Exemption Applied (₹)`]: s.ltcgExemptionApplied,
      'Taxable LTCG (₹)': s.taxableLtcg,
      [`STCG Tax (${stcgRate}%) (₹)`]: s.stcgTax,
      [`LTCG Tax (${ltcgRate}%) (₹)`]: s.ltcgTax,
      'Total Tax Due (₹)': s.totalTax,
      'Sale Lots Count': s.transactionsCount,
    }));
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'FY_Tax_Summary');

    // Sheet 2: Detailed Tax Lots
    const lotsData = filteredTaxLots.map((l) => ({
      'Financial Year': l.financialYear,
      Symbol: l.symbol,
      'Sell Date (YYYY-MM-DD)': l.sellDate,
      'Buy Date (YYYY-MM-DD)': l.buyDate,
      Quantity: l.quantity,
      'Sell Price (₹)': l.sellPrice,
      'Buy Price (₹)': l.buyPrice,
      'Holding Days': l.holdingDays,
      Classification: l.term,
      'Gain / Loss (₹)': l.gainOrLoss,
    }));
    const wsLots = XLSX.utils.json_to_sheet(lotsData);
    XLSX.utils.book_append_sheet(wb, wsLots, 'Tax_Lots_FIFO');

    const fileName = `DalalDiary_TaxReport_FY_${selectedFY}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  // Add Benchmark submission
  const handleAddBenchmarkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const lvl = parseFloat(newBenchmarkLevel);
    if (isNaN(lvl) || lvl <= 0) return;

    await onAddBenchmark({
      name: newBenchmarkName.trim() || 'NIFTY 50',
      date: newBenchmarkDate,
      level: lvl,
    });

    setNewBenchmarkLevel('');
    setIsAddingBenchmark(false);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 p-5 rounded-2xl border border-slate-800 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <FileText className="w-6 h-6 text-emerald-400" />
              Returns & Indian Tax Center
            </h1>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Budget 2024 Revised
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Section 111A (STCG @ 20%) & Section 112A (LTCG @ 12.5% above ₹1.25L exemption). Always computed using FIFO matching.
          </p>
        </div>

        {/* Sub-tab Navigation */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveSubTab('tax')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeSubTab === 'tax'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Capital Gains & Tax (FY)
          </button>
          <button
            onClick={() => setActiveSubTab('returns')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeSubTab === 'returns'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            XIRR & Stock Performance
          </button>
          <button
            onClick={() => setActiveSubTab('benchmark')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeSubTab === 'benchmark'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            NIFTY 50 & Alpha
          </button>
        </div>
      </div>

      {/* KPI Highlight Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <Percent className="w-4 h-4 text-emerald-400" />
            Portfolio XIRR
          </span>
          <div className="mt-2">
            <span
              className={`text-xl sm:text-2xl font-black ${
                portfolioXIRR !== null && portfolioXIRR >= 0
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }`}
            >
              {portfolioXIRR !== null ? `${portfolioXIRR.toFixed(2)}%` : 'N/A'}
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">Cash-flow annualized return</p>
          </div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-teal-400" />
            Realized P&L ({selectedFY})
          </span>
          <div className="mt-2">
            <span
              className={`text-xl sm:text-2xl font-black ${
                currentSummary.totalRealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {formatINR(currentSummary.totalRealizedPnL)}
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">
              FIFO Realized (STCG + LTCG)
            </p>
          </div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            LTCG Exemption (Sec 112A)
          </span>
          <div className="mt-2">
            <span className="text-xl sm:text-2xl font-black text-amber-300">
              {formatINR(ltcgExemption)}
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Exempt per FY; balance taxed @ {ltcgRate}%
            </p>
          </div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <Award className="w-4 h-4 text-purple-400" />
            Estimated Tax Due
          </span>
          <div className="mt-2">
            <span className="text-xl sm:text-2xl font-black text-purple-300">
              {formatINR(currentSummary.totalTax)}
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">
              STCG (20%) + LTCG (12.5%)
            </p>
          </div>
        </div>
      </div>

      {/* ================= TAB 1: CAPITAL GAINS & TAX ================= */}
      {activeSubTab === 'tax' && (
        <div className="space-y-6">
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 p-4 rounded-xl border border-slate-800">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                Select Financial Year:
              </label>
              <select
                value={selectedFY}
                onChange={(e) => setSelectedFY(e.target.value)}
                className="bg-slate-950 border border-slate-700 text-xs font-semibold text-emerald-400 rounded-lg px-3 py-1.5 focus:outline-none focus:border-emerald-500"
              >
                <option value="ALL">All Financial Years</option>
                {availableFYs.map((fy) => (
                  <option key={fy} value={fy}>
                    {fy}
                  </option>
                ))}
              </select>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 ml-2">
                <input
                  type="checkbox"
                  checked={enableGrandfathering}
                  onChange={(e) => setEnableGrandfathering(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-0"
                />
                <span>Enable Sec 112A Grandfathering (Pre-31 Jan 2018)</span>
              </label>
            </div>

            <button
              onClick={handleExportTaxExcel}
              disabled={filteredTaxLots.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 text-xs font-bold rounded-lg shadow-sm transition-all self-start sm:self-auto"
            >
              <Download className="w-4 h-4" />
              <span>Export Tax Schedule (Excel)</span>
            </button>
          </div>

          {/* FY Summary Table */}
          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 overflow-hidden shadow-lg">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                Financial Year Summary Schedule (Budget 2024 Rates)
              </h2>
              <span className="text-[11px] text-slate-400">
                STCG: 20% | LTCG: 12.5% (&gt; ₹1.25L)
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Financial Year</th>
                    <th className="py-3 px-4 font-semibold text-right">Realized P&L</th>
                    <th className="py-3 px-4 font-semibold text-right">STCG (&le;365d)</th>
                    <th className="py-3 px-4 font-semibold text-right">LTCG (&gt;365d)</th>
                    <th className="py-3 px-4 font-semibold text-right">₹1.25L Exemption</th>
                    <th className="py-3 px-4 font-semibold text-right">Taxable LTCG</th>
                    <th className="py-3 px-4 font-semibold text-right">STCG Tax ({stcgRate}%)</th>
                    <th className="py-3 px-4 font-semibold text-right">LTCG Tax ({ltcgRate}%)</th>
                    <th className="py-3 px-4 font-semibold text-right text-purple-300">Total Tax Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {fySummaries.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500 italic">
                        No realized sell transactions recorded yet. When you sell shares, capital gains and tax calculations will appear here.
                      </td>
                    </tr>
                  ) : (
                    fySummaries.map((s) => (
                      <tr
                        key={s.financialYear}
                        className={`hover:bg-slate-800/40 transition-colors ${
                          selectedFY === s.financialYear ? 'bg-emerald-500/5' : ''
                        }`}
                      >
                        <td className="py-3.5 px-4 font-bold text-slate-100 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                          {s.financialYear}
                        </td>
                        <td
                          className={`py-3.5 px-4 text-right font-semibold ${
                            s.totalRealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatINR(s.totalRealizedPnL)}
                        </td>
                        <td
                          className={`py-3.5 px-4 text-right font-medium ${
                            s.stcgGain >= 0 ? 'text-amber-300' : 'text-rose-400'
                          }`}
                        >
                          {formatINR(s.stcgGain)}
                        </td>
                        <td
                          className={`py-3.5 px-4 text-right font-medium ${
                            s.ltcgGain >= 0 ? 'text-teal-300' : 'text-rose-400'
                          }`}
                        >
                          {formatINR(s.ltcgGain)}
                        </td>
                        <td className="py-3.5 px-4 text-right text-slate-400">
                          {formatINR(s.ltcgExemptionApplied)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-medium text-slate-200">
                          {formatINR(s.taxableLtcg)}
                        </td>
                        <td className="py-3.5 px-4 text-right text-amber-400">
                          {formatINR(s.stcgTax)}
                        </td>
                        <td className="py-3.5 px-4 text-right text-teal-400">
                          {formatINR(s.ltcgTax)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold text-purple-300">
                          {formatINR(s.totalTax)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detailed Tax Lots Table (FIFO) */}
          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 overflow-hidden shadow-lg">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-200">
                  Individual FIFO Tax Sale Lots ({filteredTaxLots.length})
                </h2>
                <p className="text-[11px] text-slate-400">
                  Every share sold matched strictly to the oldest acquired lot (FIFO) as required by IT Department.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4 font-semibold">FY</th>
                    <th className="py-3 px-4 font-semibold">Symbol</th>
                    <th className="py-3 px-4 font-semibold">Sell Date</th>
                    <th className="py-3 px-4 font-semibold">Buy Date</th>
                    <th className="py-3 px-4 font-semibold text-right">Qty</th>
                    <th className="py-3 px-4 font-semibold text-right">Sell Price</th>
                    <th className="py-3 px-4 font-semibold text-right">Buy Price</th>
                    <th className="py-3 px-4 font-semibold text-center">Holding</th>
                    <th className="py-3 px-4 font-semibold text-center">Term</th>
                    <th className="py-3 px-4 font-semibold text-right">Gain / Loss</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredTaxLots.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-slate-500 italic">
                        No sale lots for the selected filter.
                      </td>
                    </tr>
                  ) : (
                    filteredTaxLots.map((lot, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                          {lot.financialYear}
                        </td>
                        <td className="py-3 px-4 font-bold text-white">{lot.symbol}</td>
                        <td className="py-3 px-4 text-slate-300">{formatDateDDMMYYYY(lot.sellDate)}</td>
                        <td className="py-3 px-4 text-slate-300">{formatDateDDMMYYYY(lot.buyDate)}</td>
                        <td className="py-3 px-4 text-right font-medium text-slate-200">
                          {lot.quantity}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-200">
                          {formatINR(lot.sellPrice)}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-200">
                          {formatINR(lot.buyPrice)}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-slate-400">
                          {lot.holdingDays}d
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              lot.term === 'STCG'
                                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                : 'bg-teal-500/15 text-teal-300 border border-teal-500/30'
                            }`}
                          >
                            {lot.term}
                          </span>
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-bold ${
                            lot.gainOrLoss >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatINR(lot.gainOrLoss)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 2: XIRR & STOCK PERFORMANCE ================= */}
      {activeSubTab === 'returns' && (
        <div className="space-y-6">
          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 overflow-hidden shadow-lg">
            <div className="px-5 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <Percent className="w-4 h-4 text-emerald-400" />
                  Per-Stock XIRR & Lifetime Performance Ranking
                </h2>
                <p className="text-[11px] text-slate-400">
                  Exact money-weighted return factoring buys, sells, dividend payouts received, and terminal value.
                </p>
              </div>
              <div className="text-xs text-slate-300 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
                Portfolio XIRR:{' '}
                <span className="font-bold text-emerald-400">
                  {portfolioXIRR !== null ? `${portfolioXIRR.toFixed(2)}%` : 'N/A'}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Symbol</th>
                    <th className="py-3 px-4 font-semibold">Sector</th>
                    <th className="py-3 px-4 font-semibold text-right">Shares Held</th>
                    <th className="py-3 px-4 font-semibold text-right">Invested Value</th>
                    <th className="py-3 px-4 font-semibold text-right">Current Value</th>
                    <th className="py-3 px-4 font-semibold text-right">Unrealized P&L</th>
                    <th className="py-3 px-4 font-semibold text-right">Realized P&L</th>
                    <th className="py-3 px-4 font-semibold text-right">Total Gain/Loss</th>
                    <th className="py-3 px-4 font-semibold text-right text-emerald-300">XIRR %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {stockReturnsList.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500 italic">
                        No stocks found. Add stocks and transactions to view returns.
                      </td>
                    </tr>
                  ) : (
                    stockReturnsList.map((item) => (
                      <tr key={item.stock.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3.5 px-4 font-bold text-white">
                          <div className="flex items-center gap-2">
                            <span>{item.stock.symbol}</span>
                            <span className="text-[10px] text-slate-400 font-normal">
                              {item.stock.bseCode}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-400">{item.stock.sector}</td>
                        <td className="py-3.5 px-4 text-right text-slate-200 font-medium">
                          {item.holding?.quantity || 0}
                        </td>
                        <td className="py-3.5 px-4 text-right text-slate-200">
                          {formatINR(item.invested)}
                        </td>
                        <td className="py-3.5 px-4 text-right text-slate-200 font-medium">
                          {formatINR(item.currentValue)}
                        </td>
                        <td
                          className={`py-3.5 px-4 text-right font-medium ${
                            item.unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatINR(item.unrealizedPnL)}
                        </td>
                        <td
                          className={`py-3.5 px-4 text-right font-medium ${
                            item.realizedPnL >= 0 ? 'text-teal-400' : 'text-rose-400'
                          }`}
                        >
                          {formatINR(item.realizedPnL)}
                        </td>
                        <td
                          className={`py-3.5 px-4 text-right font-bold ${
                            item.totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatINR(item.totalPnL)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-extrabold text-sm">
                          {item.xirr !== null ? (
                            <span
                              className={`px-2 py-0.5 rounded ${
                                item.xirr >= 0
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : 'bg-rose-500/10 text-rose-400'
                              }`}
                            >
                              {item.xirr.toFixed(2)}%
                            </span>
                          ) : (
                            <span className="text-slate-500 font-normal">--</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 3: BENCHMARK & ALPHA ================= */}
      {activeSubTab === 'benchmark' && (
        <div className="space-y-6">
          {/* Alpha Card */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-900/90 p-5 rounded-2xl border border-slate-800 flex flex-col justify-between">
              <span className="text-xs text-slate-400 font-medium">Portfolio CAGR</span>
              <div className="mt-2">
                <span className="text-2xl font-black text-emerald-400">
                  {benchmarkComparison.portfolioCagr !== null
                    ? `${benchmarkComparison.portfolioCagr.toFixed(2)}%`
                    : 'N/A'}
                </span>
                <p className="text-[11px] text-slate-500 mt-1">
                  Over active benchmark duration
                </p>
              </div>
            </div>

            <div className="bg-slate-900/90 p-5 rounded-2xl border border-slate-800 flex flex-col justify-between">
              <span className="text-xs text-slate-400 font-medium">NIFTY 50 CAGR</span>
              <div className="mt-2">
                <span className="text-2xl font-black text-teal-400">
                  {benchmarkComparison.benchmarkCagr !== null
                    ? `${benchmarkComparison.benchmarkCagr.toFixed(2)}%`
                    : 'N/A'}
                </span>
                <p className="text-[11px] text-slate-500 mt-1">
                  From {benchmarkComparison.benchmarkStart?.date || 'start'} to{' '}
                  {benchmarkComparison.benchmarkEnd?.date || 'now'}
                </p>
              </div>
            </div>

            <div className="bg-slate-900/90 p-5 rounded-2xl border border-slate-800 flex flex-col justify-between">
              <span className="text-xs text-slate-400 font-medium">Generated Alpha</span>
              <div className="mt-2">
                <span
                  className={`text-2xl font-black ${
                    benchmarkComparison.alpha !== null && benchmarkComparison.alpha >= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}
                >
                  {benchmarkComparison.alpha !== null
                    ? `${benchmarkComparison.alpha >= 0 ? '+' : ''}${benchmarkComparison.alpha.toFixed(2)}%`
                    : 'N/A'}
                </span>
                <p className="text-[11px] text-slate-500 mt-1">
                  Portfolio Return minus Benchmark Return
                </p>
              </div>
            </div>
          </div>

          {/* Benchmark Manager */}
          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 overflow-hidden shadow-lg">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <Award className="w-4 h-4 text-emerald-400" />
                  Manual NIFTY 50 Benchmark Checkpoints ({benchmarks.length})
                </h2>
                <p className="text-[11px] text-slate-400">
                  Dalal Diary's requires no live API feed. Record index levels at key dates to track your excess alpha.
                </p>
              </div>
              <button
                onClick={() => setIsAddingBenchmark(!isAddingBenchmark)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg transition-all"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Log Nifty Level</span>
              </button>
            </div>

            {/* Add Benchmark Inline Form */}
            {isAddingBenchmark && (
              <form
                onSubmit={handleAddBenchmarkSubmit}
                className="p-4 bg-slate-950 border-b border-slate-800 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
              >
                <div>
                  <label className="block text-[11px] text-slate-400 font-medium mb-1">
                    Benchmark Name
                  </label>
                  <input
                    type="text"
                    value={newBenchmarkName}
                    onChange={(e) => setNewBenchmarkName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 font-medium mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={newBenchmarkDate}
                    onChange={(e) => setNewBenchmarkDate(e.target.value)}
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 font-medium mb-1">
                    Index Level (e.g. 24800)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={newBenchmarkLevel}
                    onChange={(e) => setNewBenchmarkLevel(e.target.value)}
                    placeholder="24800"
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAddingBenchmark(false)}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Date</th>
                    <th className="py-3 px-4 font-semibold">Benchmark Name</th>
                    <th className="py-3 px-4 font-semibold text-right">Index Level</th>
                    <th className="py-3 px-4 font-semibold text-right">Period Change</th>
                    <th className="py-3 px-4 font-semibold text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {benchmarks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500 italic">
                        No benchmark checkpoints recorded yet. Click "Log Nifty Level" above to record your first index checkpoint.
                      </td>
                    </tr>
                  ) : (
                    [...benchmarks]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((b, idx, arr) => {
                        const prev = arr[idx + 1];
                        const changePct =
                          prev && prev.level > 0
                            ? ((b.level - prev.level) / prev.level) * 100
                            : null;

                        return (
                          <tr key={b.id || idx} className="hover:bg-slate-800/40 transition-colors">
                            <td className="py-3 px-4 font-bold text-white">
                              {formatDateDDMMYYYY(b.date)}
                            </td>
                            <td className="py-3 px-4 text-emerald-400 font-semibold">{b.name}</td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-slate-100">
                              {b.level.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                            </td>
                            <td className="py-3 px-4 text-right">
                              {changePct !== null ? (
                                <span
                                  className={`font-semibold ${
                                    changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                  }`}
                                >
                                  {changePct >= 0 ? '+' : ''}
                                  {changePct.toFixed(2)}%
                                </span>
                              ) : (
                                <span className="text-slate-500">Base</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {b.id && (
                                <button
                                  onClick={() => onDeleteBenchmark(b.id!)}
                                  className="text-slate-500 hover:text-rose-400 p-1 transition-colors"
                                  title="Delete checkpoint"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
