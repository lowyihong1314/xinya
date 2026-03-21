#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$PROJECT_ROOT/venv"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

pip install -r "$PROJECT_ROOT/requirements.txt"

cd "$FRONTEND_DIR"

if [ ! -d "node_modules" ]; then
    npm install
fi

npx vite build

cd "$PROJECT_ROOT"
python3 run.py
