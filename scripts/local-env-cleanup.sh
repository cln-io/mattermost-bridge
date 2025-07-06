#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧹 Cleaning up local Mattermost environment${NC}"
echo ""

# Stop containers
echo -e "${YELLOW}Stopping containers...${NC}"
docker stop mm1 mm2 2>/dev/null

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Containers stopped${NC}"
else
    echo -e "${YELLOW}⚠️  Containers may not have been running${NC}"
fi

# Remove containers
echo -e "${YELLOW}Removing containers...${NC}"
docker rm mm1 mm2 2>/dev/null

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Containers removed${NC}"
else
    echo -e "${YELLOW}⚠️  Containers may have already been removed${NC}"
fi

# Optional: Remove generated .env.local file
if [ -f ".env.local" ]; then
    echo -e "${YELLOW}Found .env.local file${NC}"
    read -p "Remove .env.local file? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm .env.local
        echo -e "${GREEN}✅ Removed .env.local${NC}"
    else
        echo -e "${BLUE}Kept .env.local${NC}"
    fi
fi

echo ""
echo -e "${GREEN}✅ Cleanup complete!${NC}"