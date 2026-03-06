#!/bin/bash
# Start the SAM2 tracking service for Sitrec local development
# Usage: ./start.sh [port]
#
# Prerequisites:
#   1. cd sam2-service
#   2. python3 -m venv venv
#   3. source venv/bin/activate
#   4. pip install -r requirements.txt
#   5. git clone https://github.com/facebookresearch/segment-anything-2.git
#   6. cd segment-anything-2 && pip install -e ".[dev]"
#   7. cd checkpoints && ./download_ckpts.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Activate venv if it exists
if [ -f venv/bin/activate ]; then
    source venv/bin/activate
fi

export SAM2_PORT="${1:-8001}"
export SAM2_DIR="$SCRIPT_DIR/segment-anything-2"

echo "Starting SAM2 service on port $SAM2_PORT..."
echo "SAM2 directory: $SAM2_DIR"

python3 sam2_service.py
