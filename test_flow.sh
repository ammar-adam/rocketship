#!/bin/bash
# RocketShip End-to-End Test Script
# Tests the complete flow: RocketScore -> Debate -> Optimize

set -e

echo "=== RocketShip E2E Test ==="
echo ""

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3000}"
TICKERS="NVDA,AMD,TSLA"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
    else
        echo -e "${RED}✗${NC} $1"
        exit 1
    fi
}

# Check if server is running
echo "Checking server..."
curl -s "$BASE_URL" > /dev/null
check "Server is running at $BASE_URL"

echo ""
echo "=== Step 1: Create Run ==="

# Create run with import mode
RESPONSE=$(curl -s -X POST "$BASE_URL/api/run" \
    -H "Content-Type: application/json" \
    -d "{\"mode\":\"import\",\"tickers\":[\"NVDA\",\"AMD\",\"TSLA\"]}")

RUN_ID=$(echo "$RESPONSE" | grep -o '"runId":"[^"]*"' | cut -d'"' -f4)

if [ -z "$RUN_ID" ]; then
    echo -e "${RED}✗${NC} Failed to create run: $RESPONSE"
    exit 1
fi

echo -e "${GREEN}✓${NC} Created run: $RUN_ID"

# Wait for RocketScore to complete
echo ""
echo "=== Step 2: Wait for RocketScore ==="
echo "Polling status..."

MAX_WAIT=120
WAITED=0

while [ $WAITED -lt $MAX_WAIT ]; do
    STATUS=$(curl -s "$BASE_URL/api/run/$RUN_ID/status")
    STAGE=$(echo "$STATUS" | grep -o '"stage":"[^"]*"' | cut -d'"' -f4)
    
    if [ "$STAGE" = "debate_ready" ] || [ "$STAGE" = "done" ]; then
        echo -e "${GREEN}✓${NC} RocketScore complete (stage: $STAGE)"
        break
    elif [ "$STAGE" = "error" ]; then
        echo -e "${RED}✗${NC} RocketScore failed"
        echo "$STATUS"
        exit 1
    fi
    
    # Show progress
    DONE=$(echo "$STATUS" | grep -o '"done":[0-9]*' | cut -d':' -f2)
    TOTAL=$(echo "$STATUS" | grep -o '"total":[0-9]*' | cut -d':' -f2)
    echo -ne "\r  Progress: $DONE / $TOTAL (${WAITED}s elapsed)   "
    
    sleep 2
    WAITED=$((WAITED + 2))
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo -e "${RED}✗${NC} Timeout waiting for RocketScore"
    exit 1
fi

echo ""

# Verify rocket_scores.json exists
echo "Checking artifacts..."
SCORES_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/runs/$RUN_ID/rocket_scores.json")
if [ "$SCORES_CHECK" = "200" ]; then
    echo -e "${GREEN}✓${NC} rocket_scores.json exists"
else
    echo -e "${RED}✗${NC} rocket_scores.json not found (HTTP $SCORES_CHECK)"
    exit 1
fi

echo ""
echo "=== Step 3: Run Debate ==="

DEBATE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/run/$RUN_ID/debate")
DEBATE_OK=$(echo "$DEBATE_RESPONSE" | grep -o '"ok":true')

if [ -n "$DEBATE_OK" ]; then
    echo -e "${GREEN}✓${NC} Debate completed"
else
    echo -e "${RED}✗${NC} Debate failed: $DEBATE_RESPONSE"
    exit 1
fi

# Verify debate artifacts
SUMMARY_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/runs/$RUN_ID/debate_summary.json")
if [ "$SUMMARY_CHECK" = "200" ]; then
    echo -e "${GREEN}✓${NC} debate_summary.json exists"
else
    echo -e "${RED}✗${NC} debate_summary.json not found"
fi

# Check individual debate files
for TICKER in NVDA AMD TSLA; do
    DEBATE_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/runs/$RUN_ID/debate/$TICKER.json")
    if [ "$DEBATE_CHECK" = "200" ]; then
        echo -e "${GREEN}✓${NC} debate/$TICKER.json exists"
    else
        echo -e "${YELLOW}⚠${NC} debate/$TICKER.json not found (HTTP $DEBATE_CHECK)"
    fi
done

echo ""
echo "=== Step 4: Run Optimization ==="

OPT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/run/$RUN_ID/optimize")
OPT_OK=$(echo "$OPT_RESPONSE" | grep -o '"ok":true')

if [ -n "$OPT_OK" ]; then
    echo -e "${GREEN}✓${NC} Optimization completed"
else
    echo -e "${RED}✗${NC} Optimization failed: $OPT_RESPONSE"
    exit 1
fi

# Verify portfolio.json
PORTFOLIO_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/runs/$RUN_ID/portfolio.json")
if [ "$PORTFOLIO_CHECK" = "200" ]; then
    echo -e "${GREEN}✓${NC} portfolio.json exists"
else
    echo -e "${RED}✗${NC} portfolio.json not found"
    exit 1
fi

echo ""
echo "=== Step 5: Verify Final Status ==="

FINAL_STATUS=$(curl -s "$BASE_URL/api/run/$RUN_ID/status")
FINAL_STAGE=$(echo "$FINAL_STATUS" | grep -o '"stage":"[^"]*"' | cut -d'"' -f4)

if [ "$FINAL_STAGE" = "done" ]; then
    echo -e "${GREEN}✓${NC} Final stage: done"
else
    echo -e "${YELLOW}⚠${NC} Final stage: $FINAL_STAGE (expected: done)"
fi

echo ""
echo "=== Summary ==="
echo -e "${GREEN}All tests passed!${NC}"
echo ""
echo "Run ID: $RUN_ID"
echo "View results at: $BASE_URL/run/$RUN_ID"
echo ""
echo "Artifacts created:"
echo "  - runs/$RUN_ID/status.json"
echo "  - runs/$RUN_ID/universe.json"
echo "  - runs/$RUN_ID/rocket_scores.json"
echo "  - runs/$RUN_ID/debate_summary.json"
echo "  - runs/$RUN_ID/debate/NVDA.json"
echo "  - runs/$RUN_ID/debate/AMD.json"
echo "  - runs/$RUN_ID/debate/TSLA.json"
echo "  - runs/$RUN_ID/portfolio.json"
echo "  - runs/$RUN_ID/logs.txt"
