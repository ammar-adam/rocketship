#!/bin/bash
# Test script for RocketShip critical path

set -e

echo "=== RocketShip Critical Path Test ==="
echo ""

# Check Python
echo "✓ Checking Python..."
python --version || { echo "ERROR: Python not found"; exit 1; }

# Check Node
echo "✓ Checking Node..."
node --version || { echo "ERROR: Node not found"; exit 1; }

# Check .env
echo "✓ Checking .env..."
if [ ! -f .env ]; then
    echo "WARNING: .env not found. Creating template..."
    cat > .env << EOF
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
UNIVERSE=SP500_EX_MAG7
LOOKBACK_DAYS=252
TOP_N_CANDIDATES=25
EOF
    echo "  → Created .env template. Please add your API key."
fi

# Check Python deps
echo "✓ Checking Python dependencies..."
pip show pandas > /dev/null 2>&1 || { echo "ERROR: pandas not installed. Run: pip install -r requirements.txt"; exit 1; }

# Check frontend deps
echo "✓ Checking frontend dependencies..."
if [ ! -d frontend/node_modules ]; then
    echo "  → Installing frontend dependencies..."
    cd frontend && npm install && cd ..
fi

# Create runs directory
echo "✓ Creating runs directory..."
mkdir -p runs

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To start the app:"
echo "  1. cd frontend"
echo "  2. npm run dev"
echo "  3. Open http://localhost:3000"
echo ""
echo "Test checklist:"
echo "  ☐ Welcome page loads"
echo "  ☐ Click 'Start' → navigates to /setup"
echo "  ☐ Select S&P 500 or Import tickers"
echo "  ☐ Click 'Run RocketScore' → navigates to /run/{runId}/rocket"
echo "  ☐ See rocket animation + progress"
echo "  ☐ Auto-navigates to dashboard when complete"
echo "  ☐ Dashboard shows sortable table"
echo ""
