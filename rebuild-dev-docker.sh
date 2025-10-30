#!/bin/bash

# ============================================================================
# Sitrec Development Docker - Full Rebuild Script
# ============================================================================
#
# This script performs a complete rebuild of the Sitrec development Docker
# container, including:
#   - Stopping and removing existing containers
#   - Removing old images
#   - Rebuilding from scratch with no cache
#   - Starting the new container
#
# Usage:
#   ./rebuild-dev-docker.sh           # Full rebuild with no cache
#   ./rebuild-dev-docker.sh --quick   # Rebuild using cache (faster)
#
# ============================================================================

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SITREC_DIR="/Users/mick/Dropbox/sitrec-dev/sitrec"
COMPOSE_FILE="docker-compose.dev.yml"

# Parse arguments
USE_CACHE=false
if [ "$1" == "--quick" ]; then
  USE_CACHE=true
fi

echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}Sitrec Development Docker - Full Rebuild${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

# Change to sitrec directory
cd "$SITREC_DIR"

# Step 1: Stop and remove existing containers
echo -e "${YELLOW}[1/6] Stopping and removing existing containers...${NC}"
docker-compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true
echo -e "${GREEN}✓ Containers stopped and removed${NC}"
echo ""

# Step 2: Remove old images (optional, only if not using cache)
if [ "$USE_CACHE" = false ]; then
  echo -e "${YELLOW}[2/6] Removing old Docker images...${NC}"
  docker images | grep sitrec-sitrec-dev | awk '{print $3}' | xargs -r docker rmi -f 2>/dev/null || true
  echo -e "${GREEN}✓ Old images removed${NC}"
else
  echo -e "${YELLOW}[2/6] Skipping image removal (using cache)${NC}"
fi
echo ""

# Step 3: Ensure required directories exist
echo -e "${YELLOW}[3/6] Ensuring required directories exist...${NC}"
mkdir -p "$SITREC_DIR/sitrec-cache"
mkdir -p "$SITREC_DIR/sitrec-videos"
mkdir -p "$SITREC_DIR/dist"
chmod 777 "$SITREC_DIR/sitrec-cache" 2>/dev/null || true
echo -e "${GREEN}✓ Directories created${NC}"
echo ""

# Step 4: Build the Docker image
echo -e "${YELLOW}[4/6] Building Docker image...${NC}"
if [ "$USE_CACHE" = false ]; then
  echo -e "${BLUE}Building with --no-cache (this may take several minutes)...${NC}"
  docker-compose -f "$COMPOSE_FILE" build --no-cache
else
  echo -e "${BLUE}Building with cache (faster)...${NC}"
  docker-compose -f "$COMPOSE_FILE" build
fi
echo -e "${GREEN}✓ Docker image built successfully${NC}"
echo ""

# Step 5: Start the container
echo -e "${YELLOW}[5/6] Starting the container...${NC}"
docker-compose -f "$COMPOSE_FILE" up -d
echo -e "${GREEN}✓ Container started${NC}"
echo ""

# Step 6: Wait for services to be ready and show status
echo -e "${YELLOW}[6/6] Waiting for services to start...${NC}"
sleep 5

# Check if container is running
if docker-compose -f "$COMPOSE_FILE" ps | grep -q "Up"; then
  echo -e "${GREEN}✓ Container is running${NC}"
  echo ""
  
  # Show container status
  echo -e "${BLUE}Container Status:${NC}"
  docker-compose -f "$COMPOSE_FILE" ps
  echo ""
  
  # Show access information
  echo -e "${GREEN}============================================================================${NC}"
  echo -e "${GREEN}Rebuild Complete!${NC}"
  echo -e "${GREEN}============================================================================${NC}"
  echo ""
  echo -e "${BLUE}Access your development environment at:${NC}"
  echo -e "  ${GREEN}http://localhost:8080${NC}  (Webpack Dev Server with hot reload)"
  echo -e "  ${GREEN}http://localhost:8081${NC}  (Apache/PHP backend)"
  echo ""
  echo -e "${BLUE}Useful commands:${NC}"
  echo -e "  View logs:        ${YELLOW}docker-compose -f $COMPOSE_FILE logs -f${NC}"
  echo -e "  Stop container:   ${YELLOW}docker-compose -f $COMPOSE_FILE down${NC}"
  echo -e "  Restart:          ${YELLOW}docker-compose -f $COMPOSE_FILE restart${NC}"
  echo -e "  Shell access:     ${YELLOW}docker-compose -f $COMPOSE_FILE exec sitrec-dev bash${NC}"
  echo ""
else
  echo -e "${RED}✗ Container failed to start${NC}"
  echo ""
  echo -e "${YELLOW}Showing logs:${NC}"
  docker-compose -f "$COMPOSE_FILE" logs --tail=50
  exit 1
fi