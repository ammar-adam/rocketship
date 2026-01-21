# RocketShip Frontend Architecture

## Architecture Fixes Implemented

### Problem Statement
- Frontend showed "Invalid Date" for run timestamps
- Stock detail links were broken
- No resilience to schema drift or missing files
- Case-sensitive filesystem issues on Ubuntu

### Solution Overview

Created a robust server-side data layer that handles:
1. Schema drift across different run outputs
2. Missing files (graceful degradation)
3. Case-insensitive ticker lookups
4. Invalid date formats
5. Multiple data source locations (stocks folder vs summary file)

## Core Components

### 1. `src/lib/runStore.ts` (Server-Only)

**Purpose:** Single source of truth for all filesystem operations.

**Key Functions:**

- `getRuns()`: Lists all run directories, sorted newest-first
- `resolveRunFiles(runId)`: Detects which files exist in a run
- `safeReadJson(path)`: Safe JSON reading with error handling
- `listStocks(runId)`: Returns all stocks with normalized schema
- `getStock(runId, ticker)`: Case-insensitive single stock lookup
- `normalizeStock(raw)`: Handles schema variations across different runs

**Schema Normalization:**
```typescript
// Handles multiple field name variations:
ticker: raw.ticker || raw.symbol || raw.TICKER
rocketScore: raw.rocket_score || raw.rocketScore || raw.score
verdict: raw.judge?.verdict || raw.verdict
sector: raw.sector || raw.SECTOR || raw.industry
```

**Data Sources (Priority Order):**
1. `/stocks/{ticker}.json` - Individual files (case-insensitive match)
2. `/top_25.json` - Summary array fallback

**Diagnostic Information:**
Each stock includes `_diagnostic` metadata:
- `source`: "file" or "summary"
- `loadedPath`: Actual file path loaded
- `availableKeys`: All JSON keys available

### 2. Routing Structure

**Fixed Routes:**
- `/` - Dashboard (shows latest run)
- `/run/[runId]/stock/[ticker]` - Stock detail page

**Previous broken routes:**
- `/stock/[ticker]` ❌ (missing runId context)

**Why this matters:**
- Multiple runs can exist simultaneously
- Each run may have different data schemas
- RunId provides context for which data version to load

### 3. Date Formatting Fix

**Problem:**
```typescript
// Failed on invalid timestamps
new Date(runId).toLocaleString() // "Invalid Date"
```

**Solution:**
```typescript
function formatRunId(runId: string): string {
  // Try to parse YYYYMMDD_HHMMSS format
  const match = runId.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
    if (!isNaN(date.getTime())) {
      return date.toLocaleString();
    }
  }
  // Fallback: return runId as-is
  return runId;
}
```

### 4. Error States

**Graceful Degradation Hierarchy:**

1. **No runs directory** → "No Data Available" message
2. **Empty runs directory** → "No Data Available" message  
3. **Run exists but no stocks** → "Run Found But No Data"
4. **Stock not found** → "Stock Not Found" with back link
5. **Invalid JSON** → Returns null, logs error, continues

**Error Boundaries:**
- Each page handles its own null/undefined states
- No cascading failures
- User always has a way to navigate back

## Case-Insensitive Ticker Lookup

**Ubuntu Filesystem Issue:**
- Filenames may be `AMD.json`, `amd.json`, or `Amd.json`
- URL params preserve user input: `/stock/amd` or `/stock/AMD`

**Solution:**
```typescript
const tickerLower = ticker.toLowerCase();
const files = fs.readdirSync(stocksPath);
const matchingFile = files.find(f => {
  const baseName = f.replace('.json', '').toLowerCase();
  return baseName === tickerLower;
});
```

## Data Flow

### Dashboard Load
```
1. getRuns() → ["20260120_222752", ...]
2. getRunSummary(latestRunId)
   ↓
3. resolveRunFiles(runId) → metadata
4. listStocks(runId)
   ↓ Try stocks folder first
   ├─ /stocks/{ticker}.json exists → load individual files
   └─ /stocks/ missing → load from top_25.json
5. normalizeStock(raw) for each → StockData[]
6. Render stock cards with normalized data
```

### Stock Detail Load
```
1. Extract runId and ticker from URL params
2. resolveRunFiles(runId) → validate run exists
3. getStock(runId, ticker) → case-insensitive lookup
   ↓
4. Try /stocks/{ticker}.json (case-insensitive)
5. Fallback to top_25.json array search
6. normalizeStock(raw)
7. Render detail page with all available fields
```

## Key Architectural Decisions

### 1. Server-Only Data Access
**Why:** Filesystem operations must never run in browser
- Marked with `import 'server-only'`
- All data access in server components or API routes

### 2. No Backend API Server
**Why:** Simplicity, no deployment complexity
- Next.js API routes for any future endpoints
- Direct filesystem access in server components

### 3. No Auth/User Management
**Why:** Research tool, not production app
- Read-only access to run data
- No user-specific data

### 4. Diagnostic Metadata
**Why:** Debug schema drift without looking at files
```json
{
  "_diagnostic": {
    "source": "file",
    "loadedPath": "/runs/xxx/stocks/AMD.json",
    "availableKeys": ["ticker", "rocket_score", "judge", ...]
  }
}
```

## Testing Checklist

- [ ] Dashboard loads with existing runs
- [ ] Date formats correctly or shows runId
- [ ] Stock cards link to `/run/{runId}/stock/{ticker}`
- [ ] Stock detail page loads with case-insensitive ticker
- [ ] Stock detail shows diagnostic info
- [ ] Missing stock shows error with back link
- [ ] No runs shows "No Data Available"
- [ ] Handles missing /stocks folder (uses top_25.json)
- [ ] Handles malformed JSON (logs error, continues)

## Future Enhancements

### Potential Additions (Not Implemented)
- Memo display (read from /memos/{ticker}.md)
- Portfolio view (read from portfolio.csv)
- Run comparison
- Search/filter stocks
- Export functionality

### Anti-Patterns to Avoid
- ❌ Don't add auth unless required
- ❌ Don't create separate backend server
- ❌ Don't use client-side filesystem access
- ❌ Don't hardcode schema assumptions
- ❌ Don't fail on missing fields

## Deployment Notes

### Environment
- Next.js runs in Node.js environment
- Has filesystem access to `../runs/` directory
- No database required
- No external API calls

### Build
```bash
npm run build
npm start  # Production server
```

### Development
```bash
npm run dev  # http://localhost:3000
```

## Files Changed

- ✅ `src/lib/runStore.ts` - New data layer (server-only)
- ✅ `app/page.tsx` - Updated to use runStore
- ✅ `components/StockCard.tsx` - Fixed routing with runId
- ✅ `app/run/[runId]/stock/[ticker]/page.tsx` - New stock detail page
- ✅ `app/run/[runId]/stock/[ticker]/not-found.tsx` - Error page
- ✅ `lib/api.ts` - Kept for future use (not currently used)

## Files NOT Changed

- Backend Python code (as required)
- Output formats in `/runs/` directory
- Tailwind config (design system preserved)
- Any UI components beyond minimal fixes
