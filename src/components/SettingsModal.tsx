import React, { useState } from 'react';
import {
  Settings,
  X,
  ShieldCheck,
  Cloud,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import type { AppSettings } from '../types';
import { formatINR } from '../utils/formatters';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings | undefined;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => Promise<void>;
  onLoadDemoData: () => Promise<void>;
  onResetDatabase: () => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onLoadDemoData,
  onResetDatabase,
}) => {
  const [stcgRate, setStcgRate] = useState<number>(settings?.stcgRate ?? 20);
  const [ltcgRate, setLtcgRate] = useState<number>(settings?.ltcgRate ?? 12.5);
  const [ltcgExemption, setLtcgExemption] = useState<number>(settings?.ltcgExemption ?? 125000);

  // Reset all data double-confirmation state
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
  const [typedDeleteConfirm, setTypedDeleteConfirm] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetSuccessToast, setResetSuccessToast] = useState(false);

  // Cloud sync feature flag (Phase 6)
  const [enableCloudSync, setEnableCloudSync] = useState<boolean>(false);
  const [supabaseUrl, setSupabaseUrl] = useState<string>('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState<string>('');
  const [isSaved, setIsSaved] = useState(false);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateSettings({
      stcgRate,
      ltcgRate,
      ltcgExemption,
    });
    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <Settings className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="font-bold text-white text-base">Dalal Diary's Settings</h2>
              <p className="text-[11px] text-slate-400">
                Tax rates, cloud sync preferences & database tools
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSave} className="p-6 space-y-6 overflow-y-auto flex-1 text-xs">
          {/* Section 1: Indian Tax Rates (Budget 2024 Defaults) */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-200 text-sm flex items-center gap-2 border-b border-slate-800 pb-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Capital Gains Tax Configuration (Union Budget 2024)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-400 font-medium mb-1">
                  STCG Rate (&le;365d)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="50"
                    value={stcgRate}
                    onChange={(e) => setStcgRate(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">
                    %
                  </span>
                </div>
                <span className="text-[10px] text-slate-500">Revised to 20% in 2024</span>
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">
                  LTCG Rate (&gt;365d)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="50"
                    value={ltcgRate}
                    onChange={(e) => setLtcgRate(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">
                    %
                  </span>
                </div>
                <span className="text-[10px] text-slate-500">Revised to 12.5% in 2024</span>
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">
                  LTCG Exemption (₹/FY)
                </label>
                <input
                  type="number"
                  step="5000"
                  min="0"
                  value={ltcgExemption}
                  onChange={(e) => setLtcgExemption(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                />
                <span className="text-[10px] text-slate-500">
                  {formatINR(ltcgExemption)} exempt per year
                </span>
              </div>
            </div>
          </div>

          {/* Section 2: Phase 6 Cloud Sync Feature Flag */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="font-bold text-slate-200 text-sm flex items-center gap-2">
                <Cloud className="w-4 h-4 text-teal-400" />
                Cloud Backup & Multi-Device Sync (Phase 6)
              </h3>
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">
                Optional
              </span>
            </div>

            <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-200 block">
                    Enable Supabase Sync
                  </span>
                  <p className="text-[11px] text-slate-400">
                    Dalal Diary's runs 100% locally in IndexedDB by default. Toggle this if you wish to sync encrypted tables to a private Supabase instance.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={enableCloudSync}
                  onChange={(e) => setEnableCloudSync(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-0 cursor-pointer"
                />
              </div>

              {enableCloudSync && (
                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Supabase Project URL
                    </label>
                    <input
                      type="url"
                      value={supabaseUrl}
                      onChange={(e) => setSupabaseUrl(e.target.value)}
                      placeholder="https://xyz.supabase.co"
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Anon Public Key
                    </label>
                    <input
                      type="password"
                      value={supabaseAnonKey}
                      onChange={(e) => setSupabaseAnonKey(e.target.value)}
                      placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-white"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Database & Sample Data */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-200 text-sm flex items-center gap-2 border-b border-slate-800 pb-2">
              <RotateCcw className="w-4 h-4 text-amber-400" />
              Demo Data & Database Reset
            </h3>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={async () => {
                  if (confirm('Load demo portfolio with sample stocks, transactions, and fundamentals?')) {
                    await onLoadDemoData();
                    onClose();
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20 rounded-lg font-semibold transition-all"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Reload Sample Indian Portfolio</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTypedDeleteConfirm('');
                  setShowResetConfirmModal(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 text-rose-300 border border-rose-500/20 hover:bg-rose-500/20 rounded-lg font-semibold transition-all"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Reset all data</span>
              </button>
            </div>
          </div>

          {/* Success Toast */}
          {resetSuccessToast && (
            <div className="p-3 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Database wiped clean! Returned to empty-state dashboard.</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg shadow-sm transition-all"
            >
              {isSaved ? <CheckCircle2 className="w-4 h-4" /> : null}
              <span>{isSaved ? 'Saved!' : 'Save Preferences'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Red Double Confirmation Modal */}
      {showResetConfirmModal && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111827] border-2 border-rose-600/60 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-400 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-rose-200">
                  Are you sure? This will delete all stocks, transactions, and prices.
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  This action is irreversible. All portfolio records stored locally in your browser IndexedDB will be permanently wiped clean.
                </p>
              </div>
            </div>

            <div className="bg-rose-950/30 border border-rose-900/50 rounded-xl p-3.5 space-y-2">
              <label className="block text-xs font-medium text-rose-300">
                To confirm, type <span className="font-mono font-bold text-rose-200 tracking-wider">DELETE</span> below:
              </label>
              <input
                type="text"
                autoFocus
                value={typedDeleteConfirm}
                onChange={(e) => setTypedDeleteConfirm(e.target.value)}
                placeholder="Type DELETE"
                className="w-full bg-slate-950 border border-rose-700/60 rounded-lg px-3 py-2 text-xs font-mono text-rose-100 placeholder-slate-600 focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={isResetting}
                onClick={() => {
                  setShowResetConfirmModal(false);
                  setTypedDeleteConfirm('');
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={typedDeleteConfirm !== 'DELETE' || isResetting}
                onClick={async () => {
                  setIsResetting(true);
                  try {
                    await onResetDatabase();
                    setShowResetConfirmModal(false);
                    setResetSuccessToast(true);
                    setTimeout(() => {
                      setResetSuccessToast(false);
                      onClose();
                    }, 1200);
                  } finally {
                    setIsResetting(false);
                  }
                }}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  typedDeleteConfirm === 'DELETE' && !isResetting
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/30 cursor-pointer'
                    : 'bg-rose-950 text-rose-600/60 border border-rose-900/40 cursor-not-allowed'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{isResetting ? 'Wiping Database...' : 'Permanently Delete Everything'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
