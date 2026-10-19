import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Configure PDF.js worker
 * In browser bundlers (Vite), we can use the bundled worker or disable worker to run in main thread safely
 */
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  // Use unpkg/cdnjs worker fallback or standard worker src
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '4.10.38'}/pdf.worker.min.mjs`;
}

export interface ExtractedPdfResult {
  text: string;
  pagesCount: number;
  lines: string[];
}

/**
 * Extract clean text line-by-line from a PDF file or ArrayBuffer
 * Supports password-protected PDFs (common in Indian broker contract notes and CAS statements)
 */
export async function extractTextFromPdf(
  source: File | ArrayBuffer,
  password?: string
): Promise<ExtractedPdfResult> {
  let arrayBuffer: ArrayBuffer;
  if (source instanceof File) {
    arrayBuffer = await source.arrayBuffer();
  } else {
    arrayBuffer = source;
  }

  try {
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      password: password || undefined,
      useSystemFonts: true,
    });

    const pdf = await loadingTask.promise;
    const pagesCount = pdf.numPages;
    const allLines: string[] = [];

    for (let pageNum = 1; pageNum <= pagesCount; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const items = textContent.items as Array<{
        str: string;
        transform: number[];
        width?: number;
        height?: number;
      }>;

      // Group text items by their vertical position (Y coordinate) with 4px tolerance
      const rowMap = new Map<number, Array<{ x: number; text: string }>>();

      for (const item of items) {
        if (!item.str || item.str.trim().length === 0) continue;
        const x = item.transform[4];
        const y = Math.round(item.transform[5]);

        // Find existing row within 3px
        let foundY: number | null = null;
        for (const existingY of rowMap.keys()) {
          if (Math.abs(existingY - y) <= 3) {
            foundY = existingY;
            break;
          }
        }

        const targetY = foundY !== null ? foundY : y;
        if (!rowMap.has(targetY)) {
          rowMap.set(targetY, []);
        }
        rowMap.get(targetY)!.push({ x, text: item.str.trim() });
      }

      // Sort rows top-to-bottom (PDF Y starts at bottom, so higher Y is higher on page)
      const sortedYs = Array.from(rowMap.keys()).sort((a, b) => b - a);

      for (const y of sortedYs) {
        const rowItems = rowMap.get(y)!;
        // Sort items left-to-right (ascending X)
        rowItems.sort((a, b) => a.x - b.x);
        const line = rowItems.map((item) => item.text).join('\t');
        if (line.trim().length > 0) {
          allLines.push(line);
        }
      }
    }

    return {
      text: allLines.join('\n'),
      pagesCount,
      lines: allLines,
    };
  } catch (err: any) {
    if (err?.name === 'PasswordException' || err?.message?.toLowerCase().includes('password')) {
      throw new Error('PASSWORD_REQUIRED');
    }
    throw err;
  }
}

/**
 * Parses raw text extracted from PDF or pasted by user from Indian broker statements / CAS
 * Identifies columns: Symbol/Name, Date, Type (Buy/Sell), Qty, Price, Amount
 */
export function parseStatementText(
  rawText: string
): {
  rows: Record<string, any>[];
  detectedColumns: string[];
  detectedType: 'transactions' | 'stocks' | 'unknown';
} {
  if (!rawText || rawText.trim().length === 0) {
    return { rows: [], detectedColumns: [], detectedType: 'unknown' };
  }

  const rawLines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    return { rows: [], detectedColumns: [], detectedType: 'unknown' };
  }

  // 1. Identify delimiter for lines (Tab or comma or pipe or multi-space)
  const rows: Record<string, any>[] = [];
  let headerIndex = -1;
  let headers: string[] = [];

  // Keywords that indicate transaction headers
  const txKeywords = ['symbol', 'stock', 'scrip', 'company', 'date', 'trade date', 'type', 'buy/sell', 'quantity', 'qty', 'price', 'rate', 'amount'];
  const holdingsKeywords = ['symbol', 'stock', 'isin', 'holding', 'quantity', 'shares', 'avg cost', 'current price', 'invested'];

  for (let i = 0; i < Math.min(rawLines.length, 15); i++) {
    const line = rawLines[i].toLowerCase();
    const tabParts = rawLines[i].split('\t').map((s) => s.trim()).filter(Boolean);
    const commaParts = rawLines[i].split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    const parts = tabParts.length > 2 ? tabParts : commaParts.length > 2 ? commaParts : line.split(/\s{2,}/);

    const matchTxCount = parts.filter((p) => txKeywords.some((k) => p.toLowerCase().includes(k))).length;
    const matchHoldCount = parts.filter((p) => holdingsKeywords.some((k) => p.toLowerCase().includes(k))).length;

    if (matchTxCount >= 3 || matchHoldCount >= 3) {
      headerIndex = i;
      headers = parts.map((p, idx) => p.trim() || `col_${idx + 1}`);
      break;
    }
  }

  // If header found, parse subsequent lines
  if (headerIndex !== -1 && headers.length > 0) {
    for (let i = headerIndex + 1; i < rawLines.length; i++) {
      const line = rawLines[i];
      const tabParts = line.split('\t').map((s) => s.trim());
      const commaParts = line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      const parts = tabParts.length >= headers.length / 2 ? tabParts : commaParts.length >= headers.length / 2 ? commaParts : line.split(/\s{2,}/);

      if (parts.length >= 2) {
        const rowObj: Record<string, any> = {};
        headers.forEach((h, idx) => {
          rowObj[h] = parts[idx] !== undefined ? parts[idx] : '';
        });
        rows.push(rowObj);
      }
    }
  } else {
    // Fallback: Line-by-line pattern detection (Regex for Indian dates + ticker + buy/sell + qty + rate)
    // Common pattern: [DATE] [SYMBOL] [BUY/SELL] [QTY] [PRICE]
    const dateRegex = /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/i;
    const typeRegex = /\b(BUY|SELL|B|S)\b/i;
    const numberRegex = /\b\d+(?:,\d+)*(?:\.\d+)?\b/g;

    for (const line of rawLines) {
      const dateMatch = line.match(dateRegex);
      if (!dateMatch) continue;

      const typeMatch = line.match(typeRegex);
      const lineWithoutDate = line.replace(dateMatch[0], '');
      const numbers = lineWithoutDate.match(numberRegex);

      if (numbers && numbers.length >= 2) {
        // Extract symbol (uppercase letters 2-15 chars)
        const words = lineWithoutDate
          .replace(typeMatch ? typeMatch[0] : '', '')
          .split(/[\t,\s]+/)
          .filter((w) => /^[A-Z0-9&-]{2,15}$/.test(w) && !/^\d+$/.test(w) && !['EQ', 'NSE', 'BSE', 'NSI'].includes(w));

        const symbol = words[0] || 'STOCK';
        const cleanNumbers = numbers.map((n) => parseFloat(n.replace(/,/g, ''))).filter((n) => !isNaN(n));

        if (cleanNumbers.length >= 2) {
          // Generally smaller integer number is Qty, larger decimal is Price
          let qty = cleanNumbers[0];
          let price = cleanNumbers[1];

          if (Number.isInteger(cleanNumbers[0]) && cleanNumbers[1] > cleanNumbers[0] * 5) {
            qty = cleanNumbers[0];
            price = cleanNumbers[1];
          } else if (Number.isInteger(cleanNumbers[1]) && cleanNumbers[0] > cleanNumbers[1] * 5) {
            qty = cleanNumbers[1];
            price = cleanNumbers[0];
          }

          rows.push({
            symbol,
            date: dateMatch[0],
            type: typeMatch ? (typeMatch[1].toUpperCase().startsWith('B') ? 'BUY' : 'SELL') : 'BUY',
            quantity: qty,
            price: price,
          });
        }
      }
    }

    if (rows.length > 0) {
      headers = ['symbol', 'date', 'type', 'quantity', 'price'];
    }
  }

  // Detect type
  const headerStr = headers.join(' ').toLowerCase();
  const detectedType =
    headerStr.includes('date') || headerStr.includes('type') || headerStr.includes('buy')
      ? 'transactions'
      : 'stocks';

  return {
    rows,
    detectedColumns: headers,
    detectedType,
  };
}
