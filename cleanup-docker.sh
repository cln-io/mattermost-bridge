#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧹 Cleaning up Docker buildx...${NC}"

# Remove any existing multiarch-builder
echo -e "${YELLOW}Removing existing multiarch-builder...${NC}"
docker buildx rm multiarch-builder 2>/dev/null || echo "No multiarch-builder to remove"

# List current builders
echo -e "${YELLOW}Current builders:${NC}"
docker buildx ls

# Reset to default builder
echo -e "${YELLOW}Switching to default builder...${NC}"
docker buildx use default

echo -e "${GREEN}✅ Docker buildx cleanup completed${NC}"
echo ""
echo -e "${BLUE}You can now run ./build.sh again${NC}"