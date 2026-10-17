import { describe, it, expect } from 'vitest';
import {
  getYahooSymbolForExchange,
  getFallbackYahooSymbol,
  isIndianMarketOpen,
  mergeFeedFundamentals,
} from './priceFeed';
import type { Fundamentals, LiveQuote } from '../types';

describe('Price Feed Service & Quality Checks', () => {
  describe('Symbol Mapping', () => {
    it('maps NSE symbols with .NS extension correctly', () => {
      const stock = { symbol: 'RELIANCE', bseCode: '500325' };
      expect(getYahooSymbolForExchange(stock, 'NSE')).toBe('RELIANCE.NS');
    });

    it('maps BSE code with .BO extension when bseCode is provided', () => {
      const stock = { symbol: 'RELIANCE', bseCode: '500325' };
      expect(getYahooSymbolForExchange(stock, 'BSE')).toBe('500325.BO');
    });

    it('maps BSE symbol with .BO extension when bseCode is absent', () => {
      const stock = { symbol: 'INFY' };
      expect(getYahooSymbolForExchange(stock, 'BSE')).toBe('INFY.BO');
    });

    it('correctly handles symbols with special characters like ampersands and hyphens', () => {
      expect(getYahooSymbolForExchange({ symbol: 'M&M' }, 'NSE')).toBe('M&M.NS');
      expect(getYahooSymbolForExchange({ symbol: 'BAJAJ-AUTO' }, 'NSE')).toBe('BAJAJ-AUTO.NS');
      expect(getYahooSymbolForExchange({ symbol: 'L&TFH' }, 'NSE')).toBe('L&TFH.NS');
    });
  });

  describe('Exchange Fallback Logic', () => {
    it('returns BSE symbol as fallback when preferred exchange is NSE', () => {
      const stock = { symbol: 'TCS', bseCode: '532540' };
      const fallback = getFallbackYahooSymbol(stock, 'NSE');
      expect(fallback).toBe('532540.BO');
    });

    it('returns NSE symbol as fallback when preferred exchange is BSE', () => {
      const stock = { symbol: 'TCS', bseCode: '532540' };
      const fallback = getFallbackYahooSymbol(stock, 'BSE');
      expect(fallback).toBe('TCS.NS');
    });
  });

  describe('Market Hours Check (09:15 to 15:30 IST, Mon-Fri)', () => {
    it('returns true during active trading hours on a weekday (e.g. Wednesday 11:30 AM IST)', () => {
      // Wednesday, 2026-10-14 06:00 UTC = 11:30 AM IST
      const activeTradingTime = new Date('2026-10-14T06:00:00.000Z');
      expect(isIndianMarketOpen(activeTradingTime)).toBe(true);
    });

    it('returns false before trading hours on a weekday (e.g. Wednesday 08:30 AM IST)', () => {
      // Wednesday, 2026-10-14 03:00 UTC = 08:30 AM IST
      const preMarketTime = new Date('2026-10-14T03:00:00.000Z');
      expect(isIndianMarketOpen(preMarketTime)).toBe(false);
    });

    it('returns false after market close on a weekday (e.g. Wednesday 04:30 PM IST)', () => {
      // Wednesday, 2026-10-14 11:00 UTC = 04:30 PM IST
      const postMarketTime = new Date('2026-10-14T11:00:00.000Z');
      expect(isIndianMarketOpen(postMarketTime)).toBe(false);
    });

    it('returns false on Saturdays even during normal market hours', () => {
      // Saturday, 2026-10-17 06:00 UTC = 11:30 AM IST
      const saturdayTime = new Date('2026-10-17T06:00:00.000Z');
      expect(isIndianMarketOpen(saturdayTime)).toBe(false);
    });

    it('returns false on Sundays', () => {
      // Sunday, 2026-10-18 06:00 UTC = 11:30 AM IST
      const sundayTime = new Date('2026-10-18T06:00:00.000Z');
      expect(isIndianMarketOpen(sundayTime)).toBe(false);
    });
  });

  describe('Feed Non-Overwrite & Fundamentals Merging', () => {
    const existingFund: Fundamentals = {
      id: 1,
      stockId: 10,
      symbol: 'RELIANCE',
      stockPE: 24.5,
      roce: 11.2,
      roe: 9.8,
      debtToEquity: 0.35,
      salesCagr10Y: 14.2,
      profitCagr10Y: 12.0,
      shareholding: {
        promoter: 50.3,
        fii: 20.1,
        dii: 15.2,
        public: 14.4,
      },
      lastUpdated: '2026-10-01',
    };

    const feedQuote: LiveQuote = {
      symbol: 'RELIANCE.NS',
      shortName: 'Reliance Industries Ltd',
      price: 2950,
      previousClose: 2920,
      change: 30,
      changePercent: 1.03,
      high52W: 3024,
      low52W: 2220,
      pe: 29.8, // Should NOT overwrite existing 24.5
      dividendYield: 0.35, // Should fill because existing was undefined
      marketCap: 1950000, // Should fill because existing was undefined
      timestamp: '2026-10-17T10:00:00Z',
    };

    it('preserves existing manual/Screener values and fills empty fields only', () => {
      const merged = mergeFeedFundamentals(existingFund, feedQuote, 10, 'RELIANCE');

      // Existing PE was 24.5 -> MUST remain 24.5, NOT replaced by feed 29.8
      expect(merged.stockPE).toBe(24.5);
      // Empty fields filled from feed
      expect(merged.high52W).toBe(3024);
      expect(merged.low52W).toBe(2220);
      expect(merged.dividendYield).toBe(0.35);
      expect(merged.marketCapCr).toBe(1950000);
      // Other manual fields untouched
      expect(merged.roce).toBe(11.2);
      expect(merged.roe).toBe(9.8);
      expect(merged.shareholding?.promoter).toBe(50.3);

      // Verify feed source tags distinguish between Manual / Screener vs Feed
      expect(merged.feedSourceTags?.stockPE).toBe('Manual / Screener');
      expect(merged.feedSourceTags?.high52W).toBe('Feed');
      expect(merged.feedSourceTags?.dividendYield).toBe('Feed');
    });

    it('initializes clean fundamentals if no prior record existed', () => {
      const merged = mergeFeedFundamentals(undefined, feedQuote, 10, 'RELIANCE');
      expect(merged.high52W).toBe(3024);
      expect(merged.stockPE).toBe(29.8);
      expect(merged.feedSourceTags?.stockPE).toBe('Feed');
    });
  });

  describe('Price Snapshot Deduplication Logic', () => {
    it('deduplicates multiple price updates on the same date to a single record per stock', () => {
      // Test simulator mirroring the App.tsx deduplication logic
      interface PriceRecordTest {
        id?: number;
        stockId: number;
        price: number;
        date: string;
      }
      const records: PriceRecordTest[] = [];

      function recordDailyPrice(stockId: number, price: number, date: string) {
        const existingIndex = records.findIndex((r) => r.stockId === stockId && r.date === date);
        if (existingIndex >= 0) {
          records[existingIndex].price = price; // update existing snapshot
        } else {
          records.push({ id: records.length + 1, stockId, price, date });
        }
      }

      const today = '2026-10-17';
      // Morning price update
      recordDailyPrice(10, 2900, today);
      expect(records.length).toBe(1);
      expect(records[0].price).toBe(2900);

      // Noon price update
      recordDailyPrice(10, 2920, today);
      expect(records.length).toBe(1); // Still 1 snapshot for today
      expect(records[0].price).toBe(2920);

      // Close price update
      recordDailyPrice(10, 2950, today);
      expect(records.length).toBe(1); // Never duplicates
      expect(records[0].price).toBe(2950);

      // Next day creates new record
      recordDailyPrice(10, 2975, '2026-10-18');
      expect(records.length).toBe(2);
    });
  });

  describe('Stock Directory Deduplication', () => {
    it('deduplicates new stock entries by symbol, bseCode, or ISIN', () => {
      interface DirectoryEntry {
        symbol: string;
        bseCode?: string;
        isin?: string;
        name: string;
      }

      const directory: DirectoryEntry[] = [
        { symbol: 'RELIANCE', bseCode: '500325', isin: 'INE002A01018', name: 'Reliance Industries Ltd' },
        { symbol: 'TCS', bseCode: '532540', isin: 'INE467B01029', name: 'Tata Consultancy Services' },
      ];

      function tryAppendStock(newStock: DirectoryEntry): boolean {
        const sym = newStock.symbol.trim().toUpperCase();
        const bse = newStock.bseCode ? newStock.bseCode.trim() : '';
        const isin = newStock.isin ? newStock.isin.trim().toUpperCase() : '';

        const exists = directory.some((item) => {
          const matchSym = sym && item.symbol.toUpperCase() === sym;
          const matchBse = bse && item.bseCode && item.bseCode.trim() === bse;
          const matchIsin = isin && item.isin && item.isin.toUpperCase() === isin;
          return matchSym || matchBse || matchIsin;
        });

        if (exists) return false;
        directory.push(newStock);
        return true;
      }

      // Existing symbol (case-insensitive) -> should reject
      expect(tryAppendStock({ symbol: 'reliance', name: 'Reliance Duplicate' })).toBe(false);

      // Existing BSE code -> should reject
      expect(tryAppendStock({ symbol: 'NEWREL', bseCode: '500325', name: 'Reliance by BSE' })).toBe(false);

      // Existing ISIN -> should reject
      expect(tryAppendStock({ symbol: 'TCSEXTRA', isin: 'INE467B01029', name: 'TCS by ISIN' })).toBe(false);

      // Brand new stock -> should accept
      expect(
        tryAppendStock({ symbol: 'INFY', bseCode: '500209', isin: 'INE009A01021', name: 'Infosys Ltd' })
      ).toBe(true);
      expect(directory.length).toBe(3);
    });
  });

  describe('BSE HTML Table Rows and Metrics Parsing', () => {
    it('correctly parses BSE td.textsr and td.textvalue pairs', () => {
      const sampleHtml = `
        <div class="card-conatiner">
          <table>
            <tr><td class="textsr">Previous Close</td><td class="textvalue">2,950.40</td></tr>
            <tr><td class="textsr">Open</td><td class="textvalue">2,960.00</td></tr>
            <tr><td class="textsr">VWAP</td><td class="textvalue">2,955.20</td></tr>
            <tr><td class="textsr">52 Wk High</td><td class="textvalue">3,200.00</td></tr>
            <tr><td class="textsr">52 Wk Low</td><td class="textvalue">2,400.00</td></tr>
            <tr><td class="textsr">Upper Price Band</td><td class="textvalue">3,245.00</td></tr>
            <tr><td class="textsr">Lower Price Band</td><td class="textvalue">2,655.00</td></tr>
            <tr><td class="textsr">TTQ (Lakh)</td><td class="textvalue">12.50</td></tr>
            <tr><td class="textsr">Turnover (Cr.)</td><td class="textvalue">368.50</td></tr>
            <tr><td class="textsr">2W Avg Qty (Lakh)</td><td class="textvalue">15.20</td></tr>
            <tr><td class="textsr">Mcap Full (Cr.)</td><td class="textvalue">19,85,000.00</td></tr>
            <tr><td class="textsr">Mcap FF (Cr.)</td><td class="textvalue">9,50,000.00</td></tr>
            <tr><td class="textsr">EPS (TTM)</td><td class="textvalue">15.13/16.11</td></tr>
            <tr><td class="textsr">CEPS (TTM)</td><td class="textvalue">16.30/17.48</td></tr>
            <tr><td class="textsr">PE</td><td class="textvalue">17.38/16.33</td></tr>
            <tr><td class="textsr">ROE / PB</td><td class="textvalue">25.99/4.52</td></tr>
            <tr><td class="textsr">Face Value</td><td class="textvalue">10.00</td></tr>
            <tr><td class="textsr">Index</td><td class="textvalue">S&amp;P BSE SENSEX</td></tr>
            <tr><td class="textsr">Basic Industry</td><td class="textvalue">Refineries &amp; Marketing</td></tr>
          </table>
        </div>
      `;

      // Helper regex mirroring server/index.js parseBseTableRows
      const regex = /<td[^>]*class=["']textsr["'][^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class=["']textvalue["'][^>]*>([\s\S]*?)<\/td>/gi;
      let match;
      const parsed: Record<string, string> = {};
      while ((match = regex.exec(sampleHtml)) !== null) {
        const k = match[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
        const v = match[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
        if (k) parsed[k] = v;
      }

      expect(parsed['Previous Close']).toBe('2,950.40');
      expect(parsed['VWAP']).toBe('2,955.20');
      expect(parsed['EPS (TTM)']).toBe('15.13/16.11');
      expect(parsed['ROE / PB']).toBe('25.99/4.52');
      expect(parsed['Basic Industry']).toBe('Refineries & Marketing');

      // Check ROE & PB splitting
      const roePbParts = parsed['ROE / PB'].split('/').map((s) => parseFloat(s.trim()));
      expect(roePbParts[0]).toBe(25.99); // ROE %
      expect(roePbParts[1]).toBe(4.52); // PB multiple

      // Check EPS splitting
      const epsParts = parsed['EPS (TTM)'].split('/').map((s) => parseFloat(s.trim()));
      expect(epsParts[0]).toBe(15.13); // Standalone EPS
      expect(epsParts[1]).toBe(16.11); // Consolidated EPS
    });
  });
});
