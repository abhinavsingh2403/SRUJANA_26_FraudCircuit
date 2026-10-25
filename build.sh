#!/usr/bin/env bash
# TraceGuard Render Build Script
set -e

echo "=== [1/3] Installing Python Dependencies ==="
pip install --upgrade pip
pip install -r requirements.txt

echo "=== [2/3] Building Frontend Assets ==="
if command -v npm &> /dev/null; then
  echo "Found npm $(npm --version). Building frontend..."
  cd frontend
  npm install
  npm run build
  cd ..
else
  echo "npm not detected; using pre-packaged static frontend assets in backend/traceguard/static."
fi

echo "=== [3/3] Verifying TraceGuard Application ==="
python -c "import app; print('TraceGuard production entrypoint verified successfully.')"

echo "=== Build Completed Successfully ==="
