#!/bin/bash
# Quick start — run Boubane Agent locally (for development)
set -e

cd "$(dirname "$0")/.."

# Create venv if needed
if [ ! -d "venv" ]; then
    python3 -m venv venv
    source venv/bin/activate
    pip install --upgrade pip -q
    pip install -r requirements.txt -q
else
    source venv/bin/activate
fi

# Create data dirs
mkdir -p data/{uploads,db,cache}

# Run
echo "🚀 Boubane Agent starting on http://localhost:3000"
python -m uvicorn app.main:app --host 0.0.0.0 --port 3000 --reload
