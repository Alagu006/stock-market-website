import { useState, useMemo, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db,
  getOrInitSettings,
  updateCostMethodSetting,
  updateScreenerMappingSetting,
  bulkImportStocks,
  bulkUpsertFundamentals,
  seedSampleIndianPortfolio,
} from './db';
import type {
  Stock,
  Transaction,
  CostMethod,
  TransactionType,
  Fundamentals,
  CorporateAction,
  DividendRecord,
  BenchmarkRecord,
  AppSettings,
  MarketIndicesData,
  LiveQuote,
} from './types';
import {
  calculateAllHoldings,
  calculatePortfolioKPIs,
  calculateSectorAllocations,
} from './services/calculations';
import {
  checkProxyHealth,
  fetchLiveMarketIndices,
  fetchLiveQuotes,
  getYahooSymbolForExchange,
  getFallbackYahooSymbol,
  isIndianMarketOpen,
  mergeFeedFundamentals,
} from './services/priceFeed';
import { Navbar, type ActiveTabType } from './components/Navbar';
import { TopIndicesRibbon } from './components/TopIndicesRibbon';
import { KPICards } from './components/KPICards';
import { SectorAllocationCard } from './components/SectorAllocationCard';
import { HoldingsTable } from './components/HoldingsTable';
import { StocksAndPricesView } from './components/StocksAndPricesView';
import { FundamentalXRayView } from './components/FundamentalXRayView';
import { ScannersView } from './components/ScannersView';
import { ReturnsAndTaxView } from './components/ReturnsAndTaxView';
import { DividendsAndCorporateActionsView } from './components/DividendsAndCorporateActionsView';
import { CorporateActionsFeedView } from './components/CorporateActionsFeedView';
import { WatchlistView } from './components/WatchlistView';
import { SimulatorView } from './components/SimulatorView';
import { ImportExportView } from './components/ImportExportView';
import { AddTransactionModal } from './components/AddTransactionModal';
import { LotHistoryModal } from './components/LotHistoryModal';
import { ReverseTargetAvgModal } from './components/ReverseTargetAvgModal';
import { StockMasterModal } from './components/StockMasterModal';
import { PriceUpdateModal } from './components/PriceUpdateModal';
import { BackupRestoreModal } from './components/BackupRestoreModal';
import { SettingsModal } from './components/SettingsModal';
import { StockDirectoryModal } from './components/StockDirectoryModal';
import { ShieldCheck } from 'lucide-react';

export function App() {
  // Query raw tables from Dexie IndexedDB
  const stocks = useLiveQuery(() => db.stocks.toArray()) || [];
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const priceRecords = useLiveQuery(() => db.priceRecords.toArray()) || [];
  const corporateActions = useLiveQuery(() => db.corporateActions.toArray()) || [];
  const dividendRecords = useLiveQuery(() => db.dividendRecords.toArray()) || [];
  const fundamentalsList = useLiveQuery(() => db.fundamentals.toArray()) || [];
  const benchmarkRecords = useLiveQuery(() => db.benchmarkRecords.toArray()) || [];
  const settingsList = useLiveQuery(() => db.settings.toArray()) || [];

  const currentSettings = settingsList[0];

  // Active Navigation & Controls
  const [costMethod, setCostMethod] = useState<CostMethod>('Average Cost');
  const [activeTab, setActiveTab] = useState<ActiveTabType>('portfolio');
  const [xrayStockId, setXrayStockId] = useState<number | undefined>(undefined);

  // Live Price Feed State
  const [activeExchange, setActiveExchange] = useState<'NSE' | 'BSE'>('NSE');
  const [refreshMode, setRefreshMode] = useState<'Manual' | 'Auto 15s' | 'Auto 30s' | 'Off'>('Auto 15s');
  const [indices, setIndices] = useState<MarketIndicesData | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [serverStatus, setServerStatus] = useState<{ isOnline: boolean; message: string }>({
    isOnline: false,
    message: 'Connecting to price server...',
  });

  // Modals state
  const [isAddTxOpen, setIsAddTxOpen] = useState(false);
  const [addTxPreFill, setAddTxPreFill] = useState<{
    stockId?: number;
    type?: TransactionType;
    quantity?: number;
    price?: number;
  }>({});

  const [lotHistoryStockId, setLotHistoryStockId] = useState<number | null>(null);
  const [targetAvgStockId, setTargetAvgStockId] = useState<number | null>(null);
  const [priceUpdateStockId, setPriceUpdateStockId] = useState<number | null>(null);
  const [isStockMasterOpen, setIsStockMasterOpen] = useState(false);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isStockDirectoryOpen, setIsStockDirectoryOpen] = useState(false);

  // Sync settings when loaded
  useEffect(() => {
    if (currentSettings) {
      if (currentSettings.costMethod) setCostMethod(currentSettings.costMethod);
      if (currentSettings.activeExchange) setActiveExchange(currentSettings.activeExchange);
      if (currentSettings.refreshMode) setRefreshMode(currentSettings.refreshMode);
    } else {
      getOrInitSettings().then((s) => {
        setCostMethod(s.costMethod);
        if (s.activeExchange) setActiveExchange(s.activeExchange);
        if (s.refreshMode) setRefreshMode(s.refreshMode);
      });
    }
  }, [currentSettings]);

  // Handle switching global cost method
  const handleCostMethodChange = async (newMethod: CostMethod) => {
    setCostMethod(newMethod);
    await updateCostMethodSetting(newMethod);
  };

  // Handle toggle active exchange
  const handleToggleExchange = async (newEx: 'NSE' | 'BSE') => {
    setActiveExchange(newEx);
    if (currentSettings?.id) {
      await db.settings.update(currentSettings.id, { activeExchange: newEx });
    }
  };

  // Handle change refresh mode
  const handleChangeRefreshMode = async (mode: 'Manual' | 'Auto 15s' | 'Auto 30s' | 'Off') => {
    setRefreshMode(mode);
    if (currentSettings?.id) {
      await db.settings.update(currentSettings.id, { refreshMode: mode });
    }
  };

  // 1. Check Server Health on Mount & periodically
  useEffect(() => {
    let isMounted = true;
    const ping = async () => {
      const status = await checkProxyHealth();
      if (isMounted) setServerStatus(status);
    };
    ping();
    const interval = setInterval(ping, 30000); // Check every 30s
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // 2. Fetch Live Quotes & Indices Function with Daily Snapshot Deduplication
  const syncLivePrices = useCallback(async () => {
    if (stocks.length === 0) return;
    setIsSyncing(true);

    try {
      // A. Fetch Indices
      const indicesData = await fetchLiveMarketIndices();
      if (indicesData) {
        setIndices(indicesData);
        // Save NIFTY 50 checkpoint into db.benchmarkRecords (deduplicating by date)
        if (indicesData.nifty50 && indicesData.nifty50.level > 0) {
          const todayDate = new Date().toISOString().split('T')[0];
          const existingBench = await db.benchmarkRecords
            .where('name')
            .equalsIgnoreCase('NIFTY 50')
            .filter((b) => b.date === todayDate)
            .first();

          if (existingBench && existingBench.id) {
            await db.benchmarkRecords.update(existingBench.id, { level: indicesData.nifty50.level });
          } else {
            await db.benchmarkRecords.add({
              name: 'NIFTY 50',
              date: todayDate,
              level: indicesData.nifty50.level,
              createdAt: new Date().toISOString(),
            });
          }
        }
      }

      // B. Build symbols list for all stocks held or watchlisted
      const targetSymbols: string[] = [];
      const stockLookup = new Map<string, Stock>();

      for (const st of stocks) {
        const primaryYahoo = getYahooSymbolForExchange(st, activeExchange);
        const fallbackYahoo = getFallbackYahooSymbol(st, activeExchange);
        targetSymbols.push(primaryYahoo, fallbackYahoo);
        stockLookup.set(primaryYahoo, st);
        stockLookup.set(fallbackYahoo, st);
      }

      const quotes = await fetchLiveQuotes(targetSymbols);
      const quotesMap = new Map<string, LiveQuote>();
      quotes.forEach((q) => quotesMap.set(q.symbol, q));

      // C. Update Prices in DB (Deduplicating at most one snapshot per stock per day)
      const today = new Date().toISOString().split('T')[0];
      const nowISO = new Date().toISOString();

      await db.transaction('rw', [db.priceRecords, db.fundamentals], async () => {
        for (const st of stocks) {
          if (!st.id) continue;
          const primaryYahoo = getYahooSymbolForExchange(st, activeExchange);
          const fallbackYahoo = getFallbackYahooSymbol(st, activeExchange);

          const quote = quotesMap.get(primaryYahoo) || quotesMap.get(fallbackYahoo);
          if (quote && quote.price > 0) {
            // Deduplicate: check if today's price already exists for this stock
            const existingTodayRecord = await db.priceRecords
              .where('stockId')
              .equals(st.id)
              .filter((p) => p.date === today)
              .first();

            if (existingTodayRecord && existingTodayRecord.id) {
              await db.priceRecords.update(existingTodayRecord.id, {
                price: quote.price,
                createdAt: nowISO,
              });
            } else {
              await db.priceRecords.add({
                stockId: st.id,
                symbol: st.symbol,
                price: quote.price,
                date: today,
                createdAt: nowISO,
              });
            }

            // Auto-fill empty fundamentals without overwriting user manual/Screener values
            const existingFund = await db.fundamentals
              .where('stockId')
              .equals(st.id)
              .first();

            const mergedFund = mergeFeedFundamentals(existingFund, quote, st.id, st.symbol);
            await db.fundamentals.put(mergedFund);
          }
        }
      });

      setLastSynced(new Date());
    } catch (err) {
      console.warn('[App] Error during price synchronization:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [stocks, activeExchange]);

  // 3. Auto-Refresh Timer effect
  useEffect(() => {
    // Initial sync
    syncLivePrices();

    if (refreshMode === 'Off' || refreshMode === 'Manual') return;

    const intervalSeconds = refreshMode === 'Auto 15s' ? 15 : 30;

    const interval = setInterval(() => {
      // Pause if tab is hidden in background
      if (document.visibilityState !== 'visible') return;

      // Stop auto-refresh outside market hours (show last close)
      if (!isIndianMarketOpen()) return;

      syncLivePrices();
    }, intervalSeconds * 1000);

    return () => clearInterval(interval);
  }, [refreshMode, syncLivePrices]);

  // LIVE CALCULATIONS (Pure functions, recalculating entire state on-the-fly)
  const allHoldings = useMemo(() => {
    return calculateAllHoldings(
      stocks,
      transactions,
      corporateActions,
      priceRecords,
      fundamentalsList,
      costMethod
    );
  }, [stocks, transactions, corporateActions, priceRecords, fundamentalsList, costMethod]);

  // Portfolio KPIs
  const portfolioKPIs = useMemo(() => {
    return calculatePortfolioKPIs(allHoldings, stocks, transactions, corporateActions, costMethod);
  }, [allHoldings, stocks, transactions, corporateActions, costMethod]);

  // Sector allocations
  const sectorAllocations = useMemo(() => {
    return calculateSectorAllocations(allHoldings);
  }, [allHoldings]);

  // Stock currently selected for Lot History
  const selectedLotHistoryStock = useMemo(() => {
    return stocks.find((s) => s.id === lotHistoryStockId);
  }, [stocks, lotHistoryStockId]);

  // Stock currently selected for Price Update
  const selectedPriceUpdateStock = useMemo(() => {
    return stocks.find((s) => s.id === priceUpdateStockId);
  }, [stocks, priceUpdateStockId]);

  // Handlers for transactions
  const handleAddTransaction = async (txData: Omit<Transaction, 'id' | 'createdAt'>) => {
    await db.transactions.add({
      ...txData,
      createdAt: new Date().toISOString(),
    });
  };

  const handleDeleteTransaction = async (txId: number) => {
    await db.transactions.delete(txId);
  };

  // Handlers for stocks
  const handleAddStock = async (stockData: Omit<Stock, 'id' | 'createdAt'>, livePrice?: number) => {
    const id = await db.stocks.add({
      ...stockData,
      createdAt: new Date().toISOString(),
    });

    if (livePrice && livePrice > 0) {
      await db.priceRecords.add({
        stockId: id,
        symbol: stockData.symbol,
        price: livePrice,
        date: new Date().toISOString().split('T')[0],
        createdAt: new Date().toISOString(),
      });
    }
  };

  const handleUpdateStock = async (id: number, stockData: Partial<Stock>) => {
    await db.stocks.update(id, stockData);
  };

  const handleDeleteStock = async (id: number) => {
    await db.transaction(
      'rw',
      [
        db.stocks,
        db.transactions,
        db.priceRecords,
        db.fundamentals,
        db.corporateActions,
        db.dividendRecords,
      ],
      async () => {
        await db.stocks.delete(id);
        await db.transactions.where('stockId').equals(id).delete();
        await db.priceRecords.where('stockId').equals(id).delete();
        await db.fundamentals.where('stockId').equals(id).delete();
        await db.corporateActions.where('stockId').equals(id).delete();
        await db.dividendRecords.where('stockId').equals(id).delete();
      }
    );
  };

  // Handlers for manual prices (Manual entry must always keep working!)
  const handleAddPriceRecord = async (
    stockId: number,
    symbol: string,
    price: number,
    date: string
  ) => {
    await db.priceRecords.add({
      stockId,
      symbol,
      price,
      date,
      createdAt: new Date().toISOString(),
    });
  };

  // Handlers for Dividends
  const handleAddDividend = async (dividend: Omit<DividendRecord, 'id' | 'createdAt'>) => {
    await db.dividendRecords.add({
      ...dividend,
      createdAt: new Date().toISOString(),
    });
  };

  const handleDeleteDividend = async (id: number) => {
    await db.dividendRecords.delete(id);
  };

  // Handlers for Corporate Actions
  const handleAddCorporateAction = async (action: Omit<CorporateAction, 'id' | 'createdAt'>) => {
    await db.corporateActions.add({
      ...action,
      createdAt: new Date().toISOString(),
    });
  };

  const handleDeleteCorporateAction = async (id: number) => {
    await db.corporateActions.delete(id);
  };

  // Handlers for Benchmarks
  const handleAddBenchmark = async (bench: Omit<BenchmarkRecord, 'id' | 'createdAt'>) => {
    await db.benchmarkRecords.add({
      ...bench,
      createdAt: new Date().toISOString(),
    });
  };

  const handleDeleteBenchmark = async (id: number) => {
    await db.benchmarkRecords.delete(id);
  };

  // Handlers for Thesis & Watchlist
  const handleUpdateThesis = async (stockId: number, thesisNote: string) => {
    await db.stocks.update(stockId, { thesisNote });
  };

  const handleToggleWatchlist = async (stockId: number, currentStatus: boolean) => {
    await db.stocks.update(stockId, { watchlist: !currentStatus });
  };

  const handleUpdateTargetBuyPrice = async (stockId: number, price: number | undefined) => {
    await db.stocks.update(stockId, { targetBuyPrice: price });
  };

  // Settings & Database Reset
  const handleUpdateSettings = async (newSettings: Partial<AppSettings>) => {
    if (currentSettings?.id) {
      await db.settings.update(currentSettings.id, newSettings);
    }
  };

  const handleResetDatabase = async () => {
    await db.transaction(
      'rw',
      [
        db.stocks,
        db.transactions,
        db.priceRecords,
        db.fundamentals,
        db.corporateActions,
        db.dividendRecords,
        db.benchmarkRecords,
      ],
      async () => {
        await db.stocks.clear();
        await db.transactions.clear();
        await db.priceRecords.clear();
        await db.fundamentals.clear();
        await db.corporateActions.clear();
        await db.dividendRecords.clear();
        await db.benchmarkRecords.clear();
      }
    );
  };

  // Handlers for Imports & Exports
  const handleConfirmImportStocks = async (newStocks: Omit<Stock, 'id' | 'createdAt'>[]) => {
    await bulkImportStocks(newStocks);
  };

  const handleConfirmImportTransactions = async (
    newTxs: Omit<Transaction, 'id' | 'createdAt'>[]
  ) => {
    await db.transactions.bulkAdd(
      newTxs.map((tx) => ({
        ...tx,
        createdAt: new Date().toISOString(),
      }))
    );
  };

  const handleConfirmBulkPrices = async (
    prices: Array<{ stockId: number; symbol: string; price: number; date: string }>
  ) => {
    await db.priceRecords.bulkAdd(
      prices.map((p) => ({
        ...p,
        createdAt: new Date().toISOString(),
      }))
    );
  };

  const handleConfirmScreenerFundamentals = async (
    funds: Array<Partial<Fundamentals> & { stockId: number; symbol: string }>
  ) => {
    await bulkUpsertFundamentals(funds);
  };

  const handleSaveScreenerMapping = async (mapping: Record<string, string>) => {
    await updateScreenerMappingSetting(mapping);
  };

  // Pre-fill buy order from Target-Average calculator or Watchlist
  const handlePreFillBuy = (stockId: number, qty: number = 1, plannedPrice?: number) => {
    setAddTxPreFill({
      stockId,
      type: 'BUY',
      quantity: qty > 0 ? qty : 1,
      price: plannedPrice,
    });
    setIsAddTxOpen(true);
  };

  // Navigate to X-Ray
  const handleNavigateToXRay = (stockId: number) => {
    setXrayStockId(stockId);
    setActiveTab('xray');
  };

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 flex flex-col font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Top Indices Ribbon (NIFTY 50, SENSEX, NIFTY BANK & Live Feed Controls) */}
      <TopIndicesRibbon
        indices={indices}
        activeExchange={activeExchange}
        onToggleExchange={handleToggleExchange}
        refreshMode={refreshMode}
        onChangeRefreshMode={handleChangeRefreshMode}
        isSyncing={isSyncing}
        onManualSync={syncLivePrices}
        lastSynced={lastSynced}
        serverStatus={serverStatus}
      />

      {/* Top Navigation */}
      <Navbar
        costMethod={costMethod}
        onCostMethodChange={handleCostMethodChange}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        settings={currentSettings}
        stocks={stocks}
        onImportStock={handleAddStock}
        onOpenDirectoryModal={() => setIsStockDirectoryOpen(true)}
        onOpenAddTx={() => {
          setAddTxPreFill({});
          setIsAddTxOpen(true);
        }}
        onOpenStockMaster={() => setIsStockMasterOpen(true)}
        onOpenBackup={() => setIsBackupOpen(true)}
        onOpenTargetAvg={() => setTargetAvgStockId(stocks[0]?.id || null)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onNavigateToStock={(id) => handleNavigateToXRay(id)}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Phase 1: Portfolio Dashboard */}
        {activeTab === 'portfolio' && (
          <>
            <KPICards kpis={portfolioKPIs} costMethod={costMethod} />
            <SectorAllocationCard
              allocations={sectorAllocations}
              totalPortfolioValue={portfolioKPIs.currentValue}
            />
            <HoldingsTable
              holdings={allHoldings}
              costMethod={costMethod}
              onOpenLotHistory={(stockId) => setLotHistoryStockId(stockId)}
              onOpenTargetAvg={(stockId) => setTargetAvgStockId(stockId)}
              onOpenAddTxForStock={(stockId) => handlePreFillBuy(stockId)}
              onOpenPriceUpdate={(stockId) => setPriceUpdateStockId(stockId)}
              onSeedSampleData={seedSampleIndianPortfolio}
              onOpenStockMaster={() => setIsStockMasterOpen(true)}
            />
          </>
        )}

        {/* Phase 1: Stocks and Manual Prices */}
        {activeTab === 'stocks' && (
          <StocksAndPricesView
            stocks={stocks}
            priceRecords={priceRecords}
            transactions={transactions}
            corporateActions={corporateActions}
            costMethod={costMethod}
            searchQuery=""
            fundamentalsList={fundamentalsList}
            onOpenPriceUpdate={(stockId) => setPriceUpdateStockId(stockId)}
            onOpenAddTx={(stockId) => handlePreFillBuy(stockId)}
            onOpenStockMaster={() => setIsStockMasterOpen(true)}
            onOpenLotHistory={(stockId) => setLotHistoryStockId(stockId)}
            onOpenTargetAvg={(stockId) => setTargetAvgStockId(stockId)}
          />
        )}

        {/* Phase 3: Fundamental X-Ray */}
        {activeTab === 'xray' && (
          <FundamentalXRayView
            stocks={stocks}
            fundamentalsList={fundamentalsList}
            priceRecords={priceRecords}
            holdings={allHoldings}
            costMethod={costMethod}
            initialStockId={xrayStockId}
            onUpdateThesis={handleUpdateThesis}
            onOpenAddTx={(stockId) => handlePreFillBuy(stockId)}
            onOpenPriceUpdate={(stockId) => setPriceUpdateStockId(stockId)}
          />
        )}

        {/* Phase 3: Pre-Built & Custom Scanners */}
        {activeTab === 'scanners' && (
          <ScannersView
            stocks={stocks}
            fundamentalsList={fundamentalsList}
            priceRecords={priceRecords}
            holdings={allHoldings}
            onOpenAddTx={(stockId) => handlePreFillBuy(stockId)}
            onNavigateToXRay={handleNavigateToXRay}
          />
        )}

        {/* Phase 4: Returns & Indian Tax Center */}
        {activeTab === 'tax' && (
          <ReturnsAndTaxView
            stocks={stocks}
            transactions={transactions}
            corporateActions={corporateActions}
            dividends={dividendRecords}
            benchmarks={benchmarkRecords}
            holdings={allHoldings}
            settings={currentSettings}
            onAddBenchmark={handleAddBenchmark}
            onDeleteBenchmark={handleDeleteBenchmark}
          />
        )}

        {/* Phase 4: Dividends & Corporate Actions */}
        {activeTab === 'dividends' && (
          <DividendsAndCorporateActionsView
            stocks={stocks}
            dividends={dividendRecords}
            corporateActions={corporateActions}
            holdings={allHoldings}
            onAddDividend={handleAddDividend}
            onDeleteDividend={handleDeleteDividend}
            onAddCorporateAction={handleAddCorporateAction}
            onDeleteCorporateAction={handleDeleteCorporateAction}
          />
        )}

        {/* Step 5: Corporate Actions Live Feed */}
        {activeTab === 'events' && (
          <CorporateActionsFeedView
            stocks={stocks}
            holdings={allHoldings}
            existingDividends={dividendRecords}
            existingCorporateActions={corporateActions}
            onAddDividend={handleAddDividend}
            onAddCorporateAction={handleAddCorporateAction}
            onDeleteCorporateAction={handleDeleteCorporateAction}
          />
        )}

        {/* Phase 5: Buy-Zone Watchlist */}
        {activeTab === 'watchlist' && (
          <WatchlistView
            stocks={stocks}
            fundamentalsList={fundamentalsList}
            priceRecords={priceRecords}
            holdings={allHoldings}
            onToggleWatchlist={handleToggleWatchlist}
            onUpdateTargetBuyPrice={handleUpdateTargetBuyPrice}
            onOpenAddTx={(stockId) => handlePreFillBuy(stockId)}
            onNavigateToXRay={handleNavigateToXRay}
          />
        )}

        {/* Phase 5: Compounding Simulator */}
        {activeTab === 'simulator' && (
          <SimulatorView
            currentPortfolioValue={portfolioKPIs.currentValue}
            stocks={stocks}
            fundamentalsList={fundamentalsList}
            holdings={allHoldings}
            priceRecords={priceRecords}
          />
        )}

        {/* Phase 2: Import / Export Center */}
        {activeTab === 'import-export' && (
          <ImportExportView
            stocks={stocks}
            holdings={allHoldings}
            transactions={transactions}
            corporateActions={corporateActions}
            priceRecords={priceRecords}
            fundamentalsList={fundamentalsList}
            costMethod={costMethod}
            savedScreenerMapping={currentSettings?.savedScreenerMapping}
            onSaveScreenerMapping={handleSaveScreenerMapping}
            onConfirmImportStocks={handleConfirmImportStocks}
            onConfirmImportTransactions={handleConfirmImportTransactions}
            onConfirmBulkPrices={handleConfirmBulkPrices}
            onConfirmScreenerFundamentals={handleConfirmScreenerFundamentals}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-[#0a0e17] py-5 mt-auto text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-300">Dalal Diary's</span>
            <span>•</span>
            <span>Personal Indian Stock Portfolio Tracker</span>
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>100% Client-Side IndexedDB</span>
            </span>
            <span>•</span>
            <span className="text-emerald-400 font-semibold">Live NSE/BSE Feed Connected</span>
          </div>
        </div>
      </footer>

      {/* MODALS */}
      {/* 1. Add Transaction Modal */}
      <AddTransactionModal
        isOpen={isAddTxOpen}
        onClose={() => {
          setIsAddTxOpen(false);
          setAddTxPreFill({});
        }}
        onAddTransaction={handleAddTransaction}
        stocks={stocks}
        allTransactions={transactions}
        corporateActions={corporateActions}
        priceRecords={priceRecords}
        costMethod={costMethod}
        initialStockId={addTxPreFill.stockId}
        initialType={addTxPreFill.type}
        initialQuantity={addTxPreFill.quantity}
        initialPrice={addTxPreFill.price}
      />

      {/* 2. Lot History Modal */}
      <LotHistoryModal
        isOpen={lotHistoryStockId !== null}
        onClose={() => setLotHistoryStockId(null)}
        stock={selectedLotHistoryStock}
        transactions={transactions}
        corporateActions={corporateActions}
        costMethod={costMethod}
        onDeleteTransaction={handleDeleteTransaction}
      />

      {/* 3. Reverse Target-Average Calculator ("Buy the Dip") */}
      <ReverseTargetAvgModal
        isOpen={targetAvgStockId !== null}
        onClose={() => setTargetAvgStockId(null)}
        stocks={stocks}
        transactions={transactions}
        corporateActions={corporateActions}
        costMethod={costMethod}
        initialStockId={targetAvgStockId || undefined}
        onPreFillBuy={(stockId, qty, price) => handlePreFillBuy(stockId, qty, price)}
      />

      {/* 4. Stock Master Management */}
      <StockMasterModal
        isOpen={isStockMasterOpen}
        onClose={() => setIsStockMasterOpen(false)}
        stocks={stocks}
        onAddStock={handleAddStock}
        onUpdateStock={handleUpdateStock}
        onDeleteStock={handleDeleteStock}
      />

      {/* 5. Master Stock Directory Modal */}
      <StockDirectoryModal
        isOpen={isStockDirectoryOpen}
        onClose={() => setIsStockDirectoryOpen(false)}
        existingStocks={stocks}
        onImportStock={handleAddStock}
      />

      {/* 6. Price Update Modal (Manual price entry always kept working) */}
      <PriceUpdateModal
        isOpen={priceUpdateStockId !== null}
        onClose={() => setPriceUpdateStockId(null)}
        stock={selectedPriceUpdateStock}
        priceRecords={priceRecords}
        onAddPriceRecord={handleAddPriceRecord}
      />

      {/* 7. Backup & Restore Modal */}
      <BackupRestoreModal
        isOpen={isBackupOpen}
        onClose={() => setIsBackupOpen(false)}
        settings={currentSettings}
        onDataChanged={() => {}}
      />

      {/* 8. Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={currentSettings}
        onUpdateSettings={handleUpdateSettings}
        onLoadDemoData={seedSampleIndianPortfolio}
        onResetDatabase={handleResetDatabase}
      />
    </div>
  );
}

export default App;
