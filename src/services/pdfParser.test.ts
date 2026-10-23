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

  it('parses user Indian broker holding valuation statement with multi-line names and 11-column numeric rows', () => {
    const userSample = `Amrutanjan
Healt 2.00 1283.13 0.00 0.00 0.00 0.00 2.00 641.57 512.25 5.80 -258.63
Asian Paints 1.00 2510.49 0.00 0.00 0.00 0.00 1.00 2510.49 2325.70 0.00 -184.79
B P C L 6.00 1700.48 0.00 0.00 0.00 0.00 6.00 283.41 294.40 0.00 65.92
Bajaj Housing 214.00 14980.00 0.00 0.00 0.00 0.00 214.00 70.00 82.04 0.00 2576.56
Bata India 1.00 940.68 0.00 0.00 0.00 0.00 1.00 940.68 637.15 34.00 -303.53
Britannia Inds 1.00 5155.65 0.00 0.00 0.00 0.00 1.00 5155.65 4775.00 90.50 -380.65
City Union
Bank 1.00 223.11 0.00 0.00 0.00 0.00 1.00 223.11 229.26 2.00 6.15
Clean Science 1.00 1396.95 0.00 0.00 0.00 0.00 1.00 1396.95 771.00 4.00 -625.95
Coal India 8.00 3141.33 0.00 0.00 0.00 0.00 8.00 392.67 415.90 86.00 185.87
Colgate-
Palmoliv 1.00 2699.43 0.00 0.00 0.00 0.00 1.00 2699.43 1746.70 24.00 -952.73
Guj Pipavav
Port 2.00 322.70 0.00 0.00 0.00 0.00 2.00 161.35 167.81 0.00 12.92
HBL
Engineering 3.00 1628.11 0.00 0.00 0.00 0.00 3.00 542.70 802.50 3.00 779.39
Hind Unilever 2.00 4471.64 0.00 0.00 0.00 0.00 2.00 2235.82 1879.60 0.00 -712.44
I R C T C 16.00 10885.34 0.00 0.00 0.00 0.00 16.00 680.33 461.95 7.50 -3494.14
Indian Energy
Ex 1.00 104.52 0.00 0.00 0.00 0.00 1.00 104.52 106.15 0.00 1.63
ITC 31.00 11901.59 0.00 0.00 0.00 0.00 31.00 383.92 262.35 200.00 -3768.74
ITC Hotels 1.00 0.00 0.00 0.00 0.00 0.00 1.00 0.00 160.95 1.00 160.95
Kanchi
Karpooram 1.00 408.03 0.00 0.00 0.00 0.00 1.00 408.03 378.00 1.00 -30.03
Kwality Wall's 1.00 47.48 0.00 0.00 0.00 0.00 1.00 47.48 38.17 0.00 -9.31
LG Electronics 13.00 14820.00 0.00 0.00 0.00 0.00 13.00 1140.00 1706.00 0.00 7358.00
N S D L 2.00 1649.71 0.00 0.00 0.00 0.00 2.00 824.86 746.40 8.00 -156.91
Nestle India 2.00 2241.15 0.00 0.00 0.00 0.00 2.00 1120.58 1255.20 14.00 269.25
NTPC Green
Ene 2.00 236.83 0.00 0.00 0.00 0.00 2.00 118.42 89.24 0.00 -58.35
O N G C 1.00 236.18 0.00 0.00 0.00 0.00 1.00 236.18 224.77 1.00 -11.41
Ola Electric 5.00 418.54 0.00 0.00 0.00 0.00 5.00 83.71 34.82 0.00 -244.44
Patel
Engineerin 4.00 232.35 0.00 0.00 0.00 0.00 4.00 58.09 24.40 0.00 -134.75
Power Grid
Corpn 2.00 516.57 0.00 0.00 0.00 0.00 2.00 258.29 252.35 0.00 -11.87
Rane (Madras) 6.00 4960.20 0.00 0.00 0.00 0.00 6.00 826.70 1285.40 96.00 2752.20
Reliance
Industries 6.00 8361.56 0.00 0.00 0.00 0.00 6.00 1393.59 1222.30 30.00 -1027.76
Rites 7.00 1621.58 0.00 0.00 0.00 0.00 7.00 231.65 205.09 16.50 -185.95
Tata Consumer 16.00 16949.26 0.00 0.00 0.00 0.00 16.00 1059.33 967.60 160.00 -1467.66
Tata Technolog 18.00 15123.01 0.00 0.00 0.00 0.00 18.00 840.17 719.10 210.60 -2179.21
TCS 3.00 8644.01 0.00 0.00 0.00 0.00 3.00 2881.34 2475.70 165.00 -1216.91
VST Industries 5.00 1505.90 0.00 0.00 0.00 0.00 5.00 301.18 201.30 60.00 -499.40`;

    const result = parseStatementText(userSample);
    expect(result.detectedType).toBe('holdings');
    expect(result.rows).toHaveLength(34);

    // Verify first row (Amrutanjan)
    expect(result.rows[0].symbol).toBe('AMRUTANJAN');
    expect(result.rows[0].holdingQuantity).toBe(2);
    expect(result.rows[0].holdingRate).toBe(641.57);
    expect(result.rows[0].marketPrice).toBe(512.25);
    expect(result.rows[0].unrealizedPnL).toBe(-258.63);

    // Verify acronym normalization (B P C L -> BPCL)
    expect(result.rows[2].symbol).toBe('BPCL');
    expect(result.rows[2].holdingQuantity).toBe(6);

    // Verify multi-word (Bajaj Housing -> BAJAJHFL)
    expect(result.rows[3].symbol).toBe('BAJAJHFL');
    expect(result.rows[3].holdingQuantity).toBe(214);
    expect(result.rows[3].holdingRate).toBe(70);

    // Verify IRCTC
    const irctc = result.rows.find((r) => r.symbol === 'IRCTC');
    expect(irctc).toBeDefined();
    expect(irctc?.holdingQuantity).toBe(16);
    expect(irctc?.holdingRate).toBe(680.33);

    // Verify Reliance Industries
    const rel = result.rows.find((r) => r.symbol === 'RELIANCE');
    expect(rel).toBeDefined();
    expect(rel?.holdingQuantity).toBe(6);
    expect(rel?.holdingRate).toBe(1393.59);

    // Verify summary
    expect(result.holdingsSummary).toBeDefined();
    expect(result.holdingsSummary?.totalHoldings).toBe(34);
    expect(result.holdingsSummary?.totalInvested).toBeGreaterThan(100000);
  });
});
