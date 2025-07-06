#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if .env.local or .env exists (prefer .env.local)
if [ -f ".env.local" ]; then
    echo -e "${BLUE}Using .env.local for configuration${NC}"
    source .env.local
elif [ -f ".env" ]; then
    echo -e "${BLUE}Using .env for configuration${NC}"
    source .env
else
    echo -e "${RED}❌ No .env.local or .env file found${NC}"
    echo -e "${YELLOW}Run ./local-env.sh first to set up the environment${NC}"
    exit 1
fi

# Decode the base64 password for the left user
LEFT_PASSWORD=$(echo -n "$MATTERMOST_LEFT_PASSWORD_B64" | base64 -d)

echo -e "${BLUE}🧪 Testing Mattermost Bridge Setup${NC}"
echo ""

# Function to post a message via API
post_test_message() {
    local server=$1
    local username=$2
    local password=$3
    local channel_id=$4
    local message=$5
    
    echo -e "${YELLOW}Logging in to $server...${NC}"
    
    # Login and get token
    LOGIN_RESPONSE=$(curl -s -X POST \
        "$server/api/v4/users/login" \
        -H "Content-Type: application/json" \
        -d "{\"login_id\":\"$username\",\"password\":\"$password\"}")
    
    TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*' | grep -o '[^"]*$' | head -1)
    
    if [ -z "$TOKEN" ]; then
        echo -e "${RED}❌ Failed to login${NC}"
        echo "Response: $LOGIN_RESPONSE"
        return 1
    fi
    
    echo -e "${GREEN}✅ Logged in successfully${NC}"
    
    # Post message
    echo -e "${YELLOW}Posting test message...${NC}"
    
    POST_RESPONSE=$(curl -s -X POST \
        "$server/api/v4/posts" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"channel_id\":\"$channel_id\",\"message\":\"$message\"}")
    
    if echo "$POST_RESPONSE" | grep -q '"id"'; then
        echo -e "${GREEN}✅ Message posted successfully!${NC}"
        return 0
    else
        echo -e "${RED}❌ Failed to post message${NC}"
        echo "Response: $POST_RESPONSE"
        return 1
    fi
}

# Test messages
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
TEST_MESSAGES=(
    "🧪 Test message from bridge test script - $TIMESTAMP"
    "Hello from the LEFT instance! 👋"
    "This is a multi-line message:\nLine 1\nLine 2\nLine 3"
    "Testing **markdown** support with _italics_ and ~strikethrough~"
    "Testing emoji support 🚀 🎉 🔥 ✅"
)

echo -e "${BLUE}Select a test message to send:${NC}"
echo ""

for i in "${!TEST_MESSAGES[@]}"; do
    echo -e "  ${YELLOW}$((i+1))${NC}) ${TEST_MESSAGES[$i]}"
done
echo -e "  ${YELLOW}0${NC}) Custom message"
echo ""

read -p "Enter your choice (0-${#TEST_MESSAGES[@]}): " choice

if [ "$choice" = "0" ]; then
    read -p "Enter your custom message: " CUSTOM_MESSAGE
    MESSAGE="$CUSTOM_MESSAGE"
elif [ "$choice" -ge 1 ] && [ "$choice" -le "${#TEST_MESSAGES[@]}" ]; then
    MESSAGE="${TEST_MESSAGES[$((choice-1))]}"
else
    echo -e "${RED}Invalid choice${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}Posting to source channel on LEFT instance...${NC}"
echo -e "${BLUE}Message: ${NC}$MESSAGE"
echo ""

# Post the test message
post_test_message \
    "$MATTERMOST_LEFT_SERVER" \
    "$MATTERMOST_LEFT_USERNAME" \
    "$LEFT_PASSWORD" \
    "$SOURCE_CHANNEL_ID" \
    "$MESSAGE"

echo ""
echo -e "${BLUE}📋 Next steps:${NC}"
echo -e "  1. Check if the bridge logged the message"
echo -e "  2. Login to RIGHT instance: ${YELLOW}$MATTERMOST_RIGHT_SERVER/$MATTERMOST_RIGHT_TEAM${NC}"
echo -e "  3. Look for the message in #test-bridge-target"
echo ""
echo -e "${BLUE}💡 Quick links:${NC}"
echo -e "  - LEFT instance: ${YELLOW}$MATTERMOST_LEFT_SERVER/$MATTERMOST_LEFT_TEAM${NC}"
echo -e "  - RIGHT instance: ${YELLOW}$MATTERMOST_RIGHT_SERVER/$MATTERMOST_RIGHT_TEAM${NC}"
echo ""