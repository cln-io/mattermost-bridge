# Mattermost Bridge

A TypeScript-based bridge that forwards messages between channels on different Mattermost instances. Perfect for connecting teams across separate Mattermost servers while maintaining message context and attachments. Uses regular user accounts for authentication - no bot setup required!

> This project was vibe coded with Claude Opus 4

## Flow

![Mattermost Bridge Flow](img/bridge-svg-diagram.svg)

## Screenshots

The left mattermost (the one we want to monitor messages on) has a user posting a message:

![example](img/sourcemm.png)

The bridge will mirror the message to the right mattermost (the destination mattermost)

![example](img/example.png)

The console / app log

![console](img/console-light.png)

## How It Works

![Mattermost Bridge Flow](img/bridge-flow.svg)

The bridge listens for messages on a source channel and forwards them to a target channel on a different Mattermost instance, preserving:
- User avatars
- File attachments
- Message formatting
- Original context (timestamp, channel, server)

## Features

- **Cross-server messaging** - Bridge channels between any two Mattermost instances
- **Profile picture sync** - Downloads and re-uploads user avatars with intelligent caching
- **File attachment support** - Seamlessly forwards all file attachments
- **MFA/2FA support** - Works with multi-factor authentication enabled accounts
- **Email domain filtering** - Exclude messages from specific email domains
- **Minimal attachments** - Clean, baby blue message formatting with profile pictures
- **Heartbeat monitoring** - Optional health check integration
- **Dry-run mode** - Test your configuration without sending messages
- **Robust reconnection** - Automatic WebSocket reconnection on disconnects

## Prerequisites

- Node.js 16+ and npm
- Access to two Mattermost instances with user accounts
- Channel IDs from both source and target channels

> **⚡ Note on Bot Accounts**  
> This bridge currently uses regular user accounts with username/password authentication, not official Mattermost bot accounts. While this works perfectly fine, if you're feeling adventurous and want to implement proper bot token authentication, the codebase is structured in a way that should make it pretty straightforward. Just need to swap out the login flow in `mattermost-client.ts` with token-based auth and you're golden. PRs welcome if you get it working! 🚀

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd mattermost-bridge

# Install dependencies
npm install

# Build the TypeScript code
npm run build
```

## Configuration

Create a `.env` file in the project root:

```env
# Left Mattermost Instance (Source)
MATTERMOST_LEFT_NAME=SourceServer
MATTERMOST_LEFT_TEAM=team-name
MATTERMOST_LEFT_SERVER=https://mattermost.source.com
MATTERMOST_LEFT_USERNAME=bridge-user@source.com
MATTERMOST_LEFT_PASSWORD_B64=<base64-encoded-password>
MATTERMOST_LEFT_MFA_SEED=<optional-mfa-seed>

# Right Mattermost Instance (Target)
MATTERMOST_RIGHT_NAME=TargetServer
MATTERMOST_RIGHT_TEAM=team-name
MATTERMOST_RIGHT_SERVER=https://mattermost.target.com
MATTERMOST_RIGHT_USERNAME=bridge-user@target.com
MATTERMOST_RIGHT_PASSWORD_B64=<base64-encoded-password>
MATTERMOST_RIGHT_MFA_SEED=<optional-mfa-seed>

# Bridge Configuration
SOURCE_CHANNEL_ID=abc123def456...
TARGET_CHANNEL_ID=xyz789uvw012...

# Optional: Email Filtering
DONT_FORWARD_FOR=@excluded-domain.com,@another-domain.com

# Optional: Heartbeat Monitoring
HEARTBEAT_URL=https://heartbeat.uptimerobot.com/...
HEARTBEAT_INTERVAL_MINUTES=15

# Optional: Footer Icon
FOOTER_ICON=https://example.com/icon.png

# Logging
LOG_LEVEL=info
DEBUG_WEBSOCKET_EVENTS=false
EVENT_SUMMARY_INTERVAL_MINUTES=10

# Testing
DRY_RUN=false
```

### Password Encoding

Encode your passwords to base64:

```bash
# Using the included script
node encode-password.js "your-password-here"

# Or manually
echo -n "your-password" | base64
```

### Finding Channel IDs

Use mmctl or the Mattermost API to find channel IDs:

```bash
mmctl channel search "channel-name" --team "team-name"
```

## Usage

### Production

```bash
# Start the bridge
npm start

# Or with PM2
pm2 start npm --name "mattermost-bridge" -- start
```

### Docker

```bash
# Build the image (multi-platform by default)
./build.sh

# Build for local platform only (faster)
./build.sh latest local

# Run with environment file
docker run --env-file .env mattermost-bridge:latest

# Run with inline environment variables
docker run \
  -e MATTERMOST_LEFT_NAME='Production' \
  -e MATTERMOST_LEFT_SERVER='http://localhost:8065' \
  -e MATTERMOST_LEFT_USERNAME='left@example.com' \
  -e MATTERMOST_LEFT_PASSWORD_B64='cGFzc3dvcmQxMjM=' \
  -e MATTERMOST_LEFT_MFA_SEED='JBSWY3DPEHPK3PXP' \
  -e MATTERMOST_LEFT_TEAM='main' \
  -e MATTERMOST_RIGHT_NAME='Development' \
  -e MATTERMOST_RIGHT_SERVER='http://localhost:9065' \
  -e MATTERMOST_RIGHT_USERNAME='right@example.com' \
  -e MATTERMOST_RIGHT_PASSWORD_B64='cGFzc3dvcmQxMjM=' \
  -e MATTERMOST_RIGHT_MFA_SEED='' \
  -e MATTERMOST_RIGHT_TEAM='main' \
  -e SOURCE_CHANNEL_ID='8soyabwtjfnfxgpxwg3dho1eio' \
  -e TARGET_CHANNEL_ID='ke4xsqwn7i8p7yp5ws3ko8dwqe' \
  mattermost-bridge:latest

# Push to Docker Hub (multi-arch)
./push-live.sh

# Or with docker-compose
docker-compose up -d
```

#### Docker Compose

Here's a complete `docker-compose.yml` example:

```yaml
version: '3.8'

services:
  mattermost-bridge:
    image: clnio/mattermost-bridge:latest
    environment:
      # Left Mattermost Instance
      MATTERMOST_LEFT_NAME: DEMO-LEFT
      MATTERMOST_LEFT_TEAM: demo-team-left
      MATTERMOST_LEFT_SERVER: https://left.mattermost.example.com
      MATTERMOST_LEFT_USERNAME: demo.left@example.com
      MATTERMOST_LEFT_PASSWORD_B64: REPLACED_BASE64_PASSWORD_LEFT
      MATTERMOST_LEFT_MFA_SEED: DEMOMFALEFT1234567890

      # Right Mattermost Instance
      MATTERMOST_RIGHT_NAME: DEMO-RIGHT
      MATTERMOST_RIGHT_TEAM: demo-team-right
      MATTERMOST_RIGHT_SERVER: https://right.mattermost.example.com
      MATTERMOST_RIGHT_USERNAME: demo.right@example.com
      MATTERMOST_RIGHT_PASSWORD_B64: REPLACED_BASE64_PASSWORD_RIGHT
      MATTERMOST_RIGHT_MFA_SEED: DEMOMFARIGHT1234567890

      # Heartbeat Monitoring (Optional)
      HEARTBEAT_URL: 
      HEARTBEAT_INTERVAL_MINUTES: 15

      # Event summary interval in minutes (default: 10)
      EVENT_SUMMARY_INTERVAL_MINUTES: 10

      # Logging Configuration (Optional)
      LOG_LEVEL: info
      DEBUG_WEBSOCKET_EVENTS: false

      # Bridge Rules
      SOURCE_CHANNEL_ID: demo_source_channel_id
      TARGET_CHANNEL_ID: demo_target_channel_id

      # Don't forward messages from users with these email domains
      DONT_FORWARD_FOR: "@gmail.com,@yahoo.com,@hotmail.com"

      # Optional: Custom footer icon URL
      FOOTER_ICON: https://mattermost.com/wp-content/uploads/2022/02/icon_WS.png
```

#### Docker Hub

Pre-built multi-architecture images are available:

```bash
# Pull from Docker Hub (auto-detects platform)
docker pull clnio/mattermost-bridge:latest

# Run from Docker Hub
docker run --env-file .env clnio/mattermost-bridge:latest
```

#### Multi-Platform Support

The Docker images support both AMD64 (x86_64) and ARM64 architectures:

- **AMD64**: For standard servers, cloud instances, and Intel/AMD desktops
- **ARM64**: For Apple Silicon Macs, ARM-based servers, and Raspberry Pi

Docker automatically selects the correct architecture when pulling images. The build scripts create optimized images for both platforms by default.

## Local Development

The project includes scripts for setting up a complete local testing environment:

### Quick Start

```bash
# Set up two local Mattermost instances
./local-env-setup.sh

# This creates:
# - Two Mattermost containers (mm1 on :8065, mm2 on :9065)
# - Test users and channels
# - A .env.local file with all configuration

# Start the bridge
npm run dev

# Test by posting a message
./test-bridge.sh
```

### Local Environment URLs

After running `local-env-setup.sh`:

- **Left Instance**: http://localhost:8065/left
  - User: `left` / `leftpass123!`
  - Bridge User: `bridge-bot-left` / `bridgeleft123!`

- **Right Instance**: http://localhost:9065/right
  - User: `right` / `rightpass123!`
  - Bridge User: `bridge-bot-right` / `bridgeright123!`

### Cleanup

```bash
# Stop and remove local containers
./local-env-cleanup.sh
```

## Message Format

Messages are forwarded using Mattermost attachments with:
- Baby blue color (#87CEEB)
- User profile picture
- Author name (with nickname if set)
- Original message content
- Footer with source server, channel, and timestamp
- All file attachments preserved

Example appearance:
```
[Profile Pic] John Doe - @jdoe
Hello from the other server!
SourceServer • #general • 2:45 PM
```

## Troubleshooting

### Common Issues

**Authentication Failed**
- Verify base64 encoded passwords are correct
- Check MFA seed if using 2FA
- Ensure user accounts have channel access

**Channel Not Found**
- Verify channel IDs are correct
- Ensure user has joined both channels
- Check team names in configuration

**WebSocket Disconnects**
- Check firewall/proxy settings
- Verify WebSocket support on your network
- Monitor logs for reconnection attempts

### Debug Mode

Enable detailed logging:

```env
LOG_LEVEL=debug
DEBUG_WEBSOCKET_EVENTS=true
```

### Manual Testing

```bash
# Debug mmctl commands
./debug-mmctl.sh

# Test channel creation
./debug-create-channel.sh
```

## Scripts

### NPM Scripts
- `npm start` - Start the bridge
- `npm run dev` - Development mode with auto-reload
- `npm run build` - Compile TypeScript
- `npm test` - Run tests

### Shell Scripts

#### `build.sh`
Builds Docker images with multi-platform support (AMD64 and ARM64).

```bash
# Build latest multi-platform with fresh compilation (DEFAULT)
./build.sh

# Build specific version
./build.sh v1.0.0

# Build for current platform only (faster, local testing)
./build.sh latest local

# Build with Docker cache enabled
./build.sh latest cache

# Build local platform with cache
./build.sh latest local cache
```

Features:
- Automatic TypeScript compilation before Docker build
- Multi-platform support (linux/amd64, linux/arm64) by default
- Fresh builds with `--no-cache` by default
- Local platform builds for faster development
- Automatic buildx setup and management

#### `push-live.sh`
Pushes Docker images to registry with multi-architecture support.

```bash
# Build and push multi-arch to clnio/mattermost-bridge:latest (DEFAULT)
./push-live.sh

# Push specific version
./push-live.sh v1.0.0

# Push to custom registry
./push-live.sh latest myregistry/mattermost-bridge

# Push existing local image only (no multi-arch build)
./push-live.sh latest clnio/mattermost-bridge --local-only
```

Features:
- Multi-architecture build and push by default
- Direct registry push without creating local images
- Optional local-only mode for existing images
- Automatic platform detection for pull commands

#### `quick-start.sh`
Automated development environment setup.

```bash
./quick-start.sh
```

This script:
1. Checks Node.js version (18+ required)
2. Installs dependencies
3. Creates necessary directories
4. Sets up `.env` from template
5. Builds TypeScript
6. Runs tests
7. Starts the application

#### `cleanup-docker.sh`
Cleans up Docker buildx builders.

```bash
./cleanup-docker.sh
```

Use this if you encounter buildx issues or want to reset your Docker build environment.

#### `debug-build.sh`
Debugs build issues, especially TypeScript compilation.

```bash
./debug-build.sh
```

Shows:
- Current directory structure
- Source file locations
- TypeScript configuration
- Direct ts-node execution test

### Other Scripts
- `./local-env-setup.sh` - Set up local test environment
- `./test-bridge.sh` - Send test messages
- `node encode-password.js` - Encode passwords

## Architecture

The bridge consists of:
- **MattermostClient** - Handles API and WebSocket connections
- **Bridge** - Orchestrates message forwarding
- **MessageAttachment** - Creates formatted message attachments
- **HeartbeatService** - Optional health monitoring

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## CI/CD with GitHub Actions

The project includes automated Docker image building and publishing via GitHub Actions.

### Automatic Builds

The workflow triggers on:
- Push to `main` or `master` branches
- Creation of version tags (`v*`)
- Manual workflow dispatch

### Setup

1. Create the workflow file:
   ```bash
   mkdir -p .github/workflows
   # Copy the docker-publish.yml file to .github/workflows/
   ```

2. Update the `IMAGE_NAME` in the workflow file to match your Docker Hub repository

3. Add the following secrets to your GitHub repository:
   - `DOCKERHUB_USERNAME` - Your Docker Hub username
   - `DOCKERHUB_TOKEN` - Docker Hub access token (not password)

4. To create a Docker Hub access token:
   - Log in to [Docker Hub](https://hub.docker.com)
   - Go to Account Settings → Security
   - Click "New Access Token"
   - Give it a descriptive name
   - Copy the token and add it as a GitHub secret

### Image Tags

The workflow creates multiple tags:
- `latest` - Updated on every push to the default branch
- `v1.0.0` - Created from git tags
- `main-1234abc` - SHA-based tags for every build
- Branch names for non-default branches

### Manual Trigger

You can manually trigger a build from the Actions tab in your GitHub repository.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
