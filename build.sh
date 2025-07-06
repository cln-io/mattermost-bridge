#!/bin/bash

set -e  # Exit on any error

# Usage: ./build.sh [tag] [local|cache]
#   tag: Docker image tag (default: latest)
#   local: Build for current platform only (default: multi-platform)
#   cache: Use Docker cache (default: --no-cache for fresh builds)
#
# Examples:
#   ./build.sh                    # Build latest multi-platform with --no-cache (DEFAULT)
#   ./build.sh v1.0.0             # Build v1.0.0 multi-platform with --no-cache
#   ./build.sh latest local       # Build latest for current platform only (no cache)
#   ./build.sh latest cache       # Build latest multi-platform WITH cache
#   ./build.sh latest local cache # Build latest local platform WITH cache

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="mattermost-bridge"
TAG="${1:-latest}"
PLATFORMS="linux/amd64,linux/arm64"

echo -e "${BLUE}🚀 Building Mattermost Bridge (Multi-Platform + No-Cache by Default)${NC}"
echo -e "${BLUE}Image: ${IMAGE_NAME}:${TAG}${NC}"
echo -e "${BLUE}Default: Multi-platform build with fresh compilation${NC}"
echo ""

# Step 1: Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    npm install
    echo -e "${GREEN}✅ Dependencies installed${NC}"
    echo ""
else
    echo -e "${GREEN}✅ Dependencies already installed${NC}"
    echo ""
fi

# Step 2: Clean and compile TypeScript
echo -e "${YELLOW}🧹 Cleaning previous build...${NC}"
rm -rf dist/
echo -e "${GREEN}✅ Previous build cleaned${NC}"

echo -e "${YELLOW}🔨 Compiling TypeScript...${NC}"
npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ TypeScript compilation successful${NC}"
    
    # Verify dist directory was created
    if [ -d "dist" ] && [ "$(ls -A dist)" ]; then
        echo -e "${GREEN}✅ dist/ directory created with compiled files${NC}"
        echo -e "${BLUE}📁 Built files:${NC}"
        ls -la dist/
    else
        echo -e "${RED}❌ dist/ directory is missing or empty${NC}"
        exit 1
    fi
    echo ""
else
    echo -e "${RED}❌ TypeScript compilation failed${NC}"
    exit 1
fi

# Step 3: Setup Docker buildx for multi-platform builds
echo -e "${YELLOW}🐳 Setting up Docker buildx...${NC}"

# Check if multiarch-builder exists and remove if it's in a bad state
if docker buildx ls | grep -q multiarch-builder; then
    echo "Builder 'multiarch-builder' exists, checking status..."
    if ! docker buildx inspect multiarch-builder >/dev/null 2>&1; then
        echo "Builder is in bad state, removing..."
        docker buildx rm multiarch-builder >/dev/null 2>&1 || true
    fi
fi

# Create and use the builder if it doesn't exist
if ! docker buildx ls | grep -q multiarch-builder; then
    echo "Creating new multiarch builder..."
    if docker buildx create --name multiarch-builder --driver docker-container --bootstrap; then
        docker buildx use multiarch-builder
        echo -e "${GREEN}✅ New multiarch builder created and activated${NC}"
    else
        echo -e "${YELLOW}⚠️  Failed to create multiarch builder, using default${NC}"
        docker buildx use default
    fi
else
    docker buildx use multiarch-builder
    echo -e "${GREEN}✅ Using existing multiarch builder${NC}"
fi
echo ""

# Step 4: Determine build settings
echo -e "${YELLOW}🏗️  Determining build configuration...${NC}"

# Detect current platform
CURRENT_ARCH=$(uname -m)
case $CURRENT_ARCH in
    x86_64) CURRENT_PLATFORM="linux/amd64" ;;
    arm64|aarch64) CURRENT_PLATFORM="linux/arm64" ;;
    *) CURRENT_PLATFORM="linux/amd64" ;;
esac

# Determine build settings based on parameters
BUILD_LOCAL=false
USE_CACHE=false

# Check if we want local build
if [ "${2}" = "local" ]; then
    BUILD_LOCAL=true
    # Check if third parameter requests cache
    if [ "${3}" = "cache" ]; then
        USE_CACHE=true
    fi
elif [ "${2}" = "cache" ]; then
    # Multi-platform with cache
    USE_CACHE=true
fi

# Set cache flag
CACHE_FLAG=""
if [ "${USE_CACHE}" = "false" ]; then
    CACHE_FLAG="--no-cache"
fi

# Display build configuration
echo -e "${BLUE}Current platform: ${CURRENT_PLATFORM}${NC}"
if [ "${BUILD_LOCAL}" = "true" ]; then
    echo -e "${BLUE}Building for: Current platform only (${CURRENT_PLATFORM})${NC}"
else
    echo -e "${BLUE}Building for: Multiple platforms (${PLATFORMS})${NC}"
fi

if [ "${USE_CACHE}" = "true" ]; then
    echo -e "${BLUE}Cache: Using Docker build cache${NC}"
else
    echo -e "${BLUE}Cache: Fresh build (--no-cache)${NC}"
fi
echo ""

# Step 5: Build Docker image
echo -e "${YELLOW}🔨 Building Docker image...${NC}"

if [ "${BUILD_LOCAL}" = "true" ]; then
    docker buildx build \
        --platform "${CURRENT_PLATFORM}" \
        --tag "${IMAGE_NAME}:${TAG}" \
        --tag "${IMAGE_NAME}:latest" \
        ${CACHE_FLAG} \
        --load \
        .
else
    echo -e "${YELLOW}Note: Multi-platform builds cannot be loaded locally${NC}"
    
    docker buildx build \
        --platform "${PLATFORMS}" \
        --tag "${IMAGE_NAME}:${TAG}" \
        --tag "${IMAGE_NAME}:latest" \
        ${CACHE_FLAG} \
        .
fi

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Docker build successful${NC}"
    echo ""
else
    echo -e "${RED}❌ Docker build failed${NC}"
    exit 1
fi

# Step 5: Display image info
echo -e "${YELLOW}📋 Image Information:${NC}"
if [ "${BUILD_LOCAL}" = "true" ]; then
    docker images "${IMAGE_NAME}" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"
    echo ""
    
    # Step 6: Test the image (only for local builds)
    echo -e "${YELLOW}🧪 Testing the image...${NC}"
    docker run --rm "${IMAGE_NAME}:${TAG}" node -e "console.log('✅ Image test passed')"
    echo ""
else
    echo "Multi-platform build completed (images not loaded locally)"
    echo ""
fi

echo -e "${GREEN}🎉 Build completed successfully!${NC}"
echo ""
echo -e "${BLUE}Usage:${NC}"
echo -e "  ./build.sh [tag] [local|cache]"
echo ""
echo -e "${BLUE}To run the container:${NC}"
echo -e "  docker run --env-file .env ${IMAGE_NAME}:${TAG}"
echo ""
echo -e "${BLUE}To run with custom environment:${NC}"
echo -e "  docker run \\"
echo -e "    -e MATTERMOST_LEFT_NAME='Production' \\"
echo -e "    -e MATTERMOST_LEFT_SERVER='http://localhost:8065' \\"
echo -e "    -e MATTERMOST_LEFT_USERNAME='left@example.com' \\"
echo -e "    -e MATTERMOST_LEFT_PASSWORD_B64='cGFzc3dvcmQxMjM=' \\"
echo -e "    -e MATTERMOST_LEFT_MFA_SEED='JBSWY3DPEHPK3PXP' \\"
echo -e "    -e MATTERMOST_LEFT_TEAM='main' \\"
echo -e "    -e MATTERMOST_RIGHT_NAME='Development' \\"
echo -e "    -e MATTERMOST_RIGHT_SERVER='http://localhost:9065' \\"
echo -e "    -e MATTERMOST_RIGHT_USERNAME='right@example.com' \\"
echo -e "    -e MATTERMOST_RIGHT_PASSWORD_B64='cGFzc3dvcmQxMjM=' \\"
echo -e "    -e MATTERMOST_RIGHT_MFA_SEED='' \\"
echo -e "    -e MATTERMOST_RIGHT_TEAM='main' \\"
echo -e "    -e SOURCE_CHANNEL_ID='8soyabwtjfnfxgpxwg3dho1eio' \\"
echo -e "    -e TARGET_CHANNEL_ID='ke4xsqwn7i8p7yp5ws3ko8dwqe' \\"
echo -e "    ${IMAGE_NAME}:${TAG}"
echo ""
echo -e "${BLUE}To build for current platform only:${NC}"
echo -e "  ./build.sh latest local"