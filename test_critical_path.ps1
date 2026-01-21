# Test script for RocketShip critical path (PowerShell)

Write-Host "=== RocketShip Critical Path Test ===" -ForegroundColor Green
Write-Host ""

# Check Python
Write-Host "✓ Checking Python..." -ForegroundColor Cyan
try {
    python --version
} catch {
    Write-Host "ERROR: Python not found" -ForegroundColor Red
    exit 1
}

# Check Node
Write-Host "✓ Checking Node..." -ForegroundColor Cyan
try {
    node --version
} catch {
    Write-Host "ERROR: Node not found" -ForegroundColor Red
    exit 1
}

# Check .env
Write-Host "✓ Checking .env..." -ForegroundColor Cyan
if (-not (Test-Path .env)) {
    Write-Host "WARNING: .env not found. Creating template..." -ForegroundColor Yellow
    @"
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
UNIVERSE=SP500_EX_MAG7
LOOKBACK_DAYS=252
TOP_N_CANDIDATES=25
"@ | Out-File -FilePath .env -Encoding UTF8
    Write-Host "  → Created .env template. Please add your API key." -ForegroundColor Yellow
}

# Check Python deps
Write-Host "✓ Checking Python dependencies..." -ForegroundColor Cyan
$pandas = pip show pandas 2>$null
if (-not $pandas) {
    Write-Host "ERROR: pandas not installed. Run: pip install -r requirements.txt" -ForegroundColor Red
    exit 1
}

# Check frontend deps
Write-Host "✓ Checking frontend dependencies..." -ForegroundColor Cyan
if (-not (Test-Path frontend/node_modules)) {
    Write-Host "  → Installing frontend dependencies..." -ForegroundColor Yellow
    Push-Location frontend
    npm install
    Pop-Location
}

# Create runs directory
Write-Host "✓ Creating runs directory..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path runs | Out-Null

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "To start the app:" -ForegroundColor White
Write-Host "  1. cd frontend" -ForegroundColor Gray
Write-Host "  2. npm run dev" -ForegroundColor Gray
Write-Host "  3. Open http://localhost:3000" -ForegroundColor Gray
Write-Host ""
Write-Host "Test checklist:" -ForegroundColor White
Write-Host "  ☐ Welcome page loads" -ForegroundColor Gray
Write-Host "  ☐ Click 'Start' → navigates to /setup" -ForegroundColor Gray
Write-Host "  ☐ Select S&P 500 or Import tickers" -ForegroundColor Gray
Write-Host "  ☐ Click 'Run RocketScore' → navigates to /run/{runId}/rocket" -ForegroundColor Gray
Write-Host "  ☐ See rocket animation + progress" -ForegroundColor Gray
Write-Host "  ☐ Auto-navigates to dashboard when complete" -ForegroundColor Gray
Write-Host "  ☐ Dashboard shows sortable table" -ForegroundColor Gray
Write-Host ""
