#!/usr/bin/env bash
set -euo pipefail

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt

# Ensure text_to_sql_ollama.py is present (copy your existing file here)
if [ ! -f text_to_sql_ollama.py ]; then
  echo ">>> ERROR: Place text_to_sql_ollama.py in backend/ (same folder as main.py)"
  exit 1
fi

# Default DB is backend/stations.db; override with DB_PATH env var
export DB_PATH="${DB_PATH:-$(pwd)/stations.db}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-deepseek-r1:14b}"

uvicorn main:app --host 127.0.0.1 --port 3001 --reload
