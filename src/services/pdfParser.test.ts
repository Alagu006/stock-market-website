import { describe, it, expect } from 'vitest';
import { parseStatementText } from './pdfParser';

describe('PDF and Text Statement Parser Tests', () => {
  it('parses tabular statement text with header columns', () => {
    const raw = `Date\tSymbol\tType\tQuantity\tPrice
15-06-2026\tRELIANCE\tBUY\t25\t1220.50
18-07-2026\tTCS\tBUY\t10\t3850.00`;

    const result = parseStatementText(raw);
    expect(result.rows).toHaveLength(2);
    expect(result.detectedType).toBe('transactions');
    expect(result.rows[0].Symbol).toBe('RELIANCE');
    expect(result.rows[0].Quantity).toBe('25');
    expect(result.rows[1].Price).toBe('3850.00');
  });

  it('parses unformatted line-by-line pattern text from copied PDFs', () => {
    const raw = `15-06-2026 RELIANCE BUY 25 1220.50
18-07-2026 TCS BUY 10 3850.00`;

    const result = parseStatementText(raw);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].symbol).toBe('RELIANCE');
    expect(result.rows[0].type).toBe('BUY');
    expect(result.rows[0].quantity).toBe(25);
    expect(result.rows[0].price).toBe(1220.50);
  });

  it('handles empty or whitespace text gracefully', () => {
    const result = parseStatementText('   ');
    expect(result.rows).toHaveLength(0);
    expect(result.detectedType).toBe('unknown');
  });
});
