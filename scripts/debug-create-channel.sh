#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 Debugging create_channel function${NC}"
echo ""

# Test the exact function call that should be happening
TEST_CHANNEL_LEFT="test-bridge-source"
LEFT_TEAM="left"
MM1_NAME="mm1"

echo -e "${YELLOW}1. First, let's see if the team exists:${NC}"
docker exec $MM1_NAME mmctl --local team search $LEFT_TEAM
echo ""

echo -e "${YELLOW}2. List current channels in the team:${NC}"
docker exec $MM1_NAME mmctl --local channel list $LEFT_TEAM
echo ""

echo -e "${YELLOW}3. Test the channel check command:${NC}"
echo "Command: docker exec $MM1_NAME mmctl --local channel list \"$LEFT_TEAM\" 2>/dev/null | grep -q \"$TEST_CHANNEL_LEFT\""
docker exec $MM1_NAME mmctl --local channel list "$LEFT_TEAM" 2>/dev/null | grep -q "$TEST_CHANNEL_LEFT"
echo "Exit code: $?"
echo ""

echo -e "${YELLOW}4. Show what grep sees:${NC}"
echo "Output of channel list:"
docker exec $MM1_NAME mmctl --local channel list "$LEFT_TEAM"
echo ""
echo "Grepping for: $TEST_CHANNEL_LEFT"
docker exec $MM1_NAME mmctl --local channel list "$LEFT_TEAM" | grep "$TEST_CHANNEL_LEFT" || echo "No match found"
echo ""

echo -e "${YELLOW}5. Now let's test the actual create command:${NC}"
CMD="docker exec $MM1_NAME mmctl --local channel create --team \"$LEFT_TEAM\" --name \"$TEST_CHANNEL_LEFT\" --display-name \"Test Bridge Source\""
echo -e "${BLUE}Command: $CMD${NC}"
eval $CMD
echo "Exit code: $?"
echo ""

echo -e "${YELLOW}6. Check if it was created:${NC}"
docker exec $MM1_NAME mmctl --local channel list "$LEFT_TEAM" | grep "$TEST_CHANNEL_LEFT" || echo "Channel not found"
echo ""

echo -e "${YELLOW}7. Search for the channel to get its ID:${NC}"
docker exec $MM1_NAME mmctl --local channel search "$TEST_CHANNEL_LEFT" --team "$LEFT_TEAM"
echo ""

echo -e "${GREEN}✅ Debug complete${NC}"