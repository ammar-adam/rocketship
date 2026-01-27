# RocketShip Frontend

Next.js 16 frontend for RocketShip stock discovery system. Optimized for Vercel deployment.

## Design System

**Strict institutional design - NO vibe coding**

- Analytical, calm, professional aesthetic
- One font family (Inter)
- Design tokens enforced via CSS variables (`src/styles/tokens.css`)
- No gradients, glows, or decorative animations
- Semantic colors for verdicts (BUY/HOLD/SELL)

## Structure

```
frontend/
├── app/                          # Next.js App Router
│   ├── api/                      # API routes
│   │   ├── debug/                # Debug endpoints
│   │   └── run/                  # Run management endpoints
│   ├── run/[runId]/              # Dynamic run pages
│   ├── setup/                    # Setup page
│   ├── layout.tsx                # Root layout
│   └── page.tsx                  # Home page
├── components/                   # React components
│   └── ui/                       # UI component library
├── lib/                          # Shared utilities
├── src/
│   ├── lib/                      # Server-side utilities
│   └── styles/                   # Design tokens
├── next.config.ts                # Next.js configuration
├── vercel.json                   # Vercel configuration
└── package.json                  # Dependencies
```

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Environment Variables

### Local Development

Create `frontend/.env.local`:

```env
DEEPSEEK_API_KEY=your-api-key-here
NEWS_API_KEY=your-news-api-key-here
```

### Vercel Deployment

Set environment variables in Vercel dashboard:
- `PY_BACKEND_URL` - **Required**: Fly.io backend URL (e.g., `https://rocketship-backend.fly.dev`)
- `DEEPSEEK_API_KEY` - DeepSeek API key (if using legacy local mode)
- `NEWS_API_KEY` - NewsAPI key (if using legacy local mode)
- `BLOB_READ_WRITE_TOKEN` - (Optional) Vercel Blob Storage token for persistent storage

**Important**: 
- Use actual values, not secret references
- API routes return HTTP 500 with clear error messages if keys are missing
- Without `BLOB_READ_WRITE_TOKEN`, storage uses `/tmp` (ephemeral, cleared between invocations)
- When `PY_BACKEND_URL` is set, frontend proxies all `/api/run/*` requests to the backend

## Vercel Deployment

### Configuration

- **Root Directory**: `/frontend`
- **Framework Preset**: Next.js (auto-detected)
- **Build Command**: `npm run build` (default)
- **Output Directory**: `.next` (default)

### Storage on Vercel

The application uses a storage abstraction layer (`src/lib/storage.ts`) that automatically adapts to Vercel's serverless environment:

**With `BLOB_READ_WRITE_TOKEN` (Recommended):**
- Uses Vercel Blob Storage for persistent, scalable storage
- Run artifacts persist across function invocations
- Best for production deployments

**Without `BLOB_READ_WRITE_TOKEN`:**
- Falls back to `/tmp/runs/{runId}/` directory
- Ephemeral storage (cleared between cold starts)
- Suitable for testing, but data may be lost

**Key Features:**
- ✅ No writes to read-only `/var/task` directory
- ✅ Automatic environment detection (`process.env.VERCEL === "1"`)
- ✅ All filesystem operations abstracted through storage layer
- ✅ Works seamlessly in both local and Vercel environments

### Deployment Checklist

1. Set environment variables in Vercel dashboard:
   - `DEEPSEEK_API_KEY` (required)
   - `NEWS_API_KEY` (required)
   - `BLOB_READ_WRITE_TOKEN` (optional, recommended)
2. Configure root directory to `frontend`
3. Deploy and verify:
   - Build succeeds
   - Home page loads at `/`
   - API routes work correctly
   - "Run RocketScore" creates runs successfully (check for ENOENT/mkdir errors)

### Error Handling

All API routes that require API keys will return HTTP 500 with clear messages:
- `{"error": "Missing DEEPSEEK_API_KEY"}` 
- `{"error": "Missing NEWS_API_KEY"}`

## Requirements

- Node.js 20+ (compatible with `@types/node: ^20`)
- **Backend**: Either:
  - Fly.io backend (recommended): Set `PY_BACKEND_URL` environment variable
  - Local Python scripts: Generate data in `../runs/` directory
- For Vercel: Environment variables must be set in dashboard

## Storage Architecture

All filesystem operations go through `src/lib/storage.ts`:

**Exported Functions:**
- `getRunsBasePath()` - Returns base path for runs (local: `../runs`, Vercel: `/tmp/runs` or blob)
- `ensureRunDir(runId)` - Creates run directory if needed
- `writeArtifact(runId, filename, contents)` - Write file to storage
- `readArtifact(runId, filename)` - Read file from storage
- `appendText(runId, filename, contents)` - Append to file (logs)
- `exists(runId, filename)` - Check if file exists
- `list(runId, prefix)` - List files in directory/prefix

**Storage Modes:**
- `filesystem` - Local development (writes to `../runs/`)
- `vercel-blob` - Vercel with blob token (persistent)
- `vercel-tmp` - Vercel without blob token (ephemeral `/tmp`)

## Build Verification

```bash
# Verify build succeeds
npm run build

# Expected output:
# ✓ Compiled successfully
# ✓ Generating static pages
# ✓ Build completed
```

## API Routes

- `POST /api/run` - Create new analysis run
- `GET /api/run/[runId]/status` - Get run status
- `GET /api/run/[runId]/events` - SSE event stream
- `POST /api/run/[runId]/debate` - Run debate stage
- `POST /api/run/[runId]/optimize` - Run portfolio optimization
- `GET /api/runs/[runId]/[...artifact]` - Serve run artifacts
- `GET /api/debug/keys` - Check API key status
- `GET /api/debug/deepseek` - Test DeepSeek connection
- `GET /api/debug/news` - Test NewsAPI connection
