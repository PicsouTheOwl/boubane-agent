#!/bin/bash
# Boubane Agent — Start script (auto-install deps if needed)
set -e

cd /home/ubuntu/boubane-agent

# Create venv if missing
if [ ! -d "venv" ]; then
    echo "Creating venv..."
    python3 -m venv venv
fi

source venv/bin/activate

# Install deps if missing
if ! python -c "import fastapi" 2>/dev/null; then
    echo "Installing dependencies..."
    pip install -r requirements.txt -q
    playwright install chromium 2>/dev/null || true
fi

# Create data dirs
mkdir -p data/{uploads,db,cache}

# Start
echo "🚀 Boubane Agent starting on port 3001..."
python -m uvicorn app.main:app --host 0.0.0.0 --port 3001 --workers 1
