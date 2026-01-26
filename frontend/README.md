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
- `DEEPSEEK_API_KEY` - DeepSeek API key for AI agents
- `NEWS_API_KEY` - NewsAPI key for news fetching

**Important**: 
- Use actual values, not secret references
- API routes return HTTP 500 with clear error messages if keys are missing

## Vercel Deployment

### Configuration

- **Root Directory**: `/frontend`
- **Framework Preset**: Next.js (auto-detected)
- **Build Command**: `npm run build` (default)
- **Output Directory**: `.next` (default)

### Deployment Checklist

1. Set environment variables in Vercel dashboard
2. Configure root directory to `frontend`
3. Deploy and verify:
   - Build succeeds
   - Home page loads at `/`
   - API routes work correctly

### Error Handling

All API routes that require API keys will return HTTP 500 with clear messages:
- `{"error": "Missing DEEPSEEK_API_KEY"}` 
- `{"error": "Missing NEWS_API_KEY"}`

## Requirements

- Node.js 20+ (compatible with `@types/node: ^20`)
- Backend Python scripts generate data in `../runs/` directory
- For Vercel: Environment variables must be set in dashboard

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
