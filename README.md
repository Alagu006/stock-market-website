# Dalal Diary's 📈

> **Personal Long-Term Indian Stock Portfolio Tracker for NSE / BSE Equity Investing**

A high-performance, dark-themed, mobile-responsive equity portfolio tracker designed for disciplined Indian investors. Built on local-first principles—100% of data lives in your browser's IndexedDB. No broker login, no third-party cloud sync, no tracking, and zero latency.

---

## ⚡ Core Philosophy

1. **Local-First & Private:** All data lives exclusively inside browser IndexedDB via Dexie. No backend required for Phases 1–5.
2. **Raw Facts Only:** The database stores strictly raw immutable events: stock master records, buy/sell transactions, manual prices, corporate actions, and dividends. Average prices, cost bases, realized and unrealized P&L, yields, and portfolio values are dynamically calculated live on-the-fly.
3. **Instant Global Cost Method Recalculation:** Switch between **Average Cost** and **FIFO** seamlessly in the top bar. Switching instantly recalculates:
   - Realized P&L per sell
   - Remaining cost basis & average buy price per holding
   - Unrealized P&L (₹ and %)
   - Portfolio totals & Yield on Cost
   - Reverse target-average dip planner
   - Lot history & tranche consumption
4. **Stale Price Protection:** Every price entry tracks its timestamp. Any price older than 7 days displays a visible amber `Stale` warning.
5. **Decoupled Calculation Engine:** All financial arithmetic is isolated in pure, framework-agnostic TypeScript functions with unit test coverage.

---

## 🚀 Features (Phase 1: Portfolio Core)

- **Stock Master List:** Add, edit, and delete stocks with NSE symbols, BSE 6-digit security codes, company names, sectors, and market-cap categories.
- **Manual Price Tracking:** Record dated prices per stock; maintains historical price records for portfolio trends.
- **Add BUY/SELL Form with Live 4-Card Preview:**
  1. *Existing Position:* Current shares, average price, invested capital.
  2. *This Transaction:* Action type, quantity, execution price, net cash outlay.
  3. *Post-Entry Average:* Projected average buy price and difference vs old (`+/- ₹`).
  4. *Post-Entry Position:* Resulting shares, invested capital, current market value, and unrealized P&L.
- **Strict Sell Validation:** Blocks any SELL exceeding the shares held on that transaction date, accounting for historical splits and bonuses.
- **Dashboard KPI Cards:**
  - Total Invested (Cost Basis)
  - Current Portfolio Market Value (with change since previous price entry)
  - Unrealized P&L (₹ and %)
  - Realized P&L from booked sales
  - Annual Dividend Income & Yield on Cost (YoC %)
  - Portfolio Quality Metrics (Value-weighted ROCE and Weighted P/E)
- **Holdings Table:** Real-time holdings breakdown with Indian currency formatting (`₹`, Lakhs, Crores), BSE codes, lot counts, average prices, manual prices, stale warnings, ROCE, P/E, and action menus.
- **Lot History Modal:** Per-stock tranche inspector. Shows running weighted average under *Average Cost*, or specific lot consumption details and remaining lot shares under *FIFO*. Includes individual transaction deletion.
- **Reverse Target-Average ("Buy the Dip") Calculator:**
  - Formula: $\text{Shares} = \left\lceil \frac{\text{CurrentQty} \times (\text{CurrentAvg} - \text{TargetAvg})}{\text{TargetAvg} - \text{PlannedPrice}} \right\rceil$
  - Validates that planned price < target average < current average.
  - "Pre-fill Buy Form" button sends exact shares and dip price directly to the transaction form.
- **Sector Diversification & Allocation:** Visual progress bars for sector distribution, automatically flagging any sector exceeding 35% concentration.
- **Backup & Restore:** One-click JSON export of all database tables, JSON restore with file preview and confirmation step, and an automated alert badge if the last backup is older than 14 days.

---

## 🛠️ Technology Stack

- **Framework:** React 19 + TypeScript + Vite 8
- **Styling:** Tailwind CSS v4 + Dark Theme tailored palette
- **Local Database:** Dexie.js (IndexedDB wrapper) + `dexie-react-hooks`
- **Testing:** Vitest
- **Icons:** Lucide React
- **Export / Import:** SheetJS (`xlsx`) & Native JSON

---

## 💻 Local Development Setup

### Prerequisites
- Node.js (v18 or higher recommended)
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/<your-username>/dalal-diarys.git
cd dalal-diarys

# Install dependencies
npm install

# Run Vitest test suite
npm test

# Start the Vite local development server
npm run dev
```

Visit `http://localhost:5173` (or the port indicated in your terminal) in your browser.

---

## 🧪 Running Unit Tests

Dalal Diary's includes tests covering:
- Weighted average calculations
- FIFO lot matching and tranche tracking
- Realized P&L under both Average Cost and FIFO methods
- Invariance of realized profit on fully liquidated stocks
- Splits and bonuses applied strictly across pre-ex-date lots
- Reverse target-average formula with ceiling rounding
- XIRR calculation via Newton-Raphson cashflows
- Tax lot classification (STCG $\le 365$ days vs LTCG $> 365$ days)
- Oversell transaction blocking

```bash
npx vitest run
```

---

## 🌐 Deploying to Render as a Static Site

Dalal Diary's compiles into static HTML/CSS/JS and runs client-side without a backend server, making it suited for free, fast static hosting on Render.

### Step-by-Step Render Deployment Guide

1. **Push your code to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "feat: complete Dalal Diary Phase 1 Portfolio Core"
   git branch -M main
   git remote add origin https://github.com/<your-username>/dalal-diarys.git
   git push -u origin main
   ```

2. **Create a Static Site on Render:**
   - Log in to your [Render Dashboard](https://dashboard.render.com/).
   - Click **New +** and select **Static Site**.
   - Connect your GitHub repository (`dalal-diarys`).

3. **Configure Build Settings:**
   | Setting | Value |
   | :--- | :--- |
   | **Name** | `dalal-diarys` (or your choice) |
   | **Branch** | `main` |
   | **Build Command** | `npm install && npm run build` |
   | **Publish Directory** | `dist` |

4. **Add Rewrite Rule (Single Page App Routing):**
   - In your Render static site dashboard, navigate to **Redirects / Rewrites**.
   - Add a rewrite rule:
     - **Source:** `/*`
     - **Destination:** `/index.html`
     - **Action:** `Rewrite`
   - This ensures full-page refreshes always serve the SPA.

5. **Deploy:**
   - Click **Create Static Site**.
   - Render will build and deploy your site within 1–2 minutes, providing a live HTTPS URL (e.g. `https://dalal-diarys.onrender.com`).

---

## 💾 Backup and Restore Instructions

Because Dalal Diary's stores data in your browser's IndexedDB, clearing your browser cookies/site data or switching devices will start with a fresh database unless backed up.

### Creating a Backup
1. Click the **Backup** button in the top navigation bar.
2. Under **One-Click JSON Export**, click **Download Backup**.
3. A timestamped file named `dalal-diarys-backup-YYYY-MM-DD.json` will be saved to your Downloads folder.
4. Keep this file in a safe folder or cloud drive (Google Drive, iCloud, Dropbox).
5. The top bar backup alert badge will reset. If 14 days pass without an export, an alert badge will remind you to back up.

### Restoring from Backup
1. Click the **Backup** button in the top navigation bar.
2. Under **Restore from Backup**, click **Choose JSON Backup File** and select your `.json` backup file.
3. Review the preview confirmation showing the backup date and record counts.
4. Click **Yes, Restore Backup** to restore your portfolio.

---

## 📋 Project Roadmap

- [x] **Phase 1: Portfolio Core** *(Stock master list, manual prices, live 4-card preview, KPI dashboard, holdings table, lot history, Reverse Target-Average calculator, sector allocation, JSON backup/restore)*
- [ ] **Phase 2: Excel / CSV Import & Export** *(BSE/NSE stock importer, transaction importer, Screener.in mapping & fundamentals parser, Excel/CSV multi-sheet exporter)*
- [ ] **Phase 3: Analysis** *(Fundamental X-Ray 12-metric grid, 52W range bar, Coffee Can / Undervalued / Dividend scanners, passive alert badges)*
- [ ] **Phase 4: Returns, Tax & Dividends** *(XIRR, benchmark vs Nifty 50, FY realized P&L, Budget 2024 STCG/LTCG tax view with grandfathering, dividend calendar & corporate action management)*
- [ ] **Phase 5: Planning Tools** *(Buy-Zone Watchlist, SIP + Lump Sum + DRIP multi-year simulator)*
- [ ] **Phase 6: Optional Cloud Sync** *(Optional Supabase local-first sync between phone and laptop)*
