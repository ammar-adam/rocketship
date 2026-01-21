# RocketShip Frontend

Next.js 14 frontend for RocketShip stock discovery system.

## Design System

**Strict institutional design - NO vibe coding**

- Analytical, calm, professional aesthetic
- One font family (Inter)
- Design tokens enforced via Tailwind config
- No gradients, glows, or decorative animations
- Semantic colors for verdicts (ENTER/WAIT/KILL)

## Structure

```
frontend/
├── app/
│   ├── api/runs/latest/route.ts  # API endpoint to fetch latest run
│   ├── layout.tsx                 # Root layout
│   └── page.tsx                   # Dashboard (main page)
├── components/
│   └── StockCard.tsx              # Stock card component
├── lib/
│   ├── api.ts                     # API client functions
│   └── types.ts                   # TypeScript interfaces
└── tailwind.config.ts             # Design system tokens
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

## Requirements

Backend must be run first to generate data in `../runs/` directory.

## Environment Variables

None required for local development. API reads from filesystem.
