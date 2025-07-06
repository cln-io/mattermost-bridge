#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
MM1_NAME="mm1"
MM2_NAME="mm2"
MM1_PORT="8065"
MM2_PORT="9065"
MM_IMAGE="mattermost/mattermost-preview"

# User credentials
LEFT_USER="left"
LEFT_EMAIL="left@localhost.local"
LEFT_PASSWORD="leftpass123!"

RIGHT_USER="right"
RIGHT_EMAIL="right@localhost.local"
RIGHT_PASSWORD="rightpass123!"

# Bridge bot users
BRIDGE_LEFT_USER="bridge-bot-left"
BRIDGE_LEFT_EMAIL="bridge-bot-left@localhost.local"
BRIDGE_LEFT_PASSWORD="bridgeleft123!"

BRIDGE_RIGHT_USER="bridge-bot-right"
BRIDGE_RIGHT_EMAIL="bridge-bot-right@localhost.local"
BRIDGE_RIGHT_PASSWORD="bridgeright123!"

# Channel names
TEST_CHANNEL_LEFT="test-bridge-source"
TEST_CHANNEL_RIGHT="test-bridge-target"

echo -e "${BLUE}🚀 Setting up local Mattermost environment for bridge testing${NC}"
echo ""

# Function to wait for Mattermost to be ready
wait_for_mattermost() {
    local container=$1
    local port=$2
    local max_attempts=30
    local attempt=1
    
    echo -e "${YELLOW}⏳ Waiting for $container to be ready on port $port...${NC}"
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -o /dev/null -w "%{http_code}" http://localhost:$port/api/v4/system/ping | grep -q "200"; then
            echo -e "${GREEN}✅ $container is ready!${NC}"
            return 0
        fi
        echo -n "."
        sleep 2
        ((attempt++))
    done
    
    echo -e "${RED}❌ $container failed to start after $max_attempts attempts${NC}"
    return 1
}

# Function to create user via mmctl
create_user() {
    local container=$1
    local email=$2
    local username=$3
    local password=$4
    local is_admin=$5
    
    echo -e "${BLUE}Creating user: $username ($email)${NC}"
    
    # Check if user already exists
    if docker exec $container mmctl --local user search $email 2>/dev/null | grep -q "$email"; then
        echo -e "${YELLOW}User $username already exists, skipping...${NC}"
        return 0
    fi
    
    # Create user
    if [ "$is_admin" = "true" ]; then
        docker exec $container mmctl --local user create --email "$email" --username "$username" --password "$password" --system-admin
    else
        docker exec $container mmctl --local user create --email "$email" --username "$username" --password "$password"
    fi
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Created user: $username${NC}"
    else
        echo -e "${RED}❌ Failed to create user: $username${NC}"
        return 1
    fi
}

# Function to create team
create_team() {
    local container=$1
    local team_name=$2
    local display_name=$3
    
    echo -e "${BLUE}Creating team: $team_name ($display_name)${NC}"
    
    # Check if team already exists
    if docker exec $container mmctl --local team search "$team_name" 2>/dev/null | grep -q "$team_name"; then
        echo -e "${YELLOW}Team $team_name already exists, skipping...${NC}"
        return 0
    fi
    
    # Create team
    docker exec $container mmctl --local team create --name "$team_name" --display-name "$display_name"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Created team: $team_name${NC}"
    else
        echo -e "${RED}❌ Failed to create team: $team_name${NC}"
        return 1
    fi
}

# Function to add user to team
add_user_to_team() {
    local container=$1
    local team_name=$2
    local username=$3
    
    echo -e "${BLUE}Adding $username to team $team_name${NC}"
    
    docker exec $container mmctl --local team users add "$team_name" "$username"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Added $username to team $team_name${NC}"
    else
        echo -e "${YELLOW}⚠️  Could not add $username to team $team_name (may already be member)${NC}"
    fi
}

# Function to create channel
create_channel() {
    local container=$1
    local channel_name=$2
    local display_name=$3
    local team_name=$4
    
    echo -e "${BLUE}Creating channel: $channel_name in team: $team_name${NC}"
    
    # First check if channel exists by listing all channels in team
    echo -e "${YELLOW}Checking existing channels in team $team_name...${NC}"
    # Skip the header line "There are X channels on local instance" and check for channel
    if docker exec $container mmctl --local channel list "$team_name" 2>/dev/null | tail -n +2 | grep -q "^$channel_name$"; then
        echo -e "${YELLOW}Channel $channel_name already exists${NC}"
        return 0
    fi
    
    # Create channel with --team flag
    echo -e "${YELLOW}Creating new channel...${NC}"
    docker exec $container mmctl --local channel create --team "$team_name" --name "$channel_name" --display-name "$display_name"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Created channel: $channel_name${NC}"
        return 0
    else
        echo -e "${RED}❌ Failed to create channel: $channel_name${NC}"
        return 1
    fi
}

# Function to add user to channel
add_user_to_channel() {
    local container=$1
    local username=$2
    local team_channel=$3  # format: team:channel
    
    echo -e "${BLUE}Adding $username to channel $team_channel${NC}"
    
    docker exec $container mmctl --local channel users add "$team_channel" "$username"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Added $username to $team_channel${NC}"
    else
        echo -e "${YELLOW}⚠️  Could not add $username to $team_channel (may already be member)${NC}"
    fi
}

# Step 1: Stop and remove existing containers
echo -e "${YELLOW}🧹 Cleaning up existing containers...${NC}"
docker stop $MM1_NAME $MM2_NAME 2>/dev/null
docker rm $MM1_NAME $MM2_NAME 2>/dev/null

# Step 2: Start new containers
echo -e "${BLUE}🐳 Starting Mattermost containers...${NC}"
echo ""

echo -e "${BLUE}Starting $MM1_NAME (left) on port $MM1_PORT${NC}"
docker run --name $MM1_NAME -d \
    --publish $MM1_PORT:8065 \
    --add-host dockerhost:127.0.0.1 \
    --env MM_SERVICESETTINGS_ENABLELOCALMODE=true \
    $MM_IMAGE

echo -e "${BLUE}Starting $MM2_NAME (right) on port $MM2_PORT${NC}"
docker run --name $MM2_NAME -d \
    --publish $MM2_PORT:8065 \
    --add-host dockerhost:127.0.0.1 \
    --env MM_SERVICESETTINGS_ENABLELOCALMODE=true \
    $MM_IMAGE

echo ""

# Step 3: Wait for both instances to be ready
wait_for_mattermost $MM1_NAME $MM1_PORT
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to start mm1${NC}"
    exit 1
fi

wait_for_mattermost $MM2_NAME $MM2_PORT
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to start mm2${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Both Mattermost instances are running!${NC}"
echo ""

# Give it a bit more time to fully initialize
echo -e "${YELLOW}⏳ Waiting for full initialization...${NC}"
sleep 5

# Step 4: Create users on both instances
echo -e "${BLUE}👤 Creating users...${NC}"
echo ""

# Left instance users
echo -e "${BLUE}Setting up LEFT instance ($MM1_NAME)${NC}"
create_user $MM1_NAME "$LEFT_EMAIL" "$LEFT_USER" "$LEFT_PASSWORD" "true"
create_user $MM1_NAME "$BRIDGE_LEFT_EMAIL" "$BRIDGE_LEFT_USER" "$BRIDGE_LEFT_PASSWORD" "false"

echo ""

# Right instance users
echo -e "${BLUE}Setting up RIGHT instance ($MM2_NAME)${NC}"
create_user $MM2_NAME "$RIGHT_EMAIL" "$RIGHT_USER" "$RIGHT_PASSWORD" "true"
create_user $MM2_NAME "$BRIDGE_RIGHT_EMAIL" "$BRIDGE_RIGHT_USER" "$BRIDGE_RIGHT_PASSWORD" "false"

echo ""

# Step 5: Create teams
echo -e "${BLUE}🏢 Creating teams...${NC}"
echo ""

# Create teams
create_team $MM1_NAME "left" "Left Team"
create_team $MM2_NAME "right" "Right Team"

# Set team names for use in rest of script
LEFT_TEAM="left"
RIGHT_TEAM="right"

echo ""

# Step 6: Add users to teams
echo -e "${BLUE}👥 Adding users to teams...${NC}"
echo ""

# Add users to left team
add_user_to_team $MM1_NAME "$LEFT_TEAM" "$LEFT_USER"
add_user_to_team $MM1_NAME "$LEFT_TEAM" "$BRIDGE_LEFT_USER"

# Add users to right team
add_user_to_team $MM2_NAME "$RIGHT_TEAM" "$RIGHT_USER"
add_user_to_team $MM2_NAME "$RIGHT_TEAM" "$BRIDGE_RIGHT_USER"

echo ""

# Small wait to ensure teams are fully registered
echo -e "${YELLOW}⏳ Waiting for teams to be fully registered...${NC}"
sleep 2

# Step 7: Create channels
echo -e "${BLUE}📢 Creating channels...${NC}"
echo ""

# Create channels on left instance
echo -e "${BLUE}Creating channel on LEFT instance${NC}"
create_channel $MM1_NAME "$TEST_CHANNEL_LEFT" "Test Bridge Source" "$LEFT_TEAM"
LEFT_CHANNEL_CREATED=$?

# Create channels on right instance  
echo -e "${BLUE}Creating channel on RIGHT instance${NC}"
create_channel $MM2_NAME "$TEST_CHANNEL_RIGHT" "Test Bridge Target" "$RIGHT_TEAM"
RIGHT_CHANNEL_CREATED=$?

# Check if channels were created successfully
if [ $LEFT_CHANNEL_CREATED -ne 0 ] || [ $RIGHT_CHANNEL_CREATED -ne 0 ]; then
    echo -e "${RED}❌ Failed to create one or more channels${NC}"
    exit 1
fi

echo ""

# Step 8: Add users to channels
echo -e "${BLUE}👥 Adding users to channels...${NC}"
echo ""

# Add users to left channel
add_user_to_channel $MM1_NAME "$LEFT_USER" "$LEFT_TEAM:$TEST_CHANNEL_LEFT"
add_user_to_channel $MM1_NAME "$BRIDGE_LEFT_USER" "$LEFT_TEAM:$TEST_CHANNEL_LEFT"

# Add users to right channel
add_user_to_channel $MM2_NAME "$RIGHT_USER" "$RIGHT_TEAM:$TEST_CHANNEL_RIGHT"
add_user_to_channel $MM2_NAME "$BRIDGE_RIGHT_USER" "$RIGHT_TEAM:$TEST_CHANNEL_RIGHT"

echo ""

# Step 9: Get channel IDs
echo -e "${BLUE}🔍 Retrieving channel IDs...${NC}"
echo ""

# Use mmctl channel search to get channel details including IDs
echo -e "${YELLOW}Getting channel info for LEFT team...${NC}"
LEFT_CHANNEL_INFO=$(docker exec $MM1_NAME mmctl --local channel search "$TEST_CHANNEL_LEFT" --team "$LEFT_TEAM" 2>&1)
echo "$LEFT_CHANNEL_INFO"
# Extract channel ID from format: "Channel Name :name, Display Name :display, Channel ID :id"
LEFT_CHANNEL_ID=$(echo "$LEFT_CHANNEL_INFO" | grep -oE "Channel ID :[a-z0-9]{26}" | cut -d':' -f2 | tr -d ' ')

echo ""
echo -e "${YELLOW}Getting channel info for RIGHT team...${NC}"
RIGHT_CHANNEL_INFO=$(docker exec $MM2_NAME mmctl --local channel search "$TEST_CHANNEL_RIGHT" --team "$RIGHT_TEAM" 2>&1)
echo "$RIGHT_CHANNEL_INFO"
# Extract channel ID from format: "Channel Name :name, Display Name :display, Channel ID :id"
RIGHT_CHANNEL_ID=$(echo "$RIGHT_CHANNEL_INFO" | grep -oE "Channel ID :[a-z0-9]{26}" | cut -d':' -f2 | tr -d ' ')

# Validate channel IDs
if [ -z "$LEFT_CHANNEL_ID" ] || [[ ! "$LEFT_CHANNEL_ID" =~ ^[a-z0-9]{26}$ ]]; then
    echo -e "${RED}❌ Failed to get valid LEFT channel ID${NC}"
    echo -e "${YELLOW}Please check if the channel was created successfully${NC}"
    exit 1
fi

if [ -z "$RIGHT_CHANNEL_ID" ] || [[ ! "$RIGHT_CHANNEL_ID" =~ ^[a-z0-9]{26}$ ]]; then
    echo -e "${RED}❌ Failed to get valid RIGHT channel ID${NC}"
    echo -e "${YELLOW}Please check if the channel was created successfully${NC}"
    exit 1
fi

echo -e "${GREEN}Left channel ID: $LEFT_CHANNEL_ID${NC}"
echo -e "${GREEN}Right channel ID: $RIGHT_CHANNEL_ID${NC}"

echo ""
echo -e "${GREEN}✅ Local environment setup complete!${NC}"
echo ""
echo -e "${BLUE}📋 Summary:${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}LEFT Instance (mm1):${NC}"
echo -e "  URL: http://localhost:$MM1_PORT"
echo -e "  Team: $LEFT_TEAM"
echo -e "  Team URL: http://localhost:$MM1_PORT/$LEFT_TEAM"
echo -e "  Admin: $LEFT_USER / $LEFT_PASSWORD"
echo -e "  Bridge Bot: $BRIDGE_LEFT_USER / $BRIDGE_LEFT_PASSWORD"
echo -e "  Channel: #$TEST_CHANNEL_LEFT (ID: $LEFT_CHANNEL_ID)"
echo ""
echo -e "${YELLOW}RIGHT Instance (mm2):${NC}"
echo -e "  URL: http://localhost:$MM2_PORT"
echo -e "  Team: $RIGHT_TEAM"
echo -e "  Team URL: http://localhost:$MM2_PORT/$RIGHT_TEAM"
echo -e "  Admin: $RIGHT_USER / $RIGHT_PASSWORD"
echo -e "  Bridge Bot: $BRIDGE_RIGHT_USER / $BRIDGE_RIGHT_PASSWORD"
echo -e "  Channel: #$TEST_CHANNEL_RIGHT (ID: $RIGHT_CHANNEL_ID)"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Step 10: Generate .env file
echo -e "${BLUE}📝 Generating .env file for bridge...${NC}"

# Encode passwords to base64
BRIDGE_LEFT_PASSWORD_B64=$(echo -n "$BRIDGE_LEFT_PASSWORD" | base64)
BRIDGE_RIGHT_PASSWORD_B64=$(echo -n "$BRIDGE_RIGHT_PASSWORD" | base64)

cat > .env.local <<EOF
# Generated by local-env.sh
# Left Mattermost Instance
MATTERMOST_LEFT_NAME=Local-Left
MATTERMOST_LEFT_SERVER=http://localhost:$MM1_PORT
MATTERMOST_LEFT_USERNAME=$BRIDGE_LEFT_USER
MATTERMOST_LEFT_PASSWORD_B64=$BRIDGE_LEFT_PASSWORD_B64
MATTERMOST_LEFT_TEAM=$LEFT_TEAM

# Right Mattermost Instance  
MATTERMOST_RIGHT_NAME=Local-Right
MATTERMOST_RIGHT_SERVER=http://localhost:$MM2_PORT
MATTERMOST_RIGHT_USERNAME=$BRIDGE_RIGHT_USER
MATTERMOST_RIGHT_PASSWORD_B64=$BRIDGE_RIGHT_PASSWORD_B64
MATTERMOST_RIGHT_TEAM=$RIGHT_TEAM

# Bridge Configuration
SOURCE_CHANNEL_ID=$LEFT_CHANNEL_ID
TARGET_CHANNEL_ID=$RIGHT_CHANNEL_ID
MESSAGE_TEMPLATE=**[{{source_name}}] {{username}}**: {{message}}

# Optional: Heartbeat monitoring (disabled by default)
#HEARTBEAT_URL=https://your-heartbeat-monitor.com/ping/your-monitor-id
#HEARTBEAT_INTERVAL_MINUTES=15

# Logging
LOG_LEVEL=info
DEBUG_WEBSOCKET_EVENTS=false
EVENT_SUMMARY_INTERVAL_MINUTES=5

# Dry run mode (set to true to test without posting messages)
DRY_RUN=false
EOF

echo -e "${GREEN}✅ Created .env.local file${NC}"
echo ""

# Add .env.local to .gitignore if not already there
if [ -f ".gitignore" ]; then
    if ! grep -q "^\.env\.local$" .gitignore; then
        echo -e "${BLUE}📝 Adding .env.local to .gitignore...${NC}"
        echo -e "\n# Local development environment\n.env.local" >> .gitignore
        echo -e "${GREEN}✅ Added .env.local to .gitignore${NC}"
    else
        echo -e "${GREEN}✅ .env.local already in .gitignore${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  No .gitignore file found - remember to not commit .env.local!${NC}"
fi
echo ""

echo -e "${BLUE}🚀 To start the bridge:${NC}"
echo -e "  1. The bridge will automatically use .env.local (no need to copy)"
echo -e "  2. Run the bridge: ${YELLOW}npm start${NC}"
echo ""
echo -e "${BLUE}💡 Tips:${NC}"
echo -e "  - Login to LEFT instance (team URL): ${YELLOW}http://localhost:$MM1_PORT/$LEFT_TEAM${NC}"
echo -e "  - Login to RIGHT instance (team URL): ${YELLOW}http://localhost:$MM2_PORT/$RIGHT_TEAM${NC}"
echo -e "  - Post in #$TEST_CHANNEL_LEFT to test the bridge"
echo -e "  - Messages should appear in #$TEST_CHANNEL_RIGHT on the RIGHT instance"
echo -e "  - Check container logs: ${YELLOW}docker logs -f mm1${NC} or ${YELLOW}docker logs -f mm2${NC}"
echo -e "  - Stop containers: ${YELLOW}docker stop mm1 mm2${NC}"
echo -e "  - Remove containers: ${YELLOW}docker rm mm1 mm2${NC}"
echo ""