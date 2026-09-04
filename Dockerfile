# RocketShip Backend Dockerfile
# Build context: rocketship/ (repo root)
# Usage: docker build -f backend/Dockerfile -t rocketship-backend .

# ============================================================================
# Stage 1: Build dependencies
# ============================================================================
FROM python:3.11-slim as builder

WORKDIR /build

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY backend/requirements.txt .

# Create virtual environment and install deps
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# ============================================================================
# Stage 2: Production image
# ============================================================================
FROM python:3.11-slim

WORKDIR /app

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install runtime dependencies (for lxml)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxml2 \
    libxslt1.1 \
    && rm -rf /var/lib/apt/lists/*

# Copy application code
COPY backend/main.py /app/main.py

# Source modules (needed for pipeline imports)
COPY src/ /app/src/

# Data files (macro trends, etc.)
COPY data/ /app/data/

# Backend data files. src/universe.py probes /app/backend_data/sp500_fallback.csv
# FIRST when the Wikipedia scrape fails, and none of its other five candidate
# paths exist in this image (data/*.csv is gitignored so the CSV is not in
# data/, and src/ lands at /app/src/ not /app/backend/). Without this COPY a
# Wikipedia hiccup would kill the whole run with no fallback.
#
# This line used to live only in a duplicate backend/Dockerfile. Note that
# flyctl resolves fly.toml's `dockerfile` relative to THE CONFIG FILE, not to
# `context` - so "Dockerfile" there meant backend/Dockerfile, and the fallback
# was always present. backend/fly.toml now names ../Dockerfile explicitly.
COPY backend/data/ /app/backend_data/

# Create data directory for runs (Fly.io volume will mount here)
RUN mkdir -p /data/runs

# Cache directory for yfinance
RUN mkdir -p /app/cache

# Environment
ENV PYTHONUNBUFFERED=1
ENV DATA_DIR=/data
ENV PORT=8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Expose port
EXPOSE 8000

# Run
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
