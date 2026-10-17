import React, { useState } from 'react';
import { X, Download, Upload, AlertTriangle, CheckCircle, Database } from 'lucide-react';
import { exportDatabaseBackupJSON, restoreDatabaseFromJSON, seedSampleIndianPortfolio } from '../db';
import { formatDateDDMMYYYY, isDateOlderThanDays } from '../utils/formatters';
import type { AppSettings } from '../types';

interface BackupRestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings | undefined;
  onDataChanged: () => void;
}

export const BackupRestoreModal: React.FC<BackupRestoreModalProps> = ({
  isOpen,
  onClose,
  settings,
  onDataChanged,
}) => {
  const [, setImportJsonText] = useState('');
  const [importStatus, setImportStatus] = useState<{
    success?: boolean;
    message?: string;
    counts?: Record<string, number>;
  } | null>(null);
  const [showConfirmStep, setShowConfirmStep] = useState(false);
  const [pendingParsedData, setPendingParsedData] = useState<any>(null);

  if (!isOpen) return null;

  const isBackupStale = !settings?.lastBackupDate || isDateOlderThanDays(settings.lastBackupDate, 14);

  // 1. One-click JSON export
  const handleExportJSON = async () => {
    try {
      const jsonStr = await exportDatabaseBackupJSON();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateTag = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `dalal-diarys-backup-${dateTag}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      onDataChanged();
      setImportStatus({
        success: true,
        message: 'Backup JSON downloaded successfully! Last backup timestamp updated.',
      });
    } catch (err: any) {
      setImportStatus({
        success: false,
        message: err.message || 'Export failed.',
      });
    }
  };

  // 2. File picker or pasted JSON
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setImportJsonText(content);
      verifyAndPrepareImport(content);
    };
    reader.readAsText(file);
  };

  const verifyAndPrepareImport = (jsonStr: string) => {
    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed || !parsed.data) {
        throw new Error('Invalid format: missing root "data" object.');
      }
      setPendingParsedData(parsed);
      setShowConfirmStep(true);
      setImportStatus(null);
    } catch (err: any) {
      setImportStatus({
        success: false,
        message: 'Invalid JSON file format: ' + err.message,
      });
      setShowConfirmStep(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingParsedData) return;
    try {
      const res = await restoreDatabaseFromJSON(JSON.stringify(pendingParsedData), 'overwrite');
      setImportStatus(res);
      setShowConfirmStep(false);
      setImportJsonText('');
      setPendingParsedData(null);
      onDataChanged();
    } catch (err: any) {
      setImportStatus({
        success: false,
        message: err.message || 'Restore failed.',
      });
    }
  };

  const handleSeedSampleData = async () => {
    if (
      window.confirm(
        'Load realistic Indian sample portfolio (TCS, Reliance, HDFC Bank, Titan, Tata Motors)? This will replace current IndexedDB entries.'
      )
    ) {
      await seedSampleIndianPortfolio();
      onDataChanged();
      setImportStatus({
        success: true,
        message: 'Sample portfolio loaded successfully!',
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-[#111827] border border-slate-800 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold text-white">Backup & Restore</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* 14-day Stale Reminder Card */}
          <div
            className={`p-3.5 rounded-xl border flex items-start gap-3 ${
              isBackupStale
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            }`}
          >
            {isBackupStale ? (
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5 animate-pulse" />
            ) : (
              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            )}
            <div className="text-xs">
              <span className="font-bold block text-white mb-0.5">
                {isBackupStale ? 'Backup Reminder Alert (> 14 Days)' : 'Backup Status Healthy'}
              </span>
              <span>
                All portfolio records are stored securely in your browser's IndexedDB. Last backed up:{' '}
                <strong className="text-white">
                  {settings?.lastBackupDate ? formatDateDDMMYYYY(settings.lastBackupDate) : 'Never'}
                </strong>
                . Regular backup prevents accidental browser cache clearing.
              </span>
            </div>
          </div>

          {/* Status Message */}
          {importStatus && (
            <div
              className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                importStatus.success
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}
            >
              {importStatus.success ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span>{importStatus.message}</span>
            </div>
          )}

          {/* Section 1: One-Click Export */}
          <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  One-Click JSON Export
                </h4>
                <p className="text-[11px] text-slate-400">
                  Export complete raw facts: stocks, transactions, prices, corporate actions.
                </p>
              </div>
              <button
                onClick={handleExportJSON}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs shadow-md transition-all active:scale-95 shrink-0"
              >
                <Download className="w-4 h-4" />
                <span>Download Backup</span>
              </button>
            </div>
          </div>

          {/* Section 2: Import Backup JSON */}
          <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Restore from Backup
            </h4>
            <p className="text-[11px] text-slate-400">
              Select your previously exported <code className="text-emerald-400">.json</code> file to restore.
            </p>

            <div className="flex items-center gap-3">
              <label className="flex-1 cursor-pointer">
                <input
                  type="file"
                  accept=".json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <div className="flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl text-xs text-slate-300 hover:text-white transition-all bg-slate-950/40">
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <span>Choose JSON Backup File</span>
                </div>
              </label>
            </div>

            {/* Confirm Step */}
            {showConfirmStep && pendingParsedData && (
              <div className="p-4 bg-amber-950/20 border border-amber-500/40 rounded-xl space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Confirm Restore Operation</span>
                </div>
                <div className="text-xs text-slate-300 space-y-1">
                  <p>Ready to restore backup dated: <strong>{pendingParsedData.exportDate ? formatDateDDMMYYYY(pendingParsedData.exportDate) : 'Unknown'}</strong></p>
                  <ul className="list-disc pl-5 text-[11px] text-slate-400">
                    <li>Stocks: {pendingParsedData.data?.stocks?.length || 0}</li>
                    <li>Transactions: {pendingParsedData.data?.transactions?.length || 0}</li>
                    <li>Prices: {pendingParsedData.data?.priceRecords?.length || 0}</li>
                  </ul>
                  <p className="text-rose-400 text-[11px] font-semibold pt-1">
                    Warning: Restoring will overwrite the current active data.
                  </p>
                </div>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => {
                      setShowConfirmStep(false);
                      setPendingParsedData(null);
                    }}
                    className="px-3 py-1.5 bg-slate-800 text-xs text-slate-300 rounded-lg hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmRestore}
                    className="px-4 py-1.5 bg-rose-500 hover:bg-rose-400 text-white font-bold text-xs rounded-lg shadow-md"
                  >
                    Yes, Restore Backup
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Reset / Seed Sample Data */}
          <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Demo Portfolio Preset
              </h4>
              <p className="text-[11px] text-slate-500">
                Instantly load Indian blue-chip data (TCS, Reliance, HDFC Bank, Titan, Tata Motors) to test all calculations.
              </p>
            </div>
            <button
              onClick={handleSeedSampleData}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold rounded-lg border border-slate-700 transition-all shrink-0"
            >
              Load Sample Data
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/40 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
