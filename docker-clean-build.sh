#!/bin/bash

# Docker Clean Build Script for Sitrec
# Works on Mac and Ubuntu
# Performs a completely clean rebuild from scratch with no caching

set -e  # Exit on any error

echo "🧹 Starting clean Docker build for Sitrec..."
echo ""

# Change to the directory where this script is located
cd "$(dirname "$0")"

echo "📍 Working directory: $(pwd)"
echo ""

# Step 1: Stop and remove containers, networks, and volumes
echo "1️⃣  Stopping and removing containers, networks, and volumes..."
docker compose -p sitrec down -v
echo "   ✓ Cleanup complete"
echo ""

# Step 2: Build images without cache
echo "2️⃣  Building Docker images without cache..."
docker compose -p sitrec build --no-cache
echo "   ✓ Build complete"
echo ""

# Step 3: Start services
echo "3️⃣  Starting services..."
docker compose -p sitrec up -d
echo "   ✓ Services started"
echo ""

echo "✅ Clean Docker build complete!"
echo ""
echo "Access the application at: http://localhost:6425"
echo ""
echo "To view logs: docker compose -p sitrec logs -f"
echo "To stop: docker compose -p sitrec down"