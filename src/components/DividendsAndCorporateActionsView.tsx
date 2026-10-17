import React, { useState, useMemo } from 'react';
import {
  Coins,
  Scissors,
  PlusCircle,
  Trash2,
  TrendingUp,
  Percent,
  Download,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type {
  Stock,
  DividendRecord,
  CorporateAction,
  HoldingCalculation,
  CorporateActionType,
} from '../types';
import { formatINR, formatDateDDMMYYYY } from '../utils/formatters';

interface DividendsAndCorporateActionsViewProps {
  stocks: Stock[];
  dividends: DividendRecord[];
  corporateActions: CorporateAction[];
  holdings: HoldingCalculation[];
  onAddDividend: (dividend: Omit<DividendRecord, 'id' | 'createdAt'>) => Promise<void>;
  onDeleteDividend: (id: number) => Promise<void>;
  onAddCorporateAction: (action: Omit<CorporateAction, 'id' | 'createdAt'>) => Promise<void>;
  onDeleteCorporateAction: (id: number) => Promise<void>;
}

export const DividendsAndCorporateActionsView: React.FC<
  DividendsAndCorporateActionsViewProps
> = ({
  stocks,
  dividends,
  corporateActions,
  holdings,
  onAddDividend,
  onDeleteDividend,
  onAddCorporateAction,
  onDeleteCorporateAction,
}) => {
  const [activeTab, setActiveTab] = useState<'dividends' | 'corporateActions'>('dividends');

  // Dividend Form State
  const [isAddingDividend, setIsAddingDividend] = useState(false);
  const [selectedStockId, setSelectedStockId] = useState<number>(stocks[0]?.id || 0);
  const [divDate, setDivDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [amountPerShare, setAmountPerShare] = useState<string>('');
  const [sharesHeld, setSharesHeld] = useState<string>('');
  const [tdsAmount, setTdsAmount] = useState<string>('0');
  const [divNote, setDivNote] = useState<string>('');

  // Corporate Action Form State
  const [isAddingCA, setIsAddingCA] = useState(false);
  const [caStockId, setCaStockId] = useState<number>(stocks[0]?.id || 0);
  const [caType, setCaType] = useState<CorporateActionType>('SPLIT');
  const [fromFactor, setFromFactor] = useState<string>('1');
  const [toFactor, setToFactor] = useState<string>('2');
  const [exDate, setExDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [caNote, setCaNote] = useState<string>('');

  // Update default shares held when stock changes
  const handleStockSelectChange = (sId: number) => {
    setSelectedStockId(sId);
    const holding = holdings.find((h) => h.stock.id === sId);
    if (holding && holding.quantity > 0) {
      setSharesHeld(holding.quantity.toString());
    }
  };

  // 1. Dividend Metrics
  const totalLifetimeDividends = useMemo(() => {
    return dividends.reduce(
      (sum, d) => sum + (d.amountPerShare * d.sharesHeld - (d.tds || 0)),
      0
    );
  }, [dividends]);

  const totalGrossDividends = useMemo(() => {
    return dividends.reduce((sum, d) => sum + d.amountPerShare * d.sharesHeld, 0);
  }, [dividends]);

  const totalTDS = useMemo(() => {
    return dividends.reduce((sum, d) => sum + (d.tds || 0), 0);
  }, [dividends]);

  const projectedAnnualDividends = useMemo(() => {
    return holdings.reduce((sum, h) => sum + h.annualDividendIncome, 0);
  }, [holdings]);

  const portfolioYoC = useMemo(() => {
    const totalInvested = holdings.reduce((sum, h) => sum + h.totalInvested, 0);
    if (totalInvested <= 0) return 0;
    return (projectedAnnualDividends / totalInvested) * 100;
  }, [holdings, projectedAnnualDividends]);

  // Per-stock dividend breakdown
  const perStockDividends = useMemo(() => {
    const map = new Map<
      number,
      {
        stock: Stock;
        totalReceived: number;
        payoutsCount: number;
        holding?: HoldingCalculation;
      }
    >();

    for (const d of dividends) {
      const stock = stocks.find((s) => s.id === d.stockId);
      if (!stock) continue;
      const curr = map.get(d.stockId) || {
        stock,
        totalReceived: 0,
        payoutsCount: 0,
        holding: holdings.find((h) => h.stock.id === d.stockId),
      };
      curr.totalReceived += d.amountPerShare * d.sharesHeld - (d.tds || 0);
      curr.payoutsCount++;
      map.set(d.stockId, curr);
    }

    return Array.from(map.values()).sort((a, b) => b.totalReceived - a.totalReceived);
  }, [dividends, stocks, holdings]);

  // Handle Add Dividend Submit
  const handleDividendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const stock = stocks.find((s) => s.id === selectedStockId);
    if (!stock || !stock.id) return;

    const perShare = parseFloat(amountPerShare);
    const shares = parseFloat(sharesHeld);
    const tds = parseFloat(tdsAmount) || 0;

    if (isNaN(perShare) || perShare <= 0 || isNaN(shares) || shares <= 0) return;

    await onAddDividend({
      stockId: stock.id,
      symbol: stock.symbol,
      date: divDate,
      amountPerShare: perShare,
      sharesHeld: shares,
      tds: tds > 0 ? tds : undefined,
      note: divNote.trim() || undefined,
    });

    setAmountPerShare('');
    setDivNote('');
    setIsAddingDividend(false);
  };

  // Handle Add Corporate Action Submit
  const handleCASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const stock = stocks.find((s) => s.id === caStockId);
    if (!stock || !stock.id) return;

    const fromF = parseFloat(fromFactor);
    const toF = parseFloat(toFactor);

    if (isNaN(fromF) || fromF <= 0 || isNaN(toF) || toF <= 0) return;

    await onAddCorporateAction({
      stockId: stock.id,
      symbol: stock.symbol,
      type: caType,
      fromFactor: fromF,
      toFactor: toF,
      exDate,
      note: caNote.trim() || undefined,
    });

    setCaNote('');
    setIsAddingCA(false);
  };

  // Export Dividends to Excel
  const handleExportDividendsExcel = () => {
    const wb = XLSX.utils.book_new();

    const data = dividends.map((d) => ({
      Symbol: d.symbol,
      Date: d.date,
      'Shares Held': d.sharesHeld,
      'Amount Per Share (₹)': d.amountPerShare,
      'Gross Dividend (₹)': d.amountPerShare * d.sharesHeld,
      'TDS Deducted (₹)': d.tds || 0,
      'Net Received (₹)': d.amountPerShare * d.sharesHeld - (d.tds || 0),
      Notes: d.note || '',
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Dividends');
    XLSX.writeFile(wb, `DalalDiary_Dividends_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 p-5 rounded-2xl border border-slate-800 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <Coins className="w-6 h-6 text-emerald-400" />
              Dividends & Corporate Actions
            </h1>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Cashflows & Actions
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Track cumulative passive income, net cash flows after TDS, stock splits and bonus issues with dynamic retroactive adjustments.
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 self-start md:self-auto">
          <button
            onClick={() => setActiveTab('dividends')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'dividends'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Coins className="w-3.5 h-3.5 text-emerald-400" />
            <span>Dividend Tracker ({dividends.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('corporateActions')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'corporateActions'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Scissors className="w-3.5 h-3.5 text-teal-400" />
            <span>Splits & Bonuses ({corporateActions.length})</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <Coins className="w-4 h-4 text-emerald-400" />
            Net Dividends Received
          </span>
          <div className="mt-2">
            <span className="text-xl sm:text-2xl font-black text-emerald-400">
              {formatINR(totalLifetimeDividends)}
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Gross: {formatINR(totalGrossDividends)} (TDS: {formatINR(totalTDS)})
            </p>
          </div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-teal-400" />
            Est. Annual Run-rate
          </span>
          <div className="mt-2">
            <span className="text-xl sm:text-2xl font-black text-teal-300">
              {formatINR(projectedAnnualDividends)}
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Based on active portfolio holdings
            </p>
          </div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <Percent className="w-4 h-4 text-amber-400" />
            Portfolio Yield on Cost
          </span>
          <div className="mt-2">
            <span className="text-xl sm:text-2xl font-black text-amber-300">
              {portfolioYoC.toFixed(2)}%
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Annual yield on invested capital
            </p>
          </div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <Scissors className="w-4 h-4 text-purple-400" />
            Corporate Actions
          </span>
          <div className="mt-2">
            <span className="text-xl sm:text-2xl font-black text-purple-300">
              {corporateActions.length} Active
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Dynamically adjusted in calculation layer
            </p>
          </div>
        </div>
      </div>

      {/* ================= TAB 1: DIVIDENDS ================= */}
      {activeTab === 'dividends' && (
        <div className="space-y-6">
          {/* Header Action Bar */}
          <div className="flex items-center justify-between bg-slate-900/80 p-4 rounded-xl border border-slate-800">
            <span className="text-xs text-slate-300 font-medium">
              Record historical dividend credits to accurately factor income into your XIRR.
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportDividendsExcel}
                disabled={dividends.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs font-semibold rounded-lg transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Excel</span>
              </button>
              <button
                onClick={() => {
                  if (stocks.length > 0) {
                    handleStockSelectChange(stocks[0].id || 0);
                  }
                  setIsAddingDividend(!isAddingDividend);
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg shadow-sm transition-all"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Record Dividend</span>
              </button>
            </div>
          </div>

          {/* Add Dividend Form */}
          {isAddingDividend && (
            <form
              onSubmit={handleDividendSubmit}
              className="p-5 bg-slate-950 border border-slate-800 rounded-2xl shadow-xl space-y-4"
            >
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Coins className="w-4 h-4 text-emerald-400" />
                Record Dividend Payout
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 font-medium mb-1">
                    Select Stock
                  </label>
                  <select
                    value={selectedStockId}
                    onChange={(e) => handleStockSelectChange(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  >
                    {stocks.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.symbol} ({s.name})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 font-medium mb-1">
                    Credit Date
                  </label>
                  <input
                    type="date"
                    value={divDate}
                    onChange={(e) => setDivDate(e.target.value)}
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 font-medium mb-1">
                    Dividend Per Share (₹)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={amountPerShare}
                    onChange={(e) => setAmountPerShare(e.target.value)}
                    placeholder="e.g. 10.50"
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 font-medium mb-1">
                    Shares Held
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={sharesHeld}
                    onChange={(e) => setSharesHeld(e.target.value)}
                    placeholder="100"
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 font-medium mb-1">
                    TDS Deducted (₹)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={tdsAmount}
                    onChange={(e) => setTdsAmount(e.target.value)}
                    placeholder="0"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 font-medium mb-1">
                  Note (e.g. Interim Dividend FY24)
                </label>
                <input
                  type="text"
                  value={divNote}
                  onChange={(e) => setDivNote(e.target.value)}
                  placeholder="Optional memo"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                />
              </div>

              {/* Calculation Preview */}
              {parseFloat(amountPerShare) > 0 && parseFloat(sharesHeld) > 0 && (
                <div className="bg-slate-900 p-3 rounded-lg flex items-center justify-between text-xs text-slate-300">
                  <span>
                    Gross:{' '}
                    <strong className="text-white">
                      {formatINR(parseFloat(amountPerShare) * parseFloat(sharesHeld))}
                    </strong>
                  </span>
                  <span>
                    TDS: <strong className="text-amber-400">{formatINR(parseFloat(tdsAmount) || 0)}</strong>
                  </span>
                  <span>
                    Net Inflow:{' '}
                    <strong className="text-emerald-400">
                      {formatINR(
                        parseFloat(amountPerShare) * parseFloat(sharesHeld) -
                          (parseFloat(tdsAmount) || 0)
                      )}
                    </strong>
                  </span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddingDividend(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg shadow-sm"
                >
                  Save Dividend Record
                </button>
              </div>
            </form>
          )}

          {/* Dividends Log Table */}
          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 overflow-hidden shadow-lg">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-200">
                Historical Dividends Log ({dividends.length})
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Credit Date</th>
                    <th className="py-3 px-4 font-semibold">Symbol</th>
                    <th className="py-3 px-4 font-semibold text-right">Shares Held</th>
                    <th className="py-3 px-4 font-semibold text-right">Amount/Share</th>
                    <th className="py-3 px-4 font-semibold text-right">Gross Amount</th>
                    <th className="py-3 px-4 font-semibold text-right">TDS (₹)</th>
                    <th className="py-3 px-4 font-semibold text-right text-emerald-300">Net Received</th>
                    <th className="py-3 px-4 font-semibold">Note</th>
                    <th className="py-3 px-4 font-semibold text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {dividends.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500 italic">
                        No dividend entries recorded yet. Click "Record Dividend" above.
                      </td>
                    </tr>
                  ) : (
                    [...dividends]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((d) => {
                        const gross = d.amountPerShare * d.sharesHeld;
                        const net = gross - (d.tds || 0);

                        return (
                          <tr key={d.id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="py-3 px-4 font-medium text-slate-200">
                              {formatDateDDMMYYYY(d.date)}
                            </td>
                            <td className="py-3 px-4 font-bold text-white">{d.symbol}</td>
                            <td className="py-3 px-4 text-right text-slate-200">{d.sharesHeld}</td>
                            <td className="py-3 px-4 text-right text-slate-200">
                              {formatINR(d.amountPerShare)}
                            </td>
                            <td className="py-3 px-4 text-right text-slate-300">{formatINR(gross)}</td>
                            <td className="py-3 px-4 text-right text-amber-400">
                              {d.tds ? formatINR(d.tds) : '--'}
                            </td>
                            <td className="py-3 px-4 text-right font-bold text-emerald-400">
                              {formatINR(net)}
                            </td>
                            <td className="py-3 px-4 text-slate-400">{d.note || '--'}</td>
                            <td className="py-3 px-4 text-center">
                              {d.id && (
                                <button
                                  onClick={() => onDeleteDividend(d.id!)}
                                  className="text-slate-500 hover:text-rose-400 p-1 transition-colors"
                                  title="Delete dividend entry"
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

          {/* Per-Stock Dividend Summary Table */}
          {perStockDividends.length > 0 && (
            <div className="bg-slate-900/90 rounded-2xl border border-slate-800 overflow-hidden shadow-lg">
              <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-200">
                    Per-Stock Lifetime Dividend Income & Yield on Cost
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Cumulative dividends collected per company and realized cash yield on your invested capital.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Stock Symbol</th>
                      <th className="py-3 px-4 font-semibold">Company Name</th>
                      <th className="py-3 px-4 font-semibold text-center">Payouts</th>
                      <th className="py-3 px-4 font-semibold text-right">Shares Held</th>
                      <th className="py-3 px-4 font-semibold text-right">Invested Capital</th>
                      <th className="py-3 px-4 font-semibold text-right text-emerald-300">
                        Total Dividends Received
                      </th>
                      <th className="py-3 px-4 font-semibold text-right text-amber-300">
                        Realized Cash Yield %
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {perStockDividends.map((item) => {
                      const invested = item.holding?.totalInvested || 0;
                      const yieldPct = invested > 0 ? (item.totalReceived / invested) * 100 : 0;

                      return (
                        <tr key={item.stock.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4 font-bold text-white">{item.stock.symbol}</td>
                          <td className="py-3 px-4 text-slate-300">{item.stock.name}</td>
                          <td className="py-3 px-4 text-center text-slate-400">
                            {item.payoutsCount}
                          </td>
                          <td className="py-3 px-4 text-right text-slate-200">
                            {item.holding?.quantity || 0}
                          </td>
                          <td className="py-3 px-4 text-right text-slate-200 font-mono">
                            {formatINR(invested)}
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-emerald-400 font-mono">
                            {formatINR(item.totalReceived)}
                          </td>
                          <td className="py-3 px-4 text-right font-extrabold text-amber-300">
                            {yieldPct > 0 ? `${yieldPct.toFixed(2)}%` : '--'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 2: CORPORATE ACTIONS ================= */}
      {activeTab === 'corporateActions' && (
        <div className="space-y-6">
          {/* Information Notice */}
          <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center shrink-0 mt-0.5 border border-teal-500/20">
              <Scissors className="w-4 h-4 text-teal-400" />
            </div>
            <div className="text-xs text-slate-300 space-y-1">
              <span className="font-bold text-white">
                Clean Non-Destructive Corporate Action Engine:
              </span>
              <p className="text-slate-400 leading-relaxed">
                Dalal Diary's never touches or mutates your original transaction database records. When you record a Stock Split (e.g. 1:2) or Bonus Issue (e.g. 1:1), our calculation engine applies the ratio dynamically on-the-fly to all buy/sell transactions dated before the ex-date. Deleting an action here completely and safely restores original numbers without any data corruption.
              </p>
            </div>
            <button
              onClick={() => setIsAddingCA(!isAddingCA)}
              className="ml-auto shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg shadow-sm transition-all"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Record Action</span>
            </button>
          </div>

          {/* Add Corporate Action Form */}
          {isAddingCA && (
            <form
              onSubmit={handleCASubmit}
              className="p-5 bg-slate-950 border border-slate-800 rounded-2xl shadow-xl space-y-4"
            >
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Scissors className="w-4 h-4 text-teal-400" />
                Record Stock Split or Bonus Issue
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 font-medium mb-1">
                    Select Stock
                  </label>
                  <select
                    value={caStockId}
                    onChange={(e) => setCaStockId(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  >
                    {stocks.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.symbol} ({s.name})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 font-medium mb-1">
                    Action Type
                  </label>
                  <select
                    value={caType}
                    onChange={(e) => setCaType(e.target.value as CorporateActionType)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  >
                    <option value="SPLIT">Stock Split (e.g. 1:2)</option>
                    <option value="BONUS">Bonus Issue (e.g. 1:1)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 font-medium mb-1">
                    From Shares (Factor)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={fromFactor}
                    onChange={(e) => setFromFactor(e.target.value)}
                    placeholder="1"
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 font-medium mb-1">
                    To Shares (Multiplier)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={toFactor}
                    onChange={(e) => setToFactor(e.target.value)}
                    placeholder="2"
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 font-medium mb-1">
                    Ex-Date
                  </label>
                  <input
                    type="date"
                    value={exDate}
                    onChange={(e) => setExDate(e.target.value)}
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 font-medium mb-1">
                  Note / Reference
                </label>
                <input
                  type="text"
                  value={caNote}
                  onChange={(e) => setCaNote(e.target.value)}
                  placeholder="e.g. 1:2 stock split face value 10 to 5"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddingCA(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg shadow-sm"
                >
                  Apply Corporate Action
                </button>
              </div>
            </form>
          )}

          {/* Active Corporate Actions Table */}
          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 overflow-hidden shadow-lg">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-200">
                Active Corporate Actions ({corporateActions.length})
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Ex-Date</th>
                    <th className="py-3 px-4 font-semibold">Symbol</th>
                    <th className="py-3 px-4 font-semibold">Action Type</th>
                    <th className="py-3 px-4 font-semibold text-center">Ratio</th>
                    <th className="py-3 px-4 font-semibold">Multiplier Effect</th>
                    <th className="py-3 px-4 font-semibold">Note</th>
                    <th className="py-3 px-4 font-semibold text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {corporateActions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500 italic">
                        No corporate actions recorded. Click "Record Action" above when a stock splits or issues bonuses.
                      </td>
                    </tr>
                  ) : (
                    corporateActions.map((ca) => (
                      <tr key={ca.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 font-bold text-white">
                          {formatDateDDMMYYYY(ca.exDate)}
                        </td>
                        <td className="py-3 px-4 font-extrabold text-emerald-400">{ca.symbol}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              ca.type === 'SPLIT'
                                ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30'
                                : 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                            }`}
                          >
                            {ca.type}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold text-slate-200">
                          {ca.fromFactor} : {ca.toFactor}
                        </td>
                        <td className="py-3 px-4 text-slate-300">
                          Shares &times;{(ca.toFactor / ca.fromFactor).toFixed(2)}, Price &divide;
                          {(ca.toFactor / ca.fromFactor).toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-slate-400">{ca.note || '--'}</td>
                        <td className="py-3 px-4 text-center">
                          {ca.id && (
                            <button
                              onClick={() => onDeleteCorporateAction(ca.id!)}
                              className="text-slate-500 hover:text-rose-400 p-1 transition-colors"
                              title="Delete and undo corporate action"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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
    </div>
  );
};
