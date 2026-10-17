import { describe, it, expect } from 'vitest';
import {
  validateStocksImport,
  validateTransactionsImport,
  validateBulkPricesImport,
  autoDetectScreenerMapping,
  parseScreenerRows,
  normalizeDate,
} from './importExport';
import type { Stock, Transaction } from '../types';

describe('Import & Export Service Unit Tests', () => {
  const existingStocks: Stock[] = [
    {
      id: 1,
      symbol: 'TCS',
      bseCode: '532540',
      name: 'Tata Consultancy Services',
      sector: 'Information Technology',
      marketCapCategory: 'Large Cap',
      createdAt: '',
    },
    {
      id: 2,
      symbol: 'RELIANCE',
      bseCode: '500325',
      name: 'Reliance Industries Ltd',
      sector: 'Energy',
      marketCapCategory: 'Large Cap',
      createdAt: '',
    },
  ];

  it('normalizes various date formats into YYYY-MM-DD', () => {
    expect(normalizeDate('15-01-2024')).toBe('2024-01-15');
    expect(normalizeDate('15/01/2024')).toBe('2024-01-15');
    expect(normalizeDate('2024-01-15')).toBe('2024-01-15');
    expect(normalizeDate(new Date('2024-01-15T00:00:00Z'))).toBe('2024-01-15');
  });

  it('validates and parses stock master rows correctly', () => {
    const rawRows = [
      { 'NSE_Symbol': 'INFY', 'BSE_Code': '500209', 'Name': 'Infosys Limited', 'Sector': 'IT' },
      { 'BSE_Code': '123' }, // Invalid BSE code (not 6 digits)
      { 'BSE_Code': '500180' }, // BSE code only -> should generate fallback symbol/name
    ];

    const results = validateStocksImport(rawRows, existingStocks);

    expect(results).toHaveLength(3);
    // Row 1: Valid
    expect(results[0].isValid).toBe(true);
    expect(results[0].data.symbol).toBe('INFY');
    expect(results[0].data.bseCode).toBe('500209');

    // Row 2: Error
    expect(results[1].isValid).toBe(false);
    expect(results[1].errors.length).toBeGreaterThan(0);

    // Row 3: Valid with warning fallback
    expect(results[2].isValid).toBe(true);
    expect(results[2].data.symbol).toBe('BSE_500180');
    expect(results[2].warnings.length).toBeGreaterThan(0);
  });

  it('validates transaction rows and blocks invalid oversells', () => {
    const existingTransactions: Transaction[] = [
      { id: 1, stockId: 1, symbol: 'TCS', type: 'BUY', date: '2024-01-10', quantity: 10, price: 3000, createdAt: '' },
    ];

    const rawRows = [
      { 'Symbol': 'TCS', 'Date': '15-01-2024', 'Type': 'BUY', 'Qty': 5, 'Price': 3200 },
      { 'Symbol': 'TCS', 'Date': '20-01-2024', 'Type': 'SELL', 'Qty': 20, 'Price': 3500 }, // Oversell: holds 10+5=15, trying to sell 20
      { 'Symbol': 'UNKNOWN', 'Date': '15-01-2024', 'Type': 'BUY', 'Qty': 10, 'Price': 100 }, // Unknown stock
    ];

    const results = validateTransactionsImport(rawRows, existingStocks, existingTransactions, []);

    expect(results).toHaveLength(3);
    expect(results[0].isValid).toBe(true);
    expect(results[1].isValid).toBe(false); // Oversell blocked
    expect(results[1].errors[0]).toContain('Cannot sell 20 shares');
    expect(results[2].isValid).toBe(false); // Stock not found
  });

  it('validates bulk price updates accurately', () => {
    const rawRows = [
      { 'Symbol': 'TCS', 'Price': '4120.50', 'Date': '2024-10-17' },
      { 'BSE_Code': '500325', 'Price': '2750.00' }, // Matched by BSE code
      { 'Symbol': 'TCS', 'Price': '-50' }, // Invalid price
    ];

    const results = validateBulkPricesImport(rawRows, existingStocks);

    expect(results).toHaveLength(3);
    expect(results[0].isValid).toBe(true);
    expect(results[0].data.price).toBe(4120.50);

    expect(results[1].isValid).toBe(true);
    expect(results[1].data.symbol).toBe('RELIANCE');

    expect(results[2].isValid).toBe(false);
  });

  it('auto-detects Screener column headers and maps fundamentals', () => {
    const columns = [
      'Company Name',
      'NSE Symbol',
      'Market Capitalization',
      'Price to Earning',
      'Return on capital employed',
      'Debt to equity',
    ];

    const mapping = autoDetectScreenerMapping(columns);

    expect(mapping['marketCapCr']).toBe('Market Capitalization');
    expect(mapping['stockPE']).toBe('Price to Earning');
    expect(mapping['roce']).toBe('Return on capital employed');
    expect(mapping['debtToEquity']).toBe('Debt to equity');

    const sampleRows = [
      {
        'Company Name': 'Tata Consultancy Services',
        'NSE Symbol': 'TCS',
        'Market Capitalization': '14,85,000',
        'Price to Earning': '30.5',
        'Return on capital employed': '58.2%',
        'Debt to equity': '0.05',
      },
    ];

    const parsed = parseScreenerRows(sampleRows, mapping, existingStocks);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].isValid).toBe(true);
    expect(parsed[0].data.stockPE).toBe(30.5);
    expect(parsed[0].data.roce).toBe(58.2);
    expect(parsed[0].data.debtToEquity).toBe(0.05);
  });
});
