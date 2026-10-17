import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db,
  getOrInitSettings,
  updateCostMethodSetting,
  seedSampleIndianPortfolio,
} from './db';
import type { Stock, Transaction, CostMethod, TransactionType } from './types';
import {
  calculateAllHoldings,
  calculatePortfolioKPIs,
  calculateSectorAllocations,
} from './services/calculations';
import { Navbar } from './components/Navbar';
import { KPICards } from './components/KPICards';
import { SectorAllocationCard } from './components/SectorAllocationCard';
import { HoldingsTable } from './components/HoldingsTable';
import { StocksAndPricesView } from './components/StocksAndPricesView';
import { AddTransactionModal } from './components/AddTransactionModal';
import { LotHistoryModal } from './components/LotHistoryModal';
import { ReverseTargetAvgModal } from './components/ReverseTargetAvgModal';
import { StockMasterModal } from './components/StockMasterModal';
import { PriceUpdateModal } from './components/PriceUpdateModal';
import { BackupRestoreModal } from './components/BackupRestoreModal';
import { ShieldCheck } from 'lucide-react';

export function App() {
  // Query raw tables from Dexie IndexedDB
  const stocks = useLiveQuery(() => db.stocks.toArray()) || [];
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const priceRecords = useLiveQuery(() => db.priceRecords.toArray()) || [];
  const corporateActions = useLiveQuery(() => db.corporateActions.toArray()) || [];
  const fundamentalsList = useLiveQuery(() => db.fundamentals.toArray()) || [];
  const settingsList = useLiveQuery(() => db.settings.toArray()) || [];

  const currentSettings = settingsList[0];

  // Active Cost Method state (defaults to 'Average Cost' if not yet initialized)
  const [costMethod, setCostMethod] = useState<CostMethod>('Average Cost');
  const [activeTab, setActiveTab] = useState<'portfolio' | 'stocks'>('portfolio');
  const [searchQuery, setSearchQuery] = useState('');

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

  // Sync settings when loaded
  useEffect(() => {
    if (currentSettings?.costMethod) {
      setCostMethod(currentSettings.costMethod);
    } else {
      getOrInitSettings().then((s) => setCostMethod(s.costMethod));
    }
  }, [currentSettings]);

  // Handle switching global cost method
  const handleCostMethodChange = async (newMethod: CostMethod) => {
    setCostMethod(newMethod);
    await updateCostMethodSetting(newMethod);
  };

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

  // Filter holdings based on search
  const filteredHoldings = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return allHoldings;
    return allHoldings.filter(
      (h) =>
        h.stock.symbol.toLowerCase().includes(q) ||
        h.stock.bseCode.toLowerCase().includes(q) ||
        h.stock.name.toLowerCase().includes(q) ||
        h.stock.sector.toLowerCase().includes(q)
    );
  }, [allHoldings, searchQuery]);

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
  const handleAddStock = async (stockData: Omit<Stock, 'id' | 'createdAt'>) => {
    await db.stocks.add({
      ...stockData,
      createdAt: new Date().toISOString(),
    });
  };

  const handleUpdateStock = async (id: number, stockData: Partial<Stock>) => {
    await db.stocks.update(id, stockData);
  };

  const handleDeleteStock = async (id: number) => {
    await db.transaction('rw', [db.stocks, db.transactions, db.priceRecords, db.fundamentals], async () => {
      await db.stocks.delete(id);
      await db.transactions.where('stockId').equals(id).delete();
      await db.priceRecords.where('stockId').equals(id).delete();
      await db.fundamentals.where('stockId').equals(id).delete();
    });
  };

  // Handlers for prices
  const handleAddPriceRecord = async (stockId: number, symbol: string, price: number, date: string) => {
    await db.priceRecords.add({
      stockId,
      symbol,
      price,
      date,
      createdAt: new Date().toISOString(),
    });
  };

  // Pre-fill buy order from Target-Average calculator
  const handlePreFillBuy = (stockId: number, qty: number, plannedPrice: number) => {
    setAddTxPreFill({
      stockId,
      type: 'BUY',
      quantity: qty,
      price: plannedPrice,
    });
    setIsAddTxOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 flex flex-col font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Top Navigation */}
      <Navbar
        costMethod={costMethod}
        onCostMethodChange={handleCostMethodChange}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        settings={currentSettings}
        onOpenAddTx={() => {
          setAddTxPreFill({});
          setIsAddTxOpen(true);
        }}
        onOpenStockMaster={() => setIsStockMasterOpen(true)}
        onOpenBackup={() => setIsBackupOpen(true)}
        onOpenTargetAvg={() => setTargetAvgStockId(stocks[0]?.id || null)}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {activeTab === 'portfolio' ? (
          <>
            {/* KPI Cards */}
            <KPICards kpis={portfolioKPIs} costMethod={costMethod} />

            {/* Sector Concentration Bar */}
            <SectorAllocationCard
              allocations={sectorAllocations}
              totalPortfolioValue={portfolioKPIs.currentValue}
            />

            {/* Holdings Table */}
            <HoldingsTable
              holdings={filteredHoldings}
              costMethod={costMethod}
              onOpenLotHistory={(stockId) => setLotHistoryStockId(stockId)}
              onOpenTargetAvg={(stockId) => setTargetAvgStockId(stockId)}
              onOpenAddTxForStock={(stockId) => {
                setAddTxPreFill({ stockId });
                setIsAddTxOpen(true);
              }}
              onOpenPriceUpdate={(stockId) => setPriceUpdateStockId(stockId)}
              onSeedSampleData={seedSampleIndianPortfolio}
              onOpenStockMaster={() => setIsStockMasterOpen(true)}
            />
          </>
        ) : (
          /* Stocks & Manual Prices View */
          <StocksAndPricesView
            stocks={stocks}
            priceRecords={priceRecords}
            transactions={transactions}
            corporateActions={corporateActions}
            costMethod={costMethod}
            searchQuery={searchQuery}
            onOpenPriceUpdate={(stockId) => setPriceUpdateStockId(stockId)}
            onOpenAddTx={(stockId) => {
              setAddTxPreFill({ stockId });
              setIsAddTxOpen(true);
            }}
            onOpenStockMaster={() => setIsStockMasterOpen(true)}
            onOpenLotHistory={(stockId) => setLotHistoryStockId(stockId)}
            onOpenTargetAvg={(stockId) => setTargetAvgStockId(stockId)}
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
            <span>Phase 1: Portfolio Core</span>
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
        onPreFillBuy={handlePreFillBuy}
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

      {/* 5. Price Update Modal */}
      <PriceUpdateModal
        isOpen={priceUpdateStockId !== null}
        onClose={() => setPriceUpdateStockId(null)}
        stock={selectedPriceUpdateStock}
        priceRecords={priceRecords}
        onAddPriceRecord={handleAddPriceRecord}
      />

      {/* 6. Backup & Restore Modal */}
      <BackupRestoreModal
        isOpen={isBackupOpen}
        onClose={() => setIsBackupOpen(false)}
        settings={currentSettings}
        onDataChanged={() => {}}
      />
    </div>
  );
}

export default App;
