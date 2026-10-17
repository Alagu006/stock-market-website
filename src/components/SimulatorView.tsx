import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  TrendingUp,
  Percent,
  Coins,
  RotateCcw,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { formatINR } from '../utils/formatters';
import { simulateSIPAndLumpSum } from '../services/calculations';

interface SimulatorViewProps {
  currentPortfolioValue?: number;
}

export const SimulatorView: React.FC<SimulatorViewProps> = ({ currentPortfolioValue = 0 }) => {
  const [horizonYears, setHorizonYears] = useState<number>(15);
  const [monthlySIP, setMonthlySIP] = useState<number>(25000);
  const [lumpSum, setLumpSum] = useState<number>(
    currentPortfolioValue > 0 ? Math.round(currentPortfolioValue) : 500000
  );
  const [expectedCagr, setExpectedCagr] = useState<number>(14);
  const [enableDRIP, setEnableDRIP] = useState<boolean>(true);
  const [dividendYield, setDividendYield] = useState<number>(1.5);

  // Simulation run
  const simulation = useMemo(() => {
    return simulateSIPAndLumpSum({
      horizonYears,
      monthlySIP,
      lumpSum,
      expectedCagrPercent: expectedCagr,
      dividendReinvestment: enableDRIP,
      estimatedDividendYieldPercent: dividendYield,
    });
  }, [horizonYears, monthlySIP, lumpSum, expectedCagr, enableDRIP, dividendYield]);

  // Comparison simulation without DRIP to measure DRIP boost
  const simulationWithoutDrip = useMemo(() => {
    return simulateSIPAndLumpSum({
      horizonYears,
      monthlySIP,
      lumpSum,
      expectedCagrPercent: expectedCagr,
      dividendReinvestment: false,
      estimatedDividendYieldPercent: dividendYield,
    });
  }, [horizonYears, monthlySIP, lumpSum, expectedCagr, dividendYield]);

  const dripBoost = Math.max(0, simulation.finalCorpus - simulationWithoutDrip.finalCorpus);

  // Format chart data
  const chartData = useMemo(() => {
    return simulation.yearBreakdown.map((row) => ({
      year: `Yr ${row.year}`,
      'Invested Capital': row.investedCapital,
      'Corpus (No DRIP)': row.corpusWithoutDrip,
      'Corpus (With DRIP)': row.corpusWithDrip,
    }));
  }, [simulation]);

  const handleUseCurrentPortfolio = () => {
    if (currentPortfolioValue > 0) {
      setLumpSum(Math.round(currentPortfolioValue));
    }
  };

  const handleResetDefaults = () => {
    setHorizonYears(15);
    setMonthlySIP(25000);
    setLumpSum(currentPortfolioValue > 0 ? Math.round(currentPortfolioValue) : 500000);
    setExpectedCagr(14);
    setEnableDRIP(true);
    setDividendYield(1.5);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 p-5 rounded-2xl border border-slate-800 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-emerald-400" />
              Long-Term Compounding & DRIP Simulator
            </h1>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              The 8th Wonder of the World
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Model the exponential growth of disciplined monthly SIPs, initial lump-sum equity capital, and dividend reinvestment compounding over multi-decade horizons.
          </p>
        </div>

        <button
          onClick={handleResetDefaults}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg self-start md:self-auto transition-all"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Defaults</span>
        </button>
      </div>

      {/* Outcome Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            Projected Corpus ({horizonYears} Yrs)
          </span>
          <div className="mt-2">
            <span className="text-xl sm:text-2xl font-black text-emerald-400">
              {formatINR(simulation.finalCorpus)}
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Net Wealth Gain: {formatINR(simulation.totalWealthGain)}
            </p>
          </div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <Coins className="w-4 h-4 text-teal-400" />
            Total Capital Invested
          </span>
          <div className="mt-2">
            <span className="text-xl sm:text-2xl font-black text-slate-100">
              {formatINR(simulation.finalInvested)}
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">
              SIP: {formatINR(monthlySIP * 12 * horizonYears)} + Lump: {formatINR(lumpSum)}
            </p>
          </div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <Percent className="w-4 h-4 text-amber-400" />
            Wealth Multiple
          </span>
          <div className="mt-2">
            <span className="text-xl sm:text-2xl font-black text-amber-300">
              {simulation.wealthMultiple}x
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Multiplier over your total principal
            </p>
          </div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-purple-400" />
            DRIP Bonus Wealth
          </span>
          <div className="mt-2">
            <span className="text-xl sm:text-2xl font-black text-purple-300">
              {enableDRIP ? `+${formatINR(dripBoost)}` : 'Disabled'}
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Purely from reinvesting dividends
            </p>
          </div>
        </div>
      </div>

      {/* Simulator Inputs & Interactive Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls Column (Left) */}
        <div className="bg-slate-900/90 p-5 rounded-2xl border border-slate-800 space-y-5">
          <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2 border-b border-slate-800 pb-3">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            Simulation Parameters
          </h2>

          {/* Time Horizon Slider */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-400 font-medium">Investment Horizon</span>
              <span className="font-extrabold text-emerald-400 text-sm">{horizonYears} Years</span>
            </div>
            <input
              type="range"
              min={3}
              max={25}
              step={1}
              value={horizonYears}
              onChange={(e) => setHorizonYears(Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 mt-1">
              <span>3 Yrs</span>
              <span>10 Yrs</span>
              <span>18 Yrs</span>
              <span>25 Yrs</span>
            </div>
          </div>

          {/* Monthly SIP Input */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-400 font-medium">Monthly SIP (₹)</span>
              <span className="font-bold text-white text-xs">{formatINR(monthlySIP)} / mo</span>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-bold">
                ₹
              </span>
              <input
                type="number"
                step="1000"
                min="0"
                value={monthlySIP}
                onChange={(e) => setMonthlySIP(Math.max(0, Number(e.target.value)))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Initial Lump Sum */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-400 font-medium">Initial Lump Sum (₹)</span>
              {currentPortfolioValue > 0 && (
                <button
                  type="button"
                  onClick={handleUseCurrentPortfolio}
                  className="text-[10px] text-emerald-400 hover:text-emerald-300 underline font-medium"
                >
                  Use Portfolio Value
                </button>
              )}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-bold">
                ₹
              </span>
              <input
                type="number"
                step="10000"
                min="0"
                value={lumpSum}
                onChange={(e) => setLumpSum(Math.max(0, Number(e.target.value)))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Expected CAGR Slider */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-400 font-medium">Expected Annual CAGR (%)</span>
              <span className="font-extrabold text-teal-400 text-sm">{expectedCagr}%</span>
            </div>
            <input
              type="range"
              min={6}
              max={25}
              step={0.5}
              value={expectedCagr}
              onChange={(e) => setExpectedCagr(Number(e.target.value))}
              className="w-full accent-teal-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 mt-1">
              <span>6% (Conservative)</span>
              <span>14% (Index/Good Equity)</span>
              <span>25% (Multibaggers)</span>
            </div>
          </div>

          {/* DRIP Toggle & Yield */}
          <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-bold text-slate-200 block">
                  Dividend Reinvestment (DRIP)
                </label>
                <span className="text-[10px] text-slate-400">
                  Automatically reinvest annual dividends
                </span>
              </div>
              <input
                type="checkbox"
                checked={enableDRIP}
                onChange={(e) => setEnableDRIP(e.target.checked)}
                className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-0 cursor-pointer"
              />
            </div>

            {enableDRIP && (
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-slate-400 font-medium">Est. Dividend Yield (%)</span>
                  <span className="font-bold text-purple-300">{dividendYield}%</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={4.0}
                  step={0.1}
                  value={dividendYield}
                  onChange={(e) => setDividendYield(Number(e.target.value))}
                  className="w-full accent-purple-500 cursor-pointer"
                />
              </div>
            )}
          </div>
        </div>

        {/* Growth Chart (Right 2 cols) */}
        <div className="lg:col-span-2 bg-slate-900/90 p-5 rounded-2xl border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              Wealth Progression Curve (Invested vs Corpus)
            </h2>
            <span className="text-[11px] text-slate-400">
              Terminal: <strong className="text-emerald-400">{formatINR(simulation.finalCorpus)}</strong>
            </span>
          </div>

          <div className="h-80 w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorWithDrip" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorNoDrip" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0d9488" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0d9488" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorInvested" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#64748b" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#64748b" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="year" stroke="#64748b" fontSize={11} />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  tickFormatter={(val) => {
                    if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)}Cr`;
                    if (val >= 100000) return `₹${(val / 100000).toFixed(0)}L`;
                    return `₹${val}`;
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#090d16',
                    borderColor: '#334155',
                    borderRadius: '0.75rem',
                    fontSize: '11px',
                  }}
                  formatter={(val: any) => [formatINR(Number(val)), '']}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Area
                  type="monotone"
                  dataKey="Corpus (With DRIP)"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#colorWithDrip)"
                />
                {!enableDRIP && (
                  <Area
                    type="monotone"
                    dataKey="Corpus (No DRIP)"
                    stroke="#0d9488"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorNoDrip)"
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="Invested Capital"
                  stroke="#64748b"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  fillOpacity={1}
                  fill="url(#colorInvested)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Year-by-Year Compounding Progression Table */}
      <div className="bg-slate-900/90 rounded-2xl border border-slate-800 overflow-hidden shadow-lg">
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-200">
            Year-by-Year Multi-Decade Wealth Table
          </h2>
          <span className="text-[11px] text-slate-400">
            Compounded annually @ {expectedCagr}% CAGR
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
              <tr>
                <th className="py-3 px-4 font-semibold text-center">Year</th>
                <th className="py-3 px-4 font-semibold text-right">Invested Capital</th>
                <th className="py-3 px-4 font-semibold text-right">Corpus without DRIP</th>
                <th className="py-3 px-4 font-semibold text-right text-emerald-300">
                  Corpus with DRIP
                </th>
                <th className="py-3 px-4 font-semibold text-right">Annual Div Income</th>
                <th className="py-3 px-4 font-semibold text-center text-amber-300">
                  Wealth Multiple
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {simulation.yearBreakdown.map((row) => (
                <tr key={row.year} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 px-4 font-bold text-white text-center">Year {row.year}</td>
                  <td className="py-3 px-4 text-right text-slate-300 font-mono">
                    {formatINR(row.investedCapital)}
                  </td>
                  <td className="py-3 px-4 text-right text-slate-300 font-mono">
                    {formatINR(row.corpusWithoutDrip)}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-emerald-400 font-mono">
                    {formatINR(row.corpusWithDrip)}
                  </td>
                  <td className="py-3 px-4 text-right text-purple-300 font-mono">
                    {formatINR(row.estimatedDividendsEarned)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className="px-2 py-0.5 rounded font-extrabold text-[11px] bg-amber-500/10 text-amber-300 border border-amber-500/20">
                      {row.wealthMultipleWithDrip}x
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
