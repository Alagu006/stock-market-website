import React, { useState } from 'react';
import {
  FileSpreadsheet,
  Upload,
  Download,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileText,
  SlidersHorizontal,
  Save,
  Layers,
  TrendingUp,
  FileCheck,
  KeyRound,
  Copy,
  HelpCircle,
} from 'lucide-react';
import type {
  Stock,
  Transaction,
  CorporateAction,
  PriceRecord,
  Fundamentals,
  CostMethod,
  HoldingCalculation,
  ImportPreviewRow,
} from '../types';
import {
  parseSpreadsheet,
  validateStocksImport,
  validateTransactionsImport,
  validateBulkPricesImport,
  autoDetectScreenerMapping,
  parseScreenerRows,
  downloadSampleFile,
  generateSampleStocksCSV,
  generateSampleTransactionsCSV,
  generateSamplePricesCSV,
  generateSampleScreenerCSV,
  exportMultiSheetExcel,
  exportSingleSheetCSV,
  SCREENER_FIELD_DEFINITIONS,
} from '../services/importExport';
import { extractTextFromPdf, parseStatementText } from '../services/pdfParser';
import { db } from '../db';
import { formatINR, formatDateDDMMYYYY } from '../utils/formatters';

interface ImportExportViewProps {
  stocks: Stock[];
  holdings: HoldingCalculation[];
  transactions: Transaction[];
  corporateActions: CorporateAction[];
  priceRecords: PriceRecord[];
  fundamentalsList: Fundamentals[];
  costMethod: CostMethod;
  savedScreenerMapping?: Record<string, string>;
  onSaveScreenerMapping: (mapping: Record<string, string>) => Promise<void>;
  onConfirmImportStocks: (stocks: Omit<Stock, 'id' | 'createdAt'>[]) => Promise<void>;
  onConfirmImportTransactions: (txs: Omit<Transaction, 'id' | 'createdAt'>[]) => Promise<void>;
  onConfirmBulkPrices: (prices: Array<{ stockId: number; symbol: string; price: number; date: string }>) => Promise<void>;
  onConfirmScreenerFundamentals: (funds: Array<Partial<Fundamentals> & { stockId: number; symbol: string }>) => Promise<void>;
}

type SubTab = 'stocks' | 'transactions' | 'prices' | 'screener' | 'pdf' | 'export';

export const ImportExportView: React.FC<ImportExportViewProps> = ({
  stocks,
  holdings,
  transactions,
  corporateActions,
  priceRecords,
  costMethod,
  savedScreenerMapping,
  onSaveScreenerMapping,
  onConfirmImportStocks,
  onConfirmImportTransactions,
  onConfirmBulkPrices,
  onConfirmScreenerFundamentals,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('stocks');

  // Generic import preview state
  const [fileName, setFileName] = useState<string>('');
  const [rawParsedRows, setRawParsedRows] = useState<Record<string, any>[]>([]);
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Screener Column Mapping State
  const [screenerMapping, setScreenerMapping] = useState<Record<string, string>>(savedScreenerMapping || {});
  const [isMappingSaved, setIsMappingSaved] = useState(false);

  // PDF Statement State
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState<string>('');
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [pastedStatementText, setPastedStatementText] = useState<string>('');
  const [activeBrokerGuide, setActiveBrokerGuide] = useState<'zerodha' | 'groww' | 'angel' | 'upstox' | 'cas'>('zerodha');
  const [detectedStatementType, setDetectedStatementType] = useState<'transactions' | 'stocks' | 'holdings' | 'unknown'>('unknown');
  const [holdingsSummary, setHoldingsSummary] = useState<{
    totalHoldings: number;
    totalInvested: number;
    totalCurrentValue: number;
    totalUnrealizedPnL: number;
  } | null>(null);

  // Reset file input
  const resetUpload = () => {
    setFileName('');
    setRawParsedRows([]);
    setDetectedColumns([]);
    setStatusMessage(null);
    setPdfFile(null);
    setPdfPassword('');
    setIsPasswordModalOpen(false);
    setDetectedStatementType('unknown');
    setHoldingsSummary(null);
  };

  // PDF file reader handler
  const handlePdfFile = async (file: File, passwordToTry?: string) => {
    setFileName(file.name);
    setPdfFile(file);
    setIsProcessing(true);
    setStatusMessage(null);

    try {
      const pass = passwordToTry !== undefined ? passwordToTry : pdfPassword;
      const extracted = await extractTextFromPdf(file, pass);
      const parsed = parseStatementText(extracted.text);

      if (parsed.rows.length === 0) {
        throw new Error(
          'Could not automatically detect tabular rows from this PDF. Please open your PDF, copy the table text, and paste it into the "Paste Statement Text" box below.'
        );
      }

      setDetectedColumns(parsed.detectedColumns);
      setRawParsedRows(parsed.rows);
      setDetectedStatementType(parsed.detectedType);
      setHoldingsSummary(parsed.holdingsSummary || null);
      setIsPasswordModalOpen(false);
      setStatusMessage({
        type: 'success',
        text: `Successfully parsed ${parsed.rows.length} rows across ${extracted.pagesCount} PDF pages! Check the preview below.`,
      });

      if (parsed.detectedType === 'transactions' && activeSubTab !== 'transactions' && activeSubTab !== 'pdf') {
        setActiveSubTab('transactions');
      } else if (parsed.detectedType === 'stocks' && activeSubTab !== 'stocks' && activeSubTab !== 'pdf') {
        setActiveSubTab('stocks');
      }
    } catch (err: any) {
      if (err.message === 'PASSWORD_REQUIRED') {
        setIsPasswordModalOpen(true);
        setStatusMessage({
          type: 'error',
          text: 'This PDF is password-protected. Enter your password below (typically your PAN in CAPITAL letters or DOB DDMMYYYY) to unlock.',
        });
      } else {
        setStatusMessage({
          type: 'error',
          text: err.message || 'Failed to parse PDF statement.',
        });
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle pasted statement text
  const handleParsePastedText = () => {
    if (!pastedStatementText.trim()) return;
    setIsProcessing(true);
    try {
      const parsed = parseStatementText(pastedStatementText);
      if (parsed.rows.length === 0) {
        throw new Error('Could not identify table columns. Please ensure you copied rows from your broker holding or transaction statement.');
      }
      setFileName('Pasted Statement Table');
      setDetectedColumns(parsed.detectedColumns);
      setRawParsedRows(parsed.rows);
      setDetectedStatementType(parsed.detectedType);
      setHoldingsSummary(parsed.holdingsSummary || null);
      setStatusMessage({
        type: 'success',
        text: `Extracted ${parsed.rows.length} rows from pasted text! Review the preview below.`,
      });
      if (parsed.detectedType === 'transactions' && activeSubTab !== 'transactions' && activeSubTab !== 'pdf') {
        setActiveSubTab('transactions');
      } else if (parsed.detectedType === 'stocks' && activeSubTab !== 'stocks' && activeSubTab !== 'pdf') {
        setActiveSubTab('stocks');
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Failed to parse text.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // 1-Click Complete Portfolio Import (Registers missing stocks + records BUY transactions + records LTP)
  const handleConfirmPortfolioHoldings = async () => {
    if (rawParsedRows.length === 0) return;
    setIsProcessing(true);
    setStatusMessage(null);

    try {
      // 1. Prepare Stock master rows
      const stocksToImport: Omit<Stock, 'id' | 'createdAt'>[] = rawParsedRows.map((r) => ({
        symbol: r.symbol,
        bseCode: r.bseCode || '',
        name: r.name,
        sector: r.sector || 'Diversified',
        marketCapCategory: r.marketCapCategory || 'Mid Cap',
      }));

      await onConfirmImportStocks(stocksToImport);

      // 2. Fetch updated stocks to get their IDs
      const allStocks = await db.stocks.toArray();
      const stockMap = new Map(allStocks.map((s) => [s.symbol.toUpperCase(), s.id]));

      // 3. Prepare BUY transactions & prices
      const txsToImport: Omit<Transaction, 'id' | 'createdAt'>[] = [];
      const pricesToRecord: Array<{ stockId: number; symbol: string; price: number; date: string }> = [];
      const todayDate = new Date().toISOString().split('T')[0];

      for (const r of rawParsedRows) {
        const sId = stockMap.get((r.symbol || '').toUpperCase());
        if (sId && r.holdingQuantity > 0 && r.holdingRate > 0) {
          txsToImport.push({
            stockId: sId,
            symbol: r.symbol,
            type: 'BUY',
            quantity: r.holdingQuantity,
            price: r.holdingRate,
            netAmount: r.buyValue || Number((r.holdingQuantity * r.holdingRate).toFixed(2)),
            date: r.date || todayDate,
            note: 'Imported from Portfolio Statement',
          });
        }
        if (sId && r.marketPrice > 0) {
          pricesToRecord.push({
            stockId: sId,
            symbol: r.symbol,
            price: r.marketPrice,
            date: todayDate,
          });
        }
      }

      if (txsToImport.length > 0) {
        await onConfirmImportTransactions(txsToImport);
      }
      if (pricesToRecord.length > 0) {
        await onConfirmBulkPrices(pricesToRecord);
      }

      setStatusMessage({
        type: 'success',
        text: `Successfully imported your complete portfolio! Registered ${stocksToImport.length} stocks and recorded ${txsToImport.length} holdings.`,
      });
      resetUpload();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Failed to import portfolio holdings.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle file selection (Excel, CSV, or PDF)
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatusMessage(null);
    setFileName(file.name);

    if (file.name.toLowerCase().endsWith('.pdf')) {
      await handlePdfFile(file);
      return;
    }

    setIsProcessing(true);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const buffer = event.target?.result as ArrayBuffer;
        const { getSheetData } = parseSpreadsheet(buffer);
        const rows = getSheetData();

        if (rows.length === 0) {
          throw new Error('The spreadsheet appears to be empty or has no data rows.');
        }

        const cols = Object.keys(rows[0] || {});
        setDetectedColumns(cols);
        setRawParsedRows(rows);

        // If Screener tab, auto-detect columns if not mapped
        if (activeSubTab === 'screener') {
          const autoMap = autoDetectScreenerMapping(cols);
          const merged = { ...autoMap, ...(savedScreenerMapping || {}) };
          setScreenerMapping(merged);
        }
      } catch (err: any) {
        setStatusMessage({
          type: 'error',
          text: err.message || 'Failed to read file. Please ensure it is a valid Excel (.xlsx, .xls) or CSV file.',
        });
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Previews based on active tab
  const stocksPreview: ImportPreviewRow<Stock>[] = React.useMemo(() => {
    if ((activeSubTab !== 'stocks' && activeSubTab !== 'pdf') || rawParsedRows.length === 0) return [];
    if (detectedStatementType === 'holdings') {
      return rawParsedRows.map((r, idx) => ({
        rowIndex: idx + 1,
        data: {
          symbol: r.symbol,
          bseCode: r.bseCode || '',
          name: r.name,
          sector: r.sector || 'Diversified',
          marketCapCategory: r.marketCapCategory || 'Mid Cap',
        },
        rawRow: r,
        warnings: [],
        isValid: Boolean(r.symbol && r.name),
        errors: [],
      }));
    }
    return validateStocksImport(rawParsedRows, stocks);
  }, [activeSubTab, rawParsedRows, stocks, detectedStatementType]);

  const transactionsPreview: ImportPreviewRow<Transaction>[] = React.useMemo(() => {
    if ((activeSubTab !== 'transactions' && activeSubTab !== 'pdf') || rawParsedRows.length === 0) return [];
    if (detectedStatementType === 'holdings') {
      return rawParsedRows.map((r, idx) => {
        const existingStock = stocks.find((s) => s.symbol.toUpperCase() === (r.symbol || '').toUpperCase());
        return {
          rowIndex: idx + 1,
          data: {
            stockId: existingStock?.id || 0,
            symbol: r.symbol,
            type: 'BUY' as const,
            quantity: r.holdingQuantity,
            price: r.holdingRate,
            netAmount: r.buyValue || Number((r.holdingQuantity * r.holdingRate).toFixed(2)),
            date: r.date || new Date().toISOString().split('T')[0],
            note: 'Imported from Portfolio Statement',
          },
          rawRow: r,
          warnings: [],
          isValid: Boolean(r.symbol && r.holdingQuantity > 0 && r.holdingRate > 0),
          errors: [],
        };
      });
    }
    return validateTransactionsImport(rawParsedRows, stocks, transactions, corporateActions);
  }, [activeSubTab, rawParsedRows, stocks, transactions, corporateActions, detectedStatementType]);

  const pricesPreview: ImportPreviewRow<PriceRecord>[] = React.useMemo(() => {
    if (activeSubTab !== 'prices' || rawParsedRows.length === 0) return [];
    return validateBulkPricesImport(rawParsedRows, stocks);
  }, [activeSubTab, rawParsedRows, stocks]);

  const screenerPreview: ImportPreviewRow<Fundamentals>[] = React.useMemo(() => {
    if (activeSubTab !== 'screener' || rawParsedRows.length === 0) return [];
    return parseScreenerRows(rawParsedRows, screenerMapping, stocks);
  }, [activeSubTab, rawParsedRows, screenerMapping, stocks]);

  // Confirmation Handlers
  const handleConfirmStocks = async () => {
    const validRows = stocksPreview.filter((r) => r.isValid).map((r) => r.data as Omit<Stock, 'id' | 'createdAt'>);
    if (validRows.length === 0) return;
    try {
      setIsProcessing(true);
      await onConfirmImportStocks(validRows);
      setStatusMessage({ type: 'success', text: `Successfully imported ${validRows.length} stocks!` });
      resetUpload();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to import stocks.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmTransactions = async () => {
    const validRows = transactionsPreview.filter((r) => r.isValid).map((r) => r.data as Omit<Transaction, 'id' | 'createdAt'>);
    if (validRows.length === 0) return;
    try {
      setIsProcessing(true);
      await onConfirmImportTransactions(validRows);
      setStatusMessage({ type: 'success', text: `Successfully recorded ${validRows.length} transactions! All portfolio positions recalculated.` });
      resetUpload();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to import transactions.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmBulkPrices = async () => {
    const validRows = pricesPreview
      .filter((r) => r.isValid && r.data.stockId && r.data.symbol && r.data.price && r.data.date)
      .map((r) => ({
        stockId: r.data.stockId!,
        symbol: r.data.symbol!,
        price: r.data.price!,
        date: r.data.date!,
      }));
    if (validRows.length === 0) return;
    try {
      setIsProcessing(true);
      await onConfirmBulkPrices(validRows);
      setStatusMessage({ type: 'success', text: `Successfully updated manual prices for ${validRows.length} stocks!` });
      resetUpload();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to update prices.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmScreener = async () => {
    const validRows = screenerPreview
      .filter((r) => r.isValid && r.data.stockId && r.data.symbol)
      .map((r) => r.data as Partial<Fundamentals> & { stockId: number; symbol: string });
    if (validRows.length === 0) return;
    try {
      setIsProcessing(true);
      await onConfirmScreenerFundamentals(validRows);
      setStatusMessage({ type: 'success', text: `Successfully imported fundamental metrics for ${validRows.length} companies!` });
      resetUpload();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to import fundamentals.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveMapping = async () => {
    try {
      await onSaveScreenerMapping(screenerMapping);
      setIsMappingSaved(true);
      setTimeout(() => setIsMappingSaved(false), 3000);
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: 'Failed to save mapping: ' + err.message });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
            <span>Excel & CSV Import / Export Center</span>
          </h2>
          <p className="text-xs text-slate-400">
            Import stock masters, transactions, bulk prices, and Screener.in fundamentals with preview & row validation.
          </p>
        </div>

        {/* Quick Sample Downloads dropdown or buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadSampleFile('sample-stocks.csv', generateSampleStocksCSV(), 'csv')}
            className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700/80 transition-all"
            title="Download Sample Stocks CSV"
          >
            Stocks Template
          </button>
          <button
            onClick={() => downloadSampleFile('sample-transactions.csv', generateSampleTransactionsCSV(), 'csv')}
            className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700/80 transition-all"
            title="Download Sample Transactions CSV"
          >
            Tx Template
          </button>
          <button
            onClick={() => downloadSampleFile('sample-prices.csv', generateSamplePricesCSV(), 'csv')}
            className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700/80 transition-all"
            title="Download Sample Prices CSV"
          >
            Prices Template
          </button>
        </div>
      </div>

      {/* Sub Tabs */}
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-2 overflow-x-auto">
        <button
          onClick={() => {
            setActiveSubTab('stocks');
            resetUpload();
          }}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all shrink-0 ${
            activeSubTab === 'stocks'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          1. Import Stocks
        </button>

        <button
          onClick={() => {
            setActiveSubTab('transactions');
            resetUpload();
          }}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all shrink-0 ${
            activeSubTab === 'transactions'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          2. Import Transactions
        </button>

        <button
          onClick={() => {
            setActiveSubTab('prices');
            resetUpload();
          }}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all shrink-0 ${
            activeSubTab === 'prices'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          3. Bulk Price Update
        </button>

        <button
          onClick={() => {
            setActiveSubTab('screener');
            resetUpload();
          }}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all shrink-0 ${
            activeSubTab === 'screener'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          4. Screener.in Parser & Mapping
        </button>

        <button
          onClick={() => {
            setActiveSubTab('pdf');
            resetUpload();
          }}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all shrink-0 flex items-center gap-1.5 ${
            activeSubTab === 'pdf'
              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <FileText className="w-3.5 h-3.5 text-purple-400" />
          <span>5. PDF & Statement Importer</span>
        </button>

        <button
          onClick={() => {
            setActiveSubTab('export');
            resetUpload();
          }}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all shrink-0 ${
            activeSubTab === 'export'
              ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          6. Export Center (Excel/CSV)
        </button>
      </div>

      {/* Status Alert */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
            statusMessage.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* TAB 1: IMPORT STOCKS */}
      {activeSubTab === 'stocks' && (
        <div className="space-y-5">
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1">
              Import Stock Master List
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Upload an Excel (.xlsx, .xls) or CSV file. Supports:
              <br />
              • <strong>BSE Codes only:</strong> column <code className="text-emerald-400">BSE_Code</code> (generates placeholder symbol/name)
              <br />
              • <strong>Full format:</strong> columns <code className="text-emerald-400">NSE_Symbol</code>, <code className="text-emerald-400">BSE_Code</code> (6 digits), <code className="text-emerald-400">Name</code>, <code className="text-emerald-400">Sector</code>, optional <code className="text-emerald-400">Market_Cap</code>, <code className="text-emerald-400">ISIN</code>, <code className="text-emerald-400">Expected_Dividend</code>.
            </p>

            {/* File Upload Box */}
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <label className="flex-1 w-full cursor-pointer">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl p-4 text-center text-xs text-slate-300 bg-slate-900/40 transition-all flex items-center justify-center gap-2">
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <span>{fileName ? `Selected: ${fileName}` : 'Choose Excel, CSV, or PDF File'}</span>
                </div>
              </label>

              <button
                onClick={() => downloadSampleFile('sample-stocks.csv', generateSampleStocksCSV(), 'csv')}
                className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 shrink-0 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Sample Template</span>
              </button>
            </div>
          </div>

          {/* Preview Table */}
          {stocksPreview.length > 0 && (
            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Validation Preview: {stocksPreview.length} Rows Found
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    <span className="text-emerald-400 font-bold">
                      {stocksPreview.filter((r) => r.isValid).length} Valid
                    </span>{' '}
                    •{' '}
                    <span className="text-rose-400 font-bold">
                      {stocksPreview.filter((r) => !r.isValid).length} Errors
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={resetUpload}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded-lg"
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleConfirmStocks}
                    disabled={stocksPreview.filter((r) => r.isValid).length === 0 || isProcessing}
                    className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? 'Importing...' : 'Confirm & Import Stocks'}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3">Row</th>
                      <th className="py-2.5 px-3">Symbol</th>
                      <th className="py-2.5 px-3">BSE Code</th>
                      <th className="py-2.5 px-3">Company Name</th>
                      <th className="py-2.5 px-3">Sector</th>
                      <th className="py-2.5 px-3">Cap</th>
                      <th className="py-2.5 px-3">Validation Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {stocksPreview.map((row) => (
                      <tr
                        key={row.rowIndex}
                        className={row.isValid ? 'hover:bg-slate-800/30' : 'bg-rose-950/20'}
                      >
                        <td className="py-2.5 px-3 tabular-nums text-slate-400">{row.rowIndex}</td>
                        <td className="py-2.5 px-3 font-bold text-white">{row.data.symbol || '—'}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-300">{row.data.bseCode || '—'}</td>
                        <td className="py-2.5 px-3 text-slate-300">{row.data.name || '—'}</td>
                        <td className="py-2.5 px-3 text-slate-400">{row.data.sector || '—'}</td>
                        <td className="py-2.5 px-3 text-slate-400">{row.data.marketCapCategory || '—'}</td>
                        <td className="py-2.5 px-3">
                          {row.isValid ? (
                            row.warnings.length > 0 ? (
                              <span className="text-amber-400 text-[11px] flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                {row.warnings.join('; ')}
                              </span>
                            ) : (
                              <span className="text-emerald-400 font-semibold text-[11px] flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Ready
                              </span>
                            )
                          ) : (
                            <span className="text-rose-400 text-[11px] font-semibold flex items-center gap-1">
                              <AlertCircle className="w-3 h-3 shrink-0" />
                              {row.errors.join('; ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: IMPORT TRANSACTIONS */}
      {activeSubTab === 'transactions' && (
        <div className="space-y-5">
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1">
              Import Portfolio Transactions (Buy / Sell)
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Columns expected: <code className="text-emerald-400">BSE_Code</code> or <code className="text-emerald-400">NSE_Symbol</code>, <code className="text-emerald-400">Date</code> (DD-MM-YYYY or YYYY-MM-DD), <code className="text-emerald-400">Type</code> (BUY or SELL), <code className="text-emerald-400">Qty</code>, <code className="text-emerald-400">Price</code>, optional <code className="text-emerald-400">Charges</code>, <code className="text-emerald-400">Note</code>.
              <br />
              <strong className="text-amber-400">Sell Validation:</strong> Automatically checks that you cannot sell more shares than held on that transaction date!
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-4">
              <label className="flex-1 w-full cursor-pointer">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl p-4 text-center text-xs text-slate-300 bg-slate-900/40 transition-all flex items-center justify-center gap-2">
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <span>{fileName ? `Selected: ${fileName}` : 'Choose Transactions File (Excel, CSV, or PDF)'}</span>
                </div>
              </label>

              <button
                onClick={() => downloadSampleFile('sample-transactions.csv', generateSampleTransactionsCSV(), 'csv')}
                className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 shrink-0 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Sample Template</span>
              </button>
            </div>
          </div>

          {/* Preview Table */}
          {transactionsPreview.length > 0 && (
            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Transactions Validation: {transactionsPreview.length} Rows
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    <span className="text-emerald-400 font-bold">
                      {transactionsPreview.filter((r) => r.isValid).length} Valid
                    </span>{' '}
                    •{' '}
                    <span className="text-rose-400 font-bold">
                      {transactionsPreview.filter((r) => !r.isValid).length} Errors
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={resetUpload}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded-lg"
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleConfirmTransactions}
                    disabled={transactionsPreview.filter((r) => r.isValid).length === 0 || isProcessing}
                    className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? 'Importing...' : 'Confirm & Import Transactions'}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3">Row</th>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Stock</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3 text-right">Qty</th>
                      <th className="py-2.5 px-3 text-right">Price (₹)</th>
                      <th className="py-2.5 px-3 text-right">Charges</th>
                      <th className="py-2.5 px-3">Status / Errors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {transactionsPreview.map((row) => (
                      <tr
                        key={row.rowIndex}
                        className={row.isValid ? 'hover:bg-slate-800/30' : 'bg-rose-950/20'}
                      >
                        <td className="py-2.5 px-3 tabular-nums text-slate-400">{row.rowIndex}</td>
                        <td className="py-2.5 px-3 text-slate-300">{formatDateDDMMYYYY(row.data.date)}</td>
                        <td className="py-2.5 px-3 font-bold text-white">{row.data.symbol}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              row.data.type === 'BUY'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            }`}
                          >
                            {row.data.type}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-slate-200">
                          {row.data.quantity}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-300">
                          {row.data.price ? formatINR(row.data.price, { showSymbol: false }) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-400">
                          {row.data.charges ? formatINR(row.data.charges, { showSymbol: false }) : '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          {row.isValid ? (
                            <span className="text-emerald-400 font-semibold text-[11px] flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Valid
                            </span>
                          ) : (
                            <span className="text-rose-400 text-[11px] font-semibold flex items-center gap-1">
                              <AlertCircle className="w-3 h-3 shrink-0" />
                              {row.errors.join('; ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: BULK PRICE UPDATE */}
      {activeSubTab === 'prices' && (
        <div className="space-y-5">
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1">
              Bulk Price Update
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Quickly update manual market prices across your entire watchlist/portfolio from Excel or CSV.
              <br />
              Columns expected: <code className="text-emerald-400">Symbol</code> or <code className="text-emerald-400">BSE_Code</code>, <code className="text-emerald-400">Price</code>, <code className="text-emerald-400">Date</code>.
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-4">
              <label className="flex-1 w-full cursor-pointer">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl p-4 text-center text-xs text-slate-300 bg-slate-900/40 transition-all flex items-center justify-center gap-2">
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <span>{fileName ? `Selected: ${fileName}` : 'Choose Price Update File'}</span>
                </div>
              </label>

              <button
                onClick={() => downloadSampleFile('sample-prices.csv', generateSamplePricesCSV(), 'csv')}
                className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 shrink-0 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Sample Template</span>
              </button>
            </div>
          </div>

          {/* Preview Table */}
          {pricesPreview.length > 0 && (
            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Bulk Prices Preview: {pricesPreview.length} Entries
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    <span className="text-emerald-400 font-bold">
                      {pricesPreview.filter((r) => r.isValid).length} Valid
                    </span>{' '}
                    •{' '}
                    <span className="text-rose-400 font-bold">
                      {pricesPreview.filter((r) => !r.isValid).length} Errors
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={resetUpload}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded-lg"
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleConfirmBulkPrices}
                    disabled={pricesPreview.filter((r) => r.isValid).length === 0 || isProcessing}
                    className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? 'Updating...' : 'Confirm & Apply Prices'}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3">Row</th>
                      <th className="py-2.5 px-3">Stock Symbol</th>
                      <th className="py-2.5 px-3 text-right">New Price (₹)</th>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Status / Errors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {pricesPreview.map((row) => (
                      <tr
                        key={row.rowIndex}
                        className={row.isValid ? 'hover:bg-slate-800/30' : 'bg-rose-950/20'}
                      >
                        <td className="py-2.5 px-3 tabular-nums text-slate-400">{row.rowIndex}</td>
                        <td className="py-2.5 px-3 font-bold text-white">{row.data.symbol}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-bold text-emerald-400">
                          {formatINR(row.data.price)}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">{formatDateDDMMYYYY(row.data.date)}</td>
                        <td className="py-2.5 px-3">
                          {row.isValid ? (
                            <span className="text-emerald-400 font-semibold text-[11px] flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Ready
                            </span>
                          ) : (
                            <span className="text-rose-400 text-[11px] font-semibold flex items-center gap-1">
                              <AlertCircle className="w-3 h-3 shrink-0" />
                              {row.errors.join('; ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: SCREENER.IN PARSER & COLUMN MAPPING */}
      {activeSubTab === 'screener' && (
        <div className="space-y-5">
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1">
                Screener.in Excel / Screen Export Parser
              </h3>
              <p className="text-xs text-slate-400">
                Upload Screener's "Export to Excel" file or any custom screen's exported list. Because Screener column layouts can evolve, use the interactive mapping step below. You can save your mapping so it is remembered automatically for every future import.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-4">
              <label className="flex-1 w-full cursor-pointer">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl p-4 text-center text-xs text-slate-300 bg-slate-900/40 transition-all flex items-center justify-center gap-2">
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <span>{fileName ? `Loaded: ${fileName}` : 'Choose Screener.in Excel or CSV File'}</span>
                </div>
              </label>

              <button
                onClick={() => downloadSampleFile('sample-screener.csv', generateSampleScreenerCSV(), 'csv')}
                className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 shrink-0 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Sample Screener Format</span>
              </button>
            </div>

            {/* Column Mapping Section */}
            {detectedColumns.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-800">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 uppercase tracking-wider">
                    <SlidersHorizontal className="w-4 h-4" />
                    <span>Interactive Column Mapping (Auto-Detected)</span>
                  </div>
                  <button
                    onClick={handleSaveMapping}
                    className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs font-bold rounded-lg border border-emerald-500/30 transition-all"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isMappingSaved ? 'Mapping Saved!' : 'Save This Mapping'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  {/* Stock identifier column */}
                  <div>
                    <label className="block text-[11px] font-semibold text-amber-400 mb-1">
                      Stock Identifier (Symbol / BSE / Name) *
                    </label>
                    <select
                      value={screenerMapping['__stockIdentifier'] || ''}
                      onChange={(e) => setScreenerMapping({ ...screenerMapping, __stockIdentifier: e.target.value })}
                      className="w-full px-2.5 py-1.5 bg-slate-900 text-xs text-white rounded-lg border border-slate-700"
                    >
                      <option value="">-- Choose Column --</option>
                      {detectedColumns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  {SCREENER_FIELD_DEFINITIONS.map((def) => (
                    <div key={def.key}>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        {def.label}
                      </label>
                      <select
                        value={screenerMapping[def.key] || ''}
                        onChange={(e) => setScreenerMapping({ ...screenerMapping, [def.key]: e.target.value })}
                        className="w-full px-2.5 py-1.5 bg-slate-900 text-xs text-white rounded-lg border border-slate-700"
                      >
                        <option value="">(Not Mapped)</option>
                        {detectedColumns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Screener Preview Table */}
          {screenerPreview.length > 0 && (
            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Parsed Screener Fundamentals: {screenerPreview.length} Companies
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    <span className="text-emerald-400 font-bold">
                      {screenerPreview.filter((r) => r.isValid).length} Matched to Portfolio
                    </span>{' '}
                    •{' '}
                    <span className="text-amber-400 font-bold">
                      {screenerPreview.filter((r) => !r.isValid).length} Unmatched
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={resetUpload}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded-lg"
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleConfirmScreener}
                    disabled={screenerPreview.filter((r) => r.isValid).length === 0 || isProcessing}
                    className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? 'Updating...' : 'Confirm & Update Fundamentals'}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3">Stock</th>
                      <th className="py-2.5 px-3 text-right">Market Cap (Cr)</th>
                      <th className="py-2.5 px-3 text-right">P/E</th>
                      <th className="py-2.5 px-3 text-right">ROCE (%)</th>
                      <th className="py-2.5 px-3 text-right">ROE (%)</th>
                      <th className="py-2.5 px-3 text-right">D/E</th>
                      <th className="py-2.5 px-3 text-right">Div Yield (%)</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {screenerPreview.map((row) => (
                      <tr
                        key={row.rowIndex}
                        className={row.isValid ? 'hover:bg-slate-800/30' : 'bg-slate-900/40 text-slate-500'}
                      >
                        <td className="py-2.5 px-3 font-bold text-white">{row.data.symbol}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-300">
                          {row.data.marketCapCr ? `₹ ${row.data.marketCapCr.toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-300">
                          {row.data.stockPE ? `${row.data.stockPE}x` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-emerald-400 font-semibold">
                          {row.data.roce ? `${row.data.roce}%` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-300">
                          {row.data.roe ? `${row.data.roe}%` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-300">
                          {row.data.debtToEquity !== undefined ? row.data.debtToEquity : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-amber-400">
                          {row.data.dividendYield ? `${row.data.dividendYield}%` : '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          {row.isValid ? (
                            <span className="text-emerald-400 font-semibold text-[11px] flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Matched
                            </span>
                          ) : (
                            <span className="text-amber-400 text-[11px]">
                              {row.warnings[0] || 'Unmatched'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: PDF STATEMENT IMPORTER */}
      {activeSubTab === 'pdf' && (
        <div className="space-y-6">
          <div className="bg-[#111827] border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-purple-400" />
                  <h3 className="text-base font-bold text-white">
                    PDF Statement & Tradebook Importer
                  </h3>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/30">
                    Zerodha • Groww • Angel One • CAS
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Upload your broker or CAS statement PDF, unlock password-protected files, or copy-paste text directly from your PDF viewer.
                </p>
              </div>
            </div>

            {/* Password Unlock Box (when encrypted PDF is detected) */}
            {isPasswordModalOpen && (
              <div className="p-4 rounded-xl bg-purple-950/40 border border-purple-500/40 text-xs space-y-2 animate-in fade-in duration-200">
                <div className="flex items-center gap-2 text-purple-300 font-bold">
                  <KeyRound className="w-4 h-4" />
                  <span>Encrypted PDF Detected ({fileName})</span>
                </div>
                <p className="text-slate-300 text-[11px]">
                  Indian broker and CAS statements are usually encrypted with your <strong>PAN number</strong> (in UPPERCASE, e.g. <code className="text-purple-300">ABCDE1234F</code>) or <strong>Date of Birth</strong> (e.g. <code className="text-purple-300">DDMMYYYY</code>).
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="password"
                    value={pdfPassword}
                    onChange={(e) => setPdfPassword(e.target.value)}
                    placeholder="Enter PDF password (e.g. PAN or DOB)"
                    className="flex-1 max-w-sm px-3 py-1.5 bg-slate-900 text-white rounded-lg border border-purple-500/40 focus:outline-none focus:border-purple-400 text-xs font-mono"
                  />
                  <button
                    onClick={() => {
                      if (pdfFile) handlePdfFile(pdfFile, pdfPassword);
                    }}
                    disabled={!pdfPassword || isProcessing}
                    className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold text-xs rounded-lg shadow-sm transition-all cursor-pointer"
                  >
                    {isProcessing ? 'Decrypting...' : 'Unlock & Parse'}
                  </button>
                </div>
              </div>
            )}

            {/* Dual Input: File Upload or Paste Text */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Option A: Direct PDF Upload */}
              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Upload className="w-4 h-4 text-purple-400" />
                    Option 1: Upload PDF File
                  </span>
                  <span className="text-[10px] text-slate-500">.pdf files</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Select your holding statement or tradebook PDF from your computer. Supports multi-page statements.
                </p>

                <label className="block w-full cursor-pointer">
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <div className="border-2 border-dashed border-slate-800 hover:border-purple-500/80 rounded-xl p-5 text-center text-xs text-slate-300 bg-slate-900/40 hover:bg-slate-900/70 transition-all flex flex-col items-center justify-center gap-2">
                    <FileText className="w-6 h-6 text-purple-400" />
                    <span className="font-semibold text-white">
                      {fileName && fileName.endsWith('.pdf') ? `Selected: ${fileName}` : 'Click to Browse & Select PDF'}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      Supports Zerodha, Groww, Angel One, Upstox, CDSL / NSDL CAS
                    </span>
                  </div>
                </label>
              </div>

              {/* Option B: Copy-Paste Text directly from PDF */}
              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Copy className="w-4 h-4 text-emerald-400" />
                    Option 2: Paste Statement Text / Table
                  </span>
                  <span className="text-[10px] text-slate-500">Instant extraction</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Open your statement in any browser or PDF reader, select and copy the table text (Ctrl+C), and paste it here:
                </p>

                <textarea
                  rows={4}
                  value={pastedStatementText}
                  onChange={(e) => setPastedStatementText(e.target.value)}
                  placeholder="Paste table text here... Example:&#10;RELIANCE  2026-06-15  BUY  25  1220.50&#10;TCS       2026-07-10  BUY  10  3850.00"
                  className="w-full p-2.5 bg-slate-900 text-xs font-mono text-slate-200 placeholder-slate-600 rounded-xl border border-slate-700/80 focus:outline-none focus:border-purple-500 resize-none"
                />

                <button
                  type="button"
                  onClick={handleParsePastedText}
                  disabled={!pastedStatementText.trim() || isProcessing}
                  className="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Parse Pasted Statement</span>
                </button>
              </div>
            </div>

            {/* Quick Broker Download Guides (How to get Excel/CSV directly) */}
            <div className="mt-4 p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-amber-400" />
                  Pro-Tip: Download native Excel / CSV from your broker in 30 seconds
                </span>
                <span className="text-[10px] text-emerald-400 font-semibold">100% Precision</span>
              </div>

              {/* Broker Switcher */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: 'zerodha', label: 'Zerodha Kite / Console' },
                  { id: 'groww', label: 'Groww' },
                  { id: 'angel', label: 'Angel One' },
                  { id: 'upstox', label: 'Upstox' },
                  { id: 'cas', label: 'CDSL / NSDL CAS' },
                ].map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setActiveBrokerGuide(b.id as any)}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${
                      activeBrokerGuide === b.id
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              {/* Instructions */}
              <div className="text-xs text-slate-300 space-y-1.5 bg-slate-950/70 p-3 rounded-lg border border-slate-800/80 leading-relaxed">
                {activeBrokerGuide === 'zerodha' && (
                  <p>
                    1. Go to <a href="https://console.zerodha.com" target="_blank" rel="noreferrer" className="text-emerald-400 underline font-semibold">console.zerodha.com</a> &gt; <strong>Portfolio</strong> &gt; <strong>Holdings</strong>.
                    <br />
                    2. Click the <strong>Download icon</strong> at the top right and select <strong>XLSX</strong>.
                    <br />
                    3. For trades: Go to <strong>Reports</strong> &gt; <strong>Tradebook</strong> &gt; Select Date Range &gt; Click <strong>Download XLSX / CSV</strong>.
                    <br />
                    4. Drop that file directly into Dalal Diary's for instant zero-loss import!
                  </p>
                )}
                {activeBrokerGuide === 'groww' && (
                  <p>
                    1. Open the Groww web portal or app &gt; Click on your <strong>Profile photo</strong>.
                    <br />
                    2. Go to <strong>Reports</strong> &gt; <strong>Stocks P&amp;L</strong> or <strong>Holdings Statement</strong>.
                    <br />
                    3. When exporting, choose <strong>Excel (.xlsx)</strong> instead of PDF.
                    <br />
                    4. Drop the Excel file into <strong>Import Transactions</strong> or <strong>Import Stocks</strong>.
                  </p>
                )}
                {activeBrokerGuide === 'angel' && (
                  <p>
                    1. Log in to Angel One &gt; <strong>Trade / Portfolio</strong>.
                    <br />
                    2. Navigate to <strong>Reports</strong> &gt; <strong>Transaction History / Trade Book</strong>.
                    <br />
                    3. Click <strong>Export as CSV</strong>.
                    <br />
                    4. Upload directly into Dalal Diary's!
                  </p>
                )}
                {activeBrokerGuide === 'upstox' && (
                  <p>
                    1. Log in to Upstox &gt; <strong>Account</strong> &gt; <strong>Reports</strong>.
                    <br />
                    2. Select <strong>Holdings</strong> or <strong>Tradebook</strong>.
                    <br />
                    3. Click <strong>Download Excel</strong>.
                  </p>
                )}
                {activeBrokerGuide === 'cas' && (
                  <p>
                    1. Visit <a href="https://web.cdslindia.com/myeasi" target="_blank" rel="noreferrer" className="text-emerald-400 underline font-semibold">CDSL myEasi</a> or <a href="https://eservices.nsdl.com/" target="_blank" rel="noreferrer" className="text-emerald-400 underline font-semibold">NSDL e-Services</a>.
                    <br />
                    2. Download your e-CAS statement. If you have the PDF, upload it above and enter your 10-digit PAN (in UPPERCASE) as password.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Mode A: Dedicated Portfolio Holdings Statement View */}
          {detectedStatementType === 'holdings' && rawParsedRows.length > 0 && (
            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden shadow-sm space-y-4 p-4">
              {/* Top Summary Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <h4 className="text-sm font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
                    <FileCheck className="w-4 h-4 text-emerald-400" />
                    <span>Parsed Portfolio Statement ({rawParsedRows.length} Holdings)</span>
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Extracted from your broker report. Mapped to official NSE tickers, cost bases, and valuations.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={resetUpload}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded-lg cursor-pointer"
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleConfirmPortfolioHoldings}
                    disabled={isProcessing}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 disabled:opacity-50 cursor-pointer flex items-center gap-1.5 transition-all"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{isProcessing ? 'Importing Portfolio...' : 'Import Complete Portfolio'}</span>
                  </button>
                </div>
              </div>

              {/* KPI Cards Strip */}
              {holdingsSummary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Total Holdings</span>
                    <p className="text-base font-extrabold text-white mt-0.5">{holdingsSummary.totalHoldings} Stocks</p>
                  </div>
                  <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Total Invested</span>
                    <p className="text-base font-extrabold text-slate-200 mt-0.5 font-mono">{formatINR(holdingsSummary.totalInvested)}</p>
                  </div>
                  <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Current Value (LTP)</span>
                    <p className="text-base font-extrabold text-white mt-0.5 font-mono">{formatINR(holdingsSummary.totalCurrentValue)}</p>
                  </div>
                  <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Unrealised P&amp;L</span>
                    <p className={`text-base font-extrabold mt-0.5 font-mono ${holdingsSummary.totalUnrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {holdingsSummary.totalUnrealizedPnL >= 0 ? '+' : ''}{formatINR(holdingsSummary.totalUnrealizedPnL)}
                    </p>
                  </div>
                </div>
              )}

              {/* Holdings Table */}
              <div className="overflow-x-auto max-h-96 border border-slate-800 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">NSE Symbol</th>
                      <th className="py-2.5 px-3">Company Name</th>
                      <th className="py-2.5 px-3 text-right">Holding Qty</th>
                      <th className="py-2.5 px-3 text-right">Avg Rate (₹)</th>
                      <th className="py-2.5 px-3 text-right">LTP (₹)</th>
                      <th className="py-2.5 px-3 text-right">Invested (₹)</th>
                      <th className="py-2.5 px-3 text-right">Current Value (₹)</th>
                      <th className="py-2.5 px-3 text-right">Unrealised P&amp;L</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {rawParsedRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/30">
                        <td className="py-2 px-3 font-mono text-slate-500">{idx + 1}</td>
                        <td className="py-2 px-3 font-bold text-white font-mono">{row.symbol}</td>
                        <td className="py-2 px-3 text-slate-300">
                          <div>{row.name}</div>
                          <div className="text-[10px] text-slate-500">{row.sector} • {row.marketCapCategory}</div>
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-200">{row.holdingQuantity}</td>
                        <td className="py-2 px-3 text-right font-mono text-slate-200">₹{Number(row.holdingRate).toFixed(2)}</td>
                        <td className="py-2 px-3 text-right font-mono text-slate-300">₹{Number(row.marketPrice).toFixed(2)}</td>
                        <td className="py-2 px-3 text-right font-mono text-slate-200">₹{Number(row.buyValue).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td className="py-2 px-3 text-right font-mono text-white font-semibold">₹{Number(row.currentValue).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td className={`py-2 px-3 text-right font-mono font-bold ${(row.unrealizedPnL || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {(row.unrealizedPnL || 0) >= 0 ? '+' : ''}{Number(row.unrealizedPnL || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span className="text-emerald-400 font-semibold text-[11px] inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Mode B: Validation Preview Tables when parsed from PDF (Standard Tradebook) */}
          {detectedStatementType !== 'holdings' && transactionsPreview.length > 0 && (
            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden shadow-sm space-y-4">
              <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    PDF Parsed Transactions: {transactionsPreview.length} Rows
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    <span className="text-emerald-400 font-bold">
                      {transactionsPreview.filter((r) => r.isValid).length} Valid
                    </span>{' '}
                    •{' '}
                    <span className="text-rose-400 font-bold">
                      {transactionsPreview.filter((r) => !r.isValid).length} Errors
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={resetUpload}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded-lg cursor-pointer"
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleConfirmTransactions}
                    disabled={transactionsPreview.filter((r) => r.isValid).length === 0 || isProcessing}
                    className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isProcessing ? 'Importing...' : 'Confirm & Import Transactions'}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3">Row</th>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Stock</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3 text-right">Quantity</th>
                      <th className="py-2.5 px-3 text-right">Price</th>
                      <th className="py-2.5 px-3">Validation Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {transactionsPreview.map((row) => (
                      <tr
                        key={row.rowIndex}
                        className={row.isValid ? 'hover:bg-slate-800/30' : 'bg-rose-500/5 hover:bg-rose-500/10'}
                      >
                        <td className="py-2.5 px-3 font-mono text-slate-500">{row.rowIndex}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-300">
                          {formatDateDDMMYYYY(row.data.date)}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-white">
                          {stocks.find((s) => s.id === row.data.stockId)?.symbol || `Stock #${row.data.stockId}`}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              row.data.type === 'BUY'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            }`}
                          >
                            {row.data.type}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-white tabular-nums">
                          {row.data.quantity}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-white tabular-nums">
                          {formatINR(row.data.price)}
                        </td>
                        <td className="py-2.5 px-3">
                          {row.isValid ? (
                            <span className="text-emerald-400 font-semibold text-[11px] flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Ready
                            </span>
                          ) : (
                            <span className="text-rose-400 text-[11px] font-semibold flex items-center gap-1">
                              <AlertCircle className="w-3 h-3 shrink-0" />
                              {row.errors.join('; ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {detectedStatementType !== 'holdings' && stocksPreview.length > 0 && transactionsPreview.length === 0 && (
            <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    PDF Parsed Stock Holdings: {stocksPreview.length} Rows
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    <span className="text-emerald-400 font-bold">
                      {stocksPreview.filter((r) => r.isValid).length} Valid
                    </span>{' '}
                    •{' '}
                    <span className="text-rose-400 font-bold">
                      {stocksPreview.filter((r) => !r.isValid).length} Errors
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={resetUpload}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded-lg cursor-pointer"
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleConfirmStocks}
                    disabled={stocksPreview.filter((r) => r.isValid).length === 0 || isProcessing}
                    className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isProcessing ? 'Importing...' : 'Confirm & Import Stocks'}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3">Row</th>
                      <th className="py-2.5 px-3">NSE Symbol</th>
                      <th className="py-2.5 px-3">BSE Code</th>
                      <th className="py-2.5 px-3">Company Name</th>
                      <th className="py-2.5 px-3">Sector</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {stocksPreview.map((row) => (
                      <tr
                        key={row.rowIndex}
                        className={row.isValid ? 'hover:bg-slate-800/30' : 'bg-rose-500/5 hover:bg-rose-500/10'}
                      >
                        <td className="py-2.5 px-3 font-mono text-slate-500">{row.rowIndex}</td>
                        <td className="py-2.5 px-3 font-bold text-white">{row.data.symbol}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-300">{row.data.bseCode}</td>
                        <td className="py-2.5 px-3 text-slate-300">{row.data.name}</td>
                        <td className="py-2.5 px-3 text-slate-400">{row.data.sector}</td>
                        <td className="py-2.5 px-3">
                          {row.isValid ? (
                            <span className="text-emerald-400 font-semibold text-[11px] flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Ready
                            </span>
                          ) : (
                            <span className="text-rose-400 text-[11px] font-semibold flex items-center gap-1">
                              <AlertCircle className="w-3 h-3 shrink-0" />
                              {row.errors.join('; ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 6: EXPORT CENTER */}
      {activeSubTab === 'export' && (
        <div className="space-y-6">
          {/* Main Featured Multi-sheet Excel Card */}
          <div className="bg-gradient-to-br from-emerald-500/10 via-slate-900 to-teal-500/10 border border-emerald-500/30 rounded-2xl p-6 shadow-lg">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <FileSpreadsheet className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-white">
                      Complete Portfolio Master Workbook (.xlsx)
                    </h3>
                    <p className="text-xs text-slate-400">
                      Multi-sheet Excel workbook containing your complete portfolio facts and calculations.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 text-[11px] text-slate-300">
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                    Sheet 1: Stocks Master
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                    Sheet 2: Current Holdings ({costMethod})
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                    Sheet 3: Tranche Ledger
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                    Sheet 4: Realized P&L & Tax
                  </span>
                </div>
              </div>

              <button
                onClick={() => exportMultiSheetExcel(stocks, holdings, transactions, corporateActions, costMethod)}
                className="flex items-center justify-center gap-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs sm:text-sm rounded-xl shadow-lg shadow-emerald-500/20 transition-all active:scale-95 shrink-0"
              >
                <Download className="w-4 h-4" />
                <span>Export Multi-Sheet Excel</span>
              </button>
            </div>
          </div>

          {/* Individual CSV Exports */}
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
              Individual CSV Export Downloads
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* CSV 1: Stocks Master */}
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-slate-700 transition-all">
                <div>
                  <div className="flex items-center gap-2 mb-2 text-white font-bold text-sm">
                    <FileText className="w-4 h-4 text-emerald-400" />
                    <span>Stocks Master CSV</span>
                  </div>
                  <p className="text-xs text-slate-400 mb-4">
                    All registered NSE & BSE stocks with sectors, market caps, and ISINs ({stocks.length} records).
                  </p>
                </div>
                <button
                  onClick={() => {
                    const rows = stocks.map((s) => ({
                      'NSE Symbol': s.symbol,
                      'BSE Code': s.bseCode,
                      'Company Name': s.name,
                      'Sector': s.sector,
                      'Market Cap Category': s.marketCapCategory,
                      'ISIN': s.isin || '',
                    }));
                    exportSingleSheetCSV(rows, 'dalal-diary-stocks.csv');
                  }}
                  className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 flex items-center justify-center gap-1.5 transition-all"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Download CSV</span>
                </button>
              </div>

              {/* CSV 2: Holdings */}
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-slate-700 transition-all">
                <div>
                  <div className="flex items-center gap-2 mb-2 text-white font-bold text-sm">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    <span>Active Holdings CSV</span>
                  </div>
                  <p className="text-xs text-slate-400 mb-4">
                    Active holdings, average prices, current valuations, and P&L under {costMethod} ({holdings.length} stocks).
                  </p>
                </div>
                <button
                  onClick={() => {
                    const rows = holdings.map((h) => ({
                      'Symbol': h.stock.symbol,
                      'BSE Code': h.stock.bseCode,
                      'Company': h.stock.name,
                      'Quantity': h.quantity,
                      'Average Price': h.averageBuyPrice,
                      'Invested': h.totalInvested,
                      'Current Price': h.currentPrice,
                      'Current Value': h.currentValue,
                      'Unrealized P&L': h.unrealizedPnL,
                      'P&L %': h.unrealizedPnLPercent,
                    }));
                    exportSingleSheetCSV(rows, 'dalal-diary-holdings.csv');
                  }}
                  className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 flex items-center justify-center gap-1.5 transition-all"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Download CSV</span>
                </button>
              </div>

              {/* CSV 3: Tranche Ledger */}
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-slate-700 transition-all">
                <div>
                  <div className="flex items-center gap-2 mb-2 text-white font-bold text-sm">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    <span>Tranche Ledger CSV</span>
                  </div>
                  <p className="text-xs text-slate-400 mb-4">
                    Full historical transaction ledger with quantities, prices, and charges ({transactions.length} rows).
                  </p>
                </div>
                <button
                  onClick={() => {
                    const rows = transactions.map((t) => ({
                      'Date': t.date,
                      'Symbol': t.symbol,
                      'Type': t.type,
                      'Quantity': t.quantity,
                      'Price': t.price,
                      'Charges': t.charges || 0,
                      'Note': t.note || '',
                    }));
                    exportSingleSheetCSV(rows, 'dalal-diary-transactions.csv');
                  }}
                  className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 flex items-center justify-center gap-1.5 transition-all"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Download CSV</span>
                </button>
              </div>

              {/* CSV 4: Latest Prices */}
              <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-slate-700 transition-all">
                <div>
                  <div className="flex items-center gap-2 mb-2 text-white font-bold text-sm">
                    <FileCheck className="w-4 h-4 text-emerald-400" />
                    <span>Latest Prices CSV</span>
                  </div>
                  <p className="text-xs text-slate-400 mb-4">
                    All stored manual prices with latest dates and historical entries ({priceRecords.length} records).
                  </p>
                </div>
                <button
                  onClick={() => {
                    const rows = priceRecords.map((p) => ({
                      'Symbol': p.symbol,
                      'Price': p.price,
                      'Date': p.date,
                    }));
                    exportSingleSheetCSV(rows, 'dalal-diary-prices.csv');
                  }}
                  className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 flex items-center justify-center gap-1.5 transition-all"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Download CSV</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
