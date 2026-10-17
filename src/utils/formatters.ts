/**
 * Formats a number to Indian numbering system (e.g., 12,34,567.89 or ₹ 12.34 L / Cr)
 */
export function formatINR(val: number | null | undefined, options?: { decimals?: number; showSymbol?: boolean; compact?: boolean }): string {
  if (val === null || val === undefined || isNaN(val)) return '—';
  
  const { decimals = 2, showSymbol = true, compact = false } = options || {};
  const symbol = showSymbol ? '₹ ' : '';
  const isNegative = val < 0;
  const absVal = Math.abs(val);

  if (compact) {
    if (absVal >= 10000000) {
      // Crores
      const cr = absVal / 10000000;
      return `${isNegative ? '-' : ''}${symbol}${cr.toFixed(decimals)} Cr`;
    }
    if (absVal >= 100000) {
      // Lakhs
      const lk = absVal / 100000;
      return `${isNegative ? '-' : ''}${symbol}${lk.toFixed(decimals)} L`;
    }
  }

  // Format with standard Indian commas
  const fixedStr = absVal.toFixed(decimals);
  const [intPart, decPart] = fixedStr.split('.');
  
  let lastThree = intPart.slice(-3);
  const otherNumbers = intPart.slice(0, -3);
  if (otherNumbers !== '') {
    lastThree = ',' + lastThree;
  }
  const formattedInt = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;
  
  const result = decPart !== undefined && decimals > 0 ? `${formattedInt}.${decPart}` : formattedInt;
  return `${isNegative ? '-' : ''}${symbol}${result}`;
}

export function formatPercent(val: number | null | undefined, decimals: number = 2): string {
  if (val === null || val === undefined || isNaN(val)) return '—';
  const prefix = val > 0 ? '+' : '';
  return `${prefix}${val.toFixed(decimals)}%`;
}

/**
 * Format date string YYYY-MM-DD or ISO to DD-MM-YYYY
 */
export function formatDateDDMMYYYY(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const parts = dateStr.split('T')[0].split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts;
      return `${day.padStart(2, '0')}-${month.padStart(2, '0')}-${year}`;
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return dateStr;
  }
}

/**
 * Check if a date string is older than specified days (default 7 days)
 */
export function isDateOlderThanDays(dateStr: string | null | undefined, days: number = 7): boolean {
  if (!dateStr) return true;
  try {
    const targetDate = new Date(dateStr);
    if (isNaN(targetDate.getTime())) return true;
    
    // Normalize to date-only
    const now = new Date();
    const diffMs = now.getTime() - targetDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays > days;
  } catch {
    return true;
  }
}

/**
 * Format relative time (e.g. "Today", "Yesterday", "3 days ago")
 */
export function formatDaysAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return 'No price recorded';
  try {
    const target = new Date(dateStr);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - target.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays} days ago`;
  } catch {
    return dateStr;
  }
}

/**
 * Determine Financial Year string (e.g., "FY 2024-25") for a given date
 * Indian FY starts 1st April and ends 31st March
 */
export function getFinancialYear(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'Unknown FY';
  const month = d.getMonth() + 1; // 1-12
  const year = d.getFullYear();
  if (month >= 4) {
    const nextYearShort = String(year + 1).slice(-2);
    return `FY ${year}-${nextYearShort}`;
  } else {
    const currYearShort = String(year).slice(-2);
    return `FY ${year - 1}-${currYearShort}`;
  }
}
