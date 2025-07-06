#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Mattermost Sync - Development Setup${NC}"
echo ""

# Step 1: Check Node.js
echo -e "${YELLOW}1️⃣ Checking Node.js version...${NC}"
node_version=$(node --version)
echo -e "Node.js version: ${node_version}"
if [[ ${node_version:1:2} -lt 18 ]]; then
    echo -e "${RED}❌ Node.js 18+ required${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Node.js version OK${NC}"
echo ""

# Step 2: Install dependencies
echo -e "${YELLOW}2️⃣ Installing dependencies...${NC}"
npm install  # Uses --legacy-peer-deps automatically via .npmrc
echo -e "${GREEN}✅ Dependencies installed${NC}"
echo ""

# Step 3: Setup environment
echo -e "${YELLOW}3️⃣ Setting up environment...${NC}"
mkdir -p logs data test-data

if [ ! -f ".env" ]; then
    cp .env.template .env
    echo -e "${GREEN}✅ Created .env file${NC}"
    echo -e "${YELLOW}⚠️  Edit .env with your credentials before continuing${NC}"
    echo -e "${BLUE}Press Enter when ready, or Ctrl+C to exit...${NC}"
    read -r
else
    echo -e "${GREEN}✅ .env file exists${NC}"
fi
echo ""

# Step 4: Build
echo -e "${YELLOW}4️⃣ Building TypeScript...${NC}"
npm run build
echo -e "${GREEN}✅ Build complete${NC}"
echo ""

# Step 5: Test
echo -e "${YELLOW}5️⃣ Running tests...${NC}"

# Check if tests directory exists
if [ ! -d "tests" ]; then
    echo -e "${RED}❌ tests/ directory missing!${NC}"
    echo -e "${YELLOW}Creating tests directory...${NC}"
    mkdir -p tests
fi

# Check if any test files exist
if ! ls tests/*.test.ts >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  No test files found in tests/ directory${NC}"
    echo -e "${BLUE}Skipping tests (no test files to run)${NC}"
else
    if npm test; then
        echo -e "${GREEN}✅ All tests passed${NC}"
    else
        echo -e "${RED}❌ Tests failed${NC}"
        echo -e "${YELLOW}Check your .env file and credentials${NC}"
        echo ""
        echo -e "${BLUE}Debug steps:${NC}"
        echo -e "1. Run debug: ${YELLOW}chmod +x debug-build.sh && ./debug-build.sh${NC}"
        echo -e "2. Check .env file: ${YELLOW}cat .env${NC}"
        echo -e "3. Run in dev mode: ${YELLOW}npm run dev${NC}"
        exit 1
    fi
fi

echo ""

# Step 6: Run
echo -e "${YELLOW}6️⃣ Starting application...${NC}"
npm start