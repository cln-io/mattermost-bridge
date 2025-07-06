#!/bin/bash

set -e  # Exit on any error

# Usage: ./push-live.sh [tag] [registry] [--local-only]
#   tag: Docker image tag (default: latest)
#   registry: Registry username/repo (default: clnio/mattermost-bridge)
#   --local-only: Push local image only (default: multi-arch build and push)
#
# Examples:
#   ./push-live.sh                           # Build and push multi-arch to clnio/mattermost-bridge:latest (DEFAULT)
#   ./push-live.sh v1.0.0                    # Build and push multi-arch v1.0.0
#   ./push-live.sh latest clnio/mattermost-bridge --local-only  # Push local image only

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
LOCAL_IMAGE="mattermost-bridge"
TAG="${1:-latest}"
REGISTRY="${2:-clnio/mattermost-bridge}"
REMOTE_IMAGE="${REGISTRY}:${TAG}"
MULTI_ARCH=true  # Default to multi-arch
PLATFORMS="linux/amd64,linux/arm64"

# Check for local-only flag
if [ "${3}" = "--local-only" ] || [ "${2}" = "--local-only" ]; then
    MULTI_ARCH=false
fi

echo -e "${BLUE}🚀 Pushing Mattermost Bridge to Registry (Multi-Arch by Default)${NC}"
if [ "${MULTI_ARCH}" = "true" ]; then
    echo -e "${BLUE}Mode: Multi-architecture build and push (DEFAULT)${NC}"
    echo -e "${BLUE}Platforms: ${PLATFORMS}${NC}"
else
    echo -e "${BLUE}Mode: Local image push only${NC}"
    echo -e "${BLUE}Local Image:  ${LOCAL_IMAGE}:${TAG}${NC}"
fi
echo -e "${BLUE}Remote Image: ${REMOTE_IMAGE}${NC}"
echo ""

if [ "${MULTI_ARCH}" = "true" ]; then
    # Multi-arch build and push directly
    echo -e "${YELLOW}🏗️  Building and pushing multi-architecture image...${NC}"
    echo -e "${BLUE}This builds fresh and pushes directly - no local image created${NC}"
    echo ""
    
    # Step 1: Setup Docker buildx
    echo -e "${YELLOW}🐳 Setting up Docker buildx...${NC}"
    
    # Check if multiarch-builder exists and use it
    if docker buildx ls | grep -q multiarch-builder; then
        docker buildx use multiarch-builder
        echo -e "${GREEN}✅ Using existing multiarch builder${NC}"
    else
        echo "Creating new multiarch builder..."
        if docker buildx create --name multiarch-builder --driver docker-container --bootstrap; then
            docker buildx use multiarch-builder
            echo -e "${GREEN}✅ New multiarch builder created and activated${NC}"
        else
            echo -e "${YELLOW}⚠️  Failed to create multiarch builder, using default${NC}"
            docker buildx use default
        fi
    fi
    echo ""
    
    # Step 2: Build and push multi-arch
    echo -e "${YELLOW}🔨 Building and pushing multi-platform image...${NC}"
    echo -e "${BLUE}Platforms: ${PLATFORMS}${NC}"
    echo -e "${BLUE}Target: ${REMOTE_IMAGE}${NC}"
    echo ""
    
    docker buildx build \
        --platform "${PLATFORMS}" \
        --tag "${REMOTE_IMAGE}" \
        --tag "${REGISTRY}:latest" \
        --push \
        .
    
    if [ $? -eq 0 ]; then
        echo ""
        echo -e "${GREEN}✅ Successfully built and pushed multi-arch image!${NC}"
        echo ""
    else
        echo ""
        echo -e "${RED}❌ Failed to build and push multi-arch image${NC}"
        exit 1
    fi

else
    # Local image push (original behavior)
    
    # Step 1: Check if local image exists
    echo -e "${YELLOW}🔍 Checking if local image exists...${NC}"
    if ! docker image inspect "${LOCAL_IMAGE}:${TAG}" >/dev/null 2>&1; then
        echo -e "${RED}❌ Local image ${LOCAL_IMAGE}:${TAG} not found${NC}"
        echo -e "${YELLOW}💡 Options:${NC}"
        echo -e "   1. Build local image first: ./build.sh ${TAG} local"
        echo -e "   2. Use default multi-arch build and push: ./push-live.sh ${TAG}"
        exit 1
    fi
    echo -e "${GREEN}✅ Local image found${NC}"
    echo ""

    # Step 2: Check Docker login status
    echo -e "${YELLOW}🔐 Checking Docker registry authentication...${NC}"
    if ! docker info >/dev/null 2>&1; then
        echo -e "${RED}❌ Docker daemon not running${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ Docker daemon is running${NC}"
    echo ""

    # Step 3: Tag the image
    echo -e "${YELLOW}🏷️  Tagging image for registry...${NC}"
    docker tag "${LOCAL_IMAGE}:${TAG}" "${REMOTE_IMAGE}"

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Successfully tagged ${LOCAL_IMAGE}:${TAG} as ${REMOTE_IMAGE}${NC}"
        echo ""
    else
        echo -e "${RED}❌ Failed to tag image${NC}"
        exit 1
    fi

    # Step 4: Push to registry
    echo -e "${YELLOW}📤 Pushing to registry...${NC}"
    echo -e "${BLUE}This may take a few minutes depending on image size and connection speed...${NC}"
    echo ""

    docker push "${REMOTE_IMAGE}"

    if [ $? -eq 0 ]; then
        echo ""
        echo -e "${GREEN}✅ Successfully pushed to registry!${NC}"
        echo ""
    else
        echo ""
        echo -e "${RED}❌ Failed to push to registry${NC}"
        echo -e "${YELLOW}💡 Common solutions:${NC}"
        echo -e "   1. Login to registry: docker login"
        echo -e "   2. Check repository permissions"
        echo -e "   3. Verify registry URL: ${REGISTRY}"
        exit 1
    fi
fi

# Display image information
echo -e "${YELLOW}📋 Push Summary:${NC}"
echo -e "${GREEN}✅ Image: ${REMOTE_IMAGE}${NC}"
if [ "${MULTI_ARCH}" = "true" ]; then
    echo -e "${GREEN}✅ Platforms: ${PLATFORMS}${NC}"
fi

# Extract registry hostname
REGISTRY_HOST=$(echo "${REGISTRY}" | cut -d'/' -f1)
if [[ "${REGISTRY_HOST}" != *"."* ]]; then
    REGISTRY_HOST="docker.io"
fi
echo -e "${GREEN}✅ Registry: ${REGISTRY_HOST}${NC}"
echo -e "${GREEN}✅ Tag: ${TAG}${NC}"
echo ""

# Show pull commands for different platforms
echo -e "${BLUE}🐳 To pull this image:${NC}"
if [ "${MULTI_ARCH}" = "true" ]; then
    echo -e "   # Automatic platform detection:"
    echo -e "   docker pull ${REMOTE_IMAGE}"
    echo ""
    echo -e "   # Specific platforms:"
    echo -e "   docker pull --platform linux/amd64 ${REMOTE_IMAGE}  # For x86_64 servers"
    echo -e "   docker pull --platform linux/arm64 ${REMOTE_IMAGE}  # For ARM64 (Apple Silicon, etc.)"
else
    echo -e "   docker pull ${REMOTE_IMAGE}"
fi
echo ""

echo -e "${BLUE}🚀 To run this image:${NC}"
echo -e "   docker run --env-file .env ${REMOTE_IMAGE}"
echo ""

if [ "${MULTI_ARCH}" = "false" ]; then
    # Cleanup local registry tag (optional) - only for local pushes
    read -p "$(echo -e ${YELLOW}🧹 Remove local registry tag ${REMOTE_IMAGE}? [y/N]: ${NC})" -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker rmi "${REMOTE_IMAGE}" >/dev/null 2>&1
        echo -e "${GREEN}✅ Cleaned up local registry tag${NC}"
    else
        echo -e "${BLUE}ℹ️  Keeping local registry tag${NC}"
    fi
    echo ""
fi

echo -e "${GREEN}🎉 Push completed successfully!${NC}"

if [ "${MULTI_ARCH}" = "true" ]; then
    echo ""
    echo -e "${BLUE}💡 Multi-arch image supports both AMD64 and ARM64 platforms${NC}"
    echo -e "${BLUE}   Your Synology (x86_64) will automatically get the AMD64 version${NC}"
    echo -e "${BLUE}   Your Mac (ARM64) will automatically get the ARM64 version${NC}"
    echo ""
    echo -e "${GREEN}✨ This is the recommended approach for production deployments!${NC}"
fi