#!/bin/bash

# ============================================================================
# Sitrec Development Docker - Quick Restart Script
# ============================================================================
#
# This script performs a quick restart of the Sitrec development Docker
# container without rebuilding. Use this when you just need to restart
# the services.
#
# For a full rebuild, use: ./rebuild-dev-docker.sh
#
# Usage:
#   ./restart-dev-docker.sh
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

echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}Sitrec Development Docker - Quick Restart${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

# Set timezone from host machine
if [ -z "$TZ" ]; then
  # Try to detect timezone based on OS
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    if [ -L /etc/localtime ]; then
      DETECTED_TZ=$(readlink /etc/localtime | sed 's|.*/zoneinfo/||')
      export TZ="$DETECTED_TZ"
      echo -e "${GREEN}Detected timezone (macOS): $TZ${NC}"
    fi
  elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    if [ -f /etc/timezone ]; then
      DETECTED_TZ=$(cat /etc/timezone)
      export TZ="$DETECTED_TZ"
      echo -e "${GREEN}Detected timezone (Linux): $TZ${NC}"
    elif [ -L /etc/localtime ]; then
      DETECTED_TZ=$(readlink /etc/localtime | sed 's|.*/zoneinfo/||')
      export TZ="$DETECTED_TZ"
      echo -e "${GREEN}Detected timezone (Linux): $TZ${NC}"
    fi
  elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    # Windows (Git Bash or Cygwin)
    # Try to get timezone from Windows
    if command -v powershell.exe &> /dev/null; then
      WIN_TZ=$(powershell.exe -Command "[System.TimeZoneInfo]::Local.Id" 2>/dev/null | tr -d '\r')
      # Map common Windows timezone names to IANA format
      case "$WIN_TZ" in
        "Pacific Standard Time") export TZ="America/Los_Angeles" ;;
        "Mountain Standard Time") export TZ="America/Denver" ;;
        "Central Standard Time") export TZ="America/Chicago" ;;
        "Eastern Standard Time") export TZ="America/New_York" ;;
        *) export TZ="UTC" ;;
      esac
      echo -e "${GREEN}Detected timezone (Windows): $TZ${NC}"
    fi
  fi
  
  # Fallback to UTC if detection failed
  if [ -z "$TZ" ]; then
    echo -e "${YELLOW}Warning: Could not detect timezone, using UTC${NC}"
    export TZ="UTC"
  fi
else
  echo -e "${GREEN}Using timezone from environment: $TZ${NC}"
fi
echo ""

# Change to sitrec directory
cd "$SITREC_DIR"

# Stop containers
echo -e "${YELLOW}[1/2] Stopping containers...${NC}"
docker-compose -f "$COMPOSE_FILE" down
echo -e "${GREEN}✓ Containers stopped${NC}"
echo ""

# Start containers
echo -e "${YELLOW}[2/2] Starting containers...${NC}"
docker-compose -f "$COMPOSE_FILE" up -d
echo -e "${GREEN}✓ Containers started${NC}"
echo ""

# Wait for services to be ready
echo -e "${YELLOW}Waiting for services to start...${NC}"
sleep 5

# Check if container is running
if docker-compose -f "$COMPOSE_FILE" ps | grep -q "Up"; then
  echo -e "${GREEN}✓ Container is running${NC}"
  echo ""
  
  # Show container status
  echo -e "${BLUE}Container Status:${NC}"
  docker-compose -f "$COMPOSE_FILE" ps
  echo ""
  
  echo -e "${GREEN}============================================================================${NC}"
  echo -e "${GREEN}Restart Complete!${NC}"
  echo -e "${GREEN}============================================================================${NC}"
  echo ""
  echo -e "${BLUE}Access your development environment at:${NC}"
  echo -e "  ${GREEN}http://localhost:8080${NC}  (Webpack Dev Server with hot reload)"
  echo ""
  echo -e "${BLUE}View logs:${NC}"
  echo -e "  ${YELLOW}docker-compose -f $COMPOSE_FILE logs -f${NC}"
  echo ""
else
  echo -e "${RED}✗ Container failed to start${NC}"
  echo ""
  echo -e "${YELLOW}Showing logs:${NC}"
  docker-compose -f "$COMPOSE_FILE" logs --tail=50
  exit 1
fi