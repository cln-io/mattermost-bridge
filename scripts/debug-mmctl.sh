#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 Debugging mmctl commands${NC}"
echo ""

# Check if containers are running
if ! docker ps | grep -q mm1; then
    echo -e "${RED}❌ Container mm1 is not running${NC}"
    exit 1
fi

echo -e "${YELLOW}1. Testing mmctl team commands:${NC}"
echo -e "${BLUE}Listing teams:${NC}"
docker exec mm1 mmctl --local team list

echo ""
echo -e "${BLUE}Searching for team 'left':${NC}"
docker exec mm1 mmctl --local team search left

echo ""
echo -e "${YELLOW}2. Testing mmctl channel commands:${NC}"
echo -e "${BLUE}Listing channels in team 'left':${NC}"
docker exec mm1 mmctl --local channel list left

echo ""
echo -e "${YELLOW}3. Testing channel creation syntax:${NC}"
echo -e "${BLUE}Trying: mmctl --local channel create --help${NC}"
docker exec mm1 mmctl --local channel create --help

echo ""
echo -e "${YELLOW}4. Creating a test channel:${NC}"
echo -e "${BLUE}Trying: mmctl --local channel create --team left --name test-debug --display-name 'Test Debug'${NC}"
docker exec mm1 mmctl --local channel create --team left --name test-debug --display-name "Test Debug"

echo ""
echo -e "${YELLOW}5. Listing channels again to see the new channel:${NC}"
docker exec mm1 mmctl --local channel list left

echo ""
echo -e "${YELLOW}6. Getting channel details with search:${NC}"
echo -e "${BLUE}Searching for test-debug channel:${NC}"
docker exec mm1 mmctl --local channel search test-debug --team left

echo ""
echo -e "${YELLOW}7. Getting channel details with JSON:${NC}"
echo -e "${BLUE}Listing channels in JSON format:${NC}"
docker exec mm1 mmctl --local channel list left --json | jq '.[0]' 2>/dev/null || echo "jq not available, showing raw JSON:"
docker exec mm1 mmctl --local channel list left --json | head -20

echo ""
echo -e "${YELLOW}8. Testing user list:${NC}"
echo -e "${BLUE}Listing users:${NC}"
docker exec mm1 mmctl --local user list | head -10

echo ""
echo -e "${GREEN}✅ Debug information complete${NC}"
echo ""
echo -e "${BLUE}💡 Tips:${NC}"
echo -e "  - Channel IDs appear in parentheses when using 'channel search'"
echo -e "  - JSON output provides full channel details including IDs"
echo -e "  - Make sure to run the latest version of local-env.sh"